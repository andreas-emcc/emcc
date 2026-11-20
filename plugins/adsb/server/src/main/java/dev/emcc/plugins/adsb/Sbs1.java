package dev.emcc.plugins.adsb;

import java.util.Locale;
import java.util.Set;
import org.jspecify.annotations.Nullable;

/**
 * Parses one SBS-1 (BaseStation) line, as dump1090 and readsb send it on port 30003. Pure: no I/O,
 * no state, and never an exception: every line gives a {@link Result}. For each message type only
 * the fields the brief uses are read and checked.
 *
 * <p>A field out of range drops that value only: the rest of the line still applies (owner, 2026-10-31).
 * A field that does not parse at all drops the whole line.
 *
 * <p>Latitude comes before longitude in the fields, the format's own order. {@link Message} names
 * the two, so nothing downstream can swap them.
 */
public final class Sbs1 {

  /** The fields of a {@code MSG} line. */
  static final int FIELDS = 22;

  /** The record kinds that are ignored, as the brief lists them. */
  private static final Set<String> IGNORED_KINDS = Set.of("SEL", "ID", "AIR", "STA", "CLK");

  private Sbs1() {}

  /** What a line gave. */
  public sealed interface Result permits Result.Parsed, Result.Ignored, Result.Refused {

    /** A message with the fields of its type; a value out of range is missing from it and counted in {@link Message#outOfRange()}. */
    record Parsed(Message message) implements Result {}

    /** A kind of line that is not used, counted as {@code ignored: <kind>}. */
    record Ignored(String kind) implements Result {}

    /** A line that is dropped, counted as {@code dropped: malformed} or {@code dropped: not icao}. */
    record Refused(String reason) implements Result {}
  }

  /**
   * One {@code MSG} line with the fields its type uses. A field the line leaves empty, or its type
   * does not carry, is {@code null}; so is a field out of range, which is counted in {@code outOfRange}.
   * A position is both latitude and longitude, or neither.
   *
   * @param type the message type, 1 to 6
   * @param icao24 the aircraft's ICAO 24-bit address: six upper-case hex digits
   * @param callsign the trimmed callsign, or {@code null}
   * @param altitudeFt barometric altitude in feet, or {@code null}
   * @param groundSpeedKt ground speed in knots, or {@code null}
   * @param trackDegrees track in degrees, 0 to 360, or {@code null}
   * @param latitude WGS84 latitude, or {@code null}
   * @param longitude WGS84 longitude, or {@code null}
   * @param verticalRateFpm vertical rate in feet per minute, or {@code null}
   * @param squawk four octal digits as text, or {@code null}
   * @param emergency whether the line says so, or {@code null} when it is unknown
   * @param onGround whether the line says so, or {@code null} when it is unknown
   * @param noPosition a position line (type 2 or 3) whose latitude or longitude is empty or out of range
   * @param outOfRange how many values of the line were out of range and dropped
   */
  public record Message(
      int type,
      String icao24,
      @Nullable String callsign,
      @Nullable Integer altitudeFt,
      @Nullable Double groundSpeedKt,
      @Nullable Double trackDegrees,
      @Nullable Double latitude,
      @Nullable Double longitude,
      @Nullable Integer verticalRateFpm,
      @Nullable String squawk,
      @Nullable Boolean emergency,
      @Nullable Boolean onGround,
      boolean noPosition,
      int outOfRange) {}

  /** Parses one line, without its line end. */
  public static Result parse(String line) {
    String[] f = line.split(",", -1);
    String kind = f[0];
    if (!"MSG".equals(kind)) {
      return IGNORED_KINDS.contains(kind) ? new Result.Ignored(kind) : new Result.Refused("malformed");
    }
    if (f.length != FIELDS) {
      return new Result.Refused("malformed");
    }
    int type;
    try {
      type = Integer.parseInt(f[1].trim());
    } catch (NumberFormatException e) {
      return new Result.Refused("malformed");
    }
    if (type < 1 || type > 6) {
      return new Result.Ignored("MSG," + type);
    }
    String icao = icao(f[4]);
    if (icao == null) {
      return new Result.Refused("not icao");
    }
    try {
      return new Result.Parsed(message(type, icao, f));
    } catch (Refusal e) {
      return new Result.Refused(e.reason);
    }
  }

  /** The fields of a type. A field that does not parse refuses the whole line; one out of range is dropped alone. */
  private static Message message(int type, String icao, String[] f) throws Refusal {
    Ranges out = new Ranges();
    String callsign = type == 1 ? callsign(f[10]) : null;
    Integer altitude = type == 2 || type == 3 || type == 5 || type == 6 ? altitude(f[11], out) : null;
    Double speed = type == 2 || type == 4 ? speed(f[12], out) : null;
    Double track = type == 2 || type == 4 ? track(f[13], out) : null;
    Double lat = null;
    Double lon = null;
    boolean noPosition = false;
    if (type == 2 || type == 3) {
      if (f[14].isBlank() || f[15].isBlank()) {
        noPosition = true;
      } else {
        lat = latitude(f[14], out);
        lon = longitude(f[15], out);
        if (lat == null || lon == null) {
          lat = null; // a position needs both: one out of range leaves out the position, and it counts as no position
          lon = null;
          noPosition = true;
        }
      }
    }
    Integer vertical = type == 4 ? vertical(f[16], out) : null;
    String squawk = type == 6 ? squawk(f[17], out) : null;
    Boolean emergency = type == 3 || type == 6 ? flag(f[19], out) : null;
    Boolean onGround = type == 2 || type == 3 || type == 5 || type == 6 ? flag(f[21], out) : null;
    return new Message(type, icao, callsign, altitude, speed, track, lat, lon, vertical, squawk, emergency, onGround,
        noPosition, out.count);
  }

  /** Six hex digits, upper-cased; anything else (a {@code ~} address, for one) is {@code null}. */
  static @Nullable String icao(String hex) {
    if (hex.length() != 6) {
      return null;
    }
    for (int i = 0; i < 6; i++) {
      if (Character.digit(hex.charAt(i), 16) < 0) {
        return null;
      }
    }
    return hex.toUpperCase(Locale.ROOT);
  }

  /**
   * The callsign, trimmed. A callsign that is not one to eight letters, digits, hyphens or
   * underscores is taken as absent: it is only a name, so it does not refuse the line.
   */
  static @Nullable String callsign(String text) {
    String value = text.trim();
    if (value.isEmpty()) {
      return null;
    }
    return value.matches("[A-Za-z0-9_-]{1,8}") ? value : null;
  }

  static @Nullable Integer altitude(String text, Ranges out) throws Refusal {
    Integer value = integer(text);
    if (value != null && (value < -2_000 || value > 100_000)) {
      out.count++;
      return null;
    }
    return value;
  }

  static @Nullable Double speed(String text, Ranges out) throws Refusal {
    Double value = number(text);
    if (value != null && (value < 0 || value > 2_000)) {
      out.count++;
      return null;
    }
    return value;
  }

  /** A track of 360 is north, as 0: the mapper does that. */
  static @Nullable Double track(String text, Ranges out) throws Refusal {
    Double value = number(text);
    if (value != null && (value < 0 || value > 360)) {
      out.count++;
      return null;
    }
    return value;
  }

  static @Nullable Double latitude(String text, Ranges out) throws Refusal {
    Double value = number(text);
    if (value == null) {
      throw new Refusal("malformed");
    }
    if (value < -90 || value > 90) {
      out.count++;
      return null;
    }
    return value;
  }

  static @Nullable Double longitude(String text, Ranges out) throws Refusal {
    Double value = number(text);
    if (value == null) {
      throw new Refusal("malformed");
    }
    if (value < -180 || value > 180) {
      out.count++;
      return null;
    }
    return value;
  }

  static @Nullable Integer vertical(String text, Ranges out) throws Refusal {
    Integer value = integer(text);
    if (value != null && (value < -50_000 || value > 50_000)) {
      out.count++;
      return null;
    }
    return value;
  }

  /** Four octal digits, 0 to 7 each. */
  static @Nullable String squawk(String text, Ranges out) throws Refusal {
    String value = text.trim();
    if (value.isEmpty()) {
      return null;
    }
    if (!value.matches("[0-9]{4}")) {
      throw new Refusal("malformed");
    }
    if (value.chars().anyMatch(c -> c > '7')) {
      out.count++;
      return null;
    }
    return value;
  }

  /** The emergency and on-ground flags: 0 is false, -1 and 1 are true, empty is unknown. */
  static @Nullable Boolean flag(String text, Ranges out) throws Refusal {
    Integer value = integer(text);
    if (value == null) {
      return null;
    }
    return switch (value) {
      case 0 -> Boolean.FALSE;
      case -1, 1 -> Boolean.TRUE;
      default -> {
        out.count++;
        yield null;
      }
    };
  }

  private static @Nullable Integer integer(String text) throws Refusal {
    String value = text.trim();
    if (value.isEmpty()) {
      return null;
    }
    try {
      return Integer.parseInt(value);
    } catch (NumberFormatException e) {
      throw new Refusal("malformed");
    }
  }

  private static @Nullable Double number(String text) throws Refusal {
    String value = text.trim();
    if (value.isEmpty()) {
      return null;
    }
    double parsed;
    try {
      parsed = Double.parseDouble(value);
    } catch (NumberFormatException e) {
      throw new Refusal("malformed");
    }
    if (!Double.isFinite(parsed)) {
      throw new Refusal("malformed");
    }
    return parsed;
  }

  /** How many values of one line were out of range. */
  static final class Ranges {
    int count;
  }

  /** A line that is dropped as a whole; it never leaves {@link Sbs1#parse}. */
  static final class Refusal extends Exception {
    private static final long serialVersionUID = 1L;
    final String reason;

    Refusal(String reason) {
      super(reason, null, false, false);
      this.reason = reason;
    }
  }
}
