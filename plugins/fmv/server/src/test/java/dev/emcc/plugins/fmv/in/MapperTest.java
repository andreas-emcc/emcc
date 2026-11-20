package dev.emcc.plugins.fmv.in;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.fmv.in.Mapper.Placement;
import dev.emcc.plugins.fmv.in.Mapper.TimeSource;
import dev.emcc.plugins.fmv.klv.Metadata;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Meta;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Relation;
import dev.emcc.sdk.model.SecurityLabel;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Brief criteria 5 to 9, 14 (the mapping): the camera, its field of view, the label and the time. */
class MapperTest {

  static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  static final Placement PLACEMENT =
      new Placement("fmv-link-1", "FMV link 1", LABEL, StandardIdentity.FRIEND, Mapper.DEFAULT_CAMERA_SYMBOL, "#FFD400", TimeSource.RECEIVED);
  static final Instant NOW = Instant.parse("2026-11-14T12:00:00Z");
  static final UUID LAYER = UUID.randomUUID();
  static final UUID CAMERA_ID = UUID.randomUUID();

  // Sundsvall's latitude 62.39 and longitude 17.31 differ, so a swap shows.
  static final double LAT = 62.39;
  static final double LON = 17.31;

  /** A set with a sensor position, and the rest as given. */
  static Metadata set(Double heading, Double azimuth, Double hfov, Double slant, Double fcLat, Double fcLon) {
    return new Metadata(null, null, null, null, heading, LAT, LON, 450.0, hfov, null, azimuth, null, slant, fcLat, fcLon, null, null, null);
  }

  static MapObjectContent arc(Metadata m) {
    return Mapper.fieldOfView(PLACEMENT, m, NOW, CAMERA_ID, null, LAYER);
  }

  static Geometry.ArcBand band(MapObjectContent c) {
    return (Geometry.ArcBand) c.geometry();
  }

  // ------------------------------------------------------------------ the camera

  @Test
  void criterion5_theCameraIsASymbolAtLongitudeLatitude() {
    var m = new Metadata(null, "Mission 7", null, null, 123.4, LAT, LON, 450.0, 2.0, 30.0, 10.0, -20.0, 5000.0, 62.41, 17.35, 12.0, 14,
        new Metadata.Security(1, 2, "//SWE", "SWE", 12));
    MapObjectContent c = Mapper.camera(PLACEMENT, m, NOW, "H.264", null, LAYER);
    assertThat(c.type()).isEqualTo(MapObjectContent.SYMBOL);
    assertThat(c.dataType()).isEqualTo("fmv.camera");
    assertThat(c.dataSource()).isEqualTo("fmv-link-1");
    assertThat(c.layerId()).isEqualTo(LAYER);
    assertThat(((Geometry.Point) c.geometry()).coordinates()).isEqualTo(new Position(LON, LAT, null));
    assertThat(c.symbol().sidc()).isEqualTo("10030100001103002000");
    assertThat(c.symbol().modifiers().direction()).isCloseTo(123.4, within(1e-9));
    assertThat(c.symbol().modifiers().text(dev.emcc.sdk.model.TextModifier.UNIQUE_DESIGNATION)).isEqualTo("Mission 7");
    assertThat(c.properties().name()).isEqualTo("Mission 7");
    assertThat(c.label()).isEqualTo(LABEL);
    assertThat(c.time().observed()).isEqualTo(NOW);
  }

  @Test
  void criterion5_theIdentityIsTheLinksAndTheNameFallsBackToTheLink() {
    var hostile = new Placement("l", "Link L", LABEL, StandardIdentity.HOSTILE, Mapper.DEFAULT_CAMERA_SYMBOL, "#FFD400", TimeSource.RECEIVED);
    var m = set(null, null, null, null, null, null);
    MapObjectContent c = Mapper.camera(hostile, m, NOW, null, null, LAYER);
    assertThat(c.symbol().sidc()).isEqualTo("10060100001103002000");
    assertThat(c.properties().name()).isEqualTo("Link L");
    assertThat(c.symbol().modifiers().direction()).isNull();
  }

  @Test
  void criterion5_theNameIsTag10ThenTag3() {
    var both = new Metadata(null, "M", "P", null, null, LAT, LON, null, null, null, null, null, null, null, null, null, null, null);
    assertThat(Mapper.name(PLACEMENT, both)).isEqualTo("P");
    var onlyMission = new Metadata(null, "M", null, null, null, LAT, LON, null, null, null, null, null, null, null, null, null, null, null);
    assertThat(Mapper.name(PLACEMENT, onlyMission)).isEqualTo("M");
  }

  @Test
  void criterion5_theExtensionHoldsTheRestOfTheSet() {
    var m = new Metadata(null, "Mission 7", "P", "EO", 90.0, LAT, LON, 450.0, 2.0, 30.0, 10.0, -20.0, 5000.0, 62.41, 17.35, 12.0, 14,
        new Metadata.Security(1, 2, "//SWE", "SWE", 12));
    JsonObject ext = Mapper.camera(PLACEMENT, m, NOW, "MPEG-2 → H.264", null, LAYER).extensions().get("fmv");
    assertThat(ext.getString("link")).isEqualTo("FMV link 1");
    assertThat(ext.getString("mission")).isEqualTo("Mission 7");
    assertThat(ext.getString("imageSourceSensor")).isEqualTo("EO");
    assertThat(((JsonNumber) ext.get("sensorAltitude")).doubleValue()).isEqualTo(450.0);
    assertThat(((JsonNumber) ext.get("verticalFov")).doubleValue()).isEqualTo(30.0);
    assertThat(((JsonNumber) ext.get("slantRange")).doubleValue()).isEqualTo(5000.0);
    assertThat(((JsonNumber) ext.get("frameCenterLatitude")).doubleValue()).isEqualTo(62.41);
    assertThat(((JsonNumber) ext.get("frameCenterLongitude")).doubleValue()).isEqualTo(17.35);
    assertThat(ext.getString("videoFormat")).isEqualTo("MPEG-2 → H.264");
    assertThat(ext.getString("classifyingCountry")).isEqualTo("//SWE");
    assertThat(ext.getString("releasingInstructions")).isEqualTo("SWE");
    assertThat(((JsonNumber) ext.get("version")).longValueExact()).isEqualTo(14);
    assertThat(ext.getString("lastSet")).isEqualTo(NOW.toString());
  }

  @Test
  void criterion5_aSetWithoutAPositionWritesNoCamera() {
    var m = new Metadata(null, null, null, null, 90.0, LAT, null, null, null, null, null, null, null, null, null, null, null, null);
    assertThat(Mapper.camera(PLACEMENT, m, NOW, null, null, LAYER)).isNull();
  }

  @Test
  void aSparseSetKeepsTheLastValuesLayerAndOtherNamespaces() {
    var full = new Metadata(null, "Mission 7", null, null, 90.0, LAT, LON, 450.0, 2.0, 30.0, 10.0, null, 5000.0, null, null, null, null, null);
    MapObjectContent first = Mapper.camera(PLACEMENT, full, NOW, "H.264", null, LAYER);
    UUID elsewhere = UUID.randomUUID();
    var relation = new Relation("simulator.something", UUID.randomUUID());
    var kept = new MapObjectContent(first.type(), first.dataType(), first.dataSource(), first.time(), elsewhere, first.geometry(), first.symbol(),
        null, first.properties(), first.label(), first.extensions().with("other", JsonObject.builder().put("x", JsonString.of("y")).build()), List.of(),
        List.of(relation));
    var audit = new Meta.Audit(Instant.EPOCH, Actor.plugin("fmv"));
    var stored = new MapObject(UUID.randomUUID(), 3, kept, new Meta(audit, audit, null));
    var sparse = new Metadata(null, null, null, null, 91.0, LAT + 0.001, LON, null, null, null, null, null, null, null, null, null, null, null);
    MapObjectContent next = Mapper.camera(PLACEMENT, sparse, NOW.plusSeconds(1), null, stored, LAYER);
    assertThat(next.layerId()).as("the stored object's layer stays").isEqualTo(elsewhere);
    assertThat(next.relations()).containsExactly(relation);
    assertThat(next.extensions().get("other").getString("x")).isEqualTo("y");
    JsonObject ext = next.extensions().get("fmv");
    assertThat(ext.getString("mission")).as("kept from the earlier set").isEqualTo("Mission 7");
    assertThat(ext.getString("videoFormat")).isEqualTo("H.264");
    assertThat(((JsonNumber) ext.get("sensorAltitude")).doubleValue()).isEqualTo(450.0);
    assertThat(ext.getString("lastSet")).isEqualTo(NOW.plusSeconds(1).toString());
  }

  // ------------------------------------------------------------------ the field of view

  @Test
  void criterion6_withTheFrameCentreTheArcAimsAtItAndEndsThere() {
    // The frame centre 0.02° north of the sensor, on the same meridian: due north, about 2.2 km.
    MapObjectContent c = arc(set(10.0, 200.0, 2.0, 99.0, LAT + 0.02, LON));
    assertThat(c.type()).isEqualTo(MapObjectContent.SHAPE);
    assertThat(c.dataType()).isEqualTo("fmv.field-of-view");
    Geometry.ArcBand b = band(c);
    assertThat(b.center()).isEqualTo(new Position(LON, LAT, null));
    assertThat(b.innerRadius()).isZero();
    assertThat(b.outerRadius()).as("the ground distance, not the slant range").isCloseTo(2_224, within(10.0));
    assertThat(b.startBearing()).as("north - 1°").isCloseTo(359.0, within(1e-6));
    assertThat(b.endBearing()).as("north + 1°").isCloseTo(1.0, within(1e-6));
  }

  @Test
  void criterion6_aFrameCentreToTheEastOfTheSensor() {
    // 0.04° of longitude at latitude 62.39 is about 2.06 km due east.
    Geometry.ArcBand b = band(arc(set(0.0, 0.0, 0.4, null, LAT, LON + 0.04)));
    double centre = (b.startBearing() + b.endBearing()) / 2;
    assertThat(centre).isCloseTo(90.0, within(0.1));
    assertThat(b.outerRadius()).isCloseTo(2_056, within(20.0));
    assertThat(b.endBearing() - b.startBearing()).isCloseTo(0.4, within(1e-9));
  }

  @Test
  void criterion6_theArcIsAnOpenLineWithTheLinkColourAndTheRelation() {
    MapObjectContent c = arc(set(10.0, 200.0, 2.0, 99.0, LAT + 0.02, LON));
    assertThat(c.style().strokeColor()).isEqualTo("#FFD400");
    assertThat(c.style().strokeWidth()).isEqualTo(2.0);
    assertThat(c.style().fillOpacity()).isEqualTo(0.0);
    assertThat(c.relations()).containsExactly(new Relation("fmv.view", CAMERA_ID));
    assertThat(c.label()).isEqualTo(LABEL);
    assertThat(c.properties().name()).isEqualTo("FMV link 1 field of view");
  }

  @Test
  void criterion7_withoutTheFrameCentreItIsHeadingPlusAzimuthAndTheSlantRange() {
    Geometry.ArcBand b = band(arc(set(100.0, 30.0, 4.0, 5_000.0, null, null)));
    assertThat(b.outerRadius()).isEqualTo(5_000.0);
    assertThat(b.startBearing()).isCloseTo(128.0, within(1e-9));
    assertThat(b.endBearing()).isCloseTo(132.0, within(1e-9));
  }

  @Test
  void criterion7_aBearingPastNorthWraps() {
    Geometry.ArcBand b = band(arc(set(350.0, 30.0, 4.0, 5_000.0, null, null)));
    assertThat(b.startBearing()).as("380° - 2° = 18°").isCloseTo(18.0, within(1e-9));
    assertThat(b.endBearing()).isCloseTo(22.0, within(1e-9));
  }

  @Test
  void criterion7_anArcAcrossNorthIsOneArcWithItsStartAboveItsEnd() {
    Geometry.ArcBand b = band(arc(set(359.4, 0.5, 1.0, 5_000.0, null, null))); // 359.9° ± 0.5°
    assertThat(b.startBearing()).isCloseTo(359.4, within(1e-9));
    assertThat(b.endBearing()).isCloseTo(0.4, within(1e-9));
    assertThat(b.startBearing()).isGreaterThan(b.endBearing());
  }

  @Test
  void criterion7_withoutADirectionALengthOrAWidthNoArcIsWritten() {
    assertThat(arc(set(null, 30.0, 4.0, 5_000.0, null, null))).as("no heading").isNull();
    assertThat(arc(set(100.0, null, 4.0, 5_000.0, null, null))).as("no azimuth").isNull();
    assertThat(arc(set(100.0, 30.0, 4.0, null, null, null))).as("no slant range").isNull();
    assertThat(arc(set(100.0, 30.0, 4.0, 0.0, null, null))).as("a length of 0").isNull();
    assertThat(arc(set(100.0, 30.0, null, 5_000.0, null, null))).as("no width").isNull();
    var noPosition = new Metadata(null, null, null, null, 100.0, null, null, null, 4.0, null, 30.0, null, 5_000.0, null, null, null, null, null);
    assertThat(arc(noPosition)).as("no position").isNull();
  }

  @Test
  void criterion7_aFrameCentreAtTheSensorFallsBackToTheSecondWay() {
    Geometry.ArcBand b = band(arc(set(100.0, 30.0, 4.0, 5_000.0, LAT, LON)));
    assertThat(b.outerRadius()).isEqualTo(5_000.0);
  }

  @Test
  void aWidthOfZeroIsASliverNotAFullRing() {
    Geometry.ArcBand b = band(arc(set(100.0, 30.0, 0.0, 5_000.0, null, null)));
    assertThat(b.startBearing()).isNotEqualTo(b.endBearing());
    assertThat(b.endBearing() - b.startBearing()).isCloseTo(0.01, within(1e-9));
  }

  // ------------------------------------------------------------------ time and label

  @Test
  void time_receivedIsTheDefaultAndStreamUsesTag2() {
    var m = new Metadata(1_700_000_000_500_000L, null, null, null, null, LAT, LON, null, null, null, null, null, null, null, null, null, null, null);
    assertThat(Mapper.time(PLACEMENT, m, NOW)).isEqualTo(NOW);
    var stream = new Placement("l", "Link L", LABEL, StandardIdentity.FRIEND, Mapper.DEFAULT_CAMERA_SYMBOL, "#FFD400", TimeSource.STREAM);
    assertThat(Mapper.time(stream, m, NOW)).isEqualTo(Instant.ofEpochSecond(1_700_000_000, 500_000_000));
    var without = set(null, null, null, null, null, null);
    assertThat(Mapper.time(stream, without, NOW)).as("a set without tag 2").isEqualTo(NOW);
  }

  @Test
  void criterion8_theLabelFollowsST0102UnderNatoNamesOrIsTheLinks() {
    var rule = new LabelRule(true, LABEL, LabelRule.NATO);
    assertThat(rule.label(1).label().classification()).isEqualTo("UNCLASSIFIED");
    assertThat(rule.label(1).mapped()).isTrue();
    assertThat(rule.label(4).label().classification()).isEqualTo("SECRET");
    assertThat(rule.label(5).label().classification()).isEqualTo("COSMIC TOP SECRET");
    assertThat(rule.label(null).label()).as("no ST 0102").isEqualTo(LABEL);
    assertThat(rule.label(null).mapped()).isFalse();
    assertThat(rule.label(9).mapped()).isFalse();
    var link = new LabelRule(false, SecurityLabel.of("NATO", "CONFIDENTIAL"), LabelRule.NATO);
    assertThat(link.label(4).label().classification()).as("link label gives the link's label").isEqualTo("CONFIDENTIAL");
    assertThat(link.label(4).mapped()).isTrue();
  }
}
