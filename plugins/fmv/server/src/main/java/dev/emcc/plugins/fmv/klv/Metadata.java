package dev.emcc.plugins.fmv.klv;

import org.jspecify.annotations.Nullable;

/**
 * One ST 0601 set, as far as the plugin uses it (brief section 2), in the units the plugin works in:
 * degrees, metres, and microseconds since 1970. A value the set did not carry, or that the standard
 * reserves as an error or that is out of its range, is {@code null}. Immutable, so it can travel in a
 * message.
 *
 * @param timeMicros tag 2, Precision Time Stamp, microseconds since 1970 UTC
 * @param missionId tag 3
 * @param platformDesignation tag 10
 * @param imageSourceSensor tag 11
 * @param heading tag 5, Platform Heading Angle, 0 to 360°
 * @param sensorLatitude tag 13, degrees
 * @param sensorLongitude tag 14, degrees
 * @param sensorAltitude tag 15, Sensor True Altitude, metres
 * @param horizontalFov tag 16, degrees
 * @param verticalFov tag 17, degrees
 * @param relativeAzimuth tag 18, Sensor Relative Azimuth Angle, 0 to 360°
 * @param relativeElevation tag 19, Sensor Relative Elevation Angle, ±180°
 * @param slantRange tag 21, metres
 * @param frameCenterLatitude tag 23, degrees
 * @param frameCenterLongitude tag 24, degrees
 * @param frameCenterElevation tag 25, metres
 * @param version tag 65, UAS Datalink LS Version Number
 * @param security tag 48, the nested ST 0102 set
 */
public record Metadata(
    @Nullable Long timeMicros,
    @Nullable String missionId,
    @Nullable String platformDesignation,
    @Nullable String imageSourceSensor,
    @Nullable Double heading,
    @Nullable Double sensorLatitude,
    @Nullable Double sensorLongitude,
    @Nullable Double sensorAltitude,
    @Nullable Double horizontalFov,
    @Nullable Double verticalFov,
    @Nullable Double relativeAzimuth,
    @Nullable Double relativeElevation,
    @Nullable Double slantRange,
    @Nullable Double frameCenterLatitude,
    @Nullable Double frameCenterLongitude,
    @Nullable Double frameCenterElevation,
    @Nullable Integer version,
    @Nullable Security security) {

  /**
   * The ST 0102 set (tags 1, 2, 3, 6 and 22 are read, brief section 2).
   *
   * @param classification tag 1: 1 UNCLASSIFIED, 2 RESTRICTED, 3 CONFIDENTIAL, 4 SECRET, 5 TOP SECRET
   * @param countryMethod tag 2, the classifying country's coding method
   * @param country tag 3, the classifying country as written
   * @param releasing tag 6, releasing instructions as written
   * @param version tag 22
   */
  public record Security(
      @Nullable Integer classification,
      @Nullable Integer countryMethod,
      @Nullable String country,
      @Nullable String releasing,
      @Nullable Integer version) {}

  /** Whether the set gives the camera a position: both latitude and longitude. */
  public boolean hasSensorPosition() {
    return sensorLatitude != null && sensorLongitude != null;
  }

  /** Whether the set gives the frame centre: both latitude and longitude. */
  public boolean hasFrameCenter() {
    return frameCenterLatitude != null && frameCenterLongitude != null;
  }
}
