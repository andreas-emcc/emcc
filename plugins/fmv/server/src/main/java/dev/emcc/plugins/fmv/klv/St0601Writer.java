package dev.emcc.plugins.fmv.klv;

import dev.emcc.plugins.fmv.out.Pose;
import dev.emcc.plugins.fmv.out.render.Renderer;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import org.jspecify.annotations.Nullable;

/**
 * Writes one ST 0601 UAS Datalink Local Set for an output link's frame (brief section 10.6 points
 * 19 and 20; ST 0601.14, ST 0102.12): the tags section 2 reads, written the way {@link St0601} reads
 * them, and the checksum last. ST 0601's ranges are narrower than a pose's in three places (the
 * owner's A2): a platform pitch beyond ±20° or roll beyond ±50° is the standard's out-of-range value
 * {@code 0x8000}, and a height outside −900 to 19 000 m is clamped.
 */
public final class St0601Writer {

  /** The image source sensor (tag 11). */
  public static final String SENSOR = "emcc simulated camera";

  /** ST 0601's version (tag 65). */
  public static final int VERSION = 14;

  /** ST 0102's version (its tag 22). */
  public static final int SECURITY_VERSION = 12;

  /** ST 0102's country coding method (its tag 2): STANAG 1059 three letter (O8). */
  public static final int COUNTRY_CODING = 0x07;

  private static final int INT16_OUT_OF_RANGE = 0x8000;

  private St0601Writer() {}

  /**
   * One set as a whole KLV item: the key, the BER length and the value.
   *
   * @param pose the frame's pose
   * @param centre where the frame's centre meets the ground, or {@code null}: then tags 23 and 24 are
   *     {@code 0x80000000} and tags 21 and 25 are left out
   * @param platformName the platform's name, else the link's (tag 10)
   * @param classification ST 0102's classification, 1 (UNCLASSIFIED) to 5 (TOP SECRET)
   * @param classifyingCountry ST 0102's classifying country, e.g. {@code //NATO}
   */
  public static byte[] write(Pose pose, Renderer.@Nullable FrameCentre centre, String platformName, int classification, String classifyingCountry) {
    if (classification < 1 || classification > 5) {
      throw new IllegalArgumentException("ST 0102's classification is 1 to 5: " + classification);
    }
    Pose.Platform p = pose.platform();
    Pose.Pointing s = pose.pointing();
    ByteArrayOutputStream b = new ByteArrayOutputStream();
    item(b, 2, unsigned(micros(pose.time()), 8));
    if (pose.mission() != null) {
      item(b, 3, text(pose.mission()));
    }
    item(b, 5, unsigned(Math.round(p.heading() * 65535 / 360), 2));
    item(b, 6, int16(p.pitch(), 20));
    item(b, 7, int16(p.roll(), 50));
    item(b, 10, text(platformName));
    item(b, 11, text(SENSOR));
    item(b, 13, int32(p.lat(), 90));
    item(b, 14, int32(p.lon(), 180));
    item(b, 15, altitude(p.height()));
    item(b, 16, unsigned(Math.round(pose.horizontalFov() * 65535 / 180), 2));
    item(b, 17, unsigned(Math.round(pose.verticalFov() * 65535 / 180), 2));
    item(b, 18, unsigned(Math.round(s.azimuth() * 4294967295.0 / 360), 4));
    item(b, 19, int32(-s.depression(), 180));
    double roll = ((s.roll() % 360) + 360) % 360;
    item(b, 20, unsigned(Math.min(4294967295L, Math.round(roll * 4294967295.0 / 360)), 4));
    if (centre != null) {
      item(b, 21, unsigned(Math.round(Math.min(5_000_000, centre.slantRange()) * 4294967295.0 / 5_000_000), 4));
      item(b, 23, int32(centre.lat(), 90));
      item(b, 24, int32(centre.lon(), 180));
      item(b, 25, altitude(centre.height()));
    } else {
      item(b, 23, unsigned(0x8000_0000L, 4));
      item(b, 24, unsigned(0x8000_0000L, 4));
    }
    item(b, 48, security(classification, classifyingCountry));
    item(b, 65, new byte[] {VERSION});
    byte[] items = b.toByteArray();

    ByteArrayOutputStream set = new ByteArrayOutputStream();
    set.writeBytes(St0601.key());
    set.writeBytes(ber(items.length + 4));
    set.writeBytes(items);
    set.write(1);
    set.write(2);
    byte[] upToChecksum = set.toByteArray();
    int sum = St0601.checksum(upToChecksum, 0, upToChecksum.length);
    set.write(sum >> 8);
    set.write(sum);
    return set.toByteArray();
  }

  /** The ST 0102 local set (tag 48's value). */
  static byte[] security(int classification, String classifyingCountry) {
    ByteArrayOutputStream b = new ByteArrayOutputStream();
    item(b, 1, new byte[] {(byte) classification});
    item(b, 2, new byte[] {COUNTRY_CODING});
    item(b, 3, classifyingCountry.getBytes(StandardCharsets.US_ASCII));
    item(b, 22, unsigned(SECURITY_VERSION, 2));
    return b.toByteArray();
  }

  private static long micros(Instant t) {
    return Math.addExact(Math.multiplyExact(t.getEpochSecond(), 1_000_000L), t.getNano() / 1000);
  }

  /** UTF-8, cut to 127 bytes at a character's edge. */
  private static byte[] text(String s) {
    byte[] all = s.getBytes(StandardCharsets.UTF_8);
    if (all.length <= 127) {
      return all;
    }
    int end = 127;
    while (end > 0 && (all[end] & 0xC0) == 0x80) {
      end--;
    }
    return java.util.Arrays.copyOf(all, end);
  }

  /** A signed 16-bit angle of ±{@code range}, or {@code 0x8000} outside it. */
  private static byte[] int16(double value, double range) {
    if (!(Math.abs(value) <= range)) {
      return unsigned(INT16_OUT_OF_RANGE, 2);
    }
    return unsigned(Math.round(value * 32767 / range) & 0xFFFF, 2);
  }

  /** A signed 32-bit angle of ±{@code range}. */
  private static byte[] int32(double value, double range) {
    return unsigned(Math.round(value * Integer.MAX_VALUE / range) & 0xFFFF_FFFFL, 4);
  }

  /** −900 to 19 000 m in 16 bits, clamped. */
  private static byte[] altitude(double metres) {
    double m = Math.max(-900, Math.min(19_000, metres));
    return unsigned(Math.round((m + 900) * 65535 / 19900), 2);
  }

  private static byte[] unsigned(long v, int n) {
    byte[] r = new byte[n];
    for (int i = n - 1; i >= 0; i--, v >>= 8) {
      r[i] = (byte) v;
    }
    return r;
  }

  static byte[] ber(int length) {
    if (length < 128) {
      return new byte[] {(byte) length};
    }
    if (length < 256) {
      return new byte[] {(byte) 0x81, (byte) length};
    }
    return new byte[] {(byte) 0x82, (byte) (length >> 8), (byte) length};
  }

  private static void item(ByteArrayOutputStream b, int tag, byte[] value) {
    b.write(tag);
    b.writeBytes(ber(value.length));
    b.writeBytes(value);
  }
}
