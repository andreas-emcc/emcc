package dev.emcc.plugins.ais.codec;

import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * Reads one line as an AIVDM sentence: skips a tag block, checks the checksum and the seven fields.
 * Every refusal comes back with the reason the counters use ({@code dropped: <reason>}); nothing
 * throws.
 */
public final class Nmea {

  /** The reasons, as the counters name them (after {@code dropped: }). */
  public static final String NO_CHECKSUM = "no checksum";
  public static final String CHECKSUM = "checksum";
  public static final String MALFORMED = "malformed";

  private static final Pattern TALKER = Pattern.compile("[A-Z]{2}VD[MO]");

  private Nmea() {}

  /** A sentence, or the reason for refusing the line. Exactly one is set. */
  public record Parsed(@Nullable Sentence sentence, @Nullable String reason) {}

  public static Parsed parse(String line) {
    String s = line;
    if (s.startsWith("\\")) { // IEC 61162-450 tag block: \...\ before the sentence, ignored
      int end = s.indexOf('\\', 1);
      if (end < 0) {
        return refuse(MALFORMED);
      }
      s = s.substring(end + 1);
    }
    if (!s.startsWith("!")) {
      return refuse(MALFORMED);
    }
    int star = s.indexOf('*');
    if (star < 0 || s.length() < star + 3) {
      return refuse(NO_CHECKSUM);
    }
    int given = hex(s.charAt(star + 1)) << 4 | hex(s.charAt(star + 2));
    if (hex(s.charAt(star + 1)) < 0 || hex(s.charAt(star + 2)) < 0) {
      return refuse(NO_CHECKSUM);
    }
    int sum = 0;
    for (int i = 1; i < star; i++) {
      sum ^= s.charAt(i);
    }
    if (sum != given) {
      return refuse(CHECKSUM);
    }
    if (s.length() > star + 3) {
      return refuse(MALFORMED); // something after the checksum, e.g. a trailing tag
    }
    String[] f = s.substring(1, star).split(",", -1);
    if (f.length != 7 || !TALKER.matcher(f[0]).matches()) {
      return refuse(MALFORMED);
    }
    Integer count = digit(f[1], 1, 9);
    Integer number = digit(f[2], 1, 9);
    Integer fill = digit(f[6], 0, 5);
    if (count == null || number == null || fill == null || number > count || f[3].length() > 8 || f[4].length() > 1 || !sixBit(f[5])) {
      return refuse(MALFORMED);
    }
    return new Parsed(new Sentence(count, number, f[3], f[4], f[5], fill), null);
  }

  private static Parsed refuse(String reason) {
    return new Parsed(null, reason);
  }

  private static @Nullable Integer digit(String text, int min, int max) {
    if (text.length() != 1 || text.charAt(0) < '0' || text.charAt(0) > '9') {
      return null;
    }
    int v = text.charAt(0) - '0';
    return v >= min && v <= max ? v : null;
  }

  private static boolean sixBit(String payload) {
    if (payload.isEmpty()) {
      return false;
    }
    for (int i = 0; i < payload.length(); i++) {
      char c = payload.charAt(i);
      if (!(c >= '0' && c <= 'W') && !(c >= '`' && c <= 'w')) {
        return false;
      }
    }
    return true;
  }

  private static int hex(char c) {
    if (c >= '0' && c <= '9') {
      return c - '0';
    }
    if (c >= 'A' && c <= 'F') {
      return c - 'A' + 10;
    }
    if (c >= 'a' && c <= 'f') {
      return c - 'a' + 10;
    }
    return -1;
  }
}
