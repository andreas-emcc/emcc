package dev.emcc.plugins.fmv.out.render;

import dev.emcc.plugins.fmv.out.Pose;

/**
 * A pose's camera in the local east, north, up frame at the camera: its forward, right and up
 * axes, and the half-angles' tangents of its field of view.
 *
 * <p>The axes follow ST 0601's angles: the platform's heading, pitch and roll (a yaw, pitch, roll
 * sequence about its own axes, north, east, down), then the sensor's relative azimuth, elevation
 * ({@code −depression}, section 10.1 point 2) and roll about the platform's axes. So a level
 * platform with heading 45° and a camera at azimuth 90° and depression 30° looks towards 135°, 30°
 * below the horizontal.
 */
public final class Camera {

  /** Forward, right and up, each {@code {east, north, up}}, unit length. */
  final double[] forward = new double[3];
  final double[] right = new double[3];
  final double[] up = new double[3];
  final double tanHalfH;
  final double tanHalfV;

  public Camera(Pose pose) {
    Pose.Platform p = pose.platform();
    Pose.Pointing s = pose.pointing();
    double[][] r = multiply(
        multiply(rz(p.heading()), multiply(ry(p.pitch()), rx(p.roll()))),
        multiply(rz(s.azimuth()), multiply(ry(-s.depression()), rx(s.roll()))));
    // the columns are the sensor's x (forward), y (right) and z (down) in north, east, down
    for (int k = 0; k < 3; k++) {
      double n = r[0][k];
      double e = r[1][k];
      double d = r[2][k];
      double[] axis = k == 0 ? forward : k == 1 ? right : up;
      axis[0] = e;
      axis[1] = n;
      axis[2] = -d;
    }
    // the picture's up is the sensor's −z
    up[0] = -up[0];
    up[1] = -up[1];
    up[2] = -up[2];
    tanHalfH = Math.tan(Math.toRadians(pose.horizontalFov()) / 2);
    tanHalfV = Math.tan(Math.toRadians(pose.verticalFov()) / 2);
  }

  /**
   * Writes the ray through a point of the picture into {@code out}, {@code {east, north, up}}, not
   * normalised: {@code sx} from −1 (left edge) to 1 (right edge), {@code sy} from −1 (bottom) to 1 (top).
   */
  public void ray(double sx, double sy, double[] out) {
    double a = sx * tanHalfH;
    double b = sy * tanHalfV;
    out[0] = forward[0] + a * right[0] + b * up[0];
    out[1] = forward[1] + a * right[1] + b * up[1];
    out[2] = forward[2] + a * right[2] + b * up[2];
  }

  /** The forward axis's bearing, degrees clockwise from north, 0 to below 360. */
  public double bearing() {
    double b = Math.toDegrees(Math.atan2(forward[0], forward[1]));
    return b < 0 ? b + 360 : b;
  }

  /** The forward axis's angle below the horizontal, degrees. */
  public double depression() {
    return Math.toDegrees(Math.asin(-forward[2]));
  }

  private static double[][] rz(double deg) {
    double c = Math.cos(Math.toRadians(deg));
    double s = Math.sin(Math.toRadians(deg));
    return new double[][] {{c, -s, 0}, {s, c, 0}, {0, 0, 1}};
  }

  private static double[][] ry(double deg) {
    double c = Math.cos(Math.toRadians(deg));
    double s = Math.sin(Math.toRadians(deg));
    return new double[][] {{c, 0, s}, {0, 1, 0}, {-s, 0, c}};
  }

  private static double[][] rx(double deg) {
    double c = Math.cos(Math.toRadians(deg));
    double s = Math.sin(Math.toRadians(deg));
    return new double[][] {{1, 0, 0}, {0, c, -s}, {0, s, c}};
  }

  private static double[][] multiply(double[][] a, double[][] b) {
    double[][] m = new double[3][3];
    for (int i = 0; i < 3; i++) {
      for (int j = 0; j < 3; j++) {
        m[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
      }
    }
    return m;
  }
}
