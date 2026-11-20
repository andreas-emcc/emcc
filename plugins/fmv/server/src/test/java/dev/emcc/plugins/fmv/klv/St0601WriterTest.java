package dev.emcc.plugins.fmv.klv;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.fmv.out.Pose;
import dev.emcc.plugins.fmv.out.render.Renderer;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The ST 0601 and ST 0102 writer (brief section 10.6 points 19 and 20; criteria 30 and 31). */
class St0601WriterTest {

  private static Pose pose(double heading, double azimuth, double depression, double pitch, double roll, double height, String mission) {
    return new Pose("0190d7a2-6c2b-7a10-8000-000000000001", Instant.parse("2026-11-17T10:00:00.040Z"),
        new Pose.Platform(17.3, 62.4, height, heading, pitch, roll, "Hawk 1"), new Pose.Pointing(azimuth, depression, 0), 20, 11.33, 1280, 720,
        25, mission);
  }

  private static final Renderer.FrameCentre CENTRE = new Renderer.FrameCentre(17.3301, 62.3912, 136.5, 2983.3);

  /** The items of one set by tag (each tag once), from its value; the checksum's included. */
  private static Map<Integer, byte[]> items(byte[] set) {
    long[] length = St0601.ber(set, 16);
    int at = (int) length[1];
    int end = at + (int) length[0];
    Map<Integer, byte[]> out = new HashMap<>();
    while (at < end) {
      int tag = set[at++] & 0x7F;
      long[] l = St0601.ber(set, at);
      at = (int) l[1];
      out.put(tag, java.util.Arrays.copyOfRange(set, at, at + (int) l[0]));
      at += (int) l[0];
    }
    return out;
  }

  private static long unsigned(byte[] v) {
    long r = 0;
    for (byte b : v) {
      r = (r << 8) | (b & 0xFF);
    }
    return r;
  }

  @Test
  void criterion30TheAnglesAndTheCentreReadBackAndTheChecksumChecks() {
    byte[] set = St0601Writer.write(pose(45, 90, 30, 0, 0, 1000, "Test"), CENTRE, "Hawk 1", 1, "//NATO");
    List<St0601.Result> read = St0601.read(set);
    assertThat(read).singleElement().satisfies(r -> {
      assertThat(r.dropped()).isNull();
      assertThat(r.outOfRange()).isZero();
      var m = r.metadata();
      assertThat(m).isNotNull();
      assertThat(m.timeMicros()).isEqualTo(Instant.parse("2026-11-17T10:00:00.040Z").toEpochMilli() * 1000);
      assertThat(m.missionId()).isEqualTo("Test");
      assertThat(m.platformDesignation()).isEqualTo("Hawk 1");
      assertThat(m.imageSourceSensor()).isEqualTo(St0601Writer.SENSOR);
      assertThat(m.heading()).isCloseTo(45, within(0.01));
      assertThat(m.relativeAzimuth()).isCloseTo(90, within(0.01));
      assertThat(m.relativeElevation()).isCloseTo(-30, within(0.01)); // tag 19 = −depression
      assertThat(m.sensorLatitude()).isCloseTo(62.4, within(1e-7));
      assertThat(m.sensorLongitude()).isCloseTo(17.3, within(1e-7));
      assertThat(m.sensorAltitude()).isCloseTo(1000, within(0.31));
      assertThat(m.horizontalFov()).isCloseTo(20, within(0.01));
      assertThat(m.verticalFov()).isCloseTo(11.33, within(0.01));
      assertThat(m.slantRange()).isCloseTo(2983.3, within(0.01));
      assertThat(m.frameCenterLatitude()).isCloseTo(62.3912, within(1e-7));
      assertThat(m.frameCenterLongitude()).isCloseTo(17.3301, within(1e-7));
      assertThat(m.frameCenterElevation()).isCloseTo(136.5, within(0.31));
      assertThat(m.version()).isEqualTo(14);
    });
    // the checksum covers the whole set: one byte changed and the reader drops it
    byte[] broken = set.clone();
    broken[30] ^= 1;
    assertThat(St0601.read(broken)).singleElement().extracting(St0601.Result::dropped).isEqualTo("checksum");
  }

  @Test
  void criterion31TheSecuritySetCarriesTheClassificationAndTheCountry() {
    byte[] unclassified = St0601Writer.write(pose(0, 0, 30, 0, 0, 1000, null), CENTRE, "Hawk 1", 1, "//NATO");
    byte[] secret = St0601Writer.write(pose(0, 0, 30, 0, 0, 1000, null), CENTRE, "Hawk 1", 4, "//NATO");
    var u = St0601.read(unclassified).getFirst().metadata().security();
    var s = St0601.read(secret).getFirst().metadata().security();
    assertThat(u.classification()).isEqualTo(1);
    assertThat(s.classification()).isEqualTo(4);
    assertThat(s.country()).isEqualTo("//NATO");
    assertThat(s.countryMethod()).isEqualTo(0x07);
    assertThat(s.version()).isEqualTo(12);
  }

  @Test
  void tagsTwoComeFirstAndTheChecksumLastAndAMissingMissionIsLeftOut() {
    byte[] set = St0601Writer.write(pose(0, 0, 30, 0, 0, 1000, null), CENTRE, "Hawk 1", 1, "//NATO");
    long[] length = St0601.ber(set, 16);
    assertThat(set[(int) length[1]]).isEqualTo((byte) 2);
    assertThat(set[set.length - 4]).isEqualTo((byte) 1);
    assertThat(set[set.length - 3]).isEqualTo((byte) 2);
    assertThat(items(set)).doesNotContainKey(3).containsKeys(2, 5, 6, 7, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 24, 25, 48, 65, 1);
  }

  @Test
  void theOwnersA2PitchAndRollOutsideTheirRangesAndHeightsClamped() {
    Map<Integer, byte[]> in = items(St0601Writer.write(pose(0, 0, 30, 10, -25, 1000, null), CENTRE, "Hawk 1", 1, "//NATO"));
    assertThat((short) unsigned(in.get(6)) * 20.0 / 32767).isCloseTo(10, within(0.001));
    assertThat((short) unsigned(in.get(7)) * 50.0 / 32767).isCloseTo(-25, within(0.002));
    Map<Integer, byte[]> out = items(St0601Writer.write(pose(0, 0, 30, 30, 90, 19_500, null), CENTRE, "Hawk 1", 1, "//NATO"));
    assertThat(unsigned(out.get(6))).isEqualTo(0x8000);
    assertThat(unsigned(out.get(7))).isEqualTo(0x8000);
    assertThat(unsigned(out.get(15))).isEqualTo(Math.round(19_900 * 65535.0 / 19_900));
  }

  @Test
  void withoutAFrameCentreTagsTwentyThreeAndTwentyFourSayNoneAndTheRangeIsLeftOut() {
    byte[] set = St0601Writer.write(pose(0, 0, -10, 0, 0, 1000, null), null, "Hawk 1", 1, "//NATO");
    Map<Integer, byte[]> in = items(set);
    assertThat(unsigned(in.get(23))).isEqualTo(0x8000_0000L);
    assertThat(unsigned(in.get(24))).isEqualTo(0x8000_0000L);
    assertThat(in).doesNotContainKeys(21, 25);
    var m = St0601.read(set).getFirst();
    assertThat(m.dropped()).isNull();
    assertThat(m.outOfRange()).isZero();
    assertThat(m.metadata().frameCenterLatitude()).isNull();
  }

  @Test
  void aLongMissionIsCutAtACharactersEdge() {
    String mission = "Å".repeat(64);
    byte[] set = St0601Writer.write(pose(0, 0, 30, 0, 0, 1000, mission), CENTRE, "Hawk 1", 1, "//NATO");
    assertThat(items(set).get(3)).hasSize(126);
    assertThat(St0601.read(set).getFirst().metadata().missionId()).isEqualTo("Å".repeat(63));
  }
}
