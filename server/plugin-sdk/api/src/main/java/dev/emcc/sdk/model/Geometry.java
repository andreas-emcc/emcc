package dev.emcc.sdk.model;

import java.util.List;
import java.util.Objects;

/**
 * The geometry of a map object: GeoJSON types plus emc2 types for shapes GeoJSON lacks. Distances
 * are geodesic metres; bearings are degrees clockwise from true north. Edges between consecutive
 * positions are the shorter geodesic (model rule 10). Rules the types do not check (closed rings,
 * {@code innerRadius < outerRadius}, {@code semiMinorAxis <= semiMajorAxis}) are checked by the
 * object store (model rules 1 and 2).
 *
 * <pre>{@code
 * Geometry g = new Geometry.Circle(Position.of(11.9746, 57.7089), 2500);
 * double lon = switch (g) {
 *   case Geometry.Point p -> p.coordinates().longitude();
 *   case Geometry.Circle c -> c.center().longitude();
 *   default -> Double.NaN;
 * };
 * }</pre>
 */
public sealed interface Geometry
    permits Geometry.Point, Geometry.MultiPoint, Geometry.LineString, Geometry.Polygon,
        Geometry.Circle, Geometry.Ellipse, Geometry.Corridor, Geometry.ArcBand {

  /** The JSON {@code type} name, e.g. {@code "Point"}. */
  String typeName();

  record Point(Position coordinates) implements Geometry {
    public Point {
      Objects.requireNonNull(coordinates, "coordinates");
    }

    public String typeName() {
      return "Point";
    }
  }

  /** At least one position. */
  record MultiPoint(List<Position> coordinates) implements Geometry {
    public MultiPoint {
      coordinates = List.copyOf(coordinates);
      if (coordinates.isEmpty()) {
        throw new IllegalArgumentException("a MultiPoint needs at least one position");
      }
    }

    public String typeName() {
      return "MultiPoint";
    }
  }

  /** At least two positions. */
  record LineString(List<Position> coordinates) implements Geometry {
    public LineString {
      coordinates = List.copyOf(coordinates);
      if (coordinates.size() < 2) {
        throw new IllegalArgumentException("a LineString needs at least two positions");
      }
    }

    public String typeName() {
      return "LineString";
    }
  }

  /** The first ring is the exterior, further rings are holes. Each ring has at least four positions. */
  record Polygon(List<List<Position>> rings) implements Geometry {
    public Polygon {
      rings = rings.stream().map(List::copyOf).toList();
      if (rings.isEmpty()) {
        throw new IllegalArgumentException("a Polygon needs at least one ring");
      }
      for (List<Position> ring : rings) {
        if (ring.size() < 4) {
          throw new IllegalArgumentException("a ring needs at least four positions");
        }
      }
    }

    public String typeName() {
      return "Polygon";
    }
  }

  record Circle(Position center, double radius) implements Geometry {
    public Circle {
      Objects.requireNonNull(center, "center");
      requirePositive(radius, "radius");
    }

    public String typeName() {
      return "Circle";
    }
  }

  /** {@code rotation} is the bearing of the major axis. */
  record Ellipse(Position center, double semiMajorAxis, double semiMinorAxis, double rotation) implements Geometry {
    public Ellipse {
      Objects.requireNonNull(center, "center");
      requirePositive(semiMajorAxis, "semiMajorAxis");
      requirePositive(semiMinorAxis, "semiMinorAxis");
      requireBearing(rotation, "rotation");
    }

    public String typeName() {
      return "Ellipse";
    }
  }

  /** A centre line with a total width. */
  record Corridor(List<Position> coordinates, double width) implements Geometry {
    public Corridor {
      coordinates = List.copyOf(coordinates);
      if (coordinates.size() < 2) {
        throw new IllegalArgumentException("a Corridor needs at least two positions");
      }
      requirePositive(width, "width");
    }

    public String typeName() {
      return "Corridor";
    }
  }

  /** The area between two radii, clockwise from {@code startBearing} to {@code endBearing}. A sector has {@code innerRadius} 0. */
  record ArcBand(Position center, double innerRadius, double outerRadius, double startBearing, double endBearing) implements Geometry {
    public ArcBand {
      Objects.requireNonNull(center, "center");
      if (!(innerRadius >= 0) || !Double.isFinite(innerRadius)) {
        throw new IllegalArgumentException("innerRadius must be >= 0: " + innerRadius);
      }
      requirePositive(outerRadius, "outerRadius");
      requireBearing(startBearing, "startBearing");
      requireBearing(endBearing, "endBearing");
    }

    public String typeName() {
      return "ArcBand";
    }
  }

  private static void requirePositive(double value, String name) {
    if (!(value > 0) || !Double.isFinite(value)) {
      throw new IllegalArgumentException(name + " must be > 0: " + value);
    }
  }

  private static void requireBearing(double value, String name) {
    if (!(value >= 0 && value < 360)) {
      throw new IllegalArgumentException(name + " must be 0 <= bearing < 360: " + value);
    }
  }
}
