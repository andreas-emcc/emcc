package dev.emcc.plugins.ais.codec;

import static org.assertj.core.api.Assertions.assertThat;

import org.assertj.core.data.Offset;
import org.junit.jupiter.api.Test;

class NmeaTest {

  private static final String TYPE1 = Ais.classA(1, 366_000_001, 0, 100, 18.0723, 59.3311, 2705, 90).sentence();

  @Test
  void aValidSentenceIsRead() {
    Sentence s = Nmea.parse(TYPE1).sentence();
    assertThat(s).isNotNull();
    assertThat(s.count()).isEqualTo(1);
    assertThat(s.number()).isEqualTo(1);
    assertThat(s.channel()).isEqualTo("A");
    assertThat(s.fillBits()).isZero();
    assertThat(s.payload()).hasSize(28);
  }

  @Test
  void theSpecificationsOwnExampleChecksOutAndDecodes() {
    // The example of the gpsd document's type 1 section.
    Sentence s = Nmea.parse("!AIVDM,1,1,,B,177KQJ5000G?tO`K>RA1wUbN0TKH,0*5C").sentence();
    assertThat(s).isNotNull();
    AisMessage.Position m = (AisMessage.Position) AisDecoder.decode(s.payload(), s.fillBits()).message();
    assertThat(m.mmsi()).isEqualTo(477_553_000);
    assertThat(m.lon()).isEqualTo(-122.345832, Offset.offset(1e-5));
    assertThat(m.lat()).isEqualTo(47.582833, Offset.offset(1e-5));
  }

  @Test
  void aChangedPayloadCharacterIsAChecksumError() {
    String changed = TYPE1.replaceFirst(",A,.", ",A,5");
    assertThat(changed).isNotEqualTo(TYPE1);
    assertThat(Nmea.parse(changed).reason()).isEqualTo(Nmea.CHECKSUM);
  }

  @Test
  void aMissingChecksumIsRefused() {
    int star = TYPE1.indexOf('*');
    assertThat(Nmea.parse(TYPE1.substring(0, star)).reason()).isEqualTo(Nmea.NO_CHECKSUM);
    assertThat(Nmea.parse(TYPE1.substring(0, star + 2)).reason()).isEqualTo(Nmea.NO_CHECKSUM);
    assertThat(Nmea.parse(TYPE1.substring(0, star) + "*ZZ").reason()).isEqualTo(Nmea.NO_CHECKSUM);
  }

  @Test
  void aTrailingTagAfterTheChecksumIsMalformed() {
    assertThat(Nmea.parse(TYPE1 + ",1700000000").reason()).isEqualTo(Nmea.MALFORMED);
  }

  @Test
  void theChecksumMayBeInLowerCase() {
    String lower = TYPE1.substring(0, TYPE1.length() - 2) + TYPE1.substring(TYPE1.length() - 2).toLowerCase();
    assertThat(Nmea.parse(lower).sentence()).isNotNull();
  }

  @Test
  void otherTalkersAreReadTheSameWay() {
    Ais.Msg m = Ais.classA(1, 366_000_001, 0, 100, 18.0723, 59.3311, 2705, 90);
    for (String talker : new String[] {"AIVDO", "BSVDM", "ABVDM"}) {
      assertThat(Nmea.parse(m.sentence(talker)).sentence()).as(talker).isNotNull();
    }
  }

  @Test
  void aTagBlockIsSkipped() {
    String tag = "\\s:station,c:1700000000*5E\\";
    assertThat(Nmea.parse(tag + TYPE1).sentence()).isNotNull();
    assertThat(Nmea.parse("\\s:station," + TYPE1).reason()).isEqualTo(Nmea.MALFORMED); // never closed
  }

  @Test
  void otherSentencesAndGarbageAreRefused() {
    assertThat(Nmea.parse("$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47").reason()).isEqualTo(Nmea.MALFORMED);
    assertThat(Nmea.parse("hello").reason()).isEqualTo(Nmea.MALFORMED);
    assertThat(Nmea.parse("").reason()).isEqualTo(Nmea.MALFORMED);
    assertThat(Nmea.parse("!").reason()).isEqualTo(Nmea.NO_CHECKSUM);
  }

  @Test
  void theFieldsAreChecked() {
    String[] bad = {
      "AIVDM,1,1,,A,15M67FC000G?ufbE`FepT@3n00Sa,0,9", // nine fields
      "AIVDM,1,1,,A,15M67FC000G?ufbE`FepT@3n00Sa", // six fields
      "AIVDM,0,1,,A,15M67FC000G?ufbE`FepT@3n00Sa,0", // count 0
      "AIVDM,10,1,,A,15M67FC000G?ufbE`FepT@3n00Sa,0", // count 10
      "AIVDM,2,3,,A,15M67FC000G?ufbE`FepT@3n00Sa,0", // number above count
      "AIVDM,1,1,,A,15M67FC000G?ufbE`FepT@3n00Sa,6", // fill bits 6
      "AIVDM,1,1,,A,15M67FC000G?ufbE`FepT@3n00Sa,x", // fill bits not a digit
      "AIVDM,1,1,,A,,0", // no payload
      "AIVDM,1,1,,A,15M67FC000G?ufbE`FepT@3n00S~,0", // a character outside the six-bit set
      "AIVDM,1,1,,A,15M67FC000G?ufbE`FepT@3n00Sa X,0", // a space in the payload
      "GPGGA,1,1,,A,15M67FC000G?ufbE`FepT@3n00Sa,0", // not VDM or VDO
      "aiVDM,1,1,,A,15M67FC000G?ufbE`FepT@3n00Sa,0", // lower-case talker
      "AIVDM,1,1,,AB,15M67FC000G?ufbE`FepT@3n00Sa,0", // channel of two characters
    };
    for (String body : bad) {
      assertThat(Nmea.parse(Ais.withChecksum(body)).reason()).as(body).isEqualTo(Nmea.MALFORMED);
    }
  }

  @Test
  void theSixBitSetIsAcceptedAtEachEnd() {
    assertThat(Nmea.parse(Ais.withChecksum("AIVDM,1,1,,A,0W`w,0")).sentence()).isNotNull();
  }
}
