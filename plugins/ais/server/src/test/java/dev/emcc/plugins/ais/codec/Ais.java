package dev.emcc.plugins.ais.codec;

import java.util.ArrayList;
import java.util.List;

/**
 * A small AIS encoder for the tests: bit fields to six-bit payloads and checksummed sentences, so that
 * no frame of a recording goes into the repository. Offsets follow the gpsd document, like the decoder.
 */
public final class Ais {

  private Ais() {}

  /** A message under construction. */
  public static final class Msg {
    private final StringBuilder bits = new StringBuilder();

    public Msg uint(long value, int len) {
      for (int i = len - 1; i >= 0; i--) {
        bits.append((value >> i & 1) == 1 ? '1' : '0');
      }
      return this;
    }

    public Msg sint(long value, int len) {
      return uint(value & ((1L << len) - 1), len);
    }

    /** Six-bit text padded with {@code @} to {@code chars} characters. */
    public Msg text(String text, int chars) {
      for (int i = 0; i < chars; i++) {
        int c = i < text.length() ? text.charAt(i) : '@';
        uint(c >= 64 ? c - 64 : c, 6);
      }
      return this;
    }

    public int length() {
      return bits.length();
    }

    /** Pads to a whole number of characters; returns the payload. */
    public String payload() {
      var padded = new StringBuilder(bits);
      while (padded.length() % 6 != 0) {
        padded.append('0');
      }
      var out = new StringBuilder();
      for (int i = 0; i < padded.length(); i += 6) {
        int v = Integer.parseInt(padded.substring(i, i + 6), 2);
        out.append((char) (v + 48 > 87 ? v + 56 : v + 48));
      }
      return out.toString();
    }

    public int fill() {
      return (6 - bits.length() % 6) % 6;
    }

    /** {@code !AIVDM,1,1,,A,payload,fill*hh} */
    public String sentence() {
      return sentence("AIVDM");
    }

    public String sentence(String talker) {
      return withChecksum(talker + ",1,1,,A," + payload() + "," + fill());
    }

    /** The message cut into {@code parts} sentences with this sequence id. */
    public List<String> fragments(int parts, String sequenceId) {
      String p = payload();
      int per = (p.length() + parts - 1) / parts;
      var out = new ArrayList<String>();
      for (int i = 0; i < parts; i++) {
        String piece = p.substring(Math.min(p.length(), i * per), Math.min(p.length(), (i + 1) * per));
        out.add(withChecksum("AIVDM," + parts + "," + (i + 1) + "," + sequenceId + ",A," + piece + "," + (i == parts - 1 ? fill() : 0)));
      }
      return out;
    }
  }

  public static String withChecksum(String body) {
    int sum = 0;
    for (int i = 0; i < body.length(); i++) {
      sum ^= body.charAt(i);
    }
    return "!" + body + "*" + String.format("%02X", sum);
  }

  /** Degrees to the 1/10 000 minute units of the position fields. */
  public static long units(double degrees) {
    return Math.round(degrees * 600_000);
  }

  /** Type 1, 2 or 3: 168 bits. */
  public static Msg classA(int type, long mmsi, int navStatus, long sog, double lon, double lat, long cog, long heading) {
    return new Msg().uint(type, 6).uint(0, 2).uint(mmsi, 30).uint(navStatus, 4).sint(0, 8).uint(sog, 10).uint(1, 1)
        .sint(units(lon), 28).sint(units(lat), 27).uint(cog, 12).uint(heading, 9).uint(60, 6).uint(0, 2).uint(0, 3).uint(0, 1).uint(0, 19);
  }

  /** The same with raw lon and lat units, for values the degrees cannot make (181, 91). */
  public static Msg classARaw(long mmsi, long lonUnits, long latUnits, long sog, long cog, long heading) {
    return classARaw(1, mmsi, lonUnits, latUnits, sog, cog, heading);
  }

  /** As above, of type 1, 2 or 3. */
  public static Msg classARaw(int type, long mmsi, long lonUnits, long latUnits, long sog, long cog, long heading) {
    return new Msg().uint(type, 6).uint(0, 2).uint(mmsi, 30).uint(0, 4).sint(0, 8).uint(sog, 10).uint(1, 1)
        .sint(lonUnits, 28).sint(latUnits, 27).uint(cog, 12).uint(heading, 9).uint(60, 6).uint(0, 2).uint(0, 3).uint(0, 1).uint(0, 19);
  }

  /** Type 18: 168 bits. */
  public static Msg classB(long mmsi, long sog, double lon, double lat, long cog, long heading) {
    return new Msg().uint(18, 6).uint(0, 2).uint(mmsi, 30).uint(0, 8).uint(sog, 10).uint(1, 1)
        .sint(units(lon), 28).sint(units(lat), 27).uint(cog, 12).uint(heading, 9).uint(60, 6).uint(0, 2).uint(0, 7).uint(0, 20);
  }

  /** Type 19: 312 bits. */
  public static Msg extendedB(long mmsi, long sog, double lon, double lat, long cog, long heading, String name, int shipType, int bow, int stern, int port, int starboard) {
    return new Msg().uint(19, 6).uint(0, 2).uint(mmsi, 30).uint(0, 8).uint(sog, 10).uint(1, 1)
        .sint(units(lon), 28).sint(units(lat), 27).uint(cog, 12).uint(heading, 9).uint(60, 6).uint(0, 4).text(name, 20)
        .uint(shipType, 8).uint(bow, 9).uint(stern, 9).uint(port, 6).uint(starboard, 6).uint(0, 4).uint(0, 1).uint(0, 1).uint(0, 1).uint(0, 4);
  }

  /** Type 5: 424 bits. */
  public static Msg voyage(long mmsi, long imo, String callSign, String name, int shipType, int bow, int stern, int port, int starboard, int draughtTenths, String destination) {
    return new Msg().uint(5, 6).uint(0, 2).uint(mmsi, 30).uint(0, 2).uint(imo, 30).text(callSign, 7).text(name, 20).uint(shipType, 8)
        .uint(bow, 9).uint(stern, 9).uint(port, 6).uint(starboard, 6).uint(1, 4).uint(0, 4).uint(0, 5).uint(24, 5).uint(60, 6)
        .uint(draughtTenths, 8).text(destination, 20).uint(0, 1).uint(0, 1);
  }

  /** Type 24 part A: 168 bits. */
  public static Msg partA(long mmsi, String name) {
    return new Msg().uint(24, 6).uint(0, 2).uint(mmsi, 30).uint(0, 2).text(name, 20).uint(0, 8);
  }

  /** Type 24 part B: 168 bits. */
  public static Msg partB(long mmsi, int shipType, String callSign, int bow, int stern, int port, int starboard) {
    return new Msg().uint(24, 6).uint(0, 2).uint(mmsi, 30).uint(1, 2).uint(shipType, 8).text("", 3).uint(0, 4).uint(0, 20)
        .text(callSign, 7).uint(bow, 9).uint(stern, 9).uint(port, 6).uint(starboard, 6).uint(0, 6);
  }

  /** A message of another type: the type, a repeat indicator, an MMSI and zeros up to {@code bits}. */
  public static Msg other(int type, long mmsi, int bits) {
    Msg m = new Msg().uint(type, 6).uint(0, 2).uint(mmsi, 30);
    return m.uint(0, bits - m.length());
  }
}
