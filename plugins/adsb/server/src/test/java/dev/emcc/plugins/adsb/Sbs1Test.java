package dev.emcc.plugins.adsb;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.adsb.Sbs1.Result;
import org.junit.jupiter.api.Test;

/** The SBS-1 parser: the brief's acceptance criteria 1, 4, 6 and 9, on lines written in the format. */
public class Sbs1Test {

  /** A line of {@code type} with the given values in the fields the brief uses; the others are as dump1090 leaves them. */
  public static String msg(int type, String hex, String callsign, String altitude, String speed, String track,
      String latitude, String longitude, String verticalRate, String squawk, String emergency, String onGround) {
    return String.join(",", "MSG", String.valueOf(type), "1", "1", hex, "1", "2026/10/28", "11:00:00.000",
        "2026/10/28", "11:00:00.000", callsign, altitude, speed, track, latitude, longitude, verticalRate,
        squawk, "0", emergency, "0", onGround);
  }

  public static String position(String latitude, String longitude) {
    return msg(3, "4CA2D6", "", "35000", "", "", latitude, longitude, "", "", "0", "0");
  }

  static Sbs1.Message parsed(String line) {
    assertThat(Sbs1.parse(line)).isInstanceOf(Result.Parsed.class);
    return ((Result.Parsed) Sbs1.parse(line)).message();
  }

  static String refusal(String line) {
    assertThat(Sbs1.parse(line)).isInstanceOf(Result.Refused.class);
    return ((Result.Refused) Sbs1.parse(line)).reason();
  }

  @Test
  void criterion1_aValidPositionLineGivesOneRecord() {
    Sbs1.Message m = parsed(position("55.6181", "12.6561"));
    assertThat(m.type()).isEqualTo(3);
    assertThat(m.icao24()).isEqualTo("4CA2D6");
    assertThat(m.altitudeFt()).isEqualTo(35_000);
    assertThat(m.latitude()).isEqualTo(55.6181);
    assertThat(m.longitude()).isEqualTo(12.6561);
    assertThat(m.onGround()).isFalse();
    assertThat(m.noPosition()).isFalse();
  }

  @Test
  void criterion1_aLineWithTooFewOrTooManyFieldsIsMalformed() {
    String line = position("55.6181", "12.6561");
    assertThat(refusal(line.substring(0, line.lastIndexOf(',')))).isEqualTo("malformed");
    assertThat(refusal(line + ",extra")).isEqualTo("malformed");
  }

  @Test
  void criterion1_aTildeAddressIsNotIcao() {
    assertThat(refusal(position("55.6181", "12.6561").replace("4CA2D6", "~4CA2D6"))).isEqualTo("not icao");
  }

  @Test
  void criterion1_aLatitudeOf95DropsThePositionOnlyAndTheRestOfTheLineApplies() {
    Sbs1.Message m = parsed(msg(3, "4CA2D6", "", "35000", "", "", "95", "12.6561", "", "", "0", "0"));
    assertThat(m.latitude()).isNull();
    assertThat(m.longitude()).isNull();
    assertThat(m.noPosition()).as("an out-of-range latitude also counts no position (brief criterion 2)").isTrue();
    assertThat(m.altitudeFt()).isEqualTo(35_000);
    assertThat(m.outOfRange()).isEqualTo(1);
  }

  @Test
  void criterion1_aNumberThatDoesNotParseIsMalformed() {
    assertThat(refusal(msg(3, "4CA2D6", "", "high", "", "", "55.6181", "12.6561", "", "", "0", "0"))).isEqualTo("malformed");
  }

  @Test
  void criterion2_anEmptyLatitudeGivesNoPosition() {
    Sbs1.Message m = parsed(position("", "12.6561"));
    assertThat(m.noPosition()).isTrue();
    assertThat(m.latitude()).isNull();
    assertThat(m.longitude()).isNull();
  }

  @Test
  void criterion4_velocityAndTrackAreRead() {
    Sbs1.Message m = parsed(msg(4, "4CA2D6", "", "", "450", "270", "", "", "-640", "", "", ""));
    assertThat(m.groundSpeedKt()).isEqualTo(450.0);
    assertThat(m.trackDegrees()).isEqualTo(270.0);
    assertThat(m.verticalRateFpm()).isEqualTo(-640);
  }

  @Test
  void criterion4_aTrackOutOfRangeDropsTheTrackOnly() {
    Sbs1.Message m = parsed(msg(4, "4CA2D6", "", "", "450", "361", "", "", "-640", "", "", ""));
    assertThat(m.trackDegrees()).isNull();
    assertThat(m.groundSpeedKt()).isEqualTo(450.0);
    assertThat(m.outOfRange()).isEqualTo(1);
  }

  @Test
  void criterion6_squawkAndEmergencyAreRead() {
    Sbs1.Message set = parsed(msg(6, "4CA2D6", "", "35000", "", "", "", "", "", "7700", "-1", "0"));
    assertThat(set.squawk()).isEqualTo("7700");
    assertThat(set.emergency()).isTrue();
    assertThat(parsed(msg(6, "4CA2D6", "", "", "", "", "", "", "", "7700", "0", "")).emergency()).isFalse();
    assertThat(parsed(msg(6, "4CA2D6", "", "", "", "", "", "", "", "7700", "", "")).emergency()).isNull();
  }

  @Test
  void criterion6_aSquawkDigitAbove7DropsTheSquawkOnly() {
    Sbs1.Message m = parsed(msg(6, "4CA2D6", "", "35000", "", "", "", "", "", "7800", "-1", "0"));
    assertThat(m.squawk()).isNull();
    assertThat(m.emergency()).isTrue();
    assertThat(m.outOfRange()).isEqualTo(1);
  }

  @Test
  void criterion1_aLineOfAnotherTypeIgnoresFieldsItDoesNotUse() {
    // A callsign in a type 3 line is not used: only a type 1 line gives one.
    Sbs1.Message m = parsed(msg(3, "4CA2D6", "SAS1234", "", "", "", "55.6181", "12.6561", "", "", "", ""));
    assertThat(m.callsign()).isNull();
  }

  @Test
  void criterion9_theIgnoredKindsAreCountedByKind() {
    assertThat(Sbs1.parse(msg(7, "4CA2D6", "", "", "", "", "", "", "", "", "", ""))).isEqualTo(new Result.Ignored("MSG,7"));
    assertThat(Sbs1.parse(msg(8, "4CA2D6", "", "", "", "", "", "", "", "", "", ""))).isEqualTo(new Result.Ignored("MSG,8"));
    for (String kind : new String[] {"SEL", "ID", "AIR", "STA", "CLK"}) {
      assertThat(Sbs1.parse(kind + ",1,1,1,4CA2D6,1,2026/10/28,11:00:00.000")).isEqualTo(new Result.Ignored(kind));
    }
  }

  @Test
  void criterion1_aCallsignIsTrimmed() {
    Sbs1.Message m = parsed(msg(1, "4ca2d6", "SAS1234 ", "", "", "", "", "", "", "", "", ""));
    assertThat(m.callsign()).isEqualTo("SAS1234");
    assertThat(m.icao24()).as("upper case, also from lower case").isEqualTo("4CA2D6");
  }

  @Test
  void aLineNeverThrows() {
    assertThat(Sbs1.parse("")).isInstanceOf(Result.Refused.class);
    assertThat(Sbs1.parse(",,,")).isInstanceOf(Result.Refused.class);
    assertThat(Sbs1.parse("MSG,x")).isInstanceOf(Result.Refused.class);
  }
}
