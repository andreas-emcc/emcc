package dev.emcc.plugins.nvg.links;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.nvg.Rig;
import dev.emcc.plugins.nvg.Xsd;
import dev.emcc.plugins.nvg.codec.Item;
import dev.emcc.plugins.nvg.codec.Limits;
import dev.emcc.plugins.nvg.codec.NvgDocument;
import dev.emcc.plugins.nvg.codec.NvgReader;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Meta;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.TestJson;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The {@code soap-provider} link, called as another system calls it (criterion 15). */
class ProviderTest {

  private static final String GET_NVG = "<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Body>"
      + "<ns2:GetNvg xmlns:ns2=\"https://tide.act.nato.int/wsdl/2012/nvg\"/></soap:Body></soap:Envelope>";
  private static final String GET_CAPABILITIES = "<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Body>"
      + "<ns2:GetCapabilities xmlns:ns2=\"https://tide.act.nato.int/wsdl/2012/nvg\"/></soap:Body></soap:Envelope>";

  private FakePluginContext ctx;
  private Layer units;
  private Layer other;
  private MapObject plain;
  private MapObject secret;
  private MapObject echoed;

  @BeforeEach
  void start() {
    Rig rig = Rig.start(FakePluginContext.builder("nvg").settings(Rig.defaults()), c -> {});
    ctx = rig.context;
    units = rig.layer("Units", null, false);
    other = rig.layer("Other", null, false);
    plain = seed(units, "manual", SecurityLabel.of("NATO", "UNCLASSIFIED"));
    secret = seed(units, "manual", SecurityLabel.of("NATO", "SECRET"));
    echoed = seed(units, "out", SecurityLabel.of("NATO", "UNCLASSIFIED"));
    seed(other, "manual", SecurityLabel.of("NATO", "UNCLASSIFIED"));
    ctx.changeSettings((JsonObject) TestJson.parse("{\"maxDocumentMegabytes\": 16, \"links\": ["
        + "{\"name\": \"out\", \"kind\": \"soap-provider\", \"sourceLayers\": [{\"id\": \"" + units.id() + "\", \"name\": \"Units\"}],"
        + " \"highestClassification\": {\"policy\": \"NATO\", \"classification\": \"RESTRICTED\"}},"
        + "{\"name\": \"off\", \"kind\": \"soap-provider\", \"enabled\": false, \"sourceLayers\": [{\"id\": \"" + units.id() + "\", \"name\": \"Units\"}]}]}"));
    ctx.runUntilIdle();
  }

  private MapObject seed(Layer layer, String dataSource, SecurityLabel label) {
    var audit = new Meta.Audit(ctx.clock(), Actor.plugin("draw-symbols"));
    MapObject o = new MapObject(UUID.randomUUID(), 1, new MapObjectContent(MapObjectContent.SYMBOL, "core.general", dataSource, null, layer.id(),
        new Geometry.Point(Position.of(15.2, 58.4)), new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null), null, null, label,
        Extensions.empty()), new Meta(audit, audit, null));
    ctx.store().seed(o);
    return o;
  }

  private FakeHttpExchange call(String link, String contentType, String body) {
    FakeHttpExchange call = ctx.serviceRequest("POST", "/nvg/" + link, Headers.of("Content-Type", contentType), Bytes.utf8(body), "10.0.0.7");
    ctx.runUntilIdle();
    return call;
  }

  private static NvgDocument document(FakeHttpExchange call) {
    Soap.Unwrapped u = Soap.unwrapNvg(call.reply().body(), Limits.DEFAULT.maxBytes());
    assertThat(u.nvg()).as(call.reply().body().toUtf8()).isNotNull();
    Xsd.validate(u.nvg());
    return NvgReader.read(u.nvg(), Limits.DEFAULT).document();
  }

  @Test
  void criterion15_getCapabilitiesListsTheSourceLayers() {
    FakeHttpExchange call = call("out", "text/xml; charset=utf-8", GET_CAPABILITIES);
    assertThat(call.reply().status()).isEqualTo(200);
    Soap.Capabilities caps = Soap.readCapabilities(call.reply().body());
    assertThat(caps.items()).containsExactly(new Soap.CapabilityItem("select", "layers", "Layers", ""));
    assertThat(call.reply().body().toUtf8()).contains("id=\"" + units.id() + "\"").contains("name=\"Units\"");
  }

  @Test
  void criterion15_getNvgAnswersTheObjectsWithoutAboveTheLimitOrFromThisLink() {
    FakeHttpExchange call = call("out", "text/xml; charset=utf-8", GET_NVG);
    assertThat(call.reply().status()).isEqualTo(200);
    assertThat(call.reply().headers().first("Content-Type")).startsWith("text/xml");
    NvgDocument doc = document(call);
    assertThat(doc.items()).extracting(Item::uri).containsExactly("urn:uuid:" + plain.id())
        .doesNotContain("urn:uuid:" + secret.id(), "urn:uuid:" + echoed.id());
    assertThat(doc.items().getFirst().groupPath()).containsExactly("Units");
    assertThat(ctx.effectiveStatus().detail()).contains("out: 1 calls answered, last from 10.0.0.7");
  }

  @Test
  void criterion15_afterADeleteTheNextAnswerLacksIt() {
    ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.deleteObject(ctx.store().object(plain.id())));
    ctx.runUntilIdle();
    assertThat(document(call("out", "text/xml", GET_NVG)).items()).isEmpty();
  }

  @Test
  void criterion15_theFilterChoosesLayers() {
    String chosen = "<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Body><ns2:GetNvg xmlns:ns2=\"https://tide.act.nato.int/wsdl/2012/nvg\">"
        + "<nvg_filter xmlns=\"https://tide.act.nato.int/schemas/2012/10/nvg\" version=\"2.0.2\"><select_response refid=\"layers\"><selected>"
        + UUID.randomUUID() + "</selected></select_response></nvg_filter></ns2:GetNvg></soap:Body></soap:Envelope>";
    assertThat(document(call("out", "text/xml", chosen)).items()).isEmpty();
  }

  @Test
  void criterion15_anUnknownOrDisabledLinkAnswers404() {
    assertThat(call("nobody", "text/xml", GET_NVG).reply().status()).isEqualTo(404);
    assertThat(call("off", "text/xml", GET_NVG).reply().status()).isEqualTo(404);
  }

  @Test
  void criterion15_aSoap12RequestGetsASoap12Answer() {
    String request = GET_NVG.replace("http://schemas.xmlsoap.org/soap/envelope/", "http://www.w3.org/2003/05/soap-envelope");
    FakeHttpExchange call = call("out", "application/soap+xml; charset=utf-8", request);
    assertThat(call.reply().status()).isEqualTo(200);
    assertThat(call.reply().headers().first("Content-Type")).startsWith("application/soap+xml");
    assertThat(call.reply().body().toUtf8()).contains("http://www.w3.org/2003/05/soap-envelope");
    assertThat(document(call).items()).hasSize(1);
  }

  @Test
  void criterion15_anyOtherBodyGetsAFault() {
    for (String body : List.of("not xml", "<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Body><x:Other xmlns:x=\"urn:x\"/></soap:Body></soap:Envelope>",
        "<?xml version=\"1.0\"?><!DOCTYPE x [<!ENTITY e SYSTEM \"file:///c:/windows/win.ini\">]><x>&e;</x>")) {
      FakeHttpExchange call = call("out", "text/xml", body);
      assertThat(call.reply().status()).isEqualTo(500);
      assertThat(call.reply().body().toUtf8()).contains("Fault").contains("soap:Client");
    }
  }

  @Test
  void channelItemsAreServedAndARemovalDropsThem() {
    UUID id = UUID.randomUUID();
    MapObjectContent content = new MapObjectContent(MapObjectContent.SYMBOL, "core.general", "simulator", null, units.id(),
        new Geometry.Point(Position.of(16.1, 57.2)), new Symbol(SymbolStandard.APP_6D, "10061000001211000000", null), null, null,
        SecurityLabel.of("NATO", "UNCLASSIFIED"), Extensions.empty());
    ctx.channels().deliver(new ChannelId("nvg", "out"), new ChannelItem.Update(id, content));
    ctx.runUntilIdle();
    assertThat(document(call("out", "text/xml", GET_NVG)).items()).extracting(Item::uri).contains("urn:uuid:" + id);
    ctx.channels().deliver(new ChannelId("nvg", "out"), new ChannelItem.Removal(id));
    ctx.runUntilIdle();
    assertThat(document(call("out", "text/xml", GET_NVG)).items()).extracting(Item::uri).doesNotContain("urn:uuid:" + id);
  }

  @Test
  void theOutputChannelIsOfferedPerEnabledLink() {
    assertThat(ctx.channels().offered()).extracting(i -> i.id().link()).containsExactly("out");
  }
}
