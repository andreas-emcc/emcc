package dev.emcc.sdk.stream;

import java.util.Objects;
import java.util.regex.Pattern;

/**
 * SDK 1.9.0 (CR-0050 point 1.2; ADR-0059 point 7): an encoder to start with {@link
 * Conversions#encode}: raw I420 pictures in, H.264 access units out, with no B-frames, so each
 * picture gives one access unit, in order. Immutable.
 *
 * <pre>{@code
 * EncoderSpec.of("uav-north", 1280, 720, 25).bitrate(6_000_000).keyframeSeconds(1)
 * }</pre>
 *
 * @param name the encoder's name, as a stream's: {@code [a-z0-9][a-z0-9-]{0,63}}; unique among the
 *     plugin's encoders that have not ended; its {@link ConversionEvent}s carry it as their {@code
 *     stream()}
 * @param width the pictures' width in pixels, even, {@link #MIN_WIDTH} to {@link #MAX_WIDTH}
 * @param height the pictures' height in pixels, even, {@link #MIN_HEIGHT} to {@link #MAX_HEIGHT}
 *     (1080p is the ceiling, not the default; a simulated camera's default is 720p)
 * @param frameRate pictures a second, 1 to {@link #MAX_FRAME_RATE}
 * @param bitrate the output's bit rate, as {@link ConversionSpec#bitrate()}'s: {@link
 *     ConversionSpec#MIN_BITRATE} to {@link ConversionSpec#MAX_BITRATE} bit/s, default {@link
 *     ConversionSpec#DEFAULT_BITRATE}
 * @param keyframeSeconds the time between keyframes (IDR pictures), 0.5 to 10 s, default 1
 */
public record EncoderSpec(String name, int width, int height, int frameRate, long bitrate, double keyframeSeconds) {

  public static final int MIN_WIDTH = 160;
  public static final int MAX_WIDTH = 1920;
  public static final int MIN_HEIGHT = 120;
  public static final int MAX_HEIGHT = 1080;
  public static final int MAX_FRAME_RATE = 30;

  private static final Pattern NAME = Pattern.compile("[a-z0-9][a-z0-9-]{0,63}");

  public EncoderSpec {
    Objects.requireNonNull(name, "name");
    if (!NAME.matcher(name).matches()) {
      throw new IllegalArgumentException("an encoder's name is [a-z0-9][a-z0-9-]{0,63}: " + name);
    }
    if (width < MIN_WIDTH || width > MAX_WIDTH || width % 2 != 0) {
      throw new IllegalArgumentException("an encoder's width is even, " + MIN_WIDTH + ".." + MAX_WIDTH + ": " + width);
    }
    if (height < MIN_HEIGHT || height > MAX_HEIGHT || height % 2 != 0) {
      throw new IllegalArgumentException("an encoder's height is even, " + MIN_HEIGHT + ".." + MAX_HEIGHT + ": " + height);
    }
    if (frameRate < 1 || frameRate > MAX_FRAME_RATE) {
      throw new IllegalArgumentException("an encoder's frame rate is 1.." + MAX_FRAME_RATE + ": " + frameRate);
    }
    if (bitrate < ConversionSpec.MIN_BITRATE || bitrate > ConversionSpec.MAX_BITRATE) {
      throw new IllegalArgumentException("an encoder's bit rate is " + ConversionSpec.MIN_BITRATE + ".." + ConversionSpec.MAX_BITRATE + " bit/s: " + bitrate);
    }
    if (!(keyframeSeconds >= 0.5 && keyframeSeconds <= 10)) {
      throw new IllegalArgumentException("an encoder's keyframe interval is 0.5..10 s: " + keyframeSeconds);
    }
  }

  /** An encoder with the default bit rate and keyframe interval. */
  public static EncoderSpec of(String name, int width, int height, int frameRate) {
    return new EncoderSpec(name, width, height, frameRate, ConversionSpec.DEFAULT_BITRATE, ConversionSpec.DEFAULT_KEYFRAME_SECONDS);
  }

  /** This spec with another bit rate. */
  public EncoderSpec bitrate(long bitsPerSecond) {
    return new EncoderSpec(name, width, height, frameRate, bitsPerSecond, keyframeSeconds);
  }

  /** This spec with another keyframe interval. */
  public EncoderSpec keyframeSeconds(double seconds) {
    return new EncoderSpec(name, width, height, frameRate, bitrate, seconds);
  }

  /** The bytes of one I420 picture of this size: {@code width × height × 3 / 2}. */
  public int pictureBytes() {
    return width * height * 3 / 2;
  }
}
