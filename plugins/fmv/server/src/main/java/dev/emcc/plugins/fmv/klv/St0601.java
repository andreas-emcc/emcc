package dev.emcc.plugins.fmv.klv;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.jspecify.annotations.Nullable;

/**
 * Reads KLV and the MISB ST 0601 UAS Datalink Local Set (brief section 2). Received data is
 * untrusted: every length is checked, and nothing here throws on bad input. The tag table was checked
 * against ST 0601.14 and ST 0102.12 by the PDA (2026-11-15): it agrees with the standards.
 */
public final class St0601 {

  /** The 16-byte key of the ST 0601 local set (a method: a static array is not an immutable constant, rule C2). */
  static byte[] key() {
    return new byte[] {0x06, 0x0E, 0x2B, 0x34, 0x02, 0x0B, 0x01, 0x01, 0x0E, 0x01, 0x03, 0x01, 0x01, 0x00, 0x00, 0x00};
  }

  /** What one set gave: its values, or why it was dropped, and how many values were left out. */
  public record Result(@Nullable Metadata metadata, @Nullable String dropped, int outOfRange) {}

  private St0601() {}

  /**
   * Reads the KLV items of one KLV PES and decodes each ST 0601 set in it; other keys are skipped.
   * A set whose checksum is wrong is a {@code Result} with {@code dropped} {@code "checksum"}.
   */
  public static List<Result> read(byte[] payload) {
    List<Result> out = new ArrayList<>();
    int at = 0;
    while (at + 17 <= payload.length) {
      int lengthAt = at + 16;
      long[] length = ber(payload, lengthAt);
      if (length == null) {
        break;
      }
      int valueAt = (int) length[1];
      long valueLength = length[0];
      if (valueLength > payload.length - valueAt) {
        break; // cut off: the rest cannot be read
      }
      int end = valueAt + (int) valueLength;
      if (isKey(payload, at)) {
        out.add(decode(payload, at, valueAt, end));
      }
      at = end;
    }
    return out;
  }

  private static boolean isKey(byte[] d, int at) {
    byte[] key = key();
    for (int i = 0; i < 16; i++) {
      if (d[at + i] != key[i]) {
        return false;
      }
    }
    return true;
  }

  /**
   * A BER length at {@code at}: {@code {value, index of the first byte after it}}, or {@code null}
   * for one that is not valid here (indefinite, or more than 4 length bytes).
   */
  static long @Nullable [] ber(byte[] d, int at) {
    if (at >= d.length) {
      return null;
    }
    int first = d[at] & 0xFF;
    if (first < 0x80) {
      return new long[] {first, at + 1};
    }
    int n = first & 0x7F;
    if (n == 0 || n > 4 || at + 1 + n > d.length) {
      return null;
    }
    long v = 0;
    for (int i = 0; i < n; i++) {
      v = (v << 8) | (d[at + 1 + i] & 0xFF);
    }
    return new long[] {v, at + 1 + n};
  }

  /**
   * The checksum (tag 1): the sum of 16-bit big-endian words over the set from the key's first byte
   * up to and including the checksum's length byte, as a 16-bit value (an odd last byte counts as a high byte).
   */
  static int checksum(byte[] d, int from, int to) {
    int sum = 0;
    for (int i = from; i < to; i++) {
      sum += (d[i] & 0xFF) << ((i - from) % 2 == 0 ? 8 : 0);
    }
    return sum & 0xFFFF;
  }

  private static Result decode(byte[] d, int keyAt, int valueAt, int end) {
    // Tag 1 is the last item: 01 02 hi lo.
    if (end - valueAt < 4 || d[end - 4] != 1 || d[end - 3] != 2
        || checksum(d, keyAt, end - 2) != (((d[end - 2] & 0xFF) << 8) | (d[end - 1] & 0xFF))) {
      return new Result(null, "checksum", 0);
    }
    var v = new Values();
    int at = valueAt;
    int itemsEnd = end - 4;
    while (at < itemsEnd) {
      int[] tag = oid(d, at, itemsEnd);
      if (tag == null) {
        break;
      }
      long[] length = ber(d, tag[1]);
      if (length == null || length[0] > itemsEnd - length[1]) {
        break;
      }
      v.item(tag[0], d, (int) length[1], (int) length[0]);
      at = (int) length[1] + (int) length[0];
    }
    return new Result(v.build(), null, v.outOfRange);
  }

  /** A BER-OID tag: {@code {tag, index after}}, or {@code null} when it does not fit. */
  private static int @Nullable [] oid(byte[] d, int at, int end) {
    int tag = 0;
    for (int i = 0; i < 3 && at < end; i++) {
      int b = d[at++] & 0xFF;
      tag = (tag << 7) | (b & 0x7F);
      if ((b & 0x80) == 0) {
        return new int[] {tag, at};
      }
    }
    return null;
  }

  /** The values of one set, as its items come. */
  private static final class Values {
    int outOfRange;
    @Nullable Long time;
    @Nullable String mission;
    @Nullable String platform;
    @Nullable String sensor;
    @Nullable Double heading;
    @Nullable Double lat;
    @Nullable Double lon;
    @Nullable Double alt;
    @Nullable Double hFov;
    @Nullable Double vFov;
    @Nullable Double azimuth;
    @Nullable Double elevation;
    @Nullable Double slant;
    @Nullable Double fcLat;
    @Nullable Double fcLon;
    @Nullable Double fcElevation;
    @Nullable Integer version;
    Metadata.@Nullable Security security;

    void item(int tag, byte[] d, int at, int len) {
      switch (tag) {
        case 2 -> {
          Long t = len == 8 ? unsigned64(d, at) : null;
          time = t;
          bad(t == null);
        }
        case 3 -> mission = text(d, at, len);
        case 10 -> platform = text(d, at, len);
        case 11 -> sensor = text(d, at, len);
        case 5 -> heading = scaled(len, 2, unsigned(d, at, len), 360.0 / 65535, 0);
        case 13 -> lat = signed(d, at, len, 4, 90.0 / Integer.MAX_VALUE, true);
        case 14 -> lon = signed(d, at, len, 4, 180.0 / Integer.MAX_VALUE, true);
        case 15 -> alt = scaled(len, 2, unsigned(d, at, len), 19900.0 / 65535, -900);
        case 16 -> hFov = scaled(len, 2, unsigned(d, at, len), 180.0 / 65535, 0);
        case 17 -> vFov = scaled(len, 2, unsigned(d, at, len), 180.0 / 65535, 0);
        case 18 -> azimuth = scaled(len, 4, unsigned(d, at, len), 360.0 / 4294967295.0, 0);
        case 19 -> elevation = signed(d, at, len, 4, 180.0 / Integer.MAX_VALUE, true);
        case 21 -> slant = scaled(len, 4, unsigned(d, at, len), 5_000_000.0 / 4294967295.0, 0);
        case 23 -> fcLat = signed(d, at, len, 4, 90.0 / Integer.MAX_VALUE, false);
        case 24 -> fcLon = signed(d, at, len, 4, 180.0 / Integer.MAX_VALUE, false);
        case 25 -> fcElevation = scaled(len, 2, unsigned(d, at, len), 19900.0 / 65535, -900);
        case 65 -> {
          long n = unsigned(d, at, len);
          version = len >= 1 && len <= 2 ? (int) n : null;
          bad(version == null);
        }
        case 48 -> security = security(d, at, at + len);
        default -> { } // every other tag is ignored (brief section 2)
      }
    }

    private void bad(boolean b) {
      if (b) {
        outOfRange++;
      }
    }

    private @Nullable String text(byte[] d, int at, int len) {
      if (len == 0 || len > 127) {
        bad(len > 127);
        return null;
      }
      String s = new String(d, at, len, StandardCharsets.UTF_8).strip();
      return s.isEmpty() ? null : s;
    }

    /** {@code raw * scale + base}; a wrong length leaves the value out and counts it. */
    private @Nullable Double scaled(int len, int expected, long raw, double scale, double base) {
      if (len != expected) {
        outOfRange++;
        return null;
      }
      return raw * scale + base;
    }

    /**
     * A two's complement integer times a scale; the reserved value (the most negative) is an error
     * indicator. For the frame centre (tags 23 and 24) it is a valid "no frame centre" (ST 0601.14): the
     * value is left out and not counted ({@code countError} false).
     */
    private @Nullable Double signed(byte[] d, int at, int len, int expected, double scale, boolean countError) {
      if (len != expected) {
        outOfRange++;
        return null;
      }
      int raw = (int) unsigned(d, at, len);
      if (raw == Integer.MIN_VALUE) {
        if (countError) {
          outOfRange++;
        }
        return null;
      }
      return raw * scale;
    }

    Metadata build() {
      return new Metadata(time, mission, platform, sensor, heading, lat, lon, alt, hFov, vFov, azimuth, elevation, slant, fcLat, fcLon,
          fcElevation, version, security);
    }

    private Metadata.@Nullable Security security(byte[] d, int from, int to) {
      Integer classification = null;
      Integer method = null;
      String country = null;
      String releasing = null;
      Integer ver = null;
      int at = from;
      while (at < to) {
        int[] tag = oid(d, at, to);
        if (tag == null) {
          break;
        }
        long[] length = ber(d, tag[1]);
        if (length == null || length[0] > to - length[1]) {
          break;
        }
        int valueAt = (int) length[1];
        int len = (int) length[0];
        switch (tag[0]) {
          case 1 -> {
            long c = unsigned(d, valueAt, len);
            classification = len == 1 && c >= 1 && c <= 5 ? (int) c : null;
            bad(classification == null);
          }
          case 2 -> method = len == 1 ? (int) unsigned(d, valueAt, len) : null;
          case 3 -> country = ascii(d, valueAt, len);
          case 6 -> releasing = ascii(d, valueAt, len);
          case 22 -> ver = len >= 1 && len <= 2 ? (int) unsigned(d, valueAt, len) : null;
          default -> { }
        }
        at = valueAt + len;
      }
      if (classification == null && method == null && country == null && releasing == null && ver == null) {
        return null;
      }
      return new Metadata.Security(classification, method, country, releasing, ver);
    }
  }

  private static @Nullable String ascii(byte[] d, int at, int len) {
    if (len == 0 || len > 127) {
      return null;
    }
    String s = new String(d, at, len, StandardCharsets.US_ASCII).strip();
    return s.isEmpty() ? null : s;
  }

  /** An unsigned big-endian integer of up to 8 bytes (longer: 0). */
  private static long unsigned(byte[] d, int at, int len) {
    if (len > 8) {
      return 0;
    }
    long v = 0;
    for (int i = 0; i < len; i++) {
      v = (v << 8) | (d[at + i] & 0xFF);
    }
    return v;
  }

  /** The 8 bytes as microseconds, or {@code null} past the largest long. */
  private static @Nullable Long unsigned64(byte[] d, int at) {
    long v = unsigned(d, at, 8);
    return v < 0 ? null : v;
  }
}
