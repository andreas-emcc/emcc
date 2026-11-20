package dev.emcc.sdk.model;

import java.util.Collections;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * The amplifiers of a symbol: text amplifiers, plus {@code direction} (degrees clockwise from true
 * north) and {@code speed} (metres per second over ground) as numbers. SDK 1.4.0 (CR-0030 part 2,
 * ADR-0043 point 9) adds the numbers of tactical graphics: {@code distances} (AM, metres) and
 * {@code azimuths} (AN, degrees clockwise from true north), each in the order the graphic defines
 * (the symbology service's catalogue). Single-point symbols ignore them.
 *
 * <pre>{@code
 * Modifiers m = Modifiers.builder()
 *     .text(TextModifier.UNIQUE_DESIGNATION, "VIPER 2")
 *     .direction(270).speed(4.2)
 *     .build();
 * m.text(TextModifier.UNIQUE_DESIGNATION)   // "VIPER 2"
 * }</pre>
 *
 * @param texts the text amplifiers, 1 to 128 characters each
 * @param direction 0 <= direction < 360, or {@code null}
 * @param speed >= 0, or {@code null}
 * @param distances SDK 1.4.0: AM, 0 to 64 values, each 0 <= d <= {@value #MAX_DISTANCE} metres; empty
 *     when absent
 * @param azimuths SDK 1.4.0: AN, 0 to 64 values, each 0 <= a <= 360; empty when absent
 */
public record Modifiers(
    Map<TextModifier, String> texts,
    @Nullable Double direction,
    @Nullable Double speed,
    List<Double> distances,
    List<Double> azimuths) {

  /** SDK 1.4.0: the most values in {@code distances} or {@code azimuths}. */
  public static final int MAX_VALUES = 64;

  /** SDK 1.4.0: the largest distance, in metres. */
  public static final double MAX_DISTANCE = 20_000_000;

  public Modifiers {
    var copy = new EnumMap<TextModifier, String>(TextModifier.class);
    texts.forEach((k, v) -> {
      Objects.requireNonNull(k, "modifier");
      Objects.requireNonNull(v, "value");
      if (v.isEmpty() || v.length() > TextModifier.MAX_LENGTH) {
        throw new IllegalArgumentException(k.json() + " must be 1.." + TextModifier.MAX_LENGTH + " characters");
      }
      copy.put(k, v);
    });
    texts = Collections.unmodifiableMap(copy);
    if (direction != null && !(direction >= 0 && direction < 360)) {
      throw new IllegalArgumentException("direction must be 0 <= d < 360: " + direction);
    }
    if (speed != null && !(speed >= 0 && Double.isFinite(speed))) {
      throw new IllegalArgumentException("speed must be >= 0: " + speed);
    }
    distances = checked("distances", distances, MAX_DISTANCE);
    azimuths = checked("azimuths", azimuths, 360);
  }

  /** The SDK 1.3.0 form, without distances and azimuths. */
  public Modifiers(Map<TextModifier, String> texts, @Nullable Double direction, @Nullable Double speed) {
    this(texts, direction, speed, List.of(), List.of());
  }

  private static List<Double> checked(String name, List<Double> values, double max) {
    Objects.requireNonNull(values, name);
    if (values.size() > MAX_VALUES) {
      throw new IllegalArgumentException(name + " has more than " + MAX_VALUES + " values");
    }
    for (Double v : values) {
      if (v == null || !(v >= 0 && v <= max)) {
        throw new IllegalArgumentException(name + " must be 0.." + max + ": " + v);
      }
    }
    return List.copyOf(values);
  }

  public static Builder builder() {
    return new Builder();
  }

  /** A text amplifier, or {@code null}. */
  public @Nullable String text(TextModifier modifier) {
    return texts.get(modifier);
  }

  public boolean isEmpty() {
    return texts.isEmpty() && direction == null && speed == null && distances.isEmpty() && azimuths.isEmpty();
  }

  /** Builds {@link Modifiers}. Not thread-safe. */
  public static final class Builder {
    private final EnumMap<TextModifier, String> texts = new EnumMap<>(TextModifier.class);
    private @Nullable Double direction;
    private @Nullable Double speed;
    private List<Double> distances = List.of();
    private List<Double> azimuths = List.of();

    private Builder() {}

    public Builder text(TextModifier modifier, String value) {
      texts.put(modifier, value);
      return this;
    }

    public Builder direction(double degrees) {
      this.direction = degrees;
      return this;
    }

    public Builder speed(double metresPerSecond) {
      this.speed = metresPerSecond;
      return this;
    }

    /** SDK 1.4.0: AM, in metres, in the graphic's order. */
    public Builder distances(List<Double> metres) {
      this.distances = metres;
      return this;
    }

    /** SDK 1.4.0: AN, in degrees clockwise from true north, in the graphic's order. */
    public Builder azimuths(List<Double> degrees) {
      this.azimuths = degrees;
      return this;
    }

    public Modifiers build() {
      return new Modifiers(texts, direction, speed, distances, azimuths);
    }
  }
}
