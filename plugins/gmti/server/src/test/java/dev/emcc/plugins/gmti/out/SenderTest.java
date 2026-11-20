package dev.emcc.plugins.gmti.out;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.gmti.format.Angles;
import dev.emcc.plugins.gmti.format.Decoder;
import dev.emcc.plugins.gmti.format.Dwell;
import dev.emcc.plugins.gmti.format.Edition;
import dev.emcc.plugins.gmti.format.JobDefinition;
import dev.emcc.plugins.gmti.format.Mission;
import dev.emcc.plugins.gmti.format.Packet;
import dev.emcc.plugins.gmti.format.Segment;
import dev.emcc.plugins.gmti.format.TargetReport;
import dev.emcc.plugins.gmti.in.AreaShape;
import dev.emcc.plugins.gmti.in.LabelRule;
import dev.emcc.plugins.gmti.in.Receiver;
import dev.emcc.sdk.ClassificationLimit;
import dev.emcc.sdk.Classifications;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.geo.GeodesicLeg;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.model.TimeAttributes;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.zip.CRC32;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

/** The packets of an {@code out} link (brief section 3, "Out"): criterion 10, the labels, the area, the job definition. */
class SenderTest {

  static final SecurityLabel UNCLASSIFIED = SecurityLabel.of("NATO", "UNCLASSIFIED");
  static final SecurityLabel RESTRICTED = SecurityLabel.of("NATO", "RESTRICTED");
  static final SecurityLabel SECRET = SecurityLabel.of("NATO", "SECRET");
  static final Instant START = Instant.parse("2026-11-07T10:00:00Z");
  /** The platform near Gotland: latitude ≠ longitude. */
  static final Position PLATFORM = Position.of(18.3, 57.4, 8_000.0);
  static final UUID SENSOR = UUID.fromString("0123abcd-0000-0000-0000-000000000001");

  static Sender sender(int perSegment, int maxPacket, SecurityLabel link, ClassificationLimit highest) {
    return new Sender(new Sender.Settings("XN", false, perSegment, maxPacket, link, highest, LabelRule.NATO), Classifications.nato(), START);
  }

  static Sender sender() {
    return startedAt(START);
  }

  /** {@link #sender()}'s link, started at {@code start}. */
  static Sender startedAt(Instant start) {
    var settings = new Sender.Settings("XN", false, 120, Decoder.MAX_PACKET, UNCLASSIFIED, new ClassificationLimit("NATO", "COSMIC TOP SECRET"), LabelRule.NATO);
    return new Sender(settings, Classifications.nato(), start);
  }

  /** The simulator's right-looking sector: 20 to 150 km, 45° to 135°. */
  static Geometry.ArcBand sector() {
    return new Geometry.ArcBand(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), 20_000, 150_000, 45, 135);
  }

  static ChannelItem.Detection detection(Position at, String sidc, @Nullable Double speed, @Nullable Double direction, SecurityLabel label) {
    Modifiers.Builder m = Modifiers.builder();
    if (speed != null) {
      m.speed(speed);
    }
    if (direction != null) {
      m.direction(direction);
    }
    var content = new MapObjectContent(MapObjectContent.SYMBOL, MapObjectContent.GENERAL, "manual", new TimeAttributes(START, null, null),
        UUID.randomUUID(), new Geometry.Point(at), new Symbol(SymbolStandard.APP_6D, sidc, m.build()), null, null, label, Extensions.empty());
    return new ChannelItem.Detection(UUID.randomUUID(), content);
  }

  static ChannelItem.Detection vehicle(Position at) {
    return detection(at, "10061500310000000000", null, null, UNCLASSIFIED); // land equipment, wheeled
  }

  static ChannelItem.SensorReport dwell(Instant time, Geometry area, List<ChannelItem.Detection> detections) {
    return new ChannelItem.SensorReport(SENSOR, PLATFORM, time, area, detections);
  }

  static List<Packet> decode(Sender.Result r) {
    return r.packets().stream().map(b -> Decoder.decode(b).packet()).toList();
  }

  static List<Dwell> dwells(List<Packet> packets) {
    var list = new ArrayList<Dwell>();
    packets.forEach(p -> p.segments().stream().filter(s -> s instanceof Dwell).map(s -> (Dwell) s).forEach(list::add));
    return list;
  }

  @Test
  void aDwellIsAPacketWithTheMissionTheJobAndTheDwell() {
    Position at = Geodesy.direct(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), 90, 60_000);
    var result = sender().dwell(dwell(START.plusSeconds(5), sector(), List.of(vehicle(at), vehicle(at), vehicle(at))));
    List<Packet> packets = decode(result);
    assertThat(packets).hasSize(1);
    Packet p = packets.getFirst();
    assertThat(p.header().version()).as("Edition 3, the link's default (M9.1)").isEqualTo("30");
    assertThat(p.header().nationality()).isEqualTo("XN");
    assertThat(p.header().classificationSystem()).isEqualTo("XN");
    assertThat(p.header().classification()).as("P4 5: unclassified").isEqualTo(5);
    assertThat(p.header().exercise()).as("operation, simulated").isEqualTo(1);
    assertThat(p.header().platformId()).isEqualTo("SIM0123ABC").isEqualTo(result.platformId());
    assertThat(p.header().missionId()).as("the second of the link's start").isEqualTo(36_000);
    assertThat(p.header().jobId()).isEqualTo(1);
    assertThat(p.segments()).extracting(Segment::type).containsExactly(1, 5, 2);
    assertThat(((Mission) p.segments().get(0)).referenceDay()).isEqualTo(LocalDate.of(2026, 11, 7));
    JobDefinition job = (JobDefinition) p.segments().get(1);
    assertThat(job.slantRangeError()).as("no sensor: no statement (B2)").isEqualTo(JobDefinition.NONE_16);
    assertThat(job.boundingArea()).hasSize(4);
    Dwell d = (Dwell) p.segments().get(2);
    assertThat(d.time()).isEqualTo(36_005_000);
    assertThat(d.sensorLongitude()).isCloseTo(18.3, within(1e-6));
    assertThat(d.sensorLatitude()).isCloseTo(57.4, within(1e-6));
    assertThat(d.sensorAltitude()).isEqualTo(8_000.0);
    assertThat(d.dwellIndex()).isZero();
    assertThat(d.lastDwell()).isTrue();
    assertThat(d.reports()).hasSize(3);
    TargetReport r = d.reports().get(2);
    assertThat(r.index()).isEqualTo(2);
    assertThat(r.longitude()).isCloseTo(at.longitude(), within(1e-6));
    assertThat(r.latitude()).isCloseTo(at.latitude(), within(1e-6));
    assertThat(r.classification()).as("wheeled, simulated").isEqualTo(130);
    assertThat(r.classificationProbability()).isEqualTo(100);
    assertThat(r.radialVelocity()).as("no speed").isNull();
  }

  @Test
  void theArcBandOfTheSensorIsExactInTheDwellArea() {
    Dwell d = dwells(decode(sender().dwell(dwell(START, sector(), List.of())))).getFirst();
    Position centre = Geodesy.direct(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), 90, 85_000);
    assertThat(d.areaLatitude()).isCloseTo(centre.latitude(), within(1e-6));
    assertThat(d.areaLongitude()).isCloseTo(centre.longitude(), within(1e-6));
    assertThat(d.rangeHalfExtent()).isCloseTo(65.0, within(1 / 128.0));
    assertThat(d.angleHalfExtent()).isCloseTo(45.0, within(0.006));
  }

  @Test
  void cr0035_aCircleRoundTheSensorIsItsHalfwayPointHalfItsRadiusAnd180Degrees() {
    var circle = new Geometry.Circle(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), 150_000);
    var result = sender().dwell(dwell(START, circle, List.of()));
    Dwell d = dwells(decode(result)).getFirst();
    Position halfway = fromPlatform(0, 75_000);
    assertThat(d.areaLatitude()).as("75 km north of the sensor").isCloseTo(halfway.latitude(), within(1e-6));
    assertThat(d.areaLongitude()).isCloseTo(halfway.longitude(), within(1e-6));
    assertThat(d.rangeHalfExtent()).isEqualTo(75.0);
    assertThat(d.angleHalfExtent()).isCloseTo(180.0, within(0.006));
    assertThat(result.areaCut()).isFalse();
    assertThat(AreaShape.of(d)).as("in reads it back as the circle round the sensor").isInstanceOfSatisfying(Geometry.Circle.class, c -> {
      assertThat(c.radius()).isCloseTo(150_000, within(1.0));
      assertThat(Geodesy.inverse(c.center(), PLATFORM).distanceMetres()).isLessThan(0.01);
    });

    var deepest = new Geometry.Circle(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), Sender.MAX_AREA_DEPTH_METRES);
    assertThat(sender().dwell(dwell(START, deepest, List.of())).areaCut()).as("511.98 km goes whole").isFalse();
    var deeper = new Geometry.Circle(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), Sender.MAX_AREA_DEPTH_METRES + 1);
    assertThat(sender().dwell(dwell(START, deeper, List.of())).areaCut()).as("a metre more is cut").isTrue();
  }

  static ChannelItem.SensorReport dwell(UUID sensor, Instant time, Geometry area, List<ChannelItem.Detection> detections, ChannelItem.Sensor about) {
    return new ChannelItem.SensorReport(sensor, PLATFORM, time, area, detections, about);
  }

  /** Criterion 17's sensor. */
  static ChannelItem.Sensor spaning(String name) {
    return new ChannelItem.Sensor(name, Duration.ofSeconds(10), 20.0, 50.0, 1.5, 0.9, 45.0, 120.0);
  }

  static JobDefinition job(List<Packet> packets) {
    return (JobDefinition) packets.getFirst().segments().stream().filter(s -> s instanceof JobDefinition).findFirst().orElseThrow();
  }

  @Test
  void criterion17_theSensorsNameAndValuesInTheFormatsUnits() {
    Position at = fromPlatform(90, 60_000);
    Sender.Result r = sender().dwell(dwell(SENSOR, START, sector(), List.of(vehicle(at), vehicle(fromPlatform(70, 40_000))), spaning("Spaning Hög 1")));
    List<Packet> packets = decode(r);
    assertThat(packets.getFirst().header().platformId()).as("ö as ?, cut to 10").isEqualTo("Spaning H?").isEqualTo(r.platformId());
    JobDefinition job = job(packets);
    assertThat(job.revisitInterval()).as("J15, ds").isEqualTo(100);
    assertThat(job.slantRangeError()).as("J21, cm").isEqualTo(2_000);
    assertThat(job.crossRangeError()).as("J22: 50 m seen from the sensor at the centre's 85 km")
        .isCloseTo(Math.toDegrees(Math.atan2(50, 85_000)), within(0.006));
    assertThat(job.minimumDetectableVelocity()).as("J24, dm/s").isEqualTo(15);
    assertThat(job.detectionProbability()).as("J25, %").isEqualTo(90);
    assertThat(job.radialVelocityError()).as("J23 has no source").isEqualTo(JobDefinition.NONE_16);
    Dwell d = dwells(packets).getFirst();
    assertThat(d.sensorTrack()).as("D15").isCloseTo(45.0, within(0.006));
    assertThat(d.sensorSpeed()).as("D16").isEqualTo(120.0);
    assertThat(d.sensorVerticalVelocity()).as("D17").isEqualTo(0.0);
    assertThat(d.minimumDetectableVelocity()).as("D31").isEqualTo(1.5);
    assertThat(List.of(d.alongTrackError(), d.crossTrackError(), d.altitudeError())).as("D12 to D14 0, for D32.12 and D32.13").containsOnly(0.0);
    assertThat(d.reports()).hasSize(2).allSatisfy(t -> {
      assertThat(t.slantRangeError()).as("D32.12").isEqualTo(20.0);
      assertThat(t.crossRangeError()).as("D32.13").isEqualTo(50.0);
    });
    assertThat(r.notHeld()).isEmpty();
  }

  @Test
  void criterion17_aSecondSensorOfTheSameNameGetsTilde2AndKeepsItsP8() {
    Sender s = sender();
    UUID second = UUID.fromString("0123abcd-0000-0000-0000-000000000002");
    assertThat(s.dwell(dwell(SENSOR, START, sector(), List.of(), spaning("Spaning Hög 1"))).platformId()).isEqualTo("Spaning H?");
    assertThat(s.dwell(dwell(second, START, sector(), List.of(), spaning("Spaning Hög 2"))).platformId()).as("cut to 8, then ~2").isEqualTo("Spaning ~2");
    assertThat(s.dwell(dwell(second, START.plusSeconds(10), sector(), List.of(), spaning("Renamed"))).platformId())
        .as("kept while the link runs").isEqualTo("Spaning ~2");
    assertThat(decode(s.dwell(dwell(second, START.plusSeconds(20), sector(), List.of(), spaning("Renamed")))).getFirst().header().platformId())
        .isEqualTo("Spaning ~2");
  }

  @Test
  void criterion17_aDwellWithoutASensorSendsAssumptionB2sValues() {
    Sender.Result r = sender().dwell(dwell(START, sector(), List.of(vehicle(fromPlatform(90, 60_000)))));
    List<Packet> packets = decode(r);
    assertThat(r.platformId()).isEqualTo("SIM0123ABC");
    JobDefinition job = job(packets);
    assertThat(job.revisitInterval()).isZero();
    assertThat(List.of(job.slantRangeError(), job.radialVelocityError())).containsOnly(JobDefinition.NONE_16);
    assertThat(job.crossRangeError()).isEqualTo(JobDefinition.NO_CROSS_RANGE_ERROR);
    assertThat(List.of(job.minimumDetectableVelocity(), job.detectionProbability())).containsOnly(JobDefinition.NONE_8);
    Dwell d = dwells(packets).getFirst();
    assertThat(d.sensorTrack()).isNull();
    assertThat(d.minimumDetectableVelocity()).isNull();
    assertThat(d.alongTrackError()).isNull();
    assertThat(d.reports().getFirst().slantRangeError()).isNull();
    assertThat(r.notHeld()).isEmpty();
  }

  @Test
  void r2_tenSensorsOfOneNameGetTilde2ToTilde9ThenTilde10() {
    Sender s = sender();
    var ids = new ArrayList<String>();
    for (int i = 1; i <= 10; i++) {
      UUID id = UUID.fromString("0123abcd-0000-0000-0000-0000000000" + String.format("%02d", i));
      ids.add(s.dwell(dwell(id, START, sector(), List.of(), ChannelItem.Sensor.named("Spaning Hög"))).platformId());
    }
    assertThat(ids).containsExactly("Spaning H?", "Spaning ~2", "Spaning ~3", "Spaning ~4", "Spaning ~5", "Spaning ~6", "Spaning ~7",
        "Spaning ~8", "Spaning ~9", "Spaning~10");
    assertThat(Sender.basic("A\uD83D\uDE00b")).as("one ? per character, also outside the BMP").isEqualTo("A?b");
    assertThat(s.dwell(dwell(UUID.randomUUID(), START, sector(), List.of(), ChannelItem.Sensor.named("Spaning H?"))).platformId())
        .as("taken: the name cut to 8 and the first free suffix").isEqualTo("Spaning~11");
  }

  /** Criterion 17's sensor flying {@code mission}. */
  static ChannelItem.Sensor flying(@Nullable String mission) {
    return spaning("Spaning 1").withMission(mission);
  }

  /** {@code M1} as sent: the 12 bytes after the packet header (32) and the mission segment's header (5). */
  static String m1(Sender.Result r) {
    return new String(r.packets().getFirst(), 37, 12, StandardCharsets.US_ASCII);
  }

  static long p9(Sender.Result r) {
    return decode(r).getFirst().header().missionId();
  }

  @Test
  void criterion20_aMissionIsM1CutTo12AndP9TheCrc32OfItsWholeText() {
    Sender s = sender();
    Sender.Result r = s.dwell(dwell(SENSOR, START, sector(), List.of(), flying("ATO-2611-BRAVO")));
    assertThat(m1(r)).isEqualTo("ATO-2611-BRA");
    assertThat(((Mission) decode(r).getFirst().segments().getFirst()).missionPlan()).isEqualTo("ATO-2611-BRA");
    assertThat(p9(r)).as("0x3E405562").isEqualTo(1_044_403_554L);
    assertThat(r.missionCut()).as("counted").isTrue();
    Sender.Result next = s.dwell(dwell(SENSOR, START.plusSeconds(10), sector(), List.of(), flying("ATO-2611-BRAVO")));
    assertThat(next.missionCut()).as("once per sensor while the link runs").isFalse();
    assertThat(p9(next)).isEqualTo(1_044_403_554L);

    UUID second = UUID.fromString("0123abcd-0000-0000-0000-000000000002");
    Sender.Result brave = s.dwell(dwell(second, START, sector(), List.of(), flying("ATO-2611-BRAVE")));
    assertThat(m1(brave)).as("the same M1, no suffix").isEqualTo("ATO-2611-BRA");
    assertThat(p9(brave)).as("P9 tells them apart").isEqualTo(3_734_355_068L);
    assertThat(brave.missionCut()).as("each sensor counts its own cut").isTrue();
  }

  @Test
  void criterion20_aReplacedCharacterIsNoCut_noMissionSendsSpacesAndTheLinksSecond() {
    Sender s = sender();
    Sender.Result r = s.dwell(dwell(SENSOR, START, sector(), List.of(), flying("Övning Norr")));
    assertThat(m1(r)).as("Ö as ?, as P8; padded with spaces").isEqualTo("?vning Norr ");
    assertThat(r.missionCut()).isFalse();
    assertThat(p9(r)).as("of the text before the replacement").isEqualTo(Sender.missionId("Övning Norr")).isNotEqualTo(Sender.missionId("?vning Norr"));
    Sender.Result emoji = s.dwell(dwell(UUID.randomUUID(), START, sector(), List.of(), flying("Övning " + Character.toString(0x1F681) + " Norr")));
    assertThat(m1(emoji)).as("one ? per code point, then the cut").isEqualTo("?vning ? Nor");
    assertThat(emoji.missionCut()).isTrue();

    Sender.Result none = s.dwell(dwell(UUID.randomUUID(), START, sector(), List.of(), flying(null)));
    assertThat(m1(none)).isEqualTo(" ".repeat(12));
    assertThat(p9(none)).as("the second of the link's start").isEqualTo(36_000);
    assertThat(none.missionCut()).isFalse();
    Sender.Result blank = s.dwell(dwell(UUID.randomUUID(), START, sector(), List.of(), flying("   ")));
    assertThat(p9(blank)).as("a blank mission is none (the SDK)").isEqualTo(36_000);
  }

  @Test
  void criterion20_theSameMissionAfterARestartKeepsItsP9_onlyTheDayMoves() {
    Sender before = sender();
    Sender after = startedAt(START.plus(Duration.ofDays(1)).plusSeconds(77));
    Sender.Result first = before.dwell(dwell(SENSOR, START, sector(), List.of(), flying("ATO-2611-BRAVO")));
    Sender.Result again = after.dwell(dwell(SENSOR, START.plus(Duration.ofDays(1)).plusSeconds(80), sector(), List.of(), flying("ATO-2611-BRAVO")));
    assertThat(p9(again)).isEqualTo(p9(first)).isEqualTo(1_044_403_554L);
    assertThat(((Mission) decode(again).getFirst().segments().getFirst()).referenceDay()).isEqualTo(LocalDate.of(2026, 11, 8));
    assertThat(again.missionCut()).as("a new run of the link counts again").isTrue();
    Sender.Result none = after.dwell(dwell(UUID.randomUUID(), START.plus(Duration.ofDays(1)).plusSeconds(80), sector(), List.of(), flying(null)));
    assertThat(p9(none)).as("no mission: the second of the new start").isEqualTo(36_077);
  }

  @Test
  void criterion20_p9IsCrc32OfTheUtf8Text_0SentAs1() {
    assertThat(Sender.missionId("123456789")).as("CRC-32's check value").isEqualTo(0xCBF4_3926L);
    var crc = new CRC32();
    crc.update("ZERO-4-4VAg".getBytes(StandardCharsets.UTF_8));
    assertThat(crc.getValue()).as("a text whose CRC-32 is 0").isZero();
    assertThat(Sender.missionId("ZERO-4-4VAg")).as("0 is sent as 1").isEqualTo(1);
  }

  @Test
  void criterion18_valuesNotHeldAreNoStatementOrLeftOut_neverClamped() {
    var sensor = new ChannelItem.Sensor("Spaning 1", Duration.ofSeconds(7_000), 700.0, 7_000.0, 30.0, null, null, null);
    Sender.Result r = sender().dwell(dwell(SENSOR, START, sector(), List.of(vehicle(fromPlatform(90, 60_000))), sensor));
    List<Packet> packets = decode(r);
    JobDefinition job = job(packets);
    assertThat(job.revisitInterval()).as("J15 0: not revisiting, the only value that claims nothing false").isZero();
    assertThat(job.slantRangeError()).as("J21 no statement").isEqualTo(JobDefinition.NONE_16);
    assertThat(job.minimumDetectableVelocity()).as("J24 no statement").isEqualTo(JobDefinition.NONE_8);
    assertThat(job.crossRangeError()).as("J22 holds 7 000 m as an angle").isCloseTo(Math.toDegrees(Math.atan2(7_000, 85_000)), within(0.006));
    assertThat(job.detectionProbability()).as("absent: no statement, not counted").isEqualTo(JobDefinition.NONE_8);
    Dwell d = dwells(packets).getFirst();
    assertThat(d.minimumDetectableVelocity()).as("D31 left out").isNull();
    assertThat(d.reports().getFirst().slantRangeError()).as("D32.12 left out").isNull();
    assertThat(d.reports().getFirst().crossRangeError()).as("D32.13 left out").isNull();
    assertThat(d.alongTrackError()).as("no report errors: no D12 to D14").isNull();
    assertThat(d.sensorTrack()).as("no direction: no D15 to D17").isNull();
    assertThat(r.notHeld()).containsExactly("J15", "J21", "D32.12", "D32.13", "J24", "D31");
  }

  @Test
  void r3_justBelowAndAtEachLimit() {
    var fits = new ChannelItem.Sensor("Edge", Duration.ofMillis(6_553_500), 655.34, 6_553.5, 25.4, null, null, null);
    Sender.Result r = sender().dwell(dwell(SENSOR, START, sector(), List.of(vehicle(fromPlatform(90, 60_000))), fits));
    JobDefinition job = job(decode(r));
    assertThat(job.revisitInterval()).isEqualTo(65_535);
    assertThat(job.slantRangeError()).isEqualTo(65_534);
    assertThat(job.minimumDetectableVelocity()).isEqualTo(254);
    assertThat(r.notHeld()).isEmpty();
    var over = new ChannelItem.Sensor("Over", Duration.ofMillis(6_553_600), 655.35, 6_553.6, 25.5, null, null, null);
    Sender.Result o = sender().dwell(dwell(SENSOR, START, sector(), List.of(vehicle(fromPlatform(90, 60_000))), over));
    Dwell d = dwells(decode(o)).getFirst();
    assertThat(d.reports().getFirst().slantRangeError()).as("D32.12 holds 65 535 cm, J21 does not").isEqualTo(655.35);
    assertThat(d.minimumDetectableVelocity()).as("D31 holds 255 dm/s, J24 does not").isEqualTo(25.5);
    assertThat(o.notHeld()).containsExactly("J15", "J21", "D32.13", "J24");
  }

  @Test
  void r3_aCrossRangeErrorOnAnAreaCentredOnTheSensorHasNoAngle_aCircleHasItsHalfwayPoint() {
    var ellipse = new Geometry.Ellipse(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), 100_000, 60_000, 30);
    Sender.Result r = sender().dwell(dwell(SENSOR, START, ellipse, List.of(vehicle(fromPlatform(90, 50_000))), spaning("Spaning 1")));
    assertThat(job(decode(r)).crossRangeError()).isEqualTo(JobDefinition.NO_CROSS_RANGE_ERROR);
    assertThat(dwells(decode(r)).getFirst().reports().getFirst().crossRangeError()).as("D32.13 is a length: sent").isEqualTo(50.0);
    assertThat(r.notHeld()).containsExactly("J22");

    var circle = new Geometry.Circle(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), 100_000);
    Sender.Result c = sender().dwell(dwell(SENSOR, START, circle, List.of(vehicle(fromPlatform(90, 60_000))), spaning("Spaning 1")));
    assertThat(job(decode(c)).crossRangeError()).as("CR-0035: seen at the centre, 50 km out")
        .isCloseTo(Math.toDegrees(Math.atan2(50, 50_000)), within(0.006));
    assertThat(c.notHeld()).isEmpty();
  }

  @Test
  void r3_aHeightOrRadialSpeedItsS16CannotHoldIsLeftOutAndCounted() {
    Position p60 = fromPlatform(90, 60_000);
    Position high = Position.of(p60.longitude(), p60.latitude(), 40_000.0);
    var fast = detection(fromPlatform(90, 70_000), "10061500310000000000", 400.0, 90.0, UNCLASSIFIED);
    Position p80 = fromPlatform(90, 80_000);
    var fine = detection(Position.of(p80.longitude(), p80.latitude(), 30_000.0), "10061500310000000000", 300.0, 90.0, UNCLASSIFIED);
    Sender.Result r = sender().dwell(dwell(START, sector(), List.of(vehicle(high), fast, fine)));
    List<TargetReport> reports = dwells(decode(r)).stream().flatMap(d -> d.reports().stream()).toList();
    assertThat(reports).hasSize(3);
    assertThat(reports).filteredOn(t -> t.index() == 0).singleElement().satisfies(t -> assertThat(t.height()).as("40 000 m: left out").isNull());
    assertThat(reports).filteredOn(t -> t.index() == 1).singleElement()
        .satisfies(t -> assertThat(t.radialVelocity()).as("400 m/s away: left out").isNull());
    assertThat(reports).filteredOn(t -> t.index() == 2).singleElement().satisfies(t -> {
      assertThat(t.height()).isEqualTo(30_000);
      assertThat(t.radialVelocity()).isCloseTo(300.0, within(0.5));
    });
    assertThat(r.notHeld()).containsExactly("D32.6", "D32.7");
  }

  static Position fromPlatform(double bearing, double metres) {
    return Geodesy.direct(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), bearing, metres);
  }

  @Test
  void criterion19_aCircleOf400KmGoesWholeWithItsCentre200KmNorth() {
    var circle = new Geometry.Circle(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), 400_000);
    Sender.Result r = sender().dwell(dwell(START, circle, List.of(vehicle(fromPlatform(30, 100_000)), vehicle(fromPlatform(200, 300_000)))));
    Dwell d = dwells(decode(r)).getFirst();
    Position centre = fromPlatform(0, 200_000);
    assertThat(d.areaLatitude()).as("D24, 200 km north of the sensor").isCloseTo(centre.latitude(), within(1e-6));
    assertThat(d.areaLongitude()).as("D25").isCloseTo(centre.longitude(), within(1e-6));
    assertThat(d.rangeHalfExtent()).as("D26 200 km").isEqualTo(200.0);
    assertThat(d.angleHalfExtent()).as("D27 180°").isCloseTo(180.0, within(0.006));
    assertThat(AreaShape.of(d)).as("in reads back a circle of 400 km round the sensor").isInstanceOfSatisfying(Geometry.Circle.class, c -> {
      assertThat(c.radius()).isCloseTo(400_000, within(1.0));
      assertThat(Geodesy.inverse(c.center(), PLATFORM).distanceMetres()).isLessThan(0.01);
    });
    assertThat(d.reports()).as("both detections").hasSize(2);
    assertThat(r.areaCut()).as("nothing counted").isFalse();
    assertThat(r.beyondReach()).isZero();
  }

  @Test
  void criterion19_aCircleOf600KmIsCut511KmOutAndTheDetectionBeyondIsLeftOut() {
    var circle = new Geometry.Circle(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), 600_000);
    Position kept = fromPlatform(30, 500_000);
    Sender.Result r = sender().dwell(dwell(START, circle, List.of(vehicle(kept), vehicle(fromPlatform(200, 550_000)))));
    Dwell d = dwells(decode(r)).getFirst();
    assertThat(d.rangeHalfExtent()).as("D26 255.99 km").isEqualTo(DwellArea.MAX_HALF_EXTENT_KM);
    Position centre = fromPlatform(0, DwellArea.MAX_HALF_EXTENT_KM * 1_000);
    assertThat(d.areaLatitude()).as("its centre 255.99 km north").isCloseTo(centre.latitude(), within(1e-6));
    assertThat(d.areaLongitude()).isCloseTo(centre.longitude(), within(1e-6));
    assertThat(AreaShape.of(d)).as("a receiver sees a circle of 511.98 km").isInstanceOfSatisfying(Geometry.Circle.class,
        c -> assertThat(c.radius()).isCloseTo(Sender.MAX_AREA_DEPTH_METRES, within(10.0)));
    assertThat(d.reports()).hasSize(1);
    assertThat(d.reports().getFirst().latitude()).as("the detection at 500 km").isCloseTo(kept.latitude(), within(1e-6));
    assertThat(d.reports().getFirst().longitude()).isCloseTo(kept.longitude(), within(1e-6));
    assertThat(r.areaCut()).as("not held: D26").isTrue();
    assertThat(r.beyondReach()).as("the detection at 550 km").isEqualTo(1);
    assertThat(r.detections()).isEqualTo(1);
  }

  @Test
  void criterion19_anArcBandFrom20To400KmIsSentWhole() {
    var band = new Geometry.ArcBand(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), 20_000, 400_000, 45, 135);
    Sender.Result r = sender().dwell(dwell(START, band, List.of(vehicle(fromPlatform(90, 25_000)), vehicle(fromPlatform(90, 395_000)))));
    Dwell d = dwells(decode(r)).getFirst();
    assertThat(d.rangeHalfExtent()).as("half of 380 km").isCloseTo(190.0, within(1 / 128.0));
    assertThat(d.reports()).hasSize(2);
    assertThat(r.areaCut()).isFalse();
    assertThat(r.beyondReach()).isZero();
  }

  @Test
  void q5_aDeeperArcBandKeepsItsNearEdgeAndIsCut511KmBeyondIt() {
    var band = new Geometry.ArcBand(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), 20_000, 1_000_000, 45, 135);
    Sender.Result r = sender().dwell(dwell(START, band, List.of(vehicle(fromPlatform(90, 25_000)), vehicle(fromPlatform(60, 500_000)),
        vehicle(fromPlatform(90, 600_000)), vehicle(fromPlatform(100, 531_975)), vehicle(fromPlatform(100, 531_982)))));
    Dwell d = dwells(decode(r)).getFirst();
    assertThat(d.rangeHalfExtent()).isEqualTo(DwellArea.MAX_HALF_EXTENT_KM);
    assertThat(d.angleHalfExtent()).as("the bearings stay").isCloseTo(45.0, within(0.006));
    Position centre = fromPlatform(90, 20_000 + DwellArea.MAX_HALF_EXTENT_KM * 1_000);
    assertThat(d.areaLatitude()).as("the centre 255.99 km past the near edge").isCloseTo(centre.latitude(), within(1e-6));
    assertThat(d.areaLongitude()).isCloseTo(centre.longitude(), within(1e-6));
    double centreRange = Geodesy.inverse(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), Position.of(d.areaLongitude(), d.areaLatitude()))
        .distanceMetres();
    assertThat(centreRange - d.rangeHalfExtent() * 1_000).as("a receiver's inner radius: the near edge, 20 km").isCloseTo(20_000, within(1.0));
    assertThat(d.reports()).as("25, 500 and 531.975 km kept; 600 and 531.982 km are beyond 20 + 511.98 km, the declared depth").hasSize(3);
    assertThat(r.beyondReach()).isEqualTo(2);
    assertThat(r.areaCut()).isTrue();
  }

  @Test
  void q5_anotherShapeDeeperThanD26HoldsKeepsItsNearEdgeToo() {
    var polygon = new Geometry.Polygon(List.of(List.of(fromPlatform(80, 10_000), fromPlatform(80, 800_000), fromPlatform(100, 800_000),
        fromPlatform(100, 10_000), fromPlatform(80, 10_000))));
    Sender.Result r = sender().dwell(dwell(START, polygon, List.of(vehicle(fromPlatform(90, 400_000)), vehicle(fromPlatform(90, 600_000)))));
    Dwell d = dwells(decode(r)).getFirst();
    assertThat(d.rangeHalfExtent()).isEqualTo(DwellArea.MAX_HALF_EXTENT_KM);
    double centreRange = Geodesy.inverse(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), Position.of(d.areaLongitude(), d.areaLatitude()))
        .distanceMetres();
    assertThat(centreRange - d.rangeHalfExtent() * 1_000).as("the near edge, about 10 km").isCloseTo(10_000, within(100.0));
    assertThat(d.reports()).as("400 km kept, 600 km beyond about 522 km").hasSize(1);
    assertThat(r.beyondReach()).isEqualTo(1);
  }

  // ---------------------------------------------------------------- T-193, a dwell near a moving sensor

  /**
   * The owner's dwell (T-193): 0 to 2 km from {@code apex}, where the platform was when the revisit
   * began (the simulator's band), and 2° wide across north, 359° to 1°.
   */
  static Geometry.ArcBand ownersDwell(Position apex) {
    return new Geometry.ArcBand(apex, 0, 2_000, 359, 1);
  }

  /** {@code report} sent and read back by a receiver. */
  static Collected outAndBack(ChannelItem.SensorReport report) {
    var back = new Collected();
    var in = new Receiver(1_000, Receiver.TimeMode.AS_RECORDED);
    for (Packet p : decode(sender().dwell(report))) {
      in.packet(p, START.plusSeconds(10), back);
    }
    return back;
  }

  @Test
  void t193_aDwellCentred1KmFromTheSensorGoesExactly_D7D8AreThePlatformAtTheDwellsTime() {
    Instant time = START.plusMillis(2_500);
    Position apex = Position.of(PLATFORM.longitude(), PLATFORM.latitude());
    var report = new ChannelItem.SensorReport(SENSOR, PLATFORM, time, ownersDwell(apex), List.of());
    Dwell d = dwells(decode(sender().dwell(report))).getFirst();
    assertThat(d.time()).as("D6: the report's time").isEqualTo(36_002_500);
    assertThat(d.sensorLatitude()).as("D7: the report's platform, where it was at that time").isCloseTo(PLATFORM.latitude(), within(1e-6));
    assertThat(d.sensorLongitude()).as("D8").isCloseTo(PLATFORM.longitude(), within(1e-6));
    Position middle = fromPlatform(0, 1_000);
    assertThat(d.areaLatitude()).as("D24: the middle, 1 km north").isCloseTo(middle.latitude(), within(1e-7));
    assertThat(d.areaLongitude()).as("D25").isCloseTo(middle.longitude(), within(1e-7));
    assertThat(d.rangeHalfExtent()).as("D26: half of 2 km").isEqualTo(1.0);
    assertThat(d.angleHalfExtent()).as("D27: half of 2°, across 0°").isCloseTo(1.0, within(0.006));

    Collected back = outAndBack(report);
    assertThat(back.platforms).singleElement().satisfies(p -> {
      assertThat(p.time()).isEqualTo(time);
      assertThat(Geodesy.inverse(p.position(), apex).distanceMetres()).isLessThan(0.01);
    });
    assertThat(back.areas).singleElement().extracting(Receiver.AreaFix::area).isInstanceOfSatisfying(Geometry.ArcBand.class, a -> {
      assertThat(Geodesy.inverse(a.center(), apex).distanceMetres()).as("round the sensor").isLessThan(0.01);
      assertThat(a.innerRadius()).isCloseTo(0, within(0.5));
      assertThat(a.outerRadius()).isCloseTo(2_000, within(0.5));
      assertThat(a.startBearing()).as("the wrap across 0° kept").isCloseTo(359, within(0.01));
      assertThat(a.endBearing()).isCloseTo(1, within(0.01));
    });
  }

  @Test
  void t193_aDwellNearAMovingSensorKeepsItsBeam_neverAWideSectorOrACircle() {
    Position apex = Position.of(PLATFORM.longitude(), PLATFORM.latitude());
    Position middle = fromPlatform(0, 1_000);
    // The platform has moved since the revisit began, and turned sharply: ahead along the beam, to its right, back, to its left.
    // Before T-193 a band 1.5 m off became a circle (ahead) or a half disc (to a side).
    for (double moved : new double[] {1.5, 20, 400}) {
      for (double towards : new double[] {0, 90, 180, 270}) {
        Position now = Geodesy.direct(apex, towards, moved);
        var report = new ChannelItem.SensorReport(SENSOR, Position.of(now.longitude(), now.latitude(), 8_000.0), START, ownersDwell(apex), List.of());
        String as = moved + " m towards " + towards + "°";
        Dwell d = dwells(decode(sender().dwell(report))).getFirst();
        assertThat(Geodesy.inverse(middle, Position.of(d.areaLongitude(), d.areaLatitude())).distanceMetres()).as(as + ": D24/D25 the band's middle")
            .isLessThan(0.01);
        assertThat(d.rangeHalfExtent()).as(as + ": D26").isEqualTo(1.0);
        assertThat(d.angleHalfExtent()).as(as + ": D27, the beam's half width").isCloseTo(1.0, within(0.006));
        GeodesicLeg toMiddle = Geodesy.inverse(now, middle);
        assertThat(outAndBack(report).areas.getFirst().area()).as(as).isInstanceOfSatisfying(Geometry.ArcBand.class, a -> {
          assertThat(Geodesy.inverse(a.center(), now).distanceMetres()).as(as + ": round the platform").isLessThan(0.01);
          assertThat(DwellArea.clockwise(a.startBearing(), a.endBearing())).as(as + ": 2° wide").isCloseTo(2.0, within(0.012));
          assertThat(Angles.normalise360(toMiddle.initialAzimuth() - a.startBearing())).as(as + ": the middle on its axis").isCloseTo(1.0, within(0.012));
          assertThat(a.outerRadius()).as(as + ": out to the band's far edge").isCloseTo(toMiddle.distanceMetres() + 1_000, within(0.5));
          assertThat(a.outerRadius() - a.innerRadius()).as(as + ": at most 2 km deep").isLessThanOrEqualTo(2_000.5);
        });
      }
    }
  }

  @Test
  void t193_nearAMovingSensor_aFullBandIsTheCircle_358DegreesStayABand_aDeepBandIsCutFromItsOwnCentre() {
    Position apex = Position.of(PLATFORM.longitude(), PLATFORM.latitude());
    Position now = Geodesy.direct(apex, 135, 400);
    Position platform = Position.of(now.longitude(), now.latitude(), 8_000.0);

    var full = new ChannelItem.SensorReport(SENSOR, platform, START, new Geometry.ArcBand(apex, 0, 2_000, 30, 30), List.of());
    Dwell d = dwells(decode(sender().dwell(full))).getFirst();
    assertThat(d.angleHalfExtent()).as("D27 180°: all round").isCloseTo(180.0, within(0.006));
    double toCentre = Geodesy.inverse(now, Position.of(d.areaLongitude(), d.areaLatitude())).distanceMetres();
    assertThat(outAndBack(full).areas.getFirst().area()).as("D27 of 180° is a circle round the platform")
        .isInstanceOfSatisfying(Geometry.Circle.class, c -> {
          assertThat(Geodesy.inverse(c.center(), now).distanceMetres()).isLessThan(0.01);
          assertThat(c.radius()).isCloseTo(toCentre + 1_000, within(0.5));
        });

    var wide = new ChannelItem.SensorReport(SENSOR, platform, START, new Geometry.ArcBand(apex, 0, 2_000, 1, 359), List.of());
    assertThat(dwells(decode(sender().dwell(wide))).getFirst().angleHalfExtent()).as("358° wide: D27 179°").isCloseTo(179.0, within(0.006));
    assertThat(outAndBack(wide).areas.getFirst().area()).as("below 180° it stays a band").isInstanceOfSatisfying(Geometry.ArcBand.class,
        a -> assertThat(DwellArea.clockwise(a.startBearing(), a.endBearing())).isCloseTo(358.0, within(0.012)));

    // From the platform, 400 m away at 135°, both detections are about 280 m nearer than from the band's centre: measured from there,
    // both would be kept. The cut keeps 20 + 511.98 km from the band's own centre, as G12 says.
    var deep = new Geometry.ArcBand(apex, 20_000, 1_000_000, 45, 135);
    Sender.Result r = sender().dwell(new ChannelItem.SensorReport(SENSOR, platform, START, deep,
        List.of(vehicle(fromPlatform(90, 531_975)), vehicle(fromPlatform(90, 531_982)))));
    assertThat(r.areaCut()).isTrue();
    assertThat(r.beyondReach()).as("531.982 km from the band's centre").isEqualTo(1);
    assertThat(dwells(decode(r)).getFirst().reports()).as("531.975 km kept").hasSize(1);
  }

  // ---------------------------------------------------------------- M8 RC1, the owner's Systematic pass out and back (2026-11-16)

  /** The owner's ground radar near Gotland: latitude ≠ longitude. */
  static final Position GROUND_RADAR = Position.of(18.3, 57.4, 10.0);

  /**
   * The cells of a Systematic ground radar's pass as the simulator plans them (function 50, {@code Dwells.scan}): rows of
   * {@code depth} metres from 0 out to {@code range}, the last row cut there, each row in cells of 1.7° clockwise from 180° to
   * 360°, the row's last cut at 360°; in the order scanned, the nearest row first.
   */
  static List<Geometry.ArcBand> systematicPass(double depth, double range) {
    var cells = new ArrayList<Geometry.ArcBand>();
    Position apex = Position.of(GROUND_RADAR.longitude(), GROUND_RADAR.latitude());
    for (double near = 0; near < range - 1e-6; near += depth) {
      for (double from = 180; from < 360 - 1e-6; from += 1.7) {
        cells.add(new Geometry.ArcBand(apex, near, Math.min(near + depth, range), from, Math.min(from + 1.7, 360) % 360));
      }
    }
    return cells;
  }

  /**
   * The owner's report (M8 RC1, 2026-11-16): a Systematic pass from 180° to 360°, 1.7° wide, one dwell every 0.1 s, out 5 km, sent
   * by one link and read by another. Every dwell is sent as its own cell, {@code D27} the cell's half width (0.85°), and read back
   * as its own area: that cell, never a band grown over the pass.
   */
  @Test
  void m8rc1_aSystematicPassFrom180To360Degrees_depthAsTheRange_isOneAreaPerDwell_eachItsOwnCell() {
    roundTrip(systematicPass(5_000, 5_000), 106);
  }

  @Test
  void m8rc1_aSystematicPassFrom180To360Degrees_2KmDeepOf5Km_isOneAreaPerDwell_eachInItsOwnRangeBand() {
    roundTrip(systematicPass(2_000, 5_000), 318);
  }

  static void roundTrip(List<Geometry.ArcBand> cells, int count) {
    assertThat(cells).hasSize(count);
    assertThat(GROUND_RADAR.latitude()).isNotEqualTo(GROUND_RADAR.longitude());
    Sender out = sender();
    var in = new Receiver(1_000, Receiver.TimeMode.AS_RECORDED);
    var back = new Collected();
    var sent = new ArrayList<Dwell>();
    for (int k = 0; k < cells.size(); k++) {
      var report = new ChannelItem.SensorReport(SENSOR, GROUND_RADAR, START.plusMillis(100L * k), cells.get(k), List.of())
          .withSequence(new ChannelItem.SensorReport.Sequence(7, k, k == cells.size() - 1));
      for (Packet p : decode(out.dwell(report))) {
        p.segments().stream().filter(seg -> seg instanceof Dwell).map(seg -> (Dwell) seg).forEach(sent::add);
        in.packet(p, START.plusSeconds(60), back);
      }
    }
    assertThat(sent).hasSize(count);
    assertThat(back.areas).as("one area per dwell").hasSize(count);
    assertThat(back.areas).extracting(f -> dev.emcc.plugins.gmti.in.Mapper.areaId("sim-in", f)).as("each its own").doesNotHaveDuplicates();
    for (int k = 0; k < count; k++) {
      Geometry.ArcBand cell = cells.get(k);
      double width = DwellArea.clockwise(cell.startBearing(), cell.endBearing());
      double axis = Angles.normalise360(cell.startBearing() + width / 2);
      String as = "dwell " + k + ", " + cell.startBearing() + "° + " + width + "°, " + cell.innerRadius() + " to " + cell.outerRadius() + " m";
      Dwell d = sent.get(k);
      assertThat(d.revisitIndex()).as(as + ": D2").isEqualTo(7);
      assertThat(d.dwellIndex()).as(as + ": D3").isEqualTo(k);
      assertThat(d.lastDwell()).as(as + ": D4").isEqualTo(k == count - 1);
      assertThat(d.sensorLatitude()).as(as + ": D7").isCloseTo(GROUND_RADAR.latitude(), within(1e-6));
      assertThat(d.sensorLongitude()).as(as + ": D8").isCloseTo(GROUND_RADAR.longitude(), within(1e-6));
      GeodesicLeg toCentre = Geodesy.inverse(Position.of(GROUND_RADAR.longitude(), GROUND_RADAR.latitude()), Position.of(d.areaLongitude(), d.areaLatitude()));
      assertThat(Angles.normalise360(toCentre.initialAzimuth() - axis + 180) - 180).as(as + ": D24/D25 on the cell's axis").isCloseTo(0, within(0.01));
      assertThat(toCentre.distanceMetres()).as(as + ": D24/D25 the cell's middle").isCloseTo((cell.innerRadius() + cell.outerRadius()) / 2, within(0.5));
      assertThat(d.rangeHalfExtent()).as(as + ": D26, half the depth").isCloseTo((cell.outerRadius() - cell.innerRadius()) / 2_000, within(0.001));
      assertThat(d.angleHalfExtent()).as(as + ": D27, half the width").isCloseTo(width / 2, within(0.006));
      if (width > 1.69) {
        assertThat(d.angleHalfExtent()).as(as + ": 0.85°").isCloseTo(0.85, within(0.006));
      }
      assertThat(back.areas.get(k).area()).as(as).isInstanceOfSatisfying(Geometry.ArcBand.class, a -> {
        assertThat(Geodesy.inverse(a.center(), Position.of(GROUND_RADAR.longitude(), GROUND_RADAR.latitude())).distanceMetres()).as(as + ": round the radar")
            .isLessThan(0.01);
        assertThat(a.startBearing()).as(as + ": its own start").isCloseTo(cell.startBearing(), within(0.012));
        assertThat(DwellArea.clockwise(a.startBearing(), a.endBearing())).as(as + ": its own width").isCloseTo(width, within(0.012));
        assertThat(a.innerRadius()).as(as + ": its own near edge").isCloseTo(cell.innerRadius(), within(0.5));
        assertThat(a.outerRadius()).as(as + ": its own far edge").isCloseTo(cell.outerRadius(), within(0.5));
      });
    }
  }

  @Test
  void aDetectionBeyondTheReachRaisesNoLabel_oneAboveTheHighestIsCountedThereOnly() {
    Sender s = sender(120, Decoder.MAX_PACKET, UNCLASSIFIED, new ClassificationLimit("NATO", "CONFIDENTIAL"));
    var circle = new Geometry.Circle(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), 600_000);
    var farSecret = detection(fromPlatform(10, 550_000), "10061500310000000000", null, null, SECRET);
    var farRestricted = detection(fromPlatform(10, 550_000), "10061500310000000000", null, null, RESTRICTED);
    Sender.Result r = s.dwell(dwell(START, circle, List.of(vehicle(fromPlatform(10, 50_000)), farSecret, farRestricted)));
    assertThat(r.aboveHighest()).isEqualTo(1);
    assertThat(r.beyondReach()).isEqualTo(1);
    assertThat(decode(r).getFirst().header().classification()).as("only what is sent counts: UNCLASSIFIED").isEqualTo(5);
  }

  @Test
  void criterion10_300DetectionsGoAsThreeSegmentsOfOneDwell() {
    var detections = new ArrayList<ChannelItem.Detection>();
    for (int i = 0; i < 300; i++) {
      detections.add(vehicle(Geodesy.direct(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), 90, 30_000 + i * 100)));
    }
    List<Dwell> segments = dwells(decode(sender().dwell(dwell(START, sector(), detections))));
    assertThat(segments).extracting(s -> s.reports().size()).containsExactly(120, 120, 60);
    assertThat(segments).extracting(Dwell::revisitIndex).containsOnly(0);
    assertThat(segments).extracting(Dwell::time).containsOnly(36_000_000L);
    assertThat(segments.get(2).reports().getLast().index()).isEqualTo(299);
  }

  // ------------------------------------------------------------------- criterion 22, one segment per packet (T-159)

  /** {@link #sender()}'s link with {@code oneSegmentPerPacket} as given. */
  static Sender segmentsApart(boolean apart) {
    var settings = new Sender.Settings("XN", false, 120, Decoder.MAX_PACKET, UNCLASSIFIED, new ClassificationLimit("NATO", "COSMIC TOP SECRET"), LabelRule.NATO,
        apart);
    return new Sender(settings, Classifications.nato(), START);
  }

  /** 130 vehicles east of the platform, inside {@link #sector()}. */
  static List<ChannelItem.Detection> vehicles130() {
    var detections = new ArrayList<ChannelItem.Detection>();
    for (int i = 0; i < 130; i++) {
      detections.add(vehicle(Geodesy.direct(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), 90, 30_000 + i * 100)));
    }
    return detections;
  }

  // ------------------------------------------------------------------- M9.1: the edition, Edition 3 by default (owner, 2026-11-20)

  /** {@link #segmentsApart}'s link, in the edition given. */
  static Sender inEdition(Edition edition, boolean apart) {
    var settings = new Sender.Settings("XN", false, 120, Decoder.MAX_PACKET, UNCLASSIFIED, new ClassificationLimit("NATO", "COSMIC TOP SECRET"), LabelRule.NATO,
        apart, edition);
    return new Sender(settings, Classifications.nato(), START);
  }

  @Test
  void m91_edition3_isVersion30_andEveryPacketCarriesTheJob_asBeforeM91() {
    assertThat(decode(sender().dwell(dwell(START, sector(), List.of()))).getFirst().header().version()).as("the default").isEqualTo("30");
    List<Packet> packets = decode(inEdition(Edition.EDITION_3, true).dwell(dwell(START, sector(), vehicles130())));
    assertThat(packets).extracting(p -> p.segments().getFirst().type()).containsExactly(1, 5, 2, 2);
    assertThat(packets).extracting(p -> p.header().version()).containsOnly("30");
    long job = ((JobDefinition) packets.get(1).segments().getFirst()).jobId();
    assertThat(job).isPositive();
    assertThat(packets).extracting(p -> p.header().jobId()).as("Edition 3 allows the job in a packet without a dwell").containsOnly(job);
  }

  @Test
  void m91_edition4_isVersion41_andAPacketWithoutADwellHasJobId0() {
    List<Packet> packets = decode(inEdition(Edition.EDITION_4, true).dwell(dwell(START, sector(), vehicles130())));
    assertThat(packets).extracting(p -> p.segments().getFirst().type()).containsExactly(1, 5, 2, 2);
    assertThat(packets).extracting(p -> p.header().version()).containsOnly("41");
    long job = ((JobDefinition) packets.get(1).segments().getFirst()).jobId();
    assertThat(job).isPositive();
    assertThat(packets).extracting(p -> p.header().jobId()).as("AEDP 3.1.10: 0 without a dwell, the dwells' job with one")
        .containsExactly(0L, 0L, job, job);
    assertThat(packets).extracting(p -> p.header().withJobId(0)).as("the header otherwise the same").containsOnly(packets.getFirst().header());

    List<Packet> one = decode(inEdition(Edition.EDITION_4, false).dwell(dwell(START, sector(), vehicles130())));
    assertThat(one).hasSize(1);
    assertThat(one.getFirst().header().version()).isEqualTo("41");
    assertThat(one.getFirst().header().jobId()).as("one packet with the dwells: their job").isEqualTo(job);
  }

  @Test
  void m91_bothEditionsComeBackTheSameThroughAnInLink() {
    for (Edition edition : Edition.values()) {
      var in = new Receiver(1_000, Receiver.TimeMode.AS_RECORDED);
      var back = new Collected();
      List<Packet> packets = decode(inEdition(edition, true).dwell(dwell(START, sector(), vehicles130())));
      long job = ((JobDefinition) packets.get(1).segments().getFirst()).jobId();
      for (Packet p : packets) {
        in.packet(p, START.plusSeconds(5), back);
      }
      assertThat(back.detections).as("%s: every report", edition).hasSize(130);
      assertThat(back.detections).as("%s: each with the job's values", edition).allSatisfy(d -> {
        assertThat(d.job()).isNotNull();
        assertThat(d.job().jobId()).isEqualTo(job);
      });
      assertThat(back.coverages).as("%s: the job's box", edition).hasSize(1);
      assertThat(back.areas).extracting(Receiver.AreaFix::jobId).as("%s: the dwell's area, in its job", edition).isNotEmpty().containsOnly(job);
    }
  }

  /** {@code P2}, bytes 2 to 5 of the packet header, big-endian. */
  static long p2(byte[] packet) {
    return ((packet[2] & 0xFFL) << 24) | ((packet[3] & 0xFFL) << 16) | ((packet[4] & 0xFFL) << 8) | (packet[5] & 0xFFL);
  }

  @Test
  void criterion22_offIsOnePacketWithTheMissionTheJobAndTwoDwellSegments() {
    var result = segmentsApart(false).dwell(dwell(START, sector(), vehicles130()));
    assertThat(result.packets()).hasSize(1);
    byte[] only = result.packets().getFirst();
    assertThat(p2(only)).as("P2 its whole size").isEqualTo(only.length);
    Packet p = decode(result).getFirst();
    assertThat(p.segments()).extracting(Segment::type).containsExactly(1, 5, 2, 2);
    assertThat(dwells(List.of(p))).extracting(d -> d.reports().size()).containsExactly(120, 10);
  }

  @Test
  void criterion22_onIsFourPacketsOfOneSegmentEach_theHeaderOtherwiseTheSame() {
    var one = decode(segmentsApart(false).dwell(dwell(START, sector(), vehicles130()))).getFirst();
    var result = segmentsApart(true).dwell(dwell(START, sector(), vehicles130()));
    assertThat(result.packets()).hasSize(4);
    for (byte[] packet : result.packets()) {
      assertThat(p2(packet)).as("P2 each packet's own size").isEqualTo(packet.length);
    }
    List<Packet> packets = decode(result);
    assertThat(packets).extracting(p -> p.segments().size()).containsOnly(1);
    assertThat(packets).extracting(p -> p.segments().getFirst().type()).as("in that order").containsExactly(1, 5, 2, 2);
    assertThat(packets).extracting(Packet::header).as("P1 and P3 to P10 as the one packet's").containsOnly(one.header());
    assertThat(dwells(packets)).extracting(d -> d.reports().size()).containsExactly(120, 10);
    assertThat(dwells(packets).get(1).reports().getLast().index()).isEqualTo(129);
  }

  @Test
  void criterion22_aLaterReportWithoutAJobDueIsTheMissionAndTwoDwells() {
    Sender s = segmentsApart(true);
    s.dwell(dwell(START, sector(), vehicles130()));
    List<Packet> later = decode(s.dwell(dwell(START.plusSeconds(10), sector(), vehicles130())));
    assertThat(later).extracting(p -> p.segments().getFirst().type()).containsExactly(1, 2, 2);
    assertThat(later).extracting(p -> p.segments().size()).containsOnly(1);
  }

  @Test
  void criterion22_readBackByInBothFormsGiveTheSamePlatformAreaCoverageAndDetections() {
    Instant now = START.plusSeconds(1);
    Collected one = new Collected();
    Collected apart = new Collected();
    var inOne = new Receiver(1_000, Receiver.TimeMode.AS_RECORDED);
    var inApart = new Receiver(1_000, Receiver.TimeMode.AS_RECORDED);
    for (Packet p : decode(segmentsApart(false).dwell(dwell(START, sector(), vehicles130())))) {
      inOne.packet(p, now, one);
    }
    for (Packet p : decode(segmentsApart(true).dwell(dwell(START, sector(), vehicles130())))) {
      inApart.packet(p, now, apart);
    }
    assertThat(apart.platforms).extracting(Receiver.PlatformFix::position).isEqualTo(one.platforms.stream().map(Receiver.PlatformFix::position).toList());
    assertThat(apart.areas).extracting(Receiver.AreaFix::area).isEqualTo(one.areas.stream().map(Receiver.AreaFix::area).toList());
    assertThat(apart.coverages).hasSize(1).extracting(Receiver.CoverageFix::coverage)
        .isEqualTo(one.coverages.stream().map(Receiver.CoverageFix::coverage).toList());
    assertThat(apart.detections).hasSize(130).extracting(Receiver.DetectionFix::key)
        .isEqualTo(one.detections.stream().map(Receiver.DetectionFix::key).toList());
    assertThat(apart.counts).isEqualTo(one.counts);
  }

  @Test
  void criterion22_switchingTakesEffectFromTheNextReport() {
    Sender s = segmentsApart(true);
    assertThat(s.dwell(dwell(START, sector(), vehicles130())).packets()).hasSize(4);
    s.settings(new Sender.Settings("XN", false, 120, Decoder.MAX_PACKET, UNCLASSIFIED, new ClassificationLimit("NATO", "COSMIC TOP SECRET"),
        LabelRule.NATO, false));
    assertThat(types(s.dwell(dwell(START.plusSeconds(10), sector(), vehicles130())))).containsExactly(1, 2, 2);
    assertThat(s.dwell(dwell(START.plusSeconds(20), sector(), vehicles130())).packets()).hasSize(1);
  }

  /** What a receiver makes of the packets, for criterion 22. */
  static final class Collected implements Receiver.Sink {
    final List<Receiver.PlatformFix> platforms = new ArrayList<>();
    final List<Receiver.AreaFix> areas = new ArrayList<>();
    final List<Receiver.CoverageFix> coverages = new ArrayList<>();
    final List<Receiver.DetectionFix> detections = new ArrayList<>();
    final java.util.Map<String, Long> counts = new java.util.TreeMap<>();

    @Override
    public void platform(Receiver.PlatformFix fix) {
      platforms.add(fix);
    }

    @Override
    public void area(Receiver.AreaFix fix) {
      areas.add(fix);
    }

    @Override
    public void coverage(Receiver.CoverageFix fix) {
      coverages.add(fix);
    }

    @Override
    public void detection(Receiver.DetectionFix fix) {
      detections.add(fix);
    }

    @Override
    public void count(String name, long delta) {
      counts.merge(name, delta, Long::sum);
    }

    @Override
    public void freeText(String platformId, dev.emcc.plugins.gmti.format.FreeText text) {}

    @Override
    public void version(String version) {}
  }

  @Test
  void overUdpEveryPacketFitsADatagram() {
    var detections = new ArrayList<ChannelItem.Detection>();
    for (int i = 0; i < 8_000; i++) {
      detections.add(vehicle(Geodesy.direct(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), 90, 30_000 + i)));
    }
    var result = sender(65_535, 65_507, UNCLASSIFIED, new ClassificationLimit("NATO", "SECRET")).dwell(dwell(START, sector(), detections));
    assertThat(result.packets()).hasSizeGreaterThan(1).allSatisfy(p -> assertThat(p.length).isLessThanOrEqualTo(65_507));
    assertThat(dwells(decode(result)).stream().mapToInt(d -> d.reports().size()).sum()).isEqualTo(8_000);
  }

  // ------------------------------------------------------------------- criterion 24, the job area (T-168)

  /** Criterion 24's corners, clockwise: [15.10, 58.30], [15.50, 58.30], [15.50, 58.10], [15.10, 58.10] (latitude ≠ longitude). */
  static final List<Position> TASKED = List.of(Position.of(15.10, 58.30), Position.of(15.50, 58.30), Position.of(15.50, 58.10), Position.of(15.10, 58.10));

  /** A closed ring of these corners. */
  static Geometry.Polygon ring(List<Position> corners) {
    var ring = new ArrayList<>(corners);
    ring.add(corners.getFirst());
    return new Geometry.Polygon(List.of(ring));
  }

  static ChannelItem.SensorReport tasked(Instant time, Geometry.@Nullable Polygon jobArea) {
    return dwell(SENSOR, time, sector(), List.of(), spaning("Hawk 1").withJobArea(jobArea));
  }

  static void assertCorners(JobDefinition job, List<Position> corners) {
    assertThat(job.boundingArea()).hasSize(4);
    for (int i = 0; i < 4; i++) {
      assertThat(job.boundingArea().get(i).longitude()).as("corner %s, longitude", "ABCD".charAt(i)).isCloseTo(corners.get(i).longitude(), within(1e-6));
      assertThat(job.boundingArea().get(i).latitude()).as("corner %s, latitude", "ABCD".charAt(i)).isCloseTo(corners.get(i).latitude(), within(1e-6));
    }
  }

  @Test
  void criterion24_theJobAreaGoesAsJ6ToJ13_AToDInOrder_beforeTheFirstDwell() {
    Sender s = sender();
    var r = s.dwell(tasked(START, ring(TASKED)));
    List<Packet> packets = decode(r);
    assertThat(packets.getFirst().segments()).extracting(Segment::type).containsExactly(1, 5, 2);
    assertCorners(job(packets), TASKED);
    assertThat(r.notHeld()).doesNotContain("J6");
  }

  @Test
  void criterion24_aChangedJobAreaSendsAJobDefinitionWithTheNextDwell_noneIsTheBoxRoundTheDwellArea() {
    Sender s = sender();
    s.dwell(tasked(START, ring(TASKED)));
    assertThat(types(s.dwell(tasked(START.plusSeconds(10), ring(TASKED))))).as("the same area within 20 s").containsExactly(1, 2);
    List<Position> moved = List.of(Position.of(15.20, 58.40), Position.of(15.60, 58.40), Position.of(15.60, 58.20), Position.of(15.20, 58.20));
    List<Packet> changed = decode(s.dwell(tasked(START.plusSeconds(20), ring(moved))));
    assertThat(changed.getFirst().segments()).extracting(Segment::type).as("a changed area: the job definition again").containsExactly(1, 5, 2);
    assertCorners(job(changed), moved);
    List<Packet> none = decode(s.dwell(tasked(START.plusSeconds(25), null)));
    assertThat(none.getFirst().segments()).extracting(Segment::type).as("no job area any more: changed too").containsExactly(1, 5, 2);
    assertCorners(job(none), DwellArea.box(sector()));

    List<Packet> m5 = decode(sender().dwell(dwell(START, sector(), List.of())));
    assertCorners(job(m5), DwellArea.box(sector()));
  }

  // ------------------------------------------------------------------- criterion 29, the job area's order and shape (owner, PK A)

  @Test
  void criterion29_aCounterClockwiseJobAreaGoesClockwiseFromA() {
    // Criterion 24's corners counter-clockwise from [15.10, 58.30]: A stays, B to D go clockwise, as criterion 24
    List<Position> ccw = List.of(Position.of(15.10, 58.30), Position.of(15.10, 58.10), Position.of(15.50, 58.10), Position.of(15.50, 58.30));
    assertCorners(job(decode(sender().dwell(tasked(START, ring(ccw))))), TASKED);
    // The same rectangle counter-clockwise from its south-west corner (model rule 1's orientation): A is that corner
    List<Position> fromSouthWest = List.of(Position.of(15.10, 58.10), Position.of(15.50, 58.10), Position.of(15.50, 58.30), Position.of(15.10, 58.30));
    assertCorners(job(decode(sender().dwell(tasked(START, ring(fromSouthWest))))),
        List.of(fromSouthWest.get(0), fromSouthWest.get(3), fromSouthWest.get(2), fromSouthWest.get(1)));
  }

  @Test
  void criterion29_aFiveCornerAndACrossedFourCornerJobAreaGoAsTheBox_notHeldJ6OncePerSensorNotPerDwell() {
    List<Position> five = List.of(Position.of(15.10, 58.30), Position.of(15.50, 58.30), Position.of(15.60, 58.20), Position.of(15.50, 58.10),
        Position.of(15.10, 58.10));
    List<Position> fiveBox = List.of(Position.of(15.10, 58.30), Position.of(15.60, 58.30), Position.of(15.60, 58.10), Position.of(15.10, 58.10));
    // Crossed: A and C swapped with B and D, a bow-tie
    List<Position> crossed = List.of(Position.of(15.10, 58.30), Position.of(15.50, 58.10), Position.of(15.50, 58.30), Position.of(15.10, 58.10));
    // Concave: a dart, four corners, not convex
    List<Position> dart = List.of(Position.of(15.10, 58.30), Position.of(15.30, 58.20), Position.of(15.50, 58.30), Position.of(15.30, 58.10));
    for (var c : List.of(List.of(five, fiveBox), List.of(crossed, TASKED), List.of(dart, TASKED))) {
      List<Position> area = c.get(0);
      List<Position> box = c.get(1);
      Sender s = sender();
      var first = s.dwell(tasked(START, ring(area)));
      assertCorners(job(decode(first)), box);
      assertThat(first.notHeld()).as("%s corners: counted at the first dwell", area.size()).contains("J6");
      var next = s.dwell(tasked(START.plusSeconds(10), ring(area)));
      assertThat(next.notHeld()).as("not per dwell").doesNotContain("J6");
      var again = s.dwell(tasked(START.plusSeconds(30), ring(area)));
      assertCorners(job(decode(again)), box);
      assertThat(again.notHeld()).as("nor when the job definition goes again").doesNotContain("J6");
    }
    Sender s = sender();
    assertThat(s.dwell(tasked(START, ring(dart))).notHeld()).contains("J6");
    assertThat(s.dwell(tasked(START.plusSeconds(10), ring(five))).notHeld()).as("once for the sensor, also for another odd area").doesNotContain("J6");
  }

  // ------------------------------------------------------------------- criterion 26, a revisit's dwells (CR-0040)

  @Test
  void criterion26_aRevisitsDwellsGoAsD2D3AndD4OnTheLastOnly() {
    Sender s = sender();
    var detections = List.of(vehicle(fromPlatform(90, 60_000)));
    List<Dwell> sent = new ArrayList<>();
    for (var q : List.of(new ChannelItem.SensorReport.Sequence(7, 0, false), new ChannelItem.SensorReport.Sequence(7, 1, false),
        new ChannelItem.SensorReport.Sequence(7, 2, true))) {
      sent.addAll(dwells(decode(s.dwell(dwell(START.plusSeconds(q.dwell()), sector(), detections).withSequence(q)))));
    }
    assertThat(sent).extracting(Dwell::revisitIndex).containsExactly(7, 7, 7);
    assertThat(sent).extracting(Dwell::dwellIndex).containsExactly(0, 1, 2);
    assertThat(sent).extracting(Dwell::lastDwell).containsExactly(false, false, true);
  }

  @Test
  void criterion26_aRevisitOf70000SendsD2_4464_aReportWithoutASequenceIsNumberedAsInM5() {
    Sender s = sender();
    Dwell big = dwells(decode(s.dwell(dwell(START, sector(), List.of()).withSequence(new ChannelItem.SensorReport.Sequence(70_000, 0, true))))).getFirst();
    assertThat(big.revisitIndex()).isEqualTo(4_464);
    Dwell m5 = dwells(decode(s.dwell(dwell(START.plusSeconds(10), sector(), List.of())))).getFirst();
    assertThat(m5.revisitIndex()).as("the link's own count, from 0: a sequenced report does not count").isZero();
    assertThat(m5.dwellIndex()).isZero();
    assertThat(m5.lastDwell()).isTrue();
    assertThat(dwells(decode(s.dwell(dwell(START.plusSeconds(20), sector(), List.of())))).getFirst().revisitIndex()).isEqualTo(1);
  }

  @Test
  void theJobDefinitionGoesFirstAndThenEvery20Seconds() {
    Sender s = sender();
    assertThat(types(s.dwell(dwell(START, sector(), List.of())))).containsExactly(1, 5, 2);
    assertThat(types(s.dwell(dwell(START.plusSeconds(10), sector(), List.of())))).containsExactly(1, 2);
    assertThat(types(s.dwell(dwell(START.plusMillis(19_999), sector(), List.of())))).as("not before 20 s").containsExactly(1, 2);
    assertThat(types(s.dwell(dwell(START.plusSeconds(20), sector(), List.of())))).as("at 20 s").containsExactly(1, 5, 2);
    List<Dwell> fifth = dwells(decode(s.dwell(dwell(START.plusSeconds(30), sector(), List.of()))));
    assertThat(fifth.getFirst().revisitIndex()).as("one revisit per dwell").isEqualTo(4);
  }

  // ------------------------------------------------------------------- M9.1: the job definition at least every 20 s (owner ADQ B)

  /** The times of the dwells a job definition goes with, for one sensor sending a dwell every {@code interval} for {@code length}. */
  private static List<Instant> jobDefinitions(Duration interval, Duration length) {
    Sender s = sender();
    var times = new ArrayList<Instant>();
    for (Instant t = START; !t.isAfter(START.plus(length)); t = t.plus(interval)) {
      if (decode(s.dwell(dwell(t, sector(), List.of()))).stream().flatMap(p -> p.segments().stream()).anyMatch(seg -> seg.type() == 5)) {
        times.add(t);
      }
    }
    return times;
  }

  @Test
  void m91_aDwellEvery200MsOr4s_theJobDefinitionGoesAtLeastEvery20Seconds_noGapReaches30Seconds() {
    assertThat(Sender.JOB_EVERY).isEqualTo(Duration.ofSeconds(20));
    Duration length = Duration.ofSeconds(65);
    // The MCA's two rates, and 3 s, which does not divide 20 s: its gaps are 21 s
    for (Duration interval : List.of(Duration.ofMillis(200), Duration.ofSeconds(4), Duration.ofSeconds(3))) {
      List<Instant> jobs = jobDefinitions(interval, length);
      assertThat(jobs.getFirst()).as("%s: with the first dwell", interval).isEqualTo(START);
      assertThat(jobs).as("%s: about 0, 20, 40 and 60 s", interval).hasSize(4);
      for (int i = 1; i < jobs.size(); i++) {
        Duration gap = Duration.between(jobs.get(i - 1), jobs.get(i));
        assertThat(gap).as("%s: gap %d, at most 20 s and one dwell", interval, i).isBetween(Duration.ofSeconds(20), Duration.ofSeconds(20).plus(interval));
        assertThat(gap).as("%s: gap %d, under the receivers' 30 s", interval, i).isLessThan(Duration.ofSeconds(30));
      }
      Instant lastDwell = START.plus(interval.multipliedBy(length.dividedBy(interval)));
      assertThat(Duration.between(jobs.getLast(), lastDwell)).as("%s: none missing at the end", interval).isLessThan(Duration.ofSeconds(20));
    }
  }

  @Test
  void aDwellBeyondWhatTheDwellTimeCountsMovesTheReferenceDay() {
    Sender s = sender();
    Packet first = decode(s.dwell(dwell(START.plusSeconds(86_400 + 60), sector(), List.of()))).getFirst();
    assertThat(((Mission) first.segments().getFirst()).referenceDay()).as("the link's day, D6 past a day").isEqualTo(LocalDate.of(2026, 11, 7));
    assertThat(dwells(List.of(first)).getFirst().time()).isEqualTo(86_400_000L + 36_060_000L);

    Instant later = Instant.parse("2027-03-01T08:00:00Z"); // a scenario far from the link's start
    Packet moved = decode(s.dwell(dwell(later, sector(), List.of()))).getFirst();
    assertThat(((Mission) moved.segments().getFirst()).referenceDay()).isEqualTo(LocalDate.of(2027, 3, 1));
    assertThat(dwells(List.of(moved)).getFirst().time()).isEqualTo(28_800_000L);
    Packet earlier = decode(s.dwell(dwell(START.minusSeconds(3_600), sector(), List.of()))).getFirst();
    assertThat(((Mission) earlier.segments().getFirst()).referenceDay()).isEqualTo(LocalDate.of(2026, 11, 7));
  }

  private static List<Integer> types(Sender.Result r) {
    return decode(r).getFirst().segments().stream().map(Segment::type).toList();
  }

  @Test
  void anEmptyDwellGetsTheLinksLabel_aDetectionAboveTheHighestIsLeftOut() {
    Sender s = sender(120, Decoder.MAX_PACKET, RESTRICTED, new ClassificationLimit("NATO", "CONFIDENTIAL"));
    assertThat(decode(s.dwell(dwell(START, sector(), List.of()))).getFirst().header().classification()).as("RESTRICTED").isEqualTo(4);

    Position at = Geodesy.direct(Position.of(PLATFORM.longitude(), PLATFORM.latitude()), 80, 50_000);
    var conf = detection(at, "10061500310000000000", null, null, SecurityLabel.of("NATO", "CONFIDENTIAL"));
    var secret = detection(at, "10061500310000000000", null, null, SECRET);
    Sender.Result r = s.dwell(dwell(START.plusSeconds(1), sector(), List.of(conf, secret)));
    assertThat(r.aboveHighest()).isEqualTo(1);
    assertThat(r.detections()).isEqualTo(1);
    assertThat(decode(r).getFirst().header().classification()).as("the highest sent: CONFIDENTIAL").isEqualTo(3);
    assertThat(dwells(decode(r)).getFirst().reports()).hasSize(1);
  }

  @Test
  void exerciseAndNationalityAreTheLinks() {
    var s = new Sender(new Sender.Settings("SE", true, 120, Decoder.MAX_PACKET, UNCLASSIFIED, new ClassificationLimit("NATO", "SECRET"),
        LabelRule.NATO), Classifications.nato(), START);
    Packet p = decode(s.dwell(dwell(START, sector(), List.of()))).getFirst();
    assertThat(p.header().exercise()).isEqualTo(129);
    assertThat(p.header().nationality()).isEqualTo("SE");
  }

  @Test
  void theRadialSpeedIsAlongTheLineOfSightAwayFromTheSensorPositive() {
    Position base = Position.of(PLATFORM.longitude(), PLATFORM.latitude());
    Position east = Geodesy.direct(base, 90, 50_000);
    double bearing = Geodesy.inverse(base, east).initialAzimuth();
    var away = detection(east, "10061500310000000000", 10.0, bearing, UNCLASSIFIED);
    var towards = detection(east, "10061500310000000000", 10.0, (bearing + 180) % 360, UNCLASSIFIED);
    var across = detection(east, "10061500310000000000", 10.0, (bearing + 90) % 360, UNCLASSIFIED);
    List<Dwell> segments = dwells(decode(sender().dwell(dwell(START, sector(), List.of(away, towards, across)))));
    List<TargetReport> reports = segments.stream().flatMap(d -> d.reports().stream()).toList();
    assertThat(reports.get(0).radialVelocity()).isCloseTo(10.0, within(0.01));
    assertThat(reports.get(1).radialVelocity()).isCloseTo(-10.0, within(0.01));
    assertThat(reports.get(2).radialVelocity()).isCloseTo(0.0, within(0.01));
  }

  @Test
  void reportsWithAndWithoutHeightGoInSegmentsOfTheirOwn() {
    Position base = Position.of(PLATFORM.longitude(), PLATFORM.latitude());
    Position low = Geodesy.direct(base, 90, 40_000);
    var withHeight = vehicle(Position.of(low.longitude(), low.latitude(), 25.0));
    var without = vehicle(low);
    List<Dwell> segments = dwells(decode(sender().dwell(dwell(START, sector(), List.of(withHeight, without)))));
    assertThat(segments).hasSize(2);
    assertThat(segments.get(0).reports().getFirst().height()).isEqualTo(25);
    assertThat(segments.get(1).reports().getFirst().height()).isNull();
  }

  @Test
  void twoSensorsWhoseIdsShareTheirFirstDigitsGetTwoPlatformIds() {
    Sender s = sender();
    var other = UUID.fromString("0123abcd-1111-0000-0000-000000000002");
    String a = s.dwell(dwell(START, sector(), List.of())).platformId();
    String b = s.dwell(new ChannelItem.SensorReport(other, PLATFORM, START, sector(), List.of())).platformId();
    assertThat(a).isEqualTo("SIM0123ABC");
    assertThat(b).isNotEqualTo(a).hasSize(10).startsWith("SIM");
    assertThat(decode(s.dwell(new ChannelItem.SensorReport(other, PLATFORM, START, sector(), List.of()))).getFirst().header().jobId())
        .as("one job per sensor").isEqualTo(2);
  }

  @Test
  void theSimulatedClassComesFromTheSymbol() {
    assertThat(SimulatedClass.of(new Symbol(SymbolStandard.APP_6D, "10061500330000000000", null))).as("tracked").isEqualTo(129);
    assertThat(SimulatedClass.of(new Symbol(SymbolStandard.APP_6D, "10061500001202000000", null))).as("tank").isEqualTo(129);
    assertThat(SimulatedClass.of(new Symbol(SymbolStandard.APP_6D, "10061500001401000000", null))).as("utility vehicle").isEqualTo(130);
    assertThat(SimulatedClass.of(new Symbol(SymbolStandard.APP_6D, "10061000001211000000", null))).as("infantry").isEqualTo(130);
    assertThat(SimulatedClass.of(new Symbol(SymbolStandard.APP_6D, "10060100001102000000", null))).as("rotary").isEqualTo(131);
    assertThat(SimulatedClass.of(new Symbol(SymbolStandard.APP_6D, "10060100001101000000", null))).as("fixed").isEqualTo(132);
    assertThat(SimulatedClass.of(new Symbol(SymbolStandard.APP_6D, "10063000001401000000", null))).as("merchant ship").isEqualTo(134);
    assertThat(SimulatedClass.of(new Symbol(SymbolStandard.VESSEL, "0170", null))).isEqualTo(134);
    assertThat(SimulatedClass.of(new Symbol(SymbolStandard.APP_6D, "10062700001100000000", null))).as("dismount").isEqualTo(137);
    assertThat(SimulatedClass.of(new Symbol(SymbolStandard.APP_6D, "10064000000000000000", null))).isEqualTo(255);
    assertThat(SimulatedClass.of(null)).isEqualTo(255);
  }
}
