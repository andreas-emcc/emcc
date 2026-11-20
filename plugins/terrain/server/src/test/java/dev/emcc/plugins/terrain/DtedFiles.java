package dev.emcc.plugins.terrain;

import dev.emcc.sdk.Bytes;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.function.IntBinaryOperator;

/**
 * Writes DTED cells (MIL-PRF-89020B) for the tests, in the layout the ESA's converter writes and the
 * owner's data has: UHL, DSI, ACC and the data records with their checksums. The elevation function
 * gets {@code (column, row)}: the column counts from the west edge, the row from the south edge.
 */
final class DtedFiles {

  /** What a void is in an elevation function. */
  static final int VOID = DtedCell.VOID;

  private DtedFiles() {}

  /** The standard's latitude interval of a level in tenths of an arc-second. */
  static int latInterval(int level) {
    return switch (level) {
      case 0 -> 300;
      case 1 -> 30;
      default -> 10;
    };
  }

  /** A cell as the standard has it for its latitude zone. */
  static byte[] cell(int level, int lonDeg, int latDeg, IntBinaryOperator elevation) {
    return cell(level, lonDeg, latDeg, new CellId(level, lonDeg, latDeg).zoneFactor(), elevation);
  }

  /** A cell with the longitude interval {@code lonFactor} times the latitude interval, which the zone's factor may differ from. */
  static byte[] cell(int level, int lonDeg, int latDeg, int lonFactor, IntBinaryOperator elevation) {
    int latInterval = latInterval(level);
    int lonInterval = latInterval * lonFactor;
    int nLat = 36_000 / latInterval + 1;
    int nLon = 36_000 / lonInterval + 1;
    return cell(level, lonDeg, latDeg, lonInterval, latInterval, nLon, nLat, elevation);
  }

  /** A cell with every header number given. */
  static byte[] cell(int level, int lonDeg, int latDeg, int lonInterval, int latInterval, int nLon, int nLat, IntBinaryOperator elevation) {
    String uhl = "UHL1" + angle(lonDeg, 3, 'E', 'W') + angle(latDeg, 3, 'N', 'S') + String.format(Locale.ROOT, "%04d%04d", lonInterval, latInterval)
        + "NA  " + "U  " + " ".repeat(12) + String.format(Locale.ROOT, "%04d%04d", nLon, nLat) + "0" + " ".repeat(24);
    String dsi = ("DSI" + "U" + " ".repeat(55) + "DTED" + level).concat(" ".repeat(648)).substring(0, 648);
    String acc = ("ACC" + "NA  ".repeat(4)).concat(" ".repeat(2700)).substring(0, 2700);
    if (uhl.length() != 80) {
      throw new IllegalStateException("UHL is " + uhl.length());
    }
    int recordLength = 12 + 2 * nLat;
    ByteBuffer out = ByteBuffer.allocate(DtedCell.HEADER_BYTES + nLon * recordLength);
    out.put(uhl.getBytes(StandardCharsets.ISO_8859_1)).put(dsi.getBytes(StandardCharsets.ISO_8859_1)).put(acc.getBytes(StandardCharsets.ISO_8859_1));
    byte[] data = out.array();
    for (int c = 0; c < nLon; c++) {
      int at = DtedCell.HEADER_BYTES + c * recordLength;
      data[at] = (byte) 0xAA;
      data[at + 1] = (byte) (c >> 16);
      data[at + 2] = (byte) (c >> 8);
      data[at + 3] = (byte) c;
      data[at + 4] = (byte) (c >> 8);
      data[at + 5] = (byte) c;
      data[at + 6] = 0;
      data[at + 7] = 0;
      for (int r = 0; r < nLat; r++) {
        int value = elevation.applyAsInt(c, r);
        int raw = value == VOID ? 0xFFFF : value >= 0 ? value : 0x8000 | -value;
        data[at + 8 + 2 * r] = (byte) (raw >> 8);
        data[at + 9 + 2 * r] = (byte) raw;
      }
      writeChecksum(data, at, recordLength);
    }
    return data;
  }

  /** Recomputes the checksum of the record at {@code at}. */
  static void writeChecksum(byte[] data, int at, int recordLength) {
    long sum = 0;
    for (int k = at; k < at + recordLength - 4; k++) {
      sum += data[k] & 0xFF;
    }
    for (int i = 0; i < 4; i++) {
      data[at + recordLength - 4 + i] = (byte) (sum >> (8 * (3 - i)));
    }
  }

  /** The cell as the parsed form, from its bytes, as the plugin would read it. */
  static DtedCell parsed(int level, int lonDeg, int latDeg, IntBinaryOperator elevation) {
    return DtedCell.parse(new CellId(level, lonDeg, latDeg), Bytes.of(cell(level, lonDeg, latDeg, elevation)));
  }

  /** Writes a cell to {@code folder/e<lon>/n<lat>.dt<level>} (lower case) and returns the file. */
  static Path write(Path folder, int level, int lonDeg, int latDeg, IntBinaryOperator elevation) {
    return write(folder, level, lonDeg, latDeg, cell(level, lonDeg, latDeg, elevation));
  }

  /** Writes the given bytes under the cell's conventional name. */
  static Path write(Path folder, int level, int lonDeg, int latDeg, byte[] bytes) {
    String directory = String.format(Locale.ROOT, "%s%03d", lonDeg >= 0 ? "e" : "w", Math.abs(lonDeg));
    String file = String.format(Locale.ROOT, "%s%02d.dt%d", latDeg >= 0 ? "n" : "s", Math.abs(latDeg), level);
    try {
      Path dir = Files.createDirectories(folder.resolve(directory));
      return Files.write(dir.resolve(file), bytes);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static String angle(int degrees, int width, char positive, char negative) {
    return String.format(Locale.ROOT, "%0" + width + "d0000%c", Math.abs(degrees), degrees >= 0 ? positive : negative);
  }
}
