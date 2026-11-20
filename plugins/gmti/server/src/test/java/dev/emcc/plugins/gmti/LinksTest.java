package dev.emcc.plugins.gmti;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.gmti.format.Decoder;
import dev.emcc.plugins.gmti.format.Dwell;
import dev.emcc.plugins.gmti.format.Encoder;
import dev.emcc.plugins.gmti.format.Mission;
import dev.emcc.plugins.gmti.format.Packet;
import dev.emcc.plugins.gmti.format.PacketHeader;
import dev.emcc.plugins.gmti.format.Segment;
import dev.emcc.plugins.gmti.format.TargetReport;
import dev.emcc.plugins.gmti.transport.TransportMsg;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.DataType;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelInfo;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.channel.ChannelKind;
import dev.emcc.sdk.channel.SensorType;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.DisplayClass;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Style;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.model.TimeAttributes;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.TestJson;
import java.io.DataInputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The links in the plugin (work package 3; brief section 5): objects written into the target layer,
 * settings that change at runtime, the output channel, and an {@code out} link sent into an {@code in}
 * link on loopback. Store tests feed packets straight into the worker of a link that is switched off
 * (no socket), as its task would.
 */
class LinksTest {

  static final LocalDate DAY = LocalDate.of(2026, 1, 12);
  static final Position SENSOR = Position.of(19.7, 55.08);

  FakePluginContext ctx;
  GmtiPlugin plugin;

  @BeforeEach
  void start() {
    ctx = Manifest.context().build();
    plugin = new GmtiPlugin(ctx::clock);
    plugin.init(ctx);
    plugin.start();
    ctx.runUntilIdle();
  }

  @AfterEach
  void stop() {
    ctx.connections().stopAll();
  }

  void useLinks(String... entries) {
    ctx.changeSettings((JsonObject) TestJson.parse("{\"links\":[" + String.join(",", entries) + "]}"));
    ctx.runUntilIdle();
  }

  /** A link that is switched off: no socket, packets come from the test. */
  static String offLink(String name, String more) {
    return "{\"name\":\"" + name + "\",\"host\":\"127.0.0.1\",\"port\":9,\"enabled\":false" + more + "}";
  }

  static PacketHeader header(int classification, int exercise) {
    return new PacketHeader("30", "US", classification, "XN", 0, exercise, "PLATFORM01", 1, 7);
  }

  /** A mission and a dwell with reports at the given positions (longitude, latitude pairs). */
  static Packet packet(PacketHeader h, long millis, double... lonLat) {
    Position centre = Geodesy.direct(SENSOR, 90, 30_000);
    var d = Dwell.of(0, 0, millis, SENSOR.latitude(), SENSOR.longitude(), 8_500, centre.latitude(), centre.longitude(), 5, 7.5);
    for (int i = 0; i < lonLat.length; i += 2) {
      d.report(TargetReport.at(lonLat[i + 1], lonLat[i]).index(i / 2).classification(130).build());
    }
    return Decoder.decode(Encoder.packet(h, List.of(Mission.on(DAY, 7, "", ""), d.build()))).packet();
  }

  void receive(String link, Packet p) {
    plugin.links().send(new TransportMsg.Received(link, UUID.randomUUID(), p));
    ctx.runUntilIdle();
  }

  List<MapObject> objects(String dataType) {
    return ctx.store().objects().stream().filter(o -> o.content().dataType().equals(dataType)).toList();
  }

  // ---------------------------------------------------------------- in

  @Test
  void criterion5_receivedObjectsGoIntoTheTargetLayerWithTheLinkAsTheirDataSource() {
    useLinks(offLink("vista", ""));
    receive("vista", packet(header(5, 129), 1_000, 19.91, 55.01, 18.4241, -33.9249, -43.1729, -22.9068));
    List<Layer> layers = ctx.store().layers();
    assertThat(layers).extracting(l -> l.content().name()).containsExactly("vista");
    UUID layer = layers.getFirst().id();

    List<MapObject> detections = objects("gmti.detection");
    assertThat(detections).hasSize(3);
    assertThat(detections).allSatisfy(o -> {
      assertThat(o.content().layerId()).isEqualTo(layer);
      assertThat(o.content().dataSource()).isEqualTo("vista");
      assertThat(o.content().fieldSets()).containsExactly("gmti.report");
      assertThat(o.content().label()).isEqualTo(SecurityLabel.of("NATO", "UNCLASSIFIED"));
      assertThat(o.content().symbol().sidc()).as("wheeled, exercise").isEqualTo("10111500310000000000");
      assertThat(o.meta().externalRef().system()).isEqualTo("gmti");
    });
    assertThat(detections).extracting(o -> ((Geometry.Point) o.content().geometry()).coordinates().longitude())
        .anySatisfy(lon -> assertThat(lon).isCloseTo(-43.1729, within(1e-6)));

    List<MapObject> platform = objects("gmti.platform");
    List<MapObject> area = objects("gmti.dwell-area");
    assertThat(platform).extracting(o -> o.content().type()).containsExactly(MapObjectContent.SYMBOL);
    assertThat(area).as("its own data type from M7 RC2 (T-192)").extracting(o -> o.content().type()).containsExactly(MapObjectContent.SHAPE);
    assertThat(platform).allSatisfy(o -> assertThat(o.content().fieldSets()).as("only detections carry the set").isEmpty());
    assertThat(area).allSatisfy(o -> assertThat(o.content().fieldSets()).isEmpty());
    assertThat(platform).extracting(o -> o.meta().externalRef().id()).containsExactly("vista/PLATFORM01");
    assertThat(area).extracting(o -> o.meta().externalRef().id()).singleElement().asString().as("M8, T-195: <link>/<P8>/area/<dwell time>/<D2>/<D3>")
        .matches("vista/PLATFORM01/area/\\d+/0/0");
    assertThat(ctx.connections().names()).as("no socket").isEmpty();
  }

  @Test
  void criterion23_theDataTypesNameTheirSetsAndAreNotMadeByHand_aDetectionCarriesItsSetOnce() {
    assertThat(ctx.dataTypes()).filteredOn(t -> t.id().startsWith("gmti.")).extracting(DataType::id, DataType::fieldSets, DataType::manual)
        .as("the test kit's context built from the manifest (SDK 1.7.0)")
        .containsExactly(tuple("gmti.detection", List.of("gmti.report"), false), tuple("gmti.platform", List.of(), false),
            tuple("gmti.dwell-area", List.of(), false));

    useLinks(offLink("vista", ""));
    receive("vista", packet(header(5, 129), 1_000, 19.91, 55.01));
    assertThat(objects("gmti.detection")).singleElement()
        .satisfies(o -> assertThat(o.content().fieldSets()).as("listed by the writer and by the data type: once (model rule 21)").containsExactly("gmti.report"));
    assertThat(objects("gmti.platform")).filteredOn(o -> o.content().type().equals(MapObjectContent.SYMBOL)).singleElement()
        .satisfies(o -> assertThat(o.content().fieldSets()).as("gmti.platform names no set").isEmpty());
  }

  @Test
  void criterion28_aDetectionIsASensorReportType_andKeepsItsClasssSidc() {
    assertThat(ctx.dataTypes()).filteredOn(t -> t.id().startsWith("gmti.")).extracting(DataType::id, DataType::sensorReport)
        .containsExactly(tuple("gmti.detection", true), tuple("gmti.platform", false), tuple("gmti.dwell-area", false));
    useLinks(offLink("vista", ""));
    receive("vista", packet(header(5, 129), 1_000, 19.91, 55.01));
    assertThat(objects("gmti.detection")).singleElement()
        .satisfies(o -> assertThat(o.content().symbol().sidc()).as("wheeled, exercise: its class's SIDC (criterion 5)").isEqualTo("10111500310000000000"));
  }

  // ---------------------------------------------------------------- criterion 27, every dwell its own area (M8, T-195)

  /** A mission and dwell {@code index} of revisit {@code revisit}, no reports; {@code last} sets D4. */
  static Packet revisitPacket(int revisit, int index, boolean last) {
    Position centre = Geodesy.direct(SENSOR, 90 + 20 * index, 30_000);
    var d = Dwell.of(revisit, index, 1_000L * (revisit * 10 + index + 1), SENSOR.latitude(), SENSOR.longitude(), 8_500, centre.latitude(),
        centre.longitude(), 5, 7.5).lastDwell(last);
    return Decoder.decode(Encoder.packet(header(5, 129), List.of(Mission.on(DAY, 7, "", ""), d.build()))).packet();
  }

  List<String> areaIds() {
    return objects("gmti.dwell-area").stream().filter(o -> o.content().geometry() instanceof Geometry.ArcBand).map(o -> o.meta().externalRef().id())
        .sorted().toList();
  }

  /** The job definition of job 7 with J5 255: the job ends. */
  static Packet endOfJob(PacketHeader h) {
    var job = new dev.emcc.plugins.gmti.format.JobDefinition(7, 255, "", 0, 255,
        List.of(Position.of(15, 57), Position.of(16, 57), Position.of(16, 56), Position.of(15, 56)), 1, 0, 65_535, 65_535, 65_535, 255,
        65_535, 65_535, 180.0, 65_535, 255, 255, 255, 0, 0);
    return Decoder.decode(Encoder.packet(h, List.<Segment>of(job))).packet();
  }

  @Test
  void criterion27_twoRevisitsFiveDwellsGiveFiveAreas_noneRemovedByALaterDwellARevisitOrTheJobsEnd_aRepeatIsOne() {
    useLinks(offLink("vista", ""));
    receive("vista", jobPacket(header(5, 129), BOX));
    receive("vista", revisitPacket(4, 0, false));
    receive("vista", revisitPacket(4, 1, false));
    receive("vista", revisitPacket(4, 2, true));
    receive("vista", revisitPacket(5, 0, false));
    receive("vista", revisitPacket(5, 1, true));
    receive("vista", revisitPacket(5, 1, true)); // the same dwell again
    receive("vista", endOfJob(header(5, 129)));
    long midnight = DAY.atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli();
    assertThat(areaIds()).as("one per dwell, kept").containsExactly(
        "vista/PLATFORM01/area/" + (midnight + 41_000) + "/4/0", "vista/PLATFORM01/area/" + (midnight + 42_000) + "/4/1",
        "vista/PLATFORM01/area/" + (midnight + 43_000) + "/4/2", "vista/PLATFORM01/area/" + (midnight + 51_000) + "/5/0",
        "vista/PLATFORM01/area/" + (midnight + 52_000) + "/5/1");
    assertThat(objects("gmti.dwell-area")).as("never updated, the repeat included").allSatisfy(o -> assertThat(o.version()).isEqualTo(1))
        .allSatisfy(o -> assertThat(o.content().properties()).as("no name: no map label (owner, 2026-11-13)").isNull());
    assertThat(coverage()).as("J5 255: the coverage goes").isNull();
  }

  // ---------------------------------------------------------------- criteria 33 and 34, the outlines (M7, T-181, T-185)

  static final List<Position> BOX = List.of(Position.of(19.0, 55.5), Position.of(20.5, 55.5), Position.of(20.5, 54.5), Position.of(19.0, 54.5));
  static final List<Position> OTHER_BOX = List.of(Position.of(19.0, 55.6), Position.of(20.6, 55.6), Position.of(20.6, 54.5), Position.of(19.0, 54.5));

  /** A job definition of job 7, running, with its bounding area's corners A to D, longitude first. */
  static Packet jobPacket(PacketHeader h, List<Position> box) {
    var job = new dev.emcc.plugins.gmti.format.JobDefinition(7, 255, "", 0, 1, box, 1, 0, 65_535, 65_535, 65_535, 255,
        65_535, 65_535, 180.0, 65_535, 255, 255, 255, 0, 0);
    return Decoder.decode(Encoder.packet(h, List.<Segment>of(job))).packet();
  }

  /** The links, with more top-level settings ({@code more} starts with a comma). */
  void useSettings(String more, String... entries) {
    ctx.changeSettings((JsonObject) TestJson.parse("{\"links\":[" + String.join(",", entries) + "]" + more + "}"));
    ctx.runUntilIdle();
  }

  /** The newest dwell area's style: from M8 each dwell has its own area (T-195). */
  Style areaStyle() {
    return objects("gmti.dwell-area").stream().filter(o -> o.content().geometry() instanceof Geometry.ArcBand)
        .max(java.util.Comparator.comparing(o -> o.content().time().observed())).orElseThrow().content().style();
  }

  Style coverageStyle() {
    return Objects.requireNonNull(coverage(), "a coverage").content().style();
  }

  @Test
  void criterion33_theDwellAreaIsATwoPixelSolidOutline_bothInTheirFixedDefaultColours() {
    useLinks(offLink("vista", ",\"platformIdentity\":\"friend\""));
    receive("vista", packet(header(5, 1), 1_000));
    receive("vista", jobPacket(header(5, 1), BOX));
    Style area = areaStyle();
    assertThat(area.strokeWidth()).as("2 px from M7 (owner QL C)").isEqualTo(2.0);
    assertThat(area.strokeDash()).as("solid").isNull();
    assertThat(area.fillOpacity()).as("no fill").isEqualTo(0.0);
    assertThat(area.strokeColor()).as("M8, T-189: fixed #7EF26A by default, whatever the identity").isEqualTo("#7EF26A");
    Style coverage = coverageStyle();
    assertThat(coverage.strokeColor()).as("the 4607 job's bounding area: #BDCF3D (owner SU A)").isEqualTo("#BDCF3D");
    assertThat(coverage.strokeDash()).isEqualTo(Style.Dash.DASH);
    assertThat(coverage.strokeWidth()).as("unchanged").isEqualTo(1.5);
  }

  @Test
  void criterion34_fixedColoursApplyFromEachShapesNextWrite_withoutAReconnect() throws Exception {
    String link = offLink("vista", ",\"platformIdentity\":\"friend\"");
    useLinks(link);
    receive("vista", packet(header(5, 1), 1_000));
    receive("vista", jobPacket(header(5, 1), BOX));

    String fixed = ",\"dwellAreaColour\":{\"use\":\"fixed\",\"colour\":\"#FF00FF\"},\"coverageColour\":{\"use\":\"fixed\",\"colour\":\"#00ff00\"}";
    useSettings(fixed, link);
    assertThat(areaStyle().strokeColor()).as("a drawn area keeps its colour").isEqualTo("#7EF26A");
    receive("vista", packet(header(5, 1), 2_000));
    receive("vista", jobPacket(header(5, 1), OTHER_BOX)); // new corners: the coverage is written at once
    assertThat(areaStyle().strokeColor()).isEqualTo("#FF00FF");
    assertThat(areaStyle().strokeWidth()).isEqualTo(2.0);
    assertThat(coverageStyle().strokeColor()).as("as the admin wrote it").isEqualTo("#00ff00");
    assertThat(coverageStyle().strokeDash()).isEqualTo(Style.Dash.DASH);
    assertThat(objects("gmti.platform")).as("the platform and its coverage, each once").hasSize(2);
    assertThat(objects("gmti.dwell-area")).as("an area per dwell, the first in its own colour").hasSize(2)
        .extracting(o -> o.content().style().strokeColor()).containsExactlyInAnyOrder("#7EF26A", "#FF00FF");

    // "identity", still selectable: the identity's colour from the next dwell.
    useSettings(",\"dwellAreaColour\":{\"use\":\"identity\",\"colour\":\"#FF00FF\"}", link);
    receive("vista", packet(header(5, 1), 3_000));
    assertThat(areaStyle().strokeColor()).isEqualTo("#00A8DC");
    assertThat(ctx.effectiveStatus().detail()).doesNotContain("Colour");

    // A value the schema refuses, should one get through: the defaults, and the problem in the status.
    useSettings(",\"dwellAreaColour\":{\"use\":\"fixed\",\"colour\":\"magenta\"}", link);
    receive("vista", packet(header(5, 1), 4_000));
    assertThat(areaStyle().strokeColor()).isEqualTo("#7EF26A");
    assertThat(ctx.effectiveStatus().detail()).startsWith("dwellAreaColour: a fixed colour is #RRGGBB; vista [in tcp-client");

    // Fixed without a colour: the schema's default; the settings left out: the defaults.
    useSettings(",\"dwellAreaColour\":{\"use\":\"fixed\"}", link);
    receive("vista", packet(header(5, 1), 5_000));
    assertThat(areaStyle().strokeColor()).isEqualTo("#7EF26A");
    useSettings("", link);
    receive("vista", packet(header(5, 1), 6_000));
    receive("vista", jobPacket(header(5, 1), BOX)); // the corners change back: the coverage is written
    assertThat(areaStyle().strokeColor()).isEqualTo("#7EF26A");
    assertThat(coverageStyle().strokeColor()).isEqualTo("#BDCF3D");
  }

  @Test
  void criterion34_aRunningLinkTakesTheColoursWithoutAReconnect() throws Exception {
    loopback();
    ChannelId channel = ctx.channels().offered().getFirst().id();
    var area = new Geometry.ArcBand(Position.of(18.3, 57.4), 20_000, 150_000, 45, 135);
    Instant time = Instant.parse("2026-11-12T10:00:00Z");
    UUID sensor = UUID.randomUUID();
    ctx.channels().deliver(channel, new ChannelItem.SensorReport(sensor, Position.of(18.3, 57.4, 8_000.0), time, area, List.of()));
    ctx.runUntilIdle();
    waitUntil(() -> coverage() != null);
    assertThat(areaStyle().strokeColor()).as("the default, fixed (M8, T-189)").isEqualTo("#7EF26A");

    String out = "{\"name\":\"sim-out\",\"mode\":\"tcp-server\",\"direction\":\"out\",\"listen\":{\"port\":" + loopbackPort + "}}";
    String in = "{\"name\":\"loop-in\",\"host\":\"127.0.0.1\",\"port\":" + loopbackPort + "}";
    useSettings(",\"dwellAreaColour\":{\"use\":\"fixed\",\"colour\":\"#FF00FF\"}", out, in);
    ctx.channels().deliver(channel, new ChannelItem.SensorReport(sensor, Position.of(18.3, 57.4, 8_000.0), time.plusSeconds(10), area, List.of()));
    ctx.runUntilIdle();
    waitUntil(() -> "#FF00FF".equals(areaStyle().strokeColor()));
    assertThat(objects("gmti.platform")).as("one platform and its coverage").hasSize(2);
    assertThat(objects("gmti.dwell-area")).as("an area per report").hasSize(2);
    assertThat(ctx.connectionTask("loop-in").restarts()).as("no reconnect").isZero();
    assertThat(ctx.connectionTask("sim-out").restarts()).isZero();
  }

  // ---------------------------------------------------------------- criterion 36, the display classes (SDK 1.6.0 part D, T-182)

  @Test
  void criterion36_everyDwellAreaAndCoverageCarriesItsDisplayClass_platformsAndDetectionsNone() {
    useLinks(offLink("vista", ""));
    receive("vista", packet(header(5, 129), 1_000, 19.91, 55.01)); // revisit 0, with a detection
    receive("vista", jobPacket(header(5, 129), BOX));
    receive("vista", revisitPacket(4, 0, false)); // dwell 0 again, of another revisit: an area of its own (M8, T-195)
    receive("vista", revisitPacket(4, 1, true));
    receive("vista", jobPacket(header(5, 129), OTHER_BOX)); // new corners: the coverage updated

    List<MapObject> platform = objects("gmti.platform");
    assertThat(objects("gmti.dwell-area")).filteredOn(o -> o.meta().externalRef().id().contains("/area/"))
        .as("revisit 0's dwell and revisit 4's two").hasSize(3)
        .allSatisfy(o -> assertThat(o.content().displayClass()).isEqualTo(DisplayClass.DWELL_AREA))
        .allSatisfy(o -> assertThat(o.version()).as("never updated").isEqualTo(1));
    assertThat(platform).filteredOn(o -> o.meta().externalRef().id().endsWith("/coverage")).singleElement().satisfies(o -> {
      assertThat(o.content().displayClass()).isEqualTo(DisplayClass.SENSOR_COVERAGE);
      assertThat(o.version()).as("updated with the new corners").isGreaterThan(1);
    });
    assertThat(platform).filteredOn(o -> o.content().type().equals(MapObjectContent.SYMBOL)).singleElement()
        .satisfies(o -> assertThat(o.content().displayClass()).as("the platform: none").isNull());
    assertThat(objects("gmti.detection")).isNotEmpty().allSatisfy(o -> assertThat(o.content().displayClass()).as("a detection: none").isNull());
  }

  // ---------------------------------------------------------------- criteria 38 to 40, the fades in steps (T-192, CR-0042 option A)

  @Test
  void criterion39_eachDwellDrawsANewArea_aGmtiDwellAreaWithItsDwellsTime_theOldOneFadesOn() {
    useLinks(offLink("vista", ""));
    receive("vista", packet(header(5, 129), 1_000, 19.91, 55.01));
    receive("vista", packet(header(5, 129), 9_000)); // the next dwell, 8 s later, without reports
    Instant detected = objects("gmti.detection").getFirst().content().time().observed();
    assertThat(objects("gmti.dwell-area")).as("M8, T-195: the older area stays, with its own time, and fades on")
        .extracting(o -> o.content().time().observed()).containsExactlyInAnyOrder(detected, detected.plusSeconds(8));
    assertThat(objects("gmti.dwell-area")).allSatisfy(o -> assertThat(o.version()).isEqualTo(1));
    assertThat(objects("gmti.platform")).as("the platform keeps its own type and expiry fade").singleElement()
        .satisfies(o -> assertThat(o.content().type()).isEqualTo(MapObjectContent.SYMBOL));
  }

  @Test
  void criterion40_aFadeThatEndsBeforeItStartsIsNamedInTheStatus_aGoodOrAnOffOneIsNot() {
    String link = offLink("vista", "");
    useSettings(",\"detectionFade\":{\"on\":true,\"fromSeconds\":0,\"stepPercent\":50,\"invisibleAtSeconds\":20}", link);
    assertThat(ctx.effectiveStatus().detail()).as("criterion 40's fade").doesNotContain("Fade");

    // The schema cannot say that the end is above the start (model rule 22): the map view draws no steps, and the status says why.
    useSettings(",\"dwellAreaFade\":{\"on\":true,\"fromSeconds\":60,\"stepPercent\":5,\"invisibleAtSeconds\":60}", link);
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    assertThat(ctx.effectiveStatus().detail())
        .startsWith("dwellAreaFade: invisibleAtSeconds 60 is not above fromSeconds 60, so there is no fade in steps; vista [in tcp-client");

    useSettings(",\"dwellAreaFade\":{\"on\":false,\"fromSeconds\":60,\"stepPercent\":5,\"invisibleAtSeconds\":10}", link);
    assertThat(ctx.effectiveStatus().detail()).as("off: nothing to name").doesNotContain("Fade");
    assertThat(ctx.effectiveStatus().state()).isNotEqualTo(PluginState.DEGRADED);
  }

  // ---------------------------------------------------------------- criteria 24 to 26, out (T-168, T-169, CR-0040)

  @Test
  void criterion24_theJobAreaComesBackAsTheCoverage() throws Exception {
    loopback();
    ChannelId channel = ctx.channels().offered().getFirst().id();
    List<Position> corners = List.of(Position.of(15.10, 58.30), Position.of(15.50, 58.30), Position.of(15.50, 58.10), Position.of(15.10, 58.10));
    var ring = new ArrayList<>(corners);
    ring.add(corners.getFirst());
    var sensor = new ChannelItem.Sensor("Hawk 1", null, Duration.ofSeconds(10), null, null, null, 1.0, 0.0, null)
        .withType(SensorType.GROUND_RADAR).withJobArea(new Geometry.Polygon(List.of(ring)));
    var area = new Geometry.ArcBand(Position.of(15.3, 57.4), 20_000, 150_000, 330, 30);
    ctx.channels().deliver(channel, new ChannelItem.SensorReport(UUID.randomUUID(), Position.of(15.3, 57.4, 8_000.0), Instant.parse("2026-11-10T10:00:00Z"),
        area, List.of(), sensor));
    ctx.runUntilIdle();
    waitUntil(() -> coverage() != null);
    List<Position> back = ((Geometry.Polygon) Objects.requireNonNull(coverage()).content().geometry()).rings().getFirst();
    for (Position c : corners) {
      assertThat(back).as("the tasked area's corner %s", c).anySatisfy(p -> {
        assertThat(p.longitude()).isCloseTo(c.longitude(), within(1e-6));
        assertThat(p.latitude()).isCloseTo(c.latitude(), within(1e-6));
      });
    }
  }

  @Test
  void criterion25_theChannelTakesGroundRadars_aGenericReportIsNotSentAndCounted_oneWithoutATypeIs() throws Exception {
    try (var peer = new DatagramSocket(0, InetAddress.getLoopbackAddress())) {
      useLinks("{\"name\":\"sim-out\",\"mode\":\"udp\",\"direction\":\"out\",\"host\":\"127.0.0.1\",\"port\":" + peer.getLocalPort() + "}");
      waitUntil(() -> ctx.effectiveStatus().detail().contains("]: up"));
      ChannelInfo info = ctx.channels().offered().getFirst();
      assertThat(info.sensorTypes()).containsExactly(SensorType.GROUND_RADAR);
      assertThat(info.takesSensorType(SensorType.GENERIC)).isFalse();
      var area = new Geometry.ArcBand(Position.of(18.3, 57.4), 20_000, 150_000, 45, 135);
      Instant time = Instant.parse("2026-11-10T10:00:00Z");
      var generic = new ChannelItem.Sensor("Watcher", null, Duration.ofSeconds(10), null, null, null, 1.0, 0.0, null).withType(SensorType.GENERIC);
      ctx.channels().deliver(info.id(), new ChannelItem.SensorReport(UUID.randomUUID(), Position.of(18.3, 57.4, 8_000.0), time, area, List.of(), generic));
      ctx.runUntilIdle();
      waitUntil(() -> ctx.connectionTask("sim-out").counter("not a ground radar") == 1);
      ctx.channels().deliver(info.id(), new ChannelItem.SensorReport(UUID.randomUUID(), Position.of(18.3, 57.4, 8_000.0), time, area, List.of()));
      ctx.runUntilIdle();
      Packet first = Decoder.decode(datagram(peer)).packet();
      assertThat(first.header().platformId().strip()).as("the report without a type, as in M5 (the generic one sent nothing)").startsWith("SIM");
    }
  }

  @Test
  void criterion26_aRevisitsThreeDwellsGoAsThree_noneLost() throws Exception {
    try (var peer = new DatagramSocket(0, InetAddress.getLoopbackAddress())) {
      useLinks("{\"name\":\"sim-out\",\"mode\":\"udp\",\"direction\":\"out\",\"host\":\"127.0.0.1\",\"port\":" + peer.getLocalPort() + "}");
      waitUntil(() -> ctx.effectiveStatus().detail().contains("]: up"));
      ChannelId channel = ctx.channels().offered().getFirst().id();
      var area = new Geometry.ArcBand(Position.of(18.3, 57.4), 20_000, 150_000, 45, 135);
      var radar = new ChannelItem.Sensor("Hawk 1", null, Duration.ofSeconds(10), null, null, null, 1.0, 0.0, null).withType(SensorType.GROUND_RADAR);
      UUID sensor = UUID.randomUUID();
      Instant time = Instant.parse("2026-11-10T10:00:00Z");
      // All three before the worker runs: the channel's inbox keeps one per sensor and dwell number (the link's own inbox
      // key is InboxKeyTest's: over UDP the task is too quick for that inbox to replace anything)
      for (var q : List.of(new ChannelItem.SensorReport.Sequence(7, 0, false), new ChannelItem.SensorReport.Sequence(7, 1, false),
          new ChannelItem.SensorReport.Sequence(7, 2, true))) {
        ctx.channels().deliver(channel, new ChannelItem.SensorReport(sensor, Position.of(18.3, 57.4, 8_000.0), time.plusMillis(100L * q.dwell()), area,
            List.of(), radar).withSequence(q));
      }
      ctx.runUntilIdle();
      var dwells = new ArrayList<Dwell>();
      while (dwells.size() < 3) {
        Packet p = Decoder.decode(datagram(peer)).packet();
        p.segments().stream().filter(x -> x instanceof Dwell).map(x -> (Dwell) x).forEach(dwells::add);
      }
      assertThat(dwells).extracting(Dwell::revisitIndex).containsExactly(7, 7, 7);
      assertThat(dwells).extracting(Dwell::dwellIndex).containsExactly(0, 1, 2);
      assertThat(dwells).extracting(Dwell::lastDwell).containsExactly(false, false, true);
      assertThat(ctx.connectionTask("sim-out").counter("dwells dropped")).isZero();
    }
  }

  @Test
  void criterion5_eachDetectionIsPairedWithItsPlatform_fromTheLinksFirstDwell() {
    useLinks(offLink("vista", ""));
    // One packet: the platform's create and the detections are written in the same handler call.
    receive("vista", packet(header(5, 129), 1_000, 19.91, 55.01, 19.92, 55.02, 19.93, 55.03));
    MapObject platform = objects("gmti.platform").stream().filter(o -> o.content().type().equals(MapObjectContent.SYMBOL)).findFirst().orElseThrow();
    assertThat(objects("gmti.detection")).hasSize(3).allSatisfy(o ->
        assertThat(o.content().relations()).containsExactly(new dev.emcc.sdk.model.Relation("gmti.pairing", platform.id())));
    assertThat(platform.content().relations()).as("the platform carries none").isEmpty();
    assertThat(ctx.store().objects().stream().filter(o -> o.content().type().equals(MapObjectContent.SHAPE)).findFirst().orElseThrow()
        .content().relations()).as("nor its area").isEmpty();
  }

  @Test
  void criterion5_afterARestartNewDetectionsPairWithTheSamePlatformObject() {
    useLinks(offLink("vista", ""));
    receive("vista", packet(header(5, 129), 1_000, 19.91, 55.01));
    UUID platform = objects("gmti.platform").stream().filter(o -> o.content().type().equals(MapObjectContent.SYMBOL)).findFirst().orElseThrow().id();
    ctx.store().restart();
    ctx.restart(plugin.links());
    useLinks(offLink("vista", ""));
    receive("vista", packet(header(5, 129), 2_000, 19.95, 55.05));
    assertThat(objects("gmti.detection")).hasSize(2).allSatisfy(o ->
        assertThat(o.content().relations()).extracting(dev.emcc.sdk.model.Relation::objectId).containsExactly(platform));
  }

  @Test
  void criterion5_theSameReportTwiceIsOneObject_andItIsNeverUpdated() {
    useLinks(offLink("vista", ""));
    receive("vista", packet(header(5, 129), 1_000, 19.91, 55.01));
    receive("vista", packet(header(5, 129), 1_000, 19.91, 55.01));
    assertThat(objects("gmti.detection")).hasSize(1);
    assertThat(objects("gmti.detection").getFirst().version()).isEqualTo(1);
  }

  /** The link's object with this external id. */
  MapObject byRef(String externalId) {
    return ctx.store().objects().stream().filter(o -> o.meta().externalRef() != null && o.meta().externalRef().id().equals(externalId))
        .findFirst().orElseThrow();
  }

  /** {@code content} in another layer. */
  static MapObjectContent inLayer(MapObjectContent c, UUID layerId) {
    return new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), layerId, c.geometry(), c.symbol(), c.style(),
        c.properties(), c.label(), c.extensions(), c.fieldSets(), c.relations());
  }

  @Test
  void criterion32_aMovedPlatformIsUpdatedInItsNewLayer_aNewOneAndItsAreaGoToTheLinksLayer_aCopyIsNotUpdated() {
    useLinks(offLink("vista", ""));
    receive("vista", packet(header(5, 129), 1_000, 19.91, 55.01));
    UUID links = ctx.store().layers().getFirst().id();
    Layer mine = ctx.store().seedLayer("My platforms");
    // A user's "Move to layer…" (ADR-0053): an update with another layerId
    MapObject before = byRef("vista/PLATFORM01");
    assertThat(ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.updateObject(before, inLayer(before.content(), mine.id()))))
        .isInstanceOf(ChangeOutcome.Applied.class);
    // A user's "Copy to layer…" (ADR-0053 point 3): a create without an external identity, here even in the link's layer
    UUID copyId = UUID.randomUUID();
    MapObjectContent copy = inLayer(before.content(), links);
    assertThat(ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.createObject(copyId, copy))).isInstanceOf(ChangeOutcome.Applied.class);
    ctx.runUntilIdle();

    receive("vista", packet(header(5, 129), 2_000, 19.92, 55.02));
    receive("vista", packet(new PacketHeader("30", "US", 5, "XN", 0, 129, "PLATFORM02", 1, 8), 3_000, 19.93, 55.03));
    MapObject after = byRef("vista/PLATFORM01");
    assertThat(after.version()).as("updated by the next report").isGreaterThan(before.version() + 1);
    assertThat(after.content().time().observed()).isAfter(before.content().time().observed());
    assertThat(after.content().layerId()).as("where the user put it").isEqualTo(mine.id());
    assertThat(objects("gmti.dwell-area")).as("its dwell areas in the link's layer as before, and the new platform's")
        .filteredOn(o -> o.meta().externalRef().id().startsWith("vista/PLATFORM01/area/")).hasSize(2)
        .allSatisfy(o -> assertThat(o.content().layerId()).isEqualTo(links));
    assertThat(byRef("vista/PLATFORM02").content().layerId()).as("a new platform in the link's layer").isEqualTo(links);
    assertThat(objects("gmti.dwell-area")).filteredOn(o -> o.meta().externalRef().id().startsWith("vista/PLATFORM02/area/")).singleElement()
        .satisfies(o -> assertThat(o.content().layerId()).isEqualTo(links));
    assertThat(objects("gmti.detection")).hasSize(3).allSatisfy(o -> assertThat(o.content().layerId()).isEqualTo(links));
    MapObject copied = ctx.store().objects().stream().filter(o -> o.id().equals(copyId)).findFirst().orElseThrow();
    assertThat(copied.version()).as("a copy is never updated").isEqualTo(1);
    assertThat(copied.content()).isEqualTo(copy);
    assertThat(ctx.store().objects()).as("nor taken for the platform").filteredOn(o -> o.content().type().equals(MapObjectContent.SYMBOL)
        && o.content().dataType().equals("gmti.platform")).hasSize(3);
  }

  @Test
  void criterion7_theClassificationMapsAndLinkLabelReplacesIt() {
    useLinks(offLink("afsers", ""));
    receive("afsers", packet(header(2, 1), 1_000, 19.91, 55.01));
    assertThat(objects("gmti.detection").getFirst().content().label()).isEqualTo(SecurityLabel.of("NATO", "SECRET"));

    useLinks(offLink("afsers", ",\"classification\":\"link-label\",\"label\":{\"policy\":\"NATO\",\"classification\":\"RESTRICTED\"}"));
    receive("afsers", packet(header(2, 1), 2_000, 19.92, 55.02));
    assertThat(objects("gmti.detection")).extracting(o -> o.content().label().classification()).containsExactlyInAnyOrder("SECRET", "RESTRICTED");
  }

  @Test
  void aPacketAboveTheLayersLabelIsWrittenAndCounted_anUnmappableOneGetsTheLinksLabel() {
    useLinks(offLink("vista", ""));
    receive("vista", packet(header(2, 1), 1_000, 19.91, 55.01));
    receive("vista", packet(header(9, 1), 2_000, 19.92, 55.02));
    assertThat(objects("gmti.detection")).extracting(o -> o.content().label().classification()).containsExactlyInAnyOrder("SECRET", "UNCLASSIFIED");
  }

  @Test
  void criterion13_aLinkIsAddedChangedAndRemovedAtRuntime_aChangedCapAppliesWithoutAReconnect() throws Exception {
    try (var server = new ServerSocket(0, 5, InetAddress.getLoopbackAddress())) {
      String link = "{\"name\":\"feed\",\"host\":\"127.0.0.1\",\"port\":" + server.getLocalPort() + ",\"maxReportsPerDwell\":1";
      useLinks(link + "}");
      server.setSoTimeout(10_000);
      try (Socket conn = server.accept()) {
        waitUntil(() -> ctx.effectiveStatus().detail().contains("feed [in tcp-client to 127.0.0.1:" + server.getLocalPort() + "]: up"));
        receive("feed", packet(header(5, 1), 1_000, 19.91, 55.01, 19.92, 55.02));
        assertThat(objects("gmti.detection")).as("the cap of 1").hasSize(1);

        useLinks(link.replace("\"maxReportsPerDwell\":1", "\"maxReportsPerDwell\":10,\"classification\":\"link-label\"") + "}");
        receive("feed", packet(header(2, 1), 2_000, 19.93, 55.03, 19.94, 55.04));
        assertThat(objects("gmti.detection")).as("the new cap, at once").hasSize(3);
        assertThat(ctx.connectionTask("feed").restarts()).as("no reconnect").isZero();
        assertThat(ctx.effectiveStatus().detail()).contains("]: up");
      }
    }
    useLinks();
    assertThat(ctx.effectiveStatus().detail()).isEqualTo("no links");
  }

  @Test
  void criterion13_aNewLayerIsMadeOnceForTwoLinksAndKeptAfterARestart() {
    String target = ",\"targetLayer\":{\"name\":\"GMTI\"}";
    useLinks(offLink("one", target), offLink("two", target));
    receive("one", packet(header(5, 1), 1_000, 19.91, 55.01));
    receive("two", packet(new PacketHeader("30", "US", 5, "XN", 0, 1, "OTHER", 1, 7), 1_000, 19.95, 55.05));
    assertThat(ctx.store().layers()).extracting(l -> l.content().name()).containsExactly("GMTI");

    ctx.store().restart();
    ctx.restart(plugin.links());
    useLinks(offLink("one", target), offLink("two", target));
    receive("one", packet(header(5, 1), 3_000, 19.97, 55.07));
    assertThat(ctx.store().layers()).as("kept after the restart").hasSize(1);
    assertThat(objects("gmti.platform").stream().filter(o -> o.meta().externalRef().id().equals("one/PLATFORM01")).count())
        .as("the platform found again").isEqualTo(1);
  }

  @Test
  void anEndedJobKeepsItsAreas_theyGoAtTheirExpiry() {
    useLinks(offLink("vista", ""));
    receive("vista", packet(header(5, 1), 1_000));
    assertThat(objects("gmti.platform")).hasSize(1);
    assertThat(objects("gmti.dwell-area")).hasSize(1);
    receive("vista", endOfJob(header(5, 1)));
    assertThat(objects("gmti.platform")).extracting(o -> o.content().type()).containsExactly(MapObjectContent.SYMBOL);
    assertThat(objects("gmti.dwell-area")).as("M8, T-195: J5 255 no longer removes them").hasSize(1);
  }

  // ---------------------------------------------------------------- out

  static ChannelItem.Detection detection(Position at, SecurityLabel label) {
    var content = new MapObjectContent(MapObjectContent.SYMBOL, MapObjectContent.GENERAL, "manual", new TimeAttributes(Instant.EPOCH, null, null),
        UUID.randomUUID(), new Geometry.Point(at), new Symbol(SymbolStandard.APP_6D, "10061500330000000000", Modifiers.builder().speed(5).direction(90).build()),
        null, null, label, Extensions.empty());
    return new ChannelItem.Detection(UUID.randomUUID(), content);
  }

  @Test
  void criterion10_anOutLinksChannelTakesSensorReportsOnly_aGroundTruthItemIsRefusedByTheSdk() {
    useLinks("{\"name\":\"sim-out\",\"mode\":\"udp\",\"direction\":\"out\",\"host\":\"127.0.0.1\",\"port\":9}");
    List<ChannelInfo> offered = ctx.channels().offered();
    assertThat(offered).hasSize(1);
    ChannelInfo info = offered.getFirst();
    assertThat(info.kinds()).containsExactly(ChannelKind.SENSOR_REPORTS);
    assertThat(info.fieldSet()).isEqualTo("gmti.report");
    assertThat(info.maxAreaDepth()).as("criterion 19: the depth D26 holds (CR-0035)").isEqualTo(511_980.0);
    var truth = new ChannelItem.Update(UUID.randomUUID(), detection(SENSOR, SecurityLabel.of("NATO", "UNCLASSIFIED")).content());
    assertThatThrownBy(() -> ctx.channels().deliver(info.id(), truth)).isInstanceOf(IllegalArgumentException.class);
    useLinks();
    assertThat(ctx.channels().offered()).as("withdrawn with its link").isEmpty();
  }

  @Test
  void criterion9_aSimulatorDwellComesBackThroughAnInLinkOnLoopback() throws Exception {
    loopback();
    ChannelId channel = ctx.channels().offered().getFirst().id();
    Instant time = Instant.parse("2026-11-07T10:00:00.250Z");
    Position platform = Position.of(18.3, 57.4, 8_000.0);
    var area = new Geometry.ArcBand(Position.of(18.3, 57.4), 20_000, 150_000, 45, 135);
    Position a = Geodesy.direct(Position.of(18.3, 57.4), 80, 40_000);
    Position b = Geodesy.direct(Position.of(18.3, 57.4), 100, 60_000);
    Position c = Geodesy.direct(Position.of(18.3, 57.4), 120, 90_000);
    SecurityLabel u = SecurityLabel.of("NATO", "UNCLASSIFIED");
    UUID sensor = UUID.randomUUID();
    ctx.channels().deliver(channel, new ChannelItem.SensorReport(sensor, platform, time, area, List.of(detection(a, u), detection(b, u), detection(c, u))));
    ctx.runUntilIdle();
    waitUntil(() -> objects("gmti.detection").size() == 3);

    var back = new ArrayList<Position>();
    for (MapObject o : objects("gmti.detection")) {
      back.add(((Geometry.Point) o.content().geometry()).coordinates());
      assertThat(o.content().extensions().get("gmti").getString("classification")).isEqualTo("tracked vehicle, simulated (129)");
      assertThat(o.content().time().observed()).isCloseTo(time, within(Duration.ofSeconds(1)));
      assertThat(o.content().symbol().sidc().charAt(2)).as("simulation").isEqualTo('2');
    }
    assertThat(back).anySatisfy(p -> {
      assertThat(p.longitude()).isCloseTo(c.longitude(), within(1e-6));
      assertThat(p.latitude()).isCloseTo(c.latitude(), within(1e-6));
    });
    MapObject shape = objects("gmti.dwell-area").stream().filter(o -> o.content().geometry() instanceof Geometry.ArcBand).findFirst().orElseThrow();
    var band = (Geometry.ArcBand) shape.content().geometry();
    assertThat(band.innerRadius()).isCloseTo(20_000, within(20.0));
    assertThat(band.outerRadius()).isCloseTo(150_000, within(20.0));
    assertThat(band.startBearing()).isCloseTo(45, within(0.02));
    assertThat(band.endBearing()).isCloseTo(135, within(0.02));

    // An empty dwell moves the platform and the area only.
    Position moved = Position.of(18.4, 57.45, 8_000.0);
    ctx.channels().deliver(channel, new ChannelItem.SensorReport(sensor, moved, time.plusSeconds(10), area, List.of()));
    ctx.runUntilIdle();
    waitUntil(() -> objects("gmti.platform").stream().anyMatch(o -> o.content().type().equals(MapObjectContent.SYMBOL)
        && Math.abs(((Geometry.Point) o.content().geometry()).coordinates().longitude() - 18.4) < 1e-6));
    assertThat(objects("gmti.detection")).hasSize(3);
  }

  @Test
  void criterion21_aSimulatedSensorComesBackAsItsSectorInsideTheDashedBox_offRemovesTheBox() throws Exception {
    loopback(); // gmti out with oneSegmentPerPacket on, its default (owner MY)
    ChannelId channel = ctx.channels().offered().getFirst().id();
    Instant time = Instant.parse("2026-11-07T10:00:00Z");
    var area = new Geometry.ArcBand(Position.of(18.3, 57.4), 20_000, 150_000, 45, 135);
    SecurityLabel u = SecurityLabel.of("NATO", "UNCLASSIFIED");
    ctx.channels().deliver(channel, new ChannelItem.SensorReport(UUID.randomUUID(), Position.of(18.3, 57.4, 8_000.0), time, area,
        List.of(detection(Geodesy.direct(Position.of(18.3, 57.4), 90, 60_000), u))));
    ctx.runUntilIdle();
    waitUntil(() -> coverage() != null && objects("gmti.detection").size() == 1);

    MapObject box = Objects.requireNonNull(coverage());
    assertThat(box.content().dataType()).isEqualTo("gmti.platform");
    assertThat(box.content().style().strokeDash()).isEqualTo(Style.Dash.DASH);
    assertThat(box.content().style().strokeWidth()).isEqualTo(1.5);
    List<Position> ring = ((Geometry.Polygon) box.content().geometry()).rings().getFirst();
    double west = ring.stream().mapToDouble(Position::longitude).min().orElseThrow();
    double east = ring.stream().mapToDouble(Position::longitude).max().orElseThrow();
    double south = ring.stream().mapToDouble(Position::latitude).min().orElseThrow();
    double north = ring.stream().mapToDouble(Position::latitude).max().orElseThrow();
    MapObject sector = objects("gmti.dwell-area").stream().filter(o -> o.content().geometry() instanceof Geometry.ArcBand).findFirst().orElseThrow();
    var band = (Geometry.ArcBand) sector.content().geometry();
    for (double bearing = 45; bearing <= 135; bearing += 15) {
      for (double metres : new double[] {band.innerRadius(), band.outerRadius()}) {
        Position edge = Geodesy.direct(band.center(), bearing, metres);
        assertThat(edge.longitude()).as("the sector inside the box").isBetween(west - 1e-6, east + 1e-6);
        assertThat(edge.latitude()).isBetween(south - 1e-6, north + 1e-6);
      }
    }
    assertThat(sector.content().style().strokeWidth()).as("the dwell area, 2 px solid").isEqualTo(2.0);

    String out = "{\"name\":\"sim-out\",\"mode\":\"tcp-server\",\"direction\":\"out\",\"listen\":{\"port\":" + loopbackPort + "}}";
    useLinks(out, "{\"name\":\"loop-in\",\"host\":\"127.0.0.1\",\"port\":" + loopbackPort + ",\"coverage\":false}");
    waitUntil(() -> coverage() == null);
    assertThat(ctx.connectionTask("loop-in").restarts()).as("no reconnect").isZero();
    assertThat(objects("gmti.platform")).as("the platform stays").hasSize(1);
    assertThat(objects("gmti.dwell-area")).as("and its dwell area").hasSize(1);
  }

  /** The coverage in the store, or {@code null}. */
  @Nullable MapObject coverage() {
    return objects("gmti.platform").stream().filter(o -> o.content().geometry() instanceof Geometry.Polygon).findFirst().orElse(null);
  }

  @Test
  void criterion22_overUdpFourDatagrams_offOneWithoutAReconnect() throws Exception {
    try (var peer = new DatagramSocket(0, InetAddress.getLoopbackAddress())) {
      peer.setSoTimeout(5_000);
      String on = "{\"name\":\"sim-out\",\"mode\":\"udp\",\"direction\":\"out\",\"host\":\"127.0.0.1\",\"port\":" + peer.getLocalPort() + "}";
      useLinks(on);
      waitUntil(() -> ctx.effectiveStatus().detail().contains("sim-out [out udp to 127.0.0.1:" + peer.getLocalPort() + "]: up"));
      ChannelId channel = ctx.channels().offered().getFirst().id();
      var area = new Geometry.ArcBand(Position.of(18.3, 57.4), 20_000, 150_000, 45, 135);
      SecurityLabel u = SecurityLabel.of("NATO", "UNCLASSIFIED");
      var detections = new ArrayList<ChannelItem.Detection>();
      for (int i = 0; i < 130; i++) {
        detections.add(detection(Geodesy.direct(Position.of(18.3, 57.4), 90, 30_000 + i * 100), u));
      }
      UUID sensor = UUID.randomUUID();
      Instant time = Instant.parse("2026-11-07T10:00:00Z");
      ctx.channels().deliver(channel, new ChannelItem.SensorReport(sensor, Position.of(18.3, 57.4, 8_000.0), time, area, detections));
      ctx.runUntilIdle();
      var types = new ArrayList<Integer>();
      for (int i = 0; i < 4; i++) {
        Packet p = Decoder.decode(datagram(peer)).packet();
        assertThat(p.segments()).hasSize(1);
        types.add(p.segments().getFirst().type());
      }
      assertThat(types).as("criterion 22: four datagrams").containsExactly(1, 5, 2, 2);

      useLinks(on.replace("}", ",\"oneSegmentPerPacket\":false}"));
      ctx.channels().deliver(channel, new ChannelItem.SensorReport(sensor, Position.of(18.3, 57.4, 8_000.0), time.plusSeconds(10), area, detections));
      ctx.runUntilIdle();
      Packet one = Decoder.decode(datagram(peer)).packet();
      assertThat(one.segments()).extracting(Segment::type).as("off: one datagram from the next report").containsExactly(1, 2, 2);
      assertThat(ctx.connectionTask("sim-out").restarts()).as("no reconnect").isZero();
    }
  }

  /** The next datagram {@code peer} receives, waiting while the worker runs. */
  byte[] datagram(DatagramSocket peer) throws Exception {
    var packet = new DatagramPacket(new byte[65_535], 65_535);
    long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
    peer.setSoTimeout(50);
    while (true) {
      ctx.runUntilIdle();
      try {
        peer.receive(packet);
        return java.util.Arrays.copyOf(packet.getData(), packet.getLength());
      } catch (java.net.SocketTimeoutException e) {
        if (System.nanoTime() > deadline) {
          throw new AssertionError("no datagram in 15 s; status: " + ctx.effectiveStatus().detail());
        }
      }
    }
  }

  @Test
  void criterion17_theSensorsNameAndValuesComeBackThroughAnInLink() throws Exception {
    loopback();
    ChannelId channel = ctx.channels().offered().getFirst().id();
    Instant time = Instant.parse("2026-11-07T10:00:00Z");
    Position platform = Position.of(18.3, 57.4, 8_000.0);
    var area = new Geometry.ArcBand(Position.of(18.3, 57.4), 20_000, 150_000, 45, 135);
    var sensor = new ChannelItem.Sensor("Spaning Hög 1", "ATO-2611-BRAVO", Duration.ofSeconds(10), 20.0, 50.0, 1.5, 0.9, 45.0, 120.0);
    SecurityLabel u = SecurityLabel.of("NATO", "UNCLASSIFIED");
    ctx.channels().deliver(channel, new ChannelItem.SensorReport(UUID.randomUUID(), platform, time, area,
        List.of(detection(Geodesy.direct(Position.of(18.3, 57.4), 90, 60_000), u)), sensor));
    ctx.runUntilIdle();
    waitUntil(() -> objects("gmti.detection").size() == 1);

    MapObject p = objects("gmti.platform").stream().filter(o -> o.content().type().equals(MapObjectContent.SYMBOL)).findFirst().orElseThrow();
    assertThat(p.content().properties().name()).as("P8").isEqualTo("Spaning H?");
    assertThat(p.content().symbol().modifiers().direction()).as("D15").isCloseTo(45.0, within(0.006));
    assertThat(p.content().symbol().modifiers().speed()).as("D16").isEqualTo(120.0);
    JsonObject gmti = p.content().extensions().get("gmti");
    assertThat(gmti.getString("missionPlan")).as("M1, criterion 20").isEqualTo("ATO-2611-BRA");
    assertThat(gmti.getNumber("missionId").longValueExact()).as("P9, the mission's CRC-32").isEqualTo(1_044_403_554L);
    JsonObject job = gmti.getObject("job");
    assertThat(job.getNumber("revisitInterval").doubleValue()).as("J15 100 ds").isEqualTo(10.0);
    assertThat(job.getNumber("slantRangeError").doubleValue()).as("J21 2 000 cm").isEqualTo(20.0);
    assertThat(job.getNumber("minimumDetectableVelocity").doubleValue()).as("J24 15 dm/s").isEqualTo(1.5);
    assertThat(job.getNumber("detectionProbability").longValueExact()).as("J25").isEqualTo(90L);
    assertThat(job.getNumber("crossRangeError").doubleValue()).as("J22, an angle").isCloseTo(Math.toDegrees(Math.atan2(50, 85_000)), within(0.006));
  }

  @Test
  void criterion11_withThePeerNotReadingNewerDwellsReplaceWaitingOnesAndTheDropsAreCounted() throws Exception {
    int port;
    try (var probe = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
      port = probe.getLocalPort();
    }
    useLinks("{\"name\":\"sim-out\",\"mode\":\"tcp-server\",\"direction\":\"out\",\"listen\":{\"port\":" + port + "}}");
    waitUntil(() -> ctx.effectiveStatus().detail().contains("listening"));
    try (Socket peer = new Socket()) {
      peer.setReceiveBufferSize(4_096); // before connecting, so that the window is small from the start
      peer.connect(new InetSocketAddress(InetAddress.getLoopbackAddress(), port));
      waitUntil(() -> ctx.effectiveStatus().detail().contains("1 client"));
      var server = ctx.connectionTask("sim-out");
      var writer = ctx.connectionTask("sim-out/accept/client-1");
      int dwells = 2_000; // 120 MB, far more than the sockets' buffers hold
      // The writer takes the first dwell before any other is sent, so that it counts every later gap.
      sendNumbered(0);
      waitUntil(() -> writer.posted().size() == 1 && writer.inbox().isEmpty());
      // The peer reads nothing: the buffers fill, the writer waits in its write, and newer dwells replace
      // waiting ones in the client's own inbox. The server's task forwards each dwell before the next is
      // sent, so that its inbox (which keeps the latest too) replaces none.
      for (int i = 1; i < dwells; i++) {
        sendNumbered(i);
        server.awaitIdle();
      }
      assertThat(writer.posted()).as("every dwell reached the client's writer").hasSize(dwells);
      // Now the peer reads: what waited goes out, and the newest dwell is the last to arrive.
      peer.setSoTimeout(15_000);
      var in = new DataInputStream(peer.getInputStream());
      List<Integer> received = new ArrayList<>();
      while (received.isEmpty() || received.getLast() != dwells - 1) {
        byte[] packet = new byte[NUMBERED_SIZE];
        in.readFully(packet);
        received.add(ByteBuffer.wrap(packet).getInt(6));
      }
      waitUntil(() -> writer.counter("dwells out") == received.size());
      long dropped = writer.counter("dwells dropped");
      assertThat(received.getFirst()).isZero();
      assertThat(received).as("in order, each dwell at most once").isSorted().doesNotHaveDuplicates();
      assertThat(received.size()).as("the socket's buffers took a few").isLessThan(dwells);
      assertThat(dropped).as("the dwells replaced while they waited").isEqualTo(dwells - received.size()).isPositive();
      waitUntil(() -> ctx.effectiveStatus().detail().contains("dwells sent a minute, " + dropped + " dropped"));
    }
  }

  /** The size of {@link #sendNumbered}'s packets: large, so that few fill the sockets' buffers. */
  static final int NUMBERED_SIZE = 60_000;

  /** Sends one dwell of one large packet to the link "sim-out", with {@code n} in its bytes 6 to 9. */
  void sendNumbered(int n) {
    byte[] packet = new byte[NUMBERED_SIZE];
    ByteBuffer.wrap(packet).put((byte) '4').put((byte) '1').putInt(packet.length).putInt(n);
    plugin.links().send(new TransportMsg.Outgoing("sim-out", "sensor-1", List.of(Bytes.of(packet))));
    ctx.runUntilIdle();
  }

  // ---------------------------------------------------------------- helpers

  /** The port of {@link #loopback()}'s out link. */
  int loopbackPort;

  /**
   * An {@code out} link "sim-out" as a TCP server on a free loopback port, and an {@code in} link
   * "loop-in" connected to it. The {@code in} link is added only once the server listens: a client
   * refused before the bind restarts after its back-off in virtual time, which these tests do not
   * advance. Adding a link leaves the unchanged server running (criterion 13).
   */
  void loopback() throws Exception {
    int port;
    try (var probe = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
      port = probe.getLocalPort();
    }
    loopbackPort = port;
    String out = "{\"name\":\"sim-out\",\"mode\":\"tcp-server\",\"direction\":\"out\",\"listen\":{\"port\":" + port + "}}";
    useLinks(out);
    waitUntil(() -> ctx.effectiveStatus().detail().contains("sim-out [out tcp-server on 127.0.0.1:" + port + "]: listening"));
    useLinks(out, "{\"name\":\"loop-in\",\"host\":\"127.0.0.1\",\"port\":" + port + "}");
    waitUntil(() -> ctx.effectiveStatus().detail().contains("listening, 1 client") && ctx.effectiveStatus().detail().contains("loop-in [in tcp-client"));
    assertThat(ctx.connectionTask("sim-out").restarts()).as("the server kept running").isZero();
    assertThat(ctx.connectionTask("loop-in").restarts()).as("connected at the first try").isZero();
  }

  void waitUntil(BooleanSupplier condition) {
    long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
    while (true) {
      ctx.runUntilIdle();
      if (condition.getAsBoolean()) {
        return;
      }
      if (System.nanoTime() > deadline) {
        throw new AssertionError("waited 15 s; status: " + ctx.effectiveStatus().detail());
      }
      Thread.onSpinWait();
      Thread.yield();
    }
  }
}
