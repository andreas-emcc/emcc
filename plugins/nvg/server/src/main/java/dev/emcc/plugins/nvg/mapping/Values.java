package dev.emcc.plugins.nvg.mapping;

import dev.emcc.plugins.nvg.codec.Item;
import dev.emcc.sdk.model.Position;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** Reading and writing NVG's numbers, coordinates and times. */
final class Values {

  private Values() {}

  /** A value an item cannot do without is missing or bad: the item is skipped with this counter. */
  static final class Bad extends RuntimeException {
    private static final long serialVersionUID = 1L;
    final String counter;

    Bad(String counter, String reason) {
      super(reason, null, false, false);
      this.counter = counter;
    }
  }

  /** A required number in {@code [min, max]}. */
  static double required(@Nullable String text, String name, double min, double max) {
    if (text == null) {
      throw new Bad("skipped: bad geometry", name + " is missing");
    }
    Double value = parse(text);
    if (value == null || value < min || value > max) {
      throw new Bad("skipped: bad geometry", name + " is not a number from " + min + " to " + max + ": " + text);
    }
    return value;
  }

  /** An optional number: {@code null} when absent, and when out of range (noted). */
  static @Nullable Double optional(@Nullable String text, String name, double min, double max, List<String> notes) {
    if (text == null) {
      return null;
    }
    Double value = parse(text);
    if (value == null || value < min || value > max) {
      notes.add("value out of range");
      return null;
    }
    return value;
  }

  static @Nullable Double parse(String text) {
    try {
      double d = Double.parseDouble(text.strip());
      return Double.isFinite(d) ? d : null;
    } catch (NumberFormatException e) {
      return null;
    }
  }

  static Position position(@Nullable String x, @Nullable String y) {
    return Position.of(required(x, "x", -180, 180), required(y, "y", -90, 90));
  }

  static Position center(Item item) {
    return Position.of(required(item.attribute("cx"), "cx", -180, 180), required(item.attribute("cy"), "cy", -90, 90));
  }

  /** A {@code points} list: {@code lon,lat} pairs separated by white space, at least {@code min}. */
  static List<Position> points(@Nullable String text, int min) {
    if (text == null) {
      throw new Bad("skipped: bad geometry", "points is missing");
    }
    List<Position> out = new ArrayList<>();
    for (String token : text.strip().split("\\s+")) {
      if (token.isEmpty()) {
        continue;
      }
      int comma = token.indexOf(',');
      if (comma < 0 || token.indexOf(',', comma + 1) >= 0) {
        throw new Bad("skipped: bad geometry", "a point is not lon,lat: " + clip(token));
      }
      out.add(Position.of(
          required(token.substring(0, comma), "longitude", -180, 180),
          required(token.substring(comma + 1), "latitude", -90, 90)));
    }
    if (out.size() < min) {
      throw new Bad("skipped: bad geometry", "fewer than " + min + " points");
    }
    return out;
  }

  /** {@code lon,lat lon,lat ...} */
  static String points(List<Position> positions) {
    StringBuilder b = new StringBuilder();
    for (Position p : positions) {
      if (!b.isEmpty()) {
        b.append(' ');
      }
      b.append(coordinate(p.longitude())).append(',').append(coordinate(p.latitude()));
    }
    return b.toString();
  }

  /** A coordinate in degrees, plain, at most 12 decimals (NVG's LongLatType allows no exponent). */
  static String coordinate(double degrees) {
    return plain(degrees, 12);
  }

  /** A length in metres or an angle in degrees, plain, at most 6 decimals. */
  static String number(double value) {
    return plain(value, 6);
  }

  private static String plain(double value, int scale) {
    String s = BigDecimal.valueOf(value).setScale(scale, RoundingMode.HALF_EVEN).stripTrailingZeros().toPlainString();
    return s.equals("-0") ? "0" : s;
  }

  /** An {@code xs:dateTime}; one without a zone is read as UTC. {@code null} when it does not parse (noted). */
  static @Nullable Instant time(@Nullable String text, List<String> notes) {
    if (text == null || text.isBlank()) {
      return null;
    }
    try {
      return OffsetDateTime.parse(text.strip()).toInstant();
    } catch (DateTimeParseException e) {
      try {
        return LocalDateTime.parse(text.strip()).toInstant(ZoneOffset.UTC);
      } catch (DateTimeParseException e2) {
        notes.add("value out of range");
        return null;
      }
    }
  }

  /** Degrees normalised to {@code [0, 360)}. */
  static double bearing(double degrees) {
    double b = degrees % 360;
    if (b < 0) {
      b += 360;
    }
    return b >= 360 ? 0 : b;
  }

  static String clip(String text) {
    return text.length() <= 40 ? text : text.substring(0, 40) + "…";
  }
}
