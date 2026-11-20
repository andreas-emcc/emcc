package dev.emcc.ecore.geo;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Position;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** The spatial index against testing every object (spike S3's IndexTest, in production form). */
class CellIndexTest {

  private final Random random = new Random(20261012);

  private static List<Position> ring(double... lonLat) {
    List<Position> ring = new ArrayList<>();
    for (int i = 0; i < lonLat.length; i += 2) {
      ring.add(Position.of(lonLat[i], lonLat[i + 1]));
    }
    return ring;
  }

  /** A ring of {@code points} around the pole at {@code lat}, closed. */
  private static List<Position> polarRing(double lat, int points) {
    List<Position> ring = new ArrayList<>();
    for (int i = 0; i < points; i++) {
      ring.add(Position.of(-180 + 360.0 * i / points, lat));
    }
    ring.add(ring.getFirst());
    return ring;
  }

  private static final List<GeoArea> AREAS = List.of(
      new GeoArea(ring(17, 58, 20, 58, 20, 60, 17, 60, 17, 58), Position.of(18.5, 59), 0, 0), // Stockholm, about 170 × 220 km
      new GeoArea(ring(17, 58, 20, 58, 20, 60, 17, 60, 17, 58), Position.of(18.5, 59), 0, 0.5), // the same with S3's margin
      new GeoArea(ring(-10, 35, 40, 35, 40, 70, -10, 70, -10, 35), Position.of(15, 55), 25_000, 0), // Europe
      new GeoArea(ring(166, -10, -166, -10, -166, 10, 166, 10, 166, -10), Position.of(180, 0), 0, 0), // across the antimeridian
      new GeoArea(polarRing(70, 16), Position.of(0, 90), 0, 0), // the north polar cap
      new GeoArea(polarRing(-85, 8), Position.of(15, 62), 0, 0), // everything but the south polar cap
      new GeoArea(ring(10.5, 59.8, 10.9, 59.8, 10.9, 60.0, 10.5, 60.0, 10.5, 59.8), Position.of(10.7, 59.9), 0, 0), // zoomed in, Oslo
      // Margins that hold cells outside the ring wholly (criterion 22's fix): twice the extent; metres and a share.
      new GeoArea(ring(17, 58, 20, 58, 20, 60, 17, 60, 17, 58), Position.of(18.5, 59), 0, 2),
      new GeoArea(ring(-10, 35, 40, 35, 40, 70, -10, 70, -10, 35), Position.of(15, 55), 300_000, 0.5),
      new GeoArea(GeoAreaTest.zoomedOutBand(-165, 84.34, -13.03), Position.of(15, 62), 0, 0.5), // like map-view-2d's widest view
      CapturedAreas.criterion22View(), // map-view-2d's widest view as captured (review F1)
      new GeoArea(ring(166, -10, -166, -10, -166, 10, 166, 10, 166, -10), Position.of(180, 0), 0, 1), // across the antimeridian (F6)
      new GeoArea(polarRing(70, 16), Position.of(0, 90), 200_000, 0.5)); // the north polar cap (F6)

  private Position randomPosition() {
    double[] lonLat = switch (random.nextInt(4)) {
      case 0 -> new double[] {15 + random.nextGaussian() * 4, 59 + random.nextGaussian() * 2}; // the Baltic
      case 1 -> new double[] {-180 + random.nextDouble() * 360, 60 + random.nextDouble() * 30}; // the Arctic
      case 2 -> new double[] {178 + random.nextGaussian(), random.nextGaussian() * 5}; // the antimeridian
      default -> new double[] {-180 + random.nextDouble() * 360, Math.toDegrees(Math.asin(2 * random.nextDouble() - 1))}; // anywhere
    };
    return Position.of(wrap(lonLat[0]), Math.max(-90, Math.min(90, lonLat[1])));
  }

  private static double wrap(double lon) {
    return lon > 180 ? lon - 360 : lon < -180 ? lon + 360 : lon;
  }

  private Geometry randomGeometry() {
    Position p = randomPosition();
    double lon = p.longitude();
    double lat = Math.max(-89, Math.min(89, p.latitude()));
    Position at = Position.of(lon, lat);
    return switch (random.nextInt(10)) {
      case 0, 1, 2, 3, 4, 5 -> new Geometry.Point(at);
      case 6 -> new Geometry.Circle(at, random.nextDouble() < 0.1 ? 1_500_000 : random.nextDouble() * 50_000); // some wider than 4 cells
      case 7 -> new Geometry.LineString(List.of(at, Position.of(wrap(lon + random.nextDouble() * 3 - 1.5), lat + random.nextDouble() * 1 - 0.5)));
      default -> {
        double d = random.nextDouble() * 2;
        double east = wrap(lon + d);
        double north = Math.min(89.5, lat + d);
        yield new Geometry.Polygon(List.of(List.of(at, Position.of(east, lat), Position.of(east, north), Position.of(lon, north), at)));
      }
    };
  }

  /** Bounds by handle; null for a free handle. */
  private final List<Cap> bounds = new ArrayList<>();

  private Set<Integer> byIndex(CellIndex index, GeoArea area) {
    Set<Integer> found = new HashSet<>();
    index.query(area, bounds::get, h -> assertThat(found.add(h)).as("handle " + h + " reported once").isTrue());
    return found;
  }

  private Set<Integer> byScan(GeoArea area) {
    Set<Integer> found = new HashSet<>();
    for (int h = 0; h < bounds.size(); h++) {
      Cap cap = bounds.get(h);
      if (cap != null && area.matches(cap)) {
        found.add(h);
      }
    }
    return found;
  }

  private void assertSameAsScan(CellIndex index, String when) {
    for (int a = 0; a < AREAS.size(); a++) {
      GeoArea area = AREAS.get(a);
      Set<Integer> scanned = byScan(area);
      assertThat(byIndex(index, area)).as(when + ", area " + a).isEqualTo(scanned);
    }
  }

  @Test
  void anAreaQueryFindsExactlyWhatTestingEveryObjectFindsAlsoAfterMovesAndRemovals() {
    CellIndex index = new CellIndex();
    for (int h = 0; h < 5_000; h++) {
      Cap cap = Cap.of(randomGeometry());
      bounds.add(cap);
      index.put(h, null, cap);
    }
    assertSameAsScan(index, "after adding");
    for (int a = 0; a < AREAS.size(); a++) {
      assertThat(byScan(AREAS.get(a))).as("area " + a + " holds something to find").isNotEmpty();
    }

    for (int h = 0; h < bounds.size(); h += 2) { // every second one moves
      Cap moved = Cap.of(randomGeometry());
      index.put(h, bounds.get(h), moved);
      bounds.set(h, moved);
    }
    for (int h = 1; h < bounds.size(); h += 3) { // some go
      index.remove(h, bounds.get(h));
      bounds.set(h, null);
    }

    assertSameAsScan(index, "after moving and removing");
  }

  @Test
  void aPointExactlyOnACellCornerOrAPoleIsFound() {
    CellIndex index = new CellIndex();
    List<Geometry> geometries = List.of(new Geometry.Point(Position.of(0, 90)), new Geometry.Point(Position.of(0, -90)),
        new Geometry.Point(Position.of(45, Math.toDegrees(Math.atan(1 / Math.sqrt(2))))), // a cube corner
        new Geometry.Point(Position.of(180, 0)), new Geometry.Point(Position.of(-180, 0)));
    for (Geometry g : geometries) {
      Cap cap = Cap.of(g);
      index.put(bounds.size(), null, cap);
      bounds.add(cap);
    }
    GeoArea world = new GeoArea(polarRing(-89.9, 8), Position.of(0, 0), 0, 0);
    GeoArea north = new GeoArea(polarRing(80, 8), Position.of(0, 90), 0, 0);

    assertThat(byIndex(index, world)).isEqualTo(byScan(world)).hasSize(4); // all but the south pole
    assertThat(byIndex(index, north)).containsExactly(0);
  }

  @Test
  void eachCellsCapHoldsItsPointsAndNeighboursAreMutual() {
    CubeCells cells = new CubeCells(CellIndex.LEVEL);
    for (int k = 0; k < 2_000; k++) {
      Position p = randomPosition();
      double[] v = Sphere.vec(p.longitude(), p.latitude());
      long cell = cells.cell(v[0], v[1], v[2]);
      Cap cap = cells.cap(cell);
      assertThat(Sphere.angle(v, new double[] {cap.x(), cap.y(), cap.z()})).isLessThanOrEqualTo(cap.radius());
      List<Long> neighbours = new ArrayList<>();
      cells.neighbours(cell, neighbours::add);
      assertThat(new HashSet<>(neighbours)).hasSizeBetween(7, 8).doesNotContain(cell);
      for (long n : neighbours) {
        List<Long> back = new ArrayList<>();
        cells.neighbours(n, back::add);
        assertThat(back).as("a neighbour of a neighbour").contains(cell);
      }
    }
  }

  @Test
  void theLevelForADistanceGivesCellsOfAboutThatSize() {
    assertThat(CubeCells.levelFor(156_000)).isEqualTo(6);
    assertThat(CubeCells.levelFor(39_000)).isEqualTo(8);
    assertThat(CubeCells.levelFor(1e9)).isZero();
    assertThat(CubeCells.levelFor(0.001)).isEqualTo(CubeCells.MAX_LEVEL);
  }
}
