package dev.emcc.plugins.fmv.out.terrain;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;

/** Builds DTED cell files for tests: the headers, the records and their checksums. */
public final class DtedFiles {

  /** A height for a post: longitude line {@code i} (west to east), latitude point {@code j} (south to north). */
  @FunctionalInterface
  public interface Heights {
    int at(int i, int j);
  }

  private DtedFiles() {}

  /**
   * A cell at its south-west corner, with {@code n} posts each way (a level 0 cell of a 30″ grid
   * has 121), every height from {@code heights}; −32767 is a void.
   */
  public static byte[] cell(int lon, int lat, int n, Heights heights) {
    int tenths = 36_000 / (n - 1);
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    String uhl = String.format(Locale.ROOT, "UHL1%s%s%04d%04d%-4s%-3s%-12s%04d%04d%s",
        angle(lon, 'E', 'W'), angle(lat, 'N', 'S'), tenths, tenths, "NA", "U", "", n, n, "0");
    byte[] head = new byte[DtedCell.HEADER];
    Arrays.fill(head, (byte) ' ');
    byte[] u = uhl.getBytes(StandardCharsets.ISO_8859_1);
    System.arraycopy(u, 0, head, 0, u.length);
    out.writeBytes(head);
    for (int i = 0; i < n; i++) {
      byte[] r = new byte[8 + 2 * n + 4];
      r[0] = (byte) 0xAA;
      r[1] = (byte) (i >> 16);
      r[2] = (byte) (i >> 8);
      r[3] = (byte) i;
      r[4] = (byte) (i >> 8);
      r[5] = (byte) i;
      for (int j = 0; j < n; j++) {
        int h = heights.at(i, j);
        int v = h < 0 ? 0x8000 | -h : h;
        r[8 + 2 * j] = (byte) (v >> 8);
        r[9 + 2 * j] = (byte) v;
      }
      long sum = 0;
      for (int k = 0; k < r.length - 4; k++) {
        sum += r[k] & 0xFF;
      }
      r[r.length - 4] = (byte) (sum >> 24);
      r[r.length - 3] = (byte) (sum >> 16);
      r[r.length - 2] = (byte) (sum >> 8);
      r[r.length - 1] = (byte) sum;
      out.writeBytes(r);
    }
    return out.toByteArray();
  }

  private static String angle(int deg, char positive, char negative) {
    return String.format(Locale.ROOT, "%03d0000%c", Math.abs(deg), deg >= 0 ? positive : negative);
  }
}
