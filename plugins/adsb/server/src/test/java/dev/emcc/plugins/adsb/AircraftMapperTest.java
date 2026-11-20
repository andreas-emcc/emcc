package dev.emcc.plugins.adsb;

import static dev.emcc.plugins.adsb.Sbs1Test.msg;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.model.TextModifier;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The mapper and the aircraft's state: the brief's mapping table and acceptance criteria 2 to 7. */
class AircraftMapperTest {

  private static final UUID LAYER = UUID.fromString("0190a000-0000-7000-8000-000000000001");
  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final Instant OBSERVED = Instant.parse("2026-10-28T11:00:00Z");

  /** The state of one aircraft after the given lines, from an empty table. */
  private static Aircraft after(String... lines) {
    Aircraft aircraft = null;
    AircraftTable table = new AircraftTable();
    for (String line : lines) {
      aircraft = table.update(((Sbs1.Result.Parsed) Sbs1.parse(line)).message(), OBSERVED).aircraft();
    }
    return aircraft;
  }

  private static MapObjectContent content(Aircraft aircraft) {
    return AircraftMapper.content(aircraft, LAYER, "dump1090-north", LABEL, Identity.UNKNOWN, OBSERVED);
  }

  private static Modifiers modifiers(MapObjectContent content) {
    return content.symbol().modifiers();
  }

  @Test
  void criterion2_latitudeAndLongitudeAreSwappedIntoTheGeometry() {
    // latitude 55.6181 and longitude 12.6561 differ, so a swap would show.
    var content = content(after(Sbs1Test.position("55.6181", "12.6561")));
    var point = (Geometry.Point) content.geometry();
    assertThat(point.coordinates().longitude()).isEqualTo(12.6561);
    assertThat(point.coordinates().latitude()).isEqualTo(55.6181);
  }

  @Test
  void criterion2_anEmptyPositionGivesNoObject() {
    Aircraft aircraft = after(Sbs1Test.position("", "12.6561"));
    assertThat(aircraft.hasPosition()).isFalse();
  }

  @Test
  void criterion4_groundSpeedInKnotsBecomesMetresPerSecond() {
    var content = content(after(msg(2, "4CA2D6", "", "", "450", "270", "55.6181", "12.6561", "", "", "", "0")));
    assertThat(modifiers(content).speed()).isCloseTo(231.5, org.assertj.core.data.Offset.offset(0.1));
    assertThat(modifiers(content).direction()).isEqualTo(270.0);
  }

  @Test
  void criterion4_aTrackOf360IsNorth() {
    var content = content(after(msg(2, "4CA2D6", "", "", "450", "360", "55.6181", "12.6561", "", "", "", "0")));
    assertThat(modifiers(content).direction()).isEqualTo(0.0);
  }

  @Test
  void criterion5_altitudeIsAFlightLevelAndTheExtensionKeepsFeet() {
    var content = content(after(Sbs1Test.position("55.6181", "12.6561")));
    assertThat(modifiers(content).text(TextModifier.ALTITUDE_DEPTH)).isEqualTo("FL350");
    JsonObject ext = content.extensions().get("adsb");
    assertThat(ext).isNotNull();
    assertThat(((JsonNumber) ext.get("altitudeFt")).longValueExact()).isEqualTo(35_000);
    assertThat(AircraftMapper.flightLevel(2_500)).isEqualTo("FL025");
    assertThat(AircraftMapper.flightLevel(-200)).isEqualTo("FL000");
    assertThat(((Geometry.Point) content.geometry()).coordinates().altitude()).as("the position has no altitude").isNull();
  }

  @Test
  void criterion6_squawkAndEmergencyGoIntoTheExtension() {
    var set = content(after(
        Sbs1Test.position("55.6181", "12.6561"),
        msg(6, "4CA2D6", "", "35000", "", "", "", "", "", "7700", "-1", "0")));
    JsonObject ext = set.extensions().get("adsb");
    assertThat(((JsonString) ext.get("squawk")).value()).isEqualTo("7700");
    assertThat(((JsonBoolean) ext.get("emergency")).value()).isTrue();

    var cleared = content(after(
        Sbs1Test.position("55.6181", "12.6561"),
        msg(6, "4CA2D6", "", "35000", "", "", "", "", "", "7700", "0", "0")));
    assertThat(((JsonBoolean) cleared.extensions().get("adsb").get("emergency")).value()).isFalse();

    var unknown = content(after(
        msg(3, "4CA2D6", "", "35000", "", "", "55.6181", "12.6561", "", "", "", "0"),
        msg(6, "4CA2D6", "", "35000", "", "", "", "", "", "7700", "", "0")));
    assertThat(unknown.extensions().get("adsb").get("emergency")).as("empty leaves it absent").isNull();
  }

  @Test
  void criterion3_aCallsignBecomesTheNameAndTheUniqueDesignation() {
    var content = content(after(
        msg(1, "4CA2D6", "SAS1234 ", "", "", "", "", "", "", "", "", ""),
        Sbs1Test.position("55.6181", "12.6561")));
    assertThat(content.properties().name()).isEqualTo("SAS1234");
    assertThat(modifiers(content).text(TextModifier.UNIQUE_DESIGNATION)).isEqualTo("SAS1234");
  }

  @Test
  void criterion3_withoutACallsignTheHexIsTheName() {
    var content = content(after(Sbs1Test.position("55.6181", "12.6561")));
    assertThat(content.properties().name()).isEqualTo("4CA2D6");
  }

  @Test
  void criterion7_theIdentityIsTheHexInUpperCase() {
    var content = content(after(Sbs1Test.position("55.6181", "12.6561")));
    assertThat(AircraftMapper.externalRef("4CA2D6").system()).isEqualTo("icao24");
    assertThat(AircraftMapper.externalRef("4CA2D6").id()).isEqualTo("4CA2D6");
    assertThat(after(Sbs1Test.position("55.6181", "12.6561")).icao24()).isEqualTo("4CA2D6");
    assertThat(content.dataType()).isEqualTo("adsb.aircraft");
    assertThat(content.dataSource()).isEqualTo("dump1090-north");
  }

  @Test
  void criterion8_theSymbolIsCivilianFixedWingWithTheLinksIdentity() {
    var content = content(after(Sbs1Test.position("55.6181", "12.6561")));
    Symbol symbol = content.symbol();
    assertThat(symbol.standard()).isEqualTo(SymbolStandard.APP_6D);
    assertThat(symbol.sidc()).isEqualTo("10010100001201000000");
    assertThat(symbol.sidc()).hasSize(20);
    assertThat(Identity.NEUTRAL.sidc().charAt(3)).isEqualTo('4');
    assertThat(Identity.of("assumed-friend")).isEqualTo(Identity.ASSUMED_FRIEND);
  }

  @Test
  void theModifiersHoldOnlyWhatTheLineGave() {
    var content = content(after(Sbs1Test.position("55.6181", "12.6561")));
    assertThat(modifiers(content).speed()).isNull();
    assertThat(modifiers(content).direction()).isNull();
    assertThat(content.label()).isEqualTo(LABEL);
    assertThat(content.layerId()).isEqualTo(LAYER);
  }
}
