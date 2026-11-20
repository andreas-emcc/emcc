package dev.emcc.plugins.nvg.links;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.nvg.Rig;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpCall;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.TestJson;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The {@code soap-consumer} link against a fake provider (criterion 14). */
class ConsumerTest {

  static final String URL = "http://localhost:8380/cxf/nvg/20";

  private static final String POINT_A = "<point uri=\"urn:anet:reports:a\" x=\"17.3069\" y=\"62.3908\" symbol=\"app06:100340000013100000000000000000\" label=\"Sundsvall\"/>";
  private static final String POINT_B = "<point uri=\"urn:anet:reports:b\" x=\"18.0686\" y=\"59.3293\" symbol=\"app06:100340000013100000000000000000\" label=\"Stockholm\"/>";

  static Bytes answer(String version, String items) {
    return Bytes.utf8("<?xml version=\"1.0\" encoding=\"UTF-8\"?><soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Body>"
        + "<ns2:GetNvgResponse xmlns:ns2=\"https://tide.act.nato.int/wsdl/2012/nvg\"><nvg xmlns=\"https://tide.act.nato.int/schemas/2012/10/nvg\" version=\""
        + version + "\">" + items + "</nvg></ns2:GetNvgResponse></soap:Body></soap:Envelope>");
  }

  static Bytes fault(String text) {
    return Bytes.utf8("<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Body><soap:Fault>"
        + "<faultcode>soap:Server</faultcode><faultstring>" + text + "</faultstring></soap:Fault></soap:Body></soap:Envelope>");
  }

  private static JsonObject settings(String extra) {
    return settings(60, "1", extra);
  }

  private static JsonObject settings(int interval, String pastDays, String extra) {
    return (JsonObject) TestJson.parse("{\"maxDocumentMegabytes\": 16, \"links\": [{\"name\": \"anet\", \"kind\": \"soap-consumer\", \"url\": \"" + URL
        + "\", \"credential\": \"anet\", \"intervalSeconds\": " + interval + ", \"timeoutSeconds\": 30, \"filter\": [{\"refid\": \"pastDays\", \"value\": \""
        + pastDays + "\"}]" + extra + "}]}");
  }

  private static Rig rig(String extra, Bytes first) {
    return rig(settings(extra), first);
  }

  private static Rig rig(JsonObject settings, Bytes first) {
    FakePluginContext.Builder b = FakePluginContext.builder("nvg").settings(settings).httpCredentials("anet");
    // The answer is scripted before the plugin starts, so that its first poll finds it.
    Rig rig = Rig.start(b, ctx -> ctx.upstream().respond(URL, 200, Headers.of("Content-Type", "text/xml; charset=utf-8"), first));
    return rig;
  }

  private static List<MapObject> objects(Rig rig) {
    return rig.context.store().objects().stream().filter(o -> o.content().dataSource().equals("anet")).toList();
  }

  private static void next(Rig rig, int status, Bytes body) {
    rig.context.upstream().respond(URL, status, Headers.of("Content-Type", "text/xml; charset=utf-8"), body);
    rig.context.advance(Duration.ofSeconds(60));
    rig.context.runUntilIdle();
  }

  private static JsonObject linkState(Rig rig) {
    FakeHttpExchange call = rig.context.call("/links", Rig.ADMIN);
    rig.context.runUntilIdle();
    JsonObject list = (JsonObject) TestJson.parse(call.reply().body().toUtf8());
    return (JsonObject) ((dev.emcc.sdk.json.JsonArray) list.get("links")).get(0);
  }

  private static long counter(Rig rig, String name) {
    JsonObject counters = linkState(rig).getObject("counters");
    return counters.has(name) ? counters.getNumber(name).longValueExact() : 0;
  }

  @Test
  void criterion14_aPollCreatesItsItemsInANewLayerNamedLikeTheLink() {
    Rig rig = rig("", answer("2.0.2", POINT_A + POINT_B));
    List<MapObject> objects = objects(rig);
    assertThat(objects).hasSize(2);
    Layer layer = rig.context.store().layers().stream().filter(l -> l.content().name().equals("anet")).findFirst().orElseThrow();
    assertThat(objects).allSatisfy(o -> {
      assertThat(o.content().layerId()).isEqualTo(layer.id());
      assertThat(o.content().dataType()).isEqualTo("core.general");
      assertThat(o.meta().externalRef().system()).isEqualTo("anet");
      assertThat(o.content().symbol().sidc()).isEqualTo("10034000001310000000");
    });
    assertThat(rig.context.effectiveStatus().state()).isEqualTo(PluginState.OK);
    assertThat(rig.context.effectiveStatus().detail()).contains("anet: ").contains("2 items, 2 created, 0 updated, 0 deleted");
  }

  @Test
  void criterion14_theCallCarriesSoapActionTheFilterAndTheCredential() {
    Rig rig = rig("", answer("2.0.2", POINT_A));
    HttpCall call = rig.context.httpCalls().getFirst();
    assertThat(call.method()).isEqualTo("POST");
    assertThat(call.uri().toString()).isEqualTo(URL);
    assertThat(call.headers().first("SOAPAction")).isEqualTo("\"https://tide.act.nato.int/wsdl/2012/nvg/GetNvg\"");
    assertThat(call.mediaType()).isEqualTo("text/xml; charset=utf-8");
    assertThat(call.credential()).isEqualTo("anet");
    assertThat(call.body().toUtf8()).contains("nvg_filter").contains("refid=\"pastDays\"").contains(">1</");
  }

  @Test
  void criterion14_theNextDocumentWithoutAnItemDeletesItAndKeepsTheOther() {
    Rig rig = rig("", answer("2.0.2", POINT_A + POINT_B));
    next(rig, 200, answer("2.0.2", POINT_A));
    assertThat(objects(rig)).extracting(o -> o.meta().externalRef().id()).containsExactly("urn:anet:reports:a");
    // An unchanged item is not sent again.
    int requests = rig.context.store().requests().size();
    next(rig, 200, answer("2.0.2", POINT_A));
    assertThat(rig.context.store().requests()).hasSize(requests);
  }

  @Test
  void criterion14_aFaultAn500ATimeoutAndARefusedDocumentChangeNothing() {
    Rig rig = rig("", answer("2.0.2", POINT_A + POINT_B));
    next(rig, 500, fault("403 FORBIDDEN Must provide a valid Web Service Access Token"));
    assertThat(objects(rig)).hasSize(2);
    assertThat(counter(rig, "SOAP fault")).isEqualTo(1);
    assertThat(rig.context.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);

    next(rig, 500, Bytes.utf8("Internal Server Error"));
    assertThat(objects(rig)).hasSize(2);
    next(rig, 503, Bytes.utf8("unavailable"));
    assertThat(counter(rig, "HTTP 503")).isEqualTo(1);

    rig.context.upstream().never(URL);
    rig.context.advance(Duration.ofSeconds(60));
    rig.context.runUntilIdle();
    rig.context.advance(Duration.ofSeconds(31));
    rig.context.runUntilIdle();
    assertThat(counter(rig, "call failed")).isEqualTo(1);
    assertThat(objects(rig)).hasSize(2);

    next(rig, 200, answer("1.5", POINT_A));
    assertThat(counter(rig, "refused: version")).isEqualTo(1);
    next(rig, 200, Bytes.utf8("<?xml version=\"1.0\"?><!DOCTYPE x [<!ENTITY e SYSTEM \"file:///c:/windows/win.ini\">]><soap:Envelope "
        + "xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Body>&e;</soap:Body></soap:Envelope>"));
    assertThat(counter(rig, "refused: DTD")).isEqualTo(1);
    assertThat(objects(rig)).hasSize(2);

    // Back to a good answer: OK again.
    next(rig, 200, answer("2.0.2", POINT_A + POINT_B));
    assertThat(rig.context.effectiveStatus().state()).isEqualTo(PluginState.OK);
  }

  @Test
  void criterion14_anEmptyDocumentChangesNothingUnlessClearOnEmpty() {
    Rig rig = rig("", answer("2.0.2", POINT_A + POINT_B));
    next(rig, 200, answer("2.0.2", ""));
    assertThat(objects(rig)).hasSize(2);

    Rig clearing = rig(", \"clearOnEmpty\": true", answer("2.0.2", POINT_A + POINT_B));
    next(clearing, 200, answer("2.0.2", ""));
    assertThat(objects(clearing)).isEmpty();
  }

  @Test
  void criterion14_aCallStillRunningSkipsTheTurn() {
    Rig rig = rig(settings(10, "1", ""), answer("2.0.2", POINT_A));
    rig.context.upstream().respondAfter(Duration.ofSeconds(25), URL, 200, Headers.empty(), answer("2.0.2", POINT_A + POINT_B));
    rig.context.advance(Duration.ofSeconds(10));
    rig.context.runUntilIdle();
    rig.context.advance(Duration.ofSeconds(10));
    rig.context.runUntilIdle();
    rig.context.advance(Duration.ofSeconds(10));
    rig.context.runUntilIdle();
    assertThat(counter(rig, "skipped turn")).isGreaterThanOrEqualTo(2);
  }

  @Test
  void withoutTheCredentialConfiguredTheCallFailsAtOnce() {
    JsonObject s = settings("");
    Rig rig = Rig.start(FakePluginContext.builder("nvg").settings(s), ctx -> {});
    assertThat(counter(rig, "call failed")).isEqualTo(1);
    assertThat(linkState(rig).getString("detail")).contains("no credential anet");
  }

  @Test
  void aSettingsChangeAppliesAtTheNextPollWithoutARestart() {
    Rig rig = rig("", answer("2.0.2", POINT_A));
    rig.context.changeSettings(settings(60, "7", ""));
    rig.context.runUntilIdle();
    next(rig, 200, answer("2.0.2", POINT_A));
    assertThat(rig.context.httpCalls().getLast().body().toUtf8()).contains(">7</");
  }

  @Test
  void nv1_getCapabilitiesListsTheProvidersFilterItemsForAdmins() {
    Rig rig = rig("", answer("2.0.2", POINT_A));
    rig.context.upstream().respond(URL, 200, Headers.empty(), Bytes.utf8("<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Body>"
        + "<ns2:GetCapabilitiesResponse xmlns:ns2=\"https://tide.act.nato.int/wsdl/2012/nvg\"><nvg_capabilities xmlns=\"https://tide.act.nato.int/schemas/2012/10/nvg\" version=\"2.0.2\">"
        + "<input id=\"accessToken\" name=\"Access token\" type=\"string\" required=\"true\"/><input id=\"pastDays\" name=\"Past days\" type=\"int\"/>"
        + "<select id=\"app6Version\" name=\"APP-6 version\"><values><value id=\"app6b\" name=\"B\"/></values></select>"
        + "</nvg_capabilities></ns2:GetCapabilitiesResponse></soap:Body></soap:Envelope>"));
    FakeHttpExchange call = rig.context.post("/links/anet/capabilities", JsonObject.empty(), Rig.ADMIN);
    rig.context.runUntilIdle();
    assertThat(call.reply().status()).isEqualTo(200);
    JsonObject reply = (JsonObject) TestJson.parse(call.reply().body().toUtf8());
    assertThat(((dev.emcc.sdk.json.JsonArray) reply.get("items")).size()).isEqualTo(3);
    assertThat(rig.context.httpCalls().getLast().headers().first("SOAPAction")).isEqualTo("\"https://tide.act.nato.int/wsdl/2012/nvg/GetCapabilities\"");
    assertThat(((dev.emcc.sdk.json.JsonArray) linkState(rig).get("capabilities")).size()).isEqualTo(3);
    // Not for others.
    FakeHttpExchange refused = rig.context.post("/links/anet/capabilities", JsonObject.empty(), Rig.EDITOR);
    assertThat(refused.reply().status()).isEqualTo(403);
  }
}
