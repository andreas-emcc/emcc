package dev.emcc.plugins.terrain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Position;
import java.util.Random;
import org.junit.jupiter.api.Test;

/**
 * The line of sight: criteria 6 (a flat plain), 7 (a ridge), 8 (against a brute-force check) and 13
 * (the edge of the data). Every position has a latitude different from its longitude.
 */
class ViewshedTest {

  private static final double EARTH_RADIUS = Viewshed.EARTH_RADIUS;
  private static final long FOREVER = Long.MAX_VALUE / 4;

  /** A bilinear height grid whose node {@code (i, j)} is at longitude {@code i * lonStep} and latitude {@code j * latStep}. */
  static final class Grid implements HeightField {
    final int iBase;
    final int jBase;
    final int nx;
    final int ny;
    final double lonStep;
    final double latStep;
    final double[][] h;

    Grid(int iBase, int jBase, int nx, int ny, double lonStep, double latStep) {
      this.iBase = iBase;
      this.jBase = jBase;
      this.nx = nx;
      this.ny = ny;
      this.lonStep = lonStep;
      this.latStep = latStep;
      this.h = new double[nx][ny];
    }

    @Override
    public double height(double lon, double lat) {
      double u = lon / lonStep - iBase;
      double v = lat / latStep - jBase;
      if (!(u >= 0 && u <= nx - 1 && v >= 0 && v <= ny - 1)) {
        return Double.NaN;
      }
      int i = Math.min((int) u, nx - 2);
      int j = Math.min((int) v, ny - 2);
      double tx = u - i;
      double ty = v - j;
      double a = h[i][j] + (h[i + 1][j] - h[i][j]) * tx;
      double b = h[i][j + 1] + (h[i + 1][j + 1] - h[i][j + 1]) * tx;
      double value = a + (b - a) * ty;
      return Double.isNaN(h[i][j]) || Double.isNaN(h[i + 1][j]) || Double.isNaN(h[i][j + 1]) || Double.isNaN(h[i + 1][j + 1]) ? Double.NaN : value;
    }
  }

  private static Viewshed.Params params(double lon, double lat, double observerHeight, double targetHeight, double range, double k, double lonStep, double latStep) {
    return new Viewshed.Params(lon, lat, observerHeight, targetHeight, range, k, lonStep, latStep);
  }

  /** Whether the node with absolute indices {@code (i, j)} is visible; false outside the raster. */
  private static boolean visibleAt(Viewshed.Raster raster, long i, long j) {
    long x = i - raster.i0;
    long y = j - raster.j0;
    return x >= 0 && x < raster.width && y >= 0 && y < raster.height && raster.visible((int) x, (int) y);
  }

  private static double distance(double lon, double lat, double toLon, double toLat) {
    return Geodesy.inverse(Position.of(lon, lat), Position.of(toLon, toLat)).distanceMetres();
  }

  @Test
  void criterion6AnObserverOnAFlatPlainSeesADiscToTheHorizonMinusWhatCurvatureHides() {
    // level 2 spacing at 59 degrees north: 1" of latitude, 2" of longitude
    double lonStep = 2.0 / 3600;
    double latStep = 1.0 / 3600;
    double lon = 18.0686;
    double lat = 59.3293;
    double k = 0.13;
    Viewshed.Params p = params(lon, lat, 2, 2, 16_000, k, lonStep, latStep);
    Viewshed.Raster raster = Viewshed.sweep((a, b) -> 12.0, p, FOREVER);
    assertThat(raster).isNotNull();

    // the distance at which the line of sight from 2 m to a 2 m target grazes the horizon
    double horizon = Math.sqrt(2 * EARTH_RADIUS / (1 - k)) * (Math.sqrt(2) + Math.sqrt(2));
    assertThat(horizon).isBetween(10_700.0, 10_900.0);

    int visibleInside = 0;
    int inside = 0;
    int visibleBeyond = 0;
    int beyond = 0;
    for (int y = 0; y < raster.height; y += 7) {
      for (int x = 0; x < raster.width; x += 7) {
        double nodeLon = (raster.i0 + x) * lonStep;
        double nodeLat = (raster.j0 + y) * latStep;
        double d = distance(lon, lat, nodeLon, nodeLat);
        if (d < horizon - 250) {
          inside++;
          visibleInside += raster.visible(x, y) ? 1 : 0;
        } else if (d > horizon + 250 && d < 15_500) {
          beyond++;
          visibleBeyond += raster.visible(x, y) ? 1 : 0;
        }
      }
    }
    assertThat(inside).isGreaterThan(1000);
    assertThat(beyond).isGreaterThan(300);
    assertThat(visibleInside).as("a disc out to the horizon").isEqualTo(inside);
    assertThat(visibleBeyond).as("a 2 m target beyond the horizon distance of both heights is hidden").isZero();
    assertThat(raster.noData).isFalse();
  }

  @Test
  void criterion6ATallerTargetBeyondTheHorizonIsSeen() {
    double lonStep = 6.0 / 3600;
    double latStep = 3.0 / 3600;
    Viewshed.Params p = params(18.0686, 59.3293, 2, 30, 20_000, 0.13, lonStep, latStep);
    Viewshed.Raster raster = Viewshed.sweep((a, b) -> 0.0, p, FOREVER);
    assertThat(raster).isNotNull();
    // a 30 m target is seen to sqrt(2R / (1 - k)) * (sqrt 2 + sqrt 30) = about 3.8 + 17.9 = 21.7 km: all of the range
    int hidden = 0;
    for (int y = 0; y < raster.height; y += 5) {
      for (int x = 0; x < raster.width; x += 5) {
        double d = distance(18.0686, 59.3293, (raster.i0 + x) * lonStep, (raster.j0 + y) * latStep);
        if (d < 19_500 && !raster.visible(x, y)) {
          hidden++;
        }
      }
    }
    assertThat(hidden).isZero();
  }

  @Test
  void withoutCurvatureAndRefractionTheHorizonIsFarther() {
    double lonStep = 6.0 / 3600;
    double latStep = 3.0 / 3600;
    double lon = 18.0686;
    double lat = 59.3293;
    // k = 1 cancels curvature: a flat plain is seen to the end of the range
    Viewshed.Raster flat = Viewshed.sweep((a, b) -> 0.0, params(lon, lat, 2, 2, 20_000, 1.0, lonStep, latStep), FOREVER);
    Viewshed.Raster curved = Viewshed.sweep((a, b) -> 0.0, params(lon, lat, 2, 2, 20_000, 0.0, lonStep, latStep), FOREVER);
    assertThat(flat).isNotNull();
    assertThat(curved).isNotNull();
    long i = Math.round((lon + 18_000 / (111_320 * Math.cos(Math.toRadians(lat)))) / lonStep);
    long j = Math.round(lat / latStep);
    assertThat(visibleAt(flat, i, j)).as("18 km east with k = 1").isTrue();
    assertThat(visibleAt(curved, i, j)).as("18 km east without refraction: the horizon of 2 m and 2 m is 10 km").isFalse();
  }

  @Test
  void criterion7ARidgeHidesTheGroundBehindItFromAKnownDistanceWithinOneCell() {
    double lonStep = 6.0 / 3600;
    double latStep = 3.0 / 3600;
    double lon = 18.0686;
    double lat = 59.3293;
    double lonMetres = distance(lon, lat, lon + lonStep, lat);
    double ridgeAt = lon + 1_000 / lonMetres * lonStep; // 1 km east of the observer
    double ridgeWidth = 2 * lonStep;
    HeightField ridge = (a, b) -> a >= ridgeAt && a <= ridgeAt + ridgeWidth ? 40.0 : 0.0;
    Viewshed.Raster raster = Viewshed.sweep(ridge, params(lon, lat, 2, 2, 5_000, 0.13, lonStep, latStep), FOREVER);
    assertThat(raster).isNotNull();

    int row = (int) Math.rint(lat / latStep) - raster.j0;
    int observerColumn = (int) Math.rint(lon / lonStep) - raster.i0;
    int firstHidden = -1;
    for (int x = observerColumn + 1; x < raster.width; x++) {
      if (!raster.visible(x, row)) {
        firstHidden = x;
        break;
      }
    }
    assertThat(firstHidden).as("the ground east of the observer is hidden from somewhere").isPositive();
    double hiddenFrom = (raster.i0 + firstHidden) * lonStep;
    double ridgeEnd = ridgeAt + ridgeWidth;
    assertThat(Math.abs(hiddenFrom - ridgeEnd)).as("hidden from the ridge's far foot, within one cell").isLessThanOrEqualTo(1.01 * lonStep);
    for (int x = firstHidden; x < raster.width && (raster.i0 + x) * lonStep < lon + 4_000 / lonMetres * lonStep; x++) {
      assertThat(raster.visible(x, row)).as("column %d behind the ridge", x).isFalse();
    }
    // the same ground without the ridge is seen
    Viewshed.Raster open = Viewshed.sweep((a, b) -> 0.0, params(lon, lat, 2, 2, 5_000, 0.13, lonStep, latStep), FOREVER);
    assertThat(open).isNotNull();
    assertThat(visibleAt(open, raster.i0 + firstHidden + 5, raster.j0 + row)).isTrue();
    // the ground before the ridge is seen, and the ridge's top
    assertThat(raster.visible(observerColumn + 3, row)).isTrue();
  }

  /** A grid of {@code 200 x 100} cells with random hills, smooth with a little noise, at 59 degrees north. */
  private static Grid hills(long seed) {
    Grid grid = new Grid(18_000, 118_000, 201, 101, 0.001, 0.0005);
    Random random = new Random(seed);
    double[][] hills = new double[16][5];
    for (double[] hill : hills) {
      hill[0] = random.nextDouble() * 200;
      hill[1] = random.nextDouble() * 100;
      hill[2] = 3 + random.nextDouble() * 9;
      hill[3] = 10 + random.nextDouble() * 110;
      hill[4] = random.nextDouble() < 0.3 ? -0.5 : 1; // some hollows
    }
    for (int i = 0; i < grid.nx; i++) {
      for (int j = 0; j < grid.ny; j++) {
        double height = 20;
        for (double[] hill : hills) {
          double dx = i - hill[0];
          double dy = j - hill[1];
          height += hill[4] * hill[3] * Math.exp(-(dx * dx + dy * dy) / (2 * hill[2] * hill[2]));
        }
        grid.h[i][j] = height + random.nextGaussian() * 0.3;
      }
    }
    return grid;
  }

  /** The brute-force check: the line from the eye to the target's top over every height sampled each half cell along it, bilinear. */
  private static boolean bruteForce(HeightField field, Viewshed.Params p, double eye, double nodeLon, double nodeLat, double halfCellMetres) {
    double ground = field.height(nodeLon, nodeLat);
    double d = distance(p.lon(), p.lat(), nodeLon, nodeLat);
    if (Double.isNaN(ground)) {
      return false;
    }
    double curvature = (1 - p.refraction()) / (2 * EARTH_RADIUS);
    double topSlope = (ground + p.targetHeight() - d * d * curvature - eye) / d;
    int samples = (int) Math.floor(d / halfCellMetres);
    for (int s = 1; s < samples + 1; s++) {
      double along = s * halfCellMetres;
      if (along >= d) {
        break;
      }
      double t = along / d;
      double h = field.height(p.lon() + (nodeLon - p.lon()) * t, p.lat() + (nodeLat - p.lat()) * t);
      if (Double.isNaN(h)) {
        continue;
      }
      double slope = (h - along * along * curvature - eye) / along;
      if (slope > topSlope) {
        return false;
      }
    }
    return true;
  }

  @Test
  void criterion8TheVisibleCellsEqualABruteForceCheckForAtLeast99PercentOfTheCells() {
    for (long seed : new long[] {42, 7, 2026}) {
      Grid grid = hills(seed);
      double lon = 18.1003; // the grid is 18.0 to 18.2 east, 59.0 to 59.05 north
      double lat = 59.02522;
      Viewshed.Params p = params(lon, lat, 3, 4, 2_400, 0.13, grid.lonStep, grid.latStep);
      Viewshed.Raster raster = Viewshed.sweep(grid, p, FOREVER);
      assertThat(raster).isNotNull();
      double eye = grid.height(lon, lat) + 3;
      double halfCell = 0.5 * Math.min(distance(lon, lat, lon + grid.lonStep, lat), distance(lon, lat, lon, lat + grid.latStep));

      int compared = 0;
      int agreed = 0;
      int visible = 0;
      for (int y = 0; y < raster.height; y++) {
        for (int x = 0; x < raster.width; x++) {
          double nodeLon = (raster.i0 + x) * grid.lonStep;
          double nodeLat = (raster.j0 + y) * grid.latStep;
          double d = distance(lon, lat, nodeLon, nodeLat);
          if (d < 60 || d > 2_300) {
            continue; // the observer's own cell and the rim
          }
          compared++;
          boolean expected = bruteForce(grid, p, eye, nodeLon, nodeLat, halfCell);
          if (expected) {
            visible++;
          }
          if (expected == raster.visible(x, y)) {
            agreed++;
          }
        }
      }
      assertThat(compared).isGreaterThan(4_000);
      assertThat(visible).as("seed %d: a mix of seen and hidden ground", seed).isBetween(compared / 5, compared * 19 / 20);
      assertThat(agreed / (double) compared).as("seed %d: %d of %d cells agree", seed, agreed, compared).isGreaterThanOrEqualTo(0.99);
    }
  }

  @Test
  void criterion13TheGroundWithoutDataIsNotVisibleAndTheResultSaysSo() {
    Grid grid = new Grid(18_000, 118_000, 201, 101, 0.001, 0.0005);
    for (double[] column : grid.h) {
      java.util.Arrays.fill(column, 10);
    }
    // the observer is 800 m from the data's west edge; the range is 2 km, so a part of it has no data
    double lon = 18.0143;
    double lat = 59.02522;
    Viewshed.Params p = params(lon, lat, 2, 2, 2_000, 0.13, grid.lonStep, grid.latStep);
    Viewshed.Raster raster = Viewshed.sweep(grid, p, FOREVER);
    assertThat(raster).isNotNull();
    assertThat(raster.noData).isTrue();
    int visibleWithoutData = 0;
    int visibleWithData = 0;
    for (int y = 0; y < raster.height; y++) {
      for (int x = 0; x < raster.width; x++) {
        double nodeLon = (raster.i0 + x) * grid.lonStep;
        double nodeLat = (raster.j0 + y) * grid.latStep;
        if (raster.visible(x, y)) {
          if (Double.isNaN(grid.height(nodeLon, nodeLat))) {
            visibleWithoutData++;
          } else {
            visibleWithData++;
          }
        }
      }
    }
    assertThat(visibleWithData).isGreaterThan(500);
    assertThat(visibleWithoutData).as("nodes without height data that came out visible").isZero();
    // and a viewshed wholly inside the data says nothing is missing
    Viewshed.Raster inside = Viewshed.sweep(grid, params(18.1003, lat, 2, 2, 1_000, 0.13, grid.lonStep, grid.latStep), FOREVER);
    assertThat(inside).isNotNull();
    assertThat(inside.noData).isFalse();
  }

  @Test
  void anObserverWithoutHeightDataHasNoViewshed() {
    assertThatThrownBy(() -> Viewshed.sweep((a, b) -> Double.NaN, params(18.0686, 59.3293, 2, 2, 1_000, 0.13, 0.001, 0.0005), FOREVER)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aSweepPastItsDeadlineGivesNothing() {
    Viewshed.Raster raster = Viewshed.sweep((a, b) -> 0.0, params(18.0686, 59.3293, 2, 2, 20_000, 0.13, 2.0 / 3600, 1.0 / 3600), System.nanoTime() - 1);
    assertThat(raster).isNull();
  }

  @Test
  void aRangeAcrossTheAntimeridianIsSweptOnBothSides() {
    // observer 3 km west of 180 degrees, on a flat plain: nodes on both sides are seen, and the rings come out wrapped
    double lonStep = 6.0 / 3600;
    double latStep = 3.0 / 3600;
    double lat = -17.3;
    double lon = 179.97;
    Viewshed.Raster raster = Viewshed.sweep((a, b) -> 5.0, params(lon, lat, 2, 2, 8_000, 0.13, lonStep, latStep), FOREVER);
    assertThat(raster).isNotNull();
    int east = 0;
    int past = 0;
    for (int y = 0; y < raster.height; y++) {
      for (int x = 0; x < raster.width; x++) {
        if (raster.visible(x, y)) {
          if ((raster.i0 + x) * lonStep > 180) {
            past++;
          } else {
            east++;
          }
        }
      }
    }
    assertThat(east).isGreaterThan(100);
    assertThat(past).as("nodes beyond 180 degrees, which are at -180 and on").isGreaterThan(100);
  }
}
