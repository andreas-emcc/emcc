package dev.emcc.plugins.cot.codec;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Style;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.model.TextModifier;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class CotMapperTest {

  private static final UUID LAYER = UUID.fromString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e02");
  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final Placement NORTH = new Placement("tak-north", LAYER, LABEL, null);

  private final CotXml xml = new CotXml();

  @Test
  void anAtomBecomesASymbolAtTheRightPosition() throws Exception {
    MapObjectContent content = CotMapper.toContent(xml.parse(Samples.UNIT), NORTH);
    assertThat(content.type()).isEqualTo("core.symbol");
    assertThat(content.dataType()).isEqualTo("cot.cot");
    assertThat(content.dataSource()).isEqualTo("tak-north");
    assertThat(content.layerId()).isEqualTo(LAYER);
    assertThat(content.label()).isEqualTo(LABEL);
    // [lon, lat] with lat 59.3507 and lon 18.1012: a swap would put the object in the Indian Ocean, and Position would refuse a latitude above 90
    assertThat(content.geometry()).isEqualTo(new Geometry.Point(Position.of(18.1012, 59.3507, 45.2)));
  }

  @Test
  void theSymbolIsAnApp6bSidcWithDirectionAndSpeed() throws Exception {
    MapObjectContent content = CotMapper.toContent(xml.parse(Samples.UNIT), NORTH);
    assertThat(content.symbol().standard()).isEqualTo(SymbolStandard.APP_6B);
    assertThat(content.symbol().sidc()).isEqualTo("SFGPUCI--------");
    assertThat(content.symbol().modifiers().direction()).isEqualTo(270.0);
    assertThat(content.symbol().modifiers().speed()).isEqualTo(4.2);
  }

  @Test
  void theCallsignIsAlsoTheTextNextToTheSymbol() throws Exception {
    MapObjectContent content = CotMapper.toContent(xml.parse(Samples.UNIT), NORTH);
    assertThat(content.symbol().modifiers().text(TextModifier.UNIQUE_DESIGNATION)).isEqualTo("VIPER 2");
    String longCallsign = "<event uid=\"a\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"/><detail><contact callsign=\"" + "x".repeat(200) + "\"/></detail></event>";
    MapObjectContent cut = CotMapper.toContent(xml.parse(longCallsign), NORTH);
    assertThat(cut.properties().name()).hasSize(200);
    assertThat(cut.symbol().modifiers().text(TextModifier.UNIQUE_DESIGNATION)).hasSize(128);
  }

  @Test
  void callsignAndRemarksBecomeNameAndDescription() throws Exception {
    MapObjectContent content = CotMapper.toContent(xml.parse(Samples.UNIT), NORTH);
    assertThat(content.properties().name()).isEqualTo("VIPER 2");
    assertThat(content.properties().description()).isEqualTo("On patrol");
  }

  @Test
  void timeStartAndStaleBecomeTheTimeAttributes() throws Exception {
    MapObjectContent content = CotMapper.toContent(xml.parse(Samples.UNIT), NORTH);
    assertThat(content.time().observed()).isEqualTo(Instant.parse("2026-10-03T08:20:00.000Z"));
    assertThat(content.time().validFrom()).isEqualTo(Instant.parse("2026-10-03T08:20:00.000Z"));
    assertThat(content.time().expires()).isEqualTo(Instant.parse("2026-10-03T08:25:00.000Z"));
  }

  @Test
  void aStartAfterTheStaleTimeIsLeftOutSoTheModelAcceptsTheObject() throws Exception {
    String text = "<event uid=\"a\" type=\"a-f-G\" time=\"2026-10-03T08:00:00Z\" start=\"2026-10-03T09:00:00Z\" stale=\"2026-10-03T08:30:00Z\">"
        + "<point lat=\"1.5\" lon=\"2.5\"/></event>";
    MapObjectContent content = CotMapper.toContent(xml.parse(text), NORTH);
    assertThat(content.time().validFrom()).isNull();
    assertThat(content.time().expires()).isEqualTo(Instant.parse("2026-10-03T08:30:00Z"));
  }

  @Test
  void anUnknownHeightLeavesTheAltitudeOut() throws Exception {
    MapObjectContent content = CotMapper.toContent(xml.parse(Samples.at("u1", 0, 57.7089, 11.9746)), NORTH);
    assertThat(((Geometry.Point) content.geometry()).coordinates()).isEqualTo(Position.of(11.9746, 57.7089));
    assertThat(((Geometry.Point) content.geometry()).coordinates().altitude()).isNull();
  }

  @Test
  void aSouthernAndWesternPositionKeepsItsSigns() throws Exception {
    MapObjectContent content = CotMapper.toContent(xml.parse(Samples.at("u1", 0, -33.8688, -70.6693)), NORTH);
    assertThat(((Geometry.Point) content.geometry()).coordinates()).isEqualTo(Position.of(-70.6693, -33.8688));
  }

  @Test
  void courseIsNormalisedAndUnknownValuesAreLeftOut() throws Exception {
    String text = "<event uid=\"a\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"/><detail><track course=\"-90\" speed=\"9999999.0\"/></detail></event>";
    MapObjectContent content = CotMapper.toContent(xml.parse(text), NORTH);
    assertThat(content.symbol().modifiers().direction()).isEqualTo(270.0);
    assertThat(content.symbol().modifiers().speed()).isNull();
    String none = "<event uid=\"a\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"/><detail><track course=\"9999999.0\" speed=\"-1\"/></detail></event>";
    assertThat(CotMapper.toContent(xml.parse(none), NORTH).symbol().modifiers()).isNull();
  }

  @Test
  void aMapPointGetsTheGenericPointSymbol() throws Exception {
    String text = "<event uid=\"wp-1\" type=\"b-m-p-w\" how=\"h-e\"><point lat=\"57.7\" lon=\"11.9\"/>"
        + "<detail><contact callsign=\"WP 1\"/></detail></event>";
    CotEvent event = xml.parse(text);
    assertThat(event.isMapPoint()).isTrue();
    MapObjectContent content = CotMapper.toContent(event, NORTH);
    assertThat(content.type()).isEqualTo("core.symbol");
    assertThat(content.symbol().sidc()).isEqualTo(CotSymbols.POINT_SIDC);
    assertThat(content.properties().name()).isEqualTo("WP 1");
  }

  @Test
  void typesThatAreNotShownAreRecognised() throws Exception {
    for (String type : new String[] {"b-t-f", "t-x-c-t", "u-d-f", "b-m-r", "b-f-t-r"}) {
      CotEvent event = xml.parse("<event uid=\"a\" type=\"" + type + "\"><point lat=\"1.5\" lon=\"2.5\"/></event>");
      assertThat(event.isShown()).as(type).isFalse();
    }
  }

  // ---------------------------------------------------------------- criterion 4: unmapped CoT is kept

  @Test
  void whatTheCoreHasNoFieldForStaysInTheCotExtension() throws Exception {
    String text = "<event version=\"2.0\" uid=\"a\" type=\"a-h-G-E-V-A\" how=\"m-g\" access=\"Undefined\" qos=\"1-r-c\" opex=\"o-\" caveat=\"FOUO\" releasableTo=\"SWE\" "
        + "time=\"2026-10-03T08:20:00Z\" stale=\"2026-10-03T08:25:00Z\"><point lat=\"1.5\" lon=\"2.5\" ce=\"12.5\" le=\"7\"/>"
        + "<detail><vendor:thing xmlns:vendor=\"urn:v\" k=\"1\"/></detail></event>";
    MapObjectContent content = CotMapper.toContent(xml.parse(text), NORTH);
    JsonObject ext = content.extensions().get("cot");
    assertThat(ext.getString("type")).isEqualTo("a-h-G-E-V-A");
    assertThat(ext.getString("how")).isEqualTo("m-g");
    assertThat(ext.getString("version")).isEqualTo("2.0");
    assertThat(ext.getString("access")).isEqualTo("Undefined");
    assertThat(ext.getString("qos")).isEqualTo("1-r-c");
    assertThat(ext.getString("opex")).isEqualTo("o-");
    assertThat(ext.getString("caveat")).isEqualTo("FOUO");
    assertThat(ext.getString("releasableTo")).isEqualTo("SWE");
    assertThat(ext.getNumber("ce").text()).isEqualTo("12.5");
    assertThat(ext.getNumber("le").text()).isEqualTo("7");
    assertThat(ext.getString("detail")).isEqualTo("<vendor:thing xmlns:vendor=\"urn:v\" k=\"1\"/>");
    assertThat(content.extensions().namespaces().keySet()).as("only the plugin's own namespace is written").containsExactly("cot");
  }

  @Test
  void anErrorOfNineNinesIsKeptExactlyAsWritten() throws Exception {
    JsonObject ext = CotMapper.toContent(xml.parse(Samples.UNIT), NORTH).extensions().get("cot");
    assertThat(ext.get("ce")).isInstanceOf(JsonNumber.class);
    assertThat(((JsonNumber) ext.get("ce")).text()).isEqualTo("9999999.0");
  }

  @Test
  void anErrorThatIsNotANumberIsLeftOutSoThatTheStoreTakesTheObject() throws Exception {
    // the declared field ce is a number (brief function 23): a text is not a value it takes
    String text = "<event uid=\"a\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\" ce=\"unknown\"/></event>";
    assertThat(CotMapper.toContent(xml.parse(text), NORTH).extensions().get("cot").get("ce")).isNull();
  }

  @Test
  void theLayerStreamLabelAndStyleComeFromThePlacement() throws Exception {
    UUID other = UUID.fromString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e99");
    SecurityLabel secret = SecurityLabel.of("NATO", "NATO SECRET");
    var style = new Style("#112233", 2.0, null, null, null, null);
    MapObjectContent content = CotMapper.toContent(xml.parse(Samples.UNIT), new Placement("tak-south", other, secret, style));
    assertThat(content.dataSource()).isEqualTo("tak-south");
    assertThat(content.layerId()).isEqualTo(other);
    assertThat(content.label()).isEqualTo(secret);
    assertThat(content.style()).isEqualTo(style);
  }

  // ---------------------------------------------------------------- the way back: see CotEncodeTest
}
