package dev.emcc.plugins.uavsimulation.pose;

/** The field of view (brief function 4; ADR-0058 point 1): the horizontal is set, the vertical follows from the frame. */
public final class FieldOfView {

  private FieldOfView() {}

  /** The vertical field of view, degrees: {@code 2 · atan(tan(h / 2) · height / width)}. */
  public static double vertical(double horizontal, Frame frame) {
    if (!(horizontal > 0 && horizontal < 180)) {
      throw new IllegalArgumentException("horizontal field of view must be above 0 and below 180: " + horizontal);
    }
    double half = Math.toRadians(horizontal / 2);
    return Math.toDegrees(2 * Math.atan(Math.tan(half) * frame.height() / frame.width()));
  }
}
