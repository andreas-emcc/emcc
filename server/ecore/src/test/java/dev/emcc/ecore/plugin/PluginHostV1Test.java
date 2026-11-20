package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.json.Problem;
import dev.emcc.ecore.persistence.ConfigStore;
import dev.emcc.ecore.persistence.Configuration;
import dev.emcc.ecore.persistence.PluginDocumentStore;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.Topic;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.ecore.store.DataTypes;
import dev.emcc.ecore.store.DeclaredFields;
import dev.emcc.ecore.store.Workspaces;
import dev.emcc.sdk.DataType;
import dev.emcc.sdk.DeclaredField;
import dev.emcc.sdk.Permissions;
import dev.emcc.sdk.PluginStatus;
import dev.emcc.sdk.User;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.FieldRef;
import dev.emcc.sdk.model.SecurityLabel;
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

/** The plugin host's SDK v1 parts: manifest checks, data types and settings (T-038 step 4). */
class PluginHostV1Test {

  private static final ModelJson JSON = new ModelJson();
  private static final String MODE = "\"mode\": {\"type\": \"string\", \"default\": \"ok\"}";
  private static final User ADMIN = User.of("admin", "Admin", Set.of(Permissions.SETTINGS_ADMIN));

  @TempDir Path plugins;
  @TempDir Path data;

  private final PluginStatuses statuses = new PluginStatuses();
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().listener(statuses));
  private final Probe<String> events = new Probe<>();
  private final DataTypes dataTypes = new DataTypes();
  private final List<PluginHost> hosts = new ArrayList<>();
  private PluginHost host;

  @AfterEach
  void close() {
    hosts.forEach(PluginHost::stop);
    runtime.close();
  }

  /** A test plugin's manifest with {@code more} fields and these settings properties. */
  private static String manifest(String id, String more, String settingsProperties) {
    return """
        {"id": "%s", "name": "Test plugin %s", "version": "0.1.0", "sdkVersion": "^1.0.0", "kind": "general",
         "server": {"entryClass": "%s"}%s,
         "settings": {"type": "object", "properties": {%s}}}
        """.formatted(id, id, PluginFolders.ENTRY_CLASS, more.isEmpty() ? "" : ", " + more, settingsProperties);
  }

  private PluginHostV1Test install(String id, String manifest) {
    new PluginFolders(plugins).install(id, manifest, true);
    return this;
  }

  private PluginHost start() {
    return start(new DataTypes());
  }

  private PluginHost start(DataTypes types) {
    return start(types, new DeclaredFields());
  }

  private PluginHost start(DataTypes types, DeclaredFields fields) {
    return start(types, fields, new Workspaces());
  }

  private PluginHost start(DataTypes types, DeclaredFields fields, Workspaces workspaces) {
    host = new PluginHost(plugins, runtime, statuses, SecurityLabel.of("NATO", "UNCLASSIFIED"), JSON, PluginHost.DEFAULT_LIMITS,
        Duration.ofSeconds(2), new PluginHost.Services(null, new PluginDocumentStore(data, JSON), types,
            new Configuration(new ConfigStore(data, JSON)), ListenerConfig.DEFAULT, PluginHost.DEFAULT_CLASSIFICATION_ORDERS,
            PluginHost.DEFAULT_MAX_CHANNELS, fields, workspaces));
    hosts.add(host);
    host.start();
    return host;
  }

  private void listenTo(String id) {
    WorkerHandle<PluginStatus> recorder = runtime.owner("core-test").spawn(
        WorkerOptions.<PluginStatus>of("recorder-" + id, () -> (status, ctx) -> events.add(status.detail())));
    runtime.owner("core-test").subscribe(Topic.of(id + ".events", PluginStatus.class), recorder, s -> s);
  }

  private String get(String pluginId, String path) {
    Probe<HttpReply> reply = new Probe<>();
    host.endpoints().dispatch(
        new PluginEndpoints.Request(pluginId, "GET", path, Map.of(), Headers.empty(), User.noLoginUser()), reply::add);
    HttpReply r = reply.next();
    return r.status() + " " + r.body().toUtf8();
  }

  private String state(String id) {
    PluginHost.PluginInfo info = host.plugins().stream().filter(p -> p.id().equals(id)).findFirst().orElseThrow();
    return (info.active() ? "active " : "disabled ") + info.status().state();
  }

  private static JsonObject mode(String value) {
    return JsonObject.of(Map.of("mode", JsonString.of(value)));
  }

  // ---- Connection tasks (ADR-0036; the SDK's Connections comes with SDK 1.2.0 part 2) ----------

  @Test
  void eachPluginHasItsConnectionTasksWithTheConfiguredCapAndTheyStopWithIt() throws InterruptedException {
    install("alpha", manifest("alpha", "", MODE));
    start();
    TaskEngine tasks = host.tasks("alpha");
    assertThat(tasks).isNotNull();
    assertThat(tasks.maxTasks()).isEqualTo(ListenerConfig.DEFAULT_MAX_TASKS);
    assertThat(host.tasks("unknown")).isNull();
    java.util.concurrent.CountDownLatch running = new java.util.concurrent.CountDownLatch(1);
    tasks.start("tak-in", null, new dev.emcc.ecore.runtime.Inbox<String>(10, dev.emcc.ecore.runtime.Overflow.DROP_NEWEST),
        TaskEngine.RestartRule.never(), () -> attempt -> {
          running.countDown();
          attempt.take();
        }, change -> {});
    assertThat(running.await(10, java.util.concurrent.TimeUnit.SECONDS)).isTrue();

    host.stop();

    long end = System.nanoTime() + Duration.ofSeconds(10).toNanos();
    while (!tasks.stats().isEmpty()) {
      assertThat(System.nanoTime()).as("the task stopped with its plugin").isLessThan(end);
      Thread.sleep(20);
    }
    assertThat(host.tasks("alpha")).as("released").isNull();
  }

  @Test
  void aConnectionTaskThatDoesNotEndAfterItsStopMakesThePluginDegraded() throws Exception {
    install("alpha", manifest("alpha", "", MODE));
    start();
    TaskEngine tasks = host.tasks("alpha");
    assertThat(tasks).isNotNull();
    java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.CountDownLatch running = new java.util.concurrent.CountDownLatch(1);
    TaskEngine.Task stuck = tasks.start("stuck", null, new dev.emcc.ecore.runtime.Inbox<String>(10, dev.emcc.ecore.runtime.Overflow.DROP_NEWEST),
        TaskEngine.RestartRule.never(), () -> attempt -> {
          running.countDown();
          release.await(); // registered nothing a close would end
        }, change -> {});
    assertThat(running.await(10, java.util.concurrent.TimeUnit.SECONDS)).isTrue();

    stuck.stop();

    long end = System.nanoTime() + Duration.ofSeconds(15).toNanos();
    while (!state("alpha").equals("active DEGRADED")) {
      assertThat(System.nanoTime()).as("degraded within 15 s").isLessThan(end);
      Thread.sleep(50);
    }
    assertThat(statuses.of("alpha").detail()).isEqualTo("connection task stuck did not end within 5 s after its stop");
    release.countDown();
  }

  @Test
  void aPluginsConnectionTaskRunsInItsClassLoaderSendsToItsWorkersAndStopsWithIt() throws Exception {
    try (java.net.ServerSocket peer = new java.net.ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())) {
      install("conn", manifest("conn", "\"connections\": [{\"kinds\": [\"tcp-client\"], \"direction\": \"in\", "
          + "\"settings\": \"/port\", \"reason\": \"Reads a line.\"}]", "\"mode\": {\"type\": \"string\", \"default\": \"connect\"}, "
          + "\"port\": {\"type\": \"integer\", \"default\": " + peer.getLocalPort() + "}"));
      listenTo("conn");
      start();

      try (java.net.Socket accepted = peer.accept()) {
        accepted.getOutputStream().write("hello\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        accepted.getOutputStream().flush();

        assertThat(events.next(3)).containsExactlyInAnyOrder("started conn", "task Running echo in conn",
            "received hello on plugin-conn conn");
        assertThat(state("conn")).isEqualTo("active OK");
        TaskEngine tasks = host.tasks("conn");
        assertThat(tasks).isNotNull();
        assertThat(tasks.stats()).singleElement().satisfies(t -> {
          assertThat(t.name()).isEqualTo("echo");
          assertThat(t.counters()).containsEntry("received", 1L);
          assertThat(t.peer()).isIn("127.0.0.1:" + peer.getLocalPort() + " (localhost)", "[::1]:" + peer.getLocalPort() + " (localhost)");
        });
        assertThat(host.connectionTasks()).singleElement().satisfies(t -> { // as the monitor gets it
          assertThat(t.plugin()).isEqualTo("conn");
          assertThat(t.name()).isEqualTo("echo");
          assertThat(t.state()).isEqualTo("RUNNING");
          assertThat(t.counters()).containsEntry("received", 1L);
          assertThat(t.lastActivityMillis()).isNotNull();
        });
        assertThat(host.health()).filteredOn(h -> h.id().equals("conn")).singleElement()
            .satisfies(h -> assertThat(h.connections()).singleElement().satisfies(c -> assertThat(c.reason()).isEqualTo("Reads a line.")));

        host.stop();

        accepted.setSoTimeout(10_000);
        assertThat(accepted.getInputStream().read()).as("the task's socket was closed").isEqualTo(-1);
        assertThat(tasks.stats()).isEmpty();
      }
    }
  }

  @Test
  void aPluginsChannelReachesItsWorkerInItsClassLoaderAndIsWithdrawnWhenItStops() {
    install("chan", manifest("chan", "", "\"mode\": {\"type\": \"string\", \"default\": \"channel\"}"));
    listenTo("chan");
    start();

    assertThat(events.next(3)).containsExactlyInAnyOrder("started chan", "item Removal on plugin-chan chan",
        "classifications {NATO=[UNCLASSIFIED, RESTRICTED, CONFIDENTIAL, SECRET, COSMIC TOP SECRET]} chan");
    assertThat(host.channels()).singleElement().satisfies(c -> { // as the monitor gets it
      assertThat(c.plugin()).isEqualTo("chan");
      assertThat(c.link()).isEqualTo("loop");
      assertThat(c.name()).isEqualTo("Loop");
      assertThat(c.outputType()).isEqualTo("test");
      assertThat(c.canDelete()).isFalse();
      assertThat(c.sent()).isEqualTo(1);
      assertThat(c.delivered()).isEqualTo(1);
    });

    host.stop();

    assertThat(host.channels()).isEmpty();
  }

  // ---- Declared fields (SDK 1.2.0, ADR-0038) ---------------------------------------------------

  private static final String CALLSIGN = """
      {"name": "callsign", "type": "text", "label": "Callsign", "maxLength": 64, "editableByOthers": true, "dataTypes": ["core.general"]}""";
  private static final String ROLE = """
      {"name": "role", "type": "choice", "label": "Role", "description": "Its role in the team.", "required": true,
       "choices": [{"value": "hq", "label": "HQ"}, {"value": "team-member", "label": "Team member"}]}""";
  private static final String SPEED = """
      {"name": "speed", "type": "number", "label": "Speed", "unit": "m/s", "minimum": 0, "maximum": 340.5}""";

  @Test
  void theDeclaredFieldsAreFixedFromTheManifestsOfThePluginsThatMayStartAndPluginsSeeThem() {
    install("alpha", manifest("alpha", "\"fields\": [" + CALLSIGN + ", " + ROLE + "]", MODE))
        .install("beta", manifest("beta", "\"dependsOn\": [\"alpha\"], \"fields\": [" + SPEED + "]", MODE))
        .install("gamma", manifest("gamma", "\"dependsOn\": [\"nobody\"], \"fields\": [" + SPEED + "]", MODE));
    DeclaredFields checks = new DeclaredFields();

    start(dataTypes, checks);

    assertThat(host.declaredFields()).extracting(f -> f.plugin() + "." + f.name()).containsExactly("alpha.callsign", "alpha.role", "beta.speed");
    assertThat(host.declaredFields().get(1)).isEqualTo(new DeclaredField("alpha", "role", DeclaredField.Type.CHOICE, "Role",
        "Its role in the team.", null, null, null, null, true,
        List.of(new DeclaredField.Choice("hq", "HQ"), new DeclaredField.Choice("team-member", "Team member")), false, List.of()));
    assertThat(checks.get(new FieldRef("beta", "speed"))).as("the store's checks are fixed too").satisfies(f -> {
      assertThat(f.editableByOthers()).isFalse();
      assertThat(f.problem().apply(JsonNumber.of(341))).isEqualTo("Speed is above 340.5 m/s");
    });
    assertThat(checks.get(new FieldRef("gamma", "speed"))).as("gamma cannot start").isNull();
    assertThat(get("beta", "/info/declared-fields")).isEqualTo("200 alpha.callsign,alpha.role,beta.speed");
  }

  @Test
  void browsersGetTheDeclaredFieldsWithTheOptionalMembersOnlyWhenTheySaySomething() {
    install("alpha", manifest("alpha", "\"fields\": [" + CALLSIGN + ", " + ROLE + ", " + SPEED + "]", MODE));

    start(dataTypes);

    assertThat(host.declaredFieldsJson().toString()).isEqualTo("["
        + "{\"plugin\":\"alpha\",\"name\":\"callsign\",\"type\":\"text\",\"label\":\"Callsign\",\"maxLength\":64,"
        + "\"editableByOthers\":true,\"dataTypes\":[\"core.general\"]},"
        + "{\"plugin\":\"alpha\",\"name\":\"role\",\"type\":\"choice\",\"label\":\"Role\",\"description\":\"Its role in the team.\","
        + "\"required\":true,\"choices\":[{\"value\":\"hq\",\"label\":\"HQ\"},{\"value\":\"team-member\",\"label\":\"Team member\"}]},"
        + "{\"plugin\":\"alpha\",\"name\":\"speed\",\"type\":\"number\",\"label\":\"Speed\",\"unit\":\"m/s\",\"minimum\":0,"
        + "\"maximum\":340.5}]");
  }

  @Test
  void aFieldDeclaredTwiceOrAgainstItsOwnLimitsRefusesThePlugin() {
    install("alpha", manifest("alpha", "\"fields\": [" + SPEED + ", " + SPEED + "]", MODE))
        .install("beta", manifest("beta", """
            "fields": [{"name": "speed", "type": "number", "label": "Speed", "minimum": 10, "maximum": 5}]""", MODE))
        .install("gamma", manifest("gamma", "\"dependsOn\": [\"alpha\"], \"fields\": [" + CALLSIGN + "]", MODE));

    start(dataTypes);

    assertThat(state("alpha")).isEqualTo("disabled FAILED");
    assertThat(statuses.of("alpha").detail()).isEqualTo("the field speed is declared twice");
    assertThat(statuses.of("beta").detail()).isEqualTo("invalid plugin.json: /fields/0: minimum is above maximum: speed");
    assertThat(statuses.of("gamma").detail()).startsWith("depends on alpha");
    assertThat(host.declaredFields()).as("a plugin that cannot start declares nothing").isEmpty();
  }

  // ---- Field sets and relation kinds (SDK 1.4.0, ADR-0050, ADR-0051) --------------------------

  private static final String PAIRING = """
      {"id": "%s", "label": "GMTI Pairing", "line": {"strokeColor": "#FFFF00"}}""";

  @Test
  void theFieldSetsAndRelationKindsAreFixedFromThePluginsThatMayStartAndPluginsAndBrowsersSeeThem() {
    install("alpha", manifest("alpha", "\"fields\": [" + CALLSIGN + ", " + ROLE + "], "
            + "\"fieldSets\": [{\"id\": \"unit\", \"label\": \"Unit\", \"fields\": [\"role\", \"callsign\"]}], "
            + "\"relationKinds\": [" + PAIRING.formatted("alpha.pairing") + ", {\"id\": \"alpha.lead\", \"label\": \"Leads\", "
            + "\"line\": {\"strokeColor\": \"#00ff00\", \"strokeWidth\": 2.5, \"strokeDash\": \"dot\", \"arrowhead\": \"end\"}, \"defaultOn\": true}]", MODE))
        .install("beta", manifest("beta", "\"dependsOn\": [\"alpha\"], \"fields\": [" + SPEED + "], "
            + "\"fieldSets\": [{\"id\": \"motion\", \"label\": \"Motion\", \"fields\": [\"speed\"]}]", MODE))
        .install("gamma", manifest("gamma", "\"dependsOn\": [\"nobody\"], \"relationKinds\": [" + PAIRING.formatted("gamma.pairing") + "]", MODE));
    DeclaredFields checks = new DeclaredFields();

    start(dataTypes, checks);

    assertThat(host.fieldSets()).extracting(dev.emcc.sdk.FieldSet::id).containsExactly("alpha.unit", "beta.motion");
    assertThat(host.fieldSets().getFirst().fields()).as("in the manifest's order").containsExactly("role", "callsign");
    assertThat(host.relationKinds()).extracting(dev.emcc.sdk.RelationKind::id).containsExactly("alpha.pairing", "alpha.lead");
    assertThat(checks.isFieldSet("beta.motion")).isTrue();
    assertThat(checks.isRelationKind("alpha.lead")).isTrue();
    assertThat(checks.isRelationKind("gamma.pairing")).as("gamma cannot start").isFalse();
    assertThat(get("beta", "/info/field-sets")).isEqualTo("200 alpha.unit,beta.motion");
    assertThat(get("beta", "/info/relation-kinds")).isEqualTo("200 alpha.pairing,alpha.lead");
    assertThat(host.fieldSetsJson().toString()).isEqualTo("["
        + "{\"id\":\"alpha.unit\",\"plugin\":\"alpha\",\"name\":\"unit\",\"label\":\"Unit\",\"fields\":[\"role\",\"callsign\"]},"
        + "{\"id\":\"beta.motion\",\"plugin\":\"beta\",\"name\":\"motion\",\"label\":\"Motion\",\"fields\":[\"speed\"]}]");
    assertThat(host.relationKindsJson().toString()).as("the line's defaults filled in").isEqualTo("["
        + "{\"id\":\"alpha.pairing\",\"label\":\"GMTI Pairing\",\"line\":{\"strokeColor\":\"#FFFF00\",\"strokeWidth\":1.0,"
        + "\"strokeDash\":\"solid\",\"arrowhead\":\"none\"},\"defaultOn\":false},"
        + "{\"id\":\"alpha.lead\",\"label\":\"Leads\",\"line\":{\"strokeColor\":\"#00ff00\",\"strokeWidth\":2.5,"
        + "\"strokeDash\":\"dot\",\"arrowhead\":\"end\"},\"defaultOn\":true}]");
  }

  @Test
  void aRelationLinesColourSettingIsKeptForTheShellAndRepeatedPaletteIdsRefuseThePlugin() { // SDK 1.6.0, CR-0041 parts C and G
    String palette = """
        {"id": "%s", "name": "Units", "symbols": [{"standard": "APP-6D", "code": "10031000001211000000"}]}""";
    install("alpha", manifest("alpha", "\"relationKinds\": [" + PAIRING.formatted("alpha.pairing").replace("\"#FFFF00\"",
            "\"#FFFF00\", \"strokeColorSetting\": \"/pairingColour\"") + "], \"symbolPalettes\": [" + palette.formatted("units") + ", "
            + palette.formatted("cot") + "]", MODE))
        .install("beta", manifest("beta", "\"symbolPalettes\": [" + palette.formatted("units") + ", " + palette.formatted("units") + "]", MODE));

    start(dataTypes);

    assertThat(state("alpha")).isEqualTo("active OK");
    assertThat(host.relationKindsJson().toString()).isEqualTo("[{\"id\":\"alpha.pairing\",\"label\":\"GMTI Pairing\",\"line\":{"
        + "\"strokeColor\":\"#FFFF00\",\"strokeWidth\":1.0,\"strokeDash\":\"solid\",\"arrowhead\":\"none\",\"strokeColorSetting\":\"/pairingColour\"},"
        + "\"defaultOn\":false}]");
    assertThat(state("beta")).isEqualTo("disabled FAILED");
    assertThat(statuses.of("beta").detail()).isEqualTo("the symbol palette units is declared twice");
  }

  @Test
  void aBadFieldSetOrRelationKindRefusesThePlugin() {
    install("alpha", manifest("alpha", "\"fields\": [" + CALLSIGN + "], "
            + "\"fieldSets\": [{\"id\": \"unit\", \"label\": \"Unit\", \"fields\": [\"callsign\", \"role\"]}]", MODE))
        .install("beta", manifest("beta", "\"fields\": [" + CALLSIGN + "], \"fieldSets\": ["
            + "{\"id\": \"unit\", \"label\": \"Unit\", \"fields\": [\"callsign\"]}, {\"id\": \"unit\", \"label\": \"Again\", \"fields\": [\"callsign\"]}]", MODE))
        .install("gamma", manifest("gamma", "\"relationKinds\": [" + PAIRING.formatted("gmti.pairing") + "]", MODE))
        .install("delta", manifest("delta", "\"relationKinds\": [" + PAIRING.formatted("delta.pairing") + ", "
            + PAIRING.formatted("delta.pairing").replace("GMTI", "Other") + "]", MODE));

    start(dataTypes);

    assertThat(statuses.of("alpha").detail()).isEqualTo("the field set alpha.unit names role, which is not among the plugin's fields");
    assertThat(statuses.of("beta").detail()).isEqualTo("the field set beta.unit is declared twice");
    assertThat(statuses.of("gamma").detail()).isEqualTo("the relation kind gmti.pairing must start with the plugin's id: gamma.");
    assertThat(statuses.of("delta").detail()).isEqualTo("the relation kind delta.pairing is declared twice");
    assertThat(host.fieldSets()).isEmpty();
    assertThat(host.relationKinds()).isEmpty();
  }

  @Test
  void theInvalidByRuleManifestExampleIsRefused() throws Exception {
    install("cot", java.nio.file.Files.readString(java.nio.file.Path.of("../../model/examples/invalid-by-rule/rule-18-manifest-field-set-unknown-field.json")));

    start(dataTypes);

    assertThat(statuses.of("cot").detail()).isEqualTo("the field set cot.unit names remarks, which is not among the plugin's fields");
  }

  // ---- A data type's field sets (SDK 1.5.0, CR-0038, model rules 20 and 21) -------------------

  @Test
  void aDataTypeNamesItsPluginsSetsWhichTheStoreAndBrowsersGetAsFullIdsAndWhetherItIsMadeByHand() {
    install("alpha", manifest("alpha", "\"fields\": [" + CALLSIGN + ", " + ROLE + "], "
        + "\"fieldSets\": [{\"id\": \"unit\", \"label\": \"Unit\", \"fields\": [\"role\"]}, "
        + "{\"id\": \"call\", \"label\": \"Call\", \"fields\": [\"callsign\"]}], "
        + "\"dataTypes\": [{\"id\": \"alpha.track\", \"name\": \"Track\", \"fieldSets\": [\"call\", \"unit\"]}, "
        + "{\"id\": \"alpha.plot\", \"name\": \"Plot\", \"manual\": false}]", MODE));

    start(dataTypes);

    assertThat(host.dataTypes().get(1).fieldSets()).as("full ids, in the data type's order").containsExactly("alpha.call", "alpha.unit");
    assertThat(host.dataTypes().get(1).manual()).as("by default").isTrue();
    assertThat(host.dataTypes().get(2).fieldSets()).isEmpty();
    assertThat(host.dataTypes().get(2).manual()).isFalse();
    assertThat(dataTypes.fieldSets("alpha.track")).as("what the store adds (rule 21)").containsExactly("alpha.call", "alpha.unit");
    assertThat(dataTypes.fieldSets("core.general")).isEmpty();
    assertThat(host.dataTypesJson().get(1).get("fieldSets").toString()).isEqualTo("[\"alpha.call\",\"alpha.unit\"]");
    assertThat(host.dataTypesJson().get(1).get("manual").booleanValue()).isTrue();
    assertThat(host.dataTypesJson().get(2).get("fieldSets").toString()).isEqualTo("[]");
    assertThat(host.dataTypesJson().get(2).get("manual").booleanValue()).isFalse();
  }

  @Test
  void aDataTypeSaysWhetherItsObjectsAreSensorReportsAndBrowsersGetIt() {
    // SDK 1.5.0 part 3 (CR-0039 point 6; T-151): absent means false
    install("alpha", manifest("alpha", "\"dataTypes\": [{\"id\": \"alpha.track\", \"name\": \"Track\"}, "
        + "{\"id\": \"alpha.detection\", \"name\": \"Detection\", \"manual\": false, \"sensorReport\": true}]", MODE));

    start(dataTypes);

    assertThat(host.dataTypes().get(1).sensorReport()).as("by default").isFalse();
    assertThat(host.dataTypes().get(2).sensorReport()).isTrue();
    assertThat(host.dataTypesJson().get(0).get("sensorReport").booleanValue()).as("core.general").isFalse();
    assertThat(host.dataTypesJson().get(1).get("sensorReport").booleanValue()).isFalse();
    assertThat(host.dataTypesJson().get(2).get("sensorReport").booleanValue()).isTrue();
  }

  @Test
  void aDataTypesFadeSettingIsKeptAndBrowsersGetItOnlyWhereDeclared() {
    // SDK 1.7.0 (CR-0042, T-192): the pointer as written; the shell resolves it
    install("alpha", manifest("alpha", "\"dataTypes\": [{\"id\": \"alpha.track\", \"name\": \"Track\"}, "
        + "{\"id\": \"alpha.detection\", \"name\": \"Detection\", \"manual\": false, \"fadeSetting\": \"/detectionFade\"}]", MODE));

    start(dataTypes);

    assertThat(host.dataTypesJson().get(0).has("fadeSetting")).as("core.general").isFalse();
    assertThat(host.dataTypesJson().get(1).has("fadeSetting")).as("none declared").isFalse();
    assertThat(host.dataTypesJson().get(2).get("fadeSetting").asString()).isEqualTo("/detectionFade");
  }

  @Test
  void aDataTypeThatNamesASetThePluginDoesNotDeclareRefusesThePlugin() throws Exception {
    install("alpha", manifest("alpha", "\"fields\": [" + CALLSIGN + "], "
            + "\"fieldSets\": [{\"id\": \"unit\", \"label\": \"Unit\", \"fields\": [\"callsign\"]}], "
            + "\"dataTypes\": [{\"id\": \"alpha.track\", \"name\": \"Track\", \"fieldSets\": [\"unit\", \"motion\"]}]", MODE))
        .install("ais", java.nio.file.Files.readString(
            java.nio.file.Path.of("../../model/examples/invalid-by-rule/rule-20-manifest-data-type-unknown-field-set.json")));

    start(dataTypes);

    assertThat(statuses.of("alpha").detail())
        .isEqualTo("the data type alpha.track names the field set motion, which is not among the plugin's field sets");
    assertThat(statuses.of("ais").detail())
        .isEqualTo("the data type ais.vessel names the field set voyage, which is not among the plugin's field sets");
    assertThat(dataTypes.ids()).containsExactly("core.general");
  }

  // ---- Local folders (SDK 1.4.0, ADR-0049 point 4, model rule 19) -------------------------------

  private static final String HEIGHTS = "\"folders\": [{\"id\": \"heights\", \"setting\": \"/heightDataFolder\", \"reason\": \"Height data.\"}]";
  private static final String FOLDER_SETTING = MODE + ", \"heightDataFolder\": {\"type\": \"string\", \"default\": \"\"}";

  @Test
  void aFolderMustNameAStringSettingOnce() throws Exception {
    install("terrain", java.nio.file.Files.readString(java.nio.file.Path.of("../../model/examples/invalid-by-rule/rule-19-manifest-folder-unknown-setting.json"))
            .replace("dev.emcc.plugins.terrain.TerrainPlugin", PluginFolders.ENTRY_CLASS))
        .install("alpha", manifest("alpha", HEIGHTS.replace("}]", "}, {\"id\": \"heights\", \"setting\": \"/mode\", \"reason\": \"Again.\"}]"),
            FOLDER_SETTING))
        .install("beta", manifest("beta", HEIGHTS, MODE + ", \"heightDataFolder\": {\"type\": \"integer\", \"default\": 0}"))
        .install("gamma", manifest("gamma", HEIGHTS.replace("/heightDataFolder", "/paths/heights"),
            MODE + ", \"paths\": {\"type\": \"object\", \"properties\": {\"heights\": {\"type\": \"string\", \"default\": \"\"}}, \"default\": {}}"))
        .install("delta", """
            {"id": "delta", "name": "Delta", "version": "0.1.0", "sdkVersion": "^1.0.0", "kind": "general",
             "server": {"entryClass": "%s"}, %s}
            """.formatted(PluginFolders.ENTRY_CLASS, HEIGHTS));

    start();

    assertThat(statuses.of("terrain").detail()).as("the model's example")
        .isEqualTo("the folder heights's setting /heightFolder: the settings schema declares no heightFolder");
    assertThat(statuses.of("alpha").detail()).isEqualTo("the folder heights is declared twice");
    assertThat(statuses.of("beta").detail()).isEqualTo("the folder heights's setting /heightDataFolder must be a property of type string");
    assertThat(statuses.of("gamma").state().name()).as("a nested string is a setting too").isEqualTo("OK");
    assertThat(statuses.of("delta").detail()).isEqualTo("the folder heights's path is taken from the settings, but the plugin has no settings");
  }

  @Test
  void theMonitorShowsEachFolderWithItsPathAndWhetherItIsReadableAfterAChange() throws Exception {
    install("terrain", manifest("terrain", HEIGHTS, FOLDER_SETTING));
    start();
    assertThat(awaitFolder("NOT_SET")).isEqualTo(new PluginHost.FolderStatus("terrain", "heights", "Height data.", "/heightDataFolder", null, null, "NOT_SET"));

    Path heights = java.nio.file.Files.createDirectory(data.resolve("heights"));
    host.settings().change("terrain", mode("ok").with("heightDataFolder", dev.emcc.sdk.json.JsonString.of(heights.toString())), ADMIN);
    assertThat(awaitFolder("READABLE").path()).as("the admin's setting, at once").isEqualTo(heights.toString());

    host.settings().change("terrain", mode("ok").with("heightDataFolder", dev.emcc.sdk.json.JsonString.of(heights.resolve("gone").toString())), ADMIN);
    assertThat(awaitFolder("MISSING").path()).isEqualTo(heights.resolve("gone").toString());
  }

  /** The one folder of the running plugins, once the Monitor's check says {@code state}; it polls, as the view does. */
  private PluginHost.FolderStatus awaitFolder(String state) throws InterruptedException {
    long until = System.nanoTime() + Probe.WAIT.toNanos();
    while (true) {
      List<PluginHost.FolderStatus> all = host.localFolders();
      assertThat(all).hasSize(1);
      if (all.getFirst().state().equals(state) || System.nanoTime() > until) {
        return all.getFirst();
      }
      Thread.sleep(10);
    }
  }

  // ---- Workspaces (SDK 1.2.0, ADR-0039) --------------------------------------------------------

  /** A manifest's {@code workspaces} and the permissions they use. */
  private static String workspaces(String id, String workspaces) {
    return "\"permissions\": [\"plugin." + id + ".view\", \"plugin." + id + ".edit\"], \"workspaces\": [" + workspaces + "]";
  }

  private static String workspace(String id, String name, String order) {
    String plugin = id.substring(0, id.indexOf('.'));
    return "{\"id\": \"" + id + "\", \"name\": \"" + name + "\", \"viewPermission\": \"plugin." + plugin
        + ".view\", \"editPermission\": \"plugin." + plugin + ".edit\"" + (order == null ? "" : ", \"order\": " + order) + "}";
  }

  @Test
  void theWorkspacesAreViewThenTheDeclaredOnesByOrderAndPluginsAndTheStoreGetThem() {
    install("alpha", manifest("alpha", workspaces("alpha", workspace("alpha.replay", "Replay", null)), MODE))
        .install("beta", manifest("beta", workspaces("beta", workspace("beta.simulation", "Simulation", "10")), MODE))
        .install("gamma", manifest("gamma", "\"dependsOn\": [\"nobody\"], "
            + workspaces("gamma", workspace("gamma.planning", "Planning", "1")), MODE));
    Workspaces rules = new Workspaces();

    start(dataTypes, new DeclaredFields(), rules);

    assertThat(host.workspaces()).extracting(dev.emcc.sdk.Workspace::id)
        .as("View first, then by order (beta's 10 before alpha's default 100); gamma cannot start")
        .containsExactly("core.view", "beta.simulation", "alpha.replay");
    assertThat(host.workspaces().get(2)).isEqualTo(
        new dev.emcc.sdk.Workspace("alpha.replay", "Replay", "plugin.alpha.view", "plugin.alpha.edit", 100));
    assertThat(rules.declared("beta.simulation")).as("the store's and the live picture's rules are fixed too")
        .isEqualTo(new Workspaces.Declared("beta.simulation", "plugin.beta.view", "plugin.beta.edit"));
    assertThat(rules.isKnown("gamma.planning")).isFalse();
    assertThat(get("alpha", "/info/workspaces")).isEqualTo("200 core.view,beta.simulation,alpha.replay");
  }

  @Test
  void browsersGetTheWorkspacesTheirUserMaySee() {
    install("alpha", manifest("alpha", workspaces("alpha", workspace("alpha.replay", "Replay", "5")), MODE));

    start(dataTypes);

    assertThat(host.workspacesJson(p -> false).toString())
        .isEqualTo("[{\"id\":\"core.view\",\"name\":\"View\",\"order\":-2147483648}]");
    assertThat(host.workspacesJson("plugin.alpha.view"::equals).toString()).isEqualTo("["
        + "{\"id\":\"core.view\",\"name\":\"View\",\"order\":-2147483648},"
        + "{\"id\":\"alpha.replay\",\"name\":\"Replay\",\"viewPermission\":\"plugin.alpha.view\","
        + "\"editPermission\":\"plugin.alpha.edit\",\"order\":5}]");
  }

  @Test
  void aWorkspaceOutsideThePluginsNamespaceWithAnotherPluginsPermissionsOrDeclaredTwiceRefusesThePlugin() {
    install("alpha", manifest("alpha", workspaces("alpha", workspace("beta.replay", "Replay", null)), MODE))
        .install("beta", manifest("beta", "\"permissions\": [\"plugin.beta.view\"], \"workspaces\": ["
            + workspace("beta.replay", "Replay", null) + "]", MODE))
        .install("gamma", manifest("gamma", workspaces("gamma", workspace("gamma.one", "One", null) + ", "
            + workspace("gamma.one", "Again", "3")), MODE))
        .install("delta", manifest("delta", workspaces("delta", "{\"id\": \"delta.x\", \"name\": \"X\"}"), MODE));

    start(dataTypes);

    assertThat(statuses.of("alpha").detail()).isEqualTo("the workspace beta.replay must start with the plugin's id: alpha.");
    assertThat(statuses.of("beta").detail()).isEqualTo("the workspace beta.replay's permission plugin.beta.edit is not among the plugin's permissions");
    assertThat(statuses.of("gamma").detail()).isEqualTo("the workspace gamma.one is declared twice");
    assertThat(statuses.of("delta").detail()).as("the schema: both permissions are required").startsWith("invalid plugin.json: /workspaces/0");
    assertThat(host.workspaces()).extracting(dev.emcc.sdk.Workspace::id).containsExactly("core.view");
  }

  // ---- Data types ------------------------------------------------------------------------------

  @Test
  void theDataTypesAreFixedFromTheManifestsCoreGeneralFirstAndPluginsSeeThem() {
    install("alpha", manifest("alpha", """
        "dataTypes": [{"id": "alpha.track", "name": "Track", "defaults": {"expiresAfterSeconds": 300, "fadeWhenExpired": true}}]""", MODE))
        .install("beta", manifest("beta", """
        "dependsOn": ["alpha"], "dataTypes": [{"id": "beta.alert", "name": "Alert"}]""", MODE));

    start(dataTypes);

    assertThat(host.dataTypes()).extracting(DataType::id).containsExactly("core.general", "alpha.track", "beta.alert");
    assertThat(host.dataTypes().get(1).declaredBy()).isEqualTo("alpha");
    assertThat(host.dataTypes().get(1).defaults()).isEqualTo(new DataType.Defaults(300L, true, null));
    assertThat(dataTypes.ids()).containsExactlyInAnyOrder("core.general", "alpha.track", "beta.alert");
    assertThat(get("beta", "/info/data-types")).isEqualTo("200 core.general,alpha.track/300,beta.alert");
  }

  @Test
  void aDataTypesEffectiveBehaviourIsTheConfiguredOneElseTheManifestsDefaults() {
    new ConfigStore(data, JSON).save(ConfigStore.Config.EMPTY.withBehaviour("alpha.alert", new ConfigStore.Behaviour(60L, false, 0L)));
    install("alpha", manifest("alpha", """
        "dataTypes": [{"id": "alpha.track", "name": "Track", "defaults": {"expiresAfterSeconds": 300, "removeAfterExpirySeconds": 3600}},
                      {"id": "alpha.alert", "name": "Alert", "defaults": {"expiresAfterSeconds": 30}}]""", MODE));

    start(dataTypes);

    assertThat(host.behaviours()).containsExactly(
        Map.entry("core.general", new ConfigStore.Behaviour(null, false, null)),
        Map.entry("alpha.track", new ConfigStore.Behaviour(300L, false, 3600L)),
        Map.entry("alpha.alert", new ConfigStore.Behaviour(60L, false, 0L)));
  }

  @Test
  void browsersGetTheDataTypesWithTheirEffectiveBehaviourAndEveryPluginsSettings() {
    new ConfigStore(data, JSON).save(ConfigStore.Config.EMPTY.withBehaviour("alpha.track", new ConfigStore.Behaviour(60L, true, null))
        .withPluginSettings("alpha", mode("stored")));
    install("alpha", manifest("alpha", """
        "dataTypes": [{"id": "alpha.track", "name": "Track", "description": "Tracks", "defaults": {"expiresAfterSeconds": 300}}]""", MODE));
    start(dataTypes);

    assertThat(host.dataTypesJson().toString()).isEqualTo("[{\"id\":\"core.general\",\"name\":\"General\","
        + "\"description\":\"The built-in data type, for everything without a more specific one.\",\"declaredBy\":null,"
        + "\"fieldSets\":[],\"manual\":true,\"sensorReport\":false,"
        + "\"defaults\":{\"fadeWhenExpired\":false},\"behaviour\":{\"fadeWhenExpired\":false}},"
        + "{\"id\":\"alpha.track\",\"name\":\"Track\",\"description\":\"Tracks\",\"declaredBy\":\"alpha\","
        + "\"fieldSets\":[],\"manual\":true,\"sensorReport\":false,"
        + "\"defaults\":{\"expiresAfterSeconds\":300,\"fadeWhenExpired\":false},"
        + "\"behaviour\":{\"expiresAfterSeconds\":60,\"fadeWhenExpired\":true}}]");
    assertThat(host.liveNotices()).hasSize(2).first().asString().startsWith("{\"type\":\"data-types\",\"dataTypes\":[");
    assertThat(host.liveNotices().get(1)).isEqualTo("{\"type\":\"settings\",\"plugin\":\"alpha\",\"values\":{\"mode\":\"stored\"}}");
  }

  private static JsonObject behaviour(String json) {
    return (JsonObject) ModelJson.toJsonValue(JSON.parse(json));
  }

  @Test
  void aDataTypesBehaviourIsChangedCompleteStoredAndToldToEcoresListeners() {
    install("alpha", manifest("alpha", """
        "dataTypes": [{"id": "alpha.track", "name": "Track", "defaults": {"expiresAfterSeconds": 300, "removeAfterExpirySeconds": 3600}}]""", MODE));
    start(dataTypes);
    List<String> told = new ArrayList<>();
    host.onBehaviourChange(() -> told.add(host.dataTypesMessage()));

    PluginHost.BehaviourChange change = host.changeBehaviour("alpha.track", behaviour("{\"expiresAfterSeconds\": 60, \"fadeWhenExpired\": true}"), ADMIN);

    assertThat(change).isEqualTo(new PluginHost.BehaviourChange.Applied(new ConfigStore.Behaviour(60L, true, null)));
    assertThat(host.behaviours()).containsEntry("alpha.track", new ConfigStore.Behaviour(60L, true, null)); // the whole behaviour: no removal
    assertThat(new ConfigStore(data, JSON).load().dataTypes()).containsEntry("alpha.track", new ConfigStore.Behaviour(60L, true, null));
    assertThat(told).singleElement().asString().contains("\"behaviour\":{\"expiresAfterSeconds\":60,\"fadeWhenExpired\":true}");
    assertThat(host.changeBehaviour("core.general", behaviour("{\"fadeWhenExpired\": false}"), User.noLoginUser()))
        .as("core.general too; the local user has every permission").isInstanceOf(PluginHost.BehaviourChange.Applied.class);
  }

  @Test
  void aDataTypesBehaviourCanBeSetBackToTheManifestsDefaults() {
    new ConfigStore(data, JSON).save(ConfigStore.Config.EMPTY.withBehaviour("alpha.track", new ConfigStore.Behaviour(60L, true, null)));
    install("alpha", manifest("alpha", """
        "dataTypes": [{"id": "alpha.track", "name": "Track", "defaults": {"expiresAfterSeconds": 300, "removeAfterExpirySeconds": 3600}}]""", MODE));
    start(dataTypes);
    List<String> told = new ArrayList<>();
    host.onBehaviourChange(() -> told.add(host.dataTypesMessage()));

    assertThat(host.resetBehaviour("alpha.track", User.of("u", "U", Set.of()))).isInstanceOf(PluginHost.BehaviourChange.Forbidden.class);
    assertThat(host.resetBehaviour("alpha.nothing", ADMIN)).isEqualTo(new PluginHost.BehaviourChange.NotFound("alpha.nothing"));
    assertThat(told).isEmpty();

    assertThat(host.resetBehaviour("alpha.track", ADMIN))
        .isEqualTo(new PluginHost.BehaviourChange.Applied(new ConfigStore.Behaviour(300L, false, 3600L)));
    assertThat(host.behaviours()).containsEntry("alpha.track", new ConfigStore.Behaviour(300L, false, 3600L));
    assertThat(new ConfigStore(data, JSON).load().dataTypes()).doesNotContainKey("alpha.track");
    assertThat(told).singleElement().asString().contains("\"behaviour\":{\"expiresAfterSeconds\":300,\"fadeWhenExpired\":false,\"removeAfterExpirySeconds\":3600}");
  }

  @Test
  void aBehaviourChangeNeedsSettingsAdminAKnownDataTypeAndValidFields() {
    install("alpha", manifest("alpha", """
        "dataTypes": [{"id": "alpha.track", "name": "Track"}]""", MODE));
    start(dataTypes);
    List<String> told = new ArrayList<>();
    host.onBehaviourChange(() -> told.add("told"));

    assertThat(host.changeBehaviour("alpha.track", behaviour("{\"fadeWhenExpired\": true}"), User.of("u", "U", Set.of())))
        .isInstanceOf(PluginHost.BehaviourChange.Forbidden.class);
    assertThat(host.changeBehaviour("alpha.nothing", behaviour("{\"fadeWhenExpired\": true}"), ADMIN))
        .isEqualTo(new PluginHost.BehaviourChange.NotFound("alpha.nothing"));
    assertThat(host.changeBehaviour("alpha.track", behaviour("{\"expiresAfterSeconds\": 0, \"removeAfterExpirySeconds\": 1.5, \"fadeWhenExpired\": true, \"colour\": 1}"), ADMIN))
        .isInstanceOfSatisfying(PluginHost.BehaviourChange.Refused.class, r -> assertThat(r.problems()).extracting(Problem::path)
            .containsExactlyInAnyOrder("/colour", "/expiresAfterSeconds", "/removeAfterExpirySeconds"));
    assertThat(host.changeBehaviour("alpha.track", behaviour("{\"expiresAfterSeconds\": 60}"), ADMIN))
        .isInstanceOfSatisfying(PluginHost.BehaviourChange.Refused.class, r -> assertThat(r.problems()).extracting(Problem::path)
            .containsExactly("/fadeWhenExpired"));
    assertThat(told).isEmpty();
    assertThat(host.behaviours()).containsEntry("alpha.track", new ConfigStore.Behaviour(null, false, null));
  }

  @Test
  void aDataTypeOutsideThePluginsNamespaceOrDeclaredTwiceRefusesThePlugin() {
    install("alpha", manifest("alpha", """
        "dataTypes": [{"id": "other.thing", "name": "Thing"}]""", MODE))
        .install("beta", manifest("beta", """
        "dataTypes": [{"id": "beta.thing", "name": "Thing"}, {"id": "beta.thing", "name": "Thing again"}]""", MODE))
        .install("gamma", manifest("gamma", """
        "dependsOn": ["alpha"], "dataTypes": [{"id": "gamma.thing", "name": "Thing"}]""", MODE));

    start(dataTypes);

    assertThat(state("alpha")).isEqualTo("disabled FAILED");
    assertThat(statuses.of("alpha").detail()).contains("must start with the plugin's id: alpha.");
    assertThat(statuses.of("beta").detail()).contains("beta.thing is declared twice");
    assertThat(statuses.of("gamma").detail()).startsWith("depends on alpha");
    assertThat(dataTypes.ids()).as("a plugin that cannot start declares nothing").containsExactly("core.general");
  }

  // ---- Manifest checks for settings and network ------------------------------------------------

  @Test
  void aSettingsSchemaMayReferOnlyWithinItself() {
    install("alpha", manifest("alpha", "", MODE + ", \"server\": {\"$ref\": \"https://example.com/server.json\"}"))
        .install("beta", manifest("beta", "", MODE + ", \"port\": {\"$ref\": \"#/$defs/port\"}").replace(
            "\"properties\": {", "\"$defs\": {\"port\": {\"type\": \"integer\", \"default\": 1}}, \"properties\": {"));

    start();

    assertThat(statuses.of("alpha").detail()).contains("may refer only within itself").contains("https://example.com/server.json");
    assertThat(state("beta")).isEqualTo("active OK");
  }

  @Test
  void defaultsThatDoNotMatchTheSchemaRefuseThePlugin() {
    install("alpha", manifest("alpha", "", MODE + ", \"port\": {\"type\": \"integer\", \"default\": \"8089\"}"));

    start();

    assertThat(statuses.of("alpha").detail()).startsWith("the settings defaults do not match the settings schema: /port");
  }

  @Test
  void networkPointersMustLeadToHostAndPortSettings() {
    String servers = MODE + """
        , "servers": {"type": "array", "default": [], "items": {"type": "object",
           "properties": {"host": {"type": "string"}, "port": {"type": "integer"}}}}""";
    install("alpha", manifest("alpha", "\"network\": {\"endpoints\": [\"/servers\"], \"reason\": \"TAK Servers\"}", servers))
        .install("beta", manifest("beta", "\"network\": {\"endpoints\": [\"/nothing\"], \"reason\": \"TAK Servers\"}", servers))
        .install("gamma", manifest("gamma", "\"network\": {\"endpoints\": [\"/mode\"], \"reason\": \"TAK Servers\"}", servers));

    start();

    assertThat(state("alpha")).isEqualTo("active OK");
    assertThat(statuses.of("beta").detail()).isEqualTo("network endpoint /nothing: the settings schema declares no nothing");
    assertThat(statuses.of("gamma").detail()).contains("must be an object with host and port");
  }

  // ---- Settings at runtime ---------------------------------------------------------------------

  @Test
  void aChangeIsValidatedStoredDeliveredAndCurrent() {
    install("alpha", manifest("alpha", "", MODE));
    listenTo("alpha");
    start();
    assertThat(events.next()).isEqualTo("started alpha");

    PluginSettings.Change change = host.settings().change("alpha", mode("changed"), ADMIN);

    assertThat(change).isEqualTo(new PluginSettings.Change.Applied(mode("changed")));
    assertThat(events.next()).isEqualTo("settings changed alpha");
    assertThat(get("alpha", "/info/current-mode")).isEqualTo("200 changed");
    assertThat(get("alpha", "/info/mode")).as("what init saw").isEqualTo("200 ok");

    assertThat(host.settings().view("alpha").values()).isEqualTo(mode("changed"));
    assertThat(new ConfigStore(data, JSON).load().pluginSettings()).as("stored").isEqualTo(Map.of("alpha", mode("changed")));
  }

  @Test
  void storedSettingsThatMatchTheSchemaAreUsedFromTheStart() {
    new ConfigStore(data, JSON).save(ConfigStore.Config.EMPTY.withPluginSettings("alpha", mode("stored")));
    install("alpha", manifest("alpha", "", MODE));

    start();

    assertThat(get("alpha", "/info/mode")).as("what init saw").isEqualTo("200 stored");
  }

  @Test
  void changingSettingsNeedsSettingsAdminAndValuesThatMatchTheSchema() {
    install("alpha", manifest("alpha", "", MODE));
    start();
    PluginSettings settings = host.settings();

    assertThat(settings.change("alpha", mode("x"), User.of("u", "U", Set.of()))).isInstanceOf(PluginSettings.Change.Forbidden.class);
    assertThat(settings.change("alpha", JsonObject.of(Map.of("mode", JsonNumber.of(5))), ADMIN))
        .isInstanceOfSatisfying(PluginSettings.Change.Refused.class,
            r -> assertThat(r.problems()).singleElement().satisfies(p -> assertThat(p.path()).isEqualTo("/mode")));
    assertThat(settings.change("nobody", mode("x"), ADMIN)).isEqualTo(new PluginSettings.Change.NotFound("nobody"));
    assertThat(settings.change("alpha", mode("x"), User.noLoginUser())).as("the local user has every permission")
        .isInstanceOf(PluginSettings.Change.Applied.class);
    assertThat(settings.current("alpha")).isEqualTo(mode("x"));
  }

  @Test
  void storedSettingsThatNoLongerMatchTheSchemaAreNotUsed() {
    new ConfigStore(data, JSON).save(ConfigStore.Config.EMPTY.withPluginSettings("alpha", JsonObject.of(Map.of("mode", JsonNumber.of(5)))));
    install("alpha", manifest("alpha", "", MODE));

    start();

    assertThat(state("alpha")).isEqualTo("active OK");
    assertThat(get("alpha", "/info/current-mode")).isEqualTo("200 ok");
  }

  @Test
  void aWorkerThatMissesChangesStillEndsWithTheLatestSettings() {
    install("alpha", manifest("alpha", "", MODE));
    listenTo("alpha");
    start();
    assertThat(events.next()).isEqualTo("started alpha");

    for (int i = 0; i < 50; i++) {
      host.settings().change("alpha", mode("v" + i), ADMIN);
    }

    List<String> seen = new ArrayList<>();
    Instant until = Instant.now().plus(Probe.WAIT);
    while (!seen.contains("settings v49 alpha") && Instant.now().isBefore(until)) {
      seen.add(events.next());
    }
    assertThat(seen).last().isEqualTo("settings v49 alpha");
    assertThat(seen).hasSizeLessThanOrEqualTo(50);
  }

  // ---- Settings items' stable ids (SDK 1.8.0, CR-0047 F2) ---------------------------------------

  /** {@code links[]} whose items declare {@code item.id}, required as fmv's are; one default link without its id. */
  private static final String LINKS = """
      "links": {"type": "array", "default": [{"name": "one"}], "x-emc2": {"item": {"name": "name", "id": "id"}},
        "items": {"type": "object", "required": ["id", "name"], "additionalProperties": false,
          "properties": {"id": {"type": "string", "readOnly": true}, "name": {"type": "string"}}}}""";

  private static final String UUID_V7 = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

  private static JsonObject links(String json) {
    return (JsonObject) ModelJson.toJsonValue(JSON.parse(json));
  }

  private static String linkId(JsonObject settings, int index) {
    return ((JsonObject) ((dev.emcc.sdk.json.JsonArray) settings.get("links")).get(index)).getString("id");
  }

  @Test
  void theDefaultsItemsGetIdsAtLoadWhichAreStored() {
    install("alpha", manifest("alpha", "", LINKS));
    start();

    String id = linkId(host.settings().current("alpha"), 0);
    assertThat(id).matches(UUID_V7);
    assertThat(new ConfigStore(data, JSON).load().pluginSettings().get("alpha")).as("stored").isEqualTo(host.settings().current("alpha"));

  }

  @Test
  void storedItemsWithoutAnIdOrWithARepeatedOneGetNewIdsAtLoad() {
    new ConfigStore(data, JSON).save(ConfigStore.Config.EMPTY.withPluginSettings("alpha",
        links("{\"links\": [{\"id\": \"a\", \"name\": \"A\"}, {\"name\": \"B\"}, {\"id\": \"a\", \"name\": \"C\"}]}")));
    install("alpha", manifest("alpha", "", LINKS));

    start();

    JsonObject current = host.settings().current("alpha");
    assertThat(linkId(current, 0)).as("a stored id is kept").isEqualTo("a");
    assertThat(linkId(current, 1)).matches(UUID_V7);
    assertThat(linkId(current, 2)).matches(UUID_V7).isNotEqualTo(linkId(current, 1));
    assertThat(new ConfigStore(data, JSON).load().pluginSettings().get("alpha")).as("stored").isEqualTo(current);
  }

  @Test
  void aChangeGetsItsMissingIdsFilledInAndKeepsTheGivenOnes() {
    install("alpha", manifest("alpha", "", LINKS));
    start();
    String id = linkId(host.settings().current("alpha"), 0);

    PluginSettings.Change change = host.settings().change("alpha",
        links("{\"links\": [{\"id\": \"" + id + "\", \"name\": \"renamed\"}, {\"name\": \"new\"}]}"), ADMIN);

    assertThat(change).isInstanceOfSatisfying(PluginSettings.Change.Applied.class, applied -> {
      assertThat(linkId(applied.values(), 0)).as("a rename keeps the id").isEqualTo(id);
      assertThat(linkId(applied.values(), 1)).matches(UUID_V7);
      assertThat(host.settings().current("alpha")).isEqualTo(applied.values());
      assertThat(new ConfigStore(data, JSON).load().pluginSettings().get("alpha")).as("stored").isEqualTo(applied.values());
    });
  }

  @Test
  void aChangeWithTwoItemsOfOneIdIsRefusedAtTheSecond() {
    install("alpha", manifest("alpha", "", LINKS));
    start();
    JsonObject before = host.settings().current("alpha");

    PluginSettings.Change change = host.settings().change("alpha",
        links("{\"links\": [{\"id\": \"x\", \"name\": \"A\"}, {\"id\": \"x\", \"name\": \"B\"}]}"), ADMIN);

    assertThat(change).isInstanceOfSatisfying(PluginSettings.Change.Refused.class,
        r -> assertThat(r.problems()).singleElement().satisfies(p -> assertThat(p.path()).isEqualTo("/links/1/id")));
    assertThat(host.settings().current("alpha")).as("nothing changed").isEqualTo(before);
  }
}
