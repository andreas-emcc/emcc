package dev.emcc.plugins.ais.codec;

import org.jspecify.annotations.Nullable;

/**
 * Decodes the payload of a complete message: types 1, 2, 3, 5, 18, 19 and 24; every other type is
 * ignored. Bit offsets are from the gpsd project's "AIVDM/AIVDO protocol decoding", per message
 * type. A value outside its range is left out like one that is not available, and counted (owner,
 * 2026-10-31: EM); the rest of the message is used. Never throws.
 */
public final class AisDecoder {

  public static final String TOO_SHORT = "dropped: too short";
  public static final String MALFORMED = "dropped: malformed";
  public static final String NO_POSITION = "no position";

  private static final long LON_NOT_AVAILABLE = 181L * 600_000;
  private static final long LAT_NOT_AVAILABLE = 91L * 600_000;
  private static final long LON_MAX = 180L * 600_000;
  private static final long LAT_MAX = 90L * 600_000;

  private AisDecoder() {}

  public static String ignored(int type) {
    return "ignored: type " + type;
  }

  public static Decoded decode(String payload, int fillBits) {
    Bits b = new Bits(payload, fillBits);
    if (!b.has(6)) {
      return refused(TOO_SHORT);
    }
    int type = (int) b.uint(0, 6);
    return switch (type) {
      case 1, 2, 3 -> position(b, 137, 61, 89, 116, 50, 128, 38, AisClass.A);
      case 18 -> position(b, 133, 57, 85, 112, 46, 124, -1, AisClass.B);
      case 19 -> type19(b);
      case 5 -> type5(b);
      case 24 -> type24(b);
      default -> new Decoded(null, ignored(type), 0);
    };
  }

  private static Decoded refused(String reason) {
    return new Decoded(null, reason, 0);
  }

  /** The MMSI, or -1 when it is not a valid one (0, or more than nine digits). */
  private static int mmsi(Bits b) {
    long v = b.uint(8, 30);
    return v >= 1 && v <= 999_999_999 ? (int) v : -1;
  }

  /** Counts the values left out; shared by the decoders of one message. */
  private static final class Range {
    int out;

    @Nullable Double course(long raw) {
      if (raw == 3600) {
        return null;
      }
      if (raw > 3600) {
        out++;
        return null;
      }
      return raw / 10.0;
    }

    @Nullable Integer heading(long raw) {
      if (raw == 511) {
        return null;
      }
      if (raw > 359) {
        out++;
        return null;
      }
      return (int) raw;
    }

    @Nullable Double speed(long raw) {
      return raw == 1023 ? null : raw / 10.0;
    }

    @Nullable Integer shipType(long raw) {
      if (raw > 99) {
        out++;
        return null;
      }
      return (int) raw;
    }
  }

  private static Decoded position(Bits b, int need, int lonAt, int latAt, int cogAt, int sogAt, int hdgAt, int navAt, AisClass cls) {
    if (!b.has(need)) {
      return refused(TOO_SHORT);
    }
    int mmsi = mmsi(b);
    if (mmsi < 0) {
      return refused(MALFORMED);
    }
    var r = new Range();
    return positioned(b, r, mmsi, lonAt, latAt, cogAt, sogAt, hdgAt, navAt, AisStatic.of(cls));
  }

  private static Decoded positioned(Bits b, Range r, int mmsi, int lonAt, int latAt, int cogAt, int sogAt, int hdgAt, int navAt, AisStatic statics) {
    long lon = b.sint(lonAt, 28);
    long lat = b.sint(latAt, 27);
    boolean lonOk = lon != LON_NOT_AVAILABLE && Math.abs(lon) <= LON_MAX;
    boolean latOk = lat != LAT_NOT_AVAILABLE && Math.abs(lat) <= LAT_MAX;
    if (lon != LON_NOT_AVAILABLE && !lonOk) {
      r.out++;
    }
    if (lat != LAT_NOT_AVAILABLE && !latOk) {
      r.out++;
    }
    if (!lonOk || !latOk) {
      return new Decoded(null, NO_POSITION, r.out); // either one: no position from this message
    }
    Double course = r.course(b.uint(cogAt, 12));
    Double speed = r.speed(b.uint(sogAt, 10));
    Integer heading = r.heading(b.uint(hdgAt, 9));
    Integer nav = null;
    if (navAt >= 0) {
      long v = b.uint(navAt, 4);
      nav = v == 15 ? null : (int) v;
    }
    var message = new AisMessage.Position(mmsi, lon / 600_000.0, lat / 600_000.0, course, speed, heading, nav, statics);
    return new Decoded(message, null, r.out);
  }

  private static Decoded type19(Bits b) {
    if (!b.has(301)) {
      return refused(TOO_SHORT);
    }
    int mmsi = mmsi(b);
    if (mmsi < 0) {
      return refused(MALFORMED);
    }
    var r = new Range();
    var statics = new AisStatic(b.text(143, 120), null, null, r.shipType(b.uint(263, 8)), size(b, 271, 280), size(b, 289, 295, 6), null, null, AisClass.B);
    return positioned(b, r, mmsi, 57, 85, 112, 46, 124, -1, statics);
  }

  private static Decoded type5(Bits b) {
    if (!b.has(302)) {
      return refused(TOO_SHORT);
    }
    int mmsi = mmsi(b);
    if (mmsi < 0) {
      return refused(MALFORMED);
    }
    var r = new Range();
    long imo = b.uint(40, 30);
    long draught = b.uint(294, 8);
    // The destination ends at bit 422; many transmitters stop at 420. From 420 the missing bits read as padding; less: no destination.
    String destination = b.has(420) ? b.text(302, 120) : null;
    var statics = new AisStatic(
        b.text(112, 120), b.text(70, 42), imo == 0 ? null : (int) Math.min(imo, Integer.MAX_VALUE), r.shipType(b.uint(232, 8)),
        size(b, 240, 249), size(b, 258, 264, 6), draught == 0 ? null : draught / 10.0, destination, AisClass.A);
    return new Decoded(new AisMessage.StaticReport(mmsi, statics), null, r.out);
  }

  private static Decoded type24(Bits b) {
    if (!b.has(40)) {
      return refused(TOO_SHORT);
    }
    int part = (int) b.uint(38, 2);
    if (part > 1) {
      return new Decoded(null, ignored(24), 0);
    }
    if (!b.has(part == 0 ? 160 : 162)) {
      return refused(TOO_SHORT);
    }
    int mmsi = mmsi(b);
    if (mmsi < 0) {
      return refused(MALFORMED);
    }
    var r = new Range();
    AisStatic statics;
    if (part == 0) {
      statics = new AisStatic(b.text(40, 120), null, null, null, null, null, null, null, AisClass.B);
    } else {
      boolean auxiliary = mmsi / 10_000_000 == 98; // an auxiliary craft sends its mother ship's MMSI where the size would be
      statics = new AisStatic(
          null, b.text(90, 42), null, r.shipType(b.uint(40, 8)), auxiliary ? null : size(b, 132, 141), auxiliary ? null : size(b, 150, 156, 6), null, null, AisClass.B);
    }
    return new Decoded(new AisMessage.StaticReport(mmsi, statics), null, r.out);
  }

  /** Two 9-bit distances that add up to a length; not available if they add up to 0. */
  private static @Nullable Integer size(Bits b, int first, int second) {
    int sum = (int) (b.uint(first, 9) + b.uint(second, 9));
    return sum == 0 ? null : sum;
  }

  /** Two 6-bit distances that add up to a breadth; not available if they add up to 0. */
  private static @Nullable Integer size(Bits b, int first, int second, int bits) {
    int sum = (int) (b.uint(first, bits) + b.uint(second, bits));
    return sum == 0 ? null : sum;
  }
}
