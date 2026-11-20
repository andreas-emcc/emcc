package dev.emcc.plugins.uavsimulation.pose;

/** Angle helpers, in degrees. */
final class Angles {

  private Angles() {}

  /** Below this, degrees, an azimuth just short of 360 is rounding noise and taken as 0. */
  static final double NOISE = 1e-9;

  /** {@code degrees} as 0 to below 360, with no −0, and rounding noise just below 360 taken as 0. */
  static double azimuth(double degrees) {
    double a = degrees % 360;
    if (a < 0) {
      a += 360;
    }
    return a >= 360 - NOISE ? 0 : a + 0.0; // + 0.0 turns -0.0 into 0.0
  }

  /** An absolute azimuth as one relative to {@code heading}, clockwise, 0 to below 360. */
  static double relative(double absolute, double heading) {
    return azimuth(absolute - heading);
  }
}
