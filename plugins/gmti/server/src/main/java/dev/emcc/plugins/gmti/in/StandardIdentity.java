package dev.emcc.plugins.gmti.in;

import java.util.Locale;
import org.jspecify.annotations.Nullable;

/**
 * The standard identity of an APP-6D symbol, as a link's {@code platformIdentity} setting names it
 * (the same names as {@code ais}'s), with the colour of the platform's dwell area outline: APP-6's
 * medium frame colours, so that a thin line shows on a map.
 */
public enum StandardIdentity {
  PENDING('0', "#FFFF00"),
  UNKNOWN('1', "#FFFF00"),
  ASSUMED_FRIEND('2', "#00A8DC"),
  FRIEND('3', "#00A8DC"),
  NEUTRAL('4', "#00E200"),
  SUSPECT('5', "#FF3031"),
  HOSTILE('6', "#FF3031");

  private final char digit;
  private final String colour;

  StandardIdentity(char digit, String colour) {
    this.digit = digit;
    this.colour = colour;
  }

  /** The digit in the SIDC (position 4). */
  public char digit() {
    return digit;
  }

  /** The outline colour of the identity, {@code #RRGGBB}. */
  public String colour() {
    return colour;
  }

  /** As in the settings: {@code unknown}, {@code assumed-friend}, ... */
  public String json() {
    return name().toLowerCase(Locale.ROOT).replace('_', '-');
  }

  /** The identity with this setting value, or {@code null}. */
  public static @Nullable StandardIdentity fromJson(String value) {
    for (StandardIdentity i : values()) {
      if (i.json().equals(value)) {
        return i;
      }
    }
    return null;
  }
}
