package dev.emcc.sdk.json;

import java.math.BigDecimal;
import java.util.Objects;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * A JSON number, kept <b>exactly as written</b> (its text), so that no precision is lost when it
 * is forwarded (ADR-0007). Two numbers are equal when their values are equal: {@code 1.50},
 * {@code 1.5} and {@code 15e-1} are equal, and so are {@code -0.0} and {@code 0}.
 *
 * <pre>{@code
 * JsonNumber n = JsonNumber.of("123456789012345678901234567890");
 * n.text();             // "123456789012345678901234567890", unchanged
 * n.bigDecimalValue();  // exact
 * n.doubleValue();      // rounded
 * }</pre>
 *
 * @param text the number in JSON syntax (RFC 8259)
 */
public record JsonNumber(String text) implements JsonValue {

  private static final Pattern SYNTAX = Pattern.compile("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?");

  public JsonNumber {
    Objects.requireNonNull(text, "text");
    if (!SYNTAX.matcher(text).matches()) {
      throw new IllegalArgumentException("not a JSON number: " + text);
    }
    try {
      new BigDecimal(text);
    } catch (NumberFormatException e) {
      throw new IllegalArgumentException("JSON number out of range: " + text, e);
    }
  }

  /** The number as written. */
  public static JsonNumber of(String text) {
    return new JsonNumber(text);
  }

  public static JsonNumber of(long value) {
    return new JsonNumber(Long.toString(value));
  }

  /** The shortest text that reads back as {@code value}. Not for NaN or infinities. */
  public static JsonNumber of(double value) {
    if (!Double.isFinite(value)) {
      throw new IllegalArgumentException("JSON has no NaN or infinity: " + value);
    }
    return new JsonNumber(BigDecimal.valueOf(value).toString().replace("E+", "e").replace("E", "e"));
  }

  public static JsonNumber of(BigDecimal value) {
    return new JsonNumber(value.toString().replace("E+", "e").replace("E", "e"));
  }

  /** The exact value. */
  public BigDecimal bigDecimalValue() {
    return new BigDecimal(text);
  }

  /** The value rounded to the nearest double. */
  public double doubleValue() {
    return Double.parseDouble(text);
  }

  /** The value as a long, if it is an integer that fits. */
  public long longValueExact() {
    return bigDecimalValue().longValueExact();
  }

  @Override
  public boolean equals(@Nullable Object other) {
    return other instanceof JsonNumber n && bigDecimalValue().compareTo(n.bigDecimalValue()) == 0;
  }

  @Override
  public int hashCode() {
    BigDecimal v = bigDecimalValue();
    return v.signum() == 0 ? 0 : v.stripTrailingZeros().hashCode();
  }

  @Override
  public String toString() {
    return text;
  }
}
