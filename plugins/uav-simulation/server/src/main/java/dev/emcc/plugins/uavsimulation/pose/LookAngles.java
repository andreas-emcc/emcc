package dev.emcc.plugins.uavsimulation.pose;

/**
 * A direction seen from a point: an azimuth, degrees clockwise from true north (0 to below 360), and a
 * depression below the local horizontal, degrees (−90 to 90, positive down). Brief function 6, "Track
 * a point": the straight line from the camera to the point in the camera's local level frame, by WGS84
 * ECEF to local north, east, down (no flat Earth).
 *
 * @param azimuth 0 to below 360
 * @param depression −90 to 90, positive down
 */
public record LookAngles(double azimuth, double depression) {

  /** WGS84 semi-major axis, metres. */
  static final double A = 6_378_137.0;

  /** WGS84 flattening. */
  static final double F = 1 / 298.257223563;

  /** WGS84 first eccentricity squared. */
  static final double E2 = F * (2 - F);

  /** Below this horizontal distance, metres, a point counts as straight below or above: azimuth 0. */
  static final double STRAIGHT_DOWN_METRES = 0.001;

  public LookAngles {
    if (!(azimuth >= 0 && azimuth < 360)) {
      throw new IllegalArgumentException("azimuth must be 0 to below 360: " + azimuth);
    }
    if (!(depression >= -90 && depression <= 90)) {
      throw new IllegalArgumentException("depression must be -90 to 90: " + depression);
    }
  }

  /**
   * The line of sight from one point to another, both given as longitude, latitude and height above
   * the ellipsoid. A point straight below gives depression 90 and azimuth 0; one straight above −90 and
   * azimuth 0. Equal points give azimuth 0 and depression 90 (looking down).
   */
  public static LookAngles between(double fromLon, double fromLat, double fromHeight, double toLon, double toLat, double toHeight) {
    double[] from = ecef(fromLon, fromLat, fromHeight);
    double[] to = ecef(toLon, toLat, toHeight);
    double dx = to[0] - from[0];
    double dy = to[1] - from[1];
    double dz = to[2] - from[2];
    double lat = Math.toRadians(fromLat);
    double lon = Math.toRadians(fromLon);
    double sinLat = Math.sin(lat);
    double cosLat = Math.cos(lat);
    double sinLon = Math.sin(lon);
    double cosLon = Math.cos(lon);
    double north = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
    double east = -sinLon * dx + cosLon * dy;
    double down = -cosLat * cosLon * dx - cosLat * sinLon * dy - sinLat * dz;
    double horizontal = Math.hypot(north, east);
    if (horizontal < STRAIGHT_DOWN_METRES) {
      return new LookAngles(0, down < 0 ? -90 : 90);
    }
    return new LookAngles(Angles.azimuth(Math.toDegrees(Math.atan2(east, north))), Math.toDegrees(Math.atan2(down, horizontal)));
  }

  /** WGS84 geodetic to earth-centred, earth-fixed: {x, y, z} in metres. */
  static double[] ecef(double lon, double lat, double height) {
    double phi = Math.toRadians(lat);
    double lambda = Math.toRadians(lon);
    double sinPhi = Math.sin(phi);
    double cosPhi = Math.cos(phi);
    double n = A / Math.sqrt(1 - E2 * sinPhi * sinPhi);
    return new double[] {
        (n + height) * cosPhi * Math.cos(lambda),
        (n + height) * cosPhi * Math.sin(lambda),
        (n * (1 - E2) + height) * sinPhi};
  }
}
