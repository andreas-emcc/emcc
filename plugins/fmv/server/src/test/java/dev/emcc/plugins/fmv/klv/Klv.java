package dev.emcc.plugins.fmv.klv;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

/** Builds KLV for the tests: ST 0601 sets with their checksum, and their items. */
public final class Klv {

  private Klv() {}

  /** The ST 0601 key. */
  public static byte[] key() {
    return St0601.key();
  }

  public static byte[] ber(int length) {
    if (length < 128) {
      return new byte[] {(byte) length};
    }
    if (length < 256) {
      return new byte[] {(byte) 0x81, (byte) length};
    }
    return new byte[] {(byte) 0x82, (byte) (length >> 8), (byte) length};
  }

  /** A tag as a BER-OID. */
  public static byte[] oid(int tag) {
    return tag < 128 ? new byte[] {(byte) tag} : new byte[] {(byte) (0x80 | (tag >> 7)), (byte) (tag & 0x7F)};
  }

  public static byte[] item(int tag, byte[] value) {
    var out = new ByteArrayOutputStream();
    out.writeBytes(oid(tag));
    out.writeBytes(ber(value.length));
    out.writeBytes(value);
    return out.toByteArray();
  }

  public static byte[] u(int tag, long value, int bytes) {
    byte[] v = new byte[bytes];
    for (int i = 0; i < bytes; i++) {
      v[bytes - 1 - i] = (byte) (value >> (8 * i));
    }
    return item(tag, v);
  }

  public static byte[] text(int tag, String s) {
    return item(tag, s.getBytes(StandardCharsets.UTF_8));
  }

  public static byte[] cat(byte[]... parts) {
    var out = new ByteArrayOutputStream();
    for (byte[] p : parts) {
      out.writeBytes(p);
    }
    return out.toByteArray();
  }

  /** A set with the key, the length, the items and a right checksum as its last item. */
  public static byte[] set(byte[]... items) {
    return set(true, items);
  }

  /** Like {@link #set(byte[]...)}; {@code rightChecksum} false adds 1 to the sum. */
  public static byte[] set(boolean rightChecksum, byte[]... items) {
    byte[] body = cat(items);
    byte[] length = ber(body.length + 4);
    byte[] head = cat(key(), length, body, new byte[] {1, 2});
    int sum = 0;
    for (int i = 0; i < head.length; i++) {
      sum += (head[i] & 0xFF) << (i % 2 == 0 ? 8 : 0);
    }
    sum = (sum + (rightChecksum ? 0 : 1)) & 0xFFFF;
    return cat(head, new byte[] {(byte) (sum >> 8), (byte) sum});
  }

  /** A set with no checksum item. */
  public static byte[] setWithoutChecksum(byte[]... items) {
    byte[] body = cat(items);
    return cat(key(), ber(body.length), body);
  }
}
