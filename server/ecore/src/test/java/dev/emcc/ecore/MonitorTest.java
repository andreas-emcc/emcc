package dev.emcc.ecore;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.monitor.MonitorSnapshot;
import dev.emcc.ecore.plugin.PluginFolders;
import dev.emcc.ecore.plugin.PluginHost;
import dev.emcc.ecore.plugin.PluginManifest;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.store.ChangeOutcome;
import dev.emcc.ecore.store.Requester;
import dev.emcc.ecore.store.StoreMsg;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.LayerContent;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.locks.LockSupport;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The monitor view's snapshot of the core and the plugins (overview 4.10). */
class MonitorTest {

  @Test
  void aConnectionTaskGoesToTheBrowserWithTheNamesAndNullsTheViewReads() throws Exception {
    var task = new dev.emcc.ecore.plugin.PluginHost.TaskStatus("cot", 7, "tak-north", "RUNNING", 5_000, 2, null, null,
        "/127.0.0.1:4242", null, java.util.Map.of("received", 12L), java.util.Map.of("protocol", "CoT 2.0"), null, false, 3, 0, 1);

    tools.jackson.databind.JsonNode json = new tools.jackson.databind.ObjectMapper().valueToTree(task);

    assertThat(json.propertyNames()).containsExactlyInAnyOrder("plugin", "id", "name", "state", "sinceMillis", "restarts", "nextMillis",
        "reason", "listening", "peer", "counters", "details", "lastActivityMillis", "notEnding", "queued", "lost", "coalesced");
    assertThat(json.get("nextMillis").isNull()).as("null, not left out (api.ts)").isTrue();
    assertThat(json.get("peer").isNull()).isTrue();
    assertThat(json.at("/counters/received").asLong()).isEqualTo(12);
    var channel = new dev.emcc.ecore.plugin.PluginHost.ChannelStatus("cot", "tak-north", "TAK North (out)", "cot", "NOT_SENDING", "No destination", true, java.util.List.of(), 9, 2, 6, 1, 1, 0);
    assertThat(new tools.jackson.databind.ObjectMapper().valueToTree(channel).propertyNames()).as("api.ts MonitorChannel")
        .containsExactlyInAnyOrder("plugin", "link", "name", "outputType", "state", "stateDetail", "canDelete", "declaredKinds", "sent", "replaced", "delivered",
            "dropped", "pending", "inFlight");
    var declared = new dev.emcc.ecore.plugin.PluginManifest.Connection(java.util.List.of("udp"), "in", null, "Receives.");
    assertThat(new tools.jackson.databind.ObjectMapper().valueToTree(declared).propertyNames())
        .containsExactlyInAnyOrder("kinds", "direction", "settings", "reason");
    var folder = new dev.emcc.ecore.plugin.PluginHost.FolderStatus("terrain", "heights", "Height data.", "/heightDataFolder", null, null, "NOT_SET");
    tools.jackson.databind.JsonNode folderJson = new tools.jackson.databind.ObjectMapper().valueToTree(folder);
    assertThat(folderJson.propertyNames()).as("api.ts MonitorFolder").containsExactlyInAnyOrder("plugin", "id", "reason", "setting", "path", "resolved", "state"); // resolved: SDK 1.6.0
    assertThat(folderJson.get("path").isNull()).as("null, not left out").isTrue();
    // SDK 1.9.0 (ADR-0064 point 5): a plugin's compute threads and one task, as api.ts MonitorCompute and MonitorComputeTask
    var computeTask = new dev.emcc.ecore.plugin.PluginComputes.TaskStatus(7, "camera-north", "RUNNING", 1, 0, null, null, java.util.Map.of("rendered", 3L),
        java.util.Map.of(), false, 12, 40, 30, new dev.emcc.ecore.runtime.Inbox.Counters(0, 3, 0, 0, 0));
    var compute = new dev.emcc.ecore.plugin.PluginComputes.Status(2, "renders cameras.", 1, 1, java.util.Map.of("TOTAL_CAP", 1L), List.of(computeTask));
    tools.jackson.databind.JsonNode computeJson = new tools.jackson.databind.ObjectMapper().valueToTree(compute);
    assertThat(computeJson.propertyNames()).containsExactlyInAnyOrder("declared", "reason", "allowed", "running", "refusals", "tasks");
    assertThat(computeJson.get("tasks").get(0).propertyNames()).containsExactlyInAnyOrder("id", "name", "state", "sinceMillis", "restarts",
        "nextMillis", "reason", "counters", "details", "hung", "cpuMillis", "runMillis", "waitMillis", "inbox");
    assertThat(computeJson.at("/tasks/0/inbox").propertyNames()).containsExactlyInAnyOrder("queued", "accepted", "dropped", "evicted", "coalesced");
    assertThat(new tools.jackson.databind.ObjectMapper().valueToTree(new MonitorSnapshot.Compute(7, 1)).propertyNames())
        .containsExactlyInAnyOrder("cap", "held");
  }

  @TempDir Path data;
  @TempDir Path plugins;

  @Test
  void aSnapshotShowsTheCoreThePluginsTheirCapsAndEveryWorker() {
    new PluginFolders(plugins).plugin("alpha").install("online", PluginFolders.manifest("online", "^1.0.0", PluginFolders.ENTRY_CLASS,
        "ok", List.of(), false).replace("\"required\": false,",
        "\"required\": false, \"internet\": {\"hosts\": [\"tiles.example.org\"], \"reason\": \"Demos only.\"},"), true);
    try (ECore core = new ECore(ECoreConfig.defaults().dataDirectory(data).pluginsDirectory(plugins))) {
      core.start();

      MonitorSnapshot s = core.monitor().snapshot();

      assertThat(s.core().state()).isEqualTo("RUNNING");
      assertThat(s.core().layers()).as("the Drawing layer").isEqualTo(1);
      assertThat(s.core().objects()).isZero();
      assertThat(s.core().sequenceNo()).isEqualTo(1);
      assertThat(s.core().liveSessions()).isZero();
      assertThat(s.core().jvm().heapUsed()).isPositive();
      assertThat(s.core().jvm().processors()).isPositive();
      assertThat(s.core().jvm().allocation().totalBytes()).isPositive();
      assertThat(s.core().jvm().allocation().sampling()).as("off by default (T-148)").isFalse();
      assertThat(s.coreWorkers()).extracting(w -> w.owner() + "/" + w.name())
          .contains("core-store/object-store", "core-persistence/persistence", "core-expiry/expiry");
      assertThat(s.plugins()).extracting(MonitorSnapshot.Plugin::id).containsExactly("alpha", "online");
      assertThat(s.plugins().get(1).internet()).as("declared, not enforced (ADR-0030)")
          .isEqualTo(new PluginManifest.Internet(List.of("tiles.example.org"), "Demos only."));
      assertThat(s.plugins()).first().satisfies(p -> {
        assertThat(p.id()).isEqualTo("alpha");
        assertThat(p.active()).isTrue();
        assertThat(p.state()).isEqualTo("OK");
        assertThat(p.workers()).extracting(MonitorSnapshot.Worker::name).contains("info", "follower");
        assertThat(p.workers()).allSatisfy(w -> assertThat(w.owner()).isEqualTo("alpha"));
        assertThat(p.caps().maxAsks()).isEqualTo(PluginHost.DEFAULT_LIMITS.outstandingAsks());
        assertThat(p.caps().maxTimers()).isEqualTo(PluginHost.DEFAULT_LIMITS.activeTimers());
        assertThat(p.caps().refusedAsks()).isZero();
        assertThat(p.listeners()).isEmpty();
        assertThat(p.internet()).as("declares none").isNull();
      });
      assertThat(s.coreWorkers()).noneMatch(w -> w.owner().equals("alpha"));
    }
  }

  @Test
  void listsTheTlsCredentialsWithTheirCertificatesExpiryAndWhyOneCannotBeRead() throws Exception { // ADR-0062 point 4, M9 C3
    Path keys = data.resolve("keys");
    java.nio.file.Files.createDirectories(keys);
    Process p = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", "keytool").toString(), "-genkeypair", "-alias", "c",
        "-keyalg", "RSA", "-keysize", "2048", "-dname", "CN=emcc-client", "-validity", "10", "-storetype", "PKCS12", "-keystore",
        "client.p12", "-storepass", "test-only-1").directory(keys.toFile()).redirectErrorStream(true).start();
    String output = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    assertThat(p.waitFor()).as(output).isZero();
    var store = new dev.emcc.ecore.plugin.TlsCredentials.Store(keys.resolve("client.p12"), dev.emcc.ecore.plugin.TlsCredentials.StoreType.PKCS12,
        "test-only-1");
    var listeners = new dev.emcc.ecore.plugin.ListenerConfig(10, java.util.Map.of(
        "tak", new dev.emcc.ecore.plugin.TlsCredentials("emc2.tls.tak", store, new dev.emcc.ecore.plugin.TlsCredentials.KeyStoreIdentity(store)),
        "broken", new dev.emcc.ecore.plugin.TlsCredentials("emc2.listeners.credentials.broken", new dev.emcc.ecore.plugin.TlsCredentials.Store(
            keys.resolve("client.p12"), dev.emcc.ecore.plugin.TlsCredentials.StoreType.PKCS12, "wrong"), null)));
    try (ECore core = new ECore(ECoreConfig.defaults().dataDirectory(data).listeners(listeners))) {
      core.start();
      List<MonitorSnapshot.TlsCredential> tls = core.monitor().snapshot().core().tls();

      assertThat(tls).extracting(MonitorSnapshot.TlsCredential::name).containsExactly("broken", "tak");
      assertThat(tls.get(0).error()).isEqualTo("emc2.listeners.credentials.broken.trust-store cannot be read: the password is wrong");
      assertThat(tls.get(0).setting()).isEqualTo("emc2.listeners.credentials.broken");
      assertThat(tls.get(1).error()).isNull();
      assertThat(tls.get(1).identity()).singleElement().satisfies(c -> {
        assertThat(c.subject()).isEqualTo("CN=emcc-client");
        assertThat(c.issuer()).isEqualTo("CN=emcc-client");
        assertThat(c.state()).as("within 30 days").isEqualTo("soon");
      });
      assertThat(tls.get(1).trusted()).hasSize(1);
      assertThat(tls.toString()).doesNotContain("test-only-1").doesNotContain("client.p12");
    }
  }

  @Test
  void theStoreCountsFollowEveryChangeWithoutAskingTheStore() {
    try (ECore core = new ECore(ECoreConfig.defaults().dataDirectory(data))) {
      core.start();
      long processed = storeProcessed(core.monitor().snapshot());

      LayerContent content = new LayerContent("Second", 1, true, ECoreConfig.defaults().defaultLabel(), Extensions.empty());
      FutureReply<ChangeOutcome> reply = new FutureReply<>();
      core.objectStore().send(new StoreMsg.Apply(ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), content, ECore.CORE), Requester.NO_USER, reply));
      assertThat(reply.await(Duration.ofSeconds(10))).isInstanceOf(ChangeOutcome.Applied.class);

      MonitorSnapshot s = core.monitor().snapshot();
      assertThat(s.core().layers()).isEqualTo(2);
      assertThat(s.core().sequenceNo()).isEqualTo(2);
      assertThat(storeProcessed(s)).isGreaterThan(processed);
    }
  }

  @Test
  void aPluginsListenerShowsWithItsEndpointAndWhetherItIsConnected() throws Exception {
    try (ServerSocket tak = new ServerSocket(0, 10, InetAddress.getLoopbackAddress())) {
      tak.setSoTimeout((int) Probe.WAIT.toMillis());
      new PluginFolders(plugins).install("streams", """
          {"id": "streams", "name": "Streams", "version": "0.1.0", "sdkVersion": "^1.0.0", "kind": "general",
           "server": {"entryClass": "%s"},
           "network": {"endpoints": ["/servers"], "reason": "a test peer"},
           "settings": {"type": "object", "properties": {
             "mode": {"type": "string", "default": "listen"},
             "servers": {"type": "array", "default": [{"host": "127.0.0.1", "port": %d}],
               "items": {"type": "object", "properties": {"host": {"type": "string"}, "port": {"type": "integer"}}}}}}}
          """.formatted(PluginFolders.ENTRY_CLASS, tak.getLocalPort()), true);
      try (ECore core = new ECore(ECoreConfig.defaults().dataDirectory(data).pluginsDirectory(plugins))) {
        core.start();
        try (Socket peer = tak.accept()) {
          peer.getOutputStream().write("hello".getBytes(StandardCharsets.UTF_8));
          PluginHost.ListenerStatus listener = until(core, l -> l.connected() && l.bytesRead() == 5);

          assertThat(listener.name()).isEqualTo("tak");
          assertThat(listener.host() + ":" + listener.port()).isEqualTo("127.0.0.1:" + tak.getLocalPort());
          assertThat(listener.reconnects()).isZero();
        }
      }
    }
  }

  /** The streams plugin's one listener, once it matches (the loop runs on its own thread). */
  private static PluginHost.ListenerStatus until(ECore core, java.util.function.Predicate<PluginHost.ListenerStatus> condition) {
    long deadline = System.nanoTime() + Probe.WAIT.toNanos();
    while (true) {
      MonitorSnapshot.Plugin streams = core.monitor().snapshot().plugins().stream()
          .filter(p -> p.id().equals("streams")).findFirst().orElseThrow();
      if (streams.listeners().size() == 1 && condition.test(streams.listeners().getFirst())) {
        return streams.listeners().getFirst();
      }
      assertThat(System.nanoTime() - deadline).as("the listener did not show as expected: " + streams.listeners()).isNegative();
      LockSupport.parkNanos(10_000_000);
    }
  }

  private static long storeProcessed(MonitorSnapshot s) {
    return s.coreWorkers().stream().filter(w -> w.name().equals("object-store")).findFirst().orElseThrow().processed();
  }
}
