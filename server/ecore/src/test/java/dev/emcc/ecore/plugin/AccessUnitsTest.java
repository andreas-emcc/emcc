package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import org.junit.jupiter.api.Test;

/** SDK 1.9.0 (CR-0050 point 1.5; M9 C10): H.264 Annex B split into access units at each delimiter. */
class AccessUnitsTest {

  /** A delimiter (NAL 9), with a four- or three-byte start code. */
  static final byte[] AUD4 = HexFormat.of().parseHex("0000000109f0");
  static final byte[] AUD3 = HexFormat.of().parseHex("000001" + "0910");
  /** An SPS (7), an IDR slice (5) and a non-IDR slice (1), each with a few bytes. */
  static final byte[] SPS = HexFormat.of().parseHex("0000000167640028ac");
  static final byte[] IDR = HexFormat.of().parseHex("0000016588840021");
  static final byte[] SLICE = HexFormat.of().parseHex("00000141e1aa");

  record Unit(String hex, boolean keyframe) {}

  static byte[] join(byte[]... parts) {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    for (byte[] p : parts) {
      out.writeBytes(p);
    }
    return out.toByteArray();
  }

  private static String hex(byte[]... parts) {
    return HexFormat.of().formatHex(join(parts));
  }

  @Test
  void splitsAtEachDelimiterWhateverTheChunksAndMarksIdrUnitsAsKeyframes() throws IOException {
    byte[] stream = join(AUD4, SPS, IDR, AUD3, SLICE, AUD4, SLICE);
    for (int chunk : List.of(1, 2, 3, 5, 7, stream.length)) {
      List<Unit> units = new ArrayList<>();
      AccessUnits splitter = new AccessUnits((u, k) -> units.add(new Unit(HexFormat.of().formatHex(u), k)));
      for (int at = 0; at < stream.length; at += chunk) {
        byte[] part = java.util.Arrays.copyOfRange(stream, at, Math.min(stream.length, at + chunk));
        splitter.accept(part, part.length);
      }
      assertThat(units).as("chunks of %d: the last waits for the next delimiter", chunk).containsExactly(
          new Unit(hex(AUD4, SPS, IDR), true), new Unit(hex(AUD3, SLICE), false));
      splitter.finish();
      assertThat(units).as("chunks of %d", chunk).hasSize(3).last().isEqualTo(new Unit(hex(AUD4, SLICE), false));
    }
  }

  @Test
  void bytesBeforeTheFirstDelimiterJoinTheFirstUnitAndAHugeUnitIsRefused() throws IOException {
    List<Unit> units = new ArrayList<>();
    AccessUnits splitter = new AccessUnits((u, k) -> units.add(new Unit(HexFormat.of().formatHex(u), k)), 64);
    byte[] start = join(SPS, AUD4, IDR, AUD4);
    splitter.accept(start, start.length);
    assertThat(units).containsExactly(new Unit(hex(SPS, AUD4, IDR), true));

    byte[] big = new byte[80];
    big[0] = 1; // no start code inside
    assertThatThrownBy(() -> splitter.accept(big, big.length)).isInstanceOf(IOException.class).hasMessage("an access unit over 0 MiB");
    new AccessUnits((u, k) -> units.add(null)).finish();
    assertThat(units).as("nothing at the end of nothing").hasSize(1);
  }
}
