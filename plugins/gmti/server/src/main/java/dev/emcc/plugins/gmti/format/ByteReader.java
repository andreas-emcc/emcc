package dev.emcc.plugins.gmti.format;

import java.nio.charset.StandardCharsets;

/** Reads big-endian fields (AEDP Annex C-4.1) from a part of a byte array; past its end it throws {@link Malformed}. */
final class ByteReader {

  private final byte[] bytes;
  private final int end;
  private int pos;

  ByteReader(byte[] bytes, int from, int to) {
    this.bytes = bytes;
    this.pos = from;
    this.end = to;
  }

  int position() {
    return pos;
  }

  int remaining() {
    return end - pos;
  }

  int u8() {
    need(1);
    return bytes[pos++] & 0xFF;
  }

  int s8() {
    need(1);
    return bytes[pos++];
  }

  int u16() {
    need(2);
    int v = ((bytes[pos] & 0xFF) << 8) | (bytes[pos + 1] & 0xFF);
    pos += 2;
    return v;
  }

  short s16() {
    return (short) u16();
  }

  long u32() {
    return s32() & 0xFFFF_FFFFL;
  }

  int s32() {
    need(4);
    int v = ((bytes[pos] & 0xFF) << 24) | ((bytes[pos + 1] & 0xFF) << 16) | ((bytes[pos + 2] & 0xFF) << 8) | (bytes[pos + 3] & 0xFF);
    pos += 4;
    return v;
  }

  long s64() {
    long high = u32();
    return (high << 32) | u32();
  }

  /**
   * An alphanumeric field of {@code n} bytes, without its padding spaces (AEDP 2.3). A byte outside
   * the Basic Character Set (Annex A: 0x20 to 0x7E, LF, FF and CR) becomes {@code ?}.
   */
  String alpha(int n) {
    need(n);
    byte[] copy = new byte[n];
    for (int i = 0; i < n; i++) {
      int c = bytes[pos + i] & 0xFF;
      boolean bcs = (c >= 0x20 && c <= 0x7E) || c == 0x0A || c == 0x0C || c == 0x0D;
      copy[i] = (byte) (bcs ? c : '?');
    }
    pos += n;
    return new String(copy, StandardCharsets.US_ASCII).strip();
  }

  void skip(int n) {
    need(n);
    pos += n;
  }

  private void need(int n) {
    if (end - pos < n) {
      throw new Malformed("a field runs past the end of its segment");
    }
  }

  /** A packet whose sizes do not add up; the decoder turns it into a refusal. */
  static final class Malformed extends RuntimeException {
    private static final long serialVersionUID = 1L;

    Malformed(String why) {
      super(why, null, false, false);
    }
  }
}
