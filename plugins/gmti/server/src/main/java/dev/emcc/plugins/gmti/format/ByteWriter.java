package dev.emcc.plugins.gmti.format;

import java.util.Arrays;

/** Writes big-endian fields into a growing byte array. Values are cut to their field's width. */
final class ByteWriter {

  private byte[] bytes = new byte[256];
  private int size;

  int size() {
    return size;
  }

  ByteWriter u8(int v) {
    grow(1);
    bytes[size++] = (byte) v;
    return this;
  }

  ByteWriter u16(int v) {
    grow(2);
    bytes[size++] = (byte) (v >>> 8);
    bytes[size++] = (byte) v;
    return this;
  }

  ByteWriter u32(long v) {
    grow(4);
    bytes[size++] = (byte) (v >>> 24);
    bytes[size++] = (byte) (v >>> 16);
    bytes[size++] = (byte) (v >>> 8);
    bytes[size++] = (byte) v;
    return this;
  }

  ByteWriter s64(long v) {
    u32(v >>> 32);
    return u32(v);
  }

  /** {@code text} left-justified in {@code n} bytes, padded with spaces; a character outside the Basic Character Set becomes {@code ?}. */
  ByteWriter alpha(String text, int n) {
    grow(n);
    for (int i = 0; i < n; i++) {
      int c = i < text.length() ? text.charAt(i) : ' ';
      boolean bcs = (c >= 0x20 && c <= 0x7E) || c == 0x0A || c == 0x0C || c == 0x0D;
      bytes[size++] = (byte) (bcs ? c : '?');
    }
    return this;
  }

  ByteWriter zeros(int n) {
    grow(n);
    size += n;
    return this;
  }

  /** Overwrites four bytes at {@code at} with {@code v}. */
  void putU32(int at, long v) {
    bytes[at] = (byte) (v >>> 24);
    bytes[at + 1] = (byte) (v >>> 16);
    bytes[at + 2] = (byte) (v >>> 8);
    bytes[at + 3] = (byte) v;
  }

  byte[] toBytes() {
    return Arrays.copyOf(bytes, size);
  }

  private void grow(int n) {
    if (size + n > bytes.length) {
      bytes = Arrays.copyOf(bytes, Math.max(bytes.length * 2, size + n));
    }
  }
}
