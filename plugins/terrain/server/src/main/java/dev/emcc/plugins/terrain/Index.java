package dev.emcc.plugins.terrain;

import java.util.HashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** The cells found in the folder, each by its checked header (the data is not read yet). One worker owns it. */
final class Index {

  private final Map<Long, DtedCell> cells = new HashMap<>();
  private final Map<Long, String> paths = new HashMap<>();
  private final int[] perLevel = new int[3];
  private int skipped;

  /** Adds a cell found at {@code path} (relative to the folder, as the listing spelled it). */
  void put(DtedCell header, String path) {
    paths.put(header.id().key(), path);
    DtedCell old = cells.put(header.id().key(), header);
    if (old == null) {
      perLevel[header.id().level()]++;
    }
  }

  /** The path a cell was found at. */
  String path(CellId id) {
    String path = paths.get(id.key());
    if (path == null) {
      throw new IllegalArgumentException("not in the index: " + id.displayName());
    }
    return path;
  }

  /** The header of an indexed cell. */
  DtedCell header(CellId id) {
    DtedCell header = cells.get(id.key());
    if (header == null) {
      throw new IllegalArgumentException("not in the index: " + id.displayName());
    }
    return header;
  }

  void remove(CellId id) {
    paths.remove(id.key());
    if (cells.remove(id.key()) != null) {
      perLevel[id.level()]--;
    }
  }

  boolean has(CellId id) {
    return cells.containsKey(id.key());
  }

  /** The header of the cell at {@code level} that covers the position (its whole degrees), or {@code null}. */
  @Nullable DtedCell find(int level, int lonDeg, int latDeg) {
    if (lonDeg < -180 || lonDeg > 179 || latDeg < -90 || latDeg > 89) {
      return null;
    }
    return cells.get(new CellId(level, lonDeg, latDeg).key());
  }

  int count(int level) {
    return perLevel[level];
  }

  int total() {
    return perLevel[0] + perLevel[1] + perLevel[2];
  }

  /** Files that were found but cannot be used. */
  int skipped() {
    return skipped;
  }

  void skip() {
    skipped++;
  }

  /** {@code {west, south, east, north}} in degrees over all cells, or {@code null} for an empty index. */
  double @Nullable [] area() {
    if (cells.isEmpty()) {
      return null;
    }
    double west = 180;
    double south = 90;
    double east = -180;
    double north = -90;
    for (DtedCell c : cells.values()) {
      west = Math.min(west, c.id().lonDeg());
      south = Math.min(south, c.id().latDeg());
      east = Math.max(east, c.id().lonDeg() + 1);
      north = Math.max(north, c.id().latDeg() + 1);
    }
    return new double[] {west, south, east, north};
  }
}
