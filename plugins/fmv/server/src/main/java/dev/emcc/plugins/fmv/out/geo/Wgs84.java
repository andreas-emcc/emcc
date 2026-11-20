package dev.emcc.plugins.fmv.out.geo;

/** The WGS84 ellipsoid: geodetic (longitude, latitude in degrees, height in metres HAE) and ECEF. */
public final class Wgs84 {

  /** The semi-major axis, metres. */
  public static final double A = 6378137.0;

  /** The flattening. */
  public static final double F = 1 / 298.257223563;

  /** The first eccentricity squared. */
  public static final double E2 = F * (2 - F);

  private Wgs84() {}

  /** The prime vertical radius of curvature at a latitude, metres. */
  public static double primeVerticalRadius(double latDeg) {
    double s = Math.sin(Math.toRadians(latDeg));
    return A / Math.sqrt(1 - E2 * s * s);
  }

  /** The meridian radius of curvature at a latitude, metres. */
  public static double meridianRadius(double latDeg) {
    double s = Math.sin(Math.toRadians(latDeg));
    double w = 1 - E2 * s * s;
    return A * (1 - E2) / (w * Math.sqrt(w));
  }

  /** Writes the ECEF {@code {x, y, z}} of a geodetic point into {@code out}. */
  public static void toEcef(double lonDeg, double latDeg, double height, double[] out) {
    double lat = Math.toRadians(latDeg);
    double lon = Math.toRadians(lonDeg);
    double n = primeVerticalRadius(latDeg);
    double cl = Math.cos(lat);
    out[0] = (n + height) * cl * Math.cos(lon);
    out[1] = (n + height) * cl * Math.sin(lon);
    out[2] = (n * (1 - E2) + height) * Math.sin(lat);
  }

  /**
   * Writes the geodetic {@code {longitude, latitude, height}} of an ECEF point into {@code out}:
   * an iteration on the latitude, to well below a millimetre for points near the Earth's surface,
   * and Bowring's height, which holds at the poles too.
   */
  public static void fromEcef(double x, double y, double z, double[] out) {
    double p = Math.hypot(x, y);
    double lat = Math.atan2(z, p * (1 - E2));
    for (int i = 0; i < 5; i++) {
      double s = Math.sin(lat);
      double n = A / Math.sqrt(1 - E2 * s * s);
      double h = p * Math.cos(lat) + z * s - A * A / n;
      lat = Math.atan2(z, p * (1 - E2 * n / (n + h)));
    }
    double s = Math.sin(lat);
    out[0] = Math.toDegrees(Math.atan2(y, x));
    out[1] = Math.toDegrees(lat);
    out[2] = p * Math.cos(lat) + z * s - A * Math.sqrt(1 - E2 * s * s);
  }
}
