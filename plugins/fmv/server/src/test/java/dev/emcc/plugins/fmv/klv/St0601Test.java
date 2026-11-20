package dev.emcc.plugins.fmv.klv;

import static dev.emcc.plugins.fmv.klv.Klv.cat;
import static dev.emcc.plugins.fmv.klv.Klv.item;
import static dev.emcc.plugins.fmv.klv.Klv.set;
import static dev.emcc.plugins.fmv.klv.Klv.text;
import static dev.emcc.plugins.fmv.klv.Klv.u;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Brief criteria 3 and 4: KLV items, the checksum, and each tag's conversion. */
class St0601Test {

  private static Metadata one(byte[] payload) {
    List<St0601.Result> r = St0601.read(payload);
    assertThat(r).hasSize(1);
    assertThat(r.get(0).dropped()).isNull();
    return r.get(0).metadata();
  }

  /** A signed 32-bit item, written from its hex value. */
  private static byte[] s32(int tag, int raw) {
    return u(tag, raw & 0xFFFFFFFFL, 4);
  }

  @Test
  void criterion4_theAnchorsOfEveryScale() {
    // The ends of each tag's range, from the raw values the standard's tables give.
    Metadata m = one(set(
        u(5, 0xFFFF, 2), u(13, 0x7FFFFFFF, 4), s32(14, 0x40000000), u(15, 0xFFFF, 2), u(16, 0xFFFF, 2), u(17, 0, 2),
        u(18, 0xFFFFFFFFL, 4), s32(19, 0xC0000000), u(21, 0xFFFFFFFFL, 4), s32(23, 0x80000001), s32(24, 0x7FFFFFFF), u(25, 0, 2)));
    assertThat(m.heading()).isCloseTo(360.0, within(1e-9));
    assertThat(m.sensorLatitude()).isCloseTo(90.0, within(1e-9));
    assertThat(m.sensorLongitude()).isCloseTo(90.0, within(1e-6));
    assertThat(m.sensorAltitude()).isCloseTo(19_000.0, within(1e-6));
    assertThat(m.horizontalFov()).isCloseTo(180.0, within(1e-9));
    assertThat(m.verticalFov()).isEqualTo(0.0);
    assertThat(m.relativeAzimuth()).isCloseTo(360.0, within(1e-9));
    assertThat(m.relativeElevation()).isCloseTo(-90.0, within(1e-6));
    assertThat(m.slantRange()).isCloseTo(5_000_000.0, within(1e-6));
    assertThat(m.frameCenterLatitude()).isCloseTo(-90.0, within(1e-6));
    assertThat(m.frameCenterLongitude()).isCloseTo(180.0, within(1e-9));
    assertThat(m.frameCenterElevation()).isCloseTo(-900.0, within(1e-9));
  }

  @Test
  void criterion4_latitudeAndLongitudeAreNotMixedUp() {
    // Sundsvall's latitude 62.39 and longitude 17.31: different, so a swap shows.
    int lat = (int) Math.round(62.39 / (90.0 / Integer.MAX_VALUE));
    int lon = (int) Math.round(17.31 / (180.0 / Integer.MAX_VALUE));
    int fcLat = (int) Math.round(62.41 / (90.0 / Integer.MAX_VALUE));
    int fcLon = (int) Math.round(17.35 / (180.0 / Integer.MAX_VALUE));
    Metadata m = one(set(s32(13, lat), s32(14, lon), s32(23, fcLat), s32(24, fcLon)));
    assertThat(m.sensorLatitude()).isCloseTo(62.39, within(1e-6));
    assertThat(m.sensorLongitude()).isCloseTo(17.31, within(1e-6));
    assertThat(m.frameCenterLatitude()).isCloseTo(62.41, within(1e-6));
    assertThat(m.frameCenterLongitude()).isCloseTo(17.35, within(1e-6));
    assertThat(m.hasSensorPosition()).isTrue();
    assertThat(m.hasFrameCenter()).isTrue();
  }

  @Test
  void criterion4_textTimeAndVersion() {
    Metadata m = one(set(u(2, 1_700_000_000_123_456L, 8), text(3, "Mission 7"), text(10, "MQ-9 Reaper"), text(11, "EO Nose"), u(65, 14, 1)));
    assertThat(m.timeMicros()).isEqualTo(1_700_000_000_123_456L);
    assertThat(m.missionId()).isEqualTo("Mission 7");
    assertThat(m.platformDesignation()).isEqualTo("MQ-9 Reaper");
    assertThat(m.imageSourceSensor()).isEqualTo("EO Nose");
    assertThat(m.version()).isEqualTo(14);
    assertThat(m.sensorLatitude()).isNull();
  }

  @Test
  void criterion4_anErrorIndicatorLeavesOutThatValueOnly() {
    List<St0601.Result> r = St0601.read(set(s32(13, 0x80000000), s32(14, 0x10000000), u(16, 0x4000, 2), s32(19, 0x80000000)));
    Metadata m = r.get(0).metadata();
    assertThat(m.sensorLatitude()).as("the reserved error value").isNull();
    assertThat(m.sensorLongitude()).as("the rest of the set is used").isNotNull();
    assertThat(m.horizontalFov()).isNotNull();
    assertThat(m.relativeElevation()).isNull();
    assertThat(r.get(0).outOfRange()).isEqualTo(2);
    assertThat(m.hasSensorPosition()).isFalse();
  }

  @Test
  void criterion4_noFrameCentreIsValidAndNotCounted() {
    List<St0601.Result> r = St0601.read(set(s32(13, 0x10000000), s32(14, 0x10000000), s32(23, 0x80000000), s32(24, 0x80000000), u(16, 0x4000, 2)));
    Metadata m = r.get(0).metadata();
    assertThat(m.hasFrameCenter()).isFalse();
    assertThat(m.hasSensorPosition()).isTrue();
    assertThat(r.get(0).outOfRange()).as("0x80000000 in tags 23 and 24 is a valid \"no frame centre\"").isZero();
  }

  @Test
  void criterion4_aValueOfTheWrongLengthIsLeftOut() {
    List<St0601.Result> r = St0601.read(set(u(16, 7, 1), u(21, 100, 2), u(5, 0x4000, 2)));
    assertThat(r.get(0).metadata().horizontalFov()).isNull();
    assertThat(r.get(0).metadata().slantRange()).isNull();
    assertThat(r.get(0).metadata().heading()).isNotNull();
    assertThat(r.get(0).outOfRange()).isEqualTo(2);
  }

  @Test
  void criterion3_aWrongChecksumDropsTheSet() {
    List<St0601.Result> r = St0601.read(set(false, u(5, 0x4000, 2)));
    assertThat(r).hasSize(1);
    assertThat(r.get(0).metadata()).isNull();
    assertThat(r.get(0).dropped()).isEqualTo("checksum");
  }

  @Test
  void criterion3_aSetWithoutAChecksumIsDropped() {
    List<St0601.Result> r = St0601.read(Klv.setWithoutChecksum(u(5, 0x4000, 2)));
    assertThat(r.get(0).dropped()).isEqualTo("checksum");
  }

  @Test
  void criterion3_unknownTagsAndOtherKeysAreSkipped() {
    byte[] other = cat(new byte[16], new byte[] {3, 1, 2, 3}); // another key
    byte[] mine = set(u(5, 0x4000, 2), item(99, new byte[] {1, 2, 3}), item(200, new byte[] {9}), u(13, 0x10000000, 4));
    List<St0601.Result> r = St0601.read(cat(other, mine));
    assertThat(r).hasSize(1);
    assertThat(r.get(0).metadata().heading()).isNotNull();
    assertThat(r.get(0).metadata().sensorLatitude()).as("the item after a two-byte tag is found").isNotNull();
  }

  @Test
  void criterion3_aLongFormLengthAndSeveralSetsInOnePes() {
    byte[] big = set(text(3, "x".repeat(100)), text(10, "y".repeat(100)), u(5, 0x4000, 2));
    assertThat(big[16] & 0xFF).as("the set's length is in long form").isGreaterThanOrEqualTo(0x80);
    List<St0601.Result> r = St0601.read(cat(big, set(u(5, 0x2000, 2))));
    assertThat(r).hasSize(2);
    assertThat(r.get(0).metadata().missionId()).hasSize(100);
    assertThat(r.get(1).metadata().heading()).isCloseTo(45.0, within(0.01));
  }

  @Test
  void criterion3_aCutOffSetAndEmptyOrShortPayloadsGiveNothing() {
    byte[] s = set(u(5, 0x4000, 2));
    assertThat(St0601.read(java.util.Arrays.copyOf(s, s.length - 3))).isEmpty();
    assertThat(St0601.read(new byte[0])).isEmpty();
    assertThat(St0601.read(new byte[10])).isEmpty();
    byte[] garbage = new byte[40];
    garbage[16] = (byte) 0x85; // a length of 5 bytes: not accepted
    assertThat(St0601.read(garbage)).isEmpty();
  }

  @Test
  void security_theNestedSetGivesTheClassification() {
    byte[] nested = cat(u(1, 4, 1), u(2, 2, 1), text(3, "//SWE"), text(6, "SWE FIN"), u(22, 12, 2));
    Metadata m = one(set(item(48, nested)));
    Metadata.Security s = m.security();
    assertThat(s.classification()).isEqualTo(4);
    assertThat(s.countryMethod()).isEqualTo(2);
    assertThat(s.country()).isEqualTo("//SWE");
    assertThat(s.releasing()).isEqualTo("SWE FIN");
    assertThat(s.version()).isEqualTo(12);
  }

  @Test
  void security_aClassificationOutsideOneToFiveIsLeftOut() {
    List<St0601.Result> r = St0601.read(set(item(48, u(1, 9, 1))));
    assertThat(r.get(0).metadata().security()).isNull();
    assertThat(r.get(0).outOfRange()).isEqualTo(1);
  }
}
