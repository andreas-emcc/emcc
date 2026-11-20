package dev.emcc.plugins.nvg.mapping;

import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Position;
import java.util.ArrayList;
import java.util.List;

/**
 * The geodesic outlines of the NVG shapes the model has no geometry for (brief, section 3): {@code
 * rect}, {@code arc}, {@code orbit}, rhumb lines and the holes of other ring kinds, on WGS84 through
 * the SDK's {@link Geodesy}. NVG's angles: {@code rotation} counter-clockwise, other angles clockwise
 * from north; lengths in metres.
 */
final class Geo {

  /** The largest angle between two points of a densified arc or ring (brief: arcs at most 1° apart). */
  static final double STEP_DEGREES = 1;

  /** The longest leg of a densified rhumb line, in metres. */
  static final double RHUMB_STEP_METRES = 10_000;

  private Geo() {}

  /**
   * A point of an ellipse with semi-axes {@code rx} (east-west) and {@code ry} (north-south) before
   * the rotation, in the direction {@code angle} (clockwise from north, before the rotation), rotated
   * counter-clockwise by {@code rotation} <b>[spec check: polar angle along the ellipse]</b>.
   */
  static Position onEllipse(Position center, double rx, double ry, double rotation, double angle) {
    double t = Math.toRadians(angle);
    double r = 1 / Math.sqrt(Math.pow(Math.sin(t) / rx, 2) + Math.pow(Math.cos(t) / ry, 2));
    return Geodesy.direct(center, Values.bearing(angle - rotation), r);
  }

  /** An {@code arc}: the ellipse's outline from {@code start} clockwise to {@code end}, points at most {@link #STEP_DEGREES} apart. */
  static List<Position> arc(Position center, double rx, double ry, double rotation, double start, double end) {
    double sweep = sweep(start, end, false);
    int n = Math.max(1, (int) Math.ceil(sweep / STEP_DEGREES));
    List<Position> out = new ArrayList<>(n + 1);
    for (int i = 0; i <= n; i++) {
      out.add(onEllipse(center, rx, ry, rotation, start + sweep * i / n));
    }
    return out;
  }

  /** A closed ring around an ellipse (a circle when {@code rx == ry}). */
  static List<Position> ellipseRing(Position center, double rx, double ry, double rotation) {
    List<Position> ring = arc(center, rx, ry, rotation, 0, 360);
    ring.set(ring.size() - 1, ring.getFirst());
    return ring;
  }

  /**
   * A {@code rect}'s closed ring, "true ground" (brief, ADR-0019 style): from the centre {@code rx}
   * along the rotated east-west axis to each side's middle, then {@code ry} perpendicular to the axis
   * there, so opposite sides have the same ground length.
   */
  static List<Position> rectRing(Position center, double rx, double ry, double rotation) {
    double east = Values.bearing(90 - rotation);
    Position midEast = Geodesy.direct(center, east, rx);
    Position midWest = Geodesy.direct(center, Values.bearing(east + 180), rx);
    double atEast = Geodesy.inverse(center, midEast).finalAzimuth();
    double atWest = Geodesy.inverse(center, midWest).finalAzimuth();
    Position ne = Geodesy.direct(midEast, Values.bearing(atEast - 90), ry);
    Position se = Geodesy.direct(midEast, Values.bearing(atEast + 90), ry);
    Position nw = Geodesy.direct(midWest, Values.bearing(atWest + 90), ry);
    Position sw = Geodesy.direct(midWest, Values.bearing(atWest - 90), ry);
    return new ArrayList<>(List.of(ne, nw, sw, se, ne));
  }

  /**
   * An {@code orbit}: a racetrack around the leg between its two points, {@code width} wide in all,
   * with half circles round each point <b>[spec check: width in all, ends centred on the points]</b>.
   */
  static List<Position> orbitRing(Position from, Position to, double width) {
    double half = width / 2;
    var leg = Geodesy.inverse(from, to);
    double out = leg.finalAzimuth();
    double back = Values.bearing(leg.initialAzimuth() + 180);
    List<Position> ring = new ArrayList<>();
    // Half circle round "to", from its left side clockwise through the far end to its right side.
    halfCircle(ring, to, half, out - 90);
    // Half circle round "from", from its right side (seen going out) clockwise through the near end.
    halfCircle(ring, from, half, back - 90);
    ring.add(ring.getFirst());
    return ring;
  }

  private static void halfCircle(List<Position> ring, Position center, double radius, double startBearing) {
    int n = (int) Math.ceil(180 / STEP_DEGREES);
    for (int i = 0; i <= n; i++) {
      ring.add(Geodesy.direct(center, Values.bearing(startBearing + 180.0 * i / n), radius));
    }
  }

  /** An {@code arcband}'s closed ring: the outer arc clockwise, the inner one back (the centre for a sector). */
  static List<Position> arcbandRing(Position center, double minr, double maxr, double start, double end) {
    double sweep = sweep(start, end, true);
    int n = Math.max(1, (int) Math.ceil(sweep / STEP_DEGREES));
    List<Position> ring = new ArrayList<>();
    for (int i = 0; i <= n; i++) {
      ring.add(Geodesy.direct(center, Values.bearing(start + sweep * i / n), maxr));
    }
    if (minr > 0) {
      for (int i = n; i >= 0; i--) {
        ring.add(Geodesy.direct(center, Values.bearing(start + sweep * i / n), minr));
      }
    } else {
      ring.add(center);
    }
    ring.add(ring.getFirst());
    return ring;
  }

  /** Clockwise degrees from {@code start} to {@code end}; equal angles are a full turn when {@code fullWhenEqual}. */
  static double sweep(double start, double end, boolean fullWhenEqual) {
    double s = Values.bearing(end - start);
    return s == 0 && fullWhenEqual ? 360 : (s == 0 ? 360 : s);
  }

  /** A line whose legs are rhumb lines, densified so that its geodesic legs follow them (ADR-0019). */
  static List<Position> rhumb(List<Position> points) {
    List<Position> out = new ArrayList<>();
    out.add(points.getFirst());
    for (int i = 1; i < points.size(); i++) {
      Position a = points.get(i - 1);
      Position b = points.get(i);
      double dLon = b.longitude() - a.longitude();
      if (dLon > 180) {
        dLon -= 360;
      } else if (dLon < -180) {
        dLon += 360;
      }
      double psiA = mercator(a.latitude());
      double psiB = mercator(b.latitude());
      double length = Geodesy.inverse(a, b).distanceMetres();
      int n = Math.max(1, (int) Math.ceil(length / RHUMB_STEP_METRES));
      for (int k = 1; k <= n; k++) {
        double f = (double) k / n;
        double lon = a.longitude() + dLon * f;
        if (lon > 180) {
          lon -= 360;
        } else if (lon < -180) {
          lon += 360;
        }
        double lat = k == n ? b.latitude() : Math.toDegrees(2 * Math.atan(Math.exp(psiA + (psiB - psiA) * f)) - Math.PI / 2);
        out.add(k == n ? b : Position.of(lon, lat));
      }
    }
    return out;
  }

  private static double mercator(double latitude) {
    double clamped = Math.max(-89.999, Math.min(89.999, latitude));
    return Math.log(Math.tan(Math.PI / 4 + Math.toRadians(clamped) / 2));
  }

  /** The ring closed: its last point equal to its first. */
  static List<Position> closed(List<Position> points) {
    List<Position> ring = new ArrayList<>(points);
    if (!ring.getFirst().equals(ring.getLast())) {
      ring.add(ring.getFirst());
    }
    return ring;
  }

  /** The ring without its closing point, as NVG lists a polygon's points <b>[spec check]</b>. */
  static List<Position> open(List<Position> ring) {
    if (ring.size() > 1 && ring.getFirst().equals(ring.getLast())) {
      return ring.subList(0, ring.size() - 1);
    }
    return ring;
  }
}
