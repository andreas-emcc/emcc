package dev.emcc.plugins.gmti.out;

import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Position;
import java.util.ArrayList;
import java.util.List;
import org.jspecify.annotations.Nullable;

/**
 * The job's bounding area {@code J6}–{@code J13} (brief section 3, "Out"; T-168, CR-0039 point 7):
 * four corners A to D, clockwise, forming a convex quadrilateral (AEDP-4607 3.7.6).
 *
 * <ul>
 *   <li>From the sensor's job area when it has one: a convex four-corner area goes as its corners,
 *       A its ring's first, then the others <b>clockwise</b>, so a counter-clockwise ring (model rule
 *       1, a drawn rectangle) is sent the other way round (owner, 2026-11-10, in PCA-gmti's session).
 *   <li>A job area of more or fewer corners, or not convex, goes as the box round it, clockwise from
 *       north-west, and is marked {@link Corners#boxed()} (owner, 2026-11-10: counted {@code not held:
 *       J6} once per sensor).
 *   <li>Without a job area, the box round the dwell area, as in M5.
 * </ul>
 */
final class JobArea {

  /**
   * The corners to send.
   *
   * @param corners A to D, clockwise, longitude first
   * @param boxed true when the sensor's job area could not go as it is and its box goes instead
   */
  record Corners(List<Position> corners, boolean boxed) {
    Corners {
      corners = List.copyOf(corners);
    }
  }

  private JobArea() {}

  static Corners of(Geometry.@Nullable Polygon jobArea, Geometry dwellArea) {
    if (jobArea == null) {
      return new Corners(DwellArea.box(dwellArea), false);
    }
    List<Position> ring = new ArrayList<>(jobArea.rings().getFirst());
    if (ring.size() > 1 && samePlace(ring.getFirst(), ring.getLast())) {
      ring.removeLast(); // the closing position (model rule 1)
    }
    if (ring.size() == 4) {
      int turn = turn(ring);
      if (turn < 0) {
        return new Corners(flat(ring), false); // clockwise already
      }
      if (turn > 0) {
        return new Corners(List.of(flat(ring.get(0)), flat(ring.get(3)), flat(ring.get(2)), flat(ring.get(1))), false);
      }
    }
    return new Corners(DwellArea.box(jobArea), true);
  }

  /**
   * +1 when the four corners turn left at every corner (a convex ring, counter-clockwise), -1 when
   * they turn right at every corner (convex, clockwise), 0 otherwise (not convex, or corners on one
   * line). Longitudes are taken the short way from corner A, so an area across the antimeridian is
   * judged as the small one it is.
   */
  private static int turn(List<Position> ring) {
    double lon0 = ring.getFirst().longitude();
    double[] x = new double[4];
    double[] y = new double[4];
    for (int i = 0; i < 4; i++) {
      x[i] = unwrapped(ring.get(i).longitude() - lon0);
      y[i] = ring.get(i).latitude();
    }
    int sign = 0;
    for (int i = 0; i < 4; i++) {
      int j = (i + 1) % 4;
      int k = (i + 2) % 4;
      double cross = (x[j] - x[i]) * (y[k] - y[j]) - (y[j] - y[i]) * (x[k] - x[j]);
      int s = cross > 0 ? 1 : cross < 0 ? -1 : 0;
      if (s == 0 || (sign != 0 && s != sign)) {
        return 0;
      }
      sign = s;
    }
    return sign;
  }

  private static boolean samePlace(Position a, Position b) {
    return a.longitude() == b.longitude() && a.latitude() == b.latitude();
  }

  private static List<Position> flat(List<Position> ring) {
    return ring.stream().map(JobArea::flat).toList();
  }

  /** The corner without its height: {@code J6}–{@code J13} hold latitude and longitude only. */
  private static Position flat(Position p) {
    return Position.of(p.longitude(), p.latitude());
  }

  /** A longitude difference in -180 to 180. */
  private static double unwrapped(double delta) {
    return ((delta + 180.0) % 360.0 + 360.0) % 360.0 - 180.0;
  }
}
