package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/** T-211: reading a converter's output (CR-0044 E2): the header from PAT and PMT, the start points, a lost sync. */
class TsOutputTest {

  static final int PMT_PID = 4096;
  static final int VIDEO_PID = 256;
  static final int KLV_PID = 257;

  /** A packet of {@code pid}; {@code start} sets payload_unit_start; {@code randomAccess} adds an adaptation field with RAI. */
  static byte[] packet(int pid, boolean start, boolean randomAccess, int counter, byte[] payload) {
    byte[] p = new byte[TsOutput.PACKET];
    Arrays.fill(p, (byte) 0xff);
    p[0] = 0x47;
    p[1] = (byte) ((start ? 0x40 : 0) | (pid >> 8));
    p[2] = (byte) pid;
    int at = 4;
    if (randomAccess) {
      p[3] = (byte) (0x30 | (counter & 0x0f));
      p[4] = 1; // adaptation field length
      p[5] = 0x40; // random_access_indicator
      at = 6;
    } else {
      p[3] = (byte) (0x10 | (counter & 0x0f));
    }
    System.arraycopy(payload, 0, p, at, Math.min(payload.length, TsOutput.PACKET - at));
    return p;
  }

  /** A PAT naming one program whose PMT is at {@link #PMT_PID}. */
  static byte[] pat(int counter) {
    return packet(0, true, false, counter, new byte[] {0, // pointer
        0x00, (byte) 0xb0, 0x0d, 0x00, 0x01, (byte) 0xc1, 0x00, 0x00, // table id, length 13, ts id, version, sections
        0x00, 0x01, (byte) (0xe0 | (PMT_PID >> 8)), (byte) PMT_PID, // program 1 -> PMT PID
        0, 0, 0, 0}); // CRC (not checked)
  }

  /** A PMT with an H.264 video stream at {@link #VIDEO_PID} and a KLV data stream at {@link #KLV_PID}. */
  static byte[] pmt(int counter) {
    return packet(PMT_PID, true, false, counter, new byte[] {0, // pointer
        0x02, (byte) 0xb0, 0x17, 0x00, 0x01, (byte) 0xc1, 0x00, 0x00, // table id, length 23
        (byte) 0xe1, 0x00, (byte) 0xf0, 0x00, // PCR PID 256, program info length 0
        0x1b, (byte) (0xe0 | (VIDEO_PID >> 8)), (byte) VIDEO_PID, (byte) 0xf0, 0x00, // H.264
        0x06, (byte) (0xe0 | (KLV_PID >> 8)), (byte) KLV_PID, (byte) 0xf0, 0x00, // private data (KLV)
        0, 0, 0, 0});
  }

  static byte[] join(byte[]... parts) {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    for (byte[] p : parts) {
      out.writeBytes(p);
    }
    return out.toByteArray();
  }

  /** What the sink got. */
  static final class Recorder implements TsOutput.Sink {
    final List<byte[]> headers = new ArrayList<>();
    final List<String> chunks = new ArrayList<>();

    @Override
    public void header(byte[] header) {
      headers.add(header);
    }

    @Override
    public void chunk(byte[] data, boolean startPoint) {
      chunks.add((startPoint ? "start " : "") + data.length / TsOutput.PACKET);
    }
  }

  @Test
  void findsTheHeaderAndStartsAChunkAtEachVideoRandomAccessPoint() {
    Recorder sink = new Recorder();
    TsOutput ts = new TsOutput(sink);
    byte[] stream = join(pat(0), pmt(0), packet(VIDEO_PID, true, true, 0, new byte[0]), packet(VIDEO_PID, false, false, 1, new byte[0]),
        packet(KLV_PID, true, true, 0, new byte[0]), // a data packet's RAI is no start point
        packet(VIDEO_PID, true, true, 2, new byte[0]), packet(VIDEO_PID, false, false, 3, new byte[0]),
        pat(1), pmt(1), // the same header again: not reported again
        packet(VIDEO_PID, false, false, 4, new byte[0]));

    ts.accept(stream, stream.length);

    assertThat(sink.headers).hasSize(1);
    assertThat(sink.headers.getFirst()).isEqualTo(join(pat(0), pmt(0)));
    // the last packet waits for the next one's sync byte, which confirms it
    assertThat(sink.chunks).containsExactly("2", "start 3", "start 4");
  }

  @Test
  void takesThePacketsInAnyPiecesAndFindsTheSyncAgainAfterGarbage() {
    Recorder sink = new Recorder();
    TsOutput ts = new TsOutput(sink);
    byte[] stream = join(pat(0), pmt(0), new byte[] {0x47, 1, 2, 3, 0x11}, // garbage, with a false sync byte
        packet(VIDEO_PID, true, true, 0, new byte[0]), packet(VIDEO_PID, false, false, 1, new byte[0]),
        packet(VIDEO_PID, false, false, 2, new byte[0]));

    for (int at = 0; at < stream.length; at += 7) { // a byte at a time would do too
      byte[] piece = Arrays.copyOfRange(stream, at, Math.min(stream.length, at + 7));
      ts.accept(piece, piece.length);
    }

    assertThat(sink.headers).hasSize(1);
    assertThat(ts.lostSyncs()).isPositive();
    assertThat(String.join(",", sink.chunks).replace(",", " ")).contains("start");
    assertThat(sink.chunks.stream().mapToInt(c -> Integer.parseInt(c.replace("start ", ""))).sum())
        .as("every whole packet but the last, which waits").isEqualTo(4);
  }

  @Test
  void skipsTheNitInThePatAndGivesNoHeaderOrStartPointsWithoutAVideoStream() {
    Recorder sink = new Recorder();
    TsOutput ts = new TsOutput(sink);
    byte[] patWithNit = packet(0, true, false, 0, new byte[] {0,
        0x00, (byte) 0xb0, 0x11, 0x00, 0x01, (byte) 0xc1, 0x00, 0x00, // length 17: two programs
        0x00, 0x00, (byte) 0xe0, 0x10, // program 0: the NIT at PID 16
        0x00, 0x01, (byte) (0xe0 | (PMT_PID >> 8)), (byte) PMT_PID, // program 1 -> PMT PID
        0, 0, 0, 0});
    byte[] pmtWithoutVideo = packet(PMT_PID, true, false, 0, new byte[] {0,
        0x02, (byte) 0xb0, 0x12, 0x00, 0x01, (byte) 0xc1, 0x00, 0x00, (byte) 0xe1, 0x01, (byte) 0xf0, 0x00,
        0x06, (byte) (0xe0 | (KLV_PID >> 8)), (byte) KLV_PID, (byte) 0xf0, 0x00, // data only
        0, 0, 0, 0});
    byte[] stream = join(patWithNit, pmtWithoutVideo, packet(KLV_PID, true, true, 0, new byte[0]), packet(KLV_PID, false, false, 1, new byte[0]),
        patWithNit, pmt(1), packet(VIDEO_PID, true, true, 0, new byte[0]), packet(VIDEO_PID, false, false, 1, new byte[0]));

    ts.accept(stream, stream.length);

    assertThat(sink.headers).as("only once the PMT names a video stream").singleElement()
        .satisfies(h -> assertThat(h).isEqualTo(join(patWithNit, pmt(1))));
    assertThat(sink.chunks).contains("start 1");
  }

  @Test
  void neverPassesAChunkAboveTheLimit() {
    Recorder sink = new Recorder();
    TsOutput ts = new TsOutput(sink);
    byte[] many = new byte[TsOutput.PACKET * 1000];
    for (int i = 0; i < 1000; i++) {
      System.arraycopy(packet(VIDEO_PID, false, false, i, new byte[0]), 0, many, i * TsOutput.PACKET, TsOutput.PACKET);
    }

    ts.accept(many, many.length);

    assertThat(sink.chunks).allSatisfy(c -> assertThat(Integer.parseInt(c) * TsOutput.PACKET).isLessThanOrEqualTo(65_536));
  }
}
