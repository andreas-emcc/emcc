package dev.emcc.ecore.geo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Position;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.junit.jupiter.api.Test;

/** The area test of spike S3 in production form, with rings built by hand. */
class GeoAreaTest {

  private static final double METRES_PER_DEGREE = Sphere.R * Math.PI / 180;

  private static List<Position> ring(double... lonLat) {
    List<Position> ring = new ArrayList<>();
    for (int i = 0; i < lonLat.length; i += 2) {
      ring.add(Position.of(lonLat[i], lonLat[i + 1]));
    }
    return ring;
  }

  private static Geometry point(double lon, double lat) {
    return new Geometry.Point(Position.of(lon, lat));
  }

  private static GeoArea area(List<Position> ring, double lon, double lat) {
    return new GeoArea(ring, Position.of(lon, lat), 0, 0);
  }

  /**
   * The ring map-view-2d sends at its widest zoom (criterion 22): once round the world eastwards at
   * {@code north}, down the {@code seam} meridian, once round westwards at {@code south}, and up the
   * seam again; its inside is the band between.
   */
  static List<Position> zoomedOutBand(double seam, double north, double south) {
    List<Position> ring = new ArrayList<>();
    for (int k = 0; k < 16; k++) {
      ring.add(Position.of(wrap(seam + 22.5 * k), north));
    }
    for (int k = 0; k <= 32; k++) {
      ring.add(Position.of(seam, north + (south - north) * k / 32));
    }
    for (int k = 1; k < 128; k++) {
      ring.add(Position.of(wrap(seam - 360.0 * k / 128), south));
    }
    for (int k = 0; k <= 32; k++) {
      ring.add(Position.of(seam, south + (north - south) * k / 32));
    }
    return ring;
  }

  private static double wrap(double lon) {
    return lon > 180 ? lon - 360 : lon < -180 ? lon + 360 : lon;
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

  @Test
  void aCapAsWideAsTheWorldMatchesButIsNeverHeldWholly() {
    GeoArea area = new GeoArea(ring(17, 58, 20, 58, 20, 60, 17, 60, 17, 58), Position.of(18.5, 59), 0, 0.5);
    Cap world = Cap.of(Sphere.vec(18.5, 59), Math.PI);
    assertThat(area.matches(world)).isTrue();
    assertThat(area.relation(world)).isEqualTo(GeoArea.PARTLY);
  }

  @Test
  void aCapIsOutsideExactlyWhenItDoesNotMatchAndWhollyInsideOnlyWhenEveryPointOfItMatches() {
    Random random = new Random(20261017);
    List<GeoArea> areas = List.of(
        new GeoArea(ring(17, 58, 20, 58, 20, 60, 17, 60, 17, 58), Position.of(18.5, 59), 0, 2), // a margin twice its extent
        new GeoArea(ring(-10, 35, 40, 35, 40, 70, -10, 70, -10, 35), Position.of(15, 55), 300_000, 0.5),
        new GeoArea(zoomedOutBand(-165, 84.34, -13.03), Position.of(15, 62), 0, 0.5), // criterion 22's view
        new GeoArea(zoomedOutBand(-165, 84.34, -13.03), Position.of(15, 62), 0, 0), // the same without its margin
        CapturedAreas.criterion22View(), // the ring as captured
        new GeoArea(ring(166, -10, -166, -10, -166, 10, 166, 10, 166, -10), Position.of(180, 0), 0, 1), // across the antimeridian
        new GeoArea(polarRing(70, 16), Position.of(0, 90), 200_000, 0.5)); // the north polar cap
    for (GeoArea area : areas) {
      int wholly = 0;
      double extent = Math.min(1, area.extentMetres() / Sphere.R); // radians
      for (int i = 0; i < 3_000; i++) {
        boolean near = random.nextBoolean(); // half near the area, at its scale; half anywhere
        double[] centre = near
            ? Sphere.normalize(new double[] {
              area.insideX() + random.nextGaussian() * extent * 2, area.insideY() + random.nextGaussian() * extent * 2,
              area.insideZ() + random.nextGaussian() * extent * 2})
            : Sphere.vec(-180 + random.nextDouble() * 360, Math.toDegrees(Math.asin(2 * random.nextDouble() - 1)));
        double radius = random.nextDouble() * (near ? extent / 2 : random.nextBoolean() ? 0.05 : 0.5);
        Cap cap = Cap.of(centre, radius);
        int relation = area.relation(cap);
        assertThat(relation == GeoArea.OUTSIDE).as("outside exactly when it does not match").isEqualTo(!area.matches(cap));
        if (relation != GeoArea.WHOLLY) {
          continue;
        }
        wholly++;
        for (int k = 0; k < 20; k++) { // points of the cap, its rim included
          double[] side = Sphere.normalize(Sphere.cross(centre, new double[] {random.nextGaussian(), random.nextGaussian(), random.nextGaussian()}));
          double a = k == 0 ? radius : radius * Math.sqrt(random.nextDouble());
          double[] p = {
            centre[0] * Math.cos(a) + side[0] * Math.sin(a), centre[1] * Math.cos(a) + side[1] * Math.sin(a), centre[2] * Math.cos(a) + side[2] * Math.sin(a)};
          assertThat(area.matches(Cap.of(p, 0))).as("a point of a cap held wholly matches").isTrue();
        }
      }
      assertThat(wholly).as("some caps are held wholly").isPositive();
    }
  }

  @Test
  void longitudeComesFirst() {
    GeoArea around = area(ring(9, 49, 11, 49, 11, 51, 9, 51, 9, 49), 10, 50);

    assertThat(around.matches(point(10, 50))).isTrue();
    assertThat(around.matches(point(50, 10))).as("latitude and longitude swapped").isFalse();
  }

  @Test
  void acrossTheAntimeridianBothSidesAreInsideAndTheFarSideIsNot() {
    GeoArea area = area(ring(166, -10, -166, -10, -166, 10, 166, 10, 166, -10), 180, 0); // 28° wide

    assertThat(area.matches(point(179.5, 0.3))).isTrue();
    assertThat(area.matches(point(-179.5, -0.3))).isTrue();
    assertThat(area.matches(point(167, 0))).isTrue();
    assertThat(area.matches(point(0, 0))).isFalse();
    assertThat(area.matches(point(160, 0))).isFalse();
    assertThat(area.matches(point(-160, 0))).isFalse();
  }

  @Test
  void pointsDueNorthAndSouthOfTheInsidePointAreJudgedRightThoughTheirArcRunsThroughAVertex() {
    // The top and bottom middle vertices lie on the meridian of the inside point (half-open rule).
    GeoArea area = area(ring(-90, -10, -78.11, -12, -66, -10, -66, 10, -78.11, 12, -90, 10, -90, -10), -78.11, 0.15);

    for (int lat = -89; lat <= 89; lat++) {
      if (Math.abs(lat) == 12) {
        continue; // on the vertex itself
      }
      double[] v = Sphere.vec(-78.11, lat);
      assertThat(area.contains(v[0], v[1], v[2])).as("lat " + lat).isEqualTo(Math.abs(lat) < 12);
    }
  }

  @Test
  void aroundThePoleEveryLongitudeIsInside() {
    List<Position> ring = new ArrayList<>();
    for (int lon = -180; lon <= 180; lon += 45) {
      ring.add(Position.of(lon, 80));
    }
    ring.set(ring.size() - 1, ring.getFirst()); // closed
    GeoArea area = area(ring, 0, 90);

    for (int lon = -180; lon < 180; lon += 15) {
      assertThat(area.matches(point(lon, 85))).as("lon " + lon).isTrue();
      assertThat(area.matches(point(lon, -10))).as("lon " + lon).isFalse();
    }
    assertThat(area.bound().radius()).isLessThan(Math.PI / 2);
  }

  @Test
  void anAreaThatHoldsTheAntipodeOfItsInsidePointCoversTheWorldButTheHoleInIt() {
    List<Position> ring = new ArrayList<>();
    for (int lon = 180; lon >= -180; lon -= 45) {
      ring.add(Position.of(lon, -85));
    }
    ring.set(ring.size() - 1, ring.getFirst());
    GeoArea area = area(ring, 15, 62); // everything but the cap around the south pole

    assertThat(area.matches(point(-165, -62))).as("the antipode of the inside point").isTrue();
    assertThat(area.matches(point(100, 0))).isTrue();
    assertThat(area.matches(point(0, -89))).isFalse();
    assertThat(area.bound()).isEqualTo(Cap.WORLD);
  }

  @Test
  void aMarginInMetresIsADistanceAroundTheRing() {
    List<Position> square = ring(18, 59, 18.2, 59, 18.2, 59.2, 18, 59.2, 18, 59);
    GeoArea area = new GeoArea(square, Position.of(18.1, 59.1), 20_000, 0);

    assertThat(area.matches(point(18.1, 59.2 + 19_000 / METRES_PER_DEGREE))).isTrue();
    assertThat(area.matches(point(18.1, 59.2 + 21_000 / METRES_PER_DEGREE))).isFalse();
    assertThat(area.matches(new Geometry.Circle(Position.of(18.1, 59.2 + 21_000 / METRES_PER_DEGREE), 2_000)))
        .as("a circle that reaches in").isTrue();
  }

  @Test
  void aMarginAsAShareIsAShareOfTheGreatestDistanceFromTheInsidePointToTheRing() {
    List<Position> square = ring(18, 59, 18.2, 59, 18.2, 59.2, 18, 59.2, 18, 59);
    double toCorner = Sphere.angle(Sphere.vec(18.1, 59.1), Sphere.vec(18.2, 59.2)) * Sphere.R;
    GeoArea area = new GeoArea(square, Position.of(18.1, 59.1), 0, 0.5);

    assertThat(area.matches(point(18.1, 59.2 + 0.45 * toCorner / METRES_PER_DEGREE))).isTrue();
    assertThat(area.matches(point(18.1, 59.2 + 0.55 * toCorner / METRES_PER_DEGREE))).isFalse();
  }

  @Test
  void geometriesMatchByTheirBound() {
    GeoArea area = area(ring(9, 49, 11, 49, 11, 51, 9, 51, 9, 49), 10, 50);

    assertThat(area.matches(new Geometry.LineString(List.of(Position.of(8, 50), Position.of(12, 50))))).as("crosses it").isTrue();
    assertThat(area.matches(new Geometry.LineString(List.of(Position.of(20, 50), Position.of(21, 50))))).isFalse();
    // The bound is a cap around the vertices (about 1.2° here): conservative, so the corridors lie at 54° N.
    assertThat(area.matches(new Geometry.Corridor(List.of(Position.of(8, 54), Position.of(12, 54)), 500_000)))
        .as("a wide corridor reaches in").isTrue();
    assertThat(area.matches(new Geometry.Corridor(List.of(Position.of(8, 54), Position.of(12, 54)), 1_000))).isFalse();
  }

  @Test
  void aRingWithOppositeNeighbouringPositionsIsRefused() {
    assertThatThrownBy(() -> area(ring(0, 0, 180, 0, 90, 45, 0, 0), 60, 20))
        .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("opposite each other");
  }

  @Test
  void aRingMustBeClosedWithAtLeastFourPositions() {
    assertThatThrownBy(() -> area(ring(9, 49, 11, 49, 9, 49), 10, 50)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> area(ring(9, 49, 11, 49, 11, 51, 9, 51), 10, 50)).isInstanceOf(IllegalArgumentException.class);
  }
}
