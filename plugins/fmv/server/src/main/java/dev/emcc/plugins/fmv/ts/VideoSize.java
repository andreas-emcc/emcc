package dev.emcc.plugins.fmv.ts;

import java.io.ByteArrayOutputStream;
import org.jspecify.annotations.Nullable;

/**
 * The picture's size from the start of a video access unit: an MPEG-2 sequence header or an H.264
 * sequence parameter set (brief F6). H.265's is not read in M8.
 *
 * @param width pixels
 * @param height pixels
 */
public record VideoSize(int width, int height) {

  /** Looks for the size in the bytes of one access unit, or {@code null} when they do not hold it (yet). */
  public static @Nullable VideoSize find(VideoFormat.Kind kind, byte[] data, int length) {
    return switch (kind) {
      case MPEG2 -> mpeg2(data, length);
      case H264 -> h264(data, length);
      default -> null;
    };
  }

  /** {@code 00 00 01 B3}, then 12 bits of width and 12 bits of height. */
  static @Nullable VideoSize mpeg2(byte[] d, int n) {
    for (int i = 0; i + 7 <= n; i++) {
      if (d[i] == 0 && d[i + 1] == 0 && d[i + 2] == 1 && (d[i + 3] & 0xFF) == 0xB3) {
        int w = ((d[i + 4] & 0xFF) << 4) | ((d[i + 5] & 0xFF) >> 4);
        int h = ((d[i + 5] & 0x0F) << 8) | (d[i + 6] & 0xFF);
        return w > 0 && h > 0 ? new VideoSize(w, h) : null;
      }
    }
    return null;
  }

  /** The first SPS NAL unit (type 7) after a start code. */
  static @Nullable VideoSize h264(byte[] d, int n) {
    for (int i = 0; i + 4 <= n; i++) {
      if (d[i] == 0 && d[i + 1] == 0 && d[i + 2] == 1 && (d[i + 3] & 0x1F) == 7) {
        int end = n;
        for (int j = i + 4; j + 3 <= n; j++) {
          if (d[j] == 0 && d[j + 1] == 0 && (d[j + 2] == 1 || d[j + 2] == 0)) {
            end = j;
            break;
          }
        }
        try {
          return sps(unescape(d, i + 4, end));
        } catch (IllegalArgumentException e) {
          return null; // a cut or damaged SPS: wait for the next one
        }
      }
    }
    return null;
  }

  private static byte[] unescape(byte[] d, int from, int to) {
    var out = new ByteArrayOutputStream(to - from);
    int zeros = 0;
    for (int i = from; i < to; i++) {
      int b = d[i] & 0xFF;
      if (zeros >= 2 && b == 3) {
        zeros = 0; // an emulation prevention byte
        continue;
      }
      out.write(b);
      zeros = b == 0 ? zeros + 1 : 0;
    }
    return out.toByteArray();
  }

  private static boolean highProfile(int p) {
    return p == 100 || p == 110 || p == 122 || p == 244 || p == 44 || p == 83 || p == 86 || p == 118 || p == 128 || p == 138
        || p == 139 || p == 134 || p == 135;
  }

  private static VideoSize sps(byte[] rbsp) {
    var in = new Bits(rbsp);
    int profile = in.bits(8);
    in.bits(8); // constraint flags
    in.bits(8); // level
    in.ue(); // sps id
    int chroma = 1;
    boolean separate = false;
    if (highProfile(profile)) {
      chroma = in.ue();
      if (chroma == 3) {
        separate = in.bits(1) == 1;
      }
      in.ue(); // luma bit depth
      in.ue(); // chroma bit depth
      in.bits(1); // transform bypass
      if (in.bits(1) == 1) { // scaling matrices
        for (int i = 0; i < (chroma != 3 ? 8 : 12); i++) {
          if (in.bits(1) == 1) {
            int size = i < 6 ? 16 : 64;
            int last = 8;
            int next = 8;
            for (int j = 0; j < size; j++) {
              if (next != 0) {
                next = (last + in.se() + 256) % 256;
              }
              last = next == 0 ? last : next;
            }
          }
        }
      }
    }
    in.ue(); // log2 max frame number
    int pocType = in.ue();
    if (pocType == 0) {
      in.ue();
    } else if (pocType == 1) {
      in.bits(1);
      in.se();
      in.se();
      int cycle = in.ue();
      if (cycle > 255) {
        throw new IllegalArgumentException("poc cycle");
      }
      for (int i = 0; i < cycle; i++) {
        in.se();
      }
    }
    in.ue(); // max reference frames
    in.bits(1); // gaps in frame numbers
    int widthMbs = in.ue() + 1;
    int heightUnits = in.ue() + 1;
    boolean frameMbsOnly = in.bits(1) == 1;
    if (!frameMbsOnly) {
      in.bits(1);
    }
    in.bits(1); // direct 8x8 inference
    int left = 0;
    int right = 0;
    int top = 0;
    int bottom = 0;
    if (in.bits(1) == 1) {
      left = in.ue();
      right = in.ue();
      top = in.ue();
      bottom = in.ue();
    }
    int chromaArray = separate ? 0 : chroma;
    int unitX = chromaArray == 0 || chromaArray == 3 ? 1 : 2;
    int subHeight = chromaArray == 1 ? 2 : 1;
    int fields = frameMbsOnly ? 1 : 2;
    int unitY = (chromaArray == 0 ? 1 : subHeight) * fields;
    int width = widthMbs * 16 - unitX * (left + right);
    int height = fields * heightUnits * 16 - unitY * (top + bottom);
    if (width < 16 || height < 16 || width > 16_384 || height > 16_384) {
      throw new IllegalArgumentException("size");
    }
    return new VideoSize(width, height);
  }

  /** An exp-Golomb bit reader; a read past the end is an {@link IllegalArgumentException}. */
  private static final class Bits {
    private final byte[] d;
    private int pos;

    Bits(byte[] d) {
      this.d = d;
    }

    int bits(int n) {
      int v = 0;
      for (int i = 0; i < n; i++) {
        if ((pos >> 3) >= d.length) {
          throw new IllegalArgumentException("end");
        }
        v = (v << 1) | ((d[pos >> 3] >> (7 - (pos & 7))) & 1);
        pos++;
      }
      return v;
    }

    int ue() {
      int zeros = 0;
      while (bits(1) == 0) {
        if (++zeros > 30) {
          throw new IllegalArgumentException("ue");
        }
      }
      return zeros == 0 ? 0 : (1 << zeros) - 1 + bits(zeros);
    }

    int se() {
      int k = ue();
      return (k & 1) == 1 ? (k + 1) / 2 : -(k / 2);
    }
  }
}
