package dev.emcc.plugins.fmv.out.terrain;

import java.util.Locale;

/**
 * One 1° × 1° DTED cell by its south-west corner, and its files' paths in the terrain folder:
 * {@code e<lon>/n<lat>.dt<level>} (MIL-PRF-89020B's layout; {@code w} and {@code s} west and south),
 * as the {@code terrain} plugin reads the same folder.
 *
 * @param lon the corner's longitude, −180 to 179
 * @param lat the corner's latitude, −90 to 89
 */
public record CellKey(int lon, int lat) {

  public CellKey {
    if (lon < -180 || lon > 179 || lat < -90 || lat > 89) {
      throw new IllegalArgumentException("no DTED cell at " + lon + ", " + lat);
    }
  }

  /** The cell that holds a point; a point on a cell's east or north edge is in the next cell. */
  public static CellKey containing(double lonDeg, double latDeg) {
    int lon = (int) Math.floor(lonDeg);
    int lat = (int) Math.floor(latDeg);
    return new CellKey(lon == 180 ? -180 : lon, Math.min(lat, 89));
  }

  /** The longitude column's directory, e.g. {@code e017}. */
  public String directory() {
    return String.format(Locale.ROOT, "%s%03d", lon >= 0 ? "e" : "w", Math.abs(lon));
  }

  /** The file's name without its level, e.g. {@code n62}. */
  public String stem() {
    return String.format(Locale.ROOT, "%s%02d", lat >= 0 ? "n" : "s", Math.abs(lat));
  }

  /** The relative path of the cell's file of a level, e.g. {@code e017/n62.dt2}. */
  public String path(int level) {
    return directory() + "/" + stem() + ".dt" + level;
  }
}
