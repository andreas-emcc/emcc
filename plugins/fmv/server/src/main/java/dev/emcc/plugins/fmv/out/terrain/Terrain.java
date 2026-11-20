package dev.emcc.plugins.fmv.out.terrain;

import java.util.HashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * The heights a compute task holds: its parsed cells by key. It is the task's own state (brief
 * section 10.3 point 12), never shared; the renderer asks it for heights many times a frame, so it
 * keeps the last cell it used.
 */
public final class Terrain {

  private final Map<CellKey, DtedCell> cells = new HashMap<>();
  private @Nullable DtedCell last;
  private int lastLon = Integer.MIN_VALUE;
  private int lastLat = Integer.MIN_VALUE;

  /** Adds or replaces a cell. */
  public void put(DtedCell cell) {
    cells.put(cell.key(), cell);
    forget();
  }

  /** Removes a cell. */
  public void remove(CellKey key) {
    cells.remove(key);
    forget();
  }

  public boolean has(CellKey key) {
    return cells.containsKey(key);
  }

  public int size() {
    return cells.size();
  }

  private void forget() {
    last = null;
    lastLon = Integer.MIN_VALUE;
    lastLat = Integer.MIN_VALUE;
  }

  /** The height at a point, metres HAE; {@code NaN} where no cell covers it, or next to a void. */
  public double height(double lonDeg, double latDeg) {
    int lon = (int) Math.floor(lonDeg);
    int lat = (int) Math.floor(latDeg);
    if (lon != lastLon || lat != lastLat) {
      lastLon = lon;
      lastLat = lat;
      last = lon >= -180 && lon <= 179 && lat >= -90 && lat <= 89 ? cells.get(new CellKey(lon, lat)) : null;
    }
    DtedCell cell = last;
    return cell == null ? Double.NaN : cell.height(lonDeg, latDeg);
  }
}
