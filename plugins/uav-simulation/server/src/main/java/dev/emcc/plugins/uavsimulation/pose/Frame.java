package dev.emcc.plugins.uavsimulation.pose;

import java.time.Duration;

/**
 * The frame: its size and rate (brief section 5: three sizes, 1 to 30 frames a second).
 *
 * @param width pixels
 * @param height pixels
 * @param rate frames a second
 */
public record Frame(int width, int height, int rate) {

  /** The lowest frame rate. */
  public static final int MIN_RATE = 1;

  /** The highest frame rate. */
  public static final int MAX_RATE = 30;

  /** The default frame: 1280 × 720 at 25 frames a second. */
  public static final Frame DEFAULT = new Frame(1280, 720, 25);

  public Frame {
    boolean known = (width == 640 && height == 360) || (width == 1280 && height == 720) || (width == 1920 && height == 1080);
    if (!known) {
      throw new IllegalArgumentException("frame size must be 640x360, 1280x720 or 1920x1080: " + width + "x" + height);
    }
    if (rate < MIN_RATE || rate > MAX_RATE) {
      throw new IllegalArgumentException("frame rate must be " + MIN_RATE + " to " + MAX_RATE + ": " + rate);
    }
  }

  /**
   * The timer's period (brief function 7): {@code 1 / rate} in whole milliseconds, rounded to the
   * nearest: 40 ms at 25, 33 ms at 30. Always above the SDK's {@code Timers.MIN_PERIOD} (10 ms).
   */
  public Duration period() {
    return Duration.ofMillis(Math.round(1000.0 / rate));
  }
}
