package dev.emcc.plugins.fmv.ts;

import java.util.Locale;

/**
 * A video stream's type from the PMT (brief section 4): H.264 and H.265 are played as they are, MPEG-2
 * is converted by ECore, anything else is listed and mapped but not played (ADR-0057 point 7).
 *
 * @param streamType the PMT's {@code stream_type}
 */
public record VideoFormat(int streamType) {

  /** What the plugin does with the format. */
  public enum Kind { H264, H265, MPEG2, OTHER }

  public Kind kind() {
    return switch (streamType) {
      case 0x1B -> Kind.H264;
      case 0x24 -> Kind.H265;
      case 0x02 -> Kind.MPEG2;
      default -> Kind.OTHER;
    };
  }

  /** The name the panel shows. */
  public String label() {
    return switch (streamType) {
      case 0x1B -> "H.264";
      case 0x24 -> "H.265";
      case 0x02 -> "MPEG-2";
      case 0x01 -> "MPEG-1";
      case 0x10 -> "MPEG-4 Visual";
      case 0x21 -> "JPEG 2000";
      case 0x42 -> "AVS";
      case 0xD1 -> "Dirac";
      case 0xEA -> "VC-1";
      default -> String.format(Locale.ROOT, "video type 0x%02X", streamType);
    };
  }

  /** A stream type that carries video, as the PMT lists it. */
  public static boolean isVideo(int streamType) {
    return switch (streamType) {
      case 0x01, 0x02, 0x10, 0x1B, 0x21, 0x24, 0x42, 0xD1, 0xEA -> true;
      default -> false;
    };
  }
}
