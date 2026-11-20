package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.TWO_LEGS;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.DataType;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelInfo;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.channel.ChannelKind;
import dev.emcc.sdk.channel.ChannelSpec;
import dev.emcc.sdk.channel.SensorType;
import dev.emcc.sdk.geo.GeodesicLeg;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.UUID;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Sensor types, the ground radar's dwells and the job area (brief functions 36 to 39; criteria 52 to
 * 59). The generic sensor is not offered in M6 (owner, PX, 2026-11-11): the server part still takes
 * it through the API, and its tests stay for the milestone that offers it. The dwells are checked with the test kit's {@code FakeChannels}, which keeps the latest report
 * per sensor and dwell number (CR-0040), as ECore does once the CDA's part 3 is in.
 */
class SensorTypesTest {

  /** The platform of criterion 55: latitude ≠ longitude. */
  static final Position PLATFORM = Position.of(15.20, 58.41);
  private static final ChannelId GMTI = new ChannelId("gmti", "vista-out");
  private static final ChannelId COT = new ChannelId("cot", "tak-sensors");
  private static final String NO_ERRORS = "\"rangeError\": 0, \"crossRangeError\": 0";

  private Rig rig = new Rig();

  // ---------------------------------------------------------------- helpers

  private UUID track(Position at, @Nullable String name, @Nullable Double direction, @Nullable Double speed) {
    UUID id = UUID.randomUUID();
    var symbol = new Symbol(SymbolStandard.APP_6D, Rig.SIDC, direction == null && speed == null ? null : new Modifiers(Map.of(), direction, speed));
    var content = new MapObjectContent(MapObjectContent.SYMBOL, DataType.GENERAL, MapObjectContent.MANUAL, null, rig.layer.id(), new Geometry.Point(at),
        symbol, null, name == null ? null : new ObjectProperties(name, null), rig.ctx.defaultLabel(), Extensions.empty());
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.createObject(id, content)));
    return id;
  }

  /** A platform heading north (0°), standing. */
  private UUID platform() {
    return track(PLATFORM, "Hawk 1", 0.0, null);
  }

  /** A standing target at {@code bearing} and {@code metres} from the platform. */
  private UUID at(double bearing, double metres) {
    return track(Geodesy.direct(PLATFORM, bearing, metres), null, null, null);
  }

  private void run() {
    UUID route = rig.route(TWO_LEGS, "{\"points\": [{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]}");
    rig.ctx.runUntilIdle();
    rig.control(route, "start");
  }

  /** A fake gmti channel taking ground radars only, and a fake cot channel taking every type (criterion 52). */
  private void offerBoth() {
    rig.ctx.channels().addOther(ChannelInfo.of("gmti", ChannelSpec.of(GMTI.link(), "VISTA (out)", "gmti").kinds(Set.of(ChannelKind.SENSOR_REPORTS))
        .sensorTypes(Set.of(SensorType.GROUND_RADAR))));
    rig.ctx.channels().addOther(ChannelInfo.of("cot", ChannelSpec.of(COT.link(), "TAK sensors (out)", "cot").kinds(Set.of(ChannelKind.SENSOR_REPORTS))));
    rig.ctx.runUntilIdle();
  }

  private FakeHttpExchange sensor(UUID platform, String settings) {
    return rig.post("/sensors", "{\"platform\": \"" + platform + "\"" + (settings.isEmpty() ? "" : ", " + settings) + "}");
  }

  private List<ChannelItem.SensorReport> reports(ChannelId to) {
    return rig.ctx.channels().sent(to).stream().filter(ChannelItem.SensorReport.class::isInstance).map(ChannelItem.SensorReport.class::cast).toList();
  }

  private List<ChannelItem.SensorReport> revisit(ChannelId to, long number) {
    return reports(to).stream().filter(r -> r.sequence() != null && r.sequence().revisit() == number).toList();
  }

  private String sensors() {
    return rig.get("/sensors").reply().body().toUtf8();
  }

  /** Whether {@code p} lies in the band, its bearings clockwise from start to end (all round when equal). */
  static boolean inside(Geometry.ArcBand band, Position p) {
    GeodesicLeg leg = Geodesy.inverse(band.center(), p);
    double d = leg.distanceMetres();
    if (d < band.innerRadius() - 1 || d > band.outerRadius() + 1) {
      return false;
    }
    double span = Detector.normal(band.endBearing() - band.startBearing());
    return span == 0 || Detector.normal(leg.initialAzimuth() - band.startBearing()) <= span + 1e-6;
  }

  /** Whether two bands share more than an edge. */
  static boolean overlap(Geometry.ArcBand a, Geometry.ArcBand b) {
    if (Math.min(a.outerRadius(), b.outerRadius()) - Math.max(a.innerRadius(), b.innerRadius()) <= 1) {
      return false;
    }
    double wa = Detector.normal(a.endBearing() - a.startBearing());
    double wb = Detector.normal(b.endBearing() - b.startBearing());
    if (wa == 0 || wb == 0) {
      return true;
    }
    double off = Detector.normal(b.startBearing() - a.startBearing());
    return off < wa - 1e-6 || off > 360 - wb + 1e-6;
  }

  private static final String SQUARE = "{\"type\": \"Polygon\", \"coordinates\": [[[15.0, 58.6], [15.6, 58.6], [15.6, 59.2], [15.0, 59.2], [15.0, 58.6]]]}";

  // ---------------------------------------------------------------- criterion 52

  @Test
  @DisplayName("Criterion 52 (its generic part kept for later, owner PX): a ground radar and, through the API, a generic sensor; each report says which; a gmti channel taking ground radars is offered to a ground radar only, a cot channel taking every type to both")
  void typesAndOutputs() {
    UUID radar = platform();
    UUID generic = track(Position.of(16.1, 59.3), "Watcher", null, null);
    rig.started();
    offerBoth();
    Rig.ok(sensor(radar, "\"create\": true, \"type\": \"GROUND_RADAR\", \"outputs\": [\"gmti/vista-out\", \"cot/tak-sensors\"]"));
    FakeHttpExchange refused = sensor(generic, "\"create\": true, \"type\": \"GENERIC\", \"outputs\": [\"gmti/vista-out\"]");
    assertThat(refused.reply().status()).as("gmti takes ground radars only").isEqualTo(404);
    Rig.ok(sensor(generic, "\"create\": true, \"type\": \"GENERIC\", \"outputs\": [\"cot/tak-sensors\"]"));
    assertThat(sensor(generic, "\"type\": \"GROUND_RADAR\"").reply().status()).as("the type is fixed (A5)").isEqualTo(400);
    assertThat(sensors()).contains("\"sensorTypes\":[\"GROUND_RADAR\"]", "\"sensorTypes\":[]", "\"type\":\"GENERIC\"", "\"type\":\"GROUND_RADAR\"");
    run();
    rig.seconds(1);
    assertThat(reports(GMTI)).isNotEmpty().allMatch(r -> r.sensorId().equals(radar) && r.sensor().type() == SensorType.GROUND_RADAR);
    assertThat(reports(COT).stream().filter(r -> r.sensorId().equals(generic))).isNotEmpty().allMatch(r -> r.sensor().type() == SensorType.GENERIC);
    assertThat(reports(COT).stream().filter(r -> r.sensorId().equals(radar))).isNotEmpty().allMatch(r -> r.sensor().type() == SensorType.GROUND_RADAR);
  }

  @Test
  @DisplayName("Criterion 52 (later, owner PX): a chosen channel that no longer takes the sensor's type is missing; without a name a report says \"Generic sensor\"")
  void aChannelThatStopsTakingTheType() {
    UUID generic = track(Position.of(16.1, 59.3), null, null, null);
    rig.started();
    rig.ctx.channels().addOther(ChannelInfo.of("cot", ChannelSpec.of(COT.link(), "TAK sensors (out)", "cot").kinds(Set.of(ChannelKind.SENSOR_REPORTS))));
    rig.ctx.runUntilIdle();
    Rig.ok(sensor(generic, "\"create\": true, \"type\": \"GENERIC\", \"outputs\": [\"cot/tak-sensors\"]"));
    rig.ctx.channels().addOther(ChannelInfo.of("cot", ChannelSpec.of(COT.link(), "TAK sensors (out)", "cot").kinds(Set.of(ChannelKind.SENSOR_REPORTS))
        .sensorTypes(Set.of(SensorType.GROUND_RADAR))));
    rig.ctx.runUntilIdle();
    assertThat(sensors()).contains("\"name\":\"Generic sensor\"", "{\"id\":\"cot/tak-sensors\",\"missing\":true}");
  }

  // ---------------------------------------------------------------- criterion 53

  @Test
  @DisplayName("Criterion 53: a saved M5 sensor and a version 1 scenario file's sensor without a type load as ground radars with their own values and the preset \"Custom\"")
  void oldSensors() throws Exception {
    String m5 = "{\"revisitSeconds\": 20, \"minRange\": 10000, \"maxRange\": 60000, \"startBearing\": 300, \"endBearing\": 60, \"detectionProbability\": 0.7,"
        + " \"rangeError\": 5, \"crossRangeError\": 6, \"minimumDetectableSpeed\": 1.5, \"maxDetections\": 12, \"mission\": \"OLD\", \"detectAll\": false,"
        + " \"outputs\": []}";
    UUID platform = UUID.randomUUID();
    var read = Sensors.read(Routes.json("{\"sensors\": [{\"platform\": \"" + platform + "\", \"settings\": " + m5 + "}]}").get("sensors")).get(platform);
    assertThat(read.type()).isEqualTo(SensorType.GROUND_RADAR);
    assertThat(read.preset()).isEqualTo(SensorSettings.Preset.CUSTOM);
    assertThat(List.of(read.revisitSeconds(), read.minRange(), read.maxRange(), read.startBearing(), read.endBearing(), read.detectionProbability(),
        read.rangeError(), read.crossRangeError(), read.minimumDetectableSpeed())).containsExactly(20.0, 10_000.0, 60_000.0, 300.0, 60.0, 0.7, 5.0, 6.0, 1.5);
    assertThat(read.maxDetections()).isEqualTo(12);
    assertThat(read.mission()).isEqualTo("OLD");
    // The owner's A4: M5's look, one dwell over the whole area.
    assertThat(List.of(read.searchWidth(), read.dwellDepth(), read.dwellInterval())).containsExactly(120.0, 50_000.0, 1.0);
    assertThat(read.mode()).as("function 50: a sensor without a mode is Random").isEqualTo(SensorSettings.Mode.RANDOM);

    UUID track = rig.symbol(Position.of(17.0, 58.0));
    rig.started();
    Rig.ok(rig.post("/scenario-state", "{\"mode\": \"new\", \"outputs\": [], \"sensors\": [{\"platform\": \"" + track + "\", \"settings\": " + m5 + "}]}"));
    assertThat(sensors()).contains("\"type\":\"GROUND_RADAR\"", "\"preset\":\"custom\"", "\"revisitSeconds\":20", "\"detectionProbability\":0.7",
        "\"searchWidth\":120", "\"dwellDepth\":50000", "\"mode\":\"random\"");
  }

  // ---------------------------------------------------------------- criterion 54

  @Test
  @DisplayName("Criteria 54 and 73: each preset sets function 37's three values and the Mode as its table says, the Narrow wedge also a Target revisit of 2 s (Wide wedge: the whole band, following it); a new sensor is on the Medium wedge in Random; changing one, the Mode too, makes it \"Custom\"")
  void presets() {
    UUID radar = platform();
    rig.started();
    Rig.ok(sensor(radar, "\"create\": true"));
    assertThat(sensors()).contains("\"preset\":\"medium\"", "\"searchWidth\":40", "\"dwellDepth\":50000", "\"dwellInterval\":1", "\"mode\":\"random\"");
    Rig.ok(sensor(radar, "\"preset\": \"default\""));
    assertThat(sensors()).as("M7's Narrow wedge (T-191)").contains("\"preset\":\"default\"", "\"searchWidth\":2", "\"dwellDepth\":20000", "\"dwellInterval\":0.2",
        "\"mode\":\"random\"");
    Rig.ok(sensor(radar, "\"targetRevisitSeconds\": 5"));
    assertThat(sensors()).as("Default sets no Target revisit, so changing it keeps the preset").contains("\"preset\":\"default\"", "\"targetRevisitSeconds\":5");
    Rig.ok(sensor(radar, "\"preset\": \"narrow\""));
    assertThat(sensors()).as("like the AFSERS radar (T-191)").contains("\"preset\":\"narrow\"", "\"searchWidth\":1.7", "\"dwellDepth\":95000", "\"dwellInterval\":0.1",
        "\"mode\":\"systematic\"", "\"targetRevisitSeconds\":2");
    Rig.ok(sensor(radar, "\"mode\": \"random\""));
    assertThat(sensors()).as("the Narrow wedge switched to Random").contains("\"preset\":\"custom\"", "\"searchWidth\":1.7", "\"mode\":\"random\"");
    Rig.ok(sensor(radar, "\"preset\": \"narrow\""));
    Rig.ok(sensor(radar, "\"targetRevisitSeconds\": 1"));
    assertThat(sensors()).as("the Narrow wedge's Target revisit changed").contains("\"preset\":\"custom\"", "\"targetRevisitSeconds\":1");
    assertThat(sensor(radar, "\"mode\": \"sweep\"").reply().status()).isEqualTo(400);
    assertThat(sensor(radar, "\"targetRevisitSeconds\": 0.4").reply().status()).isEqualTo(400);
    assertThat(sensor(radar, "\"targetRevisitSeconds\": 61").reply().status()).isEqualTo(400);
    Rig.ok(sensor(radar, "\"preset\": \"wide\""));
    assertThat(sensors()).contains("\"preset\":\"wide\"", "\"searchWidth\":180", "\"dwellDepth\":130000", "\"dwellInterval\":4", "\"mode\":\"random\"");
    Rig.ok(sensor(radar, "\"maxRange\": 200000"));
    assertThat(sensors()).as("the whole band follows the band (A3)").contains("\"preset\":\"wide\"", "\"dwellDepth\":180000");
    Rig.ok(sensor(radar, "\"preset\": \"medium\""));
    Rig.ok(sensor(radar, "\"dwellInterval\": 2"));
    assertThat(sensors()).contains("\"preset\":\"custom\"", "\"searchWidth\":40", "\"dwellInterval\":2");
    Rig.ok(sensor(radar, "\"preset\": \"medium\", \"searchWidth\": 40"));
    assertThat(sensors()).contains("\"preset\":\"medium\"", "\"dwellInterval\":1");
    assertThat(sensor(radar, "\"preset\": \"huge\"").reply().status()).isEqualTo(400);
    assertThat(sensor(radar, "\"searchWidth\": 0.5").reply().status()).isEqualTo(400);
    assertThat(sensor(radar, "\"dwellDepth\": 999").reply().status()).isEqualTo(400);
    assertThat(sensor(radar, "\"dwellInterval\": 61").reply().status()).isEqualTo(400);
    assertThat(sensor(radar, "\"emptyShare\": 0.91").reply().status()).as("the removed share is read and ignored (T-196, UQ A)").isEqualTo(200);
    assertThat(sensors()).doesNotContain("emptyShare");
  }

  // ---------------------------------------------------------------- criterion 55

  @Test
  @DisplayName("Criterion 55: 30 tracks over the band, the Narrow wedge, a cap of 5: every track in exactly one report of the revisit, none over 5, each inside its ArcBand; empty dwells of the nominal size, holding no track and, from M7 (function 44), overlapping no dwell with targets; sequences 0, 1, 2, …")
  void everyTargetInDwells() {
    UUID radar = platform();
    List<UUID> tracks = new ArrayList<>();
    SplittableRandom spread = new SplittableRandom(55);
    for (int i = 0; i < 30; i++) {
      tracks.add(at(45 + spread.nextDouble() * 90, 20_000 + spread.nextDouble() * 130_000)); // the default band, 20 to 150 km, 45° to 135°
    }
    rig.started();
    offerBoth();
    Rig.ok(sensor(radar, "\"create\": true, \"startBearing\": 45, \"endBearing\": 135, \"preset\": \"default\", \"maxDetections\": 5, \"detectionProbability\": 1, "
        + NO_ERRORS + ", \"outputs\": [\"gmti/vista-out\"]"));
    run();
    rig.seconds(40);
    List<ChannelItem.SensorReport> first = revisit(GMTI, 0);
    assertThat(first).isNotEmpty();
    Map<UUID, Integer> times = new HashMap<>();
    for (int k = 0; k < first.size(); k++) {
      ChannelItem.SensorReport r = first.get(k);
      assertThat(r.sequence()).isEqualTo(new ChannelItem.SensorReport.Sequence(0, k, k == first.size() - 1));
      assertThat(r.detections()).hasSizeLessThanOrEqualTo(5);
      Geometry.ArcBand band = (Geometry.ArcBand) r.area();
      for (ChannelItem.Detection d : r.detections()) {
        times.merge(d.objectId(), 1, Integer::sum);
        assertThat(inside(band, rig.position(d.objectId()))).as("a target inside its dwell").isTrue();
      }
    }
    assertThat(times).as("every track in exactly one report").hasSize(30).allSatisfy((id, n) -> assertThat(n).isEqualTo(1));
    List<ChannelItem.SensorReport> empty = first.stream().filter(r -> r.detections().isEmpty()).toList();
    List<Geometry.ArcBand> full = first.stream().filter(r -> !r.detections().isEmpty()).map(r -> (Geometry.ArcBand) r.area()).toList();
    assertThat(empty).as("some reports are empty").isNotEmpty();
    for (ChannelItem.SensorReport r : empty) {
      Geometry.ArcBand band = (Geometry.ArcBand) r.area();
      // From M7 (function 44) spread over the search area, not beside a dwell with targets: overlapping none.
      assertThat(full).as("overlapping no dwell with targets").noneMatch(f -> overlap(f, band));
      assertThat(Detector.normal(band.endBearing() - band.startBearing())).isCloseTo(2, org.assertj.core.api.Assertions.within(1e-6));
      assertThat(band.outerRadius() - band.innerRadius()).isCloseTo(20_000, org.assertj.core.api.Assertions.within(1e-3));
      assertThat(tracks).as("holding no track").noneMatch(t -> inside(band, rig.position(t)));
    }
    // Narrow wedge: 0.2 s apart, clockwise from the start bearing.
    for (int k = 1; k < first.size(); k++) {
      assertThat(Duration.between(first.get(k - 1).time(), first.get(k).time())).isEqualTo(Duration.ofMillis(200));
    }
    assertThat(revisit(GMTI, 1)).as("the next revisit").isNotEmpty();
  }

  // ---------------------------------------------------------------- criterion 56

  @Test
  @DisplayName("Criterion 56 with T-196: with the Medium wedge (1 s) a revisit holds 10 dwells; 11 dwells with targets make it last 11 s, past the 10 s revisit interval, the next one's first report 1 s after the last; with 3 targets it is 10 dwells in the 10 s")
  void time() {
    UUID radar = platform();
    for (int i = 0; i < 11; i++) {
      at(90 + i * 0.05, 80_000); // one place: with "most detections" 1, 11 dwells there and no empty one (T-196: 10 a revisit)
    }
    rig.started();
    offerBoth();
    String allRound = "\"startBearing\": 0, \"endBearing\": 0, ";
    Rig.ok(sensor(radar, "\"create\": true, \"maxDetections\": 1, " + allRound + NO_ERRORS + ", \"outputs\": [\"gmti/vista-out\"]"));
    run();
    rig.seconds(30);
    List<ChannelItem.SensorReport> first = revisit(GMTI, 0);
    List<ChannelItem.SensorReport> second = revisit(GMTI, 1);
    assertThat(first).hasSize(11);
    assertThat(sensors()).contains("\"preset\":\"medium\"");
    assertThat(Duration.between(first.getFirst().time(), first.getLast().time())).isEqualTo(Duration.ofSeconds(10));
    assertThat(Duration.between(first.getLast().time(), second.getFirst().time())).isEqualTo(Duration.ofSeconds(1));

    rig = new Rig();
    UUID four = platform();
    for (int i = 0; i < 3; i++) {
      at(90 + i * 0.05, 80_000); // 3 dwells and 7 empty ones
    }
    rig.started();
    offerBoth();
    Rig.ok(sensor(four, "\"create\": true, \"maxDetections\": 1, " + allRound + NO_ERRORS + ", \"outputs\": [\"gmti/vista-out\"]"));
    run();
    rig.seconds(25);
    assertThat(revisit(GMTI, 0)).hasSize(10);
    assertThat(Duration.between(revisit(GMTI, 0).getFirst().time(), revisit(GMTI, 1).getFirst().time())).isEqualTo(Duration.ofSeconds(10));
  }

  // ---------------------------------------------------------------- criterion 57

  @Test
  @DisplayName("Criterion 57: with tracks all round and equal bearings, the Narrow wedge sends no empty dwell where every bearing holds a track (one row of places, each holding one)")
  void surrounded() {
    UUID radar = platform();
    for (int b = 1; b < 360; b += 2) {
      at(b, 50_000); // one track in each 2° place of the band from 40 to 60 km (function 44's grid)
    }
    rig.started();
    offerBoth();
    Rig.ok(sensor(radar, "\"create\": true, \"preset\": \"default\", \"startBearing\": 0, \"endBearing\": 360, \"minRange\": 40000, \"maxRange\": 60000, "
        + NO_ERRORS + ", \"outputs\": [\"gmti/vista-out\"]"));
    run();
    rig.seconds(60);
    List<ChannelItem.SensorReport> first = revisit(GMTI, 0);
    assertThat(first).isNotEmpty().allMatch(r -> !r.detections().isEmpty());
    assertThat(first.stream().mapToInt(r -> r.detections().size()).sum()).isEqualTo(180);
  }

  @Test
  @DisplayName("T-196: a revisit without targets (Medium, 1 s) sends 10 empty dwells of the nominal size inside the search area, the last marked the revisit's last")
  void noTargets() {
    UUID radar = platform();
    rig.started();
    offerBoth();
    Rig.ok(sensor(radar, "\"create\": true, \"startBearing\": 45, \"endBearing\": 135, \"outputs\": [\"gmti/vista-out\"]"));
    run();
    rig.seconds(11);
    List<ChannelItem.SensorReport> first = revisit(GMTI, 0);
    assertThat(first).hasSize(10).allMatch(r -> r.detections().isEmpty());
    assertThat(first.getFirst().sequence()).isEqualTo(new ChannelItem.SensorReport.Sequence(0, 0, false));
    assertThat(first.getLast().sequence()).isEqualTo(new ChannelItem.SensorReport.Sequence(0, 9, true));
    for (ChannelItem.SensorReport r : first) {
      Geometry.ArcBand band = (Geometry.ArcBand) r.area();
      assertThat(Detector.normal(band.endBearing() - band.startBearing())).isEqualTo(40.0);
      assertThat(band.outerRadius() - band.innerRadius()).isEqualTo(50_000.0);
      assertThat(Detector.normal(band.startBearing() - 45)).isLessThanOrEqualTo(50.0);
    }
  }

  // ---------------------------------------------------------------- criterion 58

  @Test
  @DisplayName("Criterion 58 (later; not offered in M6, owner PX): a generic sensor of 50 km detects the tracks at 30 km (standing) and 49 km, not at 51 km, in one report with a Circle and no sequence")
  void genericSensor() {
    UUID generic = platform();
    UUID standing = at(200, 30_000);
    UUID near = at(10, 49_000);
    UUID far = at(100, 51_000);
    rig.started();
    offerBoth();
    Rig.ok(sensor(generic, "\"create\": true, \"type\": \"GENERIC\", \"range\": 50000, \"outputs\": [\"cot/tak-sensors\"]"));
    run();
    rig.seconds(1);
    List<ChannelItem.SensorReport> sent = reports(COT);
    assertThat(sent).hasSize(1);
    ChannelItem.SensorReport r = sent.getFirst();
    assertThat(r.sequence()).isNull();
    assertThat(r.area()).isEqualTo(new Geometry.Circle(PLATFORM, 50_000));
    assertThat(r.detections()).extracting(ChannelItem.Detection::objectId).containsExactly(standing, near);
    assertThat(far).isNotNull();
    assertThat(r.sensor()).isEqualTo(new ChannelItem.Sensor("Hawk 1", null, Duration.ofSeconds(10), 50.0, 50.0, null, 1.0, 0.0, null)
        .withType(SensorType.GENERIC));
    rig.seconds(10);
    assertThat(reports(COT)).hasSize(2);
  }

  @Test
  @DisplayName("Criterion 58 (later; not offered in M6, owner PX): over 1 000 revisits with a fixed seed the generic sensor's error east and north matches the sigma within 10 %")
  void genericErrors() throws Exception {
    SensorSettings s = SensorSettings.parse(Routes.json("{\"positionError\": 200, \"range\": 100000}"), SensorSettings.GENERIC);
    Position truth = Geodesy.direct(PLATFORM, 60, 40_000);
    var target = new Detector.Target(UUID.randomUUID(), null, truth, null, null);
    SplittableRandom random = new SplittableRandom(58);
    double east = 0;
    double north = 0;
    int n = 1_000;
    for (int i = 0; i < n; i++) {
      Position m = Detector.generic(PLATFORM, List.of(target), s, random).seen().getFirst().measured();
      GeodesicLeg leg = Geodesy.inverse(truth, m);
      double e = leg.distanceMetres() * Math.sin(Math.toRadians(leg.initialAzimuth()));
      double no = leg.distanceMetres() * Math.cos(Math.toRadians(leg.initialAzimuth()));
      east += e * e;
      north += no * no;
    }
    assertThat(Math.sqrt(east / n)).isBetween(180.0, 220.0);
    assertThat(Math.sqrt(north / n)).isBetween(180.0, 220.0);
  }

  // ---------------------------------------------------------------- criterion 59

  @Test
  @DisplayName("Criterion 59: a job area is saved, sent on every report as a closed four-corner Polygon in the order drawn, limits detection; five corners are refused; clearing it removes it")
  void jobArea() {
    UUID radar = platform();
    UUID inside = track(Position.of(15.3, 58.9), null, null, null);
    UUID outside = at(90, 60_000); // in the search area, east of the job area
    rig.started();
    offerBoth();
    Rig.ok(sensor(radar, "\"create\": true, \"startBearing\": 0, \"endBearing\": 0, \"minRange\": 0, \"jobArea\": " + SQUARE + ", " + NO_ERRORS
        + ", \"outputs\": [\"gmti/vista-out\"]"));
    FakeHttpExchange five = sensor(radar, "\"jobArea\": {\"type\": \"Polygon\", \"coordinates\": [[[15.0, 58.6], [15.6, 58.6], [15.7, 58.9], [15.6, 59.2],"
        + " [15.0, 59.2], [15.0, 58.6]]]}");
    assertThat(five.reply().status()).isEqualTo(400);
    assertThat(five.reply().body().toUtf8()).contains(SensorSettings.FOUR_CORNERS, "\"field\":\"jobArea\"");
    rig.seconds(1); // the next tick saves (A22)
    rig.ctx.store().restart();
    rig.ctx.restart(rig.engine());
    rig.ctx.runUntilIdle();
    assertThat(sensors()).as("saved with the sensor").contains("\"jobArea\":{\"type\":\"Polygon\",\"coordinates\":[[[15.0,58.6],[15.6,58.6],[15.6,59.2]");
    offerBoth(); // the test kit's restart forgets the other plugins' channels
    run();
    rig.seconds(30);
    var square = new Geometry.Polygon(List.of(List.of(Position.of(15.0, 58.6), Position.of(15.6, 58.6), Position.of(15.6, 59.2), Position.of(15.0, 59.2),
        Position.of(15.0, 58.6))));
    List<ChannelItem.SensorReport> sent = reports(GMTI);
    assertThat(sent).isNotEmpty().allMatch(r -> square.equals(r.sensor().jobArea()));
    List<UUID> seen = sent.stream().flatMap(r -> r.detections().stream()).map(ChannelItem.Detection::objectId).distinct().toList();
    assertThat(seen).containsExactly(inside);
    assertThat(outside).isNotNull();
    for (ChannelItem.SensorReport r : sent) {
      Geometry.ArcBand band = (Geometry.ArcBand) r.area();
      double mid = band.startBearing() + Detector.normal(band.endBearing() - band.startBearing()) / 2;
      Position centre = Geodesy.direct(band.center(), mid, (band.innerRadius() + band.outerRadius()) / 2);
      if (r.detections().isEmpty()) {
        assertThat(Detector.inside(square, centre)).as("an empty dwell's centre in the job area").isTrue();
      }
    }
    Rig.ok(sensor(radar, "\"jobArea\": null"));
    int before = reports(GMTI).size();
    rig.seconds(20);
    assertThat(reports(GMTI).subList(before, reports(GMTI).size())).isNotEmpty().allMatch(r -> r.sensor().jobArea() == null);
    assertThat(reports(GMTI).stream().skip(before).flatMap(r -> r.detections().stream()).map(ChannelItem.Detection::objectId)).contains(outside);
  }

  // ---------------------------------------------------------------- the planner alone

  @Test
  @DisplayName("Function 37: a dwell splits at the cap and grows to hold targets beyond its depth; nothing is left out")
  void splitAndGrow() throws Exception {
    SensorSettings s = SensorSettings.parse(Routes.json("{\"searchWidth\": 5, \"dwellDepth\": 20000, \"maxDetections\": 2, \"revisitSeconds\": 3, \"dwellInterval\": 1}"),
        SensorSettings.GROUND_RADAR);
    Dwells.Search area = Dwells.Search.of(PLATFORM, 0, s);
    List<Dwells.Polar> targets = List.of(new Dwells.Polar(10, 30_000), new Dwells.Polar(11, 140_000), new Dwells.Polar(12, 60_000),
        new Dwells.Polar(40, 50_000));
    List<Dwells.Planned> plan = Dwells.plan(area, targets, List.of(), s, 0);
    assertThat(plan).hasSize(3);
    assertThat(plan.stream().mapToInt(p -> p.targets().size()).sum()).isEqualTo(4);
    Dwells.Planned grown = plan.getFirst();
    assertThat(grown.targets()).as("the cap of 2 splits 10°, 11° and 12°").containsExactly(0, 1);
    assertThat(grown.extent().far() - grown.extent().near()).as("grown deeper than 20 km to hold 30 and 140 km").isEqualTo(110_000);
    assertThat(grown.extent().width()).isEqualTo(5);
    Dwells.Planned nominal = plan.get(1);
    assertThat(nominal.targets()).containsExactly(2);
    assertThat(nominal.extent().far() - nominal.extent().near()).isEqualTo(20_000);
    assertThat(plan.get(2).targets()).containsExactly(3);
    for (Dwells.Planned p : plan) {
      for (int i : p.targets()) {
        assertThat(p.extent().holds(targets.get(i).bearing(), targets.get(i).distance())).isTrue();
      }
    }
  }
}
