package dev.emcc.plugins.fmv.out.render;

import dev.emcc.plugins.fmv.out.Pose;
import dev.emcc.plugins.fmv.out.imagery.Imagery;
import dev.emcc.plugins.fmv.out.terrain.Terrain;
import org.jspecify.annotations.Nullable;

/**
 * The degraded camera (F4, ADR-0066; the owner, 2026-11-23: haze and noise are settings, the rest
 * fixed): a cheap sensor's picture for one frame size, owned by one compute task.
 *
 * <ol>
 *   <li>the picture is drawn at half the frame's width and height (rounded down to whole grid
 *       cells), with the grey haze of {@link Renderer.Options#greyHaze()};
 *   <li>its contrast is cut to {@link #CONTRAST} and its colour to {@link #COLOUR}, on the small
 *       picture through lookup tables;
 *   <li>it is scaled back up to the frame's size, bilinear, which softens it;
 *   <li>sensor noise is added to every luma pixel, and half as much to the chroma: a triangular
 *       distribution of up to ±{@link #NOISE_MAX} levels at noise 1, new for every frame, from this
 *       degrader's own generator.
 * </ol>
 *
 * Drawing at half size also renders a quarter of the pixels, so the degraded camera costs less per
 * frame than the plain one.
 */
public final class Degrader {

  /** What is left of the contrast round mid-grey. */
  public static final double CONTRAST = 0.8;

  /** What is left of the colour round neutral. */
  public static final double COLOUR = 0.6;

  /** The noise's widest swing in luma levels, at noise 1. */
  public static final int NOISE_MAX = 24;

  /** The middle of the luma's limited range, 16 to 235. */
  static final double MID_LUMA = 125.5;

  /** The degraded camera's two settings, each 0 to 1. */
  public record Settings(double haze, double noise) {
    public Settings {
      if (!(haze >= 0 && haze <= 1 && noise >= 0 && noise <= 1)) {
        throw new IllegalArgumentException("haze and noise are 0 to 1: " + haze + ", " + noise);
      }
    }
  }

  private final int width;
  private final int height;
  private final Renderer small;
  private final byte[] picture;
  private final byte[] lumaTable = new byte[256];
  private final byte[] chromaTable = new byte[256];
  private final int[] lumaX;
  private final int[] lumaFx;
  private final int[] lumaY;
  private final int[] lumaFy;
  private final int[] chromaX;
  private final int[] chromaFx;
  private final int[] chromaY;
  private final int[] chromaFy;
  private long state;

  /**
   * @param width the frame's width, 640, 1280 or 1920
   * @param height the frame's height, 360, 720 or 1080
   * @param seed the noise generator's seed: the same seed gives the same noise, frame after frame
   */
  public Degrader(int width, int height, long seed) {
    if (width % 2 != 0 || height % 2 != 0) {
      throw new IllegalArgumentException("a frame's sides are even: " + width + " × " + height);
    }
    this.width = width;
    this.height = height;
    int sw = width / 2 / Renderer.STEP * Renderer.STEP;
    int sh = height / 2 / Renderer.STEP * Renderer.STEP;
    small = new Renderer(sw, sh);
    picture = new byte[small.pictureBytes()];
    for (int v = 0; v < 256; v++) {
      lumaTable[v] = (byte) clamp((int) Math.round(MID_LUMA + (v - MID_LUMA) * CONTRAST), 16, 235);
      chromaTable[v] = (byte) clamp((int) Math.round(128 + (v - 128) * COLOUR), 16, 240);
    }
    lumaX = new int[width];
    lumaFx = new int[width];
    lumaY = new int[height];
    lumaFy = new int[height];
    chromaX = new int[width / 2];
    chromaFx = new int[width / 2];
    chromaY = new int[height / 2];
    chromaFy = new int[height / 2];
    taps(width, sw, lumaX, lumaFx);
    taps(height, sh, lumaY, lumaFy);
    taps(width / 2, sw / 2, chromaX, chromaFx);
    taps(height / 2, sh / 2, chromaY, chromaFy);
    state = seed == 0 ? 0x9E3779B97F4A7C15L : seed;
  }

  /** The size the picture is drawn at before it is scaled up: half the frame's, in whole grid cells. */
  public int drawnWidth() {
    return small.width();
  }

  public int drawnHeight() {
    return small.height();
  }

  /**
   * For each output sample, the source sample to its left (or above) and the next one's weight in
   * 1/256: pixel centres line up, and the edges repeat.
   */
  private static void taps(int out, int in, int[] at, int[] weight) {
    double scale = (double) in / out;
    for (int i = 0; i < out; i++) {
      double s = Math.max(0, Math.min(in - 1, (i + 0.5) * scale - 0.5));
      int s0 = Math.min((int) s, in - 2);
      at[i] = s0;
      weight[i] = (int) Math.round((s - s0) * 256);
    }
  }

  /**
   * Renders the degraded picture of a pose into {@code out}, an I420 picture of the frame's size.
   *
   * @return the ground pixels of the small picture no imagery covered, scaled to the frame's size
   */
  public int render(Pose pose, Terrain terrain, GroundFallback fallback, @Nullable Imagery imagery, @Nullable Imagery wms, boolean bilinear, Settings settings,
      byte[] out) {
    if (out.length != width * height * 3 / 2) {
      throw new IllegalArgumentException("an I420 picture of " + width + " × " + height + " is " + width * height * 3 / 2 + " bytes: " + out.length);
    }
    int missing = small.draw(pose, terrain, fallback, imagery, wms, new Renderer.Options(bilinear, false, settings.haze()), picture);
    int sw = small.width();
    int sh = small.height();
    int lumaBytes = sw * sh;
    for (int i = 0; i < lumaBytes; i++) {
      picture[i] = lumaTable[picture[i] & 0xFF];
    }
    for (int i = lumaBytes; i < picture.length; i++) {
      picture[i] = chromaTable[picture[i] & 0xFF];
    }
    scale(picture, 0, sw, out, 0, width, height, lumaX, lumaFx, lumaY, lumaFy);
    int cbIn = lumaBytes;
    int crIn = cbIn + sw / 2 * (sh / 2);
    int cbOut = width * height;
    int crOut = cbOut + width / 2 * (height / 2);
    scale(picture, cbIn, sw / 2, out, cbOut, width / 2, height / 2, chromaX, chromaFx, chromaY, chromaFy);
    scale(picture, crIn, sw / 2, out, crOut, width / 2, height / 2, chromaX, chromaFx, chromaY, chromaFy);
    int swing = (int) Math.round(settings.noise() * NOISE_MAX);
    if (swing > 0) {
      noise(out, 0, cbOut, swing, 16, 235);
      noise(out, cbOut, out.length, Math.max(1, swing / 2), 16, 240);
    }
    return (int) ((long) missing * width * height / lumaBytes);
  }

  /** One plane scaled bilinear, in fixed point. */
  private static void scale(byte[] in, int inAt, int inWidth, byte[] out, int outAt, int outWidth, int outHeight, int[] xs, int[] fxs, int[] ys, int[] fys) {
    for (int y = 0; y < outHeight; y++) {
      int top = inAt + ys[y] * inWidth;
      int bottom = top + inWidth;
      int fy = fys[y];
      int line = outAt + y * outWidth;
      for (int x = 0; x < outWidth; x++) {
        int sx = xs[x];
        int fx = fxs[x];
        int a = (in[top + sx] & 0xFF) * (256 - fx) + (in[top + sx + 1] & 0xFF) * fx;
        int b = (in[bottom + sx] & 0xFF) * (256 - fx) + (in[bottom + sx + 1] & 0xFF) * fx;
        out[line + x] = (byte) ((a * (256 - fy) + b * fy + 32_768) >> 16);
      }
    }
  }

  /**
   * Triangular noise of up to ±{@code swing} levels on {@code out[from, to)}, clamped to the range:
   * one xorshift step gives four samples, each the difference of two random bytes.
   */
  private void noise(byte[] out, int from, int to, int swing, int low, int high) {
    long s = state;
    int i = from;
    while (i < to) {
      s ^= s << 13;
      s ^= s >>> 7;
      s ^= s << 17;
      long r = s;
      for (int k = 0; k < 4 && i < to; k++, i++) {
        int d = (int) (r & 0xFF) - (int) ((r >>> 8) & 0xFF); // −255 to 255, triangular
        r >>>= 16;
        out[i] = (byte) clamp((out[i] & 0xFF) + d * swing / 255, low, high);
      }
    }
    state = s;
  }

  private static int clamp(int v, int low, int high) {
    return v < low ? low : Math.min(v, high);
  }
}
