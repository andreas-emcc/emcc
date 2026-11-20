package dev.emcc.sdk.channel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.FieldRef;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** SDK 1.2.0 (CR-0025 part 3): the value types of output channels; SDK 1.4.0 (CR-0030 part 1): their kinds and sensor reports. */
class ChannelTypesTest {

  @Test
  void aChannelIdIsThePluginAndTheLink() {
    var id = new ChannelId("cot", "tak-north");
    assertThat(id).hasToString("cot/tak-north");
    assertThat(ChannelId.parse("cot/tak-north")).isEqualTo(id);
    assertThatThrownBy(() -> ChannelId.parse("cot")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new ChannelId("cot", "TAK North")).hasMessageContaining("link");
    assertThatThrownBy(() -> new ChannelId("Cot", "tak-north")).hasMessageContaining("plugin");
    assertThatThrownBy(() -> ChannelId.parse("cot/tak/north")).as("a slash is no part of a link").isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aSpecHasNoCapabilitiesOrFieldsByDefaultAndItsWithersReturnNewSpecs() {
    var spec = ChannelSpec.of("tak-north", "TAK North (out)", "cot");
    assertThat(spec.capabilities()).isEmpty();
    assertThat(spec.fields()).isEmpty();
    var more = spec.can(ChannelCapability.DELETE).fields(List.of(new FieldRef("cot", "callsign")));
    assertThat(more.capabilities()).containsExactly(ChannelCapability.DELETE);
    assertThat(more.fields()).containsExactly(new FieldRef("cot", "callsign"));
    assertThat(spec.capabilities()).as("the original is unchanged").isEmpty();
    assertThat(more.can(ChannelCapability.DELETE)).as("adding it twice is adding it once").isEqualTo(more);
  }

  @Test
  void aSpecRefusesBadNamesTypesAndFieldsListedTwice() {
    assertThatThrownBy(() -> ChannelSpec.of("tak north", "TAK", "cot")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> ChannelSpec.of("tak-north", " ", "cot")).hasMessageContaining("name");
    assertThatThrownBy(() -> ChannelSpec.of("tak-north", "x".repeat(129), "cot")).hasMessageContaining("name");
    assertThatThrownBy(() -> ChannelSpec.of("tak-north", "TAK", "CoT")).hasMessageContaining("output type");
    var callsign = new FieldRef("cot", "callsign");
    assertThatThrownBy(() -> ChannelSpec.of("tak-north", "TAK", "cot").fields(List.of(callsign, callsign))).hasMessageContaining("twice");
  }

  @Test
  void aFieldRefNamesADeclaredField() {
    assertThat(new FieldRef("cot", "callsign").name()).isEqualTo("callsign");
    assertThat(new FieldRef("draw-symbols", "unitSize").plugin()).isEqualTo("draw-symbols");
    assertThatThrownBy(() -> new FieldRef("cot", "Callsign")).hasMessageContaining("field name");
    assertThatThrownBy(() -> new FieldRef("cot", "call-sign")).hasMessageContaining("field name");
    assertThatThrownBy(() -> new FieldRef("Cot", "callsign")).hasMessageContaining("plugin");
  }

  @Test
  void anInfoIsTheSpecWithThePlugin() {
    var info = ChannelInfo.of("cot", ChannelSpec.of("tak-north", "TAK North (out)", "cot").can(ChannelCapability.DELETE));
    assertThat(info.id()).isEqualTo(new ChannelId("cot", "tak-north"));
    assertThat(info.canDelete()).isTrue();
    assertThat(ChannelInfo.of("cot", ChannelSpec.of("udp-out", "UDP", "cot")).canDelete()).isFalse();
    assertThatThrownBy(() -> new ChannelInfo(new ChannelId("cot", "x"), "", "cot", Set.of(), List.of())).hasMessageContaining("name");
  }

  @Test
  void aListFindsChannelsByIdAndTypeAndHoldsEachIdOnce() {
    var tak = ChannelInfo.of("cot", ChannelSpec.of("tak-north", "TAK North", "cot"));
    var ais = ChannelInfo.of("ais", ChannelSpec.of("coast", "Coast", "ais"));
    var list = new ChannelList(List.of(tak, ais));
    assertThat(list.channels()).as("kept by plugin, then link").containsExactly(ais, tak);
    assertThat(list.find(new ChannelId("cot", "tak-north"))).contains(tak);
    assertThat(list.find(new ChannelId("cot", "gone"))).isEmpty();
    assertThat(list.ofType("cot")).containsExactly(tak);
    assertThat(ChannelList.empty().channels()).isEmpty();
    assertThatThrownBy(() -> new ChannelList(List.of(tak, tak))).hasMessageContaining("twice");
  }

  @Test
  void itemsAreKeyedByTheObjectId() {
    UUID id = UUID.fromString("0b5c2f4e-8f43-4d7a-9a51-2c1f1c3c9e01");
    assertThat(new ChannelItem.Removal(id).coalesceKey()).isEqualTo(id);
    assertThatThrownBy(() -> new ChannelItem.Removal(null)).isInstanceOf(NullPointerException.class);
  }

  // ---------------------------------------------------------------- SDK 1.4.0: kinds and sensor reports

  private static final UUID SENSOR = UUID.fromString("5e8d7c6b-4a39-4281-b7f6-0e1d2c3b4a59");
  private static final UUID TRACK = UUID.fromString("0b5c2f4e-8f43-4d7a-9a51-2c1f1c3c9e01");
  private static final UUID LAYER = UUID.fromString("7d3f1a52-2b4e-4c1f-9e0a-5b6c7d8e9f10");
  // lon differs from lat in every position, so a swapped order would show
  private static final Geometry.Circle AREA = new Geometry.Circle(Position.of(18.0723, 59.3311), 20_000);

  private static MapObjectContent at(Geometry geometry) {
    return new MapObjectContent("core.shape", MapObjectContent.GENERAL, "simulation", null, LAYER, geometry, null, null, null,
        SecurityLabel.of("NATO", "UNCLASSIFIED"), Extensions.empty());
  }

  private static ChannelItem.Detection detection() {
    return new ChannelItem.Detection(TRACK, at(new Geometry.Point(Position.of(18.1, 59.4))));
  }

  @Test
  void aSpecAndItsInfoTakeGroundTruthByDefaultAndTheKindsTheyAreGiven() {
    var spec = ChannelSpec.of("tak-north", "TAK North (out)", "cot");
    assertThat(spec.kinds()).containsExactly(ChannelKind.GROUND_TRUTH);
    assertThat(new ChannelSpec("tak-north", "TAK North (out)", "cot", Set.of(), List.of()).kinds()).as("the 1.2.0 constructor").containsExactly(ChannelKind.GROUND_TRUTH);
    var both = spec.kinds(Set.of(ChannelKind.GROUND_TRUTH, ChannelKind.SENSOR_REPORTS)).can(ChannelCapability.DELETE);
    assertThat(both.takes(ChannelKind.SENSOR_REPORTS)).isTrue();
    assertThat(both.capabilities()).as("the withers keep the kinds and the rest").containsExactly(ChannelCapability.DELETE);
    assertThat(both.fields(List.of()).kinds()).containsExactlyInAnyOrder(ChannelKind.GROUND_TRUTH, ChannelKind.SENSOR_REPORTS);
    assertThatThrownBy(() -> spec.kinds(Set.of())).hasMessageContaining("at least one");
    var info = ChannelInfo.of("gmti", spec.kinds(Set.of(ChannelKind.SENSOR_REPORTS)));
    assertThat(info.takes(ChannelKind.SENSOR_REPORTS)).isTrue();
    assertThat(info.takes(ChannelKind.GROUND_TRUTH)).isFalse();
    assertThat(new ChannelInfo(new ChannelId("cot", "tak-north"), "TAK", "cot", Set.of(), List.of()).kinds()).as("the 1.2.0 constructor").containsExactly(ChannelKind.GROUND_TRUTH);
  }

  @Test
  void updatesAndRemovalsAreGroundTruthAndASensorReportIsKeyedByItsSensor() {
    assertThat(new ChannelItem.Removal(TRACK).kind()).isEqualTo(ChannelKind.GROUND_TRUTH);
    assertThat(new ChannelItem.Update(TRACK, at(new Geometry.Point(Position.of(18.0723, 59.3311)))).kind()).isEqualTo(ChannelKind.GROUND_TRUTH);
    var report = new ChannelItem.SensorReport(SENSOR, Position.of(17.5, 59.0), Instant.parse("2026-11-05T12:00:00Z"), AREA, List.of(detection()));
    assertThat(report.kind()).isEqualTo(ChannelKind.SENSOR_REPORTS);
    assertThat(report.id()).isEqualTo(SENSOR);
    assertThat(report.coalesceKey()).as("the inbox keeps the latest report per sensor").isEqualTo(SENSOR);
    assertThat(report.detections().getFirst().content().geometry()).isEqualTo(new Geometry.Point(Position.of(18.1, 59.4)));
  }

  @Test
  void aSensorReportRefusesAnAreaThatIsNoAreaTooManyDetectionsAndADetectionThatIsNoPoint() {
    Instant time = Instant.parse("2026-11-05T12:00:00Z");
    assertThatThrownBy(() -> new ChannelItem.SensorReport(SENSOR, Position.of(17.5, 59.0), time, new Geometry.Point(Position.of(18.0723, 59.3311)), List.of()))
        .hasMessageContaining("Polygon, Circle, Ellipse or ArcBand");
    var many = new ArrayList<ChannelItem.Detection>();
    for (int i = 0; i <= ChannelItem.SensorReport.MAX_DETECTIONS; i++) {
      many.add(detection());
    }
    assertThatThrownBy(() -> new ChannelItem.SensorReport(SENSOR, Position.of(17.5, 59.0), time, AREA, many)).hasMessageContaining("at most 65535");
    assertThat(new ChannelItem.SensorReport(SENSOR, Position.of(17.5, 59.0), time, AREA, List.of()).detections()).as("a report may see nothing").isEmpty();
    assertThatThrownBy(() -> new ChannelItem.Detection(TRACK, at(AREA))).hasMessageContaining("at a point");
  }

  @Test
  void cr0033ASensorReportCarriesItsSensorsDescriptionAndTheOldConstructorSaysNothing() {
    Instant time = Instant.parse("2026-11-05T12:00:00Z");
    assertThat(new ChannelItem.SensorReport(SENSOR, Position.of(17.5, 59.0), time, AREA, List.of()).sensor()).as("the 1.4.0 constructor").isNull();
    var sensor = new ChannelItem.Sensor("Hawk 1", Duration.ofSeconds(10), 20.0, 50.0, 1.5, 0.9, 45.0, 120.0);
    var report = new ChannelItem.SensorReport(SENSOR, Position.of(17.5, 59.0), time, AREA, List.of(), sensor);
    assertThat(report.sensor()).isEqualTo(sensor);
    assertThat(report.sensor().revisit()).isEqualTo(Duration.ofSeconds(10));
    assertThat(ChannelItem.Sensor.named("Hawk 1").detectionProbability()).as("absent is no statement").isNull();
    assertThat(new ChannelItem.Sensor("x".repeat(64), null, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0).name()).hasSize(64);
    assertThat(new ChannelItem.Sensor("x", null, null, null, null, 1.0, 359.9, null).platformDirection()).isEqualTo(359.9);
  }

  @Test
  void cr0033ASensorRefusesValuesOutOfRange() {
    assertThatThrownBy(() -> ChannelItem.Sensor.named(" ")).hasMessageContaining("not blank");
    assertThatThrownBy(() -> ChannelItem.Sensor.named("x".repeat(65))).hasMessageContaining("1 to 64");
    assertThatThrownBy(() -> new ChannelItem.Sensor("x", Duration.ZERO, null, null, null, null, null, null)).hasMessageContaining("revisit");
    assertThatThrownBy(() -> new ChannelItem.Sensor("x", null, -1.0, null, null, null, null, null)).hasMessageContaining("rangeError");
    assertThatThrownBy(() -> new ChannelItem.Sensor("x", null, null, Double.NaN, null, null, null, null)).hasMessageContaining("crossRangeError");
    assertThatThrownBy(() -> new ChannelItem.Sensor("x", null, null, null, Double.POSITIVE_INFINITY, null, null, null)).hasMessageContaining("minimumDetectableSpeed");
    assertThatThrownBy(() -> new ChannelItem.Sensor("x", null, null, null, null, 1.01, null, null)).hasMessageContaining("detectionProbability");
    assertThatThrownBy(() -> new ChannelItem.Sensor("x", null, null, null, null, null, 360.0, null)).hasMessageContaining("platformDirection");
    assertThatThrownBy(() -> new ChannelItem.Sensor("x", null, null, null, null, null, -0.1, null)).hasMessageContaining("platformDirection");
    assertThatThrownBy(() -> new ChannelItem.Sensor("x", null, null, null, null, null, null, -2.0)).hasMessageContaining("platformSpeed");
  }

  @Test
  void cr0034ASensorMayNameItsMission() {
    var sensor = new ChannelItem.Sensor("Hawk 1", "ATO-2611-BRAVO", Duration.ofSeconds(10), 20.0, 50.0, 1.5, 0.9, 45.0, 120.0);
    assertThat(sensor.mission()).isEqualTo("ATO-2611-BRAVO");
    assertThat(new ChannelItem.Sensor("Hawk 1", Duration.ofSeconds(10), 20.0, 50.0, 1.5, 0.9, 45.0, 120.0).mission()).as("CR-0033's constructor").isNull();
    assertThat(ChannelItem.Sensor.named("Hawk 1").withMission("  ").mission()).as("blank is none").isNull();
    assertThat(ChannelItem.Sensor.named("Hawk 1").withMission("Övning Spaning Norr").mission()).as("any letters").isEqualTo("Övning Spaning Norr");
    assertThat(ChannelItem.Sensor.named("Hawk 1").withMission("m".repeat(64)).mission()).hasSize(64);
    assertThatThrownBy(() -> ChannelItem.Sensor.named("Hawk 1").withMission("m".repeat(65))).hasMessageContaining("1 to 64");
    assertThat(sensor.withMission(null).revisit()).as("the other values kept").isEqualTo(Duration.ofSeconds(10));
  }

  @Test
  void cr0035ASensorReportChannelMayStateHowDeepAnAreaItCarries() {
    var gmti = ChannelSpec.of("vista-out", "VISTA (out)", "gmti").kinds(Set.of(ChannelKind.SENSOR_REPORTS));
    assertThat(gmti.maxAreaDepth()).as("no limit by default").isNull();
    var limited = gmti.maxAreaDepth(511_980).fieldSet("gmti.report").can(ChannelCapability.DELETE);
    assertThat(limited.maxAreaDepth()).as("the withers keep it").isEqualTo(511_980.0);
    assertThat(limited.kinds(Set.of(ChannelKind.GROUND_TRUTH, ChannelKind.SENSOR_REPORTS)).maxAreaDepth()).isEqualTo(511_980.0);
    var info = ChannelInfo.of("gmti", limited);
    assertThat(info.maxAreaDepth()).as("ChannelInfo.of carries it, so ECore's registry changes nothing").isEqualTo(511_980.0);
    assertThat(info.fieldSet()).isEqualTo("gmti.report");
    assertThat(new ChannelSpec("vista-out", "VISTA (out)", "gmti", Set.of(), List.of(), Set.of(ChannelKind.SENSOR_REPORTS), "gmti.report").maxAreaDepth())
        .as("part 3's constructor").isNull();
    assertThat(new ChannelInfo(new ChannelId("gmti", "vista-out"), "VISTA", "gmti", Set.of(), List.of(), Set.of(ChannelKind.SENSOR_REPORTS), null).maxAreaDepth())
        .as("part 3's constructor").isNull();
    assertThat(ChannelSpec.of("tak-north", "TAK North (out)", "cot").maxAreaDepth()).as("the 1.2.0 spec").isNull();
  }

  @Test
  void cr0035TheDepthIsFiniteAndPositiveAndOnlyForSensorReports() {
    var gmti = ChannelSpec.of("vista-out", "VISTA (out)", "gmti").kinds(Set.of(ChannelKind.SENSOR_REPORTS));
    assertThatThrownBy(() -> gmti.maxAreaDepth(0)).hasMessageContaining("finite and positive");
    assertThatThrownBy(() -> gmti.maxAreaDepth(-1)).hasMessageContaining("finite and positive");
    assertThatThrownBy(() -> gmti.maxAreaDepth(Double.NaN)).hasMessageContaining("finite and positive");
    assertThatThrownBy(() -> gmti.maxAreaDepth(Double.POSITIVE_INFINITY)).hasMessageContaining("finite and positive");
    assertThatThrownBy(() -> ChannelSpec.of("tak-north", "TAK North (out)", "cot").maxAreaDepth(100_000))
        .as("ground truth only").hasMessageContaining("sensor reports");
    assertThatThrownBy(() -> gmti.maxAreaDepth(100_000).kinds(Set.of(ChannelKind.GROUND_TRUTH)))
        .as("dropping sensor reports later").hasMessageContaining("sensor reports");
    assertThatThrownBy(() -> new ChannelInfo(new ChannelId("cot", "tak-north"), "TAK", "cot", Set.of(), List.of(), Set.of(ChannelKind.GROUND_TRUTH), null, 100_000.0))
        .as("the info's checks are the spec's").hasMessageContaining("sensor reports");
  }
}
