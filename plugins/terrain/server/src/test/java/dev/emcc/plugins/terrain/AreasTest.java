package dev.emcc.plugins.terrain;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonValue;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.junit.jupiter.api.Test;

/** Criterion 9: the areas of a result, traced along the cell edges, simplified, and fitted to the overlay's caps. */
class AreasTest {

  /** A raster from rows written from north to south: {@code #} is visible. */
  private static Viewshed.Raster raster(String... rows) {
    Viewshed.Raster raster = new Viewshed.Raster(0, 0, rows[0].length(), rows.length);
    for (int r = 0; r < rows.length; r++) {
      for (int x = 0; x < rows[r].length(); x++) {
        int y = rows.length - 1 - r;
        raster.state[y * raster.width + x] = (byte) (rows[r].charAt(x) == '#' ? (10 << 1) | 1 : 10 << 1);
      }
    }
    return raster;
  }

  private static int ringsOfKind(AreaTracer.Result result, boolean hole) {
    return (int) result.holes.stream().filter(h -> h == hole).count();
  }

  @Test
  void aSquareIsOneCounterClockwiseRingOfFourCorners() {
    AreaTracer.Result result = AreaTracer.trace(raster("...", ".#.", "..."));
    assertThat(result.rings).hasSize(1);
    assertThat(result.holes).containsExactly(false);
    assertThat(result.rings.getFirst()).hasSize(8);
    assertThat(Areas.twiceArea(result.rings.getFirst())).isEqualTo(2);
  }

  @Test
  void aHoleIsAClockwiseRingBelongingToItsExterior() {
    AreaTracer.Result result = AreaTracer.trace(raster(
        "#####",
        "#...#",
        "#.#.#",
        "#...#",
        "#####"));
    assertThat(ringsOfKind(result, false)).isEqualTo(2); // the frame and the island in the hole
    assertThat(ringsOfKind(result, true)).isEqualTo(1);
    int hole = result.holes.indexOf(true);
    assertThat(result.exterior[hole]).as("the frame, not the island").isNotEqualTo(hole);
    assertThat(result.holes.get(result.exterior[hole])).isFalse();
    assertThat(Math.abs(Areas.twiceArea(result.rings.get(result.exterior[hole])))).as("the frame's area, 25 cells").isEqualTo(50);
    assertThat(Areas.twiceArea(result.rings.get(hole))).as("clockwise, 9 cells").isEqualTo(-18);
  }

  @Test
  void cellsThatTouchOnlyAtACornerAreSeparateAreas() {
    AreaTracer.Result result = AreaTracer.trace(raster(
        "#.",
        ".#"));
    assertThat(ringsOfKind(result, false)).isEqualTo(2);
    assertThat(ringsOfKind(result, true)).isZero();
  }

  @Test
  void hiddenCellsThatTouchAtACornerAreOneHoleOfTheAreaAround() {
    // visible cells are kept apart where they touch only at a corner, so the hidden ones are one hole
    AreaTracer.Result result = AreaTracer.trace(raster(
        "#####",
        "#.###",
        "##.##",
        "#####"));
    assertThat(ringsOfKind(result, false)).isEqualTo(1);
    assertThat(ringsOfKind(result, true)).isEqualTo(1);
    assertThat(Areas.twiceArea(result.rings.get(result.holes.indexOf(true)))).as("two cells, clockwise").isEqualTo(-4);
    int exterior = result.holes.indexOf(false);
    for (int r = 0; r < result.rings.size(); r++) {
      assertThat(result.exterior[r]).isEqualTo(exterior);
    }
  }

  @Test
  void holesInSeveralRowsAndANestedIslandFindTheirOwnExteriors() {
    AreaTracer.Result result = AreaTracer.trace(raster(
        "#########",
        "#.#.....#",
        "#.#.###.#",
        "#.#.#.#.#",
        "#.#.###.#",
        "#.#.....#",
        "#########"));
    // the big area has the hole to the left of its inner wall, and the ring-shaped hole around the island
    // the walls at columns 2 are one area with the frame: the column 1 hole; the column 3-7 hole holds an island with a hole of its own
    assertThat(ringsOfKind(result, true)).isEqualTo(3);
    assertThat(ringsOfKind(result, false)).isEqualTo(2);
    for (int hole = 0; hole < result.rings.size(); hole++) {
      if (result.holes.get(hole)) {
        int exterior = result.exterior[hole];
        assertThat(result.holes.get(exterior)).isFalse();
        // the exterior's area is bigger than the hole's
        assertThat(Math.abs(Areas.twiceArea(result.rings.get(exterior)))).isGreaterThan(Math.abs(Areas.twiceArea(result.rings.get(hole))));
      }
    }
    int island = -1;
    for (int r = 0; r < result.rings.size(); r++) {
      if (!result.holes.get(r) && Math.abs(Areas.twiceArea(result.rings.get(r))) == 2 * 9) {
        island = r;
      }
    }
    assertThat(island).as("the 3 x 3 island").isNotNegative();
    int islandHole = -1;
    for (int r = 0; r < result.rings.size(); r++) {
      if (result.holes.get(r) && result.exterior[r] == island) {
        islandHole = r;
      }
    }
    assertThat(islandHole).as("the island's own hole").isNotNegative();
    assertThat(Math.abs(Areas.twiceArea(result.rings.get(islandHole)))).isEqualTo(2);
  }

  @Test
  void aRasterOfRandomCellsTracesToRingsThatCoverExactlyTheVisibleCells() {
    Random random = new Random(5);
    int w = 60;
    int h = 40;
    boolean[][] visible = new boolean[w][h];
    int count = 0;
    for (int x = 0; x < w; x++) {
      for (int y = 0; y < h; y++) {
        visible[x][y] = random.nextDouble() < 0.55;
        count += visible[x][y] ? 1 : 0;
      }
    }
    Viewshed.Raster raster = new Viewshed.Raster(0, 0, w, h);
    for (int x = 0; x < w; x++) {
      for (int y = 0; y < h; y++) {
        raster.state[y * w + x] = (byte) (visible[x][y] ? 3 : 2);
      }
    }
    AreaTracer.Result result = AreaTracer.trace(raster);
    // the signed areas add up: exteriors positive, holes negative, the total is the visible cells
    long total = 0;
    for (int[] ring : result.rings) {
      total += Areas.twiceArea(ring);
    }
    assertThat(total).isEqualTo(2L * count);
    for (int r = 0; r < result.rings.size(); r++) {
      assertThat(result.holes.get(r)).isEqualTo(Areas.twiceArea(result.rings.get(r)) < 0);
      assertThat(result.holes.get(result.exterior[r])).isFalse();
    }
  }

  /** Whether every ring is closed with at least 4 positions, as the web SDK's {@code overlayProblem} asks. */
  private static void assertDrawable(JsonArray areas) {
    int positions = 0;
    for (JsonValue area : areas.values()) {
      List<JsonValue> rings = ((JsonArray) area).values();
      assertThat(rings).isNotEmpty();
      for (JsonValue ring : rings) {
        List<JsonValue> ps = ((JsonArray) ring).values();
        assertThat(ps.size()).isGreaterThanOrEqualTo(4);
        assertThat(ps.getFirst()).as("closed").isEqualTo(ps.getLast());
        positions += ps.size();
        for (JsonValue p : ps) {
          double lon = ((JsonNumber) ((JsonArray) p).get(0)).doubleValue();
          double lat = ((JsonNumber) ((JsonArray) p).get(1)).doubleValue();
          assertThat(lon).isBetween(-180.0, 180.0);
          assertThat(lat).isBetween(-90.0, 90.0);
        }
      }
    }
    assertThat(areas.size()).isLessThanOrEqualTo(20_000);
    assertThat(positions).isLessThanOrEqualTo(200_000);
  }

  @Test
  void theAreasAreClosedRingsInLongitudeLatitudeWithHolesInsideTheirExterior() {
    AreaTracer.Result result = AreaTracer.trace(raster(
        "#########",
        "#.......#",
        "#.#####.#",
        "#.#...#.#",
        "#.#####.#",
        "#.......#",
        "#########"));
    // lon steps 0.002, lat steps 0.001: positions differ in the two axes
    Areas.Fitted fitted = Areas.fit(result, 9000, 59000, 0.002, 0.001, Areas.MAX_ITEMS, Areas.MAX_POSITIONS);
    assertDrawable(fitted.areas());
    assertThat(fitted.simplified()).isZero();
    assertThat(fitted.leftOut()).isZero();
    // the frame (with its hole) and the island (with its hole)
    assertThat(fitted.areas().size()).isEqualTo(2);
    JsonArray frame = (JsonArray) fitted.areas().values().stream().filter(a -> ((JsonArray) a).size() == 2).findFirst().orElseThrow();
    double[] exterior = box((JsonArray) frame.get(0));
    double[] hole = box((JsonArray) frame.get(1));
    assertThat(hole[0]).isGreaterThanOrEqualTo(exterior[0]);
    assertThat(hole[1]).isLessThanOrEqualTo(exterior[1]);
    assertThat(hole[2]).isGreaterThanOrEqualTo(exterior[2]);
    assertThat(hole[3]).isLessThanOrEqualTo(exterior[3]);
    // longitude first: the frame spans 9 cells of 0.002 degrees in longitude and 7 of 0.001 in latitude
    assertThat(exterior[1] - exterior[0]).isCloseTo(9 * 0.002, org.assertj.core.data.Offset.offset(1e-9));
    assertThat(exterior[3] - exterior[2]).isCloseTo(7 * 0.001, org.assertj.core.data.Offset.offset(1e-9));
    assertThat(exterior[0]).as("the western edge is half a cell west of node 9000").isCloseTo(9000 * 0.002 - 0.001, org.assertj.core.data.Offset.offset(1e-9));
    assertThat(exterior[2]).as("the southern edge is half a cell south of node 59000").isCloseTo(59000 * 0.001 - 0.0005, org.assertj.core.data.Offset.offset(1e-9));
  }

  /** {@code {minLon, maxLon, minLat, maxLat}} of a ring. */
  private static double[] box(JsonArray ring) {
    double[] b = {1e9, -1e9, 1e9, -1e9};
    for (JsonValue p : ring.values()) {
      double lon = ((JsonNumber) ((JsonArray) p).get(0)).doubleValue();
      double lat = ((JsonNumber) ((JsonArray) p).get(1)).doubleValue();
      b[0] = Math.min(b[0], lon);
      b[1] = Math.max(b[1], lon);
      b[2] = Math.min(b[2], lat);
      b[3] = Math.max(b[3], lat);
    }
    return b;
  }

  @Test
  void aResultTooLargeIsSimplifiedUntilItFitsAndTheAnswerSaysSo() {
    // a noisy blob: thousands of corners at the base tolerance
    Random random = new Random(11);
    int w = 400;
    int h = 300;
    Viewshed.Raster raster = new Viewshed.Raster(0, 0, w, h);
    for (int x = 0; x < w; x++) {
      for (int y = 0; y < h; y++) {
        double dx = x - w / 2.0;
        double dy = y - h / 2.0;
        boolean inside = dx * dx / (150.0 * 150.0) + dy * dy / (110.0 * 110.0) + random.nextGaussian() * 0.04 < 1;
        raster.state[y * w + x] = (byte) (inside ? 3 : 2);
      }
    }
    AreaTracer.Result result = AreaTracer.trace(raster);
    Areas.Fitted loose = Areas.fit(result, 0, 0, 0.001, 0.0005, Areas.MAX_ITEMS, Areas.MAX_POSITIONS);
    assertThat(loose.simplified()).isZero();
    int base = loose.positions();
    assertThat(base).isGreaterThan(500);

    Areas.Fitted tight = Areas.fit(result, 0, 0, 0.001, 0.0005, 100, base / 3);
    assertThat(tight.positions()).isLessThanOrEqualTo(base / 3);
    assertThat(tight.simplified()).as("the tolerance was doubled").isPositive();
    assertDrawable(tight.areas());
    assertThat(tight.leftOut()).isZero();

    // and with the caps of the overlay itself
    assertThat(Areas.MAX_ITEMS).isLessThan(20_000);
    assertThat(Areas.MAX_POSITIONS).isLessThan(200_000);
  }

  @Test
  void whenEvenTheLargestToleranceDoesNotFitTheSmallestAreasAreLeftOut() {
    // 40 separate cells' blocks of 3 x 3 in a row; only 4 items allowed
    int w = 40 * 4;
    Viewshed.Raster raster = new Viewshed.Raster(0, 0, w, 3);
    for (int b = 0; b < 40; b++) {
      int size = b == 7 ? 3 : 2;
      for (int x = 0; x < size; x++) {
        for (int y = 0; y < 3 && (y < size || b == 7); y++) {
          raster.state[y * w + b * 4 + x] = 3;
        }
      }
    }
    for (int i = 0; i < raster.state.length; i++) {
      if (raster.state[i] != 3) {
        raster.state[i] = 2;
      }
    }
    AreaTracer.Result result = AreaTracer.trace(raster);
    Areas.Fitted fitted = Areas.fit(result, 0, 0, 0.001, 0.0005, 4, Areas.MAX_POSITIONS);
    assertThat(fitted.areas().size()).isLessThanOrEqualTo(4);
    assertThat(fitted.leftOut() + fitted.areas().size()).as("every area is kept or counted as left out").isGreaterThanOrEqualTo(1);
    assertDrawable(fitted.areas());
  }

  @Test
  void aRingSimplifiesToACoarserOutlineWithoutLeavingTheOriginalsExtent() {
    // a staircase diagonal 100 cells long
    List<Integer> corners = new ArrayList<>();
    for (int i = 0; i < 100; i++) {
      corners.add(i);
      corners.add(i);
      corners.add(i + 1);
      corners.add(i);
    }
    corners.add(100);
    corners.add(-50);
    corners.add(0);
    corners.add(-50);
    int[] ring = corners.stream().mapToInt(Integer::intValue).toArray();
    int[] simple = Areas.simplify(ring, 1.5);
    assertThat(simple).isNotNull();
    assertThat(simple.length).isLessThan(ring.length / 4);
    for (int i = 0; i < simple.length; i += 2) {
      assertThat(simple[i]).isBetween(0, 100);
      assertThat(simple[i + 1]).isBetween(-50, 100);
    }
  }
}
