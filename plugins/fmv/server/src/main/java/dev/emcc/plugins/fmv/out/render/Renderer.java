package dev.emcc.plugins.fmv.out.render;

import dev.emcc.plugins.fmv.out.Pose;
import dev.emcc.plugins.fmv.out.geo.LocalFrame;
import dev.emcc.plugins.fmv.out.imagery.Imagery;
import dev.emcc.plugins.fmv.out.terrain.Terrain;
import org.jspecify.annotations.Nullable;

/**
 * Renders a pose into one I420 picture (brief section 10.5 point 15), after spike S10's {@code
 * RenderBench.java}:
 *
 * <ol>
 *   <li>rays through a grid of every 8th pixel, edge to edge, meet the terrain by a fixed-point
 *       search on the distance along each ray (bilinear heights; the Earth's curvature kept, A3);
 *   <li>each ground point is projected into the imagery set's CRS, and into the WMS tiles' (F2);
 *   <li>every pixel interpolates its CRS coordinates and distance from the grid round it and is
 *       sampled from the imagery, {@code bilinear} or {@code nearest}: the set's where it has a
 *       tile, else the WMS tiles' (brief section 10.5 point 17); the chroma once per 2 × 2 block, at
 *       its centre;
 *   <li>haze grows with distance (25 km to its most, 60 %, as S10's), and the sky lies above the
 *       horizon (a pixel whose grid round it is not all ground).
 * </ol>
 *
 * No occlusion test, a static scene (ADR-0058 point 5). Where no imagery covers a ground point it is
 * grey ({@code #808080}) and counted; where no height data covers it the ground is the {@link
 * GroundFallback}'s. One instance per frame size, owned by one compute task: it keeps its grids and
 * reuses them every frame.
 */
public final class Renderer {

  /** The grid's step, pixels. Every frame size of section 10.1 divides by it. */
  public static final int STEP = 8;

  /** The distance at which the haze is at its most, metres. */
  public static final double HAZE_METRES = 25_000;

  /** The haze's most. */
  public static final double HAZE_MAX = 0.6;

  /** Beyond this a ray is sky, metres. */
  public static final double MAX_RANGE = 150_000;

  /** The sky, RGB 170, 190, 210 as S10's, in BT.709 limited range. */
  static final int SKY_Y = luma(170, 190, 210);
  static final int SKY_CB = cb(170, 190, 210);
  static final int SKY_CR = cr(170, 190, 210);

  private static final int SEARCH_STEPS = 8;

  /** How a link draws (section 10.2 point 4: {@code sampling}, {@code haze}). */
  public record Options(boolean bilinear, boolean haze) {}

  private final int width;
  private final int height;
  private final int gw;
  private final int gh;
  private final double[] gx;
  private final double[] gy;
  private final double[] wx;
  private final double[] wy;
  private final float[] gd;
  private final boolean[] down;
  private final float[] colF;
  private final float[] rowF;
  private final float[] ccolF;
  private final float[] crowF;

  /**
   * @param width the frame's width, a multiple of {@link #STEP} and of 2
   * @param height the frame's height, a multiple of {@link #STEP} and of 2
   */
  public Renderer(int width, int height) {
    if (width < STEP || height < STEP || width % STEP != 0 || height % STEP != 0) {
      throw new IllegalArgumentException("a frame's sides are multiples of " + STEP + ": " + width + " × " + height);
    }
    this.width = width;
    this.height = height;
    gw = width / STEP + 1;
    gh = height / STEP + 1;
    gx = new double[gw * gh];
    gy = new double[gw * gh];
    wx = new double[gw * gh];
    wy = new double[gw * gh];
    gd = new float[gw * gh];
    down = new boolean[gw * gh];
    // where each pixel's centre lies in its grid cell (pixel x is in cell x / STEP), and each chroma
    // sample's (the centre of its 2 × 2 pixels; sample x is in cell 2x / STEP)
    colF = fractions(width, 0.5, 1);
    rowF = fractions(height, 0.5, 1);
    ccolF = fractions(width / 2, 1.0, 2);
    crowF = fractions(height / 2, 1.0, 2);
  }

  private static float[] fractions(int n, double offset, int scale) {
    float[] f = new float[n];
    for (int i = 0; i < n; i++) {
      double u = (scale * i + offset) / STEP;
      f[i] = (float) (u - Math.floor(u));
    }
    return f;
  }

  public int width() {
    return width;
  }

  public int height() {
    return height;
  }

  /** The bytes of one I420 picture of this size: {@code width × height × 3 / 2}. */
  public int pictureBytes() {
    return width * height * 3 / 2;
  }

  /** Renders a pose with one imagery set and no WMS tiles: {@link #render(Pose, Terrain, GroundFallback, Imagery, Imagery, Options, byte[])}. */
  public int render(Pose pose, Terrain terrain, GroundFallback fallback, @Nullable Imagery imagery, Options options, byte[] out) {
    return render(pose, terrain, fallback, imagery, null, options, out);
  }

  /**
   * Renders a pose into {@code out} (I420: the luma, then Cb, then Cr at half size).
   *
   * @param imagery the set to sample, or {@code null} for none
   * @param wms the WMS tiles, sampled where the set has no tile, or {@code null} for none (F2)
   * @return the ground pixels no imagery covered (counted {@code no imagery})
   */
  public int render(Pose pose, Terrain terrain, GroundFallback fallback, @Nullable Imagery imagery, @Nullable Imagery wms, Options options, byte[] out) {
    if (pose.width() != width || pose.height() != height) {
      throw new IllegalArgumentException("this renderer draws " + width + " × " + height + ", the pose " + pose.width() + " × " + pose.height());
    }
    if (out.length != pictureBytes()) {
      throw new IllegalArgumentException("an I420 picture of " + width + " × " + height + " is " + pictureBytes() + " bytes: " + out.length);
    }
    Pose.Platform p = pose.platform();
    LocalFrame frame = new LocalFrame(p.lon(), p.lat(), p.height());
    Camera camera = new Camera(pose);
    double flat = fallback.height();
    grid(frame, camera, terrain, flat, imagery, wms);
    int missing = luma(imagery, wms, options, out);
    chroma(imagery, wms, options, out);
    return missing;
  }

  /** The ground's height at a point: the terrain's, else the fallback's. */
  static double ground(Terrain terrain, double flat, double lonDeg, double latDeg) {
    double h = terrain.height(lonDeg, latDeg);
    return Double.isNaN(h) ? flat : h;
  }

  private void grid(LocalFrame frame, Camera camera, Terrain terrain, double flat, @Nullable Imagery imagery, @Nullable Imagery wms) {
    double[] d = new double[3];
    double[] geo = new double[3];
    double[] xy = new double[2];
    double below = frame.upOfHeight(ground(terrain, flat, frame.lon(), frame.lat()), 0);
    for (int gj = 0; gj < gh; gj++) {
      double sy = 1 - 2.0 * gj / (gh - 1);
      for (int gi = 0; gi < gw; gi++) {
        double sx = 2.0 * gi / (gw - 1) - 1;
        int k = gj * gw + gi;
        camera.ray(sx, sy, d);
        double norm = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
        double t = search(frame, terrain, flat, d, norm, below, SEARCH_STEPS);
        if (Double.isNaN(t)) {
          down[k] = false;
          continue;
        }
        down[k] = true;
        gd[k] = (float) (t * norm);
        if (imagery != null || wms != null) {
          frame.toGeodetic(t * d[0], t * d[1], t * d[2], geo);
        }
        if (imagery != null) {
          imagery.project(geo[0], geo[1], xy);
          gx[k] = xy[0];
          gy[k] = xy[1];
        }
        if (wms != null) {
          wms.project(geo[0], geo[1], xy);
          wx[k] = xy[0];
          wy[k] = xy[1];
        }
      }
    }
  }

  /**
   * The distance along a ray (in units of {@code d}) to the ground, by S10's damped fixed point;
   * {@code NaN} for a ray that does not meet it within {@link #MAX_RANGE}.
   *
   * @param below the local up coordinate of the ground under the camera, the first guess
   */
  static double search(LocalFrame frame, Terrain terrain, double flat, double[] d, double norm, double below, int steps) {
    if (d[2] > -1e-3 * norm) {
      return Double.NaN;
    }
    double horizontal = d[0] * d[0] + d[1] * d[1];
    double t = below / d[2];
    for (int i = 0; i < steps; i++) {
      double e = t * d[0];
      double n = t * d[1];
      double h = ground(terrain, flat, frame.lonAt(e), frame.latAt(n));
      double next = frame.upOfHeight(h, t * t * horizontal) / d[2];
      t = i == 0 ? next : 0.5 * (t + next);
      if (!(t > 0) || t * norm > MAX_RANGE) {
        return Double.NaN;
      }
    }
    return t;
  }

  /**
   * Whether the set covers any corner of a grid cell: then the cell lies on the set's edge, and its
   * pixels take the slow path, so that the set wins over the WMS tiles wherever it has a tile (F2).
   */
  private static boolean anyCorner(@Nullable Imagery imagery, double[] x, double[] y, int k00, int k01, int k10, int k11) {
    return imagery != null && (imagery.tileAt(x[k00], y[k00]) >= 0 || imagery.tileAt(x[k01], y[k01]) >= 0 || imagery.tileAt(x[k10], y[k10]) >= 0
        || imagery.tileAt(x[k11], y[k11]) >= 0);
  }

  /**
   * The tile that holds all four corners of a grid cell, or −1 (a cell on a seam or the set's edge,
   * or no imagery). Within one tile the CRS to pixel mapping is affine, so the cell's pixels may
   * interpolate the tile's columns and rows directly: the fast path.
   */
  private static int cellTile(@Nullable Imagery imagery, double[] x, double[] y, int k00, int k01, int k10, int k11) {
    if (imagery == null) {
      return -1;
    }
    int t = imagery.tileAt(x[k00], y[k00]);
    if (t < 0 || imagery.tileAt(x[k01], y[k01]) != t || imagery.tileAt(x[k10], y[k10]) != t || imagery.tileAt(x[k11], y[k11]) != t) {
      return -1;
    }
    return t;
  }

  private int luma(@Nullable Imagery imagery, @Nullable Imagery wms, Options options, byte[] out) {
    int missing = 0;
    boolean bilinear = options.bilinear();
    boolean haze = options.haze();
    for (int gj = 0; gj < gh - 1; gj++) {
      for (int gi = 0; gi < gw - 1; gi++) {
        int k00 = gj * gw + gi;
        int k01 = k00 + 1;
        int k10 = k00 + gw;
        int k11 = k10 + 1;
        int x0 = gi * STEP;
        int y0 = gj * STEP;
        if (!(down[k00] && down[k01] && down[k10] && down[k11])) {
          for (int y = y0; y < y0 + STEP; y++) {
            java.util.Arrays.fill(out, y * width + x0, y * width + x0 + STEP, (byte) SKY_Y);
          }
          continue;
        }
        // the fast path's layer: the set's tile if one holds the whole cell, else a WMS tile's
        Imagery layer = imagery;
        double[] lx = gx;
        double[] ly = gy;
        int tile = cellTile(imagery, gx, gy, k00, k01, k10, k11);
        if (tile < 0 && wms != null && !anyCorner(imagery, gx, gy, k00, k01, k10, k11)) {
          layer = wms;
          lx = wx;
          ly = wy;
          tile = cellTile(wms, wx, wy, k00, k01, k10, k11);
        }
        double c00 = 0;
        double c01 = 0;
        double c10 = 0;
        double c11 = 0;
        double r00 = 0;
        double r01 = 0;
        double r10 = 0;
        double r11 = 0;
        if (tile >= 0 && layer != null) {
          c00 = layer.column(tile, lx[k00]);
          c01 = layer.column(tile, lx[k01]);
          c10 = layer.column(tile, lx[k10]);
          c11 = layer.column(tile, lx[k11]);
          r00 = layer.row(tile, ly[k00]);
          r01 = layer.row(tile, ly[k01]);
          r10 = layer.row(tile, ly[k10]);
          r11 = layer.row(tile, ly[k11]);
        }
        for (int y = y0; y < y0 + STEP; y++) {
          float fy = rowF[y];
          int line = y * width;
          // the row's ends in the cell, so that each pixel interpolates once along the row
          double cLeft = c00 + (c10 - c00) * fy;
          double cSpan = c01 + (c11 - c01) * fy - cLeft;
          double rLeft = r00 + (r10 - r00) * fy;
          double rSpan = r01 + (r11 - r01) * fy - rLeft;
          float dLeft = gd[k00] + (gd[k10] - gd[k00]) * fy;
          float dSpan = gd[k01] + (gd[k11] - gd[k01]) * fy - dLeft;
          for (int x = x0; x < x0 + STEP; x++) {
            float fx = colF[x];
            int v;
            if (tile >= 0 && layer != null) {
              v = layer.lumaAt(tile, cLeft + cSpan * fx, rLeft + rSpan * fx, bilinear);
            } else {
              boolean hit = false;
              v = Imagery.GREY_LUMA;
              if (imagery != null) {
                hit = imagery.sample(lerp(gx, k00, k01, k10, k11, fx, fy), lerp(gy, k00, k01, k10, k11, fx, fy), bilinear, false);
                v = imagery.luma();
              }
              if (!hit && wms != null) {
                hit = wms.sample(lerp(wx, k00, k01, k10, k11, fx, fy), lerp(wy, k00, k01, k10, k11, fx, fy), bilinear, false);
                v = wms.luma();
              }
              if (!hit) {
                missing++;
              }
            }
            if (haze) {
              float a = Math.min((dLeft + dSpan * fx) / (float) HAZE_METRES, (float) HAZE_MAX);
              v = (int) (v * (1 - a) + SKY_Y * a + 0.5f);
            }
            out[line + x] = (byte) v;
          }
        }
      }
    }
    return missing;
  }

  private void chroma(@Nullable Imagery imagery, @Nullable Imagery wms, Options options, byte[] out) {
    int cw = width / 2;
    int ch = height / 2;
    int cbAt = width * height;
    int crAt = cbAt + cw * ch;
    int block = STEP / 2;
    boolean colour = imagery != null && imagery.colour() || wms != null && wms.colour();
    for (int gj = 0; gj < gh - 1; gj++) {
      for (int gi = 0; gi < gw - 1; gi++) {
        int k00 = gj * gw + gi;
        int k01 = k00 + 1;
        int k10 = k00 + gw;
        int k11 = k10 + 1;
        int x0 = gi * block;
        int y0 = gj * block;
        boolean sky = !(down[k00] && down[k01] && down[k10] && down[k11]);
        Imagery layer = imagery;
        double[] lx = gx;
        double[] ly = gy;
        int tile = sky || !colour ? -1 : cellTile(imagery, gx, gy, k00, k01, k10, k11);
        if (!sky && colour && tile < 0 && wms != null && !anyCorner(imagery, gx, gy, k00, k01, k10, k11)) {
          layer = wms;
          lx = wx;
          ly = wy;
          tile = cellTile(wms, wx, wy, k00, k01, k10, k11);
        }
        for (int y = y0; y < y0 + block; y++) {
          float fy = crowF[y];
          for (int x = x0; x < x0 + block; x++) {
            int i = y * cw + x;
            if (sky) {
              out[cbAt + i] = (byte) SKY_CB;
              out[crAt + i] = (byte) SKY_CR;
              continue;
            }
            float fx = ccolF[x];
            int cb = Imagery.NEUTRAL_CHROMA;
            int cr = Imagery.NEUTRAL_CHROMA;
            if (colour && tile >= 0 && layer != null) {
              double ix = lerp(lx, k00, k01, k10, k11, fx, fy);
              double iy = lerp(ly, k00, k01, k10, k11, fx, fy);
              layer.chromaAt(tile, layer.column(tile, ix), layer.row(tile, iy), options.bilinear());
              cb = layer.cb();
              cr = layer.cr();
            } else if (colour) {
              boolean hit = false;
              if (imagery != null) {
                hit = imagery.sample(lerp(gx, k00, k01, k10, k11, fx, fy), lerp(gy, k00, k01, k10, k11, fx, fy), options.bilinear(), true);
                cb = imagery.cb();
                cr = imagery.cr();
              }
              if (!hit && wms != null) {
                wms.sample(lerp(wx, k00, k01, k10, k11, fx, fy), lerp(wy, k00, k01, k10, k11, fx, fy), options.bilinear(), true);
                cb = wms.cb();
                cr = wms.cr();
              }
            }
            if (options.haze()) {
              float dist = (gd[k00] * (1 - fx) + gd[k01] * fx) * (1 - fy) + (gd[k10] * (1 - fx) + gd[k11] * fx) * fy;
              float a = Math.min(dist / (float) HAZE_METRES, (float) HAZE_MAX);
              cb = (int) (cb * (1 - a) + SKY_CB * a + 0.5f);
              cr = (int) (cr * (1 - a) + SKY_CR * a + 0.5f);
            }
            out[cbAt + i] = (byte) cb;
            out[crAt + i] = (byte) cr;
          }
        }
      }
    }
  }

  /** A grid value at a point of a cell, bilinear between its four corners. */
  private static double lerp(double[] v, int k00, int k01, int k10, int k11, float fx, float fy) {
    return (v[k00] * (1 - fx) + v[k01] * fx) * (1 - fy) + (v[k10] * (1 - fx) + v[k11] * fx) * fy;
  }

  /**
   * Where the ray through the frame's centre meets the ground (ST 0601 tags 21, 23 to 25; section
   * 10.6 point 19): an exact search through ECEF after the renderer's first-order one; {@code null}
   * when it does not meet the ground within {@link #MAX_RANGE}.
   */
  public static @Nullable FrameCentre centre(Pose pose, Terrain terrain, GroundFallback fallback) {
    Pose.Platform p = pose.platform();
    LocalFrame frame = new LocalFrame(p.lon(), p.lat(), p.height());
    Camera camera = new Camera(pose);
    double flat = fallback.height();
    double[] d = new double[3];
    camera.ray(0, 0, d);
    double norm = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    double below = frame.upOfHeight(ground(terrain, flat, p.lon(), p.lat()), 0);
    double t = search(frame, terrain, flat, d, norm, below, 16);
    if (Double.isNaN(t)) {
      return null;
    }
    double[] geo = new double[3];
    double h = 0;
    for (int i = 0; i < 30; i++) {
      frame.toGeodetic(t * d[0], t * d[1], t * d[2], geo);
      h = ground(terrain, flat, geo[0], geo[1]);
      double off = geo[2] - h;
      if (Math.abs(off) < 0.001) {
        break;
      }
      t += off / -d[2];
      if (!(t > 0) || t * norm > MAX_RANGE) {
        return null;
      }
    }
    frame.toGeodetic(t * d[0], t * d[1], t * d[2], geo);
    return new FrameCentre(geo[0], geo[1], h, t * norm);
  }

  /** The point the frame's centre looks at: longitude, latitude, its ground height (m HAE) and the slant range (m). */
  public record FrameCentre(double lon, double lat, double height, double slantRange) {}

  static int luma(int r, int g, int b) {
    return 16 + (int) Math.round(219 * (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
  }

  static int cb(int r, int g, int b) {
    return 128 + (int) Math.round(224 * (-0.114572 * r - 0.385428 * g + 0.5 * b) / 255);
  }

  static int cr(int r, int g, int b) {
    return 128 + (int) Math.round(224 * (0.5 * r - 0.454153 * g - 0.045847 * b) / 255);
  }
}
