package dev.emcc.plugins.terrain;

import dev.emcc.sdk.Bytes;
import java.nio.charset.StandardCharsets;

/**
 * One DTED cell (MIL-PRF-89020B), checked and kept as the bytes the folder gave: an immutable
 * {@link Bytes}, so that it can travel in a message to a compute worker without a copy. The reader
 * takes both intervals from the cell's user header (UHL) and checks them against the latitude zone
 * table (the ACA's T1), so a cell is never assumed square.
 *
 * <p>Layout, all big-endian: UHL (80 bytes), DSI (648), ACC (2 700), then one record per longitude
 * line from west to east: {@code 0xAA}, a 3-byte block count, the 2-byte longitude count, the 2-byte
 * latitude count, {@code latCount} elevations from south to north (16 bits, sign and magnitude; a
 * void is -32767), and a 4-byte checksum, the sum of the record's earlier bytes.
 *
 * @param id the cell, by its name
 * @param lonCount longitude lines: the columns, west to east
 * @param latCount elevations per line: the rows, south to north
 * @param lonIntervalTenths the longitude interval in tenths of an arc-second, from the UHL
 * @param latIntervalTenths the latitude interval in tenths of an arc-second, from the UHL
 * @param data the whole file, or only its header (3 428 bytes) for an index entry
 */
record DtedCell(CellId id, int lonCount, int latCount, int lonIntervalTenths, int latIntervalTenths, Bytes data) {

  /** UHL, DSI and ACC together. */
  static final int HEADER_BYTES = 80 + 648 + 2700;

  /** The elevation that stands for a void, in {@link #raw}. */
  static final int VOID = Integer.MIN_VALUE;

  private static final int UNIT = 36_000; // one degree in tenths of an arc-second

  /** The bytes of one longitude line's record. */
  int recordLength() {
    return 12 + 2 * latCount;
  }

  /** The file's size the header promises. */
  long expectedSize() {
    return HEADER_BYTES + (long) lonCount * recordLength();
  }

  /**
   * The elevation at a grid point in metres, or {@link #VOID}.
   *
   * @param column 0 to {@code lonCount - 1}, from the west edge
   * @param row 0 to {@code latCount - 1}, from the south edge
   */
  int raw(int column, int row) {
    int at = HEADER_BYTES + column * recordLength() + 8 + 2 * row;
    int hi = data.get(at) & 0xFF;
    int lo = data.get(at + 1) & 0xFF;
    int magnitude = ((hi & 0x7F) << 8) | lo;
    if ((hi & 0x80) == 0) {
      return magnitude;
    }
    return magnitude == 32_767 ? VOID : -magnitude;
  }

  /**
   * Reads the header of a cell from its first {@link #HEADER_BYTES} bytes and checks it against the
   * cell's name, the level and the latitude zone. The result has no data yet ({@code data} is the
   * header).
   *
   * @param fileSize the file's whole size, which must be what the header promises
   * @throws DtedException when the file is not that cell
   */
  static DtedCell parseHeader(CellId id, Bytes header, long fileSize) {
    if (header.size() < HEADER_BYTES) {
      throw new DtedException("a header of " + header.size() + " bytes, " + HEADER_BYTES + " needed");
    }
    byte[] head = new byte[HEADER_BYTES]; // only the header: a whole cell must not be copied for it
    for (int i = 0; i < HEADER_BYTES; i++) {
      head[i] = header.get(i);
    }
    String uhl = new String(head, 0, 80, StandardCharsets.ISO_8859_1);
    if (!uhl.startsWith("UHL")) {
      throw new DtedException("no UHL record");
    }
    if (!new String(head, 80, 3, StandardCharsets.ISO_8859_1).equals("DSI") || !new String(head, 728, 3, StandardCharsets.ISO_8859_1).equals("ACC")) {
      throw new DtedException("no DSI or ACC record");
    }
    int lonOrigin = angle(uhl.substring(4, 12), "longitude origin");
    int latOrigin = angle(uhl.substring(12, 20), "latitude origin");
    if (lonOrigin != id.lonDeg() * 3600 || latOrigin != id.latDeg() * 3600) {
      throw new DtedException("the origin " + lonOrigin / 3600.0 + ", " + latOrigin / 3600.0 + " is not the cell's name");
    }
    int lonInterval = number(uhl.substring(20, 24), "longitude interval");
    int latInterval = number(uhl.substring(24, 28), "latitude interval");
    int lonCount = number(uhl.substring(47, 51), "longitude lines");
    int latCount = number(uhl.substring(51, 55), "latitude points");
    int standardLatInterval = switch (id.level()) {
      case 0 -> 300;
      case 1 -> 30;
      default -> 10;
    };
    if (latInterval != standardLatInterval) {
      throw new DtedException("the latitude interval " + latInterval / 10.0 + "\" is not level " + id.level() + "'s " + standardLatInterval / 10.0 + "\"");
    }
    if (lonInterval != latInterval * id.zoneFactor()) {
      throw new DtedException("the longitude interval " + lonInterval / 10.0 + "\" is not " + id.zoneFactor() + " times the latitude interval "
          + latInterval / 10.0 + "\" that the latitude zone of " + id.displayName() + " needs");
    }
    if ((long) (lonCount - 1) * lonInterval != UNIT || (long) (latCount - 1) * latInterval != UNIT) {
      throw new DtedException("the counts " + lonCount + " x " + latCount + " do not cover the whole 1 x 1 degree cell");
    }
    DtedCell cell = new DtedCell(id, lonCount, latCount, lonInterval, latInterval, header);
    if (fileSize != cell.expectedSize()) {
      throw new DtedException("the file is " + fileSize + " bytes, the header promises " + cell.expectedSize());
    }
    return cell;
  }

  /**
   * Reads a whole cell: the header as {@link #parseHeader}, and every record's sentinel, counts and
   * checksum.
   *
   * @throws DtedException when the file is not that cell or is damaged
   */
  static DtedCell parse(CellId id, Bytes file) {
    DtedCell cell = parseHeader(id, file, file.size());
    int length = cell.recordLength();
    for (int c = 0; c < cell.lonCount(); c++) {
      int at = HEADER_BYTES + c * length;
      int block = ((file.get(at + 1) & 0xFF) << 16) | ((file.get(at + 2) & 0xFF) << 8) | (file.get(at + 3) & 0xFF);
      int lonLine = ((file.get(at + 4) & 0xFF) << 8) | (file.get(at + 5) & 0xFF);
      int latLine = ((file.get(at + 6) & 0xFF) << 8) | (file.get(at + 7) & 0xFF);
      if ((file.get(at) & 0xFF) != 0xAA || block != c || lonLine != c || latLine != 0) {
        throw new DtedException("record " + c + " has a wrong sentinel or count");
      }
      long sum = 0;
      for (int k = at; k < at + length - 4; k++) {
        sum += file.get(k) & 0xFF;
      }
      long stored = 0;
      for (int k = at + length - 4; k < at + length; k++) {
        stored = (stored << 8) | (file.get(k) & 0xFF);
      }
      if ((sum & 0xFFFF_FFFFL) != stored) {
        throw new DtedException("record " + c + " has a wrong checksum");
      }
    }
    return new DtedCell(id, cell.lonCount(), cell.latCount(), cell.lonIntervalTenths(), cell.latIntervalTenths(), file);
  }

  /** {@code DDDMMSSH} as signed arc-seconds. */
  private static int angle(String text, String what) {
    if (text.length() != 8) {
      throw new DtedException("the " + what + " is not 8 characters");
    }
    char hemisphere = Character.toUpperCase(text.charAt(7));
    int sign = switch (hemisphere) {
      case 'E', 'N' -> 1;
      case 'W', 'S' -> -1;
      default -> throw new DtedException("the " + what + " has no hemisphere: \"" + text + "\"");
    };
    int degrees = number(text.substring(0, 3), what);
    int minutes = number(text.substring(3, 5), what);
    int seconds = number(text.substring(5, 7), what);
    return sign * (degrees * 3600 + minutes * 60 + seconds);
  }

  private static int number(String text, String what) {
    for (int i = 0; i < text.length(); i++) {
      if (text.charAt(i) < '0' || text.charAt(i) > '9') {
        throw new DtedException("the " + what + " is not a number: \"" + text + "\"");
      }
    }
    return Integer.parseInt(text);
  }
}
