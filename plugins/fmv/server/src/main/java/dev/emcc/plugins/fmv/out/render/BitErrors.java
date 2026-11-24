package dev.emcc.plugins.fmv.out.render;

import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.SplittableRandom;
import org.jspecify.annotations.Nullable;

/**
 * Bit errors drawn into the picture (F5; ADR-0066 point 2 as the owner changed it for M9.2: drawn, so
 * that every player shows the same, rather than the stream damaged): what a receiver's decoder shows
 * after a poor radio link lost part of a picture, drawn before the picture goes to the encoder.
 *
 * <ul>
 *   <li><b>When:</b> an event every {@code every} ± {@code jitter} seconds of picture time, from one
 *       seeded generator, so the same seed and pictures give the same damage. An event's {@code blocks}
 *       runs come over one to three pictures in a row.
 *   <li><b>What:</b> each run is a lost slice's tail, 2 to a row's width of 16 × 16 blocks from a random
 *       block on, along the row and into the next. Most runs show the last picture sent from the wrong
 *       place (a wrong motion vector of 4 to 24 pixels), which drifts and smears from picture to
 *       picture. About a third of the runs are flat green blocks that stay where they are.
 *   <li><b>Until:</b> the encoder's next keyframe, which clears it all, as a decoder recovers on an
 *       IDR. ECore's encoder forces a keyframe at the first picture whose time reaches {@code n ×
 *       keyframeSeconds} (its {@code -force_key_frames}), counted from its first picture, so the task
 *       counts the pictures the encoder took. A new encoder starts clean. No event begins on a keyframe.
 * </ul>
 *
 * The stream, its SPS and PPS, the KLV and every timestamp are untouched: only the pixels change.
 * Pure code, owned by the link's compute task: no I/O, no threads.
 */
public final class BitErrors {

  /** A block's side, pixels: H.264's macroblock. */
  public static final int BLOCK = 16;

  /** The most pictures one event's runs spread over. */
  public static final int MOST_PICTURES = 3;

  /** The share of runs drawn as flat green blocks. */
  static final double FLAT_SHARE = 0.35;

  /**
   * The link's {@code bitErrors} settings.
   *
   * @param everySeconds the mean time between events, 2 to 600 s
   * @param jitterSeconds how far an event may fall either side of it, 0 to 60 s and less than {@code everySeconds}
   * @param blocks the runs of blocks an event damages, 1 to 20
   * @param seed the generator's seed
   */
  public record Settings(double everySeconds, double jitterSeconds, int blocks, long seed) {
    public Settings {
      if (!(everySeconds >= 2 && everySeconds <= 600)) {
        throw new IllegalArgumentException("every is 2 to 600 s: " + everySeconds);
      }
      if (!(jitterSeconds >= 0 && jitterSeconds <= 60 && jitterSeconds < everySeconds)) {
        throw new IllegalArgumentException("jitter is 0 to 60 s and less than every: " + jitterSeconds);
      }
      if (blocks < 1 || blocks > 20) {
        throw new IllegalArgumentException("blocks is 1 to 20: " + blocks);
      }
    }
  }

  /** What one picture got: whether an event began with it, and the blocks it newly damaged. */
  public record Hit(boolean event, int blocks) {
    public static final Hit NONE = new Hit(false, 0);
  }

  private final Settings settings;
  private final SplittableRandom random;
  private int width;
  private int height;
  private int across;
  private int down;
  /** Per block: damaged, and where it takes its pixels from in the last picture (dx, dy). */
  private boolean[] damaged = new boolean[0];
  private int[] dx = new int[0];
  private int[] dy = new int[0];
  private int count;
  private byte[] previous = new byte[0];
  private boolean hasPrevious;
  private @Nullable Instant next;
  private int runsLeft;
  private int picturesLeft;

  public BitErrors(Settings settings) {
    this.settings = settings;
    this.random = new SplittableRandom(settings.seed());
  }

  public Settings settings() {
    return settings;
  }

  /** The blocks damaged now. */
  public int damagedBlocks() {
    return count;
  }

  /** A new encoder starts: the damage ends, and nothing sent is left to take wrong pixels from. */
  public void encoderStarted() {
    clear();
    hasPrevious = false;
  }

  /**
   * Whether ECore's encoder makes its picture {@code index} (from 0) a keyframe: the first whose time
   * reaches the next multiple of the interval ({@code -force_key_frames expr:gte(t,n_forced*K)}).
   *
   * @param keyframePictures the interval in pictures: the rate × {@code keyframeSeconds}
   */
  public static boolean keyframe(long index, double keyframePictures) {
    if (index == 0) {
      return true;
    }
    // the first index at or past n × the interval: n × the interval lies in (index − 1, index]
    return Math.floor(index / keyframePictures + 1e-9) > Math.floor((index - 1) / keyframePictures + 1e-9);
  }

  /**
   * Damages a rendered I420 picture in place, before it is written to the encoder; then call {@link
   * #written} with what the encoder said.
   *
   * @param time the picture's time
   * @param keyframe whether the encoder makes this picture a keyframe ({@link #keyframe(long, double)})
   */
  public Hit apply(Instant time, byte[] picture, int width, int height, boolean keyframe) {
    if (width != this.width || height != this.height) {
      size(width, height);
    }
    if (next == null) {
      next = time.plus(interval());
    }
    if (keyframe) {
      clear(); // the receiver's decoder recovers here
      return Hit.NONE;
    }
    boolean begins = false;
    if (runsLeft == 0 && !time.isBefore(next)) {
      runsLeft = settings.blocks();
      picturesLeft = 1 + random.nextInt(MOST_PICTURES);
      next = time.plus(interval());
      begins = true;
    }
    int added = 0;
    if (runsLeft > 0 && hasPrevious) {
      int n = picturesLeft <= 1 ? runsLeft : Math.max(1, runsLeft / picturesLeft);
      for (int i = 0; i < n; i++) {
        added += run(picture);
      }
      runsLeft -= n;
      picturesLeft--;
      if (picturesLeft <= 0) {
        runsLeft = 0;
      }
    } else if (runsLeft > 0) {
      runsLeft = 0; // nothing sent yet to take wrong pixels from
    }
    if (count > 0) {
      draw(picture);
    }
    return begins || added > 0 ? new Hit(begins, added) : Hit.NONE;
  }

  /** What the encoder did with the picture {@link #apply} drew: taken, it is the next picture's past. */
  public void written(boolean accepted, byte[] picture) {
    if (!accepted) {
      return;
    }
    System.arraycopy(picture, 0, previous, 0, previous.length);
    hasPrevious = true;
  }

  private void size(int width, int height) {
    this.width = width;
    this.height = height;
    across = (width + BLOCK - 1) / BLOCK;
    down = (height + BLOCK - 1) / BLOCK;
    damaged = new boolean[across * down];
    dx = new int[across * down];
    dy = new int[across * down];
    previous = new byte[width * height * 3 / 2];
    hasPrevious = false;
    count = 0;
  }

  private void clear() {
    Arrays.fill(damaged, false);
    count = 0;
    runsLeft = 0;
  }

  private Duration interval() {
    double s = settings.everySeconds() + (random.nextDouble() * 2 - 1) * settings.jitterSeconds();
    return Duration.ofNanos(Math.round(s * 1e9));
  }

  /** One run from a random block on; returns the blocks it newly damaged. */
  private int run(byte[] picture) {
    int total = across * down;
    int start = random.nextInt(total);
    int length = 2 + random.nextInt(across);
    boolean flat = random.nextDouble() < FLAT_SHARE;
    int mx = 0;
    int my = 0;
    if (!flat) {
      mx = (4 + random.nextInt(21)) * (random.nextBoolean() ? 1 : -1);
      my = random.nextInt(33) - 16;
    }
    int added = 0;
    for (int b = start; b < Math.min(total, start + length); b++) {
      if (!damaged[b]) {
        damaged[b] = true;
        count++;
        added++;
      }
      dx[b] = mx;
      dy[b] = my;
      if (flat) {
        flat(picture, b);
      }
    }
    return added;
  }

  /** A flat green block: the luma at the last picture's mean there, the chroma well off neutral. Kept by {@link #draw} after. */
  private void flat(byte[] picture, int b) {
    int x0 = b % across * BLOCK;
    int y0 = b / across * BLOCK;
    long sum = 0;
    int n = 0;
    for (int y = y0; y < Math.min(height, y0 + BLOCK); y++) {
      for (int x = x0; x < Math.min(width, x0 + BLOCK); x++) {
        sum += previous[y * width + x] & 0xFF;
        n++;
      }
    }
    byte luma = (byte) (n == 0 ? 126 : sum / n);
    for (int y = y0; y < Math.min(height, y0 + BLOCK); y++) {
      Arrays.fill(previous, y * width + x0, y * width + Math.min(width, x0 + BLOCK), luma);
    }
    int cw = width / 2;
    int ch = height / 2;
    int cb = width * height;
    int cr = cb + cw * ch;
    for (int y = y0 / 2; y < Math.min(ch, (y0 + BLOCK) / 2); y++) {
      Arrays.fill(previous, cb + y * cw + x0 / 2, cb + y * cw + Math.min(cw, (x0 + BLOCK) / 2), (byte) 80);
      Arrays.fill(previous, cr + y * cw + x0 / 2, cr + y * cw + Math.min(cw, (x0 + BLOCK) / 2), (byte) 72);
    }
  }

  /** Every damaged block takes its pixels from the last picture sent, from where its run's wrong motion points. */
  private void draw(byte[] picture) {
    int cw = width / 2;
    int ch = height / 2;
    int cb = width * height;
    int cr = cb + cw * ch;
    for (int b = 0; b < damaged.length; b++) {
      if (!damaged[b]) {
        continue;
      }
      int x0 = b % across * BLOCK;
      int y0 = b / across * BLOCK;
      copy(previous, picture, 0, width, height, x0, y0, BLOCK, dx[b], dy[b]);
      copy(previous, picture, cb, cw, ch, x0 / 2, y0 / 2, BLOCK / 2, dx[b] / 2, dy[b] / 2);
      copy(previous, picture, cr, cw, ch, x0 / 2, y0 / 2, BLOCK / 2, dx[b] / 2, dy[b] / 2);
    }
  }

  /** One plane's square at (x0, y0) from {@code from}, displaced by (dx, dy) and clamped to the plane. */
  private static void copy(byte[] from, byte[] to, int at, int w, int h, int x0, int y0, int side, int dx, int dy) {
    for (int y = y0; y < Math.min(h, y0 + side); y++) {
      int sy = Math.max(0, Math.min(h - 1, y + dy));
      for (int x = x0; x < Math.min(w, x0 + side); x++) {
        int sx = Math.max(0, Math.min(w - 1, x + dx));
        to[at + y * w + x] = from[at + sy * w + sx];
      }
    }
  }
}
