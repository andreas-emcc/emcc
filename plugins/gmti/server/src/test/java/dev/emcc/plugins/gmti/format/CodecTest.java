package dev.emcc.plugins.gmti.format;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.sdk.model.Position;
import java.nio.ByteBuffer;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * The decoder and encoder (criteria 2 and 8; the reference's 6.2 "Parsing"). Packets are written for
 * the test with the encoder; no recorded frame is in the repository.
 */
class CodecTest {

  static final PacketHeader HEADER = new PacketHeader("41", "XN", 5, "XN", 0, 129, "SENSOR1", 7, 3);

  /** A dwell at Stockholm looking 30 km east, mandatory fields only. */
  static Dwell.Builder dwell() {
    return Dwell.of(4, 0, 45_296_789, 59.3293, 18.0686, 8_500.25, 59.3290, 18.5960, 12.5, 7.5);
  }

  static byte[] bytes(Segment... segments) {
    return Encoder.packet(HEADER, List.of(segments));
  }

  static Packet decode(byte[] bytes) {
    Decoded d = Decoder.decode(bytes);
    assertThat(d.reason()).as("refused: %s", d.detail()).isNull();
    return d.packet();
  }

  /** Where mask byte {@code k} (7 is sent first, AEDP Figure 3-1) is in a packet whose first segment is the dwell. */
  static int maskByte(int k) {
    return 32 + 5 + (7 - k);
  }

  private static String hex(byte[] b, int from, int n) {
    return HexFormat.of().withUpperCase().formatHex(b, from, from + n);
  }

  @Test
  void criterion2_aMandatoryOnlyDwellIs80Bytes() {
    byte[] b = bytes(dwell().build());
    assertThat(b).hasSize(80);
    assertThat(Decoder.packetSize(b, 0)).isEqualTo(80);
    assertThat(b[32]).as("S1").isEqualTo((byte) 2);
    assertThat(ByteBuffer.wrap(b, 33, 4).getInt()).as("S2").isEqualTo(48);
    assertThat(hex(b, 37, 8)).as("the mask").isEqualTo("FF0003C000000000");

    Dwell d = (Dwell) decode(b).segments().getFirst();
    assertThat(d.reports()).isEmpty();
    assertThat(d.revisitIndex()).isEqualTo(4);
    assertThat(d.time()).isEqualTo(45_296_789);
    assertThat(d.sensorLatitude()).isCloseTo(59.3293, within(1e-6));
    assertThat(d.sensorLongitude()).isCloseTo(18.0686, within(1e-6));
    assertThat(d.sensorAltitude()).as("centimetres in the bytes").isEqualTo(8_500.25);
    assertThat(d.rangeHalfExtent()).isEqualTo(12.5);
    assertThat(d.angleHalfExtent()).isCloseTo(7.5, within(0.006));
    assertThat(d.sensorTrack()).isNull();
  }

  @Test
  void criterion2_threeHighResolutionReportsWithTheirIndex() {
    Dwell built = dwell()
        .report(TargetReport.at(59.30, 18.55).index(0).build())
        .report(TargetReport.at(-33.9249, 18.4241).index(1).build())
        .report(TargetReport.at(-22.9068, -43.1729).index(2).build())
        .build();
    byte[] b = bytes(built);
    assertThat(b).as("10 bytes a report").hasSize(80 + 30);
    assertThat(hex(b, 37, 8)).isEqualTo("FF0003C380000000");

    Dwell d = (Dwell) decode(b).segments().getFirst();
    assertThat(d.reports()).hasSize(3);
    TargetReport rio = d.reports().get(2);
    assertThat(rio.index()).isEqualTo(2);
    assertThat(rio.latitude()).isCloseTo(-22.9068, within(1e-6));
    assertThat(rio.longitude()).isCloseTo(-43.1729, within(1e-6));
    assertThat(rio.reduced()).isFalse();
    assertThat(rio.classification()).isNull();
  }

  @Test
  void criterion2_reportBitsMeanNothingWhenThereAreNoReports() {
    byte[] b = bytes(dwell().build());
    b[maskByte(4)] = (byte) 0xC3; // D26, D27 and D32.1, D32.2 set
    b[maskByte(3)] = (byte) 0xFF; // D32.3 to D32.10 set
    Dwell d = (Dwell) decode(b).segments().getFirst();
    assertThat(d.reports()).isEmpty();
  }

  @Test
  void criterion2_reportErrorsWithoutTheDwellsPositionErrors_simulatorSetAsMask() {
    // Simulator set A: report errors D32.12–15 without D12–D14 (reference 5.3); the mask rules, not the conditions.
    TargetReport r = TargetReport.at(37.45, -101.03).index(0).height(950).radialVelocity(-3.25).wrapVelocity(20.0)
        .slantRangeError(12.34).crossRangeError(45.6).heightError(7).radialVelocityError(0.5).truthTag(3, 4_000_000_000L).build();
    Dwell built = dwell().sensorMotion(271.5, 120.5, -1.2).platformAttitude(270.0, -1.5, 2.25).report(r).build();
    byte[] b = bytes(built);
    assertThat(hex(b, 37, 6)).isEqualTo("FF071FC39C7E");

    TargetReport back = ((Dwell) decode(b).segments().getFirst()).reports().getFirst();
    assertThat(back.longitude()).isCloseTo(-101.03, within(1e-6));
    assertThat(back.height()).isEqualTo(950);
    assertThat(back.radialVelocity()).isEqualTo(-3.25);
    assertThat(back.wrapVelocity()).isEqualTo(20.0);
    assertThat(back.slantRangeError()).isEqualTo(12.34);
    assertThat(back.crossRangeError()).isEqualTo(45.6);
    assertThat(back.heightError()).isEqualTo(7);
    assertThat(back.radialVelocityError()).isEqualTo(0.5);
    assertThat(back.truthApplication()).isEqualTo(3);
    assertThat(back.truthEntity()).as("unsigned").isEqualTo(4_000_000_000L);
  }

  @Test
  void criterion2_theVistaAndAfsersMasks() {
    // VISTA: FF 07 1F FD 93 87 (reference 5.3, the ESA's sheet).
    TargetReport vista = TargetReport.at(55.1, 19.7).height(10).snr(-3).classification(138).classificationProbability(80)
        .truthTag(1, 2L).rcs(-4.5).build();
    Dwell v = dwell().sensorMotion(90.0, 200.0, 0.0).platformAttitude(90.0, 0.0, 0.0).sensorOrientation(270.0, -2.0, 0.0)
        .minimumDetectableVelocity(1.5).report(vista).build();
    byte[] vb = bytes(v);
    assertThat(hex(vb, 37, 6)).isEqualTo("FF071FFD9387");
    TargetReport vr = ((Dwell) decode(vb).segments().getFirst()).reports().getFirst();
    assertThat(vr.snr()).isEqualTo(-3);
    assertThat(vr.classification()).isEqualTo(138);
    assertThat(vr.rcs()).isEqualTo(-4.5);
    assertThat(vr.index()).isNull();

    // AFSERS with reports: FF 3F 1F FF 9F 7F.
    TargetReport afsers = TargetReport.at(33.2, -71.5).index(5).height(80).radialVelocity(4.0).wrapVelocity(30.0).snr(12)
        .classification(129).slantRangeError(10.0).crossRangeError(20.0).heightError(5).radialVelocityError(0.3).truthTag(9, 99L)
        .rcs(10.0).build();
    Dwell a = dwell().sensorPositionError(1.0, 2.0, 3.0).sensorMotion(10.0, 220.0, 0.0).platformAttitude(10.0, 1.0, -1.0)
        .sensorOrientation(90.0, -5.0, 0.0).minimumDetectableVelocity(2.0).report(afsers).build();
    assertThat(hex(bytes(a), 37, 6)).isEqualTo("FF3F1FFF9F7F");
  }

  @ParameterizedTest
  @ValueSource(strings = {"21", "30", "41", "20"})
  void criterion2_everyVersionParsesByTheMaskAlone(String version) {
    var header = new PacketHeader(version, "US", 5, "US", 0, 1, "GROUND MTI", 1, 4607);
    Packet p = decode(Encoder.packet(header, List.of(dwell().report(TargetReport.at(31.4, -66.5).build()).build())));
    assertThat(p.header().version()).isEqualTo(version);
    assertThat(((Dwell) p.segments().getFirst()).reports()).hasSize(1);
  }

  @Test
  void theHeaderRoundTrips() {
    var header = new PacketHeader("30", "US", 2, "XN", 0x0101, 128, "PLATFORM10", 4_000_000_001L, 4_000_000_002L);
    Packet p = decode(Encoder.packet(header, List.of()));
    assertThat(p.header()).isEqualTo(header);
    assertThat(p.size()).isEqualTo(32);
    assertThat(p.segments()).isEmpty();
  }

  @Test
  void aMultiSegmentPacketKeepsItsOrder() {
    Mission mission = Mission.on(LocalDate.of(2026, 1, 12), 255, "EXERCISE", "emcc 0.1");
    JobDefinition job = job(3, 1);
    Packet p = decode(bytes(mission, job, dwell().build()));
    assertThat(p.segments()).extracting(Segment::type).containsExactly(1, 5, 2);
    assertThat(p.segments().get(0)).isEqualTo(mission);
    assertThat(((Mission) p.segments().get(0)).referenceDay()).isEqualTo(LocalDate.of(2026, 1, 12));
    JobDefinition back = (JobDefinition) p.segments().get(1);
    assertThat(back.jobId()).isEqualTo(3);
    assertThat(back.boundingArea().get(1).longitude()).isCloseTo(-0.5, within(1e-6));
    assertThat(back.boundingArea().get(1).latitude()).isCloseTo(51.5, within(1e-6));
    assertThat(back.crossRangeError()).isEqualTo(JobDefinition.NO_CROSS_RANGE_ERROR);
    assertThat(back).usingRecursiveComparison().ignoringFields("boundingArea").isEqualTo(job);
  }

  @Test
  void aPlatformLocationRoundTrips() {
    var l = new PlatformLocation(117_935_200, -33.9249, 18.4241, 10_668.0, 271.5, 222.222, -0.5);
    PlatformLocation back = (PlatformLocation) decode(bytes(l)).segments().getFirst();
    assertThat(back.time()).isEqualTo(117_935_200);
    assertThat(back.latitude()).isCloseTo(-33.9249, within(1e-6));
    assertThat(back.longitude()).isCloseTo(18.4241, within(1e-6));
    assertThat(back.altitude()).isEqualTo(10_668.0);
    assertThat(back.track()).isCloseTo(271.5, within(0.006));
    assertThat(back.speed()).isEqualTo(222.222);
    assertThat(back.verticalVelocity()).isEqualTo(-0.5);
  }

  @Test
  void criterion8_anUnknownSegmentIsSkippedAndTheNextParsed() {
    Packet p = decode(bytes(new Skipped(128, 5 + 20), dwell().build(), new Skipped(12, 5 + 23 + 4)));
    assertThat(p.segments()).hasSize(3);
    assertThat(p.segments().get(0)).isEqualTo(new Skipped(128, 25));
    assertThat(p.segments().get(1)).isInstanceOf(Dwell.class);
    assertThat(p.segments().get(2)).isEqualTo(new Skipped(12, 32));
  }

  @Test
  void aFreeTextIsKeptCut() {
    String text = "x".repeat(400);
    FreeText f = (FreeText) decode(bytes(new FreeText("OPS", "ALL", text))).segments().getFirst();
    assertThat(f.originator()).isEqualTo("OPS");
    assertThat(f.text()).hasSize(FreeText.MAX_KEPT);
  }

  @Test
  void criterion8_aSegmentPastThePacketsEndIsMalformed() {
    byte[] b = bytes(dwell().build());
    ByteBuffer.wrap(b).putInt(33, 49); // S2 one byte too many
    assertThat(Decoder.decode(b).reason()).isEqualTo(Decoded.MALFORMED);
  }

  @Test
  void aPacketSizeThatDoesNotMatchIsMalformed() {
    byte[] b = bytes(dwell().build());
    ByteBuffer.wrap(b).putInt(2, 81);
    assertThat(Decoder.decode(b).reason()).isEqualTo(Decoded.MALFORMED);
    assertThat(Decoder.decode(new byte[31]).reason()).isEqualTo(Decoded.MALFORMED);
  }

  @Test
  void aDwellInAJobZeroPacketIsMalformed() {
    var header = new PacketHeader("41", "XN", 5, "XN", 0, 0, "P", 1, 0);
    assertThat(Decoder.decode(Encoder.packet(header, List.of(dwell().build()))).reason()).isEqualTo(Decoded.MALFORMED);
    assertThat(Decoder.decode(Encoder.packet(header, List.of(Mission.on(LocalDate.of(2026, 1, 1), 0, "", "")))).reason()).isNull();
  }

  @Test
  void aMaskWithoutItsMandatoryFieldsOrWithoutAPositionFormIsMalformed() {
    byte[] b = bytes(dwell().build());
    b[maskByte(5)] = 0x01; // D24 gone
    assertThat(Decoder.decode(b).reason()).isEqualTo(Decoded.MALFORMED);

    byte[] r = bytes(dwell().report(TargetReport.at(59.3, 18.6).build()).build());
    assertThat(r[maskByte(4)]).isEqualTo((byte) 0xC1);
    r[maskByte(4)] = (byte) 0xC0; // D32.2 gone, D32.3 left
    assertThat(Decoder.decode(r).reason()).isEqualTo(Decoded.MALFORMED);
  }

  @Test
  void aDwellWhoseMaskDoesNotFillItsSegmentIsMalformed() {
    byte[] b = bytes(dwell().report(TargetReport.at(59.3, 18.6).build()).build());
    assertThat(b[maskByte(3)]).isEqualTo((byte) 0x80);
    b[maskByte(3)] = (byte) 0x81; // D32.10 claimed: one byte more than the segment holds
    assertThat(Decoder.decode(b).reason()).isEqualTo(Decoded.MALFORMED);

    byte[] fewer = bytes(dwell().report(TargetReport.at(59.3, 18.6).classification(4).build()).build());
    fewer[maskByte(3)] = (byte) 0x80; // D32.10 not claimed: one byte left over
    assertThat(Decoder.decode(fewer).reason()).isEqualTo(Decoded.MALFORMED);
  }

  @Test
  void aShortFixedSegmentIsMalformed() {
    byte[] b = bytes(Mission.on(LocalDate.of(2026, 11, 6), 0, "", ""));
    byte[] cut = new byte[b.length - 1];
    System.arraycopy(b, 0, cut, 0, cut.length);
    ByteBuffer.wrap(cut).putInt(2, cut.length).putInt(33, 5 + 38);
    assertThat(Decoder.decode(cut).reason()).isEqualTo(Decoded.MALFORMED);
  }

  @Test
  void aPacketOver65535BytesIsTooLong() {
    assertThat(Decoder.decode(new byte[65_536]).reason()).isEqualTo(Decoded.TOO_LONG);
  }

  @Test
  void reducedPositionsAcrossThePrimeMeridian() {
    // A dwell centred west of the prime meridian, a target east of it (reference 6.2).
    double scale = 1e-4;
    Dwell built = Dwell.of(0, 0, 0, 51.0, -1.5, 8_000, 51.48, -0.02, 5, 10).scales(scale, scale)
        .report(TargetReport.at(51.4821, 0.0123).index(0).reduced(true).build())
        .report(TargetReport.at(51.4700, -0.0400).index(1).reduced(true).build())
        .build();
    byte[] b = bytes(built);
    Dwell d = (Dwell) decode(b).segments().getFirst();
    assertThat(d.latitudeScale()).isCloseTo(scale, within(1e-7));
    TargetReport east = d.reports().get(0);
    assertThat(east.reduced()).isTrue();
    assertThat(east.latitude()).isCloseTo(51.4821, within(scale));
    assertThat(east.longitude()).isCloseTo(0.0123, within(scale));
    assertThat(d.reports().get(1).longitude()).isCloseTo(-0.0400, within(scale));

    // The same points at full precision agree.
    Dwell full = Dwell.of(0, 0, 0, 51.0, -1.5, 8_000, 51.48, -0.02, 5, 10)
        .report(TargetReport.at(51.4821, 0.0123).build()).build();
    TargetReport hi = ((Dwell) decode(bytes(full)).segments().getFirst()).reports().getFirst();
    assertThat(east.latitude()).isCloseTo(hi.latitude(), within(scale));
    assertThat(east.longitude()).isCloseTo(hi.longitude(), within(scale));
  }

  @Test
  void aReducedPositionOffTheEarthIsLeftOutAndCounted() {
    Dwell built = Dwell.of(0, 0, 0, 89.0, 10, 8_000, 89.9, 10, 5, 10).scales(0.01, 0.01)
        .report(TargetReport.at(89.95, 10.0).reduced(true).build())
        .report(TargetReport.at(89.0, 10.0).reduced(true).build())
        .build();
    byte[] b = bytes(built);
    // Turn the first report's delta latitude into +100 steps: 89.9 + 1.0 = 90.9, off the earth.
    int firstReport = 32 + 5 + 8 + 23 + 8 + 12;
    ByteBuffer.wrap(b).putShort(firstReport, (short) 100);
    Packet p = decode(b);
    assertThat(((Dwell) p.segments().getFirst()).reports()).hasSize(1);
    assertThat(p.valuesOutOfRange()).isEqualTo(1);
  }

  @Test
  void everyFieldRoundTrips() {
    TargetReport r = TargetReport.at(-22.9068, -43.1729).index(65_535).height(-12).radialVelocity(-327.67).wrapVelocity(655.35).snr(-128)
        .classification(255).classificationProbability(100).slantRangeError(655.35).crossRangeError(6_553.5).heightError(255)
        .radialVelocityError(0.01).truthTag(255, 0xFFFF_FFFFL).rcs(63.5).build();
    Dwell built = Dwell.of(65_535, 65_535, 4_294_967_295L, -33.9249, 18.4241, -100.5, -34.0, 18.5, 255.0, 359.9)
        .lastDwell(false).sensorPositionError(1.0, 2.0, 3.0).sensorMotion(359.0, 300.5, 12.7).sensorMotionError(255, 65.535, 655.35)
        .platformAttitude(1.0, -45.0, 45.0).sensorOrientation(2.0, -3.0, 4.0).minimumDetectableVelocity(25.5).report(r).build();
    Dwell d = (Dwell) decode(bytes(built)).segments().getFirst();
    assertThat(d.lastDwell()).isFalse();
    assertThat(d.time()).isEqualTo(4_294_967_295L);
    assertThat(d.sensorAltitude()).isEqualTo(-100.5);
    assertThat(d.alongTrackError()).isEqualTo(1.0);
    assertThat(d.altitudeError()).isEqualTo(3.0);
    assertThat(d.sensorSpeed()).isEqualTo(300.5);
    assertThat(d.sensorVerticalVelocity()).isEqualTo(12.7);
    assertThat(d.trackError()).isEqualTo(255);
    assertThat(d.speedError()).isEqualTo(65.535);
    assertThat(d.verticalVelocityError()).isEqualTo(655.35);
    assertThat(d.platformPitch()).isCloseTo(-45.0, within(0.003));
    assertThat(d.sensorRoll()).isCloseTo(4.0, within(0.003));
    assertThat(d.minimumDetectableVelocity()).isEqualTo(25.5);
    assertThat(d.rangeHalfExtent()).isCloseTo(255.0, within(1 / 128.0));
    assertThat(d.reports().getFirst()).isEqualTo(
        TargetReport.at(d.reports().getFirst().latitude(), d.reports().getFirst().longitude()).index(65_535).height(-12)
            .radialVelocity(-327.67).wrapVelocity(655.35).snr(-128).classification(255).classificationProbability(100)
            .slantRangeError(655.35).crossRangeError(6_553.5).heightError(255).radialVelocityError(0.01).truthTag(255, 0xFFFF_FFFFL)
            .rcs(63.5).build());
  }

  @Test
  void theEncoderRefusesMixedReportsAndReducedPositionsWithoutScales() {
    Dwell mixed = dwell().report(TargetReport.at(59.3, 18.6).build()).report(TargetReport.at(59.3, 18.6).height(5).build()).build();
    assertThatThrownBy(() -> bytes(mixed)).isInstanceOf(IllegalArgumentException.class);
    Dwell reduced = dwell().report(TargetReport.at(59.3, 18.6).reduced(true).build()).build();
    assertThatThrownBy(() -> bytes(reduced)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void manyReportsInOneSegment() {
    var reports = new ArrayList<TargetReport>();
    for (int i = 0; i < 500; i++) {
      reports.add(TargetReport.at(59.0 + i * 1e-3, 18.0 + i * 2e-3).index(i).build());
    }
    Dwell d = (Dwell) decode(bytes(dwell().reports(reports).build())).segments().getFirst();
    assertThat(d.reports()).hasSize(500);
    assertThat(d.reports().get(499).index()).isEqualTo(499);
  }

  static JobDefinition job(long jobId, int priority) {
    List<Position> area = List.of(Position.of(-1.5, 51.5), Position.of(-0.5, 51.5), Position.of(-0.5, 51.0), Position.of(-1.5, 51.0));
    return new JobDefinition(jobId, 255, "SIM", 0, priority, area, JobDefinition.MODE_MTI, 100, JobDefinition.NONE_16, JobDefinition.NONE_16,
        JobDefinition.NONE_16, JobDefinition.NONE_8, JobDefinition.NONE_16, 2_000, JobDefinition.NO_CROSS_RANGE_ERROR, JobDefinition.NONE_16,
        20, 90, JobDefinition.NONE_8, 0, 0);
  }
}
