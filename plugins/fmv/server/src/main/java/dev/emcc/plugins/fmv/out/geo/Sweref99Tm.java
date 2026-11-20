package dev.emcc.plugins.fmv.out.geo;

/**
 * SWEREF 99 TM (EPSG:3006): transverse Mercator on GRS 80, central meridian 15° E, scale 0.9996,
 * false easting 500 000 m. Krüger's series to the fourth order, as Lantmäteriet publishes them
 * ("Gauss conformal projection"; spike S10's {@code sweref.py}): well below a millimetre in Sweden.
 * Imagery in this CRS is Lantmäteriet's (brief section 10.5, O4).
 */
public final class Sweref99Tm {

  private static final double A = 6378137.0;
  private static final double F = 1 / 298.257222101;
  private static final double K0 = 0.9996;
  private static final double LON0 = Math.toRadians(15);
  private static final double FALSE_EASTING = 500_000;

  private static final double E2 = F * (2 - F);
  private static final double N = F / (2 - F);
  private static final double A_HAT = A / (1 + N) * (1 + N * N / 4 + Math.pow(N, 4) / 64);

  // forward: geodetic to conformal latitude, then the series
  private static final double FA = E2;
  private static final double FB = (5 * E2 * E2 - Math.pow(E2, 3)) / 6;
  private static final double FC = (104 * Math.pow(E2, 3) - 45 * Math.pow(E2, 4)) / 120;
  private static final double FD = 1237 * Math.pow(E2, 4) / 1260;
  private static final double B1 = N / 2 - 2 * N * N / 3 + 5 * Math.pow(N, 3) / 16 + 41 * Math.pow(N, 4) / 180;
  private static final double B2 = 13 * N * N / 48 - 3 * Math.pow(N, 3) / 5 + 557 * Math.pow(N, 4) / 1440;
  private static final double B3 = 61 * Math.pow(N, 3) / 240 - 103 * Math.pow(N, 4) / 140;
  private static final double B4 = 49561 * Math.pow(N, 4) / 161280;

  // inverse: the series back, then conformal to geodetic latitude
  private static final double D1 = N / 2 - 2 * N * N / 3 + 37 * Math.pow(N, 3) / 96 - Math.pow(N, 4) / 360;
  private static final double D2 = N * N / 48 + Math.pow(N, 3) / 15 - 437 * Math.pow(N, 4) / 1440;
  private static final double D3 = 17 * Math.pow(N, 3) / 480 - 37 * Math.pow(N, 4) / 840;
  private static final double D4 = 4397 * Math.pow(N, 4) / 161280;
  private static final double IA = E2 + E2 * E2 + Math.pow(E2, 3) + Math.pow(E2, 4);
  private static final double IB = -(7 * E2 * E2 + 17 * Math.pow(E2, 3) + 30 * Math.pow(E2, 4)) / 6;
  private static final double IC = (224 * Math.pow(E2, 3) + 889 * Math.pow(E2, 4)) / 120;
  private static final double ID = -(4279 * Math.pow(E2, 4)) / 1260;

  private Sweref99Tm() {}

  /** Writes {@code {easting, northing}} in metres for a longitude and latitude (degrees) into {@code out}. */
  public static void forward(double lonDeg, double latDeg, double[] out) {
    double phi = Math.toRadians(latDeg);
    double dl = Math.toRadians(lonDeg) - LON0;
    double s = Math.sin(phi);
    double s2 = s * s;
    double conformal = phi - s * Math.cos(phi) * (FA + s2 * (FB + s2 * (FC + s2 * FD)));
    double xi = Math.atan2(Math.tan(conformal), Math.cos(dl));
    double eta = atanh(Math.cos(conformal) * Math.sin(dl));
    double x = xi
        + B1 * Math.sin(2 * xi) * Math.cosh(2 * eta)
        + B2 * Math.sin(4 * xi) * Math.cosh(4 * eta)
        + B3 * Math.sin(6 * xi) * Math.cosh(6 * eta)
        + B4 * Math.sin(8 * xi) * Math.cosh(8 * eta);
    double y = eta
        + B1 * Math.cos(2 * xi) * Math.sinh(2 * eta)
        + B2 * Math.cos(4 * xi) * Math.sinh(4 * eta)
        + B3 * Math.cos(6 * xi) * Math.sinh(6 * eta)
        + B4 * Math.cos(8 * xi) * Math.sinh(8 * eta);
    out[0] = K0 * A_HAT * y + FALSE_EASTING;
    out[1] = K0 * A_HAT * x;
  }

  /** Writes {@code {longitude, latitude}} in degrees for an easting and northing (metres) into {@code out}. */
  public static void inverse(double easting, double northing, double[] out) {
    double xi = northing / (K0 * A_HAT);
    double eta = (easting - FALSE_EASTING) / (K0 * A_HAT);
    double xp = xi
        - D1 * Math.sin(2 * xi) * Math.cosh(2 * eta)
        - D2 * Math.sin(4 * xi) * Math.cosh(4 * eta)
        - D3 * Math.sin(6 * xi) * Math.cosh(6 * eta)
        - D4 * Math.sin(8 * xi) * Math.cosh(8 * eta);
    double ep = eta
        - D1 * Math.cos(2 * xi) * Math.sinh(2 * eta)
        - D2 * Math.cos(4 * xi) * Math.sinh(4 * eta)
        - D3 * Math.cos(6 * xi) * Math.sinh(6 * eta)
        - D4 * Math.cos(8 * xi) * Math.sinh(8 * eta);
    double conformal = Math.asin(Math.sin(xp) / Math.cosh(ep));
    double dl = Math.atan2(Math.sinh(ep), Math.cos(xp));
    double s = Math.sin(conformal);
    double s2 = s * s;
    double phi = conformal + s * Math.cos(conformal) * (IA + s2 * (IB + s2 * (IC + s2 * ID)));
    out[0] = Math.toDegrees(LON0 + dl);
    out[1] = Math.toDegrees(phi);
  }

  private static double atanh(double x) {
    return 0.5 * Math.log((1 + x) / (1 - x));
  }
}
