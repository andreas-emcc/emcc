package dev.emcc.plugins.fmv.ts;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.fmv.ts.Ts.Es;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Brief criteria 2 and 3 (tables, KLV), and the random access and size the stream needs (criterion 11). */
class TsReaderTest {

  static final int PMT_PID = 480;
  static final int VIDEO = 481;
  static final int KLV = 497;

  /** Records what the reader tells. */
  static final class Rec implements TsReader.Sink {
    final List<Program> programs = new ArrayList<>();
    final List<byte[]> headers = new ArrayList<>();
    final List<byte[]> klv = new ArrayList<>();
    final List<String> dropped = new ArrayList<>();
    final List<VideoSize> sizes = new ArrayList<>();

    @Override public void program(Program p) { programs.add(p); }
    @Override public void header(byte[] h) { headers.add(h); }
    @Override public void klv(byte[] k) { klv.add(k); }
    @Override public void dropped(String r) { dropped.add(r); }
    @Override public void size(VideoSize s) { sizes.add(s); }
  }

  private final TsReader reader = new TsReader();
  private final Rec rec = new Rec();

  private boolean feed(byte[]... packets) {
    byte[] d = Ts.datagram(packets);
    assertThat(TsReader.isTransportStream(d, 0, d.length)).isTrue();
    return reader.feed(d, 0, d.length, rec);
  }

  private void tables() {
    feed(Ts.pat(0, 1, PMT_PID), Ts.pmt(0, 1, PMT_PID, new Es(0x1B, VIDEO), new Es(0x06, KLV, Ts.klva())));
  }

  @Test
  void aDatagramIsWholePacketsThatStartWithSyncBytes() {
    byte[] seven = new byte[7 * 188];
    for (int i = 0; i < 7; i++) {
      seven[i * 188] = 0x47;
    }
    assertThat(TsReader.isTransportStream(seven, 0, seven.length)).isTrue();
    assertThat(TsReader.isTransportStream(seven, 0, seven.length - 1)).as("not a whole number of packets").isFalse();
    assertThat(TsReader.isTransportStream(seven, 0, 0)).isFalse();
    seven[3 * 188] = 0x46;
    assertThat(TsReader.isTransportStream(seven, 0, seven.length)).as("a packet without its sync byte").isFalse();
  }

  @Test
  void criterion2_choosesTheProgramAndItsHeader() {
    tables();
    assertThat(rec.programs).containsExactly(new Program(1, PMT_PID, VIDEO, new VideoFormat(0x1B), KLV));
    byte[] pat = Ts.pat(0, 1, PMT_PID);
    byte[] pmt = Ts.pmt(0, 1, PMT_PID, new Es(0x1B, VIDEO), new Es(0x06, KLV, Ts.klva()));
    assertThat(rec.headers).hasSize(1);
    assertThat(rec.headers.get(0)).isEqualTo(Ts.datagram(pat, pmt));
    tables(); // the same tables again, as a sender repeats them
    assertThat(rec.programs).hasSize(1);
    assertThat(rec.headers).as("a table that did not change is no news").hasSize(1);
  }

  @Test
  void criterion2_theFirstProgramWithVideoWins() {
    feed(Ts.pat(0, 1, 100, 2, PMT_PID),
        Ts.pmt(0, 1, 100, new Es(0x0F, 300)), // audio only
        Ts.pmt(0, 2, PMT_PID, new Es(0x02, VIDEO)));
    assertThat(rec.programs).containsExactly(new Program(2, PMT_PID, VIDEO, new VideoFormat(0x02), -1));
  }

  @Test
  void criterion2_aNewVideoTypeIsAnotherVideo() {
    tables();
    feed(Ts.pmt(1, 1, PMT_PID, new Es(0x24, VIDEO), new Es(0x06, KLV, Ts.klva())));
    assertThat(rec.programs).hasSize(2);
    assertThat(rec.programs.get(0).sameVideoAs(rec.programs.get(1))).isFalse();
    assertThat(rec.programs.get(1).video().kind()).isEqualTo(VideoFormat.Kind.H265);
    assertThat(rec.headers).as("the header follows the new PMT").hasSize(2);
  }

  @Test
  void aPmtWithAnotherKlvPidIsTheSameVideo() {
    tables();
    feed(Ts.pmt(1, 1, PMT_PID, new Es(0x1B, VIDEO), new Es(0x15, 498)));
    assertThat(rec.programs).hasSize(2);
    assertThat(rec.programs.get(1).klvPid()).isEqualTo(498);
    assertThat(rec.programs.get(0).sameVideoAs(rec.programs.get(1))).isTrue();
  }

  @Test
  void aSectionWithAWrongChecksumIsIgnored() {
    feed(Ts.badPat(0, 1, PMT_PID), Ts.pmt(0, 1, PMT_PID, new Es(0x1B, VIDEO)));
    assertThat(rec.programs).isEmpty();
  }

  @Test
  void privateDataWithoutKlvaIsNotKlv() {
    feed(Ts.pat(0, 1, PMT_PID), Ts.pmt(0, 1, PMT_PID, new Es(0x1B, VIDEO), new Es(0x06, KLV)));
    assertThat(rec.programs.get(0).klvPid()).isEqualTo(-1);
  }

  @Test
  void videoTypesThePlayerCannotUseAreStillListed() {
    feed(Ts.pat(0, 1, PMT_PID), Ts.pmt(0, 1, PMT_PID, new Es(0x21, VIDEO)));
    VideoFormat format = rec.programs.get(0).video();
    assertThat(format.kind()).isEqualTo(VideoFormat.Kind.OTHER);
    assertThat(format.label()).isEqualTo("JPEG 2000");
  }

  @Test
  void criterion11_startPointsAreTheRandomAccessVideoStarts() {
    tables();
    byte[] x = new byte[100];
    assertThat(feed(Ts.videoStart(VIDEO, 0, true, x))).isTrue();
    assertThat(feed(Ts.videoStart(VIDEO, 1, false, x))).as("a start without the indicator").isFalse();
    assertThat(feed(Ts.videoMiddle(VIDEO, 2, true, x))).as("the indicator in the middle of a unit").isFalse();
    assertThat(feed(Ts.videoMiddle(VIDEO, 3, false, x), Ts.videoStart(VIDEO, 4, true, x))).as("one packet of seven is enough").isTrue();
    assertThat(feed(Ts.videoStart(KLV + 1, 0, true, x))).as("another PID").isFalse();
  }

  @Test
  void criterion3_aKlvPesInSeveralPackets() {
    tables();
    byte[] klv = new byte[500];
    for (int i = 0; i < klv.length; i++) {
      klv[i] = (byte) i;
    }
    feed(Ts.klvPes(KLV, 0, klv).toArray(byte[][]::new));
    assertThat(rec.klv).hasSize(1);
    assertThat(rec.klv.get(0)).isEqualTo(klv);
    assertThat(rec.dropped).isEmpty();
  }

  @Test
  void criterion3_aContinuityGapDropsThePesBeingAssembled() {
    tables();
    List<byte[]> first = Ts.klvPes(KLV, 0, new byte[500]);
    List<byte[]> second = Ts.klvPes(KLV, 3, new byte[40]);
    feed(first.get(0), first.get(2)); // the middle packet is lost
    assertThat(rec.dropped).containsExactly("continuity gap");
    feed(second.toArray(byte[][]::new));
    assertThat(rec.klv).as("the next PES is read").hasSize(1);
  }

  @Test
  void criterion3_aPesAbove64KiBIsDropped() {
    tables();
    feed(Ts.klvPesUnbounded(KLV, 0, new byte[70_000]).toArray(byte[][]::new));
    assertThat(rec.dropped).containsExactly("KLV too long");
    assertThat(rec.klv).isEmpty();
    feed(Ts.klvPes(KLV, 4, new byte[40]).toArray(byte[][]::new));
    assertThat(rec.klv).as("the next one is read").hasSize(1);
  }

  @Test
  void criterion3_aPesOfUnstatedLengthEndsAtTheNextOne() {
    tables();
    feed(Ts.klvPesUnbounded(KLV, 0, new byte[] {1, 2, 3}).toArray(byte[][]::new));
    assertThat(rec.klv).as("not yet: it might go on").isEmpty();
    feed(Ts.klvPesUnbounded(KLV, 1, new byte[] {4, 5}).toArray(byte[][]::new));
    assertThat(rec.klv).hasSize(1);
    assertThat(rec.klv.get(0)).isEqualTo(new byte[] {1, 2, 3});
  }

  @Test
  void criterion3_aRepeatedPacketIsNoGap() {
    tables();
    List<byte[]> pes = Ts.klvPes(KLV, 0, new byte[300]);
    feed(pes.get(0), pes.get(0), pes.get(1));
    assertThat(rec.dropped).isEmpty();
    assertThat(rec.klv).hasSize(1);
  }

  @Test
  void theSizeOfAnMpeg2Video() {
    feed(Ts.pat(0, 1, PMT_PID), Ts.pmt(0, 1, PMT_PID, new Es(0x02, VIDEO)));
    feed(Ts.videoStart(VIDEO, 0, true, Ts.mpeg2Header(1280, 720)));
    assertThat(rec.sizes).containsExactly(new VideoSize(1280, 720));
    feed(Ts.videoStart(VIDEO, 1, true, Ts.mpeg2Header(1280, 720)));
    assertThat(rec.sizes).as("told once").hasSize(1);
  }

  @Test
  void theSizeOfAnH264VideoWithAndWithoutCropping() {
    tables();
    byte[] pes = new byte[] {0, 0, 1, (byte) 0xE0, 0, 0, (byte) 0x80, 0, 0};
    feed(Ts.videoStart(VIDEO, 0, true, concat(pes, Ts.h264Sps(66, 80, 45, 0, 0))));
    assertThat(rec.sizes).containsExactly(new VideoSize(1280, 720));
  }

  @Test
  void theSizeOfA1080pHighProfileVideoWhoseSpsIsCropped() {
    tables();
    byte[] pes = new byte[] {0, 0, 1, (byte) 0xE0, 0, 0, (byte) 0x80, 0, 0};
    feed(Ts.videoStart(VIDEO, 0, true, concat(pes, Ts.h264Sps(100, 120, 68, 0, 4))));
    assertThat(rec.sizes).containsExactly(new VideoSize(1920, 1080));
  }

  @Test
  void aWidthAndHeightThatDifferShowThatTheyAreNotMixedUp() {
    tables();
    byte[] pes = new byte[] {0, 0, 1, (byte) 0xE0, 0, 0, (byte) 0x80, 0, 0};
    feed(Ts.videoStart(VIDEO, 0, true, concat(pes, Ts.h264Sps(66, 40, 30, 0, 0))));
    assertThat(rec.sizes).containsExactly(new VideoSize(640, 480));
  }

  private static byte[] concat(byte[] a, byte[] b) {
    return Ts.datagram(a, b);
  }
}
