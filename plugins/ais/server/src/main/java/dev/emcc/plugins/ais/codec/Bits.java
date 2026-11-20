package dev.emcc.plugins.ais.codec;

import org.jspecify.annotations.Nullable;

/** The bits of an AIS payload: six bits per character, less the fill bits at the end. Read-only. */
final class Bits {

  private final byte[] bits;

  /** @param payload characters of the six-bit set only ({@link Nmea} checks) */
  Bits(String payload, int fillBits) {
    int n = Math.max(0, payload.length() * 6 - fillBits);
    bits = new byte[n];
    for (int i = 0; i < n; i++) {
      int c = payload.charAt(i / 6) - 48;
      if (c > 40) {
        c -= 8;
      }
      bits[i] = (byte) ((c >> (5 - i % 6)) & 1);
    }
  }

  int length() {
    return bits.length;
  }

  /** Whether bits {@code 0..end-1} exist. */
  boolean has(int end) {
    return bits.length >= end;
  }

  long uint(int from, int len) {
    long v = 0;
    for (int i = from; i < from + len; i++) {
      v = v << 1 | bits[i];
    }
    return v;
  }

  long sint(int from, int len) {
    long v = uint(from, len);
    return (v & (1L << (len - 1))) != 0 ? v - (1L << len) : v;
  }

  /**
   * Six-bit text of {@code len} bits from {@code from} (whole characters only), without the
   * {@code @} and spaces at the end; {@code null} when nothing is left. Bits past the end read as
   * {@code @}, the padding.
   */
  @Nullable String text(int from, int len) {
    var out = new StringBuilder(len / 6);
    for (int i = from; i + 6 <= from + len; i += 6) {
      int v = i + 6 <= bits.length ? (int) uint(i, 6) : 0;
      out.append((char) (v < 32 ? v + 64 : v));
    }
    int end = out.length();
    while (end > 0 && (out.charAt(end - 1) == '@' || out.charAt(end - 1) == ' ')) {
      end--;
    }
    return end == 0 ? null : out.substring(0, end);
  }
}
