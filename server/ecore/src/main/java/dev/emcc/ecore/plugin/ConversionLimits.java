package dev.emcc.ecore.plugin;

import java.nio.file.Path;
import java.util.Locale;
import java.util.Objects;

/**
 * The conversion service's settings (SDK 1.8.0 part E, CR-0044 E2; T-211; {@code emc2.conversions.*}).
 *
 * @param max how many conversions run at once ({@code max}, default 2, about half a core each)
 * @param inputQueueBytes the most input that waits for a conversion's process ({@code input-queue-bytes}, default 2 MiB)
 * @param ffmpeg the converter ({@code ffmpeg}), by default the release's {@code tools/ffmpeg/ffmpeg.exe} (Windows) or
 *     {@code tools/ffmpeg/ffmpeg}, below the working directory; one that is not there makes every start {@code UNAVAILABLE}
 * @param maxPixels the largest picture the converter decodes ({@code max-pixels}, default 3840 x 2160): ffmpeg trusts
 *     the size an input's sequence header claims, so a larger claim ends the conversion instead of taking gigabytes (SRA, M8)
 * @param restartSeconds the least time between two launches of a converter for one plugin's target stream ({@code
 *     restart-seconds}, default 10, 1 to 600; M9 C5, SRA's M9-S3): a start inside it waits
 */
public record ConversionLimits(int max, long inputQueueBytes, Path ffmpeg, long maxPixels, int restartSeconds) {

  public static final int DEFAULT_RESTART_SECONDS = 10;

  /** 3840 x 2160, the limit the SRA tested. */
  public static final long DEFAULT_MAX_PIXELS = 3840L * 2160;
  /** 640 x 480 to 7680 x 4320 (8K, rounded up). */
  public static final long MIN_PIXELS = 640L * 480;
  public static final long MAX_PIXELS = 35_000_000L;

  public static final ConversionLimits DEFAULT =
      new ConversionLimits(2, 2L * 1024 * 1024, defaultFfmpeg(), DEFAULT_MAX_PIXELS, DEFAULT_RESTART_SECONDS);

  /** With the default restart time. */
  public ConversionLimits(int max, long inputQueueBytes, Path ffmpeg, long maxPixels) {
    this(max, inputQueueBytes, ffmpeg, maxPixels, DEFAULT_RESTART_SECONDS);
  }

  public ConversionLimits {
    Objects.requireNonNull(ffmpeg, "ffmpeg");
    if (max < 1 || max > 64) {
      throw new IllegalArgumentException("emc2.conversions.max is 1 to 64: " + max);
    }
    if (inputQueueBytes < 64 * 1024 || inputQueueBytes > 64L * 1024 * 1024) {
      throw new IllegalArgumentException("emc2.conversions.input-queue-bytes is 64 KiB to 64 MiB: " + inputQueueBytes);
    }
    if (restartSeconds < 1 || restartSeconds > 600) {
      throw new IllegalArgumentException("emc2.conversions.restart-seconds is 1 to 600: " + restartSeconds);
    }
    if (maxPixels < MIN_PIXELS || maxPixels > MAX_PIXELS) {
      throw new IllegalArgumentException("emc2.conversions.max-pixels is " + MIN_PIXELS + " to " + MAX_PIXELS + ": " + maxPixels);
    }
  }

  /** The release's ffmpeg, below the working directory (the emcc folder). */
  static Path defaultFfmpeg() {
    return Path.of("tools", "ffmpeg", windows() ? "ffmpeg.exe" : "ffmpeg");
  }

  static boolean windows() {
    return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).startsWith("windows");
  }
}
