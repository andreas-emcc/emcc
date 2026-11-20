package dev.emcc.sdk;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HexFormat;
import org.jspecify.annotations.Nullable;

/**
 * An immutable sequence of bytes, for use in messages instead of {@code byte[]}.
 *
 * <pre>{@code
 * Bytes body = Bytes.of(pngData);   // copies
 * byte[] copy = body.toArray();     // copies again
 * }</pre>
 */
public final class Bytes {

  private static final Bytes EMPTY = new Bytes(new byte[0]);

  private final byte[] data;

  private Bytes(byte[] data) {
    this.data = data;
  }

  /** A copy of {@code data}. */
  public static Bytes of(byte[] data) {
    return data.length == 0 ? EMPTY : new Bytes(data.clone());
  }

  /** The UTF-8 bytes of {@code text}. */
  public static Bytes utf8(String text) {
    return of(text.getBytes(StandardCharsets.UTF_8));
  }

  public static Bytes empty() {
    return EMPTY;
  }

  public int size() {
    return data.length;
  }

  public boolean isEmpty() {
    return data.length == 0;
  }

  public byte get(int index) {
    return data[index];
  }

  /** A fresh copy of the bytes. */
  public byte[] toArray() {
    return data.clone();
  }

  /** Reads the bytes without copying them. */
  public InputStream asInputStream() {
    return new ByteArrayInputStream(data);
  }

  /** Decodes the bytes as UTF-8. */
  public String toUtf8() {
    return new String(data, StandardCharsets.UTF_8);
  }

  @Override
  public boolean equals(@Nullable Object other) {
    return other instanceof Bytes b && Arrays.equals(data, b.data);
  }

  @Override
  public int hashCode() {
    return Arrays.hashCode(data);
  }

  /** At most the first 32 bytes in hex, and the size. */
  @Override
  public String toString() {
    int shown = Math.min(data.length, 32);
    return "Bytes[" + data.length + ": " + HexFormat.of().formatHex(data, 0, shown) + (shown < data.length ? "…" : "") + "]";
  }
}
