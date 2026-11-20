package dev.emcc.plugins.fmv.ts;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.fmv.klv.St0601;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The output link's transport stream (brief section 10.6 point 18; criterion 32), read back by the input side's reader. */
class TsMuxerTest {

  private static final Instant T0 = Instant.parse("2026-11-17T10:00:00Z");

  /** A fake access unit: a delimiter, an IDR or a non-IDR slice, and some bytes. */
  private static byte[] accessUnit(int k, boolean key, int size) {
    byte[] au = new byte[size];
    au[2] = 1;
    au[3] = 0x09;
    au[4] = (byte) 0xF0;
    au[7] = 1;
    au[8] = (byte) (key ? 0x65 : 0x41);
    for (int i = 9; i < size; i++) {
      au[i] = (byte) (k + i | 0x80);
    }
    return au;
  }

  /** A KLV item the reader takes: an ST 0601 set from the writer's own key and checksum is tested elsewhere; here any KLV. */
  private static byte[] klv(int k) {
    return dev.emcc.plugins.fmv.klv.St0601Writer.write(
        new dev.emcc.plugins.fmv.out.Pose("c", T0.plusMillis(40L * k), new dev.emcc.plugins.fmv.out.Pose.Platform(17.3, 62.4, 1000, 10, 0, 0, null),
            new dev.emcc.plugins.fmv.out.Pose.Pointing(0, 30, 0), 20, 11.33, 1280, 720, 25, null), null, "Hawk 1", 1, "//NATO");
  }

  private record Packet(int pid, boolean start, boolean adaptation, boolean rai, long pcr, int cc, byte[] raw) {}

  private static List<Packet> packets(List<byte[]> datagrams) {
    List<Packet> out = new ArrayList<>();
    for (byte[] d : datagrams) {
      for (int at = 0; at < d.length; at += 188) {
        byte[] p = java.util.Arrays.copyOfRange(d, at, at + 188);
        int pid = ((p[1] & 0x1F) << 8) | (p[2] & 0xFF);
        boolean af = (p[3] & 0x20) != 0;
        boolean rai = af && (p[4] & 0xFF) > 0 && (p[5] & 0x40) != 0;
        long pcr = -1;
        if (af && (p[4] & 0xFF) >= 7 && (p[5] & 0x10) != 0) {
          long base = ((p[6] & 0xFFL) << 25) | ((p[7] & 0xFFL) << 17) | ((p[8] & 0xFFL) << 9) | ((p[9] & 0xFFL) << 1) | ((p[10] & 0x80L) >> 7);
          pcr = base;
        }
        out.add(new Packet(pid, (p[1] & 0x40) != 0, af, rai, pcr, p[3] & 0xF, p));
      }
    }
    return out;
  }

  private static long pts(byte[] packet, int payloadAt) {
    int a = payloadAt + 9;
    return ((packet[a] & 0x0EL) << 29) | ((packet[a + 1] & 0xFFL) << 22) | ((packet[a + 2] & 0xFEL) << 14) | ((packet[a + 3] & 0xFFL) << 7)
        | ((packet[a + 4] & 0xFEL) >> 1);
  }

  @Test
  void criterion32TablesRaiPcrContinuityAndDatagrams() {
    TsMuxer mux = new TsMuxer();
    List<byte[]> datagrams = new ArrayList<>();
    List<Boolean> keys = new ArrayList<>();
    for (int k = 0; k < 75; k++) {
      boolean key = k % 25 == 0;
      keys.add(key);
      int size = key ? 30_000 : 3_000 + 37 * k;
      datagrams.addAll(mux.picture(T0.plus(Duration.ofMillis(40L * k)), key, accessUnit(k, key, size), klv(k)));
    }
    assertThat(datagrams).allSatisfy(d -> assertThat(d).hasSize(7 * 188));
    List<Packet> packets = packets(datagrams);

    // PAT and PMT before every third picture, never with an adaptation field
    List<Packet> pats = packets.stream().filter(p -> p.pid() == 0).toList();
    List<Packet> pmts = packets.stream().filter(p -> p.pid() == TsMuxer.PMT_PID).toList();
    assertThat(pats).hasSize(25).allSatisfy(p -> assertThat(p.adaptation()).isFalse());
    assertThat(pmts).hasSize(25).allSatisfy(p -> assertThat(p.adaptation()).isFalse());

    // the RAI on each keyframe's first packet and on no other
    List<Packet> video = packets.stream().filter(p -> p.pid() == TsMuxer.VIDEO_PID).toList();
    List<Packet> starts = video.stream().filter(Packet::start).toList();
    assertThat(starts).hasSize(75);
    for (int k = 0; k < 75; k++) {
      assertThat(starts.get(k).rai()).as("picture %d", k).isEqualTo(keys.get(k));
    }
    assertThat(video.stream().filter(p -> !p.start()).noneMatch(Packet::rai)).isTrue();
    assertThat(packets.stream().filter(p -> p.pid() != TsMuxer.VIDEO_PID).noneMatch(Packet::rai)).isTrue();

    // a PCR in each picture's first packet, 100 ms (9 000 ticks) before its PTS
    for (Packet s : starts) {
      int payloadAt = 4 + 1 + (s.raw()[4] & 0xFF);
      assertThat(s.pcr()).isGreaterThanOrEqualTo(0);
      assertThat(pts(s.raw(), payloadAt) - s.pcr()).isEqualTo(9_000);
    }

    // continuity counters without a gap on every PID but the null one
    Map<Integer, Integer> last = new HashMap<>();
    for (Packet p : packets) {
      if (p.pid() == TsMuxer.NULL_PID) {
        continue;
      }
      Integer before = last.put(p.pid(), p.cc());
      if (before != null) {
        assertThat(p.cc()).as("PID %d", p.pid()).isEqualTo((before + 1) & 0xF);
      }
    }
  }

  @Test
  void theInputSidesReaderChoosesTheProgramReadsEveryKlvSetAndFindsTheStartPoints() {
    TsMuxer mux = new TsMuxer();
    TsReader reader = new TsReader();
    List<byte[]> sets = new ArrayList<>();
    List<String> dropped = new ArrayList<>();
    List<Program> programs = new ArrayList<>();
    TsReader.Sink sink = new TsReader.Sink() {
      @Override public void program(Program program) {
        programs.add(program);
      }

      @Override public void header(byte[] packets) {}

      @Override public void klv(byte[] payload) {
        sets.add(payload);
      }

      @Override public void dropped(String reason) {
        dropped.add(reason);
      }

      @Override public void size(VideoSize size) {}
    };
    int startPoints = 0;
    for (int k = 0; k < 50; k++) {
      boolean key = k % 25 == 0;
      for (byte[] d : mux.picture(T0.plus(Duration.ofMillis(40L * k)), key, accessUnit(k, key, key ? 20_000 : 2_000), k % 5 == 0 ? klv(k) : null)) {
        assertThat(TsReader.isTransportStream(d, 0, d.length)).isTrue();
        if (reader.feed(d, 0, d.length, sink)) {
          startPoints++;
        }
      }
    }
    assertThat(programs).isNotEmpty();
    assertThat(programs.getLast().videoPid()).isEqualTo(TsMuxer.VIDEO_PID);
    assertThat(programs.getLast().klvPid()).isEqualTo(TsMuxer.KLV_PID);
    assertThat(dropped).isEmpty();
    assertThat(startPoints).isEqualTo(2);
    // the first set comes before the reader knows the program (the tables come first, so it does)
    assertThat(sets).hasSize(10).allSatisfy(s -> assertThat(St0601.read(s)).singleElement().satisfies(r -> assertThat(r.dropped()).isNull()));
  }

  @Test
  void thePtsFollowsThePicturesTimeAndWraps() {
    assertThat(TsMuxer.pts(Instant.ofEpochSecond(0, 40_000_000))).isEqualTo(3_600);
    assertThat(TsMuxer.pts(Instant.ofEpochSecond(95_443, 717_689_000))).isLessThan(90_000); // 2³³ ticks ≈ 95 443.717 7 s
  }
}
