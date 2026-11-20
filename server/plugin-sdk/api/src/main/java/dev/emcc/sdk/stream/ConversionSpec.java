package dev.emcc.sdk.stream;

import java.util.Objects;

/**
 * SDK 1.8.0 (CR-0044 E2): a conversion to start. Immutable.
 *
 * <pre>{@code
 * ConversionSpec.mpeg2ToH264(video).bitrate(6_000_000).keyframeSeconds(0.5)
 * }</pre>
 *
 * @param kind what to convert; 1.8.0 has one kind
 * @param target the stream the output goes to
 * @param bitrate the output's video bit rate, {@link #MIN_BITRATE} to {@link #MAX_BITRATE} bit/s,
 *     default {@link #DEFAULT_BITRATE}
 * @param keyframeSeconds the time between the output's keyframes, which are its start points, 0.5
 *     to 10 s, default 1
 */
public record ConversionSpec(Kind kind, StreamRef target, long bitrate, double keyframeSeconds) {

  /** What a conversion does. */
  public enum Kind {
    /**
     * An MPEG-2 video transport stream in, an H.264 transport stream out: the KLV and the other data
     * streams copied, the timing kept, no B-frames.
     */
    MPEG2_TS_TO_H264_TS
  }

  public static final long MIN_BITRATE = 500_000L;
  public static final long MAX_BITRATE = 20_000_000L;
  public static final long DEFAULT_BITRATE = 4_000_000L;
  public static final double DEFAULT_KEYFRAME_SECONDS = 1.0;

  public ConversionSpec {
    Objects.requireNonNull(kind, "kind");
    Objects.requireNonNull(target, "target");
    if (bitrate < MIN_BITRATE || bitrate > MAX_BITRATE) {
      throw new IllegalArgumentException("a conversion's bit rate is " + MIN_BITRATE + ".." + MAX_BITRATE + " bit/s: " + bitrate);
    }
    if (!(keyframeSeconds >= 0.5 && keyframeSeconds <= 10)) {
      throw new IllegalArgumentException("a conversion's keyframe interval is 0.5..10 s: " + keyframeSeconds);
    }
  }

  /** MPEG-2 to H.264 into {@code target}, with the default bit rate and keyframe interval. */
  public static ConversionSpec mpeg2ToH264(StreamRef target) {
    return new ConversionSpec(Kind.MPEG2_TS_TO_H264_TS, target, DEFAULT_BITRATE, DEFAULT_KEYFRAME_SECONDS);
  }

  /** This spec with another bit rate. */
  public ConversionSpec bitrate(long bitsPerSecond) {
    return new ConversionSpec(kind, target, bitsPerSecond, keyframeSeconds);
  }

  /** This spec with another keyframe interval. */
  public ConversionSpec keyframeSeconds(double seconds) {
    return new ConversionSpec(kind, target, bitrate, seconds);
  }
}
