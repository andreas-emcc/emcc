package dev.emcc.ecore.geo;

import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Position;
import java.util.List;
import java.util.Objects;

/**
 * An area of interest (spike S3; the SDK's {@code Area}): a closed lon/lat ring with geodesic
 * edges (model rule 10), whose inside is the side that holds {@code inside}, grown by a margin. An
 * object matches when the bound of its geometry ({@link Cap}) reaches into it. Exact on the sphere:
 * the inside test counts crossings of the arc from {@code inside}, so it holds around the poles and
 * across the antimeridian; the margin is a distance to the ring.
 *
 * <p>The two traps the spike found are handled: a ring vertex exactly on the arc counts as on its
 * positive side for both of its edges (half-open rule), and whether the area holds the antipode of
 * {@code inside}, where the arc has no direction, is decided by three points beside it.
 *
 * <p>Immutable and thread-safe; a test allocates nothing.
 */
public final class GeoArea {

  private final int n; // edges
  private final double[] ax;
  private final double[] ay;
  private final double[] az; // vertices, n + 1 (closed)
  private final double[] nx;
  private final double[] ny;
  private final double[] nz; // unit edge normals a × b
  private final double[] tax;
  private final double[] tay;
  private final double[] taz;
  private final double[] tbx;
  private final double[] tby;
  private final double[] tbz; // u × a and b × u: the arc's end planes
  private final int[] insideSide; // orient(a, b, inside) per edge
  private final double cx;
  private final double cy;
  private final double cz;
  private final double marginAngle;
  private final double ringRadius;
  private final Cap bound;

  /**
   * @param ring at least four positions, the first equal to the last
   * @param inside a position inside the ring
   * @param marginMetres a margin in metres, or 0
   * @param marginShare a margin as a share of the greatest distance from {@code inside} to the
   *     ring, or 0 (the SDK's {@code Margin.Share}); added to {@code marginMetres}
   */
  public GeoArea(List<Position> ring, Position inside, double marginMetres, double marginShare) {
    Objects.requireNonNull(inside, "inside");
    if (ring.size() < 4 || !ring.getFirst().equals(ring.getLast())) {
      throw new IllegalArgumentException("a ring has at least four positions, the first equal to the last");
    }
    if (!(marginMetres >= 0) || !(marginShare >= 0)) {
      throw new IllegalArgumentException("a margin is not negative");
    }
    n = ring.size() - 1;
    for (int i = 0; i < n; i++) {
      double[] a = Sphere.vec(ring.get(i).longitude(), ring.get(i).latitude());
      double[] b = Sphere.vec(ring.get(i + 1).longitude(), ring.get(i + 1).latitude());
      if (Sphere.angle(a, b) > Math.PI - 1e-9) {
        throw new IllegalArgumentException("ring positions " + i + " and " + (i + 1)
            + " lie opposite each other on the earth: the edge between them has no direction");
      }
    }
    ax = new double[n + 1];
    ay = new double[n + 1];
    az = new double[n + 1];
    for (int i = 0; i <= n; i++) {
      double[] v = Sphere.vec(ring.get(i).longitude(), ring.get(i).latitude());
      ax[i] = v[0];
      ay[i] = v[1];
      az[i] = v[2];
    }
    double[] c = Sphere.vec(inside.longitude(), inside.latitude());
    cx = c[0];
    cy = c[1];
    cz = c[2];
    nx = new double[n];
    ny = new double[n];
    nz = new double[n];
    tax = new double[n];
    tay = new double[n];
    taz = new double[n];
    tbx = new double[n];
    tby = new double[n];
    tbz = new double[n];
    insideSide = new int[n];
    for (int i = 0; i < n; i++) {
      double[] a = {ax[i], ay[i], az[i]};
      double[] b = {ax[i + 1], ay[i + 1], az[i + 1]};
      double[] u = Sphere.cross(a, b);
      double len = Sphere.norm(u);
      if (len > 0) {
        u = new double[] {u[0] / len, u[1] / len, u[2] / len};
      }
      nx[i] = u[0];
      ny[i] = u[1];
      nz[i] = u[2];
      double[] ta = Sphere.cross(u, a);
      double[] tb = Sphere.cross(b, u);
      tax[i] = ta[0];
      tay[i] = ta[1];
      taz[i] = ta[2];
      tbx[i] = tb[0];
      tby[i] = tb[1];
      tbz[i] = tb[2];
      insideSide[i] = Sphere.orient(a, b, c);
    }
    ringRadius = ringRadius();
    marginAngle = marginMetres * Sphere.PAD / Sphere.R + marginShare * ringRadius;
    bound = computeBound(ringRadius);
  }

  /** True if an object with this geometry reaches into the area with its margin. */
  public boolean matches(Geometry geometry) {
    return matches(Cap.of(geometry));
  }

  /** True if a geometry bounded by {@code cap} reaches into the area with its margin. */
  public boolean matches(Cap cap) {
    if (cap.radius() >= Math.PI) {
      return true;
    }
    if (!bound.intersects(cap)) {
      return false;
    }
    return contains(cap.x(), cap.y(), cap.z()) || nearBoundary(cap.x(), cap.y(), cap.z(), cap.radius() + marginAngle);
  }

  /** {@link #relation}: the area does not reach into the cap. */
  static final int OUTSIDE = 0;
  /** {@link #relation}: the area reaches into the cap ({@link #matches}), but may not hold all of it. */
  static final int PARTLY = 1;
  /**
   * {@link #relation}: every point of the cap lies in the area with its margin, so every geometry
   * whose bound meets the cap {@link #matches} the area (the spatial index takes such a cell's
   * objects without testing each). By the margin rule: the bound's centre is at most its radius
   * plus the cap's from the cap's centre, which is at most the margin less the cap's radius from
   * the ring, so the bound comes within the margin of the ring. By the inside rule: the bound has a
   * point inside the ring, so its centre is inside or an edge lies within its radius.
   */
  static final int WHOLLY = 2;

  /**
   * How the area with its margin lies to {@code cap}, at most a few passes over the ring per cap,
   * mostly one (the index used to test each object of a cell instead): {@link #OUTSIDE}
   * exactly when {@link #matches} is false. {@link #WHOLLY} when the cap is inside the ring and no
   * edge comes nearer than its radius, or its centre is within the margin less its radius of the
   * ring (at a zoomed-out view the margin, half the area's extent, holds most cells outside the
   * ring). Sound, not complete: {@link #PARTLY} for a cap held only by the two rules together.
   */
  int relation(Cap cap) {
    double r = cap.radius();
    if (r >= Math.PI) {
      return PARTLY;
    }
    if (!bound.intersects(cap)) {
      return OUTSIDE;
    }
    double x = cap.x();
    double y = cap.y();
    double z = cap.z();
    if (marginAngle > r && nearBoundary(x, y, z, marginAngle - r)) {
      return WHOLLY;
    }
    if (contains(x, y, z)) {
      return nearBoundary(x, y, z, r) ? PARTLY : WHOLLY;
    }
    return nearBoundary(x, y, z, r + marginAngle) ? PARTLY : OUTSIDE;
  }

  /** The inside position as a unit vector (the spatial index floods from it). */
  double insideX() {
    return cx;
  }

  double insideY() {
    return cy;
  }

  double insideZ() {
    return cz;
  }

  /** The greatest distance from the inside position to the ring, in metres (without the margin). */
  public double extentMetres() {
    return ringRadius * Sphere.R;
  }

  /** A cap holding the whole area with its margin. */
  public Cap bound() {
    return bound;
  }

  /** The greatest angle from {@code inside} to the ring, from eight samples per edge. */
  private double ringRadius() {
    double[] c = {cx, cy, cz};
    double r = 0;
    for (int i = 0; i < n; i++) {
      for (int k = 0; k < 8; k++) {
        double t = k / 8.0;
        double[] p = Sphere.normalize(new double[] {
          ax[i] + t * (ax[i + 1] - ax[i]), ay[i] + t * (ay[i + 1] - ay[i]), az[i] + t * (az[i + 1] - az[i])});
        r = Math.max(r, Sphere.angle(c, p));
      }
    }
    return r;
  }

  private Cap computeBound(double ringRadius) {
    // Does the area hold the antipode of inside? The arc to the exact antipode has no direction, and
    // one beside it may run through ring vertices: three points a hair beside it in skew directions vote.
    double[] c = {cx, cy, cz};
    int votes = 0;
    for (double[] skew : new double[][] {{0.36, 0.48, 0.8}, {-0.62, 0.21, 0.755}, {0.17, -0.93, 0.33}}) {
      double[] side = Sphere.cross(c, skew);
      if (Sphere.norm(side) < 1e-3) {
        side = Sphere.cross(c, new double[] {skew[2], skew[0], skew[1]});
      }
      side = Sphere.normalize(side);
      double[] anti = Sphere.normalize(new double[] {-cx + 1e-6 * side[0], -cy + 1e-6 * side[1], -cz + 1e-6 * side[2]});
      if (contains(anti[0], anti[1], anti[2])) {
        votes++;
      }
    }
    if (votes >= 2) {
      return Cap.WORLD;
    }
    // A chord sample can sit inside a long edge's bulge: pad by a sixteenth of the longest edge.
    double longest = 0;
    for (int i = 0; i < n; i++) {
      longest = Math.max(longest, Sphere.angle(new double[] {ax[i], ay[i], az[i]}, new double[] {ax[i + 1], ay[i + 1], az[i + 1]}));
    }
    double radius = ringRadius + longest / 16 + marginAngle;
    return radius >= Math.PI ? Cap.WORLD : Cap.of(c, radius);
  }

  /** True if the unit vector p is inside the ring (not counting the margin). */
  boolean contains(double px, double py, double pz) {
    // m = inside × p: the plane of the arc from inside to p.
    double mx = cy * pz - cz * py;
    double my = cz * px - cx * pz;
    double mz = cx * py - cy * px;
    // A vertex exactly on the arc's great circle counts as on its positive side, for both edges
    // that share it (half-open rule): an arc through a vertex then crosses the ring once or not at
    // all, never twice. Not rare: in Web Mercator the top and bottom middle vertices lie exactly on
    // the centre's meridian, so every point due north or south of the centre hits one.
    boolean inside = true;
    int prev = halfOpen(mx * ax[0] + my * ay[0] + mz * az[0]);
    for (int i = 0; i < n; i++) {
      int next = halfOpen(mx * ax[i + 1] + my * ay[i + 1] + mz * az[i + 1]);
      // S2's crossing rule for arcs (a, b) and (inside, p): -orient(a,b,c) == orient(a,b,p) == -orient(c,p,b) == orient(c,p,a).
      int acb = -insideSide[i];
      if (acb != 0 && acb == sign(nx[i] * px + ny[i] * py + nz[i] * pz) && acb == -next && acb == prev) {
        inside = !inside;
      }
      prev = next;
    }
    return inside;
  }

  /** True if some edge of the ring is within {@code angle} radians of the unit vector p. */
  boolean nearBoundary(double px, double py, double pz, double angle) {
    if (angle <= 0) {
      return false;
    }
    double sinA = angle >= Math.PI / 2 ? 1 : Math.sin(angle);
    double chord = angle >= Math.PI ? 2 : 2 * Math.sin(angle / 2);
    double chord2 = chord * chord;
    for (int i = 0; i < n; i++) {
      double s = nx[i] * px + ny[i] * py + nz[i] * pz;
      if (tax[i] * px + tay[i] * py + taz[i] * pz >= 0 && tbx[i] * px + tby[i] * py + tbz[i] * pz >= 0) {
        if (Math.abs(s) <= sinA) {
          return true;
        }
      } else {
        double dx = px - ax[i];
        double dy = py - ay[i];
        double dz = pz - az[i];
        if (dx * dx + dy * dy + dz * dz <= chord2) {
          return true;
        }
        dx = px - ax[i + 1];
        dy = py - ay[i + 1];
        dz = pz - az[i + 1];
        if (dx * dx + dy * dy + dz * dz <= chord2) {
          return true;
        }
      }
    }
    return false;
  }

  private static int halfOpen(double d) {
    return d >= 0 ? 1 : -1;
  }

  private static int sign(double d) {
    return d > 0 ? 1 : d < 0 ? -1 : 0;
  }
}
