package dev.emcc.plugins.fmv.out.terrain;

import java.nio.charset.StandardCharsets;

/**
 * One DTED cell's heights (levels 0 to 2, MIL-PRF-89020B), parsed from its file's bytes, after
 * spike S10's reader. Immutable once made; owned by the compute task that parsed it.
 *
 * <p>Layout, all big-endian: UHL (80 bytes), DSI (648), ACC (2 700), then one record per longitude
 * line from west to east: {@code 0xAA}, a 3-byte block count, the 2-byte longitude count, the 2-byte
 * latitude count, the heights south to north (2 bytes each, signed magnitude, metres; a void is
 * −32767) and a 4-byte checksum, the sum of the record's earlier bytes. A file that breaks any of it
 * is refused.
 */
public final class DtedCell {

  /** UHL, DSI and ACC together. */
  static final int HEADER = 80 + 648 + 2700;

  private static final short VOID = Short.MIN_VALUE;

  private final double lon0;
  private final double lat0;
  private final double dLon;
  private final double dLat;
  private final int nLon;
  private final int nLat;
  private final short[] heights; // [lonLine * nLat + latPoint]

  private DtedCell(double lon0, double lat0, double dLon, double dLat, int nLon, int nLat, short[] heights) {
    this.lon0 = lon0;
    this.lat0 = lat0;
    this.dLon = dLon;
    this.dLat = dLat;
    this.nLon = nLon;
    this.nLat = nLat;
    this.heights = heights;
  }

  /** A file that is not a DTED cell this reader takes. */
  public static final class DtedException extends Exception {
    private static final long serialVersionUID = 1L;

    DtedException(String message) {
      super(message);
    }
  }

  /** Parses a whole cell file. */
  public static DtedCell parse(byte[] file) throws DtedException {
    if (file.length < HEADER) {
      throw new DtedException("shorter than the DTED headers: " + file.length + " bytes");
    }
    String uhl = new String(file, 0, 80, StandardCharsets.ISO_8859_1);
    if (!uhl.startsWith("UHL")) {
      throw new DtedException("no UHL record");
    }
    double lon0 = angle(uhl.substring(4, 12), "longitude origin");
    double lat0 = angle(uhl.substring(12, 20), "latitude origin");
    int lonTenths = number(uhl.substring(20, 24), "longitude interval");
    int latTenths = number(uhl.substring(24, 28), "latitude interval");
    int nLon = number(uhl.substring(47, 51), "longitude lines");
    int nLat = number(uhl.substring(51, 55), "latitude points");
    if (lonTenths < 1 || latTenths < 1 || nLon < 2 || nLat < 2) {
      throw new DtedException("intervals or counts out of range");
    }
    double dLon = lonTenths / 36_000.0;
    double dLat = latTenths / 36_000.0;
    if (Math.abs((nLon - 1) * dLon - 1) > 1e-6 || Math.abs((nLat - 1) * dLat - 1) > 1e-6) {
      throw new DtedException("the counts and intervals do not span one degree");
    }
    int record = 8 + 2 * nLat + 4;
    if ((long) HEADER + (long) nLon * record != file.length) {
      throw new DtedException("the file's length does not match its " + nLon + " × " + nLat + " heights");
    }
    short[] heights = new short[nLon * nLat];
    for (int c = 0; c < nLon; c++) {
      int at = HEADER + c * record;
      int block = ((file[at + 1] & 0xFF) << 16) | ((file[at + 2] & 0xFF) << 8) | (file[at + 3] & 0xFF);
      int lonLine = ((file[at + 4] & 0xFF) << 8) | (file[at + 5] & 0xFF);
      if ((file[at] & 0xFF) != 0xAA || block != c || lonLine != c) {
        throw new DtedException("record " + c + " has a wrong sentinel or count");
      }
      long sum = 0;
      for (int i = at; i < at + record - 4; i++) {
        sum += file[i] & 0xFF;
      }
      long stated = ((file[at + record - 4] & 0xFFL) << 24) | ((file[at + record - 3] & 0xFFL) << 16)
          | ((file[at + record - 2] & 0xFFL) << 8) | (file[at + record - 1] & 0xFFL);
      if ((sum & 0xFFFF_FFFFL) != stated) {
        throw new DtedException("record " + c + " has a wrong checksum");
      }
      for (int j = 0; j < nLat; j++) {
        int v = ((file[at + 8 + 2 * j] & 0xFF) << 8) | (file[at + 9 + 2 * j] & 0xFF);
        int magnitude = v & 0x7FFF;
        int h = (v & 0x8000) != 0 ? -magnitude : magnitude;
        heights[c * nLat + j] = h == -32767 ? VOID : (short) h;
      }
    }
    return new DtedCell(lon0, lat0, dLon, dLat, nLon, nLat, heights);
  }

  /** {@code DDDMMSSH}: degrees, minutes, seconds and a hemisphere letter. */
  private static double angle(String s, String what) throws DtedException {
    int d = number(s.substring(0, 3), what);
    int m = number(s.substring(3, 5), what);
    int sec = number(s.substring(5, 7), what);
    char h = s.charAt(7);
    if (m > 59 || sec > 59 || "NSEW".indexOf(h) < 0) {
      throw new DtedException("the " + what + " is not DDDMMSSH: " + s);
    }
    double v = d + m / 60.0 + sec / 3600.0;
    return h == 'S' || h == 'W' ? -v : v;
  }

  private static int number(String s, String what) throws DtedException {
    try {
      return Integer.parseInt(s.trim());
    } catch (NumberFormatException e) {
      throw new DtedException("the " + what + " is not a number: \"" + s + "\"");
    }
  }

  /** The cell's south-west corner. */
  public CellKey key() {
    return CellKey.containing(lon0 + 0.5, lat0 + 0.5);
  }

  public int lonLines() {
    return nLon;
  }

  public int latPoints() {
    return nLat;
  }

  /**
   * The height at a point, metres, bilinear between the four posts round it; {@code NaN} outside
   * the cell or next to a void.
   */
  public double height(double lonDeg, double latDeg) {
    double x = (lonDeg - lon0) / dLon;
    double y = (latDeg - lat0) / dLat;
    if (!(x >= 0 && y >= 0 && x <= nLon - 1 && y <= nLat - 1)) {
      return Double.NaN;
    }
    int i = Math.min((int) x, nLon - 2);
    int j = Math.min((int) y, nLat - 2);
    double fx = x - i;
    double fy = y - j;
    int k = i * nLat + j;
    short a = heights[k];
    short b = heights[k + nLat];
    short c = heights[k + 1];
    short d = heights[k + nLat + 1];
    if (a == VOID || b == VOID || c == VOID || d == VOID) {
      return Double.NaN;
    }
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
}
