package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.runtime.OwnerLimits;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.Topic;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.PluginStatus;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.model.SecurityLabel;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The plugin host with real plugin jars in their own class loaders. */
class PluginHostTest {

  private static final Duration BUDGET = Duration.ofSeconds(1);

  @TempDir Path plugins;

  private final PluginStatuses statuses = new PluginStatuses();
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().listener(statuses));
  private final Probe<String> events = new Probe<>();
  private PluginHost host;

  @AfterEach
  void close() {
    if (host != null) {
      host.stop();
    }
    runtime.close();
  }

  private PluginFolders folders() {
    return new PluginFolders(plugins);
  }

  /** Records what the test plugins report on {@code <id>.events}. */
  private void listenTo(String... ids) {
    WorkerHandle<PluginStatus> recorder = runtime.owner("core-test").spawn(
        WorkerOptions.<PluginStatus>of("recorder", () -> (status, ctx) -> events.add(status.detail())));
    for (String id : ids) {
      runtime.owner("core-test").subscribe(Topic.of(id + ".events", PluginStatus.class), recorder, s -> s);
    }
  }

  private PluginHost start() {
    return start(PluginHost.DEFAULT_LIMITS);
  }

  private PluginHost start(OwnerLimits limits) {
    host = new PluginHost(plugins, runtime, statuses, SecurityLabel.of("NATO", "UNCLASSIFIED"), new ModelJson(), limits, BUDGET);
    host.start();
    return host;
  }

  private String get(String pluginId, String path) {
    Probe<HttpReply> reply = new Probe<>();
    host.endpoints().dispatch(
        new PluginEndpoints.Request(pluginId, "GET", path, Map.of(), Headers.empty(), dev.emcc.sdk.User.noLoginUser()), reply::add);
    HttpReply r = reply.next();
    return r.status() + " " + r.body().toUtf8();
  }

  private Map<String, String> states() {
    return host.plugins().stream().collect(Collectors.toMap(PluginHost.PluginInfo::id,
        p -> (p.active() ? "active " : "disabled ") + p.status().state()));
  }

  private String reason(String id) {
    return statuses.of(id).detail();
  }

  @Test
  void startsPluginsInDependencyOrderAndStopsThemInReverse() {
    folders().plugin("beta", "ok", List.of("alpha"), false).plugin("alpha");
    listenTo("alpha", "beta");

    start();

    assertThat(events.next(2)).containsExactly("started alpha", "started beta");
    assertThat(host.plugins()).extracting(PluginHost.PluginInfo::id).containsExactly("alpha", "beta");
    assertThat(states()).containsEntry("alpha", "active OK").containsEntry("beta", "active OK");
    assertThat(get("alpha", "/info/id")).isEqualTo("200 alpha");

    host.stop();

    assertThat(events.next(2)).containsExactly("stopped beta", "stopped alpha");
    assertThat(states()).containsEntry("alpha", "disabled OK");
    assertThat(get("alpha", "/info/id")).startsWith("404");
    host = null;
  }

  @Test
  void aPluginSeesTheSdkAndItsOwnJarsButNotEcoreOrItsLibraries() {
    folders().plugin("alpha");
    start();

    assertThat(get("alpha", "/info/sdk")).isEqualTo("200 visible");
    assertThat(get("alpha", "/info/ecore")).isEqualTo("200 hidden");
    assertThat(get("alpha", "/info/jackson")).isEqualTo("200 hidden");
    assertThat(get("alpha", "/info/testkit")).isEqualTo("200 hidden");
    assertThat(get("alpha", "/info/loader")).isEqualTo("200 plugin-alpha / plugin-alpha");
    assertThat(get("alpha", "/info/mode")).as("the setting's default from the manifest").isEqualTo("200 ok");
  }

  @Test
  void eachPluginGetsTheCapsAndOneThatReachesTheTimerCapInInitOrStartIsDisabled() {
    folders().plugin("alpha").plugin("in-init", "init-timers", List.of(), false).plugin("in-start", "start-timers", List.of(), false);

    start(new OwnerLimits(100, 2));

    assertThat(runtime.owner("alpha").limits()).isEqualTo(new OwnerLimits(100, 2));
    assertThat(states()).containsEntry("alpha", "active OK").containsEntry("in-init", "disabled FAILED")
        .containsEntry("in-start", "disabled FAILED");
    assertThat(reason("in-init")).isEqualTo(
        "init failed: java.lang.IllegalStateException: too many active timers: in-init has 2, its cap");
    assertThat(reason("in-start")).isEqualTo(
        "start failed: java.lang.IllegalStateException: too many active timers: in-start has 2, its cap");
    assertThat(runtime.owner("in-start").activeTimers()).as("given back when the plugin was stopped").isZero();
    assertThat(runtime.owner("core-lifecycle-alpha").limits()).as("ECore's own owners").isEqualTo(OwnerLimits.UNLIMITED);
  }

  @Test
  void theDefaultCapsAre10000AsksAnd1000Timers() {
    assertThat(PluginHost.DEFAULT_LIMITS).isEqualTo(new OwnerLimits(10_000, 1_000));
    assertThat(dev.emcc.ecore.ECoreConfig.defaults().pluginLimits()).isEqualTo(PluginHost.DEFAULT_LIMITS);
  }

  @Test
  void theTemplateAndHiddenFoldersAreSkipped() {
    folders().plugin("_template").plugin(".hidden").plugin("alpha");

    start();

    assertThat(host.plugins()).extracting(PluginHost.PluginInfo::id).containsExactly("alpha");
  }

  @Test
  void manifestsForSdk1LoadAndOnesForSdk0OrANewerMinorAreRefused() throws IOException {
    folders()
        .install("for-100", PluginFolders.manifest("for-100", "^1.0.0", PluginFolders.ENTRY_CLASS, "ok", List.of(), false), true)
        .install("for-010", PluginFolders.manifest("for-010", "^0.1.0", PluginFolders.ENTRY_CLASS, "ok", List.of(), false), true)
        .install("for-1100", PluginFolders.manifest("for-1100", "^1.10.0", PluginFolders.ENTRY_CLASS, "ok", List.of(), false), true);

    start();

    assertThat(states()).containsEntry("for-100", "active OK").containsEntry("for-010", "disabled FAILED")
        .containsEntry("for-1100", "disabled FAILED");
    assertThat(reason("for-010")).as("built for SDK v0 (CR-0005)").isEqualTo("needs SDK ^0.1.0, but ECore implements 1.9.0");
    assertThat(reason("for-1100")).isEqualTo("needs SDK ^1.10.0, but ECore implements 1.9.0");
  }

  @Test
  void brokenFoldersAreDisabledWithAReasonAndTheOthersRun() throws IOException {
    folders()
        .plugin("alpha")
        .install("wrong-folder", PluginFolders.manifest("other-id", "^1.0.0", PluginFolders.ENTRY_CLASS, "ok", List.of(), false), true)
        .install("bad-json", "{\"id\": ", false)
        .install("newer-sdk", PluginFolders.manifest("newer-sdk", "^1.10.0", PluginFolders.ENTRY_CLASS, "ok", List.of(), false), true)
        .install("no-jar", PluginFolders.manifest("no-jar", "^1.0.0", PluginFolders.ENTRY_CLASS, "ok", List.of(), false), false)
        .install("not-a-plugin", PluginFolders.manifest("not-a-plugin", "^1.0.0",
            "dev.emcc.ecore.plugin.testplugin.NotAPlugin", "ok", List.of(), false), true)
        .install("core-thing", PluginFolders.manifest("core-thing", "^1.0.0", PluginFolders.ENTRY_CLASS, "ok", List.of(), false), true);
    Files.createDirectories(plugins.resolve("empty"));

    start();

    assertThat(states()).containsEntry("alpha", "active OK");
    Map<String, String> others = new java.util.HashMap<>(states());
    others.remove("alpha");
    assertThat(others).hasSize(7).allSatisfy((id, state) -> assertThat(state).isEqualTo("disabled FAILED"));
    assertThat(reason("wrong-folder")).isEqualTo("the folder name differs from the plugin id other-id");
    assertThat(reason("bad-json")).startsWith("invalid plugin.json");
    assertThat(reason("newer-sdk")).isEqualTo("needs SDK ^1.10.0, but ECore implements 1.9.0");
    assertThat(reason("no-jar")).startsWith("no jar in");
    assertThat(reason("not-a-plugin")).contains("does not implement dev.emcc.sdk.Plugin");
    assertThat(reason("core-thing")).contains("reserved");
    assertThat(reason("empty")).isEqualTo("no plugin.json");
  }

  @Test
  void aPluginWhoseInitFailsIsDisabledWithItsDependents() {
    folders().plugin("broken", "init-throws", List.of(), false).plugin("user", "ok", List.of("broken"), false).plugin("alpha");

    start();

    assertThat(states()).containsEntry("broken", "disabled FAILED").containsEntry("user", "disabled FAILED")
        .containsEntry("alpha", "active OK");
    assertThat(reason("broken")).contains("init failed").contains("init fails on purpose");
    assertThat(reason("user")).isEqualTo("depends on broken, which did not start");
    assertThat(get("broken", "/info/id")).startsWith("404");
  }

  @Test
  void aPluginWhoseStartFailsIsStoppedAndDisabled() {
    folders().plugin("flaky", "start-throws", List.of(), false);
    listenTo("flaky");

    start();

    assertThat(events.next()).isEqualTo("stopped flaky"); // stop() lets it clean up what init made
    assertThat(states()).containsEntry("flaky", "disabled FAILED");
    assertThat(reason("flaky")).contains("start failed");
  }

  @Test
  void anInitOverTheBudgetDisablesThePlugin() {
    folders().plugin("slow", "init-hangs", List.of(), false).plugin("alpha");

    start();

    assertThat(states()).containsEntry("slow", "disabled FAILED").containsEntry("alpha", "active OK");
    assertThat(reason("slow")).isEqualTo("init did not return within 1000 ms");
  }

  @Test
  void aRequiredPluginThatFailsStopsTheStart() {
    folders().plugin("must-have", "init-throws", List.of(), true).plugin("alpha");

    assertThatThrownBy(this::start).isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("the required plugin must-have did not start");
  }

  @Test
  void aWebOnlyPluginIsListedWithoutAServerPart() {
    folders().install("coordinates", """
        {"id": "coordinates", "name": "Coordinates", "version": "0.1.0", "sdkVersion": "^1.0.0", "kind": "utility",
         "web": {"entry": "index.js"}}
        """, false);

    start();

    PluginHost.PluginInfo info = host.plugins().getFirst();
    assertThat(info.active()).isTrue();
    assertThat(info.manifest().web().entry()).isEqualTo("index.js");
    assertThat(info.status().state()).isEqualTo(PluginState.OK);
  }

  @Test
  void aMissingPluginDirectoryMeansNoPlugins() {
    host = new PluginHost(plugins.resolve("absent"), runtime, statuses, SecurityLabel.of("NATO", "UNCLASSIFIED"), new ModelJson(),
        PluginHost.DEFAULT_LIMITS);
    host.start();

    assertThat(host.plugins()).isEmpty();
  }
}
