package dev.emcc.plugins.fmv.out.imagery;

import dev.emcc.plugins.fmv.out.geo.Sweref99Tm;
import java.util.ArrayList;
import java.util.List;

/**
 * The decoded tiles of one imagery set, as a compute task holds them (its own state, brief section
 * 10.3 point 12), and their sampling: {@code bilinear} or {@code nearest} (section 10.5 point 15).
 * Tiles are found through a grid of buckets over the set's extent, and the last tile used is tried
 * first, since neighbouring pixels nearly always fall in the same tile.
 */
public final class Imagery {

  /** Luma where no tile covers a point: {@code #808080} (section 10.5 point 15). */
  public static final int GREY_LUMA = TilePicture.lumaOfGrey(128);

  /** Chroma of every grey. */
  public static final int NEUTRAL_CHROMA = 128;

  private final ImagerySet set;
  private final List<ImagerySet.TileSpec> specs = new ArrayList<>();
  private final List<TilePicture> pictures = new ArrayList<>();
  private double minX = Double.POSITIVE_INFINITY;
  private double minY = Double.POSITIVE_INFINITY;
  private double maxX = Double.NEGATIVE_INFINITY;
  private double maxY = Double.NEGATIVE_INFINITY;
  private int bucketsX;
  private int bucketsY;
  private int[][] buckets = new int[0][];
  private int last = -1;
  private boolean colour;

  // the sample of the last call: its luma, chroma, and whether a tile covered it
  private int lumaOut;
  private int cbOut;
  private int crOut;

  public Imagery(ImagerySet set) {
    this.set = set;
  }

  public ImagerySet set() {
    return set;
  }

  /** The number of tiles decoded so far. */
  public int tiles() {
    return pictures.size();
  }

  /** Whether any tile has colour; without, the renderer leaves the chroma neutral and samples none. */
  public boolean colour() {
    return colour;
  }

  /** Adds one decoded tile of the set. */
  public void add(ImagerySet.TileSpec spec, TilePicture picture) {
    specs.add(spec);
    pictures.add(picture);
    colour |= picture.colour();
    minX = Math.min(minX, spec.minX());
    minY = Math.min(minY, spec.minY());
    maxX = Math.max(maxX, spec.maxX());
    maxY = Math.max(maxY, spec.maxY());
    index();
  }

  /** Removes a tile (the camera has left it); nothing when it is not there. */
  public void remove(ImagerySet.TileSpec spec) {
    int at = specs.indexOf(spec);
    if (at < 0) {
      return;
    }
    specs.remove(at);
    pictures.remove(at);
    minX = Double.POSITIVE_INFINITY;
    minY = Double.POSITIVE_INFINITY;
    maxX = Double.NEGATIVE_INFINITY;
    maxY = Double.NEGATIVE_INFINITY;
    colour = false;
    for (int t = 0; t < specs.size(); t++) {
      ImagerySet.TileSpec s = specs.get(t);
      minX = Math.min(minX, s.minX());
      minY = Math.min(minY, s.minY());
      maxX = Math.max(maxX, s.maxX());
      maxY = Math.max(maxY, s.maxY());
      colour |= pictures.get(t).colour();
    }
    index();
  }

  /** The luma pixels of the decoded tiles. */
  public long pixels() {
    long n = 0;
    for (TilePicture p : pictures) {
      n += (long) p.width() * p.height();
    }
    return n;
  }

  private void index() {
    int n = specs.size();
    int side = Math.max(1, Math.min(256, (int) Math.ceil(Math.sqrt(n) * 2)));
    bucketsX = side;
    bucketsY = side;
    List<List<Integer>> lists = new ArrayList<>();
    for (int i = 0; i < side * side; i++) {
      lists.add(new ArrayList<>());
    }
    for (int t = 0; t < n; t++) {
      ImagerySet.TileSpec s = specs.get(t);
      int x0 = bucketX(s.minX());
      int x1 = bucketX(s.maxX());
      int y0 = bucketY(s.minY());
      int y1 = bucketY(s.maxY());
      for (int by = y0; by <= y1; by++) {
        for (int bx = x0; bx <= x1; bx++) {
          lists.get(by * bucketsX + bx).add(t);
        }
      }
    }
    buckets = new int[side * side][];
    for (int i = 0; i < buckets.length; i++) {
      buckets[i] = lists.get(i).stream().mapToInt(Integer::intValue).toArray();
    }
    last = -1;
  }

  private int bucketX(double x) {
    return Math.max(0, Math.min(bucketsX - 1, (int) ((x - minX) / (maxX - minX) * bucketsX)));
  }

  private int bucketY(double y) {
    return Math.max(0, Math.min(bucketsY - 1, (int) ((y - minY) / (maxY - minY) * bucketsY)));
  }

  /** Writes the set's CRS coordinates {@code {x, y}} of a longitude and latitude into {@code out}. */
  public void project(double lonDeg, double latDeg, double[] out) {
    if (set.crs() == ImagerySet.Crs.EPSG_3006) {
      Sweref99Tm.forward(lonDeg, latDeg, out);
    } else {
      out[0] = lonDeg;
      out[1] = latDeg;
    }
  }

  /** The tile that covers CRS coordinates, or −1. */
  public int tileAt(double x, double y) {
    if (last >= 0 && inside(specs.get(last), x, y)) {
      return last;
    }
    if (specs.isEmpty() || x < minX || x > maxX || y < minY || y > maxY) {
      return -1;
    }
    for (int t : buckets[bucketY(y) * bucketsX + bucketX(x)]) {
      if (inside(specs.get(t), x, y)) {
        last = t;
        return t;
      }
    }
    return -1;
  }

  private static boolean inside(ImagerySet.TileSpec s, double x, double y) {
    return x >= s.minX() && x <= s.maxX() && y >= s.minY() && y <= s.maxY();
  }

  /**
   * Samples the luma at CRS coordinates; {@code false} where no tile covers them (then {@link
   * #luma()} is grey). With {@code chroma} it samples Cb and Cr too.
   */
  public boolean sample(double x, double y, boolean bilinear, boolean chroma) {
    int t = tileAt(x, y);
    if (t < 0) {
      lumaOut = GREY_LUMA;
      cbOut = NEUTRAL_CHROMA;
      crOut = NEUTRAL_CHROMA;
      return false;
    }
    ImagerySet.TileSpec s = specs.get(t);
    TilePicture p = pictures.get(t);
    int w = p.width();
    int h = p.height();
    double col = (x - s.minX()) / (s.maxX() - s.minX()) * w - 0.5;
    double row = (s.maxY() - y) / (s.maxY() - s.minY()) * h - 0.5;
    lumaOut = plane(p.luma(), w, h, col, row, bilinear);
    byte[] cb = p.cb();
    byte[] cr = p.cr();
    if (chroma && cb != null && cr != null) {
      int cw = (w + 1) / 2;
      int ch = (h + 1) / 2;
      double ccol = (col + 0.5) / 2 - 0.5;
      double crow = (row + 0.5) / 2 - 0.5;
      cbOut = plane(cb, cw, ch, ccol, crow, bilinear);
      crOut = plane(cr, cw, ch, ccol, crow, bilinear);
    } else {
      cbOut = NEUTRAL_CHROMA;
      crOut = NEUTRAL_CHROMA;
    }
    return true;
  }

  /** A CRS x as a column of a tile's luma, pixel centres at whole numbers (−0.5 is the tile's west edge). */
  public double column(int tile, double x) {
    ImagerySet.TileSpec s = specs.get(tile);
    return (x - s.minX()) / (s.maxX() - s.minX()) * pictures.get(tile).width() - 0.5;
  }

  /** A CRS y as a row of a tile's luma, pixel centres at whole numbers (−0.5 is the tile's north edge). */
  public double row(int tile, double y) {
    ImagerySet.TileSpec s = specs.get(tile);
    return (s.maxY() - y) / (s.maxY() - s.minY()) * pictures.get(tile).height() - 0.5;
  }

  /**
   * The luma of a tile at a column and row ({@link #column}, {@link #row}), clamped to the tile: the
   * renderer's fast path, when a whole block of pixels lies in one tile.
   */
  public int lumaAt(int tile, double col, double row, boolean bilinear) {
    TilePicture p = pictures.get(tile);
    return plane(p.luma(), p.width(), p.height(), col, row, bilinear);
  }

  /** Samples the chroma of a tile at a luma column and row into {@link #cb()} and {@link #cr()}; neutral without colour. */
  public void chromaAt(int tile, double col, double row, boolean bilinear) {
    TilePicture p = pictures.get(tile);
    byte[] cb = p.cb();
    byte[] cr = p.cr();
    if (cb == null || cr == null) {
      cbOut = NEUTRAL_CHROMA;
      crOut = NEUTRAL_CHROMA;
      return;
    }
    int cw = (p.width() + 1) / 2;
    int ch = (p.height() + 1) / 2;
    double ccol = (col + 0.5) / 2 - 0.5;
    double crow = (row + 0.5) / 2 - 0.5;
    cbOut = plane(cb, cw, ch, ccol, crow, bilinear);
    crOut = plane(cr, cw, ch, ccol, crow, bilinear);
  }

  public int luma() {
    return lumaOut;
  }

  public int cb() {
    return cbOut;
  }

  public int cr() {
    return crOut;
  }

  /** A plane's value at a column and row, clamped to the plane; bilinear in 8-bit fixed point, or nearest. */
  private static int plane(byte[] v, int w, int h, double col, double row, boolean bilinear) {
    double c = col < 0 ? 0 : col > w - 1 ? w - 1 : col;
    double r = row < 0 ? 0 : row > h - 1 ? h - 1 : row;
    if (!bilinear) {
      return v[(int) (r + 0.5) * w + (int) (c + 0.5)] & 0xFF;
    }
    int i = (int) c;
    int j = (int) r;
    int fx = (int) ((c - i) * 256);
    int fy = (int) ((r - j) * 256);
    int at = j * w + i;
    int right = i + 1 < w ? 1 : 0;
    int below = j + 1 < h ? w : 0;
    int top = (v[at] & 0xFF) * (256 - fx) + (v[at + right] & 0xFF) * fx;
    int bottom = (v[at + below] & 0xFF) * (256 - fx) + (v[at + below + right] & 0xFF) * fx;
    return (top * (256 - fy) + bottom * fy + 32768) >> 16;
  }
}
