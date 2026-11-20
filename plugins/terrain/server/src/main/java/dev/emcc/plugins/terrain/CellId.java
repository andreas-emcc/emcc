package dev.emcc.plugins.terrain;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * One DTED cell: a 1 x 1 degree file at a level, named by the whole degrees of its south-west corner
 * (MIL-PRF-89020B): {@code e<lon>/n<lat>.dt<level>} under the folder, {@code w} and {@code s} for
 * west and south, in any case.
 *
 * @param level 0, 1 or 2
 * @param lonDeg the south-west corner's longitude, -180 to 179
 * @param latDeg the south-west corner's latitude, -90 to 89
 */
record CellId(int level, int lonDeg, int latDeg) {

  private static final Pattern DIRECTORY = Pattern.compile("([ew])(\\d{3})", Pattern.CASE_INSENSITIVE);
  private static final Pattern FILE = Pattern.compile("([ns])(\\d{2})\\.dt([012])", Pattern.CASE_INSENSITIVE);

  CellId {
    if (level < 0 || level > 2) {
      throw new IllegalArgumentException("level 0 to 2: " + level);
    }
    if (lonDeg < -180 || lonDeg > 179 || latDeg < -90 || latDeg > 89) {
      throw new IllegalArgumentException("not a cell: lon " + lonDeg + ", lat " + latDeg);
    }
  }

  /** Whether {@code name} names a longitude directory such as {@code e017} or {@code W180}. */
  static boolean isLongitudeDirectory(String name) {
    return longitudeOf(name) != null;
  }

  private static @Nullable Integer longitudeOf(String name) {
    Matcher m = DIRECTORY.matcher(name);
    if (!m.matches()) {
      return null;
    }
    int degrees = Integer.parseInt(m.group(2));
    boolean east = m.group(1).equalsIgnoreCase("e");
    if (east ? degrees > 179 : degrees > 180) {
      return null;
    }
    return east ? degrees : -degrees;
  }

  /** The cell a file in a longitude directory is, or {@code null} when the names are not a DTED cell's. */
  static @Nullable CellId parse(String directory, String file) {
    Integer lon = longitudeOf(directory);
    Matcher m = FILE.matcher(file);
    if (lon == null || !m.matches()) {
      return null;
    }
    int degrees = Integer.parseInt(m.group(2));
    boolean north = m.group(1).equalsIgnoreCase("n");
    if (north ? degrees > 89 : degrees > 90) {
      return null;
    }
    return new CellId(Integer.parseInt(m.group(3)), lon, north ? degrees : -degrees);
  }

  /** The lowest absolute latitude the cell reaches: it decides the cell's latitude zone. */
  int nearestToEquator() {
    return latDeg >= 0 ? latDeg : -latDeg - 1;
  }

  /**
   * The factor from the latitude interval to the longitude interval, by the cell's latitude zone
   * (MIL-PRF-89020B): 1 up to 50 degrees, 2 from 50 to 70, 3 to 75, 4 to 80 and 6 to 90, north or
   * south.
   */
  int zoneFactor() {
    int lat = nearestToEquator();
    if (lat < 50) {
      return 1;
    }
    if (lat < 70) {
      return 2;
    }
    if (lat < 75) {
      return 3;
    }
    return lat < 80 ? 4 : 6;
  }

  /** A key for maps, unique per cell and level. */
  long key() {
    return ((long) level * 400 + (lonDeg + 180)) * 200 + (latDeg + 90);
  }

  /** The relative path as it is conventionally written, for logs: {@code e017/n59.dt2}. */
  String displayName() {
    return String.format(Locale.ROOT, "%s%03d/%s%02d.dt%d", lonDeg >= 0 ? "e" : "w", Math.abs(lonDeg), latDeg >= 0 ? "n" : "s", Math.abs(latDeg), level);
  }
}
