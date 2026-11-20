package dev.emcc.ecore.store;

import dev.emcc.ecore.json.Problem;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Position;
import java.util.ArrayList;
import java.util.List;

/**
 * The geometry rules the JSON Schema cannot express (model rules 1 and 2). {@link #check} returns
 * the problems, with JSON Pointer paths into the change request; {@link #normalize} brings polygon
 * rings into the right-hand orientation.
 */
final class GeometryRules {

  /** Where a change request keeps its geometry. */
  static final String PATH = "/data/geometry";

  private GeometryRules() {}

  /** The problems of {@code geometry}; empty if it follows rules 1 and 2. */
  static List<Problem> check(Geometry geometry) {
    List<Problem> problems = new ArrayList<>();
    switch (geometry) {
      case Geometry.Polygon polygon -> {
        for (int i = 0; i < polygon.rings().size(); i++) {
          List<Position> ring = polygon.rings().get(i);
          String path = PATH + "/coordinates/" + i;
          if (!ring.getFirst().equals(ring.getLast())) {
            problems.add(new Problem(path, "the ring is not closed: its first and last positions differ (model rule 1)"));
          } else if (RingOrientation.of(ring) == RingOrientation.Kind.AROUND_A_POLE) {
            problems.add(new Problem(path,
                "the ring encloses a pole, which a polygon cannot express in v0; use a Circle or ArcBand (model rule 10)"));
          }
        }
      }
      case Geometry.ArcBand band -> {
        if (!(band.innerRadius() < band.outerRadius())) {
          problems.add(new Problem(PATH + "/innerRadius", "innerRadius must be smaller than outerRadius (model rule 2)"));
        }
      }
      case Geometry.Ellipse ellipse -> {
        if (ellipse.semiMinorAxis() > ellipse.semiMajorAxis()) {
          problems.add(new Problem(PATH + "/semiMinorAxis",
              "semiMinorAxis must not be larger than semiMajorAxis (model rule 2)"));
        }
      }
      default -> {}
    }
    return problems;
  }

  /**
   * The geometry with every polygon ring in the right-hand orientation: the exterior ring
   * counter-clockwise, holes clockwise (model rule 1). Call only for a geometry without problems.
   */
  static Geometry normalize(Geometry geometry) {
    if (!(geometry instanceof Geometry.Polygon polygon)) {
      return geometry;
    }
    List<List<Position>> rings = new ArrayList<>(polygon.rings().size());
    boolean changed = false;
    for (int i = 0; i < polygon.rings().size(); i++) {
      List<Position> ring = polygon.rings().get(i);
      RingOrientation.Kind wanted = i == 0 ? RingOrientation.Kind.COUNTER_CLOCKWISE : RingOrientation.Kind.CLOCKWISE;
      RingOrientation.Kind actual = RingOrientation.of(ring);
      if (actual != wanted && actual != RingOrientation.Kind.DEGENERATE) {
        rings.add(ring.reversed());
        changed = true;
      } else {
        rings.add(ring);
      }
    }
    return changed ? new Geometry.Polygon(rings) : geometry;
  }
}
