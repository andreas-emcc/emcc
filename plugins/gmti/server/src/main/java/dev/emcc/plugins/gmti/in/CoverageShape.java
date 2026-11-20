package dev.emcc.plugins.gmti.in;

import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Position;
import java.util.ArrayList;
import java.util.List;
import org.jspecify.annotations.Nullable;

/**
 * A sensor's coverage as emc2's shape (brief section 3, "The coverage"; T-158): the job definition's
 * bounding area {@code J6}–{@code J13} (AEDP-4607 3.7) as a {@code Polygon} of its four corners in
 * the order sent, A to D, closed with A. The store orients the ring (model rule 1).
 */
public final class CoverageShape {

  /** Corners closer than this to each other, or to the line through the others, enclose no area: about 1 cm. */
  private static final double TOLERANCE_DEGREES = 1e-7;

  private CoverageShape() {}

  /**
   * The polygon, or {@code null} when the corners enclose no area: all equal, or on one line (the
   * coverage is not drawn). Longitudes are taken along the shortest way from corner A, so an area
   * across the antimeridian is judged as the small one it is.
   *
   * @param corners A to D, longitude first, as {@code JobDefinition.boundingArea()} holds them
   */
  public static Geometry.@Nullable Polygon of(List<Position> corners) {
    if (corners.size() != 4) {
      throw new IllegalArgumentException("a bounding area has four corners: " + corners.size());
    }
    if (flat(corners)) {
      return null;
    }
    var ring = new ArrayList<Position>(5);
    for (Position c : corners) {
      ring.add(Position.of(c.longitude(), c.latitude()));
    }
    ring.add(ring.getFirst());
    return new Geometry.Polygon(List.of(ring));
  }

  /** Whether every corner lies on the line through the two farthest apart (or all are one point). */
  private static boolean flat(List<Position> corners) {
    double lon0 = corners.getFirst().longitude();
    double[] x = new double[4];
    double[] y = new double[4];
    for (int i = 0; i < 4; i++) {
      x[i] = unwrapped(corners.get(i).longitude() - lon0);
      y[i] = corners.get(i).latitude();
    }
    int a = 0;
    int b = 0;
    double far = -1;
    for (int i = 0; i < 4; i++) {
      for (int j = i + 1; j < 4; j++) {
        double d = Math.hypot(x[j] - x[i], y[j] - y[i]);
        if (d > far) {
          far = d;
          a = i;
          b = j;
        }
      }
    }
    if (far <= TOLERANCE_DEGREES) {
      return true;
    }
    for (int k = 0; k < 4; k++) {
      double cross = (x[b] - x[a]) * (y[k] - y[a]) - (y[b] - y[a]) * (x[k] - x[a]);
      if (Math.abs(cross) / far > TOLERANCE_DEGREES) {
        return false;
      }
    }
    return true;
  }

  /** A longitude difference in -180 to 180. */
  private static double unwrapped(double delta) {
    return ((delta + 180.0) % 360.0 + 360.0) % 360.0 - 180.0;
  }
}
