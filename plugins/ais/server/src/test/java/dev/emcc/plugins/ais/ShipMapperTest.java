package dev.emcc.plugins.ais;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.ais.codec.AisDecoder;
import dev.emcc.plugins.ais.codec.AisMessage;
import dev.emcc.plugins.ais.codec.AisStatic;
import dev.emcc.plugins.ais.codec.Ais;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.model.TextModifier;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ShipMapperTest {

  private static final UUID LAYER = UUID.fromString("018b2f4e-0000-7000-8000-000000000001");
  private static final Instant AT = Instant.parse("2026-10-31T10:00:00Z");
  private static final ShipMapper.Placement PLACEMENT =
      new ShipMapper.Placement("harbour", LAYER, SecurityLabel.of("NATO", "UNCLASSIFIED"), StandardIdentity.NEUTRAL);

  private static AisMessage.Position position(Ais.Msg m) {
    return (AisMessage.Position) AisDecoder.decode(m.payload(), m.fill()).message();
  }

  private static JsonObject ais(MapObjectContent c) {
    return c.extensions().get("ais");
  }

  @Test
  void aShipIsAPointWithLongitudeFirst() {
    AisMessage.Position m = position(Ais.classA(1, 265_123_456, 5, 100, 18.0723, 59.3311, 2705, 90));
    MapObjectContent c = ShipMapper.position(PLACEMENT, m, m.statics(), AT, null);
    var point = (Geometry.Point) c.geometry();
    assertThat(point.coordinates().longitude()).isCloseTo(18.0723, within(1e-6));
    assertThat(point.coordinates().latitude()).isCloseTo(59.3311, within(1e-6));
    assertThat(c.type()).isEqualTo("core.symbol");
    assertThat(c.dataType()).isEqualTo("ais.vessel");
    assertThat(c.dataSource()).isEqualTo("harbour");
    assertThat(c.layerId()).isEqualTo(LAYER);
    assertThat(c.label()).isEqualTo(PLACEMENT.label());
    assertThat(c.time().observed()).isEqualTo(AT);
    assertThat(c.symbol().modifiers().direction()).isEqualTo(270.5);
    assertThat(c.symbol().modifiers().speed()).isCloseTo(5.144, within(0.001));
    assertThat(((JsonNumber) ais(c).get("heading")).longValueExact()).isEqualTo(90);
    assertThat(((JsonNumber) ais(c).get("navStatus")).longValueExact()).isEqualTo(5);
    assertThat(((JsonString) ais(c).get("class")).value()).isEqualTo("A");
    assertThat(c.extensions().namespaces()).containsOnlyKeys("ais");
  }

  @Test
  void withoutANameTheMmsiIsTheName() {
    AisMessage.Position m = position(Ais.classA(1, 2_190_047, 0, 0, 1, 2, 0, 0));
    MapObjectContent c = ShipMapper.position(PLACEMENT, m, m.statics(), AT, null);
    assertThat(c.properties().name()).isEqualTo("002190047");
    assertThat(c.symbol().modifiers().text(TextModifier.UNIQUE_DESIGNATION)).isEqualTo("002190047");
    assertThat(ShipMapper.externalRef(2_190_047).id()).isEqualTo("002190047");
    assertThat(ShipMapper.externalRef(2_190_047).system()).isEqualTo("ais");
  }

  @Test
  void notAvailableValuesLeaveModifiersAndExtensionFieldsOut() {
    AisMessage.Position m = position(Ais.classA(1, 1, 15, 1023, 1, 2, 3600, 511));
    MapObjectContent c = ShipMapper.position(PLACEMENT, m, m.statics(), AT, null);
    assertThat(c.symbol().modifiers().direction()).isNull();
    assertThat(c.symbol().modifiers().speed()).isNull();
    assertThat(ais(c).has("heading")).isFalse();
    assertThat(ais(c).has("navStatus")).isFalse();
  }

  @Test
  void theStaticDataGoesIntoTheNameTheExtensionAndTheSymbol() {
    var voyage = Ais.voyage(366_000_001, 9_074_729, "WDC1234", "TESTSHIP", 71, 100, 20, 10, 12, 85, "STOCKHOLM");
    AisStatic st = ((AisMessage.StaticReport) AisDecoder.decode(voyage.payload(), voyage.fill()).message()).statics();
    AisMessage.Position m = position(Ais.classA(1, 366_000_001, 0, 0, 1, 2, 0, 0));
    MapObjectContent c = ShipMapper.position(PLACEMENT, m, st.merge(m.statics()), AT, null);
    assertThat(c.properties().name()).isEqualTo("TESTSHIP");
    assertThat(c.symbol().modifiers().text(TextModifier.UNIQUE_DESIGNATION)).isEqualTo("TESTSHIP");
    assertThat(c.symbol().standard()).isEqualTo(SymbolStandard.APP_6D);
    assertThat(c.symbol().sidc()).isEqualTo("10043000001401000000");
    JsonObject e = ais(c);
    assertThat(((JsonString) e.get("callSign")).value()).isEqualTo("WDC1234");
    assertThat(((JsonNumber) e.get("imo")).longValueExact()).isEqualTo(9_074_729);
    assertThat(((JsonNumber) e.get("shipType")).longValueExact()).isEqualTo(71);
    assertThat(((JsonNumber) e.get("length")).longValueExact()).isEqualTo(120);
    assertThat(((JsonNumber) e.get("beam")).longValueExact()).isEqualTo(22);
    assertThat(((JsonNumber) e.get("draught")).doubleValue()).isEqualTo(8.5);
    assertThat(((JsonString) e.get("destination")).value()).isEqualTo("STOCKHOLM");
  }

  @Test
  void theSidcFollowsTheShipTypeAndTheIdentity() {
    assertThat(ShipMapper.sidc(StandardIdentity.UNKNOWN, 30)).isEqualTo("10013000001402000000");
    assertThat(ShipMapper.sidc(StandardIdentity.UNKNOWN, 65)).isEqualTo("10013000001401100000");
    assertThat(ShipMapper.sidc(StandardIdentity.FRIEND, 71)).isEqualTo("10033000001401000000");
    assertThat(ShipMapper.sidc(StandardIdentity.HOSTILE, 84)).isEqualTo("10063000001401090000");
    assertThat(ShipMapper.sidc(StandardIdentity.NEUTRAL, 0)).isEqualTo("10043000001400000000");
    assertThat(ShipMapper.sidc(StandardIdentity.NEUTRAL, null)).isEqualTo("10043000001400000000");
    for (String sidc : new String[] {ShipMapper.sidc(StandardIdentity.UNKNOWN, 65), ShipMapper.sidc(StandardIdentity.UNKNOWN, 99)}) {
      assertThat(sidc).hasSize(20).matches("[0-9]{20}");
    }
  }

  @Test
  void aStaticMessageForAnExistingShipKeepsItsPositionAndTime() {
    AisMessage.Position m = position(Ais.classA(1, 366_000_001, 5, 100, 18.0723, 59.3311, 2705, 90));
    MapObjectContent stored = ShipMapper.position(PLACEMENT, m, m.statics(), AT, null);
    AisStatic said = new AisStatic("NEWNAME", null, null, 80, null, null, null, null, null);
    MapObjectContent c = ShipMapper.refresh(stored, 366_000_001, m.statics().merge(said), StandardIdentity.NEUTRAL);
    assertThat(c.geometry()).isEqualTo(stored.geometry());
    assertThat(c.time()).isEqualTo(stored.time());
    assertThat(c.symbol().modifiers().direction()).isEqualTo(270.5);
    assertThat(c.symbol().modifiers().speed()).isEqualTo(stored.symbol().modifiers().speed());
    assertThat(((JsonNumber) ais(c).get("heading")).longValueExact()).isEqualTo(90);
    assertThat(((JsonNumber) ais(c).get("navStatus")).longValueExact()).isEqualTo(5);
    assertThat(c.properties().name()).isEqualTo("NEWNAME");
    assertThat(c.symbol().sidc()).isEqualTo("10043000001401090000");
    assertThat(c.layerId()).isEqualTo(LAYER);
    assertThat(c.dataSource()).isEqualTo("harbour");
  }

  @Test
  void whatTheStoredShipKnowsComesBackAsStatics() {
    var voyage = Ais.voyage(366_000_001, 9_074_729, "WDC1234", "TESTSHIP", 71, 100, 20, 10, 12, 85, "STOCKHOLM");
    AisStatic st = ((AisMessage.StaticReport) AisDecoder.decode(voyage.payload(), voyage.fill()).message()).statics();
    AisMessage.Position m = position(Ais.classA(1, 366_000_001, 0, 0, 1, 2, 0, 0));
    AisStatic back = ShipMapper.staticsOf(ShipMapper.position(PLACEMENT, m, st.merge(m.statics()), AT, null));
    assertThat(back).isEqualTo(st);
    // a name that is only the MMSI is no name
    AisStatic nameless = ShipMapper.staticsOf(ShipMapper.position(PLACEMENT, m, m.statics(), AT, null));
    assertThat(nameless.name()).isNull();
  }

  @Test
  void theIdentitySettingHasItsNames() {
    assertThat(StandardIdentity.fromJson("unknown")).isEqualTo(StandardIdentity.UNKNOWN);
    assertThat(StandardIdentity.fromJson("assumed-friend")).isEqualTo(StandardIdentity.ASSUMED_FRIEND);
    assertThat(StandardIdentity.fromJson("hostile").digit()).isEqualTo('6');
    assertThat(StandardIdentity.fromJson("nonsense")).isNull();
    assertThat(StandardIdentity.ofDigit('4')).isEqualTo(StandardIdentity.NEUTRAL);
    assertThat(StandardIdentity.ofDigit('x')).isEqualTo(StandardIdentity.UNKNOWN);
  }
}
