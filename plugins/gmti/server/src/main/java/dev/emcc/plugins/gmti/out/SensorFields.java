package dev.emcc.plugins.gmti.out;

import dev.emcc.plugins.gmti.format.JobDefinition;
import dev.emcc.sdk.channel.ChannelItem;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.jspecify.annotations.Nullable;

/**
 * A sensor's values (CR-0033's {@link ChannelItem.Sensor}, generic and in SI units) in STANAG
 * 4607's fields (brief section 3, "Out", "The sensor"; format rules G10). Each value is rounded to
 * its field's unit first. One its field cannot hold is sent as "no statement" ({@code J21}, {@code
 * J22}, {@code J24}) or left out ({@code D31}, {@code D32.12}, {@code D32.13}, {@code D15}–{@code
 * D17}), never clamped or wrapped, and named in {@link #notHeld} (the ACA's R3). {@code J15} has
 * no "no statement": a revisit above 6 553.5 s is sent as 0, "not revisiting" (owner, JW). An absent
 * value, or no sensor at all (assumption B2), is "no statement" and not counted.
 *
 * @param revisit {@code J15}, deciseconds
 * @param slantRangeError {@code J21}, cm
 * @param crossRangeAngle {@code J22}, degrees: the cross-range error seen from the sensor at the
 *     range of the area's centre (reference 4.3)
 * @param minimumSpeed {@code J24}, dm/s
 * @param probability {@code J25}, percent
 * @param reportRangeError {@code D32.12}, m in whole centimetres, or {@code null}
 * @param reportCrossRangeError {@code D32.13}, m in whole decimetres, or {@code null}
 * @param dwellMinimumSpeed {@code D31}, m/s in whole decimetres per second, or {@code null}
 * @param track {@code D15}, degrees, or {@code null}; with {@code speed} and a vertical speed of 0
 * @param speed {@code D16}, m/s in whole millimetres per second, or {@code null}
 * @param notHeld the fields whose value was not sent, in the order above
 */
record SensorFields(
    int revisit,
    int slantRangeError,
    double crossRangeAngle,
    int minimumSpeed,
    int probability,
    @Nullable Double reportRangeError,
    @Nullable Double reportCrossRangeError,
    @Nullable Double dwellMinimumSpeed,
    @Nullable Double track,
    @Nullable Double speed,
    List<String> notHeld) {

  /** The largest {@code I16}. */
  private static final long MAX_16 = 65_535;
  /** The largest {@code I8}. */
  private static final long MAX_8 = 255;
  /** The largest {@code I32}. */
  private static final long MAX_32 = 0xFFFF_FFFFL;
  /** An area centre this close to the sensor gives the cross-range error no angle. */
  private static final double ON_SENSOR_METRES = 1.0;

  SensorFields {
    notHeld = List.copyOf(notHeld);
  }

  /** What a dwell without a sensor sends (assumption B2): "no statement" everywhere, {@code J15} 0. */
  static final SensorFields NONE = new SensorFields(0, JobDefinition.NONE_16, JobDefinition.NO_CROSS_RANGE_ERROR, JobDefinition.NONE_8,
      JobDefinition.NONE_8, null, null, null, null, null, List.of());

  /**
   * @param sensor the dwell's sensor, or {@code null} from a sender built before CR-0033
   * @param rangeToCentre metres from the sensor to the area's centre as sent ({@code D24}, {@code D25})
   */
  static SensorFields of(ChannelItem.@Nullable Sensor sensor, double rangeToCentre) {
    if (sensor == null) {
      return NONE;
    }
    var notHeld = new ArrayList<String>();

    int revisit = 0;
    if (sensor.revisit() != null) {
      long ds = deciseconds(sensor.revisit());
      if (ds <= MAX_16) {
        revisit = (int) ds;
      } else {
        notHeld.add("J15"); // 0: "not revisiting", the only value that claims nothing false
      }
    }

    int slantRangeError = JobDefinition.NONE_16;
    Double reportRangeError = null;
    if (sensor.rangeError() != null) {
      long cm = Math.round(sensor.rangeError() * 100);
      if (cm < MAX_16) { // 65 535 is J21's "no statement"
        slantRangeError = (int) cm;
      } else {
        notHeld.add("J21");
      }
      if (cm <= MAX_16) {
        reportRangeError = cm / 100.0;
      } else {
        notHeld.add("D32.12");
      }
    }

    double crossRangeAngle = JobDefinition.NO_CROSS_RANGE_ERROR;
    Double reportCrossRangeError = null;
    if (sensor.crossRangeError() != null) {
      if (rangeToCentre >= ON_SENSOR_METRES) {
        crossRangeAngle = Math.toDegrees(Math.atan2(sensor.crossRangeError(), rangeToCentre)); // below 90°: a BA16 holds it
      } else {
        notHeld.add("J22"); // an area centred on the sensor: no range to see the error at
      }
      long dm = Math.round(sensor.crossRangeError() * 10);
      if (dm <= MAX_16) {
        reportCrossRangeError = dm / 10.0;
      } else {
        notHeld.add("D32.13");
      }
    }

    int minimumSpeed = JobDefinition.NONE_8;
    Double dwellMinimumSpeed = null;
    if (sensor.minimumDetectableSpeed() != null) {
      long dms = Math.round(sensor.minimumDetectableSpeed() * 10);
      if (dms < MAX_8) { // 255 is J24's "no statement"
        minimumSpeed = (int) dms;
      } else {
        notHeld.add("J24");
      }
      if (dms <= MAX_8) {
        dwellMinimumSpeed = dms / 10.0;
      } else {
        notHeld.add("D31");
      }
    }

    int probability = sensor.detectionProbability() == null ? JobDefinition.NONE_8 : (int) Math.round(sensor.detectionProbability() * 100);

    Double track = null;
    Double speed = null;
    if (sensor.platformDirection() != null && sensor.platformSpeed() != null) {
      long mms = Math.round(sensor.platformSpeed() * 1_000);
      if (mms <= MAX_32) {
        track = sensor.platformDirection();
        speed = mms / 1_000.0;
      } else {
        notHeld.add("D16"); // D15 to D17 come together
      }
    }
    return new SensorFields(revisit, slantRangeError, crossRangeAngle, minimumSpeed, probability, reportRangeError, reportCrossRangeError,
        dwellMinimumSpeed, track, speed, notHeld);
  }

  /** Whether the reports carry {@code D32.12} or {@code D32.13}: then the dwell needs {@code D12}–{@code D14} (AEDP 3.4.32.12). */
  boolean reportErrors() {
    return reportRangeError != null || reportCrossRangeError != null;
  }

  private static long deciseconds(Duration d) {
    if (d.getSeconds() > MAX_16) {
      return Long.MAX_VALUE; // far beyond J15, and no overflow
    }
    return Math.round((d.getSeconds() + d.getNano() / 1e9) * 10);
  }
}
