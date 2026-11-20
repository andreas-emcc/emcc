package dev.emcc.plugins.ais.codec;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import org.junit.jupiter.api.Test;

class AisDecoderTest {

  private static Decoded decode(Ais.Msg m) {
    return AisDecoder.decode(m.payload(), m.fill());
  }

  private static AisMessage.Position position(Ais.Msg m) {
    Decoded d = decode(m);
    assertThat(d.reason()).isNull();
    return (AisMessage.Position) d.message();
  }

  @Test
  void positionReportsGiveTheLongitudeFirstAndTheLatitudeSecond() {
    for (int type : new int[] {1, 2, 3}) {
      AisMessage.Position p = position(Ais.classA(type, 265_123_456, 5, 100, 18.0723, 59.3311, 2705, 90));
      assertThat(p.mmsi()).isEqualTo(265_123_456);
      assertThat(p.lon()).isCloseTo(18.0723, within(1e-6)); // latitude is not longitude: a swap would show
      assertThat(p.lat()).isCloseTo(59.3311, within(1e-6));
      assertThat(p.course()).isEqualTo(270.5);
      assertThat(p.speedKnots()).isEqualTo(10.0);
      assertThat(p.speedMetresPerSecond()).isCloseTo(5.144, within(0.001));
      assertThat(p.heading()).isEqualTo(90);
      assertThat(p.navStatus()).isEqualTo(5);
      assertThat(p.statics().cls()).isEqualTo(AisClass.A);
    }
  }

  @Test
  void westAndSouthAreNegative() {
    AisMessage.Position p = position(Ais.classA(1, 1, 0, 0, -122.345832, -33.8688, 0, 0));
    assertThat(p.lon()).isCloseTo(-122.345832, within(1e-6));
    assertThat(p.lat()).isCloseTo(-33.8688, within(1e-6));
  }

  @Test
  void classBPositionReportAndTheExtendedOne() {
    AisMessage.Position b = position(Ais.classB(230_111_222, 55, 24.9384, 60.1699, 1800, 511));
    assertThat(b.lon()).isCloseTo(24.9384, within(1e-6));
    assertThat(b.lat()).isCloseTo(60.1699, within(1e-6));
    assertThat(b.course()).isEqualTo(180.0);
    assertThat(b.speedKnots()).isEqualTo(5.5);
    assertThat(b.heading()).isNull();
    assertThat(b.navStatus()).isNull();
    assertThat(b.statics().cls()).isEqualTo(AisClass.B);

    AisMessage.Position e = position(Ais.extendedB(230_111_223, 0, 24.9384, 60.1699, 0, 0, "SAILING YACHT", 37, 6, 4, 2, 1));
    assertThat(e.statics().name()).isEqualTo("SAILING YACHT");
    assertThat(e.statics().shipType()).isEqualTo(37);
    assertThat(e.statics().length()).isEqualTo(10);
    assertThat(e.statics().beam()).isEqualTo(3);
  }

  @Test
  void notAvailableValuesAreAbsent() {
    AisMessage.Position p = position(Ais.classA(1, 1, 15, 1023, 10, 20, 3600, 511));
    assertThat(p.course()).isNull();
    assertThat(p.speedKnots()).isNull();
    assertThat(p.heading()).isNull();
    assertThat(p.navStatus()).isNull();
  }

  @Test
  void valuesOutOfRangeAreLeftOutAndCounted() {
    Decoded d = decode(Ais.classA(1, 1, 0, 100, 10, 20, 3700, 400));
    AisMessage.Position p = (AisMessage.Position) d.message();
    assertThat(p.course()).isNull();
    assertThat(p.heading()).isNull();
    assertThat(p.speedKnots()).isEqualTo(10.0); // the rest of the message is used
    assertThat(p.lon()).isCloseTo(10, within(1e-6));
    assertThat(d.outOfRange()).isEqualTo(2);
  }

  @Test
  void aPositionNotAvailableOrOutOfRangeIsNoPosition() {
    Decoded na = decode(Ais.classARaw(1, 181 * 600_000L, 91 * 600_000L, 0, 0, 0));
    assertThat(na.message()).isNull();
    assertThat(na.reason()).isEqualTo(AisDecoder.NO_POSITION);
    assertThat(na.outOfRange()).isZero();

    Decoded lon = decode(Ais.classARaw(1, 181 * 600_000L, 20 * 600_000L, 0, 0, 0));
    assertThat(lon.reason()).isEqualTo(AisDecoder.NO_POSITION);

    Decoded lat = decode(Ais.classARaw(1, 10 * 600_000L, 91 * 600_000L, 0, 0, 0));
    assertThat(lat.reason()).isEqualTo(AisDecoder.NO_POSITION);

    Decoded far = decode(Ais.classARaw(1, 200 * 600_000L, 95 * 600_000L, 0, 0, 0));
    assertThat(far.reason()).isEqualTo(AisDecoder.NO_POSITION);
    assertThat(far.outOfRange()).isEqualTo(2); // both left out

    Decoded edge = decode(Ais.classARaw(1, 180 * 600_000L, -90 * 600_000L, 0, 0, 0));
    assertThat(edge.message()).isNotNull();
  }

  @Test
  void aVoyageReportGivesTheStaticData() {
    Decoded d = decode(Ais.voyage(366_000_001, 9_074_729, "WDC1234", "TESTSHIP", 71, 100, 20, 10, 12, 85, "STOCKHOLM"));
    AisStatic s = ((AisMessage.StaticReport) d.message()).statics();
    assertThat(s.name()).isEqualTo("TESTSHIP");
    assertThat(s.callSign()).isEqualTo("WDC1234");
    assertThat(s.imo()).isEqualTo(9_074_729);
    assertThat(s.shipType()).isEqualTo(71);
    assertThat(s.length()).isEqualTo(120);
    assertThat(s.beam()).isEqualTo(22);
    assertThat(s.draught()).isEqualTo(8.5);
    assertThat(s.destination()).isEqualTo("STOCKHOLM");
    assertThat(s.cls()).isEqualTo(AisClass.A);
  }

  @Test
  void notAvailableStaticValuesAreAbsent() {
    AisStatic s = ((AisMessage.StaticReport) decode(Ais.voyage(366_000_001, 0, "", "", 0, 0, 0, 0, 0, 0, "")).message()).statics();
    assertThat(s.name()).isNull();
    assertThat(s.callSign()).isNull();
    assertThat(s.imo()).isNull();
    assertThat(s.length()).isNull();
    assertThat(s.beam()).isNull();
    assertThat(s.draught()).isNull();
    assertThat(s.destination()).isNull();
    assertThat(s.shipType()).isZero();
  }

  @Test
  void aShipTypeOutOfRangeIsLeftOut() {
    Decoded d = decode(Ais.voyage(366_000_001, 1, "C", "N", 150, 1, 1, 1, 1, 1, "D"));
    assertThat(((AisMessage.StaticReport) d.message()).statics().shipType()).isNull();
    assertThat(d.outOfRange()).isEqualTo(1);
  }

  @Test
  void aVoyageReportOf420BitsKeepsItsDestinationAndOneBelowDoesNot() {
    Ais.Msg full = Ais.voyage(366_000_001, 1, "C", "N", 70, 1, 1, 1, 1, 1, "HELSINKI");
    String payload = full.payload();
    // 420 bits: 70 characters; the last character of the destination is cut off
    AisStatic s420 = ((AisMessage.StaticReport) AisDecoder.decode(payload.substring(0, 70), 0).message()).statics();
    assertThat(s420.destination()).isEqualTo("HELSINKI");
    // 419 bits or fewer than the destination's start: no destination, the rest is read
    AisStatic s400 = ((AisMessage.StaticReport) AisDecoder.decode(payload.substring(0, 67), 0).message()).statics();
    assertThat(s400.destination()).isNull();
    assertThat(s400.name()).isEqualTo("N");
    // 301 bits: too short for the draught
    assertThat(AisDecoder.decode(payload.substring(0, 50), 0).reason()).isEqualTo(AisDecoder.TOO_SHORT);
  }

  @Test
  void staticDataReportPartsAAndB() {
    AisStatic a = ((AisMessage.StaticReport) decode(Ais.partA(230_111_222, "SEA BREEZE")).message()).statics();
    assertThat(a.name()).isEqualTo("SEA BREEZE");
    assertThat(a.cls()).isEqualTo(AisClass.B);
    AisStatic b = ((AisMessage.StaticReport) decode(Ais.partB(230_111_222, 36, "OH1234", 8, 4, 2, 2)).message()).statics();
    assertThat(b.shipType()).isEqualTo(36);
    assertThat(b.callSign()).isEqualTo("OH1234");
    assertThat(b.length()).isEqualTo(12);
    assertThat(b.beam()).isEqualTo(4);
    assertThat(b.name()).isNull();
  }

  @Test
  void anAuxiliaryCraftsPartBHasNoSize() {
    AisStatic b = ((AisMessage.StaticReport) decode(Ais.partB(982_345_678, 36, "OH1234", 8, 4, 2, 2)).message()).statics();
    assertThat(b.length()).isNull();
    assertThat(b.beam()).isNull();
    assertThat(b.callSign()).isEqualTo("OH1234");
  }

  @Test
  void otherTypesAreIgnoredByType() {
    for (int type : new int[] {4, 8, 21, 27, 0, 63}) {
      Decoded d = decode(Ais.other(type, 1, 168));
      assertThat(d.message()).isNull();
      assertThat(d.reason()).isEqualTo("ignored: type " + type);
    }
    assertThat(decode(new Ais.Msg().uint(24, 6).uint(0, 2).uint(1, 30).uint(2, 2).uint(0, 130)).reason()).isEqualTo("ignored: type 24");
  }

  @Test
  void shortMessagesAreRefusedWhereTheyLackFieldsWeUse() {
    assertThat(AisDecoder.decode("", 0).reason()).isEqualTo(AisDecoder.TOO_SHORT);
    assertThat(AisDecoder.decode("1", 0).reason()).isEqualTo(AisDecoder.TOO_SHORT);
    String t1 = Ais.classA(1, 1, 0, 0, 1, 1, 0, 0).payload();
    assertThat(AisDecoder.decode(t1.substring(0, 22), 0).reason()).isEqualTo(AisDecoder.TOO_SHORT); // 132 bits
    assertThat(AisDecoder.decode(t1.substring(0, 23), 0).message()).isNotNull(); // 138 bits
    assertThat(AisDecoder.decode(t1.substring(0, 5), 0).reason()).isEqualTo(AisDecoder.TOO_SHORT);
    assertThat(AisDecoder.decode(Ais.partA(1, "X").payload().substring(0, 20), 0).reason()).isEqualTo(AisDecoder.TOO_SHORT);
    assertThat(AisDecoder.decode(Ais.extendedB(1, 0, 1, 1, 0, 0, "X", 0, 0, 0, 0, 0).payload().substring(0, 40), 0).reason()).isEqualTo(AisDecoder.TOO_SHORT);
    assertThat(AisDecoder.decode("177KQJ5000G?tO`K>RA1wUbN0TKH", 6 * 28 + 1).reason()).isEqualTo(AisDecoder.TOO_SHORT); // fill beyond the payload
  }

  @Test
  void anMmsiOfZeroOrTenDigitsIsMalformed() {
    assertThat(decode(Ais.classA(1, 0, 0, 0, 1, 1, 0, 0)).reason()).isEqualTo(AisDecoder.MALFORMED);
    assertThat(decode(Ais.classA(1, 1_000_000_000L, 0, 0, 1, 1, 0, 0)).reason()).isEqualTo(AisDecoder.MALFORMED);
    assertThat(decode(Ais.classA(1, 999_999_999L, 0, 0, 1, 1, 0, 0)).message()).isNotNull();
  }

  @Test
  void textStopsAtTheTrailingAtsAndSpaces() {
    AisStatic s = ((AisMessage.StaticReport) decode(Ais.partA(1, "MS ODIN   ")).message()).statics();
    assertThat(s.name()).isEqualTo("MS ODIN");
    assertThat(((AisMessage.StaticReport) decode(Ais.partA(1, "@@@@")).message()).statics().name()).isNull();
  }
}
