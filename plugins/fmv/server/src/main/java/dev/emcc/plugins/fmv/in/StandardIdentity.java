package dev.emcc.plugins.fmv.in;

import java.util.Locale;
import org.jspecify.annotations.Nullable;

/**
 * The standard identity of the camera's APP-6D symbol, as a link's {@code cameraIdentity} setting
 * names it (the names {@code gmti} and {@code ais} use; plugins share no code, so it is copied).
 */
public enum StandardIdentity {
  PENDING('0'),
  UNKNOWN('1'),
  ASSUMED_FRIEND('2'),
  FRIEND('3'),
  NEUTRAL('4'),
  SUSPECT('5'),
  HOSTILE('6');

  private final char digit;

  StandardIdentity(char digit) {
    this.digit = digit;
  }

  /** The digit in the SIDC (position 4). */
  public char digit() {
    return digit;
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
