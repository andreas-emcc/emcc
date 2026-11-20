package dev.emcc.plugins.gmti.in;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.gmti.format.JobDefinition;
import dev.emcc.plugins.gmti.format.PacketHeader;
import dev.emcc.plugins.gmti.format.TargetReport;
import dev.emcc.plugins.gmti.in.Receiver.TimeMode;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.DisplayClass;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Meta;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Relation;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Style;
import dev.emcc.sdk.model.Symbol;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/** The mapping to map objects (brief section 3): criteria 5 and 7, the class symbols (Q8), and updates that keep what others wrote. */
class MapperTest {

  static final SecurityLabel LINK = SecurityLabel.of("NATO", "RESTRICTED");
  static final UUID LAYER = UUID.fromString("00000000-0000-0000-0000-00000000aaaa");
  static final Mapper.Placement PLACEMENT = new Mapper.Placement("vista", LAYER, SecurityLabel.of("NATO", "UNCLASSIFIED"), StandardIdentity.UNKNOWN, null);

  final ReceiverTest.Sink sink = new ReceiverTest.Sink();
  final Receiver receiver = new Receiver(1_000, TimeMode.AS_RECORDED);
  final Instant now = Instant.parse("2026-11-06T12:00:00Z");

  @Test
  void criterion5_threeReportsGiveThreeDetectionsAtTheirPositions() {
    List<TargetReport> reports = List.of(
        TargetReport.at(55.01, 19.91).index(0).classification(138).snr(12).radialVelocity(-4.5).build(),
        TargetReport.at(-33.9249, 18.4241).index(1).classification(130).snr(9).radialVelocity(3.0).build(),
        TargetReport.at(-22.9068, -43.1729).index(2).classification(6).snr(7).radialVelocity(0.25).build());
    receiver.packet(ReceiverTest.packet(ReceiverTest.header("30", 1, 7), ReceiverTest.mission(ReceiverTest.DAY),
        ReceiverTest.dwell(1_000).reports(reports).build()), now, sink);
    assertThat(sink.detections).hasSize(3);

    List<MapObjectContent> contents = sink.detections.stream().map(f -> Mapper.detection(PLACEMENT, f)).toList();
    MapObjectContent rio = contents.get(2);
    assertThat(rio.type()).isEqualTo(MapObjectContent.SYMBOL);
    assertThat(rio.dataType()).isEqualTo("gmti.detection");
    assertThat(rio.dataSource()).isEqualTo("vista");
    assertThat(rio.layerId()).isEqualTo(LAYER);
    assertThat(rio.label()).isEqualTo(PLACEMENT.label());
    assertThat(rio.fieldSets()).containsExactly("gmti.report");
    assertThat(rio.relations()).as("no platform id given: no pairing").isEmpty();
    UUID platform = UUID.randomUUID();
    assertThat(Mapper.detection(PLACEMENT, sink.detections.get(2), platform).relations())
        .containsExactly(new Relation("gmti.pairing", platform));
    assertThat(rio.time().observed()).isEqualTo(Instant.parse("2026-01-12T00:00:01Z"));
    var at = ((Geometry.Point) rio.geometry()).coordinates();
    assertThat(at.longitude()).as("longitude first").isCloseTo(-43.1729, within(1e-6));
    assertThat(at.latitude()).isCloseTo(-22.9068, within(1e-6));

    JsonObject ext = contents.getFirst().extensions().get("gmti");
    assertThat(ext.getString("classification")).isEqualTo("vehicle, simulated (138)");
    assertThat(ext.getNumber("snr").doubleValue()).isEqualTo(12.0);
    assertThat(ext.getNumber("radialVelocity").doubleValue()).isEqualTo(-4.5);
    assertThat(ext.getNumber("jobId").longValueExact()).isEqualTo(7);
    assertThat(ext.getNumber("reportIndex").longValueExact()).isZero();
    assertThat(ext.getString("platformId")).isEqualTo("PLATFORM01");

    assertThat(contents).extracting(c -> c.symbol().sidc()).containsExactly(
        "10" + "1" + "1" + "15" + "00" + "00" + "000000" + "0000", // 138 vehicle: a ground track; P7 129: exercise
        "10" + "1" + "1" + "15" + "00" + "31" + "000000" + "0000",
        "10" + "1" + "1" + "30" + "00" + "00" + "000000" + "0000");
  }

  @ParameterizedTest(name = "class {0}")
  @CsvSource({
      "1, 1500330000000000",   // tracked vehicle: land equipment, mobility tracked
      "129, 1500330000000000",
      "2, 1500310000000000",   // wheeled vehicle: land equipment, mobility wheeled
      "130, 1500310000000000",
      "3, 0100001102000000",   // rotary wing
      "131, 0100001102000000",
      "4, 0100001101000000",   // fixed wing
      "132, 0100001101000000",
      "6, 3000000000000000",   // maritime: sea surface
      "134, 3000000000000000",
      "13, 3000000000000000",  // large multiple-return, maritime
      "10, 1500000000000000",  // anything else: a ground track
      "127, 1500000000000000",
      "255, 1500000000000000"})
  void q8_theDetectionsSymbolIsByItsClass(int cls, String setOnward) {
    assertThat(Symbols.detection(Symbol.CONTEXT_REALITY, cls)).isEqualTo("1001" + setOnward);
  }

  @Test
  void q8_noClassIsAGroundTrack() {
    assertThat(Symbols.detection(Symbol.CONTEXT_REALITY, null)).isEqualTo("1001" + "1500000000000000");
  }

  @Test
  void criterion7_theExerciseIndicatorGivesTheContext() {
    assertThat(Symbols.context(0)).isEqualTo(Symbol.CONTEXT_REALITY);
    assertThat(Symbols.context(1)).isEqualTo(Symbol.CONTEXT_SIMULATION);
    assertThat(Symbols.context(2)).isEqualTo(Symbol.CONTEXT_SIMULATION);
    assertThat(Symbols.context(128)).isEqualTo(Symbol.CONTEXT_EXERCISE);
    assertThat(Symbols.context(129)).isEqualTo(Symbol.CONTEXT_EXERCISE);
    assertThat(Symbols.context(130)).isEqualTo(Symbol.CONTEXT_EXERCISE);
    assertThat(Symbols.context(3)).as("reserved").isEqualTo(Symbol.CONTEXT_REALITY);
    assertThat(Symbols.detection(Symbols.context(129), 1).charAt(2)).isEqualTo('1');
  }

  @Test
  void criterion7_theClassificationMapsToTheLinksPolicy() {
    var map = new LabelRule(true, LINK, LabelRule.NATO);
    assertThat(map.label(5)).isEqualTo(new LabelRule.Result(SecurityLabel.of("NATO", "UNCLASSIFIED"), true));
    assertThat(map.label(4)).isEqualTo(new LabelRule.Result(LINK, true));
    assertThat(map.label(2).label().classification()).isEqualTo("SECRET");
    assertThat(map.label(1).label().classification()).isEqualTo("COSMIC TOP SECRET");
    assertThat(map.label(0)).as("no such value: the link's label, counted").isEqualTo(new LabelRule.Result(LINK, false));
    assertThat(map.label(6).mapped()).isFalse();

    var linkLabel = new LabelRule(false, LINK, LabelRule.NATO);
    assertThat(linkLabel.label(2)).as("the AFSERS files' P4 2 with link label").isEqualTo(new LabelRule.Result(LINK, true));

    var named = new LabelRule(true, SecurityLabel.of("SWE", "OGRADERAD"), List.of("KVALIFICERAT HEMLIG", "HEMLIG", "KONFIDENTIELL", "BEGRÄNSAT HEMLIG", "OGRADERAD"));
    assertThat(named.label(3).label()).isEqualTo(SecurityLabel.of("SWE", "KONFIDENTIELL"));
  }

  @Test
  void aDetectionWithoutItsOwnErrorsGetsTheJobs() {
    receiver.packet(ReceiverTest.packet(ReceiverTest.header("30", 1, 7), ReceiverTest.mission(ReceiverTest.DAY),
        ReceiverTest.CodecJobs.job(7, 1), ReceiverTest.dwell(1_000).report(TargetReport.at(55.0, 19.9).build()).build()), now, sink);
    JsonObject ext = Mapper.detection(PLACEMENT, sink.detections.getFirst()).extensions().get("gmti");
    assertThat(ext.getNumber("slantRangeError").doubleValue()).as("J21 2000 cm").isEqualTo(20.0);
    assertThat(ext.getNumber("radialVelocityError").doubleValue()).as("J23 50 cm/s").isEqualTo(0.5);
    assertThat(ext.has("crossRangeError")).as("J22 is an angle, no length").isFalse();
    assertThat(ext.has("reportIndex")).isFalse();
  }

  @Test
  void thePlatformIsASymbolNamedByItsIdWithItsJobAndMission() {
    receiver.packet(ReceiverTest.packet(ReceiverTest.header("30", 1, 7), ReceiverTest.mission(ReceiverTest.DAY),
        ReceiverTest.CodecJobs.job(7, 1), ReceiverTest.dwell(1_000).sensorMotion(271.5, 200.0, 0.0).build()), now, sink);
    MapObjectContent c = Mapper.platform(PLACEMENT, sink.platforms.getFirst(), null);
    assertThat(c.type()).isEqualTo(MapObjectContent.SYMBOL);
    assertThat(c.dataType()).isEqualTo("gmti.platform");
    assertThat(c.properties().name()).isEqualTo("PLATFORM01");
    assertThat(c.symbol().sidc()).as("M3 7, Joint STARS: fixed wing, exercise").isEqualTo("1011" + "0100001101000000");
    assertThat(c.symbol().modifiers().direction()).isCloseTo(271.5, within(0.01));
    assertThat(c.symbol().modifiers().speed()).isEqualTo(200.0);
    assertThat(((Geometry.Point) c.geometry()).coordinates().altitude()).isEqualTo(8_500.0);
    JsonObject ext = c.extensions().get("gmti");
    assertThat(ext.getNumber("platformType").longValueExact()).isEqualTo(7);
    assertThat(ext.getNumber("jobId").longValueExact()).isEqualTo(7);
    assertThat(ext.getObject("job").getNumber("revisitInterval").doubleValue()).isEqualTo(10.0);
    assertThat(ext.getObject("job").getNumber("detectionProbability").longValueExact()).isEqualTo(90);
    assertThat(ext.getObject("job").has("alongTrackError")).as("no statement").isFalse();
    assertThat(c.fieldSets()).as("only detections carry the set").isEmpty();
  }

  @ParameterizedTest(name = "M3 {0}")
  @CsvSource({"0, 0100000000000000", "255, 0100000000000000", "13, 1500002201000000", "15, 1500002201000000", "3, 0100001101000000"})
  void thePlatformsDefaultSymbolIsByItsType(int type, String setOnward) {
    assertThat(Symbols.platform(Symbol.CONTEXT_REALITY, StandardIdentity.FRIEND, null, type)).isEqualTo("1003" + setOnward);
  }

  @Test
  void theLinksPlatformSymbolTakesTheContextAndTheIdentity() {
    assertThat(Symbols.platform(Symbol.CONTEXT_EXERCISE, StandardIdentity.HOSTILE, "10031000001211000000", 7))
        .isEqualTo("10161000001211000000");
  }

  @Test
  void anUpdateKeepsTheStoredLayerStyleRelationsAndOtherNamespaces() {
    receiver.packet(ReceiverTest.packet(ReceiverTest.header("30", 1, 7), ReceiverTest.mission(ReceiverTest.DAY),
        ReceiverTest.dwell(1_000).build()), now, sink);
    UUID other = UUID.randomUUID();
    MapObjectContent first = Mapper.platform(PLACEMENT, sink.platforms.getFirst(), null);
    var style = new Style("#123456", 2.0, null, null, null, null);
    var relation = new Relation("simulator.something", UUID.randomUUID());
    MapObjectContent kept = new MapObjectContent(first.type(), first.dataType(), first.dataSource(), first.time(), other, first.geometry(),
        first.symbol(), style, first.properties(), first.label(),
        first.extensions().with("other", JsonObject.builder().put("x", JsonString.of("y")).build()), List.of(), List.of(relation));
    var audit = new Meta.Audit(Instant.EPOCH, Actor.plugin("gmti"));
    var stored = new MapObject(UUID.randomUUID(), 3, kept, new Meta(audit, audit, null));

    MapObjectContent next = Mapper.platform(PLACEMENT, sink.platforms.getFirst(), stored);
    assertThat(next.layerId()).isEqualTo(other);
    assertThat(next.style()).isEqualTo(style);
    assertThat(next.relations()).containsExactly(relation);
    assertThat(next.extensions().get("other")).isEqualTo(kept.extensions().get("other"));
  }

  @Test
  void criterion33_theAreaIsATwoPixelOutlineInTheDefaultColour_withoutAName() {
    receiver.packet(ReceiverTest.packet(ReceiverTest.header("30", 1, 7), ReceiverTest.mission(ReceiverTest.DAY),
        ReceiverTest.dwell(1_000).build()), now, sink);
    MapObjectContent area = Mapper.area(PLACEMENT, sink.areas.getFirst(), null);
    assertThat(area.type()).isEqualTo(MapObjectContent.SHAPE);
    assertThat(area.dataType()).as("its own data type from M7 RC2 (T-192)").isEqualTo("gmti.dwell-area").isEqualTo(Mapper.DWELL_AREA);
    assertThat(area.geometry()).isInstanceOf(Geometry.ArcBand.class);
    assertThat(area.style().strokeColor()).as("fixed #7EF26A by default from M8 (T-189)").isEqualTo("#7EF26A");
    assertThat(area.style().strokeWidth()).as("2 px from M7 (owner QL C, 2026-11-11)").isEqualTo(2.0);
    assertThat(area.style().strokeDash()).as("solid").isNull();
    assertThat(area.style().fillOpacity()).as("no fill").isEqualTo(0.0);
    assertThat(area.properties()).as("no name, so no map label per dwell (owner, 2026-11-13)").isNull();
    assertThat(area.extensions().get("gmti").getNumber("jobId")).isEqualTo(JsonNumber.of(7));
  }

  @Test
  void criterion34_fixedColoursOutlineTheAreaAndTheCoverage_theIdentityFillsNothing() {
    List<Position> corners = List.of(Position.of(15.10, 58.30), Position.of(15.50, 58.30), Position.of(15.50, 58.10), Position.of(15.10, 58.10));
    receiver.packet(ReceiverTest.packet(ReceiverTest.header("30", 1, 7), ReceiverTest.mission(ReceiverTest.DAY),
        ReceiverTest.CodecJobs.job(7, 1, corners), ReceiverTest.dwell(1_000).build()), now, sink);
    var colours = new Colours(new Colours.Colour("#FF00FF"), new Colours.Colour("#00FF00"));
    var fixed = new Mapper.Placement("vista", LAYER, SecurityLabel.of("NATO", "UNCLASSIFIED"), StandardIdentity.FRIEND, null, colours);
    assertThat(Mapper.area(fixed, sink.areas.getFirst(), null).style()).isEqualTo(new Style("#FF00FF", 2.0, null, null, null, 0.0));
    assertThat(Mapper.coverage(fixed, sink.coverages.getFirst(), null).style()).isEqualTo(new Style("#00FF00", 1.5, null, Style.Dash.DASH, null, 0.0));

    var byDefault = new Mapper.Placement("vista", LAYER, SecurityLabel.of("NATO", "UNCLASSIFIED"), StandardIdentity.FRIEND, null);
    assertThat(byDefault.colours()).as("fixed by default from M8 (T-189)").isEqualTo(Colours.DEFAULTS);
    assertThat(Mapper.area(byDefault, sink.areas.getFirst(), null).style().strokeColor()).isEqualTo("#7EF26A");
    assertThat(Mapper.coverage(byDefault, sink.coverages.getFirst(), null).style().strokeColor()).isEqualTo("#BDCF3D");

    var identity = new Mapper.Placement("vista", LAYER, SecurityLabel.of("NATO", "UNCLASSIFIED"), StandardIdentity.FRIEND, null, Colours.IDENTITY);
    assertThat(Mapper.area(identity, sink.areas.getFirst(), null).style().strokeColor()).as("identity, still selectable").isEqualTo("#00A8DC");
    assertThat(Mapper.coverage(identity, sink.coverages.getFirst(), null).style().strokeColor()).isEqualTo("#00A8DC");
  }

  @Test
  void criterion34_theColoursAreReadWithTheSchemasDefaults_andABadOneIsAProblem() {
    assertThat(Colours.from(JsonObject.empty())).as("M8, T-189: both fixed").isEqualTo(Colours.DEFAULTS)
        .isEqualTo(new Colours(new Colours.Colour("#7EF26A"), new Colours.Colour("#BDCF3D")));
    assertThat(Colours.from(settings("{\"coverageColour\":{\"use\":\"fixed\",\"colour\":\"#0a0B0c\"}}")))
        .isEqualTo(new Colours(new Colours.Colour("#7EF26A"), new Colours.Colour("#0a0B0c")));
    assertThat(Colours.from(settings("{\"dwellAreaColour\":{\"colour\":\"#0A0B0C\"}}"))).as("use: fixed by default")
        .isEqualTo(new Colours(new Colours.Colour("#0A0B0C"), new Colours.Colour("#BDCF3D")));
    assertThat(Colours.from(settings("{\"dwellAreaColour\":{\"use\":\"fixed\"},\"coverageColour\":{\"use\":\"fixed\"}}")))
        .as("fixed without a colour: each setting's own default").isEqualTo(Colours.DEFAULTS);
    assertThat(Colours.from(settings("{\"dwellAreaColour\":{\"use\":\"identity\"},\"coverageColour\":{\"use\":\"identity\",\"colour\":\"#BDCF3D\"}}")))
        .as("identity, still selectable").isEqualTo(Colours.IDENTITY);
    assertThatThrownBy(() -> Colours.from(settings("{\"dwellAreaColour\":\"#FF00FF\"}"))).hasMessageStartingWith("dwellAreaColour is {");
    assertThatThrownBy(() -> Colours.from(settings("{\"coverageColour\":{\"use\":\"red\"}}"))).hasMessage("coverageColour: use is fixed or identity");
    for (String bad : new String[] {"\"#FF00F\"", "\"FF00FF\"", "\"#FF00FFAA\"", "\"#GG0000\"", "7"}) {
      assertThatThrownBy(() -> Colours.from(settings("{\"dwellAreaColour\":{\"use\":\"fixed\",\"colour\":" + bad + "}}")))
          .as(bad).hasMessage("dwellAreaColour: a fixed colour is #RRGGBB");
    }
    assertThatThrownBy(() -> new Colours.Colour("#FFF")).isInstanceOf(IllegalArgumentException.class);
  }

  static JsonObject settings(String json) {
    return (JsonObject) dev.emcc.sdk.testkit.TestJson.parse(json);
  }

  @Test
  void criterion36_theDwellAreaAndTheCoverageCarryTheirDisplayClasses_thePlatformAndADetectionNone() {
    List<Position> corners = List.of(Position.of(15.10, 58.30), Position.of(15.50, 58.30), Position.of(15.50, 58.10), Position.of(15.10, 58.10));
    receiver.packet(ReceiverTest.packet(ReceiverTest.header("30", 1, 7), ReceiverTest.mission(ReceiverTest.DAY),
        ReceiverTest.CodecJobs.job(7, 1, corners), ReceiverTest.dwell(1_000).report(TargetReport.at(55.0, 19.9).build()).build()), now, sink);
    MapObjectContent area = Mapper.area(PLACEMENT, sink.areas.getFirst(), null);
    MapObjectContent coverage = Mapper.coverage(PLACEMENT, sink.coverages.getFirst(), null);
    assertThat(area.displayClass()).as("SDK 1.6.0 part D, T-182").isEqualTo("dwell-area").isEqualTo(DisplayClass.DWELL_AREA);
    assertThat(coverage.displayClass()).isEqualTo("sensor-coverage").isEqualTo(DisplayClass.SENSOR_COVERAGE);
    assertThat(Mapper.platform(PLACEMENT, sink.platforms.getFirst(), null).displayClass()).isNull();
    assertThat(Mapper.detection(PLACEMENT, sink.detections.getFirst()).displayClass()).isNull();

    // An area or a coverage stored before 1.6.0, without a class, gets it at its next write.
    var audit = new Meta.Audit(Instant.EPOCH, Actor.plugin("gmti"));
    var meta = new Meta(audit, audit, null);
    var oldArea = new MapObject(UUID.randomUUID(), 3, area.withDisplayClass(null), meta);
    var oldCoverage = new MapObject(UUID.randomUUID(), 3, coverage.withDisplayClass(null), meta);
    assertThat(Mapper.area(PLACEMENT, sink.areas.getFirst(), oldArea).displayClass()).isEqualTo(DisplayClass.DWELL_AREA);
    assertThat(Mapper.coverage(PLACEMENT, sink.coverages.getFirst(), oldCoverage).displayClass()).isEqualTo(DisplayClass.SENSOR_COVERAGE);
  }

  @Test
  void criterion39_theDwellAreaIsAGmtiDwellArea_theCoverageAndThePlatformStayGmtiPlatform_anOldAreaTakesItAtItsNextDwell() {
    List<Position> corners = List.of(Position.of(15.10, 58.30), Position.of(15.50, 58.30), Position.of(15.50, 58.10), Position.of(15.10, 58.10));
    receiver.packet(ReceiverTest.packet(ReceiverTest.header("30", 1, 7), ReceiverTest.mission(ReceiverTest.DAY),
        ReceiverTest.CodecJobs.job(7, 1, corners), ReceiverTest.dwell(1_000).report(TargetReport.at(55.0, 19.9).build()).build()), now, sink);
    MapObjectContent area = Mapper.area(PLACEMENT, sink.areas.getFirst(), null);
    assertThat(area.dataType()).as("it fades in steps by dwellAreaFade").isEqualTo("gmti.dwell-area");
    assertThat(area.time().observed()).as("counted from the dwell's time").isEqualTo(sink.areas.getFirst().time());
    assertThat(Mapper.coverage(PLACEMENT, sink.coverages.getFirst(), null).dataType()).isEqualTo("gmti.platform");
    assertThat(Mapper.platform(PLACEMENT, sink.platforms.getFirst(), null).dataType()).isEqualTo("gmti.platform");
    assertThat(Mapper.detection(PLACEMENT, sink.detections.getFirst()).dataType()).as("fades by detectionFade").isEqualTo("gmti.detection");

    // An area written before M7 RC2, as gmti.platform, takes the new type at its next dwell.
    var audit = new Meta.Audit(Instant.EPOCH, Actor.plugin("gmti"));
    var old = new MapObject(UUID.randomUUID(), 4, new MapObjectContent(area.type(), "gmti.platform", area.dataSource(), area.time(), area.layerId(),
        area.geometry(), area.symbol(), area.style(), area.properties(), area.label(), area.extensions()), new Meta(audit, audit, null));
    assertThat(old.content().dataType()).isEqualTo("gmti.platform");
    assertThat(Mapper.area(PLACEMENT, sink.areas.getFirst(), old).dataType()).isEqualTo("gmti.dwell-area");
  }

  @Test
  void criterion21_theCoverageIsADashedOutlineOfTheBoundingArea() {
    List<Position> corners = List.of(Position.of(15.10, 58.30), Position.of(15.50, 58.30), Position.of(15.50, 58.10), Position.of(15.10, 58.10));
    receiver.packet(ReceiverTest.packet(ReceiverTest.header("30", 1, 7), ReceiverTest.mission(ReceiverTest.DAY),
        ReceiverTest.CodecJobs.job(7, 1, corners)), now, sink);
    MapObjectContent coverage = Mapper.coverage(PLACEMENT, sink.coverages.getFirst(), null);
    assertThat(coverage.type()).isEqualTo(MapObjectContent.SHAPE);
    assertThat(coverage.dataType()).as("it expires and fades with the platform").isEqualTo("gmti.platform");
    assertThat(coverage.dataSource()).isEqualTo("vista");
    assertThat(coverage.layerId()).isEqualTo(LAYER);
    assertThat(coverage.label()).isEqualTo(PLACEMENT.label());
    assertThat(coverage.time().observed()).as("before any dwell: the job definition's arrival").isEqualTo(now);
    List<Position> ring = ((Geometry.Polygon) coverage.geometry()).rings().getFirst();
    assertThat(ring).hasSize(5);
    for (int i = 0; i < 5; i++) {
      Position expected = corners.get(i % 4);
      assertThat(ring.get(i).longitude()).as("longitude first, A to D, closed with A").isCloseTo(expected.longitude(), within(1e-6));
      assertThat(ring.get(i).latitude()).isCloseTo(expected.latitude(), within(1e-6));
    }
    assertThat(coverage.style()).as("#BDCF3D by default from M8 (T-189)").isEqualTo(new Style("#BDCF3D", 1.5, null, Style.Dash.DASH, null, 0.0));
    assertThat(coverage.properties().name()).isEqualTo("PLATFORM01 coverage");
    assertThat(coverage.extensions().get("gmti").getNumber("jobId")).isEqualTo(JsonNumber.of(7));
    assertThat(Mapper.coverageId("vista", "PLATFORM01")).isEqualTo("vista/PLATFORM01/coverage");

    var other = UUID.randomUUID();
    var relation = new Relation("x.link", UUID.randomUUID());
    var kept = new MapObjectContent(coverage.type(), coverage.dataType(), coverage.dataSource(), coverage.time(), other, coverage.geometry(), null,
        coverage.style(), coverage.properties(), coverage.label(),
        coverage.extensions().with("other", JsonObject.builder().put("x", JsonString.of("y")).build()), List.of(), List.of(relation));
    var audit = new Meta.Audit(Instant.EPOCH, Actor.plugin("gmti"));
    MapObjectContent next = Mapper.coverage(PLACEMENT, sink.coverages.getFirst(), new MapObject(UUID.randomUUID(), 3, kept, new Meta(audit, audit, null)));
    assertThat(next.layerId()).as("an update keeps the stored layer, relations and other namespaces").isEqualTo(other);
    assertThat(next.relations()).containsExactly(relation);
    assertThat(next.extensions().get("other")).isEqualTo(kept.extensions().get("other"));
  }

  @Test
  void aDetectionsHeightIsItsAltitude_andTheCodeWordsAreKeptOnThePlatform() {
    var h = new PacketHeader("30", "US", 5, "XN", 0x0101, 1, "PLATFORM10", 1, 7);
    receiver.packet(ReceiverTest.packet(h, ReceiverTest.mission(ReceiverTest.DAY),
        ReceiverTest.dwell(1_000).report(TargetReport.at(33.2, -71.5).height(80).build()).build()), now, sink);
    var at = ((Geometry.Point) Mapper.detection(PLACEMENT, sink.detections.getFirst()).geometry()).coordinates();
    assertThat(at.altitude()).as("D32.6, metres").isEqualTo(80.0);
    assertThat(at.longitude()).isCloseTo(-71.5, within(1e-6));
    JsonObject platform = Mapper.platform(PLACEMENT, sink.platforms.getFirst(), null).extensions().get("gmti");
    assertThat(platform.getNumber("codeWords").longValueExact()).as("P6 as received").isEqualTo(0x0101);
    assertThat(platform.getString("nationality")).isEqualTo("US");
    assertThat(Mapper.detection(PLACEMENT, sink.detections.getFirst()).symbol().sidc().charAt(2)).as("P7 1: simulation").isEqualTo('2');
  }

  @Test
  void externalIds() {
    assertThat(Mapper.platformId("vista", "PLATFORM01")).isEqualTo("vista/PLATFORM01");
    receiver.packet(ReceiverTest.packet(ReceiverTest.header("30", 1, 7), ReceiverTest.mission(ReceiverTest.DAY), ReceiverTest.dwell(1_000).build()), now, sink);
    assertThat(Mapper.areaId("vista", sink.areas.getFirst())).as("M8, T-195: one per dwell, by its time (UTC ms), D2 and D3")
        .isEqualTo("vista/PLATFORM01/area/" + ReceiverTest.MIDNIGHT.plusSeconds(1).toEpochMilli() + "/0/0");
  }

  @Test
  void aClassKeepsItsNumber() {
    assertThat(Classes.name(129)).isEqualTo("tracked vehicle, simulated (129)");
    assertThat(Classes.name(2)).isEqualTo("wheeled vehicle (2)");
    assertThat(Classes.name(142)).isEqualTo("tagging device, simulated (142)");
    assertThat(Classes.name(60)).isEqualTo("reserved (60)");
    assertThat(Classes.name(143)).isEqualTo("reserved (143)");
  }

  @Test
  void m91_edition3sTaggingDeviceIs143_editionAs142_everyOtherClassTheSame() {
    assertThat(Classes.name(143, "30")).as("Edition 3's table prints it as 143").isEqualTo("tagging device, simulated (143)");
    assertThat(Classes.name(143, "21")).as("and so do the older ones").isEqualTo("tagging device, simulated (143)");
    assertThat(Classes.name(143, "41")).as("Edition A reserves 143").isEqualTo("reserved (143)");
    assertThat(Classes.name(142, "41")).isEqualTo("tagging device, simulated (142)");
    for (int value : new int[] {0, 2, 13, 14, 129, 138, 141, 142, 144, 254, 255}) {
      assertThat(Classes.name(value, "30")).as("class %d", value).isEqualTo(Classes.name(value, "41"));
    }

    for (String version : new String[] {"30", "41"}) {
      var collected = new ReceiverTest.Sink();
      new Receiver(1_000, TimeMode.AS_RECORDED).packet(ReceiverTest.packet(ReceiverTest.header(version, 1, 7), ReceiverTest.mission(ReceiverTest.DAY),
          ReceiverTest.dwell(1_000).report(TargetReport.at(56.0, 15.9).classification(143).build()).build()), now, collected);
      JsonObject ext = Mapper.detection(PLACEMENT, collected.detections.getFirst()).extensions().get("gmti");
      assertThat(ext.getString("classification")).as("P1 %s", version)
          .isEqualTo(version.equals("30") ? "tagging device, simulated (143)" : "reserved (143)");
    }
  }

  @Test
  void anEmptyPlatformIdHasAName() {
    var h = new PacketHeader("41", "XN", 5, "XN", 0, 0, "", 1, 7);
    receiver.packet(ReceiverTest.packet(h, ReceiverTest.mission(ReceiverTest.DAY), ReceiverTest.dwell(1_000).build()), now, sink);
    assertThat(Mapper.platform(PLACEMENT, sink.platforms.getFirst(), null).properties().name()).isEqualTo("GMTI platform");
    assertThat(JobDefinition.NONE_16).isEqualTo(65_535);
    assertThat(Extensions.empty().isEmpty()).isTrue();
  }
}
