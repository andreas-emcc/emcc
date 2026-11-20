package dev.emcc.plugins.gmti.in;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.gmti.format.Decoder;
import dev.emcc.plugins.gmti.format.Dwell;
import dev.emcc.plugins.gmti.format.Encoder;
import dev.emcc.plugins.gmti.format.FreeText;
import dev.emcc.plugins.gmti.format.JobDefinition;
import dev.emcc.plugins.gmti.format.Mission;
import dev.emcc.plugins.gmti.format.Packet;
import dev.emcc.plugins.gmti.format.PacketHeader;
import dev.emcc.plugins.gmti.format.PlatformLocation;
import dev.emcc.plugins.gmti.format.Segment;
import dev.emcc.plugins.gmti.format.Skipped;
import dev.emcc.plugins.gmti.format.TargetReport;
import dev.emcc.plugins.gmti.in.Receiver.AreaFix;
import dev.emcc.plugins.gmti.in.Receiver.CoverageFix;
import dev.emcc.plugins.gmti.in.Receiver.DetectionFix;
import dev.emcc.plugins.gmti.in.Receiver.PlatformFix;
import dev.emcc.plugins.gmti.in.Receiver.TimeMode;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Position;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.junit.jupiter.api.Test;

/** The state across packets (brief sections 3 and 4): criteria 3, 4 and 6, and the rules of the waiting, the cap and the job's end. */
class ReceiverTest {

  static final LocalDate DAY = LocalDate.of(2026, 1, 12);
  static final Instant MIDNIGHT = Instant.parse("2026-01-12T00:00:00Z");
  /** A sensor over the sea: latitude ≠ longitude. */
  static final Position SENSOR = Position.of(19.7, 55.08);

  /** Collects what the receiver makes. */
  static final class Sink implements Receiver.Sink {
    final List<PlatformFix> platforms = new ArrayList<>();
    final List<AreaFix> areas = new ArrayList<>();
    final List<CoverageFix> coverages = new ArrayList<>();
    final List<DetectionFix> detections = new ArrayList<>();
    final Map<String, Long> counts = new TreeMap<>();
    final List<String> versions = new ArrayList<>();
    final List<FreeText> texts = new ArrayList<>();

    @Override
    public void platform(PlatformFix fix) {
      platforms.add(fix);
    }

    @Override
    public void area(AreaFix fix) {
      areas.add(fix);
    }

    @Override
    public void coverage(CoverageFix fix) {
      coverages.add(fix);
    }

    @Override
    public void detection(DetectionFix fix) {
      detections.add(fix);
    }

    @Override
    public void count(String name, long delta) {
      counts.merge(name, delta, Long::sum);
    }

    @Override
    public void freeText(String platformId, FreeText text) {
      texts.add(text);
    }

    @Override
    public void version(String version) {
      versions.add(version);
    }
  }

  final Sink sink = new Sink();
  final Receiver receiver = new Receiver(1_000, TimeMode.AS_RECORDED);
  final Instant now = Instant.parse("2026-11-06T12:00:00Z");

  static PacketHeader header(String version, long missionId, long jobId) {
    return new PacketHeader(version, "XN", 5, "XN", 0, 129, "PLATFORM01", missionId, jobId);
  }

  /** Through the codec, as a link receives it. */
  static Packet packet(PacketHeader h, Segment... segments) {
    return Decoder.decode(Encoder.packet(h, List.of(segments))).packet();
  }

  static Mission mission(LocalDate day) {
    return Mission.on(day, 7, "TEST", "");
  }

  /** A dwell from SENSOR at {@code millis}, its area 30 km east. */
  static Dwell.Builder dwell(long millis) {
    Position centre = Geodesy.direct(SENSOR, 90.0, 30_000);
    return Dwell.of(0, 0, millis, SENSOR.latitude(), SENSOR.longitude(), 8_500, centre.latitude(), centre.longitude(), 5.0, 7.5);
  }

  void receive(Segment... segments) {
    receiver.packet(packet(header("30", 1, 7), segments), now, sink);
  }

  @Test
  void criterion3_aDwellBeforeItsMissionWaitsAndIsPlacedOnTheRightDay() {
    receive(dwell(45_296_789).build());
    assertThat(sink.platforms).isEmpty();
    assertThat(receiver.waiting()).isEqualTo(1);

    receive(mission(DAY));
    assertThat(receiver.waiting()).isZero();
    assertThat(sink.platforms).singleElement().satisfies(p -> {
      assertThat(p.time()).as("12:34:56.789 on the reference day").isEqualTo(Instant.parse("2026-01-12T12:34:56.789Z"));
      assertThat(p.position().longitude()).isCloseTo(19.7, within(1e-6));
      assertThat(p.position().latitude()).isCloseTo(55.08, within(1e-6));
      assertThat(p.position().altitude()).isEqualTo(8_500.0);
    });
    assertThat(sink.counts).doesNotContainKey("dropped: no mission");
  }

  @Test
  void criterion3_aDwellTimePastADayIsOnTheNextDay() {
    receive(mission(DAY), dwell(117_935_200).build());
    assertThat(sink.platforms.getFirst().time()).as("Annex C-3's example").isEqualTo(Instant.parse("2026-01-13T08:45:35.200Z"));
  }

  @Test
  void criterion3_aNewMissionChangesTheDayForLaterDwellsOnly() {
    receive(mission(DAY), dwell(1_000).build());
    receive(mission(DAY.plusDays(1)), dwell(2_000).build());
    assertThat(sink.platforms).extracting(PlatformFix::time)
        .containsExactly(Instant.parse("2026-01-12T00:00:01Z"), Instant.parse("2026-01-13T00:00:02Z"));
  }

  @Test
  void theReferenceDayIsPerPlatformAndMission() {
    receive(mission(DAY));
    receiver.packet(packet(header("30", 2, 7), dwell(1_000).build()), now, sink);
    assertThat(sink.platforms).as("mission 2 has no mission segment yet").isEmpty();
    receiver.packet(packet(header("30", 2, 7), mission(DAY.plusDays(3))), now, sink);
    assertThat(sink.platforms.getFirst().time()).isEqualTo(Instant.parse("2026-01-15T00:00:01Z"));
  }

  @Test
  void criterion3_asReceivedShiftsTheLinksTimesSoItsNewestDwellIsNow() {
    var received = new Receiver(1_000, TimeMode.AS_RECEIVED);
    received.packet(packet(header("30", 1, 7), mission(DAY), dwell(10_000).build()), now, sink);
    received.packet(packet(header("30", 1, 7), dwell(4_000).build()), now.plusSeconds(1), sink);
    received.packet(packet(header("30", 1, 7), dwell(20_000).build()), now.plusSeconds(2), sink);
    assertThat(sink.platforms).extracting(PlatformFix::time).containsExactly(
        now, now.minusSeconds(6), now.plusSeconds(2));
  }

  @Test
  void aDwellThatWaitsTooLongIsDroppedAndCounted() {
    receive(dwell(1_000).build());
    receiver.tick(now.plus(Receiver.WAIT).minusMillis(1), sink);
    assertThat(receiver.waiting()).isEqualTo(1);
    receiver.tick(now.plus(Receiver.WAIT), sink);
    assertThat(receiver.waiting()).isZero();
    assertThat(sink.counts).containsEntry("dropped: no mission", 1L);
    receive(mission(DAY));
    assertThat(sink.platforms).isEmpty();
  }

  @Test
  void atMost100WaitPerPlatform() {
    for (int i = 0; i < 105; i++) {
      receive(dwell(i).build());
    }
    assertThat(receiver.waiting()).isEqualTo(Receiver.MAX_WAITING);
    assertThat(sink.counts).containsEntry("dropped: no mission", 5L);
    receive(mission(DAY));
    assertThat(sink.platforms.getFirst().time()).as("the oldest went").isEqualTo(MIDNIGHT.plusMillis(5));
  }

  @Test
  void criterion4_theAreaIsAnArcBandRoundTheSensor() {
    receive(mission(DAY), dwell(1_000).build());
    Geometry area = sink.areas.getFirst().area();
    assertThat(area).isInstanceOf(Geometry.ArcBand.class);
    var band = (Geometry.ArcBand) area;
    assertThat(band.center().longitude()).isCloseTo(19.7, within(1e-6));
    assertThat(band.center().latitude()).isCloseTo(55.08, within(1e-6));
    assertThat(band.innerRadius()).isCloseTo(25_000, within(1.0));
    assertThat(band.outerRadius()).isCloseTo(35_000, within(1.0));
    assertThat(band.startBearing()).isCloseTo(82.5, within(0.01));
    assertThat(band.endBearing()).isCloseTo(97.5, within(0.01));
  }

  @Test
  void criterion4_aHalfAngleOf180IsACircleAndAZeroSizeWritesNoArea() {
    Position centre = Geodesy.direct(SENSOR, 90.0, 30_000);
    receive(mission(DAY),
        Dwell.of(0, 0, 1, SENSOR.latitude(), SENSOR.longitude(), 8_500, centre.latitude(), centre.longitude(), 5.0, 180.0).build());
    assertThat(sink.areas.getLast().area()).isInstanceOfSatisfying(Geometry.Circle.class, c -> assertThat(c.radius()).isCloseTo(35_000, within(1.0)));

    receive(Dwell.of(0, 0, 2, SENSOR.latitude(), SENSOR.longitude(), 8_500, centre.latitude(), centre.longitude(), 0.0, 7.5).build());
    assertThat(sink.areas).as("D26 0: that dwell's area is not written (A4; M8, T-195)").hasSize(1);
    receive(Dwell.of(0, 0, 3, SENSOR.latitude(), SENSOR.longitude(), 8_500, centre.latitude(), centre.longitude(), 5.0, 0.0).build());
    assertThat(sink.areas).as("D27 0: nor this").hasSize(1);
    assertThat(sink.platforms).as("the platform moves with each").hasSize(3);
  }

  @Test
  void criterion4_thePlatformMovesWithEachDwellAndPlatformLocation() {
    receive(mission(DAY), dwell(1_000).sensorMotion(271.5, 200.0, 0.0).build());
    receiver.packet(packet(header("30", 1, 0), new PlatformLocation(2_000, -33.9249, 18.4241, 10_668, 45.0, 222.0, 0.0)), now, sink);
    receive(dwell(3_000).sensorMotion(271.5, 200.0, 0.0).platformAttitude(270.0, 0.0, 0.0).build());
    assertThat(sink.platforms).hasSize(3);
    assertThat(sink.platforms.get(0).direction()).as("D15 without D21").isCloseTo(271.5, within(0.01));
    assertThat(sink.platforms.get(0).speed()).isEqualTo(200.0);
    PlatformFix located = sink.platforms.get(1);
    assertThat(located.position().latitude()).isCloseTo(-33.9249, within(1e-6));
    assertThat(located.position().longitude()).isCloseTo(18.4241, within(1e-6));
    assertThat(located.direction()).isCloseTo(45.0, within(0.01));
    assertThat(located.speed()).isEqualTo(222.0);
    assertThat(located.time()).isEqualTo(MIDNIGHT.plusMillis(2_000));
    assertThat(sink.areas).as("a platform location changes no area").hasSize(2);
    assertThat(sink.platforms.get(2).direction()).as("D21 before D15").isCloseTo(270.0, within(0.01));
  }

  @Test
  void anEmptyDwellMovesThePlatformAndTheAreaOnly() {
    receive(mission(DAY), dwell(1_000).build());
    assertThat(sink.platforms).hasSize(1);
    assertThat(sink.areas).hasSize(1);
    assertThat(sink.detections).isEmpty();
  }

  @Test
  void criterion6_theCapCountsAcrossTheSegmentsOfOneDwell() {
    var capped = new Receiver(120, TimeMode.AS_RECORDED);
    List<TargetReport> first = reports(0, 300);
    List<TargetReport> second = reports(300, 200);
    capped.packet(packet(header("30", 1, 7), mission(DAY), dwell(1_000).reports(first).build(), dwell(1_000).reports(second).build()), now, sink);
    assertThat(sink.detections).hasSize(120);
    assertThat(sink.counts).containsEntry("skipped: over cap", 380L);

    capped.packet(packet(header("30", 1, 7), dwell(2_000).reports(reports(0, 10)).build()), now, sink);
    assertThat(sink.detections).as("another dwell has its own cap").hasSize(130);

    capped.settings(1_000, TimeMode.AS_RECORDED);
    capped.packet(packet(header("30", 1, 7), dwell(3_000).reports(reports(0, 500)).build()), now, sink);
    assertThat(sink.detections).as("a changed cap applies at once").hasSize(630);
  }

  @Test
  void criterion5_theSameReportTwiceHasOneKey_andDwellsThatShareIndicesDoNot() {
    TargetReport r = TargetReport.at(55.0, 19.9).index(3).build();
    TargetReport unindexed = TargetReport.at(55.01, 19.91).build();
    receive(mission(DAY), dwell(1_000).report(r).build());
    receive(dwell(1_000).report(r).build());
    receive(dwell(9_000).report(r).build()); // the same D2, D3 later (AFSERS, owner Q3)
    receiver.packet(packet(header("30", 1, 8), dwell(1_000).report(r).build()), now, sink); // another job
    receive(dwell(1_000).report(unindexed).build());
    assertThat(sink.detections).extracting(DetectionFix::key).containsExactly(
        "PLATFORM01/7/1768176001000/0/0/3",
        "PLATFORM01/7/1768176001000/0/0/3",
        "PLATFORM01/7/1768176009000/0/0/3",
        "PLATFORM01/8/1768176001000/0/0/3",
        "PLATFORM01/7/1768176001000/0/0/19.9100000,55.0100000");
  }

  @Test
  void theEndOfAJobKeepsItsAreas_theyExpire() {
    receive(mission(DAY), CodecJobs.job(7, 1), dwell(1_000).build());
    receive(CodecJobs.job(9, JobDefinition.ENDED));
    receive(CodecJobs.job(7, JobDefinition.ENDED));
    assertThat(sink.areas).as("M8, T-195: J5 255 removes the coverage only").hasSize(1);
  }

  @Test
  void theJobDefinitionGoesWithItsDwells() {
    receive(mission(DAY), CodecJobs.job(7, 1), dwell(1_000).report(TargetReport.at(55.0, 19.9).build()).build());
    assertThat(sink.platforms.getFirst().job()).isNotNull();
    assertThat(sink.detections.getFirst().job().jobId()).isEqualTo(7);
  }

  @Test
  void criterion8_skippedSegmentsAreCountedByType_aFreeTextToo() {
    receive(new Skipped(128, 25), new Skipped(12, 30), new Skipped(12, 30), new FreeText("OPS", "ALL", "hello"), mission(DAY));
    assertThat(sink.counts).containsEntry("skipped: segment 128", 1L).containsEntry("skipped: segment 12", 2L)
        .containsEntry("skipped: segment 6", 1L);
    assertThat(sink.texts).extracting(FreeText::text).containsExactly("hello");
  }

  @Test
  void aVersionGmtiDoesNotWriteIsReportedOncePerLink_editions3And4AreNot() {
    receive(mission(DAY));
    receive(mission(DAY));
    receiver.packet(packet(header("21", 1, 7), mission(DAY)), now, sink);
    receiver.packet(packet(header("21", 1, 7), mission(DAY)), now, sink);
    receiver.packet(packet(header("41", 1, 7), mission(DAY)), now, sink);
    assertThat(sink.versions).as("M9.1: \"30\" (this test's own) and \"41\" are the editions gmti writes").containsExactly("21");
  }

  @Test
  void aMissionWithoutADateIsAValueOutOfRange() {
    receive(new Mission("", "", 7, "", 2023, 13, 40));
    assertThat(sink.counts).containsEntry("value out of range", 1L);
  }

  static List<TargetReport> reports(int from, int n) {
    var list = new ArrayList<TargetReport>();
    for (int i = from; i < from + n; i++) {
      list.add(TargetReport.at(55.0 + i * 1e-4, 19.9 + i * 1e-4).index(i).build());
    }
    return list;
  }

  /** Job definitions for the tests. */
  static final class CodecJobs {
    static JobDefinition job(long id, int priority) {
      return job(id, priority, List.of(Position.of(19.0, 55.5), Position.of(20.5, 55.5), Position.of(20.5, 54.5), Position.of(19.0, 54.5)));
    }

    /** A job with its bounding area's corners A to D, longitude first. */
    static JobDefinition job(long id, int priority, List<Position> box) {
      return new JobDefinition(id, 255, "SIM", 0, priority, box, 1, 100, 65_535, 65_535, 65_535, 255, 65_535, 2_000, 180.0, 50, 20, 90,
          255, 0, 0);
    }
  }

  @Test
  void durationsAreWhatTheBriefSays() {
    assertThat(Receiver.WAIT).isEqualTo(Duration.ofSeconds(10));
    assertThat(Receiver.MAX_WAITING).isEqualTo(100);
    assertThat(Receiver.COVERAGE_REFRESH).as("criterion 21").isEqualTo(Duration.ofSeconds(30));
  }

  // ------------------------------------------------------------------- criterion 27, every dwell its own area (M8, T-195)

  /** Dwell {@code index} of revisit {@code revisit}, at {@code 10 × revisit + index} s, its area 30 km east of SENSOR; {@code last} sets D4. */
  static Dwell revisitDwell(int revisit, int index, boolean last) {
    return dwellAt(1_000L * (revisit * 10 + index), revisit, index, last);
  }

  static Dwell dwellAt(long millis, int revisit, int index, boolean last) {
    Position centre = Geodesy.direct(SENSOR, 90.0, 30_000);
    return Dwell.of(revisit, index, millis, SENSOR.latitude(), SENSOR.longitude(), 8_500, centre.latitude(), centre.longitude(), 5.0, 7.5)
        .lastDwell(last).build();
  }

  @Test
  void criterion27_twoRevisitsFiveDwellsGiveFiveAreas_noneRemovedByALaterDwellARevisitOrTheJobsEnd() {
    receive(mission(DAY), CodecJobs.job(7, 1), revisitDwell(4, 0, false), revisitDwell(4, 1, false), revisitDwell(4, 2, true));
    receive(revisitDwell(5, 0, false), revisitDwell(5, 1, true));
    receive(CodecJobs.job(7, JobDefinition.ENDED));
    assertThat(sink.areas).as("one per dwell, in order; none removed (no fix without an area)")
        .extracting(f -> f.revisitIndex() + "." + f.dwellIndex()).containsExactly("4.0", "4.1", "4.2", "5.0", "5.1");
    assertThat(sink.areas).extracting(AreaFix::dwellTime).as("each its dwell's time, as recorded, UTC ms")
        .containsExactly(MIDNIGHT.plusSeconds(40).toEpochMilli(), MIDNIGHT.plusSeconds(41).toEpochMilli(), MIDNIGHT.plusSeconds(42).toEpochMilli(),
            MIDNIGHT.plusSeconds(50).toEpochMilli(), MIDNIGHT.plusSeconds(51).toEpochMilli());
    assertThat(sink.areas).extracting(f -> Mapper.areaId("vista", f)).doesNotHaveDuplicates();
  }

  @Test
  void criterion27_theSameDwellTwiceIsOneKey_theSameD2AndD3AtAnotherTimeAnother() {
    receive(mission(DAY), revisitDwell(4, 1, false), revisitDwell(4, 1, false));
    // A sender that keeps D2 (VISTA sends 0 for every dwell), or a revisit number that wrapped at 65 535: the time tells them apart.
    receive(dwellAt(90_000, 4, 1, false));
    assertThat(sink.areas).extracting(f -> Mapper.areaId("vista", f)).containsExactly(
        "vista/PLATFORM01/area/" + MIDNIGHT.plusSeconds(41).toEpochMilli() + "/4/1",
        "vista/PLATFORM01/area/" + MIDNIGHT.plusSeconds(41).toEpochMilli() + "/4/1",
        "vista/PLATFORM01/area/" + MIDNIGHT.plusSeconds(90).toEpochMilli() + "/4/1");
  }

  @Test
  void criterion27_asReceivedTheKeyKeepsTheRecordedTime() {
    var shifted = new Receiver(1_000, Receiver.TimeMode.AS_RECEIVED);
    var out = new Sink();
    shifted.packet(packet(header("30", 1, 7), mission(DAY), revisitDwell(4, 0, false)), now, out);
    shifted.packet(packet(header("30", 1, 7), revisitDwell(4, 0, false)), now.plusSeconds(30), out);
    assertThat(out.areas).hasSize(2);
    assertThat(out.areas.get(0).time()).as("drawn at the shifted time").isNotEqualTo(MIDNIGHT.plusSeconds(40));
    assertThat(out.areas).extracting(AreaFix::dwellTime).as("known by the recorded one, so a repeat is the same area")
        .containsOnly(MIDNIGHT.plusSeconds(40).toEpochMilli());
  }

  // ------------------------------------------------------------------- criterion 21, the coverage (T-158)

  /** Criterion 21's corners: A [15.10, 58.30], B [15.50, 58.30], C [15.50, 58.10], D [15.10, 58.10], clockwise. */
  static final List<Position> BOX = List.of(Position.of(15.10, 58.30), Position.of(15.50, 58.30), Position.of(15.50, 58.10), Position.of(15.10, 58.10));

  void receiveAt(Instant at, Segment... segments) {
    receiver.packet(packet(header("30", 1, 7), segments), at, sink);
  }

  static void assertBox(CoverageFix fix, List<Position> corners) {
    List<Position> ring = fix.coverage().rings().getFirst();
    assertThat(ring).hasSize(5);
    for (int i = 0; i < 5; i++) {
      assertThat(ring.get(i).longitude()).as("corner %d, longitude first", i).isCloseTo(corners.get(i % 4).longitude(), within(1e-6));
      assertThat(ring.get(i).latitude()).as("corner %d", i).isCloseTo(corners.get(i % 4).latitude(), within(1e-6));
    }
  }

  @Test
  void criterion21_aJobDefinitionGivesOneCoverageOfItsCorners() {
    receive(mission(DAY), CodecJobs.job(7, 1, BOX));
    assertThat(sink.coverages).singleElement().satisfies(c -> {
      assertBox(c, BOX);
      assertThat(c.platformId()).isEqualTo("PLATFORM01");
      assertThat(c.jobId()).isEqualTo(7);
      assertThat(c.time()).as("before its first dwell: the arrival").isEqualTo(now);
    });
  }

  @Test
  void criterion21_theSameCornersWithin30sWriteNothing_after30sADwellChangesOnlyItsTime() {
    receiveAt(now, mission(DAY), CodecJobs.job(7, 1, BOX), dwell(1_000).build());
    receiveAt(now.plusSeconds(10), CodecJobs.job(7, 1, BOX), dwell(11_000).build());
    receiveAt(now.plusSeconds(29), dwell(30_000).build());
    assertThat(sink.coverages).as("within 30 s: nothing").hasSize(1);
    receiveAt(now.plusSeconds(31), dwell(32_000).build());
    assertThat(sink.coverages).hasSize(2);
    assertBox(sink.coverages.getLast(), BOX);
    assertThat(sink.coverages.getLast().time()).as("the dwell's time").isEqualTo(MIDNIGHT.plusMillis(32_000));
    receiveAt(now.plusSeconds(45), CodecJobs.job(7, 1, BOX));
    assertThat(sink.coverages).as("30 s from the last write").hasSize(2);
    receiveAt(now.plusSeconds(62), CodecJobs.job(7, 1, BOX));
    assertThat(sink.coverages).as("a job definition refreshes it too").hasSize(3);
    assertThat(sink.coverages.getLast().time()).as("its latest dwell's time").isEqualTo(MIDNIGHT.plusMillis(32_000));
  }

  @Test
  void criterion21_newCornersReplaceIt_fourEqualCornersDeleteIt() {
    receive(mission(DAY), CodecJobs.job(7, 1, BOX));
    List<Position> moved = List.of(Position.of(15.20, 58.40), Position.of(15.60, 58.40), Position.of(15.60, 58.20), Position.of(15.20, 58.20));
    receive(CodecJobs.job(7, 1, moved));
    assertThat(sink.coverages).hasSize(2);
    assertBox(sink.coverages.getLast(), moved);
    Position a = Position.of(15.10, 58.30);
    receive(CodecJobs.job(7, 1, List.of(a, a, a, a)));
    assertThat(sink.coverages).hasSize(3);
    assertThat(sink.coverages.getLast().coverage()).as("no area: deleted").isNull();
    receive(CodecJobs.job(7, 1, List.of(a, a, a, a)), dwell(1_000).build());
    assertThat(sink.coverages).as("deleted once").hasSize(3);
  }

  @Test
  void criterion21_cornersOnOneLineEncloseNoArea() {
    List<Position> line = List.of(Position.of(15.10, 58.30), Position.of(15.20, 58.30), Position.of(15.30, 58.30), Position.of(15.50, 58.30));
    receive(mission(DAY), CodecJobs.job(7, 1, line));
    assertThat(sink.coverages).isEmpty();
    assertThat(CoverageShape.of(line)).isNull();
    assertThat(CoverageShape.of(BOX)).isNotNull();
  }

  @Test
  void criterion21_theEndOfItsJobDeletesIt_anotherJobsEndDoesNot() {
    receive(mission(DAY), CodecJobs.job(7, 1, BOX), dwell(1_000).build());
    receive(CodecJobs.job(9, JobDefinition.ENDED));
    assertThat(sink.coverages).hasSize(1);
    receive(CodecJobs.job(7, JobDefinition.ENDED));
    assertThat(sink.coverages).hasSize(2);
    assertThat(sink.coverages.getLast().coverage()).isNull();
    receive(dwell(2_000).build());
    assertThat(sink.coverages).as("gone until the next job definition").hasSize(2);
  }

  @Test
  void criterion21_withCoverageOffNoneIsWritten_andADrawnOneIsDeleted() {
    var off = new Receiver(1_000, TimeMode.AS_RECORDED, false);
    off.packet(packet(header("30", 1, 7), mission(DAY), CodecJobs.job(7, 1, BOX), dwell(1_000).build()), now, sink);
    assertThat(sink.coverages).isEmpty();
    assertThat(sink.areas).as("the dwell area as before").hasSize(1);

    receive(mission(DAY), CodecJobs.job(7, 1, BOX));
    assertThat(sink.coverages).hasSize(1);
    receiver.settings(1_000, TimeMode.AS_RECORDED, false, sink);
    assertThat(sink.coverages).hasSize(2);
    assertThat(sink.coverages.getLast().coverage()).as("switched off: deleted").isNull();
    receiveAt(now.plusSeconds(60), CodecJobs.job(7, 1, BOX), dwell(1_000).build());
    assertThat(sink.coverages).hasSize(2);
    receiver.settings(1_000, TimeMode.AS_RECORDED, true, sink);
    receiveAt(now.plusSeconds(61), dwell(2_000).build());
    assertThat(sink.coverages).as("switched on: drawn at the next dwell").hasSize(3);
    assertBox(sink.coverages.getLast(), BOX);
  }

  @Test
  void criterion21_aBoxAcrossTheAntimeridianIsAnArea() {
    List<Position> across = List.of(Position.of(179.8, -16.0), Position.of(-179.8, -16.0), Position.of(-179.8, -16.4), Position.of(179.8, -16.4));
    assertThat(CoverageShape.of(across)).isNotNull();
  }
}
