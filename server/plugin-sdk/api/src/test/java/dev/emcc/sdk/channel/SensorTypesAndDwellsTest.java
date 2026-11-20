package dev.emcc.sdk.channel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Position;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * SDK 1.5.0 part 3 (CR-0039 point 7, CR-0040; T-168, T-169): a sensor's type and job area, the
 * sensor types a channel takes, and a revisit's dwells in sensor reports.
 */
class SensorTypesAndDwellsTest {

  private static final UUID SENSOR = UUID.fromString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e70");
  // lon differs from lat, so a swapped order would show
  private static final Position PLATFORM = Position.of(15.20, 58.41);
  private static final Geometry AREA = new Geometry.Circle(PLATFORM, 50_000);
  private static final Instant TIME = Instant.parse("2026-11-10T12:00:00Z");
  private static final Geometry.Polygon JOB_AREA = new Geometry.Polygon(List.of(List.of(
      Position.of(15.10, 58.30), Position.of(15.50, 58.30), Position.of(15.50, 58.10), Position.of(15.10, 58.10), Position.of(15.10, 58.30))));

  private static ChannelItem.SensorReport report(ChannelItem.SensorReport.Sequence sequence) {
    return new ChannelItem.SensorReport(SENSOR, PLATFORM, TIME, AREA, List.of()).withSequence(sequence);
  }

  @Test
  void aSensorSaysItsTypeAndJobAreaAndKeepsThemThroughItsWithers() {
    var sensor = ChannelItem.Sensor.named("Hawk 1").withType(SensorType.GROUND_RADAR).withJobArea(JOB_AREA).withMission("ATO-1");
    assertThat(sensor.type()).isEqualTo(SensorType.GROUND_RADAR);
    assertThat(sensor.jobArea()).isEqualTo(JOB_AREA);
    assertThat(sensor.jobArea().rings().get(0).get(0)).as("longitude first").isEqualTo(Position.of(15.10, 58.30));
    assertThat(sensor.mission()).isEqualTo("ATO-1");
    assertThat(sensor.withType(null).type()).isNull();
    assertThat(sensor.withJobArea(null).jobArea()).isNull();
  }

  @Test
  void theOneFourZeroSensorConstructorsSayNoTypeAndNoJobArea() {
    var cr34 = new ChannelItem.Sensor("Hawk 1", "ATO-1", Duration.ofSeconds(10), 20.0, 50.0, 1.5, 0.9, 45.0, 120.0);
    var cr33 = new ChannelItem.Sensor("Hawk 1", Duration.ofSeconds(10), 20.0, 50.0, 1.5, 0.9, 45.0, 120.0);
    assertThat(cr34.type()).isNull();
    assertThat(cr34.jobArea()).isNull();
    assertThat(cr33.type()).isNull();
    assertThat(ChannelItem.Sensor.named("Hawk 1").jobArea()).isNull();
  }

  @Test
  void aJobAreaHasNoHoles() {
    var hole = List.of(Position.of(15.2, 58.2), Position.of(15.3, 58.2), Position.of(15.3, 58.25), Position.of(15.2, 58.2));
    var withHole = new Geometry.Polygon(List.of(JOB_AREA.rings().get(0), hole));
    assertThatThrownBy(() -> ChannelItem.Sensor.named("Hawk 1").withJobArea(withHole)).hasMessageContaining("without holes");
  }

  @Test
  void aChannelTakesEverySensorTypeByDefaultOrOnlyTheOnesItNames() {
    var cot = ChannelInfo.of("cot", ChannelSpec.of("tak-north", "TAK North (out)", "cot").kinds(Set.of(ChannelKind.GROUND_TRUTH, ChannelKind.SENSOR_REPORTS)));
    var gmti = ChannelInfo.of("gmti", ChannelSpec.of("vista-out", "VISTA (out)", "gmti").kinds(Set.of(ChannelKind.SENSOR_REPORTS)).maxAreaDepth(511_980)
        .sensorTypes(Set.of(SensorType.GROUND_RADAR)));
    assertThat(cot.sensorTypes()).isEmpty();
    assertThat(cot.takesSensorType(SensorType.GENERIC)).isTrue();
    assertThat(cot.takesSensorType(SensorType.GROUND_RADAR)).isTrue();
    assertThat(gmti.sensorTypes()).containsExactly(SensorType.GROUND_RADAR);
    assertThat(gmti.maxAreaDepth()).as("the withers keep each other's values").isEqualTo(511_980.0);
    assertThat(gmti.takesSensorType(SensorType.GROUND_RADAR)).isTrue();
    assertThat(gmti.takesSensorType(SensorType.GENERIC)).isFalse();
    assertThat(gmti.takesSensorType(null)).as("no statement counts as generic").isFalse();
    assertThat(cot.takesSensorType(null)).isTrue();
  }

  @Test
  void onlyAChannelThatTakesSensorReportsTakesSensorTypesAndNoneTakesAnyWithoutThem() {
    assertThatThrownBy(() -> ChannelSpec.of("tak-north", "TAK", "cot").sensorTypes(Set.of(SensorType.GENERIC))).hasMessageContaining("sensor reports");
    var groundTruthOnly = ChannelInfo.of("cot", ChannelSpec.of("tak-north", "TAK", "cot"));
    assertThat(groundTruthOnly.takesSensorType(SensorType.GENERIC)).isFalse();
    var spec = ChannelSpec.of("vista-out", "VISTA", "gmti").kinds(Set.of(ChannelKind.SENSOR_REPORTS));
    assertThat(spec.sensorTypes(Set.of(SensorType.GROUND_RADAR)).takesSensorType(SensorType.GROUND_RADAR)).isTrue();
    assertThat(spec.sensorTypes(Set.of()).takesSensorType(SensorType.GENERIC)).as("empty takes every type").isTrue();
  }

  @Test
  void theOneFourZeroChannelConstructorsTakeEverySensorType() {
    var id = new ChannelId("gmti", "vista-out");
    var info = new ChannelInfo(id, "VISTA", "gmti", Set.of(), List.of(), Set.of(ChannelKind.SENSOR_REPORTS), null, 511_980.0);
    assertThat(info.sensorTypes()).isEmpty();
    var spec = new ChannelSpec("vista-out", "VISTA", "gmti", Set.of(), List.of(), Set.of(ChannelKind.SENSOR_REPORTS), null, 511_980.0);
    assertThat(spec.sensorTypes()).isEmpty();
  }

  @Test
  void aReportWithoutASequenceIsKeyedByItsSensorAsInOneFourZero() {
    var plain = new ChannelItem.SensorReport(SENSOR, PLATFORM, TIME, AREA, List.of(), ChannelItem.Sensor.named("Hawk 1"));
    assertThat(plain.sequence()).isNull();
    assertThat(plain.coalesceKey()).isEqualTo(SENSOR);
    assertThat(plain.id()).isEqualTo(SENSOR);
  }

  @Test
  void aRevisitsDwellsHaveTheirOwnKeysAndTheSameDwellOfANewerRevisitReplacesTheOlder() {
    var first = report(new ChannelItem.SensorReport.Sequence(7, 0, false));
    var second = report(new ChannelItem.SensorReport.Sequence(7, 1, false));
    var last = report(new ChannelItem.SensorReport.Sequence(7, 2, true));
    assertThat(first.coalesceKey()).isNotEqualTo(second.coalesceKey()).isNotEqualTo(SENSOR);
    assertThat(second.coalesceKey()).isNotEqualTo(last.coalesceKey());
    var nextFirst = report(new ChannelItem.SensorReport.Sequence(8, 0, false));
    assertThat(nextFirst.coalesceKey()).as("dwell 0 of the next revisit replaces dwell 0 of this one").isEqualTo(first.coalesceKey());
    assertThat(first.id()).as("the id stays the sensor's").isEqualTo(SENSOR);
    assertThat(last.sequence().lastOfRevisit()).isTrue();
    assertThat(first.withSequence(null).coalesceKey()).isEqualTo(SENSOR);
  }

  @Test
  void aSequenceHasARevisitOfZeroOrMoreAndADwellThat4607sD3Holds() {
    assertThat(new ChannelItem.SensorReport.Sequence(0, 0, true).dwell()).isZero();
    assertThat(new ChannelItem.SensorReport.Sequence(70_000, ChannelItem.SensorReport.Sequence.MAX_DWELLS_PER_REVISIT, true).dwell()).isEqualTo(65_535);
    assertThatThrownBy(() -> new ChannelItem.SensorReport.Sequence(-1, 0, false)).hasMessageContaining("revisit");
    assertThatThrownBy(() -> new ChannelItem.SensorReport.Sequence(0, -1, false)).hasMessageContaining("dwell");
    assertThatThrownBy(() -> new ChannelItem.SensorReport.Sequence(0, 65_536, false)).hasMessageContaining("dwell");
  }
}
