package dev.emcc.plugins.gmti.format;

/**
 * The format's angle and number encodings (AEDP-4607 Annex C-4; the reference
 * {@code docs/architecture/gmti-4607.md} section 1.1). Pure functions, no state.
 *
 * <ul>
 *   <li>{@code SA16}, {@code SA32}: signed binary angle, two's complement, −90° to 90°: {@code value × 180 / 2^n}.
 *   <li>{@code BA16}, {@code BA32}: unsigned binary angle, 0° to 360°: {@code value × 360 / 2^n}.
 *   <li>{@code B16}: signed binary decimal, sign and magnitude, 8 integer and 7 fraction bits.
 * </ul>
 *
 * <p>Longitudes in the format are 0° to 360° east; emc2's are −180° to 180° (ADR-0007): {@link
 * #longitude} turns one into the other, and the {@code BA} encoders take either.
 */
public final class Angles {

  private static final double TWO_16 = 65_536.0;
  private static final double TWO_32 = 4_294_967_296.0;

  private Angles() {}

  /** An {@code SA32} value (as a Java {@code int}, two's complement) in degrees. */
  public static double fromSa32(int value) {
    return value * 180.0 / TWO_32;
  }

  /** Degrees as an {@code SA32}, rounded; 90° and above give the largest value. */
  public static int toSa32(double degrees) {
    long v = Math.round(degrees * TWO_32 / 180.0);
    return (int) Math.max(Integer.MIN_VALUE, Math.min(Integer.MAX_VALUE, v));
  }

  /** An {@code SA16} value (two's complement) in degrees. */
  public static double fromSa16(short value) {
    return value * 180.0 / TWO_16;
  }

  /** Degrees as an {@code SA16}, rounded and limited to its range. */
  public static short toSa16(double degrees) {
    long v = Math.round(degrees * TWO_16 / 180.0);
    return (short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, v));
  }

  /** A {@code BA32} value (unsigned, the low 32 bits of {@code value}) in degrees, 0 to 360. */
  public static double fromBa32(long value) {
    return (value & 0xFFFF_FFFFL) * 360.0 / TWO_32;
  }

  /** Degrees (any, negative ones included) as a {@code BA32}; 360° wraps to 0 (pitfall 22). */
  public static long toBa32(double degrees) {
    return Math.round(normalise360(degrees) * TWO_32 / 360.0) & 0xFFFF_FFFFL;
  }

  /** A {@code BA16} value (unsigned, the low 16 bits) in degrees, 0 to 360. */
  public static double fromBa16(int value) {
    return (value & 0xFFFF) * 360.0 / TWO_16;
  }

  /** Degrees as a {@code BA16}; 360° wraps to 0. */
  public static int toBa16(double degrees) {
    return (int) (Math.round(normalise360(degrees) * TWO_16 / 360.0) & 0xFFFF);
  }

  /** A {@code B16} value (the low 16 bits: sign, 8 integer bits, 7 fraction bits). */
  public static double fromB16(int value) {
    double magnitude = (value & 0x7FFF) / 128.0;
    return (value & 0x8000) != 0 ? -magnitude : magnitude;
  }

  /** A number as a {@code B16}: rounded to 1/128 and limited to ±(256 − 1/128) (pitfall 8: not two's complement). */
  public static int toB16(double value) {
    long n = Math.min(0x7FFF, Math.round(Math.abs(value) * 128.0));
    return (int) n | (value < 0 && n != 0 ? 0x8000 : 0);
  }

  /** A longitude of the format (0 to 360 east) as emc2's (−180 to 180). */
  public static double longitude(double east) {
    double a = normalise360(east);
    return a > 180.0 ? a - 360.0 : a;
  }

  /** An angle in degrees brought into 0 ≤ a < 360. */
  public static double normalise360(double degrees) {
    double a = degrees % 360.0;
    if (a < 0) {
      a += 360.0;
    }
    return a >= 360.0 ? 0.0 : a;
  }
}
