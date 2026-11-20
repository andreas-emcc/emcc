package dev.emcc.plugins.fmv.out.geo;

/**
 * A local east, north, up frame at a geodetic origin (the camera), in metres.
 *
 * <p>{@link #toGeodetic} and {@link #toEnu} are exact (through ECEF). {@link #lonAt}, {@link
 * #latAt} and {@link #upOfHeight} are the cheap first-order forms the renderer uses inside its
 * terrain search, where a few metres do not matter: at 10 km they are off by about 15 m in position
 * and the Earth's curvature (about 8 m of drop at 10 km) is kept.
 */
public final class LocalFrame {

  private final double lon0;
  private final double lat0;
  private final double h0;
  private final double x0;
  private final double y0;
  private final double z0;
  private final double sinLon;
  private final double cosLon;
  private final double sinLat;
  private final double cosLat;
  private final double metresPerDegreeLat;
  private final double metresPerDegreeLon;
  private final double twiceRadius;

  /**
   * @param lonDeg the origin's longitude
   * @param latDeg the origin's latitude, −89 to 89 (a camera over a pole is not served)
   * @param height the origin's height, metres HAE
   */
  public LocalFrame(double lonDeg, double latDeg, double height) {
    if (!(latDeg >= -89 && latDeg <= 89) || !Double.isFinite(lonDeg) || !Double.isFinite(height)) {
      throw new IllegalArgumentException("a frame needs a finite origin below 89° of latitude: " + lonDeg + ", " + latDeg + ", " + height);
    }
    this.lon0 = lonDeg;
    this.lat0 = latDeg;
    this.h0 = height;
    double[] e = new double[3];
    Wgs84.toEcef(lonDeg, latDeg, height, e);
    x0 = e[0];
    y0 = e[1];
    z0 = e[2];
    sinLon = Math.sin(Math.toRadians(lonDeg));
    cosLon = Math.cos(Math.toRadians(lonDeg));
    sinLat = Math.sin(Math.toRadians(latDeg));
    cosLat = Math.cos(Math.toRadians(latDeg));
    double m = Wgs84.meridianRadius(latDeg);
    double n = Wgs84.primeVerticalRadius(latDeg);
    metresPerDegreeLat = Math.toRadians(m + height);
    metresPerDegreeLon = Math.toRadians((n + height) * cosLat);
    twiceRadius = 2 * Math.sqrt(m * n);
  }

  public double lon() {
    return lon0;
  }

  public double lat() {
    return lat0;
  }

  public double height() {
    return h0;
  }

  /** Writes the geodetic {@code {longitude, latitude, height}} of a local point into {@code out}. */
  public void toGeodetic(double east, double north, double up, double[] out) {
    double x = x0 - sinLon * east - sinLat * cosLon * north + cosLat * cosLon * up;
    double y = y0 + cosLon * east - sinLat * sinLon * north + cosLat * sinLon * up;
    double z = z0 + cosLat * north + sinLat * up;
    Wgs84.fromEcef(x, y, z, out);
  }

  /** Writes the local {@code {east, north, up}} of a geodetic point into {@code out}. */
  public void toEnu(double lonDeg, double latDeg, double height, double[] out) {
    double[] e = new double[3];
    Wgs84.toEcef(lonDeg, latDeg, height, e);
    double dx = e[0] - x0;
    double dy = e[1] - y0;
    double dz = e[2] - z0;
    out[0] = -sinLon * dx + cosLon * dy;
    out[1] = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
    out[2] = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;
  }

  /** The longitude east metres from the origin, first order. */
  public double lonAt(double east) {
    return lon0 + east / metresPerDegreeLon;
  }

  /** The latitude north metres from the origin, first order. */
  public double latAt(double north) {
    return lat0 + north / metresPerDegreeLat;
  }

  /**
   * The local up coordinate of the ground at a height (metres HAE) a horizontal distance squared
   * from the origin: the height difference less the Earth's curvature, {@code d² / 2R}.
   */
  public double upOfHeight(double height, double horizontalSquared) {
    return height - h0 - horizontalSquared / twiceRadius;
  }
}
