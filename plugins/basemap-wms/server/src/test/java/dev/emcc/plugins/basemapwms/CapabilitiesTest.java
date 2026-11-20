package dev.emcc.plugins.basemapwms;

import static dev.emcc.plugins.basemapwms.WmsTestSupport.CAPS_130;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.ROOT;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.background;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.callsTo;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.capabilities130;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.capabilitiesWithoutPolar;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.server;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.settings;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.standardSettings;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.start;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.started;
import static dev.emcc.plugins.basemapwms.WmsTestSupport.xml;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.User;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.LogEntry;
import dev.emcc.sdk.testkit.TestJson;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** Brief functions 1, 3 and 4 and criteria 2, 3, 7, 8, 12, 13, 15, 16 and 19: capabilities, the offered backgrounds, the layer list. */
class CapabilitiesTest {

  private static JsonObject get(FakePluginContext context, String path) {
    FakeHttpExchange call = context.call(path);
    context.runUntilIdle();
    assertThat(call.reply().status()).as(path).isEqualTo(200);
    return (JsonObject) TestJson.parse(call.reply().body().toUtf8());
  }

  private static List<String> strings(JsonValue array) {
    return ((JsonArray) array).values().stream().map(v -> ((dev.emcc.sdk.json.JsonString) v).value()).toList();
  }

  private static JsonObject backgrounds(FakePluginContext context) {
    return get(context, "/backgrounds");
  }

  private static List<String> offeredIds(JsonObject answer) {
    return ((JsonArray) answer.get("backgrounds")).values().stream().map(b -> ((dev.emcc.sdk.json.JsonString) ((JsonObject) b).get("id")).value()).toList();
  }

  private static long version(JsonObject answer) {
    return answer.getNumber("version").longValueExact();
  }

  private static long warnings(FakePluginContext context) {
    return context.logEntries().stream().filter(e -> e.level() == LogEntry.Level.WARN).count();
  }

  @Test
  void aBackgroundIsOfferedInTheProjectionsEveryOneOfItsLayersLists() throws Exception {
    JsonObject two = settings(
        List.of(server("geo", ROOT, "1.3.0")),
        List.of(
            background("topo", "geo", "\"land\",\"sea\"", "image/png", false),
            background("polar", "geo", "\"group\"", "image/png", false),
            background("mixed", "geo", "\"land\",\"group\"", "image/png", false)));
    FakePluginContext context = started(two);

    JsonObject answer = backgrounds(context);

    assertThat(offeredIds(answer)).containsExactly("topo", "polar", "mixed");
    List<JsonValue> items = ((JsonArray) answer.get("backgrounds")).values();
    assertThat(strings(((JsonObject) items.get(0)).get("projections"))).containsExactly("EPSG:4326", "EPSG:3857", "EPSG:3413");
    // criterion 2: a layer group is a layer; the polar one is offered in EPSG:3031
    assertThat(strings(((JsonObject) items.get(1)).get("projections"))).containsExactly("EPSG:4326", "EPSG:3857", "EPSG:3031");
    // land lists EPSG:3413 and the group EPSG:3031, so a background of both has neither
    assertThat(strings(((JsonObject) items.get(2)).get("projections"))).containsExactly("EPSG:4326", "EPSG:3857");
    assertThat(answer.getBoolean("reading")).isFalse();
    assertThat(context.pluginStatus().state()).isEqualTo(PluginState.OK);
  }

  @Test
  void aBackgroundWhoseLayersListOnlyNonPolarProjectionsIsNotOfferedInAPolarOne() throws Exception {
    FakePluginContext context = WmsTestSupport.start(standardSettings());
    context.upstream().respond(CAPS_130, 200, xml(), capabilitiesWithoutPolar());
    context.runUntilIdle();

    List<JsonValue> items = ((JsonArray) backgrounds(context).get("backgrounds")).values();

    assertThat(strings(((JsonObject) items.getFirst()).get("projections"))).containsExactly("EPSG:4326", "EPSG:3857");
    FakeHttpExchange polar = context.call("/map/topo?" + WmsTestSupport.query("CRS", "EPSG:3413", "-100,-50,100,50", "256"));
    context.runUntilIdle();
    assertThat(polar.reply().status()).isEqualTo(400);
  }

  @Test
  void nothingIsOfferedBeforeTheFirstReadAndTheAnswerSaysReading() throws Exception {
    FakePluginContext context = start(standardSettings());
    context.upstream().respondAfter(Duration.ofSeconds(2), CAPS_130, 200, xml(), capabilities130());
    context.runUntilIdle();

    JsonObject during = backgrounds(context);
    assertThat(during.getBoolean("reading")).isTrue();
    assertThat(offeredIds(during)).isEmpty();

    context.advance(Duration.ofSeconds(3));
    JsonObject after = backgrounds(context);
    assertThat(after.getBoolean("reading")).isFalse();
    assertThat(offeredIds(after)).containsExactly("topo");
    assertThat(version(after)).isGreaterThan(version(during));
  }

  @Test
  void aServerThatCannotBeReadIsNamedInTheStatusAndRetriedAfterOneMinuteThenLessOften() throws Exception {
    FakePluginContext context = start(standardSettings());
    context.upstream().fail(CAPS_130, "connection refused");
    context.runUntilIdle();

    assertThat(offeredIds(backgrounds(context))).isEmpty();
    assertThat(context.pluginStatus().state()).isEqualTo(PluginState.DEGRADED);
    assertThat(context.pluginStatus().detail()).contains("server geo").contains("connection refused");
    assertThat(callsTo(context, CAPS_130)).isEqualTo(1);

    context.advance(Duration.ofSeconds(58));
    assertThat(callsTo(context, CAPS_130)).as("not before a minute").isEqualTo(1);
    context.advance(Duration.ofSeconds(4));
    assertThat(callsTo(context, CAPS_130)).isEqualTo(2);
    context.advance(Duration.ofSeconds(100));
    assertThat(callsTo(context, CAPS_130)).as("the second wait is two minutes").isEqualTo(2);
    context.advance(Duration.ofSeconds(30));
    assertThat(callsTo(context, CAPS_130)).isEqualTo(3);
    context.advance(Duration.ofHours(2));
    assertThat(callsTo(context, CAPS_130)).as("at most every 15 minutes").isBetween(10L, 12L);
    // criterion 13: reads are at least a minute apart, so each failed read is the only warning of its minute
    assertThat(warnings(context)).isLessThanOrEqualTo(callsTo(context, CAPS_130));

    context.upstream().respond(CAPS_130, 200, xml(), capabilities130());
    context.advance(Duration.ofMinutes(16));
    assertThat(offeredIds(backgrounds(context))).containsExactly("topo");
    assertThat(context.pluginStatus().state()).isEqualTo(PluginState.OK);
  }

  @Test
  void manyFailedMapCallsLogOneWarningPerMinute() throws Exception {
    FakePluginContext context = started(standardSettings());
    context.upstream().fail(WmsTestSupport.webMercatorUpstream(), "connection refused");
    long before = warnings(context);

    for (int i = 0; i < 20; i++) {
      context.call("/map/topo?" + WmsTestSupport.webMercatorQuery());
      context.advance(Duration.ofSeconds(2));
    }

    assertThat(warnings(context) - before).as("20 failures in 40 seconds").isEqualTo(1);
    context.advance(Duration.ofSeconds(30));
    context.call("/map/topo?" + WmsTestSupport.webMercatorQuery());
    context.advance(Duration.ofSeconds(2));
    assertThat(warnings(context) - before).isEqualTo(2);
  }

  @Test
  void aBackgroundWithAMissingLayerOrServerIsNamedAndNotOffered() throws Exception {
    JsonObject bad = settings(
        List.of(server("geo", ROOT, "1.3.0")),
        List.of(
            background("topo", "geo", "\"land\",\"sea\"", "image/png", false),
            background("gone", "geo", "\"land\",\"vanished\"", "image/png", false),
            background("orphan", "elsewhere", "\"land\"", "image/png", false),
            background("jpeg-overlay", "geo", "\"land\"", "image/jpeg", true)));
    FakePluginContext context = started(bad);

    assertThat(offeredIds(backgrounds(context))).containsExactly("topo");
    assertThat(context.pluginStatus().state()).isEqualTo(PluginState.DEGRADED);
    assertThat(context.pluginStatus().detail()).contains("gone").contains("vanished").contains("orphan").contains("elsewhere").contains("jpeg-overlay");
  }

  @Test
  void duplicateIdsAreNamedAndTheFirstIsUsed() throws Exception {
    JsonObject twice = settings(
        List.of(server("geo", ROOT, "1.3.0"), server("geo", "http://other.test/ows", "1.3.0")),
        List.of(background("topo", "geo", "\"land\"", "image/png", false), background("topo", "geo", "\"sea\"", "image/png", false)));
    FakePluginContext context = started(twice);

    assertThat(context.pluginStatus().detail()).contains("server geo is listed twice").contains("background topo is listed twice");
    assertThat(offeredIds(backgrounds(context))).containsExactly("topo");
    assertThat(context.httpCalls()).hasSize(1);
  }

  @Test
  void aSettingsChangeAppliesAtOnce() throws Exception {
    FakePluginContext context = started(standardSettings());
    long first = version(backgrounds(context));

    // a new background on the same server: no new read is needed
    context.changeSettings(settings(
        List.of(server("geo", ROOT, "1.3.0")),
        List.of(background("topo", "geo", "\"land\",\"sea\"", "image/png", false), background("polar", "geo", "\"group\"", "image/png", false))));
    context.runUntilIdle();
    JsonObject added = backgrounds(context);
    assertThat(offeredIds(added)).containsExactly("topo", "polar");
    assertThat(version(added)).isGreaterThan(first);
    assertThat(callsTo(context, CAPS_130)).isEqualTo(1);

    // a background whose layers changed: its projections change with it
    context.changeSettings(settings(
        List.of(server("geo", ROOT, "1.3.0")),
        List.of(background("topo", "geo", "\"group\"", "image/png", false), background("polar", "geo", "\"group\"", "image/png", false))));
    context.runUntilIdle();
    JsonObject changed = backgrounds(context);
    assertThat(strings(((JsonObject) ((JsonArray) changed.get("backgrounds")).values().getFirst()).get("projections"))).containsExactly("EPSG:4326", "EPSG:3857", "EPSG:3031");
    assertThat(version(changed)).isGreaterThan(version(added));

    // a removed background is gone
    context.changeSettings(settings(List.of(server("geo", ROOT, "1.3.0")), List.of()));
    context.runUntilIdle();
    JsonObject removed = backgrounds(context);
    assertThat(offeredIds(removed)).isEmpty();
    assertThat(version(removed)).isGreaterThan(version(changed));
    FakeHttpExchange map = context.call("/map/topo?" + WmsTestSupport.webMercatorQuery());
    context.runUntilIdle();
    assertThat(map.reply().status()).isEqualTo(400);
  }

  @Test
  void aChangedServerIsReadAgainAndANewServerIsRead() throws Exception {
    FakePluginContext context = started(standardSettings());
    String other = "http://other.test/ows";
    context.upstream().respond(other + "?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities", 200, xml(), WmsTestSupport.capabilities111());

    context.changeSettings(settings(
        List.of(server("geo", ROOT, "1.3.0"), server("old", other, "1.1.1")),
        List.of(background("topo", "geo", "\"land\",\"sea\"", "image/png", false), background("legacy", "old", "\"land\"", "image/png", false))));
    context.runUntilIdle();

    assertThat(offeredIds(backgrounds(context))).containsExactly("topo", "legacy");
    assertThat(callsTo(context, CAPS_130)).as("the unchanged server is not read again").isEqualTo(1);

    context.changeSettings(settings(
        List.of(server("geo", ROOT + "?map=other", "1.3.0")),
        List.of(background("topo", "geo", "\"land\",\"sea\"", "image/png", false))));
    context.upstream().respond(ROOT + "?map=other&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities", 200, xml(), capabilities130());
    context.runUntilIdle();
    assertThat(offeredIds(backgrounds(context))).containsExactly("topo");
    assertThat(WmsTestSupport.calledUris(context)).contains(ROOT + "?map=other&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities");
  }

  @Test
  void aRefusedSettingsChangeKeepsTheOldValues() throws Exception {
    FakePluginContext context = started(standardSettings());

    context.changeSettings((JsonObject) TestJson.parse("{\"servers\":\"not a list\"}"));
    context.runUntilIdle();

    assertThat(offeredIds(backgrounds(context))).containsExactly("topo");
    assertThat(context.pluginStatus().state()).isEqualTo(PluginState.DEGRADED);
    assertThat(context.pluginStatus().detail()).contains("setting change refused");
    context.changeSettings(standardSettings());
    context.runUntilIdle();
    assertThat(context.pluginStatus().state()).isEqualTo(PluginState.OK);
  }

  @Test
  void theCapabilitiesAreReadEveryHour() throws Exception {
    FakePluginContext context = started(standardSettings());
    assertThat(callsTo(context, CAPS_130)).isEqualTo(1);

    context.advance(Duration.ofMinutes(59));
    assertThat(callsTo(context, CAPS_130)).isEqualTo(1);
    context.advance(Duration.ofMinutes(2));
    assertThat(callsTo(context, CAPS_130)).isEqualTo(2);
  }

  @Test
  void aFailedMapCallMakesThePluginReadTheCapabilitiesSoon() throws Exception {
    FakePluginContext context = started(standardSettings());
    context.advance(Duration.ofSeconds(20));
    context.upstream().fail(CAPS_130, "connection refused");
    context.upstream().fail(WmsTestSupport.webMercatorUpstream(), "connection refused");

    FakeHttpExchange call = context.call("/map/topo?" + WmsTestSupport.webMercatorQuery());
    context.advance(Duration.ofSeconds(2));

    assertThat(call.reply().status()).isEqualTo(502);
    assertThat(callsTo(context, CAPS_130)).isEqualTo(2);
    assertThat(offeredIds(backgrounds(context))).isEmpty();
    assertThat(context.pluginStatus().detail()).contains("server geo");
  }

  @Test
  void aDocumentWithADeclaringDoctypeIsRefusedAndNothingIsFetchedForIt() throws Exception {
    FakePluginContext context = start(standardSettings());
    context.upstream().respond(CAPS_130, 200, xml(), Bytes.utf8("""
        <?xml version="1.0"?>
        <!DOCTYPE WMS_Capabilities SYSTEM "http://evil.example/caps.dtd" [ <!ENTITY x SYSTEM "http://evil.example/x"> ]>
        <WMS_Capabilities xmlns="http://www.opengis.net/wms"><Capability><Layer><Name>land</Name></Layer></Capability></WMS_Capabilities>
        """));
    context.runUntilIdle();

    assertThat(offeredIds(backgrounds(context))).isEmpty();
    assertThat(context.pluginStatus().detail()).contains("server geo");
    assertThat(context.httpCalls()).hasSize(1);
  }

  @Test
  void aBareDoctypeAsGeoServerSendsInVersion111IsRead() throws Exception {
    var settings = settings(
        List.of(server("old", ROOT, "1.1.1")),
        List.of(background("legacy", "old", "\"land\"", "image/png", false)));
    FakePluginContext context = start(settings);
    context.upstream().respond(WmsTestSupport.CAPS_111, 200, xml(), Bytes.utf8("""
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE WMT_MS_Capabilities SYSTEM "http://wms.test/schemas/wms/1.1.1/WMS_MS_Capabilities.dtd">
        <WMT_MS_Capabilities version="1.1.1"><Capability><Layer><SRS>EPSG:4326 EPSG:3857</SRS><Layer><Name>land</Name></Layer></Layer></Capability></WMT_MS_Capabilities>
        """));
    context.runUntilIdle();

    assertThat(offeredIds(backgrounds(context))).containsExactly("legacy");
    assertThat(context.httpCalls()).hasSize(1);
  }

  @Test
  void aServerThatRedirectsIsAFailureTheStatusSaysSo() throws Exception {
    FakePluginContext context = start(standardSettings());
    context.upstream().respond(CAPS_130, 302, dev.emcc.sdk.http.Headers.of("Location", "https://wms.test/ows"), Bytes.empty());
    context.runUntilIdle();

    assertThat(offeredIds(backgrounds(context))).isEmpty();
    assertThat(context.pluginStatus().detail()).contains("redirects");
  }

  @Test
  void aServiceExceptionOrAnotherStatusIsAFailure() throws Exception {
    FakePluginContext context = start(standardSettings());
    context.upstream().respond(CAPS_130, 200, xml(), Bytes.utf8("<ServiceExceptionReport><ServiceException>boom</ServiceException></ServiceExceptionReport>"));
    context.runUntilIdle();
    assertThat(context.pluginStatus().detail()).contains("boom");

    context.upstream().respond(CAPS_130, 404, xml(), Bytes.empty());
    context.advance(Duration.ofSeconds(70));
    assertThat(context.pluginStatus().detail()).contains("HTTP 404");
  }

  // ---------------------------------------------------------------- the layer list

  @Test
  void theLayerListNeedsSettingsAdmin() throws Exception {
    FakePluginContext context = started(standardSettings());
    User nobody = User.of("nobody", "A user without permissions", Set.of());
    User editor = User.of("editor", "An editor", Set.of("objects.edit", "layers.edit"));

    FakeHttpExchange denied = context.call("/servers/geo/layers", nobody);
    FakeHttpExchange alsoDenied = context.call("/servers/geo/layers", editor);
    FakeHttpExchange admin = context.call("/servers/geo/layers", User.of("admin", "An admin", Set.of("settings.admin")));
    context.runUntilIdle();

    assertThat(denied.reply().status()).isEqualTo(403);
    assertThat(alsoDenied.reply().status()).isEqualTo(403);
    assertThat(admin.reply().status()).isEqualTo(200);
  }

  @Test
  void theLayerListGivesNameTitleAndProjectionsInTheCapabilitiesOrder() throws Exception {
    FakePluginContext context = started(standardSettings());

    JsonObject answer = get(context, "/servers/geo/layers");

    assertThat(answer.getString("server")).isEqualTo("geo");
    List<JsonValue> layers = ((JsonArray) answer.get("layers")).values();
    assertThat(layers).extracting(l -> ((JsonObject) l).getString("name")).containsExactly("land", "sea", "group", "child", "nested");
    JsonObject land = (JsonObject) layers.getFirst();
    assertThat(land.getString("title")).isEqualTo("Land");
    assertThat(strings(land.get("projections"))).containsExactly("EPSG:4326", "EPSG:3857", "EPSG:3413");
    assertThat(answer.getString("readAt")).startsWith("20");
    assertThat(answer.get("error")).isEqualTo(dev.emcc.sdk.json.JsonNull.INSTANCE);
  }

  @Test
  void refreshReadsTheCapabilitiesAgainBeforeAnswering() throws Exception {
    FakePluginContext context = started(standardSettings());
    context.upstream().respond(CAPS_130, 200, xml(), capabilitiesWithoutPolar());

    JsonObject answer = get(context, "/servers/geo/layers?refresh=true");

    assertThat(callsTo(context, CAPS_130)).isEqualTo(2);
    assertThat(((JsonArray) answer.get("layers")).values()).extracting(l -> ((JsonObject) l).getString("name")).containsExactly("land", "sea");
    // and the backgrounds follow what was read
    assertThat(strings(((JsonObject) ((JsonArray) backgrounds(context).get("backgrounds")).values().getFirst()).get("projections"))).containsExactly("EPSG:4326", "EPSG:3857");
  }

  @Test
  void refreshOfAServerThatFailsAnswersTheReason() throws Exception {
    FakePluginContext context = started(standardSettings());
    context.upstream().fail(CAPS_130, "connection refused");

    JsonObject answer = get(context, "/servers/geo/layers?refresh=true");

    assertThat(answer.getString("error")).contains("connection refused");
  }

  @Test
  void theLayerListOfAServerThatIsNotSavedIsNotFound() throws Exception {
    FakePluginContext context = started(standardSettings());

    FakeHttpExchange call = context.call("/servers/unknown/layers");
    context.runUntilIdle();

    assertThat(call.reply().status()).isEqualTo(404);
    assertThat(context.httpCalls()).hasSize(1);
  }

  @Test
  void theLayerListAsksNoAddressOfTheRequest() throws Exception {
    FakePluginContext context = started(standardSettings());

    get(context, "/servers/geo/layers?refresh=true&url=http%3A%2F%2Fevil.example%2F");

    assertThat(context.httpCalls()).allSatisfy(call -> assertThat(call.uri().getHost()).isEqualTo("wms.test"));
  }
}
