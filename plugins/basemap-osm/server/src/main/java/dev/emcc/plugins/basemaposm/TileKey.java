package dev.emcc.plugins.basemaposm;

import org.jspecify.annotations.Nullable;

/**
 * A tile in the XYZ scheme (zoom, column, row; row 0 at the top), as in OpenStreetMap URLs.
 *
 * @param z zoom level
 * @param x column, 0 to 2^z - 1
 * @param y row, 0 to 2^z - 1
 */
record TileKey(int z, int x, int y) {

  /**
   * Checks the path parameters of a tile request: ASCII digits only, bounded length, z in
   * 0..maxZoom and x, y in 0..2^z - 1. Returns {@code null} for anything else, so an invalid
   * request never reaches the upstream.
   */
  static @Nullable TileKey parse(@Nullable String z, @Nullable String x, @Nullable String y, int maxZoom) {
    Integer zoom = number(z, 2);
    if (zoom == null || zoom > maxZoom) {
      return null;
    }
    int limit = 1 << zoom;
    Integer column = number(x, 8);
    Integer row = number(y, 8);
    if (column == null || row == null || column >= limit || row >= limit) {
      return null;
    }
    return new TileKey(zoom, column, row);
  }

  private static @Nullable Integer number(@Nullable String text, int maxDigits) {
    if (text == null || text.isEmpty() || text.length() > maxDigits) {
      return null;
    }
    int value = 0;
    for (int i = 0; i < text.length(); i++) {
      char c = text.charAt(i);
      if (c < '0' || c > '9') {
        return null;
      }
      value = value * 10 + (c - '0');
    }
    return value;
  }
}
