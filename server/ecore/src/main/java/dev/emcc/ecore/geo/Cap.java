package dev.emcc.ecore.geo;

import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Position;
import java.util.ArrayList;
import java.util.List;

/**
 * A spherical cap: a centre (unit vector) and an angular radius in radians. The bound of an
 * object's geometry for the area test (spike S3). Unlike a lon/lat box it has no special cases at
 * the poles or the antimeridian. A radius of {@code PI} or more is the whole sphere.
 */
public record Cap(double x, double y, double z, double radius) {

  public static final Cap WORLD = new Cap(0, 0, 1, Math.PI);

  static Cap of(double[] centre, double radius) {
    return new Cap(centre[0], centre[1], centre[2], radius);
  }

  double[] centre() {
    return new double[] {x, y, z};
  }

  boolean intersects(Cap other) {
    if (radius + other.radius >= Math.PI) {
      return true;
    }
    return Sphere.angle(centre(), other.centre()) <= radius + other.radius;
  }

  /**
   * The bound of a geometry: points have radius 0; circles, ellipses and arc bands the outer
   * distance; vertex lists the smallest cap around their vertex centroid that holds every vertex,
   * which holds the geodesic edges too while its radius is below 90° (a cap that small is convex);
   * corridors add half their width. Polygons are taken as the smaller side of their exterior ring
   * (model rule 10: no polygon encloses a pole). Padded by 0.5 % for the ellipsoid.
   */
  public static Cap of(Geometry geometry) {
    return switch (geometry) {
      case Geometry.Point p -> around(p.coordinates(), 0);
      case Geometry.Circle c -> around(c.center(), c.radius());
      case Geometry.Ellipse e -> around(e.center(), e.semiMajorAxis());
      case Geometry.ArcBand a -> around(a.center(), a.outerRadius());
      case Geometry.MultiPoint m -> vertices(m.coordinates(), 0);
      case Geometry.LineString l -> vertices(l.coordinates(), 0);
      case Geometry.Polygon p -> vertices(p.rings().getFirst(), 0);
      case Geometry.Corridor c -> vertices(c.coordinates(), c.width() / 2);
    };
  }

  private static Cap around(Position centre, double metres) {
    return of(Sphere.vec(centre.longitude(), centre.latitude()), metres * Sphere.PAD / Sphere.R);
  }

  private static Cap vertices(List<Position> positions, double extraMetres) {
    List<double[]> vs = new ArrayList<>(positions.size());
    double[] sum = new double[3];
    for (Position p : positions) {
      double[] v = Sphere.vec(p.longitude(), p.latitude());
      vs.add(v);
      sum[0] += v[0];
      sum[1] += v[1];
      sum[2] += v[2];
    }
    if (Sphere.norm(sum) < 1e-9) {
      return WORLD;
    }
    double[] c = Sphere.normalize(sum);
    double r = 0;
    for (double[] v : vs) {
      r = Math.max(r, Sphere.angle(c, v));
    }
    if (r >= Math.PI / 2) {
      return WORLD;
    }
    return of(c, r * Sphere.PAD + extraMetres * Sphere.PAD / Sphere.R);
  }
}
