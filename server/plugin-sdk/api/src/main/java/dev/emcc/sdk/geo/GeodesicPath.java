package dev.emcc.sdk.geo;

import dev.emcc.sdk.model.Position;
import java.util.List;

/**
 * SDK 1.2.0: a path of geodesic legs through its points ({@link Geodesy#path}), e.g. a simulated
 * route. Immutable and safe to share between workers.
 */
public final class GeodesicPath {

  /** What the library computes for a leg: the point {@code metres} along leg {@code leg}. */
  interface Legs {
    PathPoint at(int leg, double metres);
  }

  private final List<Position> points;
  private final List<Double> legLengths;
  private final double length;
  private final Legs legs;

  GeodesicPath(List<Position> points, List<Double> legLengths, Legs legs) {
    this.points = points;
    this.legLengths = legLengths;
    this.legs = legs;
    double sum = 0;
    for (double l : legLengths) {
      sum += l;
    }
    this.length = sum;
  }

  /** The points, first to last. */
  public List<Position> points() {
    return points;
  }

  /** The length of each leg in metres, one fewer than the points. */
  public List<Double> legLengths() {
    return legLengths;
  }

  /** The whole length in metres. */
  public double lengthMetres() {
    return length;
  }

  /**
   * The point {@code metresAlongPath} from the start, with the direction of travel there. A
   * distance below 0 gives the start, one beyond the length gives the end. Points are computed along
   * the geodesic, so the end is its last point to within about 1e-14 degrees, not that point itself.
   *
   * @throws IllegalArgumentException if the distance is not finite
   */
  public PathPoint at(double metresAlongPath) {
    if (!Double.isFinite(metresAlongPath)) {
      throw new IllegalArgumentException("the distance must be finite: " + metresAlongPath);
    }
    double left = Math.max(0, metresAlongPath);
    int last = legLengths.size() - 1;
    for (int leg = 0; leg <= last; leg++) {
      double l = legLengths.get(leg);
      if (left <= l || leg == last) {
        double along = Math.min(left, l);
        PathPoint p = legs.at(leg, along);
        return new PathPoint(p.position(), p.azimuth(), leg, l == 0 ? 1 : along / l);
      }
      left -= l;
    }
    throw new AssertionError("unreachable");
  }
}
