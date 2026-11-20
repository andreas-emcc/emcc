package dev.emcc.plugins.gmti.format;

import dev.emcc.sdk.model.Position;
import java.util.List;
import java.util.Objects;

/**
 * The job definition segment, 68 bytes (AEDP 3.7, Table 3-14). The nominal values are kept in the
 * format's own units, with their "no statement" values ({@link #NONE_16}, {@link #NONE_8}, {@link
 * #NO_CROSS_RANGE_ERROR}), so that a reader can tell a stated value from none.
 *
 * @param jobId {@code J1}, unsigned
 * @param sensorType {@code J2} (Table 3-15): 255 no statement
 * @param sensorModel {@code J3}
 * @param filtering {@code J4}: bit 0 area, bit 1 area blanking, bit 2 sector blanking
 * @param priority {@code J5}: 1 highest … 99; 255 the job has ended
 * @param boundingArea {@code J6}–{@code J13}: the four corners A to D, clockwise, longitude first
 * @param radarMode {@code J14} (Table 3-16)
 * @param revisitInterval {@code J15}, deciseconds; 0 when not revisiting
 * @param alongTrackError {@code J16}, dm
 * @param crossTrackError {@code J17}, dm
 * @param altitudeError {@code J18}, dm
 * @param trackError {@code J19}, degrees ({@link #NONE_8} none)
 * @param speedError {@code J20}, mm/s
 * @param slantRangeError {@code J21}, cm
 * @param crossRangeError {@code J22}, an angle in degrees ({@link #NO_CROSS_RANGE_ERROR} none)
 * @param radialVelocityError {@code J23}, cm/s
 * @param minimumDetectableVelocity {@code J24}, dm/s ({@link #NONE_8} none)
 * @param detectionProbability {@code J25}, percent ({@link #NONE_8} none)
 * @param falseAlarmDensity {@code J26} ({@link #NONE_8} none)
 * @param terrainModel {@code J27} (Table 3-17)
 * @param geoidModel {@code J28} (Table 3-18)
 */
public record JobDefinition(
    long jobId,
    int sensorType,
    String sensorModel,
    int filtering,
    int priority,
    List<Position> boundingArea,
    int radarMode,
    int revisitInterval,
    int alongTrackError,
    int crossTrackError,
    int altitudeError,
    int trackError,
    int speedError,
    int slantRangeError,
    double crossRangeError,
    int radialVelocityError,
    int minimumDetectableVelocity,
    int detectionProbability,
    int falseAlarmDensity,
    int terrainModel,
    int geoidModel)
    implements Segment {

  /** The body's size in bytes. */
  public static final int SIZE = 68;
  /** "No statement" in a 16-bit nominal value. */
  public static final int NONE_16 = 65_535;
  /** "No statement" in an 8-bit nominal value, the sensor type and a priority that ends the job. */
  public static final int NONE_8 = 255;
  /** "No statement" for {@code J22}. */
  public static final double NO_CROSS_RANGE_ERROR = 180.0;
  /** {@code J5} of a job that has ended. */
  public static final int ENDED = 255;
  /** {@code J14} MTI. */
  public static final int MODE_MTI = 1;

  public JobDefinition {
    Objects.requireNonNull(sensorModel, "sensorModel");
    boundingArea = List.copyOf(boundingArea);
    if (boundingArea.size() != 4) {
      throw new IllegalArgumentException("a bounding area has four corners: " + boundingArea.size());
    }
  }

  @Override
  public int type() {
    return JOB_DEFINITION;
  }

  /** Whether {@code J5} says the job has ended. */
  public boolean ended() {
    return priority == ENDED;
  }
}
