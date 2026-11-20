package dev.emcc.plugins.fmv.out.wms;

import dev.emcc.plugins.fmv.out.geo.Sweref99Tm;
import dev.emcc.plugins.fmv.out.imagery.ImagerySet;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * One output link's WMS tiles (brief section 10.5 point 17; the owner's 2026-11-17 answer): the
 * grid tiles within {@link #RADIUS_METRES} of where the camera looks, nearest first, that the
 * link's imagery set does not cover, within a budget of pixels; planned again when that point has
 * moved {@link #MOVE_METRES}. Pure: the worker fetches what {@link #aim} adds and drops what it drops.
 */
public final class WmsView {

  /** The round of WMS tiles round the view's centre (owner, 2026-11-17). */
  public static final double RADIUS_METRES = 2_000;

  /** How far the view's centre moves before the round is planned again (owner, 2026-11-17). */
  public static final double MOVE_METRES = 500;

  /** What one plan adds and drops: the added tiles nearest first. */
  public record Plan(List<WmsGrid.Tile> add, List<WmsGrid.Tile> drop) {}

  private final WmsGrid grid;
  private final Map<String, WmsGrid.Tile> wanted = new LinkedHashMap<>();
  private double aimLon = Double.NaN;
  private double aimLat = Double.NaN;
  private int overCap;

  public WmsView(WmsGrid grid) {
    this.grid = grid;
  }

  public WmsGrid grid() {
    return grid;
  }

  /** Whether the view's centre has moved far enough to plan again, or nothing is planned yet. */
  public boolean shouldAim(double lonDeg, double latDeg) {
    return Double.isNaN(aimLon) || distance(aimLon, aimLat, lonDeg, latDeg) >= MOVE_METRES;
  }

  /** Whether the link wants a tile now. */
  public boolean wants(String key) {
    return wanted.containsKey(key);
  }

  /** The tiles the link wants now. */
  public Collection<WmsGrid.Tile> wanted() {
    return List.copyOf(wanted.values());
  }

  /** The tiles of the last plan that the budget left out. */
  public int overCap() {
    return overCap;
  }

  /**
   * Plans the round about a view's centre.
   *
   * @param folder the link's imagery set, whose tiles need no WMS tile, or {@code null}
   * @param budgetPixels the most luma pixels the WMS tiles may take
   */
  public Plan aim(double lonDeg, double latDeg, @Nullable ImagerySet folder, long budgetPixels) {
    aimLon = lonDeg;
    aimLat = latDeg;
    double[] xy = new double[2];
    grid.project(lonDeg, latDeg, xy);
    boolean metres = grid.crs() == ImagerySet.Crs.EPSG_3006;
    double rx = metres ? RADIUS_METRES : RADIUS_METRES / (WmsGrid.METRES_PER_DEGREE * Math.max(0.01, Math.cos(Math.toRadians(latDeg))));
    double ry = metres ? RADIUS_METRES : RADIUS_METRES / WmsGrid.METRES_PER_DEGREE;
    Coverage coverage = new Coverage(folder, lonDeg, latDeg);
    record Near(WmsGrid.Tile tile, double d) {}
    List<Near> near = new ArrayList<>();
    for (int r = Math.max(0, grid.row(xy[1] - ry)); r <= grid.row(xy[1] + ry); r++) {
      for (int c = Math.max(0, grid.column(xy[0] - rx)); c <= grid.column(xy[0] + rx); c++) {
        WmsGrid.Tile t = grid.tile(c, r);
        ImagerySet.TileSpec s = t.spec();
        double dx = Math.max(0, Math.max(s.minX() - xy[0], xy[0] - s.maxX())) / rx;
        double dy = Math.max(0, Math.max(s.minY() - xy[1], xy[1] - s.maxY())) / ry;
        double d = Math.hypot(dx, dy);
        if (d <= 1 && !coverage.coversTile(s)) {
          near.add(new Near(t, d));
        }
      }
    }
    near.sort(Comparator.comparingDouble(Near::d).thenComparing(n -> n.tile().key()));
    long each = (long) grid.tilePixels() * grid.tilePixels();
    Map<String, WmsGrid.Tile> now = new LinkedHashMap<>();
    long pixels = 0;
    overCap = 0;
    for (Near n : near) {
      if (pixels + each > budgetPixels) {
        overCap++;
        continue;
      }
      pixels += each;
      now.put(n.tile().key(), n.tile());
    }
    List<WmsGrid.Tile> drop = new ArrayList<>();
    for (var it = wanted.entrySet().iterator(); it.hasNext(); ) {
      var e = it.next();
      if (!now.containsKey(e.getKey())) {
        drop.add(e.getValue());
        it.remove();
      }
    }
    List<WmsGrid.Tile> add = new ArrayList<>();
    for (WmsGrid.Tile t : now.values()) {
      if (wanted.putIfAbsent(t.key(), t) == null) {
        add.add(t);
      }
    }
    return new Plan(add, drop);
  }

  /** Drops every tile: the view ends or its grid changed. */
  public List<WmsGrid.Tile> clear() {
    List<WmsGrid.Tile> all = List.copyOf(wanted.values());
    wanted.clear();
    aimLon = Double.NaN;
    aimLat = Double.NaN;
    return all;
  }

  /** Whether the imagery set covers a WMS tile: its corners and centre all lie in the set's tiles. */
  private final class Coverage {
    private final @Nullable ImagerySet set;
    private final List<ImagerySet.TileSpec> near = new ArrayList<>();
    private final double[] geo = new double[2];
    private final double[] xy = new double[2];

    Coverage(@Nullable ImagerySet set, double lonDeg, double latDeg) {
      this.set = set;
      if (set == null) {
        return;
      }
      // the set's tiles near the round only, found through the round's box in the set's CRS
      double dLat = 1.5 * RADIUS_METRES / 110_574;
      double dLon = 1.5 * RADIUS_METRES / (111_320 * Math.max(0.01, Math.cos(Math.toRadians(latDeg))));
      double minX = Double.POSITIVE_INFINITY;
      double minY = Double.POSITIVE_INFINITY;
      double maxX = Double.NEGATIVE_INFINITY;
      double maxY = Double.NEGATIVE_INFINITY;
      for (double[] p : new double[][] {{lonDeg - dLon, latDeg - dLat}, {lonDeg + dLon, latDeg - dLat}, {lonDeg - dLon, latDeg + dLat}, {lonDeg + dLon, latDeg + dLat}}) {
        toSet(set, p[0], p[1], xy);
        minX = Math.min(minX, xy[0]);
        minY = Math.min(minY, xy[1]);
        maxX = Math.max(maxX, xy[0]);
        maxY = Math.max(maxY, xy[1]);
      }
      for (ImagerySet.TileSpec t : set.tiles()) {
        if (t.maxX() >= minX && t.minX() <= maxX && t.maxY() >= minY && t.minY() <= maxY) {
          near.add(t);
        }
      }
    }

    boolean coversTile(ImagerySet.TileSpec s) {
      if (set == null || near.isEmpty()) {
        return false;
      }
      double cx = (s.minX() + s.maxX()) / 2;
      double cy = (s.minY() + s.maxY()) / 2;
      return covers(s.minX(), s.minY()) && covers(s.maxX(), s.minY()) && covers(s.minX(), s.maxY()) && covers(s.maxX(), s.maxY()) && covers(cx, cy);
    }

    private boolean covers(double gridX, double gridY) {
      grid.unproject(gridX, gridY, geo);
      toSet(java.util.Objects.requireNonNull(set), geo[0], geo[1], xy);
      for (ImagerySet.TileSpec t : near) {
        if (xy[0] >= t.minX() && xy[0] <= t.maxX() && xy[1] >= t.minY() && xy[1] <= t.maxY()) {
          return true;
        }
      }
      return false;
    }
  }

  private static void toSet(ImagerySet set, double lonDeg, double latDeg, double[] out) {
    if (set.crs() == ImagerySet.Crs.EPSG_3006) {
      Sweref99Tm.forward(lonDeg, latDeg, out);
    } else {
      out[0] = lonDeg;
      out[1] = latDeg;
    }
  }

  private static double distance(double lon1, double lat1, double lon2, double lat2) {
    double x = Math.toRadians(lon2 - lon1) * Math.cos(Math.toRadians((lat1 + lat2) / 2));
    double y = Math.toRadians(lat2 - lat1);
    return Math.hypot(x, y) * 6_371_009;
  }
}
