package dev.emcc.ecore.geo;

/**
 * Geometry on the unit sphere: positions as unit vectors, so nothing special happens at the poles
 * or the antimeridian (spike S3). The earth is a sphere of the mean radius here; bounds that must
 * contain a geometry on the WGS84 ellipsoid are padded by {@link #PAD} (the two differ by less than
 * 0.5 %).
 */
public final class Sphere {

  /** Mean earth radius, metres. */
  public static final double R = 6_371_008.8;
  /** Relative padding of distances, covering sphere against ellipsoid. */
  static final double PAD = 1.005;

  private Sphere() {}

  /** Longitude, latitude in degrees (in that order, ADR-0007) to a unit vector. */
  public static double[] vec(double lon, double lat) {
    double l = Math.toRadians(lon);
    double p = Math.toRadians(lat);
    double c = Math.cos(p);
    return new double[] {c * Math.cos(l), c * Math.sin(l), Math.sin(p)};
  }

  static double dot(double[] a, double[] b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  static double[] cross(double[] a, double[] b) {
    return new double[] {a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]};
  }

  static double norm(double[] a) {
    return Math.sqrt(dot(a, a));
  }

  public static double[] normalize(double[] a) {
    double n = norm(a);
    return new double[] {a[0] / n, a[1] / n, a[2] / n};
  }

  /** The angle between two unit vectors, radians; accurate for small and large angles. */
  public static double angle(double[] a, double[] b) {
    return Math.atan2(norm(cross(a, b)), dot(a, b));
  }

  /** The longitude of a (not necessarily unit) vector, degrees. */
  public static double lon(double x, double y) {
    return Math.toDegrees(Math.atan2(y, x));
  }

  /** The latitude of a (not necessarily unit) vector, degrees. */
  public static double lat(double x, double y, double z) {
    return Math.toDegrees(Math.atan2(z, Math.hypot(x, y)));
  }

  /** Sign of the triple product (a × b) · c: which side of the great circle through a, b lies c. */
  static int orient(double[] a, double[] b, double[] c) {
    double d = (a[1] * b[2] - a[2] * b[1]) * c[0] + (a[2] * b[0] - a[0] * b[2]) * c[1] + (a[0] * b[1] - a[1] * b[0]) * c[2];
    return d > 0 ? 1 : d < 0 ? -1 : 0;
  }
}
