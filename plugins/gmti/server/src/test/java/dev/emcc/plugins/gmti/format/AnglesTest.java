package dev.emcc.plugins.gmti.format;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import org.junit.jupiter.api.Test;

/**
 * Criterion 1, the encodings: the reference's test checklist (6.2) and the standard's own examples
 * (AEDP Annex C-4.6, C-4.7). Every position has latitude ≠ longitude (ADR-0007).
 */
class AnglesTest {

  @Test
  void criterion1_stockholmEncodesAndDecodes() {
    assertThat(Angles.toSa32(59.3293)).isEqualTo(0x54612390);
    assertThat(Angles.toBa32(18.0686)).isEqualTo(0x0CD949CBL);
    assertThat(Angles.fromSa32(0x54612390)).isCloseTo(59.3293, within(1e-6));
    assertThat(Angles.longitude(Angles.fromBa32(0x0CD949CBL))).isCloseTo(18.0686, within(1e-6));
  }

  @Test
  void criterion1_capeTownSouthernLatitudeIsTwosComplement() {
    assertThat(Angles.toSa32(-33.9249)).isEqualTo(0xCFC05223);
    assertThat(Angles.toBa32(18.4241)).isEqualTo(0x0D1A014BL);
    assertThat(Angles.fromSa32(0xCFC05223)).isCloseTo(-33.9249, within(1e-6));
    assertThat(Angles.longitude(Angles.fromBa32(0x0D1A014BL))).isCloseTo(18.4241, within(1e-6));
  }

  @Test
  void criterion1_rioDeJaneiroWesternLongitudeWrapsTo360AndBack() {
    assertThat(Angles.toSa32(-22.9068)).isEqualTo(0xDF6BE37E);
    assertThat(Angles.toBa32(-43.1729)).as("emc2's −43.1729 is 316.8271 east").isEqualTo(0xE14C9D08L);
    assertThat(Angles.toBa32(316.8271)).isEqualTo(0xE14C9D08L);
    assertThat(Angles.fromBa32(0xE14C9D08L)).isCloseTo(316.8271, within(1e-6));
    assertThat(Angles.longitude(Angles.fromBa32(0xE14C9D08L))).isCloseTo(-43.1729, within(1e-6));
  }

  @Test
  void criterion1_theStandardsOwnExamples() {
    assertThat(Angles.fromBa16(0x591C)).isCloseTo(125.31006, within(1e-5));
    assertThat(Angles.toSa16(-34.876099) & 0xFFFF).isEqualTo(0xCE66);
    assertThat(Angles.fromSa16((short) 0xCE66)).isCloseTo(-34.876099, within(0.003));
  }

  @Test
  void criterion1_b16IsSignAndMagnitude() {
    assertThat(Angles.toB16(12.5)).isEqualTo(0x0640);
    assertThat(Angles.toB16(-3.25)).as("pitfall 8: not 0xFE60").isEqualTo(0x81A0);
    assertThat(Angles.fromB16(0x0640)).isEqualTo(12.5);
    assertThat(Angles.fromB16(0x81A0)).isEqualTo(-3.25);
    assertThat(Angles.toB16(1000)).as("the largest magnitude").isEqualTo(0x7FFF);
    assertThat(Angles.fromB16(0x7FFF)).isEqualTo(256 - 1 / 128.0);
  }

  @Test
  void criterion1_aDwellAngleHalfExtent() {
    assertThat(Angles.toBa16(7.5)).isEqualTo(0x0555);
    assertThat(Angles.fromBa16(0x0555)).isCloseTo(7.5, within(0.006));
  }

  @Test
  void binaryAnglesNear360WrapToZero() {
    assertThat(Angles.toBa32(359.99999999999)).as("pitfall 22").isZero();
    assertThat(Angles.toBa16(360.0)).isZero();
    assertThat(Angles.toBa32(-0.0)).isZero();
  }

  @Test
  void signedAnglesAreLimitedToTheirRange() {
    assertThat(Angles.toSa32(90.0)).isEqualTo(Integer.MAX_VALUE);
    assertThat(Angles.toSa32(-90.0)).isEqualTo(Integer.MIN_VALUE);
    assertThat(Angles.fromSa32(Integer.MIN_VALUE)).isEqualTo(-90.0);
  }

  @Test
  void longitudesBecomeMinus180To180() {
    assertThat(Angles.longitude(258.97)).isCloseTo(-101.03, within(1e-9));
    assertThat(Angles.longitude(180.0)).isEqualTo(180.0);
    assertThat(Angles.longitude(-10.0)).isEqualTo(-10.0);
    assertThat(Angles.longitude(370.0)).isCloseTo(10.0, within(1e-9));
  }
}
