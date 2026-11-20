package dev.emcc.plugins.terrain;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** A {@link HeightField} over DTED cells of one level, each read at its own spacing. Not for several threads: it remembers the last cell. */
final class CellField implements HeightField {

  private final Map<Long, DtedCell> cells = new HashMap<>();
  private final int level;
  private @Nullable DtedCell last;

  CellField(List<DtedCell> cells) {
    int ofLevel = 0;
    for (DtedCell cell : cells) {
      this.cells.put(cell.id().key(), cell);
      ofLevel = cell.id().level();
    }
    this.level = ofLevel;
  }

  @Override
  public double height(double lon, double lat) {
    double wrapped = lon;
    while (wrapped >= 180) {
      wrapped -= 360;
    }
    while (wrapped < -180) {
      wrapped += 360;
    }
    int lonDeg = (int) Math.floor(wrapped);
    int latDeg = (int) Math.floor(lat);
    DtedCell cell = find(lonDeg, latDeg);
    if (cell == null && wrapped == lonDeg) {
      // exactly on a cell's western edge: the neighbour's eastern edge holds the same samples
      cell = find(lonDeg == -180 ? 179 : lonDeg - 1, latDeg);
      if (cell != null) {
        wrapped = (cell.id().lonDeg() + 1.0);
        lonDeg = cell.id().lonDeg();
      }
    }
    if (cell == null && lat == latDeg) {
      cell = find(lonDeg, latDeg - 1);
      if (cell != null) {
        latDeg = cell.id().latDeg();
        lat = latDeg + 1.0;
      }
    }
    if (cell == null) {
      return Double.NaN;
    }
    return sample(cell, wrapped - cell.id().lonDeg(), lat - cell.id().latDeg());
  }

  private @Nullable DtedCell find(int lonDeg, int latDeg) {
    DtedCell remembered = last;
    if (remembered != null && remembered.id().lonDeg() == lonDeg && remembered.id().latDeg() == latDeg) {
      return remembered;
    }
    if (lonDeg < -180 || lonDeg > 179 || latDeg < -90 || latDeg > 89) {
      return null;
    }
    DtedCell found = cells.get(new CellId(level, lonDeg, latDeg).key());
    if (found != null) {
      last = found;
    }
    return found;
  }

  /** Bilinear at {@code (fx, fy)}, the position in degrees from the cell's south-west corner. */
  private static double sample(DtedCell cell, double fx, double fy) {
    double u = fx * (cell.lonCount() - 1);
    double v = fy * (cell.latCount() - 1);
    int c = Math.min((int) u, cell.lonCount() - 2);
    int r = Math.min((int) v, cell.latCount() - 2);
    double tx = u - c;
    double ty = v - r;
    int h00 = cell.raw(c, r);
    int h10 = cell.raw(c + 1, r);
    int h01 = cell.raw(c, r + 1);
    int h11 = cell.raw(c + 1, r + 1);
    if (h00 == DtedCell.VOID || h10 == DtedCell.VOID || h01 == DtedCell.VOID || h11 == DtedCell.VOID) {
      return Double.NaN;
    }
    double south = h00 + (h10 - h00) * tx;
    double north = h01 + (h11 - h01) * tx;
    return south + (north - south) * ty;
  }
}
