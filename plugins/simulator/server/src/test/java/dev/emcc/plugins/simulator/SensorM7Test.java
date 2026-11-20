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
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
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
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * M7's sensor package on the server (brief functions 42 to 44; criteria 62 to 66; T-178 to T-180),
 * and the owner's Q1 kept as the floor (2026-11-12). The dwells are checked with the test kit's
 * {@code FakeChannels}, as in {@link SensorTypesTest}.
 */
class SensorM7Test {

  /** Latitude ≠ longitude. */
  static final Position PLATFORM = SensorTypesTest.PLATFORM;
  private static final ChannelId GMTI = new ChannelId("gmti", "vista-out");
  private static final String NO_ERRORS = "\"rangeError\": 0, \"crossRangeError\": 0";

  private Rig rig = new Rig();

  // ---------------------------------------------------------------- helpers

  private UUID track(Position at, @Nullable String name, @Nullable Double direction) {
    UUID id = UUID.randomUUID();
    var symbol = new Symbol(SymbolStandard.APP_6D, Rig.SIDC, direction == null ? null : new Modifiers(Map.of(), direction, null));
    var content = new MapObjectContent(MapObjectContent.SYMBOL, DataType.GENERAL, MapObjectContent.MANUAL, null, rig.layer.id(), new Geometry.Point(at),
        symbol, null, name == null ? null : new ObjectProperties(name, null), rig.ctx.defaultLabel(), Extensions.empty());
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.createObject(id, content)));
    return id;
  }

  /** A platform heading north (0°), standing. */
  private UUID platform() {
    return track(PLATFORM, "Hawk 1", 0.0);
  }

  /** A standing target at {@code bearing} and {@code metres} from the platform. */
  private UUID at(double bearing, double metres) {
    return track(Geodesy.direct(PLATFORM, bearing, metres), null, null);
  }

  private void delete(UUID id) {
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.deleteObject(rig.object(id))));
    rig.ctx.runUntilIdle();
  }

  private void run() {
    UUID route = rig.route(TWO_LEGS, "{\"points\": [{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]}");
    rig.ctx.runUntilIdle();
    rig.control(route, "start");
  }

  private void offerGmti() {
    rig.ctx.channels().addOther(ChannelInfo.of("gmti", ChannelSpec.of(GMTI.link(), "VISTA (out)", "gmti").kinds(Set.of(ChannelKind.SENSOR_REPORTS))
        .sensorTypes(Set.of(SensorType.GROUND_RADAR))));
    rig.ctx.runUntilIdle();
  }

  private FakeHttpExchange sensor(UUID platform, String settings) {
    return rig.post("/sensors", "{\"platform\": \"" + platform + "\"" + (settings.isEmpty() ? "" : ", " + settings) + "}");
  }

  private List<ChannelItem.SensorReport> revisit(long number) {
    return rig.ctx.channels().sent(GMTI).stream().filter(ChannelItem.SensorReport.class::isInstance).map(ChannelItem.SensorReport.class::cast)
        .filter(r -> r.sequence() != null && r.sequence().revisit() == number).toList();
  }

  private void cap(int n) {
    rig.ctx.changeSettings(JsonObject.builder().put("maxEmptyDwellsPerTargetDwell", JsonNumber.of(n)).build());
    rig.ctx.runUntilIdle();
  }

  private JsonObject dwells(String query) {
    FakeHttpExchange call = rig.get("/sensors/dwells" + query);
    assertThat(call.reply().status()).isEqualTo(200);
    return Routes.json(call.reply().body().toUtf8());
  }

  private static List<JsonValue> sets(JsonObject answer) {
    return ((JsonArray) answer.get("sensors")).values();
  }

  private static List<JsonValue> dwellsOf(JsonValue set) {
    return ((JsonArray) ((JsonObject) set).get("dwells")).values();
  }

  private static Position centre(Geometry.ArcBand band) {
    double mid = band.startBearing() + Detector.normal(band.endBearing() - band.startBearing()) / 2;
    return Geodesy.direct(band.center(), mid, (band.innerRadius() + band.outerRadius()) / 2);
  }

  /** The middle bearing of a band, from the platform's heading (north). */
  private static double middle(Geometry.ArcBand band) {
    return Detector.normal(band.startBearing() + Detector.normal(band.endBearing() - band.startBearing()) / 2);
  }

  // ---------------------------------------------------------------- criterion 62

  @Test
  @DisplayName("Criterion 62: a new ground radar looks 0° to 360° and detects a track behind its platform; a sensor saved with 45° to 135° keeps them after a restart and an import")
  void allRoundByDefault() {
    UUID radar = platform();
    UUID behind = at(180, 50_000);
    rig.started();
    offerGmti();
    Rig.ok(sensor(radar, "\"create\": true, " + NO_ERRORS + ", \"outputs\": [\"gmti/vista-out\"]"));
    assertThat(rig.get("/sensors").reply().body().toUtf8()).contains("\"startBearing\":0", "\"endBearing\":360");
    run();
    rig.seconds(10);
    assertThat(revisit(0).stream().flatMap(r -> r.detections().stream()).map(ChannelItem.Detection::objectId)).containsExactly(behind);

    UUID right = platform();
    Rig.ok(sensor(right, "\"create\": true, \"startBearing\": 45, \"endBearing\": 135"));
    rig.seconds(1); // the next tick saves (A22)
    rig.ctx.store().restart();
    rig.ctx.restart(rig.engine());
    rig.ctx.runUntilIdle();
    String after = rig.get("/sensors").reply().body().toUtf8();
    assertThat(after.substring(after.indexOf(right.toString()))).contains("\"startBearing\":45", "\"endBearing\":135");

    rig.control("reset");
    String settings = "{\"type\": \"GROUND_RADAR\", \"startBearing\": 45, \"endBearing\": 135, \"preset\": \"medium\", \"searchWidth\": 40,"
        + " \"dwellDepth\": 50000, \"dwellInterval\": 1, \"emptyShare\": 0.2}";
    Rig.ok(rig.post("/scenario-state", "{\"mode\": \"new\", \"outputs\": [], \"sensors\": [{\"platform\": \"" + radar + "\", \"settings\": " + settings + "}]}"));
    assertThat(rig.get("/sensors").reply().body().toUtf8()).contains("\"startBearing\":45", "\"endBearing\":135", "\"preset\":\"medium\"");
  }

  // ---------------------------------------------------------------- criterion 63

  @Test
  @DisplayName("Criterion 63: three dwells of one revisit (grown past its 2 for three targets, T-196) give GET /sensors/dwells three; the next revisit's two, the second its last, leave two; with since and no change 304; a reset and a removal clear them")
  void dwellsDrawn() {
    UUID radar = platform();
    UUID a = at(10, 50_000);
    at(100, 50_000);
    at(200, 50_000);
    rig.started();
    offerGmti();
    // T-196: 2 dwells per revisit (10 s / 5 s); three targets far apart need three, at 0, 5 and 10 s, so the first revisit takes 15 s.
    Rig.ok(sensor(radar, "\"create\": true, \"revisitSeconds\": 10, \"dwellInterval\": 5, " + NO_ERRORS + ", \"outputs\": [\"gmti/vista-out\"]"));
    JsonObject none = dwells("");
    assertThat(none.get("whole")).isEqualTo(dev.emcc.sdk.json.JsonBoolean.of(true));
    run();
    rig.seconds(11);
    assertThat(revisit(0)).hasSize(3);
    JsonObject first = dwells("");
    assertThat(sets(first)).singleElement().satisfies(set -> assertThat(dwellsOf(set)).hasSize(3));
    JsonObject dwell = (JsonObject) dwellsOf(sets(first).getFirst()).getFirst();
    assertThat(dwell.getNumber("index").longValueExact()).isZero();
    assertThat(dwell.getNumber("revisit").longValueExact()).isZero();
    assertThat(dwell.getObject("area").getString("type")).isEqualTo("ArcBand");
    assertThat(dwell.getObject("area").get("center")).isEqualTo(JsonArray.of(JsonNumber.of(15.20), JsonNumber.of(58.41)));
    long seq = first.getNumber("seq").longValueExact();
    assertThat(rig.get("/sensors").reply().body().toUtf8()).contains("\"dwells\":" + seq);
    assertThat(rig.get("/sensors/dwells?since=" + seq).reply().status()).isEqualTo(304);
    assertThat(rig.get("/sensors/dwells?since=x").reply().status()).isEqualTo(400);

    delete(a);
    rig.seconds(10); // the next revisit at 15 s: two dwells, at 15 s and 20 s
    JsonObject second = dwells("?since=" + seq);
    assertThat(second.get("whole")).isEqualTo(dev.emcc.sdk.json.JsonBoolean.of(false));
    assertThat(revisit(1)).hasSize(2);
    assertThat(sets(second)).singleElement().satisfies(set -> assertThat(dwellsOf(set)).hasSize(2)
        .allSatisfy(d -> assertThat(((JsonObject) d).getNumber("revisit").longValueExact()).isEqualTo(1)));

    rig.control("pause");
    rig.seconds(5);
    assertThat(sets(dwells("")).getFirst()).satisfies(set -> assertThat(dwellsOf(set)).as("kept while paused").hasSize(2));
    long paused = dwells("").getNumber("seq").longValueExact();
    rig.control("reset");
    JsonObject reset = dwells("?since=" + paused);
    assertThat(reset.get("whole")).isEqualTo(dev.emcc.sdk.json.JsonBoolean.of(true));
    assertThat(sets(reset)).singleElement().satisfies(set -> assertThat(dwellsOf(set)).as("gone on a reset").isEmpty());

    run();
    rig.seconds(2);
    assertThat(sets(dwells("")).getFirst()).satisfies(set -> assertThat(dwellsOf(set)).isNotEmpty());
    long before = dwells("").getNumber("seq").longValueExact();
    Rig.ok(sensor(radar, "\"maxRange\": 100000"));
    assertThat(sets(dwells("?since=" + before))).singleElement().satisfies(set -> assertThat(dwellsOf(set)).as("a settings change clears them").isEmpty());
    rig.seconds(2);
    long running = dwells("").getNumber("seq").longValueExact();
    Rig.ok(rig.post("/sensors/remove", "{\"platform\": \"" + radar + "\"}"));
    JsonObject removed = dwells("?since=" + running);
    assertThat(removed.get("whole")).isEqualTo(dev.emcc.sdk.json.JsonBoolean.of(true));
    assertThat(sets(removed)).isEmpty();
  }

  // ---------------------------------------------------------------- criteria 64 and 66

  /** Criterion 64's sensor: heading 0°, 0° to 90°, 20 to 150 km, the Default preset (2°, 20 km, 0.2 s; M7's Narrow wedge; Random). */
  private UUID spreadRig(boolean tracks) {
    UUID radar = platform();
    if (tracks) {
      at(10, 80_000);
      at(11, 80_000);
    }
    rig.started();
    offerGmti();
    Rig.ok(sensor(radar, "\"create\": true, \"startBearing\": 0, \"endBearing\": 90, \"preset\": \"default\", " + NO_ERRORS
        + ", \"outputs\": [\"gmti/vista-out\"]"));
    run();
    return radar;
  }

  @Test
  @DisplayName("Criterion 64 with T-196: two tracks at 10° and 11° make one dwell with targets and 49 empty ones, filling the revisit's 50 (10 s / 0.2 s), none holding a target or overlapping it, spread: the largest gap at most twice the even spacing")
  void emptyDwellsSpread() {
    spreadRig(true);
    rig.seconds(11); // 0.2 s apart from 1 s: the whole revisit
    List<ChannelItem.SensorReport> first = revisit(0);
    assertThat(first).hasSize(50);
    List<ChannelItem.SensorReport> full = first.stream().filter(r -> !r.detections().isEmpty()).toList();
    assertThat(full).singleElement().satisfies(r -> assertThat(r.detections()).hasSize(2));
    Geometry.ArcBand withTargets = (Geometry.ArcBand) full.getFirst().area();
    List<Position> tracks = full.getFirst().detections().stream().map(d -> rig.position(d.objectId())).toList();
    for (ChannelItem.SensorReport r : first) {
      if (r.detections().isEmpty()) {
        Geometry.ArcBand band = (Geometry.ArcBand) r.area();
        assertThat(tracks).noneMatch(t -> SensorTypesTest.inside(band, t));
        assertThat(SensorTypesTest.overlap(withTargets, band)).isFalse();
      }
    }
    List<Double> bearings = first.stream().map(r -> middle((Geometry.ArcBand) r.area())).sorted(Comparator.naturalOrder()).toList();
    double largest = 0;
    for (int k = 1; k < bearings.size(); k++) {
      largest = Math.max(largest, bearings.get(k) - bearings.get(k - 1));
    }
    assertThat(largest).as("spread over 0° to 90°: at most twice 90° / 50").isLessThanOrEqualTo(2 * 90.0 / 50);
  }

  @Test
  @DisplayName("Criterion 64 (the revisits do not repeat each other): successive revisits start their empty dwells at different places (the revisit's draw)")
  void revisitsDiffer() {
    spreadRig(true);
    rig.seconds(41);
    Set<List<Geometry>> seen = new java.util.HashSet<>();
    for (int n = 0; n < 4; n++) {
      List<Geometry> empty = revisit(n).stream().filter(r -> r.detections().isEmpty()).map(ChannelItem.SensorReport::area).toList();
      assertThat(empty).hasSize(49);
      seen.add(empty);
    }
    assertThat(seen).as("four revisits, not all alike").hasSizeGreaterThan(1);
  }

  @Test
  @DisplayName("T-196: without targets a revisit is 50 empty dwells (10 s / 0.2 s); with targets, the admin's cap no longer limits them: at 10 and at 1 still 49 empty and one with targets")
  void noTargetsAndTheCap() {
    spreadRig(false);
    rig.seconds(11);
    assertThat(revisit(0)).hasSize(50).allMatch(r -> r.detections().isEmpty());

    rig = new Rig();
    spreadRig(true);
    cap(10);
    rig.seconds(11);
    assertThat(revisit(0)).hasSize(50);
    assertThat(revisit(0).stream().filter(r -> r.detections().isEmpty())).hasSize(49);
    cap(1);
    rig.seconds(10);
    assertThat(revisit(1)).as("the cap at 1 does not shorten the revisit").hasSize(50);
  }

  @Test
  @DisplayName("T-196: at a dwell interval of 0.1 s the radar sends 10 dwells a second, each 0.1 s after the one before, over two whole revisits")
  void tenDwellsASecond() {
    UUID radar = platform();
    at(10, 80_000);
    at(50, 60_000);
    rig.started();
    offerGmti();
    Rig.ok(sensor(radar, "\"create\": true, \"revisitSeconds\": 10, \"preset\": \"custom\", \"searchWidth\": 2, \"dwellDepth\": 20000, \"dwellInterval\": 0.1, "
        + NO_ERRORS + ", \"outputs\": [\"gmti/vista-out\"]"));
    run();
    rig.seconds(21);
    List<ChannelItem.SensorReport> sent = new ArrayList<>(revisit(0));
    sent.addAll(revisit(1));
    assertThat(sent).hasSize(200);
    java.time.Instant start = sent.getFirst().time();
    Map<Long, Long> perSecond = new java.util.TreeMap<>();
    for (int k = 0; k < sent.size(); k++) {
      assertThat(java.time.Duration.between(start, sent.get(k).time()).toMillis()).as("dwell %d", k).isEqualTo(100L * k);
      perSecond.merge(java.time.Duration.between(start, sent.get(k).time()).toSeconds(), 1L, Long::sum);
    }
    assertThat(perSecond.values()).as("each of the 20 seconds").hasSize(20).containsOnly(10L);
  }

  @Test
  @DisplayName("Criterion 64 (a job area over the half from 45° to 90°): every empty dwell's centre is inside it")
  void emptyDwellsInTheJobArea() {
    UUID radar = spreadRig(true);
    List<Position> corners = List.of(PLATFORM, Geodesy.direct(PLATFORM, 45, 250_000), Geodesy.direct(PLATFORM, 67.5, 250_000),
        Geodesy.direct(PLATFORM, 90, 250_000));
    StringBuilder ring = new StringBuilder();
    for (Position p : corners) {
      ring.append('[').append(p.longitude()).append(", ").append(p.latitude()).append("], ");
    }
    ring.append('[').append(PLATFORM.longitude()).append(", ").append(PLATFORM.latitude()).append(']');
    Rig.ok(sensor(radar, "\"jobArea\": {\"type\": \"Polygon\", \"coordinates\": [[" + ring + "]]}"));
    var area = new Geometry.Polygon(List.of(List.of(corners.get(0), corners.get(1), corners.get(2), corners.get(3), corners.get(0))));
    rig.seconds(21);
    List<ChannelItem.SensorReport> sent = new ArrayList<>(revisit(1));
    assertThat(sent).as("no target in the job area: a revisit of 50 empty dwells (T-196)").hasSize(50);
    for (ChannelItem.SensorReport r : sent) {
      assertThat(Detector.inside(area, centre((Geometry.ArcBand) r.area()))).isTrue();
    }
  }

  @Test
  @DisplayName("The owner's Q1 as the floor (2026-11-12): without targets and with a revisit interval below the dwell interval, a revisit still sends one empty dwell")
  void oneDwellAtLeast() {
    UUID radar = platform();
    rig.started();
    offerGmti();
    Rig.ok(sensor(radar, "\"create\": true, \"preset\": \"custom\", \"revisitSeconds\": 1, \"dwellInterval\": 4, \"outputs\": [\"gmti/vista-out\"]"));
    run();
    rig.seconds(1);
    assertThat(revisit(0)).singleElement().satisfies(r -> assertThat(r.sequence().lastOfRevisit()).isTrue());
  }

  @Test
  @DisplayName("Function 44 (the planner alone): with an offset of 0 the empty dwells are every (k / e)-th free place of the grid in the revisit's order, clockwise and near to far")
  void theGrid() throws Exception {
    SensorSettings s = SensorSettings.parse(Routes.json("{\"startBearing\": 0, \"endBearing\": 90, \"minRange\": 20000, \"maxRange\": 60000, \"revisitSeconds\": 4,"
        + " \"preset\": \"custom\", \"searchWidth\": 30, \"dwellDepth\": 20000, \"dwellInterval\": 1}"), SensorSettings.GROUND_RADAR);
    Dwells.Search area = Dwells.Search.of(PLATFORM, 0, s);
    // 3 columns of 30° and 2 rows of 20 km: 6 places; the dwell over a target at 5°, 30 km takes the first, so 5 are free and the
    // 3 empty ones are free places 0, 1 and 3 (every 5/3-th).
    List<Dwells.Planned> plan = Dwells.plan(area, List.of(new Dwells.Polar(5, 30_000)), List.of(new Dwells.Polar(5, 30_000)), s, 0);
    assertThat(plan).hasSize(4);
    assertThat(plan.stream().filter(Dwells.Planned::empty).map(Dwells.Planned::extent).toList()).containsExactly(
        new Dwells.Extent(0, 30, 40_000, 60_000), new Dwells.Extent(30, 30, 20_000, 40_000), new Dwells.Extent(60, 30, 20_000, 40_000));
    // T-196: a revisit holds the revisit interval over the dwell interval (4 s / 1 s here), at least one.
    assertThat(Dwells.perRevisit(s)).isEqualTo(4);
    SensorSettings fast = SensorSettings.parse(Routes.json("{\"preset\": \"custom\", \"revisitSeconds\": 10, \"dwellInterval\": 0.1}"), SensorSettings.GROUND_RADAR);
    assertThat(Dwells.perRevisit(fast)).isEqualTo(100);
    SensorSettings third = SensorSettings.parse(Routes.json("{\"preset\": \"custom\", \"revisitSeconds\": 10, \"dwellInterval\": 0.3}"), SensorSettings.GROUND_RADAR);
    assertThat(Dwells.perRevisit(third)).isEqualTo(33);
    SensorSettings slow = SensorSettings.parse(Routes.json("{\"preset\": \"custom\", \"revisitSeconds\": 1, \"dwellInterval\": 60}"), SensorSettings.GROUND_RADAR);
    assertThat(Dwells.perRevisit(slow)).isEqualTo(1);
  }

  // ---------------------------------------------------------------- criteria 65 and 66

  @Test
  @DisplayName("Criteria 65 and 73: M7's Narrow wedge (2°), from M8 the Default preset; a sensor saved with M7's Narrow wedge and 5° keeps 5° and shows \"Custom\"; one saved with 2°, 20 km and 0.2 s shows \"Default\"")
  void narrowWedge() throws Exception {
    String old = "{\"type\": \"GROUND_RADAR\", \"preset\": \"narrow\", \"searchWidth\": 5, \"dwellDepth\": 20000, \"dwellInterval\": 0.2, \"emptyShare\": 0.8}";
    SensorSettings five = SensorSettings.stored(Routes.json(old));
    assertThat(five.searchWidth()).isEqualTo(5);
    assertThat(five.preset()).isEqualTo(SensorSettings.Preset.CUSTOM);
    SensorSettings two = SensorSettings.stored(Routes.json(old.replace("\"searchWidth\": 5", "\"searchWidth\": 2")));
    assertThat(two.preset()).isEqualTo(SensorSettings.Preset.DEFAULT);
    assertThat(two.mode()).as("saved without a Mode: Random (TT A)").isEqualTo(SensorSettings.Mode.RANDOM);
    SensorSettings wide = SensorSettings.stored(Routes.json("{\"type\": \"GROUND_RADAR\", \"preset\": \"wide\", \"minRange\": 20000, \"maxRange\": 150000,"
        + " \"searchWidth\": 180, \"dwellDepth\": 130000, \"dwellInterval\": 4, \"emptyShare\": 0}"));
    assertThat(wide.preset()).as("the Wide wedge's depth is the band's").isEqualTo(SensorSettings.Preset.WIDE);
    assertThat(SensorSettings.Preset.DEFAULT.searchWidth).isEqualTo(2);
    assertThat(SensorSettings.Preset.NARROW.searchWidth).isEqualTo(1.7);
  }

  @Test
  @DisplayName("Criterion 66 (from M8, T-196, UQ A): no maxEmptyDwellsPerTargetDwell in Settings › Simulator and no Empty dwells share on a sensor; a stored value of either, and a scenario file's share, are read and ignored, and the count is still function 37's")
  void theRemovedSettings() {
    JsonObject properties = Manifest.read().getObject("settings").getObject("properties");
    assertThat(properties.get("maxEmptyDwellsPerTargetDwell")).isNull();
    UUID radar = platform();
    rig.started();
    offerGmti();
    cap(1); // a stored value, as an M7 install has it
    Rig.ok(sensor(radar, "\"create\": true, \"emptyShare\": 0.9, \"revisitSeconds\": 4, \"outputs\": [\"gmti/vista-out\"]"));
    String answer = rig.get("/sensors").reply().body().toUtf8();
    assertThat(answer).doesNotContain("emptyShare").doesNotContain("maxEmpty").contains("\"mode\":\"random\"");
    run();
    rig.seconds(5);
    assertThat(revisit(0)).as("4 s / 1 s (Medium): all four empty, neither the share nor the cap counted").hasSize(4);
    assertThat(rig.get("/scenario-state").reply().body().toUtf8()).doesNotContain("maxEmpty").doesNotContain("emptyShare");
    rig.control("reset");
    String settings = "{\"type\": \"GROUND_RADAR\", \"preset\": \"medium\", \"emptyShare\": 0.5, \"revisitSeconds\": 3}";
    Rig.ok(rig.post("/scenario-state", "{\"mode\": \"new\", \"outputs\": [], \"sensors\": [{\"platform\": \"" + radar + "\", \"settings\": " + settings + "}]}"));
    assertThat(rig.get("/sensors").reply().body().toUtf8()).doesNotContain("emptyShare").contains("\"revisitSeconds\":3", "\"mode\":\"random\"");
  }

  // ---------------------------------------------------------------- T-193

  /**
   * The half angle the band spans at {@code sensor}, measured as a receiver must when the band is not
   * centred on it (gmti out's {@code DwellArea}): from the line to the band's middle, round its edge.
   */
  private static double halfAngleSeenFrom(Position sensor, Geometry.ArcBand band) {
    double mid = Geodesy.inverse(sensor, centre(band)).initialAzimuth();
    double width = Detector.normal(band.endBearing() - band.startBearing());
    double widest = 0;
    for (int k = 0; k <= 20; k++) {
      double bearing = band.startBearing() + width * k / 20;
      for (double r : new double[] {band.innerRadius(), band.outerRadius()}) {
        Position edge = Geodesy.direct(band.center(), bearing, r);
        if (Geodesy.inverse(sensor, edge).distanceMetres() < 1.0) {
          continue; // on the sensor: no bearing (gmti out then takes the band as it is)
        }
        double off = Detector.normal(Geodesy.inverse(sensor, Geodesy.direct(band.center(), bearing, r)).initialAzimuth() - mid);
        widest = Math.max(widest, off > 180 ? 360 - off : off);
      }
    }
    return widest;
  }

  @Test
  @DisplayName("T-193: a dwell placed again over targets either side of 0° of an all-round area stays the search width wide; one whose targets spread wider grows to them")
  void placedAgainAcrossTheStart() {
    SensorSettings s = SensorSettings.defaults(SensorType.GROUND_RADAR);
    Dwells.Search area = new Dwells.Search(PLATFORM, 0, 360, 0, 10_000);
    Dwells.Extent planned = new Dwells.Extent(-1, 2, 1_000, 3_000);
    Dwells.Extent again = Dwells.over(area, planned, List.of(new Dwells.Polar(359.6, 2_000), new Dwells.Polar(0.3, 2_100)), s);
    assertThat(again.width()).isEqualTo(Math.min(s.searchWidth(), 360));
    assertThat(again.holds(359.6, 2_000) && again.holds(0.3, 2_100)).isTrue();
    Dwells.Extent wider = Dwells.over(area, planned, List.of(new Dwells.Polar(350, 2_000), new Dwells.Polar(10, 2_000)), s);
    assertThat(wider.width()).isCloseTo(Math.max(s.searchWidth(), 20), org.assertj.core.data.Offset.offset(1e-6));
  }

  @Test
  @DisplayName("T-193: an air platform turning sharply during a revisit of many dwells: every dwell sent and drawn is centred on the platform's reported position, so it is 2° wide seen from there too")
  void dwellsFollowAMovingPlatform() {
    UUID radar = track(PLATFORM, "AirPatrol", 90.0);
    Position turn = Geodesy.direct(PLATFORM, 90, 500);
    // Heading east, the search area is the northern half (180° to 360° from the heading); targets 1 to 5 km out.
    for (double[] t : new double[][] {{300, 3_000}, {330, 1_000}, {20, 5_000}, {60, 2_000}}) {
      at(t[0], t[1]);
    }
    rig.started();
    offerGmti();
    // A revisit of 16 dwells (3.2 s / 0.2 s, T-196).
    Rig.ok(sensor(radar, "\"create\": true, \"revisitSeconds\": 3.2, \"minRange\": 0, \"maxRange\": 10000, \"startBearing\": 180, \"endBearing\": 360,"
        + " \"preset\": \"custom\", \"searchWidth\": 2, \"dwellDepth\": 2000, \"dwellInterval\": 0.2,"
        + " \"detectionProbability\": 1, \"minimumDetectableSpeed\": 0, \"maxDetections\": 200, " + NO_ERRORS + ", \"outputs\": [\"gmti/vista-out\"]"));
    // 250 m/s: east for 2 s, then a sharp turn north, inside the first revisit's 16 dwells (3.2 s).
    UUID route = rig.route(List.of(PLATFORM, turn, Geodesy.direct(turn, 0, 5_000)), Rig.single(radar, "[{\"speed\": 250}, {\"speed\": 250}, {\"speed\": 250}]"));
    rig.ctx.runUntilIdle();
    rig.control(route, "start");
    rig.seconds(4);
    List<ChannelItem.SensorReport> sent = revisit(0);
    assertThat(sent).hasSize(16);
    assertThat(sent.stream().map(ChannelItem.SensorReport::platform).distinct().count()).as("sent over several ticks while it moved").isGreaterThan(2);
    assertThat(sent.stream().filter(r -> !r.detections().isEmpty())).hasSize(4);
    for (ChannelItem.SensorReport r : sent) {
      Geometry.ArcBand band = (Geometry.ArcBand) r.area();
      assertThat(Geodesy.inverse(r.platform(), band.center()).distanceMetres()).as("centred on the reported platform").isLessThan(1.0);
      assertThat(Detector.normal(band.endBearing() - band.startBearing())).as("the search width").isLessThanOrEqualTo(2 + 1e-6);
      assertThat(halfAngleSeenFrom(r.platform(), band)).as("as a receiver reads it").isLessThanOrEqualTo(1 + 1e-3);
      assertThat(r.detections()).allSatisfy(d -> assertThat(SensorTypesTest.inside(band, rig.position(d.objectId()))).isTrue());
    }
    // Simulation draws what it sends: the first revisit's dwells the next one has not yet replaced (it began at 3.2 s).
    List<JsonObject> drawn = dwellsOf(sets(dwells("")).getFirst()).stream().map(JsonObject.class::cast)
        .filter(d -> d.getNumber("revisit").longValueExact() == 0).toList();
    assertThat(drawn).hasSizeGreaterThan(8);
    for (JsonObject d : drawn) {
      JsonObject area = d.getObject("area");
      Geometry.ArcBand band = (Geometry.ArcBand) sent.get((int) d.getNumber("index").longValueExact()).area();
      assertThat(area.get("center")).isEqualTo(JsonArray.of(JsonNumber.of(band.center().longitude()), JsonNumber.of(band.center().latitude())));
      assertThat(area.getNumber("startBearing").doubleValue()).isEqualTo(band.startBearing());
    }
  }
}
