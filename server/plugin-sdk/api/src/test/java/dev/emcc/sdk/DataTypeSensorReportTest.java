package dev.emcc.sdk;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/** SDK 1.5.0 part 3 (CR-0039 point 6; T-151, owner Q4): a data type whose objects are sensor reports. */
class DataTypeSensorReportTest {

  private static final DataType.Defaults DETECTION = new DataType.Defaults(120L, true, 600L);

  @Test
  void noDataTypeIsASensorReportUnlessItSaysSo() {
    assertThat(new DataType("gmti.detection", "GMTI detection", null, "gmti", DETECTION).sensorReport()).isFalse();
    assertThat(new DataType("gmti.detection", "GMTI detection", null, "gmti", DETECTION, List.of("gmti.report"), false).sensorReport())
        .as("the part 1 constructor").isFalse();
    assertThat(DataType.general().sensorReport()).isFalse();
  }

  @Test
  void withSensorReportSetsItAndTheOtherWithersKeepIt() {
    var detection = new DataType("gmti.detection", "GMTI detection", null, "gmti", DETECTION).withSensorReport(true);
    assertThat(detection.sensorReport()).isTrue();
    var more = detection.withFieldSets("gmti.report").withManual(false);
    assertThat(more.sensorReport()).isTrue();
    assertThat(more.fieldSets()).containsExactly("gmti.report");
    assertThat(more.manual()).isFalse();
    assertThat(more.withSensorReport(false).sensorReport()).isFalse();
  }
}
