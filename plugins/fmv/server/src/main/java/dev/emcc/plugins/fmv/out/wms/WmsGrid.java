package dev.emcc.plugins.fmv.out.wms;

import dev.emcc.plugins.fmv.out.geo.Sweref99Tm;
import dev.emcc.plugins.fmv.out.imagery.ImagerySet;
import java.math.BigDecimal;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * The WMS tiles' fixed grid (brief section 10.5 point 17): square tiles of {@code tilePixels} at
 * {@code metresPerPixel}, in the WMS's CRS. In EPSG:3006 a tile is {@code tilePixels × metresPerPixel}
 * metres, counted from easting and northing 0. In EPSG:4326 it is that many metres of latitude
 * turned into degrees ({@link #METRES_PER_DEGREE}), the same angle in longitude, counted from 180° W
 * and 90° S. So every column and row is 0 or more, and a tile's document key ({@link #key}) has no
 * sign in it. Coordinates are WGS84 longitude and latitude, or easting and northing, x before y.
 */
public record WmsGrid(ImagerySet.Crs crs, int tilePixels, double metresPerPixel) {

  /** The prefix of every tile's document key: the owner's folder {@code wms_tile_cache} (2026-11-17), with the keys' {@code -}. */
  public static final String PREFIX = "wms-tile-cache.";

  /** Metres of latitude per degree, for EPSG:4326's tile size. */
  public static final double METRES_PER_DEGREE = 111_320;

  /** One tile of the grid: its column, row, document key and extent (its {@code file} is the key). */
  public record Tile(int column, int row, String key, ImagerySet.TileSpec spec) {}

  /** A tile's side in the CRS's units: metres in EPSG:3006, degrees in EPSG:4326. */
  public double size() {
    double metres = tilePixels * metresPerPixel;
    return crs == ImagerySet.Crs.EPSG_3006 ? metres : metres / METRES_PER_DEGREE;
  }

  private double originX() {
    return crs == ImagerySet.Crs.EPSG_3006 ? 0 : -180;
  }

  private double originY() {
    return crs == ImagerySet.Crs.EPSG_3006 ? 0 : -90;
  }

  /** The CRS coordinates {@code {x, y}} of a longitude and latitude. */
  public void project(double lonDeg, double latDeg, double[] out) {
    if (crs == ImagerySet.Crs.EPSG_3006) {
      Sweref99Tm.forward(lonDeg, latDeg, out);
    } else {
      out[0] = lonDeg;
      out[1] = latDeg;
    }
  }

  /** The longitude and latitude {@code {lon, lat}} of CRS coordinates. */
  public void unproject(double x, double y, double[] out) {
    if (crs == ImagerySet.Crs.EPSG_3006) {
      Sweref99Tm.inverse(x, y, out);
    } else {
      out[0] = x;
      out[1] = y;
    }
  }

  /** The column of a CRS x. */
  public int column(double x) {
    return (int) Math.floor((x - originX()) / size());
  }

  /** The row of a CRS y. */
  public int row(double y) {
    return (int) Math.floor((y - originY()) / size());
  }

  /** The tile at a column and row; both must be 0 or more. */
  public Tile tile(int column, int row) {
    if (column < 0 || row < 0) {
      throw new IllegalArgumentException("outside the grid: " + column + ", " + row);
    }
    double s = size();
    String key = key(column, row);
    ImagerySet.TileSpec spec = new ImagerySet.TileSpec(key, originX() + column * s, originY() + row * s, originX() + (column + 1) * s,
        originY() + (row + 1) * s, tilePixels, tilePixels);
    return new Tile(column, row, key, spec);
  }

  /**
   * A tile's document key: {@code wms-tile-cache.<crs number>-<metres per pixel>-<column>-<row>},
   * e.g. {@code wms-tile-cache.3006-1.0-1234-5678} (section 10.5 point 17).
   */
  public String key(int column, int row) {
    return PREFIX + crs.code() + "-" + metresPerPixel + "-" + column + "-" + row;
  }

  /**
   * The WMS 1.3.0 GetMap request of a tile. Both CRSs put y first in {@code BBOX}: EPSG:4326 is
   * latitude, longitude and EPSG:3006 northing, easting in 1.3.0's axis order.
   *
   * @param url the server's address without parameters (the admin's; never from a pose or a request)
   */
  public URI getMap(String url, String layer, String format, Tile tile) {
    ImagerySet.TileSpec s = tile.spec();
    String bbox = text(s.minY()) + "," + text(s.minX()) + "," + text(s.maxY()) + "," + text(s.maxX());
    return URI.create(url + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=" + encode(layer) + "&STYLES=&CRS=" + crs.text() + "&BBOX=" + bbox
        + "&WIDTH=" + tilePixels + "&HEIGHT=" + tilePixels + "&FORMAT=" + encode(format));
  }

  private static String text(double v) {
    return BigDecimal.valueOf(v).stripTrailingZeros().toPlainString();
  }

  private static String encode(String s) {
    return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20");
  }
}
