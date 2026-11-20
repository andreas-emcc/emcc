package dev.emcc.ecore.store;

import dev.emcc.sdk.model.Position;
import java.util.List;

/**
 * Orientation of a polygon ring (model rules 1 and 10). Longitudes are unwrapped along each edge's
 * shorter way round, so a ring that crosses the antimeridian (from 179° to −179°) is a small ring,
 * not one around the whole Earth. The sign of the area is then computed in the plane of unwrapped
 * longitude and latitude, as rule 1 allows: an approximation of the orientation along the geodesic
 * edges. It is right for the rings a map draws; for a ring spanning tens of degrees near a pole, the
 * planar edges can differ enough from the geodesic ones to give the wrong answer.
 */
final class RingOrientation {

  /** How a ring runs. */
  enum Kind {
    /** Counter-clockwise: the inside lies to the left. Right for an exterior ring. */
    COUNTER_CLOCKWISE,
    /** Clockwise. Right for a hole. */
    CLOCKWISE,
    /** No area: all positions on one line. */
    DEGENERATE,
    /** The unwrapped ring does not close: it goes once around a pole, which v0 cannot express. */
    AROUND_A_POLE
  }

  private RingOrientation() {}

  /** The orientation of a closed ring (first position equals the last). */
  static Kind of(List<Position> ring) {
    double[] x = new double[ring.size()];
    x[0] = ring.getFirst().longitude();
    for (int i = 1; i < ring.size(); i++) {
      x[i] = x[i - 1] + shorterWay(ring.get(i).longitude() - ring.get(i - 1).longitude());
    }
    if (Math.abs(x[x.length - 1] - x[0]) > 180) {
      return Kind.AROUND_A_POLE; // net 360° of longitude: the ring winds around a pole
    }
    double twiceArea = 0;
    for (int i = 0; i < ring.size() - 1; i++) {
      twiceArea += x[i] * ring.get(i + 1).latitude() - x[i + 1] * ring.get(i).latitude();
    }
    if (twiceArea > 0) {
      return Kind.COUNTER_CLOCKWISE;
    }
    return twiceArea < 0 ? Kind.CLOCKWISE : Kind.DEGENERATE;
  }

  /** A longitude difference taken the shorter way round, in (−180, 180]. */
  private static double shorterWay(double delta) {
    double d = delta % 360;
    if (d > 180) {
      d -= 360;
    } else if (d <= -180) {
      d += 360;
    }
    return d;
  }
}
