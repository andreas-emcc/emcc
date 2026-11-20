package dev.emcc.plugins.fmv.out.wms;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.fmv.out.imagery.ImagerySet;
import java.util.List;
import org.junit.jupiter.api.Test;

/** One link's WMS tiles: the 2 km round where the camera looks, nearest first, again after 500 m (owner, 2026-11-17). */
class WmsViewTest {

  private static final double LON = 17.3;
  private static final double LAT = 62.4;

  @Test
  void criterion33TheRoundIsTwoKilometresNearestFirst() {
    WmsGrid grid = new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 1);
    WmsView view = new WmsView(grid);
    WmsView.Plan plan = view.aim(LON, LAT, null, Long.MAX_VALUE);
    assertThat(plan.drop()).isEmpty();
    // about π × 2 km² over 256 m tiles, with the tiles the round's edge cuts
    assertThat(plan.add().size()).isBetween(190, 260);
    double[] xy = new double[2];
    grid.project(LON, LAT, xy);
    ImagerySet.TileSpec first = plan.add().get(0).spec();
    assertThat(xy[0]).isBetween(first.minX(), first.maxX());
    assertThat(xy[1]).isBetween(first.minY(), first.maxY());
    double last = -1;
    for (WmsGrid.Tile t : plan.add()) {
      double d = distance(t.spec(), xy);
      assertThat(d).isLessThanOrEqualTo(WmsView.RADIUS_METRES).isGreaterThanOrEqualTo(last);
      last = d;
    }
  }

  @Test
  void inDegreesTheRoundIsStillTwoKilometresEastAndWest() {
    WmsGrid grid = new WmsGrid(ImagerySet.Crs.EPSG_4326, 256, 1);
    WmsView.Plan plan = new WmsView(grid).aim(LON, LAT, null, Long.MAX_VALUE);
    double west = plan.add().stream().mapToDouble(t -> t.spec().minX()).min().orElseThrow();
    double east = plan.add().stream().mapToDouble(t -> t.spec().maxX()).max().orElseThrow();
    double metres = (east - west) * 111_320 * Math.cos(Math.toRadians(LAT));
    assertThat(metres).isBetween(4_000.0, 4_000.0 + 2 * 256 * 1.1);
  }

  @Test
  void itPlansAgainOnlyAfter500MetresAndDropsTheTilesLeftBehind() {
    WmsView view = new WmsView(new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 1));
    assertThat(view.shouldAim(LON, LAT)).isTrue();
    List<WmsGrid.Tile> first = view.aim(LON, LAT, null, Long.MAX_VALUE).add();
    double north300 = LAT + 300 / 111_200.0;
    double north3000 = LAT + 3000 / 111_200.0;
    assertThat(view.shouldAim(LON, north300)).isFalse();
    assertThat(view.shouldAim(LON, north3000)).isTrue();
    WmsView.Plan moved = view.aim(LON, north3000, null, Long.MAX_VALUE);
    assertThat(moved.drop()).isNotEmpty().allSatisfy(t -> assertThat(first).contains(t));
    assertThat(moved.add()).isNotEmpty().noneSatisfy(t -> assertThat(first).contains(t));
    assertThat(view.wanted()).hasSize(first.size() - moved.drop().size() + moved.add().size());
    int wanted = view.wanted().size();
    assertThat(view.clear()).hasSize(wanted);
    assertThat(view.wanted()).isEmpty();
    assertThat(view.shouldAim(LON, north3000)).isTrue();
  }

  @Test
  void tilesTheImagerySetCoversAreNotWanted() {
    WmsGrid grid = new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 1);
    int all = new WmsView(grid).aim(LON, LAT, null, Long.MAX_VALUE).add().size();
    // a set in degrees over everything east of the centre
    ImagerySet east = set(LON, LAT - 0.1, LON + 0.2, LAT + 0.1);
    List<WmsGrid.Tile> some = new WmsView(grid).aim(LON, LAT, east, Long.MAX_VALUE).add();
    assertThat(some.size()).isBetween(all / 2 - 20, all / 2 + 30);
    double[] geo = new double[2];
    for (WmsGrid.Tile t : some) {
      grid.unproject(t.spec().minX(), (t.spec().minY() + t.spec().maxY()) / 2, geo);
      assertThat(geo[0]).isLessThan(LON); // each lies at least partly west of the set
    }
    ImagerySet everything = set(LON - 0.2, LAT - 0.1, LON + 0.2, LAT + 0.1);
    assertThat(new WmsView(grid).aim(LON, LAT, everything, Long.MAX_VALUE).add()).isEmpty();
  }

  @Test
  void theBudgetKeepsTheNearestTilesAndCountsTheRest() {
    WmsGrid grid = new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 1);
    List<WmsGrid.Tile> all = new WmsView(grid).aim(LON, LAT, null, Long.MAX_VALUE).add();
    WmsView view = new WmsView(grid);
    List<WmsGrid.Tile> ten = view.aim(LON, LAT, null, 10L * 256 * 256).add();
    assertThat(ten).containsExactlyElementsOf(all.subList(0, 10));
    assertThat(view.overCap()).isEqualTo(all.size() - 10);
  }

  private static ImagerySet set(double west, double south, double east, double north) {
    return new ImagerySet("east", "East", "emcc tests", "CC0-1.0", ImagerySet.Crs.EPSG_4326,
        List.of(new ImagerySet.TileSpec("t.png", west, south, east, north, 1000, 1000)));
  }

  private static double distance(ImagerySet.TileSpec s, double[] xy) {
    double dx = Math.max(0, Math.max(s.minX() - xy[0], xy[0] - s.maxX()));
    double dy = Math.max(0, Math.max(s.minY() - xy[1], xy[1] - s.maxY()));
    return Math.hypot(dx, dy);
  }
}
