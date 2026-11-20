package dev.emcc.plugins.gmti.out;

import dev.emcc.plugins.gmti.format.Angles;
import dev.emcc.sdk.geo.GeodesicLeg;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Position;
import java.util.ArrayList;
import java.util.List;

/**
 * A dwell's area as the format's {@code D24}–{@code D27} (reference 4.2; brief section 3, "The
 * area"):
 * <ul>
 *   <li>an {@code ArcBand}: exactly, by its own shape, wherever its centre lies (T-193): {@code
 *       D24}/{@code D25} its middle, at the middle bearing and radius from its centre, {@code D26}
 *       half its depth and {@code D27} half its angle, the beam's half width (AEDP 3.4.27). The
 *       simulator's band is centred where the platform was when the revisit began, and the dwell
 *       goes with where it is now ({@code D7}/{@code D8}, AEDP 3.4.7); measured from there, a band a
 *       few metres off grew to a half disc or a circle;
 *   <li>a {@code Circle} centred on the sensor as 4607 allows (CR-0035, owner KM): the point halfway
 *       out at bearing 0°, half the radius, 180°. That is the whole disc, which a receiver reads back
 *       as the circle round the sensor, inner radius 0;
 *   <li>any other shape, or a circle centred elsewhere, seen from the sensor: its centre (a
 *       polygon's, the mean of its corners), half its extent along the line from the sensor, half
 *       the angle it spans at the sensor.
 * </ul>
 * {@code D26} is a {@code B16} of kilometres, at most 255.99 km either side of the centre, so an area
 * reaches at most {@link Sender#MAX_AREA_DEPTH_METRES} beyond its near edge (G12; CR-0035). A deeper
 * area keeps its near edge and is cut there (owner, JS and Q5, 2026-11-07): an {@code ArcBand}, a
 * {@code Circle} round the sensor (near edge 0) or another shape gets {@code D26} 255.99 km and its
 * centre 255.99 km past its near edge. The caller counts the cut and leaves out the detections
 * farther from {@link Fields#origin()} than {@link Fields#reach()}, the near edge plus that depth.
 */
final class DwellArea {

  /** The largest {@code D26}, in kilometres: 255.99 km, a little over half {@link Sender#MAX_AREA_DEPTH_METRES}. */
  static final double MAX_HALF_EXTENT_KM = 256.0 - 1.0 / 128.0;

  private static final double MAX_HALF_EXTENT_METRES = MAX_HALF_EXTENT_KM * 1_000.0;

  /** A centre this close counts as the sensor. */
  private static final double ON_SENSOR_METRES = 1.0;

  /**
   * @param latitude {@code D24}
   * @param longitude {@code D25}
   * @param rangeHalfExtent {@code D26}, kilometres, at most {@link #MAX_HALF_EXTENT_KM}
   * @param angleHalfExtent {@code D27}, degrees, at most 180
   * @param cut whether {@code D26} was cut to the format's limit
   * @param reach when cut, the farthest a detection may be from {@code origin}, in metres; infinite when not cut
   * @param origin where the area's ranges are measured from: an {@code ArcBand}'s centre, else the sensor
   */
  record Fields(double latitude, double longitude, double rangeHalfExtent, double angleHalfExtent, boolean cut, double reach, Position origin) {}

  private DwellArea() {}

  static Fields of(Geometry area, Position sensor) {
    if (area instanceof Geometry.ArcBand a) {
      double extent = clockwise(a.startBearing(), a.endBearing());
      return band(a.center(), Angles.normalise360(a.startBearing() + extent / 2), a.innerRadius(), a.outerRadius(), extent / 2);
    }
    if (area instanceof Geometry.Circle c && Geodesy.inverse(sensor, c.center()).distanceMetres() < ON_SENSOR_METRES) {
      return band(sensor, 0.0, 0.0, c.radius(), 180.0); // near edge 0, centre halfway out at 0° (CR-0035)
    }
    Position centre = centre(area);
    GeodesicLeg toCentre = Geodesy.inverse(sensor, centre);
    double nearest = Double.MAX_VALUE;
    double farthest = 0;
    double widest = 0;
    for (Position p : boundary(area)) {
      GeodesicLeg leg = Geodesy.inverse(sensor, p);
      nearest = Math.min(nearest, leg.distanceMetres());
      farthest = Math.max(farthest, leg.distanceMetres());
      double off = Angles.normalise360(leg.initialAzimuth() - toCentre.initialAzimuth());
      widest = Math.max(widest, off > 180 ? 360 - off : off);
    }
    double halfAngle = Math.min(180.0, widest);
    if (farthest - nearest > Sender.MAX_AREA_DEPTH_METRES) {
      return band(sensor, toCentre.initialAzimuth(), nearest, farthest, halfAngle);
    }
    return new Fields(centre.latitude(), centre.longitude(), (farthest - nearest) / 2_000.0, halfAngle, false, Double.POSITIVE_INFINITY, sensor);
  }

  /** The four corners of the box round the area, clockwise from north-west (the job's bounding area, assumption B2). */
  static List<Position> box(Geometry area) {
    double minLon = 180;
    double maxLon = -180;
    double minLat = 90;
    double maxLat = -90;
    for (Position p : boundary(area)) {
      minLon = Math.min(minLon, p.longitude());
      maxLon = Math.max(maxLon, p.longitude());
      minLat = Math.min(minLat, p.latitude());
      maxLat = Math.max(maxLat, p.latitude());
    }
    return List.of(Position.of(minLon, maxLat), Position.of(maxLon, maxLat), Position.of(maxLon, minLat), Position.of(minLon, minLat));
  }

  /**
   * The band from {@code near} to {@code far} metres from {@code origin} (the sensor, or an {@code
   * ArcBand}'s centre), centred at {@code bearing}: its centre half-way, or, when deeper than {@link
   * Sender#MAX_AREA_DEPTH_METRES}, {@code D26} 255.99 km and the centre that far past the near edge
   * (owner, Q5; CR-0035). The cut's reach is the near edge plus the declared depth, so the channel
   * leaves out exactly what a sender warns about; {@code D26}'s own 255.99 km is a few metres more, so
   * the area holds every detection sent.
   */
  private static Fields band(Position origin, double bearing, double near, double far, double halfAngle) {
    boolean cut = far - near > Sender.MAX_AREA_DEPTH_METRES;
    double half = cut ? MAX_HALF_EXTENT_METRES : (far - near) / 2;
    Position centre = Geodesy.direct(origin, bearing, near + half);
    return new Fields(centre.latitude(), centre.longitude(), half / 1_000.0, halfAngle, cut,
        cut ? near + Sender.MAX_AREA_DEPTH_METRES : Double.POSITIVE_INFINITY, origin);
  }

  /** The degrees from {@code start} clockwise to {@code end}; 360 when they are equal (a full band). */
  static double clockwise(double start, double end) {
    double d = Angles.normalise360(end - start);
    return d == 0 ? 360.0 : d;
  }

  private static Position centre(Geometry area) {
    return switch (area) {
      case Geometry.Circle c -> c.center();
      case Geometry.Ellipse e -> e.center();
      case Geometry.ArcBand a -> {
        double extent = clockwise(a.startBearing(), a.endBearing());
        yield Geodesy.direct(a.center(), Angles.normalise360(a.startBearing() + extent / 2), (a.innerRadius() + a.outerRadius()) / 2);
      }
      default -> {
        List<Position> ring = boundary(area);
        double lon = 0;
        double lat = 0;
        for (Position p : ring) {
          lon += p.longitude();
          lat += p.latitude();
        }
        yield Position.of(lon / ring.size(), lat / ring.size());
      }
    };
  }

  /** Points round the area's edge (every 5° for curves). A dwell's area is a Polygon, Circle, Ellipse or ArcBand. */
  static List<Position> boundary(Geometry area) {
    var points = new ArrayList<Position>();
    switch (area) {
      case Geometry.Circle c -> {
        for (int b = 0; b < 360; b += 5) {
          points.add(Geodesy.direct(c.center(), b, c.radius()));
        }
      }
      case Geometry.Ellipse e -> {
        for (int t = 0; t < 360; t += 5) {
          double along = e.semiMajorAxis() * Math.cos(Math.toRadians(t));
          double across = e.semiMinorAxis() * Math.sin(Math.toRadians(t));
          double bearing = e.rotation() + Math.toDegrees(Math.atan2(across, along));
          points.add(Geodesy.direct(e.center(), Angles.normalise360(bearing), Math.hypot(along, across)));
        }
      }
      case Geometry.ArcBand a -> {
        double extent = clockwise(a.startBearing(), a.endBearing());
        int steps = Math.max(1, (int) Math.ceil(extent / 5));
        for (int i = 0; i <= steps; i++) {
          points.add(Geodesy.direct(a.center(), Angles.normalise360(a.startBearing() + extent * i / steps), a.outerRadius()));
        }
        if (a.innerRadius() <= 0) {
          points.add(a.center());
        } else {
          for (int i = steps; i >= 0; i--) {
            points.add(Geodesy.direct(a.center(), Angles.normalise360(a.startBearing() + extent * i / steps), a.innerRadius()));
          }
        }
      }
      case Geometry.Polygon p -> points.addAll(p.rings().getFirst());
      default -> throw new IllegalArgumentException("a dwell's area is a Polygon, Circle, Ellipse or ArcBand: " + area.typeName());
    }
    return points;
  }
}
