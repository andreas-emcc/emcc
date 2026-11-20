package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.live.SessionTimes.SessionUser;
import dev.emcc.ecore.persistence.ConfigStore;
import dev.emcc.ecore.persistence.Configuration;
import dev.emcc.ecore.persistence.PluginDocumentStore;
import dev.emcc.ecore.plugin.testplugin.TemporalPlugin;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.ecore.store.DataTypes;
import dev.emcc.ecore.store.DeclaredFields;
import dev.emcc.ecore.store.Workspaces;
import dev.emcc.sdk.User;
import dev.emcc.sdk.UserTime;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.model.SecurityLabel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * SDK 1.4.0 part 4 in the plugin host: capabilities (ADR-0044) checked at load and judged with the
 * shell's report (owner, Q11 and 2026-11-06; the ACA's R1 and R3), and the sessions' times for
 * temporal plugins (ADR-0045; Q10, R2), also in endpoint requests.
 */
class CapabilitiesTest {

  private static final ModelJson JSON = new ModelJson();
  private static final String TEMPORAL = TemporalPlugin.class.getName();
  private static final User ALICE = User.of("alice", "Alice", Set.of());
  private static final User BOB = User.of("bob", "Bob", Set.of());
  private static final SessionUser ALICE_SESSION = new SessionUser("alice", "Alice", Set.of(), false);
  private static final SessionUser BOB_SESSION = new SessionUser("bob", "Bob", Set.of(), false);

  @TempDir Path plugins;
  @TempDir Path data;

  private final PluginStatuses statuses = new PluginStatuses();
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().listener(statuses));
  private final List<PluginHost> hosts = new ArrayList<>();
  private PluginHost host;

  @AfterEach
  void close() {
    hosts.forEach(PluginHost::stop);
    runtime.close();
  }

  private static String manifest(String id, String entryClass, String capabilities, boolean web, String mode) {
    return """
        {"id": "%s", "name": "Plugin %s", "version": "0.1.0", "sdkVersion": "^1.4.0", "kind": "general",
         "server": {"entryClass": "%s"}, %s "capabilities": [%s],
         "settings": {"type": "object", "properties": {"mode": {"type": "string", "default": "%s"}}}}
        """.formatted(id, id, entryClass, web ? "\"web\": {\"entry\": \"index.js\"}," : "", capabilities, mode);
  }

  private CapabilitiesTest install(String id, String manifest) {
    new PluginFolders(plugins).install(id, manifest, true);
    return this;
  }

  private void start() {
    host = new PluginHost(plugins, runtime, statuses, SecurityLabel.of("NATO", "UNCLASSIFIED"), JSON, PluginHost.DEFAULT_LIMITS,
        Duration.ofSeconds(2), new PluginHost.Services(null, new PluginDocumentStore(data, JSON), new DataTypes(),
            new Configuration(new ConfigStore(data, JSON)), ListenerConfig.DEFAULT, PluginHost.DEFAULT_CLASSIFICATION_ORDERS,
            PluginHost.DEFAULT_MAX_CHANNELS, new DeclaredFields(), new Workspaces()));
    hosts.add(host);
    host.start();
  }

  private String get(String pluginId, String path, Headers headers, User user) {
    Probe<HttpReply> reply = new Probe<>();
    host.endpoints().dispatch(new PluginEndpoints.Request(pluginId, "GET", path, Map.of(), headers, user), reply::add);
    HttpReply r = reply.next();
    return r.status() + " " + r.body().toUtf8();
  }

  private String changes(String pluginId) {
    return get(pluginId, "/changes", Headers.empty(), User.noLoginUser());
  }

  private static Headers session(String id) {
    return Headers.of(UserTimes.SESSION_HEADER, id);
  }

  private String reason(String id) {
    return statuses.of(id).detail();
  }

  private boolean active(String id) {
    return host.plugins().stream().filter(p -> p.id().equals(id)).findFirst().orElseThrow().active();
  }

  private PluginHost.Health health(String id) {
    return host.health().stream().filter(h -> h.id().equals(id)).findFirst().orElseThrow();
  }

  // ---- At load ------------------------------------------------------------------------------

  @Test
  void aServerPartMustDeclareWhatItImplementsAndWithoutAWebPartImplementWhatItDeclares() {
    install("undeclared", manifest("undeclared", TEMPORAL, "", false, "ok"))
        .install("missing", manifest("missing", PluginFolders.ENTRY_CLASS, "\"temporal\"", false, "ok"))
        .install("webs", manifest("webs", PluginFolders.ENTRY_CLASS, "\"temporal\"", true, "ok"))
        .install("temporal", manifest("temporal", TEMPORAL, "\"temporal\"", false, "ok"));

    start();

    assertThat(active("undeclared")).isFalse();
    assertThat(reason("undeclared")).isEqualTo("capability temporal implemented by " + TEMPORAL + " but not declared (ADR-0044 point 4)");
    assertThat(active("missing")).isFalse();
    assertThat(reason("missing")).isEqualTo(
        "capability temporal declared but not implemented by " + PluginFolders.ENTRY_CLASS + " (ADR-0044 point 4)");
    assertThat(active("webs")).as("its web part may implement it").isTrue();
    assertThat(active("temporal")).isTrue();
    assertThat(health("temporal").capabilities()).as("the Monitor lists them (ADR-0044 point 7)").containsExactly("temporal");
    assertThat(health("webs").capabilityFault()).isNull();
  }

  @Test
  void anUnknownCapabilityIsRefusedByTheSchemaWithItsIdNamed() throws Exception {
    install("temporal-test", Files.readString(Path.of("../../model/examples/invalid/manifest-unknown-capability.json")));

    start();

    assertThat(reason("temporal-test")).isEqualTo("invalid plugin.json: /capabilities/1: unknown capability history (ADR-0044 point 5)");
  }

  @Test
  void aTimeDeliveryThatFailsRefusesThePlugin() {
    install("broken", manifest("broken", TEMPORAL, "\"temporal\"", false, "delivery-throws"));

    start();

    assertThat(active("broken")).isFalse();
    assertThat(reason("broken")).startsWith("timeDelivery failed: ").contains("timeDelivery fails on purpose");
  }

  // ---- The shell's report -------------------------------------------------------------------

  @Test
  void theShellsReportIsJudgedWithTheServerPartAndShownWithoutStoppingThePlugin() {
    install("webs", manifest("webs", PluginFolders.ENTRY_CLASS, "\"temporal\"", true, "ok"))
        .install("both", manifest("both", TEMPORAL, "\"temporal\"", true, "ok"));
    start();

    assertThat(host.webCapabilities("webs", List.of(), null)).isTrue();
    assertThat(health("webs").capabilityFault().problem())
        .isEqualTo("capability temporal declared but implemented by neither part (ADR-0044 point 4)");
    assertThat(active("webs")).as("running, not stopped (the ACA's R1)").isTrue();

    host.webCapabilities("webs", List.of("temporal"), null);
    assertThat(health("webs").capabilityFault()).as("a later report that is fine clears it").isNull();
    host.webCapabilities("webs", List.of("temporal"), "capability history implemented but not declared");
    assertThat(health("webs").capabilityFault().problem()).isEqualTo("capability history implemented but not declared");

    host.webCapabilities("both", List.of(), null);
    assertThat(health("both").capabilityFault()).as("its server part implements it").isNull();
    assertThat(host.webCapabilities("nobody", List.of(), null)).as("not a running plugin").isFalse();
    host.webCapabilities("both", List.of(), "x".repeat(2_000));
    assertThat(health("both").capabilityFault().problem()).hasSize(PluginHost.MAX_REPORTED_PROBLEM);
  }

  // ---- The sessions' times ------------------------------------------------------------------

  @Test
  void aTemporalPluginGetsEachSessionAtItsStartAtEachChangeAndNowOnceAtItsEnd() {
    install("temporal", manifest("temporal", TEMPORAL, "\"temporal\"", false, "ok"));
    start();
    UserTimes times = host.userTimes();
    Instant at = Instant.parse("2026-11-06T08:00:00Z");

    times.started("s1", ALICE_SESSION);
    times.changed("s1", UserTime.at(at));
    times.started("s2", BOB_SESSION);
    times.changed("s2", UserTime.now().withInterval(at, at.plusSeconds(3600)));
    times.changed("s2", UserTime.at(at.minusSeconds(86_400)).withInterval(at, at.plusSeconds(3600))); // outside it (CR-0032)
    times.ended("s1");
    times.ended("s2");
    times.changed("s1", UserTime.at(at)); // after its end: nothing
    times.started("s3", BOB_SESSION);
    times.ended("s3"); // at now all its life: now once at the end too (the ACA's R2)

    assertThat(changes("temporal")).isEqualTo("200 s1 alice now\ns1 alice 2026-11-06T08:00:00Z\ns2 bob now\n"
        + "s2 bob now 2026-11-06T08:00:00Z/2026-11-06T09:00:00Z\ns2 bob 2026-11-05T08:00:00Z 2026-11-06T08:00:00Z/2026-11-06T09:00:00Z\n"
        + "s1 alice now\ns2 bob now\ns3 bob now\ns3 bob now");
  }

  @Test
  void anEndpointRequestCarriesItsSessionsTimeOnlyForItsOwnUserAndATemporalPlugin() {
    install("temporal", manifest("temporal", TEMPORAL, "\"temporal\"", false, "ok"))
        .install("webs", manifest("webs", PluginFolders.ENTRY_CLASS, "\"temporal\"", true, "ok"));
    start();
    UserTimes times = host.userTimes();
    times.started("s1", ALICE_SESSION);
    times.changed("s1", UserTime.at(Instant.parse("2026-11-06T08:00:00Z")));

    assertThat(get("temporal", "/time", session("s1"), ALICE)).isEqualTo("200 2026-11-06T08:00:00Z");
    assertThat(get("temporal", "/time", session("s1"), BOB)).as("another user's session").isEqualTo("200 now");
    assertThat(get("temporal", "/time", session("s9"), ALICE)).as("no such session").isEqualTo("200 now");
    assertThat(get("temporal", "/time", Headers.empty(), ALICE)).as("no header").isEqualTo("200 now");
    assertThat(host.userTimes().timeFor("webs", "s1", ALICE)).as("its server part is not temporal").isEqualTo(UserTime.now());
    times.ended("s1");
    assertThat(get("temporal", "/time", session("s1"), ALICE)).isEqualTo("200 now");
  }

  @Test
  void aMapperThatThrowsDegradesThePlugin() {
    install("faulty", manifest("faulty", TEMPORAL, "\"temporal\"", false, "mapper-throws"));
    start();

    host.userTimes().started("s1", ALICE_SESSION);

    assertThat(statuses.of("faulty").state().name()).isEqualTo("DEGRADED");
    assertThat(reason("faulty")).contains("delivering a session's time failed").contains("the mapper fails on purpose");
  }
}
