package dev.emcc.plugins.gmti.format;

import org.jspecify.annotations.Nullable;

/**
 * One target report of a dwell (AEDP 3.4.32, Table 3-10), in metres, m/s, degrees and dB. A field
 * the dwell's existence mask leaves out is {@code null}; every report of one dwell segment has the
 * same fields.
 *
 * @param index {@code D32.1}, the report's number in the dwell
 * @param latitude {@code D32.2}, or from {@code D32.4} with {@code D10} and {@code D24}
 * @param longitude {@code D32.3}, or from {@code D32.5} with {@code D11} and {@code D25}; −180 to 180
 * @param reduced whether the position came, or goes, as deltas ({@code D32.4}, {@code D32.5}) rather than full precision
 * @param height {@code D32.6}, metres above the ellipsoid
 * @param radialVelocity {@code D32.7}, m/s along the line of sight, away from the sensor positive (cm/s in the bytes)
 * @param wrapVelocity {@code D32.8}, m/s (cm/s in the bytes)
 * @param snr {@code D32.9}, dB
 * @param classification {@code D32.10} (Table 3-11): 0 to 127 live, 128 to 255 simulated
 * @param classificationProbability {@code D32.11}, percent
 * @param slantRangeError {@code D32.12}, m (cm in the bytes)
 * @param crossRangeError {@code D32.13}, m (dm in the bytes)
 * @param heightError {@code D32.14}, m
 * @param radialVelocityError {@code D32.15}, m/s (cm/s in the bytes)
 * @param truthApplication {@code D32.16}
 * @param truthEntity {@code D32.17}, unsigned
 * @param rcs {@code D32.18}, dB (half decibels in the bytes)
 */
public record TargetReport(
    @Nullable Integer index,
    double latitude,
    double longitude,
    boolean reduced,
    @Nullable Integer height,
    @Nullable Double radialVelocity,
    @Nullable Double wrapVelocity,
    @Nullable Integer snr,
    @Nullable Integer classification,
    @Nullable Integer classificationProbability,
    @Nullable Double slantRangeError,
    @Nullable Double crossRangeError,
    @Nullable Integer heightError,
    @Nullable Double radialVelocityError,
    @Nullable Integer truthApplication,
    @Nullable Long truthEntity,
    @Nullable Double rcs) {

  /** A report at a position, full precision, with nothing else. */
  public static Builder at(double latitude, double longitude) {
    return new Builder(latitude, longitude);
  }

  /** The report's fields as existence mask bits ({@link Dwell#reportBit}). */
  long maskBits() {
    long m = 0;
    m |= bit(index != null, 1);
    m |= reduced ? Dwell.reportBit(4) | Dwell.reportBit(5) : Dwell.reportBit(2) | Dwell.reportBit(3);
    m |= bit(height != null, 6);
    m |= bit(radialVelocity != null, 7);
    m |= bit(wrapVelocity != null, 8);
    m |= bit(snr != null, 9);
    m |= bit(classification != null, 10);
    m |= bit(classificationProbability != null, 11);
    m |= bit(slantRangeError != null, 12);
    m |= bit(crossRangeError != null, 13);
    m |= bit(heightError != null, 14);
    m |= bit(radialVelocityError != null, 15);
    m |= bit(truthApplication != null, 16);
    m |= bit(truthEntity != null, 17);
    m |= bit(rcs != null, 18);
    return m;
  }

  private static long bit(boolean present, int n) {
    return present ? Dwell.reportBit(n) : 0;
  }

  /** Builds a report; every field but the position starts absent. */
  public static final class Builder {
    private @Nullable Integer index;
    private final double latitude;
    private final double longitude;
    private boolean reduced;
    private @Nullable Integer height;
    private @Nullable Double radialVelocity;
    private @Nullable Double wrapVelocity;
    private @Nullable Integer snr;
    private @Nullable Integer classification;
    private @Nullable Integer classificationProbability;
    private @Nullable Double slantRangeError;
    private @Nullable Double crossRangeError;
    private @Nullable Integer heightError;
    private @Nullable Double radialVelocityError;
    private @Nullable Integer truthApplication;
    private @Nullable Long truthEntity;
    private @Nullable Double rcs;

    private Builder(double latitude, double longitude) {
      this.latitude = latitude;
      this.longitude = longitude;
    }

    public Builder index(@Nullable Integer v) {
      index = v;
      return this;
    }

    /** Sends (or came as) deltas against the dwell's area centre and scale factors. */
    public Builder reduced(boolean v) {
      reduced = v;
      return this;
    }

    public Builder height(@Nullable Integer v) {
      height = v;
      return this;
    }

    public Builder radialVelocity(@Nullable Double v) {
      radialVelocity = v;
      return this;
    }

    public Builder wrapVelocity(@Nullable Double v) {
      wrapVelocity = v;
      return this;
    }

    public Builder snr(@Nullable Integer v) {
      snr = v;
      return this;
    }

    public Builder classification(@Nullable Integer v) {
      classification = v;
      return this;
    }

    public Builder classificationProbability(@Nullable Integer v) {
      classificationProbability = v;
      return this;
    }

    public Builder slantRangeError(@Nullable Double v) {
      slantRangeError = v;
      return this;
    }

    public Builder crossRangeError(@Nullable Double v) {
      crossRangeError = v;
      return this;
    }

    public Builder heightError(@Nullable Integer v) {
      heightError = v;
      return this;
    }

    public Builder radialVelocityError(@Nullable Double v) {
      radialVelocityError = v;
      return this;
    }

    public Builder truthTag(@Nullable Integer application, @Nullable Long entity) {
      truthApplication = application;
      truthEntity = entity;
      return this;
    }

    public Builder rcs(@Nullable Double v) {
      rcs = v;
      return this;
    }

    public TargetReport build() {
      return new TargetReport(
          index, latitude, longitude, reduced, height, radialVelocity, wrapVelocity, snr, classification, classificationProbability,
          slantRangeError, crossRangeError, heightError, radialVelocityError, truthApplication, truthEntity, rcs);
    }
  }
}
