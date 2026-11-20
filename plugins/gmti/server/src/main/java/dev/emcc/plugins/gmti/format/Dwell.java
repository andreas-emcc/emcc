package dev.emcc.plugins.gmti.format;

import java.util.ArrayList;
import java.util.List;
import org.jspecify.annotations.Nullable;

/**
 * The dwell segment (AEDP 3.4, Table 3-9), in metres, m/s, degrees and kilometres. Which fields it
 * has is its existence mask ({@code D1}); a field the mask leaves out is {@code null}. Longitudes
 * are −180 to 180, latitudes first in the bytes only.
 *
 * @param revisitIndex {@code D2}
 * @param dwellIndex {@code D3}
 * @param lastDwell {@code D4}: no more dwells in this revisit
 * @param time {@code D6}, milliseconds after midnight (UTC) of the reference day, to the dwell's centre; may pass a day
 * @param sensorLatitude {@code D7}
 * @param sensorLongitude {@code D8}
 * @param sensorAltitude {@code D9}, metres above the WGS84 ellipsoid (centimetres in the bytes)
 * @param latitudeScale {@code D10}, degrees per delta step of the reduced positions
 * @param longitudeScale {@code D11}, degrees per delta step
 * @param alongTrackError {@code D12}, m (cm in the bytes)
 * @param crossTrackError {@code D13}, m (cm)
 * @param altitudeError {@code D14}, m (cm)
 * @param sensorTrack {@code D15}, degrees clockwise from true north
 * @param sensorSpeed {@code D16}, m/s (mm/s)
 * @param sensorVerticalVelocity {@code D17}, m/s (dm/s)
 * @param trackError {@code D18}, degrees
 * @param speedError {@code D19}, m/s (mm/s)
 * @param verticalVelocityError {@code D20}, m/s (cm/s)
 * @param platformHeading {@code D21}, degrees
 * @param platformPitch {@code D22}, degrees
 * @param platformRoll {@code D23}, degrees
 * @param areaLatitude {@code D24}, the dwell area's centre
 * @param areaLongitude {@code D25}
 * @param rangeHalfExtent {@code D26}, kilometres along the ground
 * @param angleHalfExtent {@code D27}, degrees seen from the sensor
 * @param sensorHeading {@code D28}, degrees
 * @param sensorPitch {@code D29}, degrees
 * @param sensorRoll {@code D30}, degrees
 * @param minimumDetectableVelocity {@code D31}, m/s (dm/s)
 * @param reports the target reports; their count is {@code D5}
 */
public record Dwell(
    int revisitIndex,
    int dwellIndex,
    boolean lastDwell,
    long time,
    double sensorLatitude,
    double sensorLongitude,
    double sensorAltitude,
    @Nullable Double latitudeScale,
    @Nullable Double longitudeScale,
    @Nullable Double alongTrackError,
    @Nullable Double crossTrackError,
    @Nullable Double altitudeError,
    @Nullable Double sensorTrack,
    @Nullable Double sensorSpeed,
    @Nullable Double sensorVerticalVelocity,
    @Nullable Integer trackError,
    @Nullable Double speedError,
    @Nullable Double verticalVelocityError,
    @Nullable Double platformHeading,
    @Nullable Double platformPitch,
    @Nullable Double platformRoll,
    double areaLatitude,
    double areaLongitude,
    double rangeHalfExtent,
    double angleHalfExtent,
    @Nullable Double sensorHeading,
    @Nullable Double sensorPitch,
    @Nullable Double sensorRoll,
    @Nullable Double minimumDetectableVelocity,
    List<TargetReport> reports)
    implements Segment {

  /** The body's size with only the mandatory fields: mask, {@code D2}–{@code D9}, {@code D24}–{@code D27}. */
  public static final int MANDATORY_SIZE = 43;

  /** The most reports one segment can count ({@code D5} is an {@code I16}). */
  public static final int MAX_REPORTS = 65_535;

  /** The mask bits of the mandatory fields. */
  public static final long MANDATORY_MASK = 0xFF00_03C0_0000_0000L;

  public Dwell {
    reports = List.copyOf(reports);
    if (reports.size() > MAX_REPORTS) {
      throw new IllegalArgumentException("at most " + MAX_REPORTS + " reports in one dwell segment: " + reports.size());
    }
  }

  @Override
  public int type() {
    return DWELL;
  }

  /** The existence mask bit of body field {@code D<k>}, 2 ≤ k ≤ 31 (AEDP Figure 3-1: {@code D2} is the first bit sent). */
  public static long bodyBit(int k) {
    if (k < 2 || k > 31) {
      throw new IllegalArgumentException("a body field is D2 to D31: D" + k);
    }
    return 1L << (65 - k);
  }

  /** The existence mask bit of report field {@code D32.<n>}, 1 ≤ n ≤ 18. */
  public static long reportBit(int n) {
    if (n < 1 || n > 18) {
      throw new IllegalArgumentException("a report field is D32.1 to D32.18: D32." + n);
    }
    return 1L << (34 - n);
  }

  /** All report bits ({@code D32.1} to {@code D32.18}). */
  static final long REPORT_BITS = 0x0000_0003_FFFF_0000L;

  /** The existence mask of the body fields this dwell has (no report bits). */
  public long bodyMask() {
    long m = MANDATORY_MASK;
    m |= latitudeScale != null ? bodyBit(10) : 0;
    m |= longitudeScale != null ? bodyBit(11) : 0;
    m |= alongTrackError != null ? bodyBit(12) : 0;
    m |= crossTrackError != null ? bodyBit(13) : 0;
    m |= altitudeError != null ? bodyBit(14) : 0;
    m |= sensorTrack != null ? bodyBit(15) : 0;
    m |= sensorSpeed != null ? bodyBit(16) : 0;
    m |= sensorVerticalVelocity != null ? bodyBit(17) : 0;
    m |= trackError != null ? bodyBit(18) : 0;
    m |= speedError != null ? bodyBit(19) : 0;
    m |= verticalVelocityError != null ? bodyBit(20) : 0;
    m |= platformHeading != null ? bodyBit(21) : 0;
    m |= platformPitch != null ? bodyBit(22) : 0;
    m |= platformRoll != null ? bodyBit(23) : 0;
    m |= sensorHeading != null ? bodyBit(28) : 0;
    m |= sensorPitch != null ? bodyBit(29) : 0;
    m |= sensorRoll != null ? bodyBit(30) : 0;
    m |= minimumDetectableVelocity != null ? bodyBit(31) : 0;
    return m;
  }

  /** The same dwell with other reports (a part of a split dwell, AEDP 3.4.32). */
  public Dwell withReports(List<TargetReport> value) {
    return toBuilder().reports(value).build();
  }

  /** A builder holding this dwell's fields. */
  public Builder toBuilder() {
    Builder b = new Builder(revisitIndex, dwellIndex, time, sensorLatitude, sensorLongitude, sensorAltitude, areaLatitude, areaLongitude,
        rangeHalfExtent, angleHalfExtent);
    b.lastDwell = lastDwell;
    b.latitudeScale = latitudeScale;
    b.longitudeScale = longitudeScale;
    b.alongTrackError = alongTrackError;
    b.crossTrackError = crossTrackError;
    b.altitudeError = altitudeError;
    b.sensorTrack = sensorTrack;
    b.sensorSpeed = sensorSpeed;
    b.sensorVerticalVelocity = sensorVerticalVelocity;
    b.trackError = trackError;
    b.speedError = speedError;
    b.verticalVelocityError = verticalVelocityError;
    b.platformHeading = platformHeading;
    b.platformPitch = platformPitch;
    b.platformRoll = platformRoll;
    b.sensorHeading = sensorHeading;
    b.sensorPitch = sensorPitch;
    b.sensorRoll = sensorRoll;
    b.minimumDetectableVelocity = minimumDetectableVelocity;
    b.reports.addAll(reports);
    return b;
  }

  /**
   * A dwell with the mandatory fields; the others start absent.
   *
   * @param time milliseconds after midnight of the reference day
   * @param rangeHalfExtent kilometres
   */
  public static Builder of(int revisitIndex, int dwellIndex, long time, double sensorLatitude, double sensorLongitude, double sensorAltitude,
      double areaLatitude, double areaLongitude, double rangeHalfExtent, double angleHalfExtent) {
    return new Builder(revisitIndex, dwellIndex, time, sensorLatitude, sensorLongitude, sensorAltitude, areaLatitude, areaLongitude,
        rangeHalfExtent, angleHalfExtent);
  }

  /** Builds a dwell segment. */
  public static final class Builder {
    private final int revisitIndex;
    private final int dwellIndex;
    private final long time;
    private final double sensorLatitude;
    private final double sensorLongitude;
    private final double sensorAltitude;
    private final double areaLatitude;
    private final double areaLongitude;
    private final double rangeHalfExtent;
    private final double angleHalfExtent;
    private boolean lastDwell = true;
    private @Nullable Double latitudeScale;
    private @Nullable Double longitudeScale;
    private @Nullable Double alongTrackError;
    private @Nullable Double crossTrackError;
    private @Nullable Double altitudeError;
    private @Nullable Double sensorTrack;
    private @Nullable Double sensorSpeed;
    private @Nullable Double sensorVerticalVelocity;
    private @Nullable Integer trackError;
    private @Nullable Double speedError;
    private @Nullable Double verticalVelocityError;
    private @Nullable Double platformHeading;
    private @Nullable Double platformPitch;
    private @Nullable Double platformRoll;
    private @Nullable Double sensorHeading;
    private @Nullable Double sensorPitch;
    private @Nullable Double sensorRoll;
    private @Nullable Double minimumDetectableVelocity;
    private final List<TargetReport> reports = new ArrayList<>();

    private Builder(int revisitIndex, int dwellIndex, long time, double sensorLatitude, double sensorLongitude, double sensorAltitude,
        double areaLatitude, double areaLongitude, double rangeHalfExtent, double angleHalfExtent) {
      this.revisitIndex = revisitIndex;
      this.dwellIndex = dwellIndex;
      this.time = time;
      this.sensorLatitude = sensorLatitude;
      this.sensorLongitude = sensorLongitude;
      this.sensorAltitude = sensorAltitude;
      this.areaLatitude = areaLatitude;
      this.areaLongitude = areaLongitude;
      this.rangeHalfExtent = rangeHalfExtent;
      this.angleHalfExtent = angleHalfExtent;
    }

    /** {@code D4}; true by default (one dwell per revisit, reference 3.2). */
    public Builder lastDwell(boolean v) {
      lastDwell = v;
      return this;
    }

    /** {@code D10}, {@code D11}: needed by reduced positions. */
    public Builder scales(@Nullable Double latitude, @Nullable Double longitude) {
      latitudeScale = latitude;
      longitudeScale = longitude;
      return this;
    }

    /** {@code D12}–{@code D14}, metres. */
    public Builder sensorPositionError(@Nullable Double alongTrack, @Nullable Double crossTrack, @Nullable Double altitude) {
      alongTrackError = alongTrack;
      crossTrackError = crossTrack;
      altitudeError = altitude;
      return this;
    }

    /** {@code D15}–{@code D17}: degrees, m/s, m/s. */
    public Builder sensorMotion(@Nullable Double track, @Nullable Double speed, @Nullable Double verticalVelocity) {
      sensorTrack = track;
      sensorSpeed = speed;
      sensorVerticalVelocity = verticalVelocity;
      return this;
    }

    /** {@code D18}–{@code D20}: degrees, m/s, m/s. */
    public Builder sensorMotionError(@Nullable Integer track, @Nullable Double speed, @Nullable Double verticalVelocity) {
      trackError = track;
      speedError = speed;
      verticalVelocityError = verticalVelocity;
      return this;
    }

    /** {@code D21}–{@code D23}, degrees. */
    public Builder platformAttitude(@Nullable Double heading, @Nullable Double pitch, @Nullable Double roll) {
      platformHeading = heading;
      platformPitch = pitch;
      platformRoll = roll;
      return this;
    }

    /** {@code D28}–{@code D30}, degrees. */
    public Builder sensorOrientation(@Nullable Double heading, @Nullable Double pitch, @Nullable Double roll) {
      sensorHeading = heading;
      sensorPitch = pitch;
      sensorRoll = roll;
      return this;
    }

    /** {@code D31}, m/s. */
    public Builder minimumDetectableVelocity(@Nullable Double v) {
      minimumDetectableVelocity = v;
      return this;
    }

    public Builder report(TargetReport r) {
      reports.add(r);
      return this;
    }

    public Builder reports(List<TargetReport> value) {
      reports.clear();
      reports.addAll(value);
      return this;
    }

    public Dwell build() {
      return new Dwell(
          revisitIndex, dwellIndex, lastDwell, time, sensorLatitude, sensorLongitude, sensorAltitude, latitudeScale, longitudeScale,
          alongTrackError, crossTrackError, altitudeError, sensorTrack, sensorSpeed, sensorVerticalVelocity, trackError, speedError,
          verticalVelocityError, platformHeading, platformPitch, platformRoll, areaLatitude, areaLongitude, rangeHalfExtent,
          angleHalfExtent, sensorHeading, sensorPitch, sensorRoll, minimumDetectableVelocity, reports);
    }
  }
}
