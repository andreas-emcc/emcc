package dev.emcc.plugins.gmti.format;

/**
 * The platform location segment, 23 bytes (AEDP 3.15, Table 3-24): where the platform is while the
 * sensor does not collect.
 *
 * @param time {@code L1}, milliseconds after midnight (UTC) of the reference day; may pass a day
 * @param latitude {@code L2}, degrees
 * @param longitude {@code L3}, degrees, −180 to 180
 * @param altitude {@code L4}, metres above the WGS84 ellipsoid (centimetres in the bytes)
 * @param track {@code L5}, degrees clockwise from true north
 * @param speed {@code L6}, m/s (mm/s in the bytes)
 * @param verticalVelocity {@code L7}, m/s (dm/s in the bytes)
 */
public record PlatformLocation(long time, double latitude, double longitude, double altitude, double track, double speed, double verticalVelocity)
    implements Segment {

  /** The body's size in bytes. */
  public static final int SIZE = 23;

  @Override
  public int type() {
    return PLATFORM_LOCATION;
  }
}
