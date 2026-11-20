package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.TWO_LEGS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.sdk.DataType;
import dev.emcc.sdk.DeclaredField;
import dev.emcc.sdk.User;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelInfo;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.channel.ChannelKind;
import dev.emcc.sdk.channel.ChannelSpec;
import dev.emcc.sdk.channel.SensorType;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Relation;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** GMTI sensors in the engine (brief functions 27 to 31; criteria 35, 41 and 43 to 48). */
class SensorsTest {

  /** Latitude ≠ longitude. */
  static final Position HERE = Position.of(17.0, 58.0);
  private static final String STEADY = "{\"points\": [{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]}";
  private static final ChannelId VISTA = new ChannelId("gmti", "vista-out");
  private static final ChannelId DEEP = new ChannelId("test", "deep-out");
  private static final ChannelId WIDE = new ChannelId("test", "wide-out");
  /** One dwell over the whole search area, as an M5 sensor looked (the owner's A4 of 2026-11-10), with M5's bearings (from M7 a new one looks all round): for the M5 criteria. */
  static final String WHOLE = "\"preset\": \"custom\", \"searchWidth\": 360, \"dwellDepth\": 1000000, \"emptyShare\": 0, \"startBearing\": 45, \"endBearing\": 135";
  private static final DeclaredField TEAM = new DeclaredField("cot", "team", DeclaredField.Type.TEXT, "Team", null, null, null, null, null,
      false, List.of(), true, List.of());

  private Rig rig = new Rig();

  // ---------------------------------------------------------------- helpers

  /** A track on no route, not moved by the simulation. */
  private UUID track(Position at, @Nullable String name, @Nullable Double direction, @Nullable Double speed) {
    UUID id = UUID.randomUUID();
    var symbol = new Symbol(SymbolStandard.APP_6D, Rig.SIDC, direction == null && speed == null ? null : new Modifiers(Map.of(), direction, speed));
    var content = new MapObjectContent(MapObjectContent.SYMBOL, DataType.GENERAL, MapObjectContent.MANUAL, null, rig.layer.id(), new Geometry.Point(at),
        symbol, null, name == null ? null : new ObjectProperties(name, null), rig.ctx.defaultLabel(), Extensions.empty());
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.createObject(id, content)));
    return id;
  }

  /** A track at {@code metres} east of {@link #HERE}, moving away at 10 m/s. */
  private UUID east(double metres) {
    return track(Geodesy.direct(HERE, 90, metres), "Target", 90.0, 10.0);
  }

  /** The simulation runs: a route without objects, started. */
  private void run() {
    UUID route = rig.route(TWO_LEGS, STEADY);
    rig.ctx.runUntilIdle();
    rig.control(route, "start");
  }

  private void offer(ChannelId id, String name, @Nullable Double depth, ChannelKind... kinds) {
    ChannelSpec spec = ChannelSpec.of(id.link(), name, id.plugin()).kinds(Set.of(kinds));
    rig.ctx.channels().addOther(ChannelInfo.of(id.plugin(), depth == null ? spec : spec.maxAreaDepth(depth)));
    rig.ctx.runUntilIdle();
  }

  private FakeHttpExchange sensor(UUID platform, String settings) {
    return rig.post("/sensors", "{\"platform\": \"" + platform + "\"" + (settings.isEmpty() ? "" : ", " + settings) + "}");
  }

  private List<ChannelItem.SensorReport> reports(ChannelId to) {
    return rig.ctx.channels().sent(to).stream().filter(ChannelItem.SensorReport.class::isInstance).map(ChannelItem.SensorReport.class::cast).toList();
  }

  private List<UUID> related(UUID object, String kind) {
    return rig.object(object).content().relations().stream().filter(r -> r.kind().equals(kind)).map(Relation::objectId).toList();
  }

  private String sensors() {
    return rig.get("/sensors").reply().body().toUtf8();
  }

  // ---------------------------------------------------------------- criterion 35

  @Test
  @DisplayName("Criterion 35: a new sensor has function 27's defaults (from M6 a ground radar's: a probability of 1, no minimum speed, the Medium wedge; from M7 all round, 0° to 360°, criterion 62); settings outside their limits are refused, named; it survives a restart; its track deleted shows it missing")
  void aSensor() {
    UUID platform = track(HERE, "Hawk 1", null, null);
    rig.started();
    Rig.ok(sensor(platform, "\"create\": true"));
    assertThat(sensors()).contains("\"name\":\"Hawk 1\"", "\"missing\":false", "\"revisitSeconds\":10", "\"minRange\":20000", "\"maxRange\":150000",
        "\"startBearing\":0", "\"endBearing\":360", "\"detectionProbability\":1", "\"rangeError\":20", "\"crossRangeError\":50",
        "\"minimumDetectableSpeed\":0", "\"maxDetections\":200", "\"mission\":null", "\"detectAll\":false", "\"type\":\"GROUND_RADAR\"",
        "\"preset\":\"medium\"", "\"searchWidth\":40", "\"dwellDepth\":50000", "\"dwellInterval\":1", "\"mode\":\"random\"",
        "\"targetRevisitSeconds\":2", "\"jobArea\":null");
    FakeHttpExchange zero = sensor(platform, "\"revisitSeconds\": 0");
    assertThat(zero.reply().status()).isEqualTo(400);
    assertThat(zero.reply().body().toUtf8()).contains("\"field\":\"revisitSeconds\"");
    assertThat(sensor(platform, "\"minRange\": 200000, \"maxRange\": 100000").reply().body().toUtf8()).contains("\"field\":\"maxRange\"");
    assertThat(sensor(platform, "\"rangeError\": 10001").reply().status()).isEqualTo(400);
    assertThat(sensor(platform, "\"mission\": \"" + "M".repeat(65) + "\"").reply().status()).isEqualTo(400);
    assertThat(sensor(platform, "\"create\": true").reply().status()).as("a track is the platform of one sensor").isEqualTo(409);
    assertThat(sensor(UUID.randomUUID(), "\"create\": true").reply().status()).isEqualTo(404);
    assertThat(sensor(platform, "\"outputs\": [\"gmti/none\"]").reply().status()).isEqualTo(404);
    FakeHttpExchange viewer = rig.ctx.post("/sensors", Routes.json("{\"platform\": \"" + platform + "\"}"), User.of("u1", "Viewer", Set.of(Engine.VIEW_PERMISSION)));
    rig.ctx.runUntilIdle();
    assertThat(viewer.reply().status()).isEqualTo(403);
    Rig.ok(sensor(platform, "\"revisitSeconds\": 30, \"mission\": \"ATO-2611-BRAVO\""));
    rig.seconds(1); // the next tick saves (A22)
    rig.ctx.store().restart();
    rig.ctx.restart(rig.engine());
    rig.ctx.runUntilIdle();
    assertThat(sensors()).contains("\"revisitSeconds\":30", "\"mission\":\"ATO-2611-BRAVO\"", "\"minRange\":20000");
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.deleteObject(rig.object(platform))));
    rig.ctx.runUntilIdle();
    assertThat(sensors()).contains("\"missing\":true", "\"name\":\"Ground radar\"");
    Rig.ok(rig.post("/sensors/remove", "{\"platform\": \"" + platform + "\"}"));
    assertThat(sensors()).contains("\"sensors\":[]");
  }

  // ---------------------------------------------------------------- criterion 41

  @Test
  @DisplayName("Criterion 41: one SensorReport per revisit and output, with the platform, time, area and measured detections; an empty one too; none while paused; each output list offers its kind only")
  void reportsOut() {
    UUID platform = track(HERE, "Hawk 1", 0.0, null);
    UUID target = east(50_000);
    rig.started();
    offer(VISTA, "VISTA (out)", 511_980.0, ChannelKind.SENSOR_REPORTS);
    rig.chooseTak(); // ground truth only
    assertThat(rig.get("/outputs").reply().body().toUtf8()).doesNotContain("gmti/vista-out");
    assertThat(sensors()).contains("gmti/vista-out").doesNotContain("cot/tak-out");
    Rig.ok(sensor(platform, "\"create\": true, \"detectionProbability\": 1, " + WHOLE + ", \"outputs\": [\"gmti/vista-out\"]"));
    run();
    rig.seconds(1);
    List<ChannelItem.SensorReport> sent = reports(VISTA);
    assertThat(sent).hasSize(1);
    ChannelItem.SensorReport report = sent.getFirst();
    assertThat(report.sensorId()).isEqualTo(platform);
    assertThat(report.platform()).isEqualTo(HERE);
    assertThat(report.time()).isEqualTo(rig.ctx.clock());
    assertThat(report.area()).isEqualTo(new Geometry.ArcBand(HERE, 20_000, 150_000, 45, 135));
    assertThat(report.detections()).hasSize(1);
    ChannelItem.Detection d = report.detections().getFirst();
    assertThat(d.objectId()).isEqualTo(target);
    Position measured = ((Geometry.Point) d.content().geometry()).coordinates();
    assertThat(measured).isNotEqualTo(rig.position(target)); // the default errors
    assertThat(Geodesy.inverse(measured, rig.position(target)).distanceMetres()).isLessThan(1_000);
    assertThat(d.content().time().expires()).isEqualTo(rig.ctx.clock().plusSeconds(5));
    assertThat(rig.sentToTak()).noneMatch(ChannelItem.SensorReport.class::isInstance);
    rig.seconds(9);
    assertThat(reports(VISTA)).hasSize(1);
    Rig.ok(sensor(platform, "\"detectionProbability\": 0"));
    rig.seconds(1);
    assertThat(reports(VISTA)).hasSize(2);
    assertThat(reports(VISTA).getLast().detections()).as("an empty report says the area was looked at").isEmpty();
    rig.control("pause");
    rig.seconds(30);
    assertThat(reports(VISTA)).hasSize(2);
  }

  // ---------------------------------------------------------------- criteria 43 and 44

  @Test
  @DisplayName("Criterion 43: after a revisit the platform's gmti.pairing are exactly the detected tracks, other kinds kept; none after an empty one; each saved")
  void pairing() {
    UUID other = UUID.randomUUID();
    UUID platform = track(TWO_LEGS.getFirst(), "Hawk 1", null, null);
    MapObject p = rig.object(platform);
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("other"), Change.updateObject(p, p.content().withRelations(List.of(new Relation("other.link", other))))));
    UUID near = track(Geodesy.direct(TWO_LEGS.getFirst(), 180, 30_000), "Near", null, null);
    UUID far = track(Geodesy.direct(TWO_LEGS.getFirst(), 180, 300_000), "Far", null, null);
    UUID route = rig.route(TWO_LEGS, Rig.single(platform, "[{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]"));
    rig.started();
    Rig.ok(sensor(platform, "\"create\": true, \"detectAll\": true"));
    rig.control(route, "start");
    rig.seconds(11); // the revisit (10 dwells of 1 s since T-196), and its relations with the platform's next move
    assertThat(related(platform, Sensors.PAIRING)).containsExactly(near);
    assertThat(related(platform, "other.link")).containsExactly(other);
    assertThat(related(platform, Sensors.BEYOND)).isEmpty();
    assertThat(rig.ctx.store().unsaved()).as("only moves are not saved").allMatch(r -> !(r.toString().contains(Sensors.PAIRING)));
    Rig.ok(sensor(platform, "\"minRange\": 0, \"maxRange\": 1000"));
    rig.seconds(21); // the change drops the revisit begun; the next starts at its time and takes its 10 s (T-196)
    assertThat(related(platform, Sensors.PAIRING)).isEmpty();
    assertThat(related(platform, "other.link")).containsExactly(other);
    assertThat(far).isNotNull();
  }

  @Test
  @DisplayName("Criterion 43: without gmti.pairing declared there is no pairing, and the status says so")
  void withoutGmti() {
    rig = new Rig(false);
    UUID platform = track(HERE, "Hawk 1", null, null);
    east(30_000);
    rig.started();
    Rig.ok(sensor(platform, "\"create\": true, \"detectAll\": true"));
    run();
    rig.seconds(2);
    assertThat(rig.object(platform).content().relations()).isEmpty();
    assertThat(rig.ctx.pluginStatus().detail()).contains("no pairing written (gmti.pairing is not declared");
  }

  @Test
  @DisplayName("Criterion 44: a track with relations and field sets, moved by the simulation and edited by an event, keeps both")
  void forwarding() {
    rig = new Rig(TEAM);
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    MapObject t = rig.object(track);
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("cot"), Change.updateObject(t,
        t.content().withRelations(List.of(new Relation("other.link", UUID.randomUUID()))).withFieldSets(List.of("cot.unit")))));
    String setName = "{\"kind\": \"set\", \"core\": {\"name\": \"Passed\"}}";
    UUID route = rig.route(TWO_LEGS, Rig.single(track, "[{\"speed\": 1000, \"events\": [" + setName + "]}, {\"speed\": 1000}, {\"speed\": 1000}]"));
    rig.started();
    rig.control(route, "start");
    rig.seconds(3);
    MapObjectContent after = rig.object(track).content();
    assertThat(after.properties().name()).isEqualTo("Passed");
    assertThat(rig.position(track)).isNotEqualTo(TWO_LEGS.getFirst());
    assertThat(after.relations()).extracting(Relation::kind).containsExactly("other.link");
    assertThat(after.fieldSets()).containsExactly("cot.unit");
  }

  // ---------------------------------------------------------------- criterion 45

  @Test
  @DisplayName("Criterion 45: an item sent to a cot channel lists cot.unit, the stored track does not; the outputs list names the set")
  void channelsSets() {
    rig = new Rig(TEAM);
    UUID track = rig.symbol(Position.of(17.5, 58.5));
    rig.started();
    rig.ctx.channels().addOther(ChannelInfo.of("cot", ChannelSpec.of("unit-out", "Units (out)", "cot").fieldSet("cot.unit")));
    rig.ctx.runUntilIdle();
    Rig.ok(rig.post("/outputs", "{\"channels\": [\"cot/unit-out\"]}"));
    assertThat(rig.get("/outputs").reply().body().toUtf8()).contains("\"fieldSet\":\"cot.unit\"");
    run();
    rig.seconds(1);
    ChannelItem.Update sent = rig.ctx.channels().sent(new ChannelId("cot", "unit-out")).stream().filter(ChannelItem.Update.class::isInstance)
        .map(ChannelItem.Update.class::cast).filter(u -> u.id().equals(track)).findFirst().orElseThrow();
    assertThat(sent.content().fieldSets()).containsExactly("cot.unit");
    assertThat(rig.object(track).content().fieldSets()).isEmpty();
  }

  // ---------------------------------------------------------------- criterion 47

  @Test
  @DisplayName("Criterion 47: the sensor in a report, from its settings and its platform; with \"Detect all in range\" no errors and a probability of 1; the Mission")
  void theSensorInAReport() {
    UUID hawk = track(HERE, "Hawk 1", 45.0, 120.0);
    UUID unnamed = track(Position.of(16.0, 57.0), null, null, null);
    rig.started();
    offer(VISTA, "VISTA (out)", 511_980.0, ChannelKind.SENSOR_REPORTS);
    String m5 = "\"detectionProbability\": 0.9, \"minimumDetectableSpeed\": 2, " + WHOLE;
    Rig.ok(sensor(hawk, "\"create\": true, " + m5 + ", \"outputs\": [\"gmti/vista-out\"]"));
    Rig.ok(sensor(unnamed, "\"create\": true, " + m5 + ", \"outputs\": [\"gmti/vista-out\"]"));
    run();
    rig.seconds(1);
    ChannelItem.Sensor s = reports(VISTA).stream().filter(r -> r.sensorId().equals(hawk)).findFirst().orElseThrow().sensor();
    assertThat(s).isEqualTo(new ChannelItem.Sensor("Hawk 1", null, Duration.ofSeconds(10), 20.0, 50.0, 2.0, 0.9, 45.0, 120.0).withType(SensorType.GROUND_RADAR));
    ChannelItem.Sensor none = reports(VISTA).stream().filter(r -> r.sensorId().equals(unnamed)).findFirst().orElseThrow().sensor();
    assertThat(none.name()).isEqualTo("Ground radar");
    assertThat(none.platformDirection()).isNull();
    assertThat(none.platformSpeed()).isNull();
    Rig.ok(sensor(hawk, "\"detectAll\": true, \"mission\": \"ATO-2611-BRAVO\""));
    rig.seconds(10);
    ChannelItem.Sensor all = reports(VISTA).stream().filter(r -> r.sensorId().equals(hawk)).reduce((a, b) -> b).orElseThrow().sensor();
    assertThat(all).isEqualTo(new ChannelItem.Sensor("Hawk 1", "ATO-2611-BRAVO", Duration.ofSeconds(10), null, null, null, 1.0, 45.0, 120.0)
        .withType(SensorType.GROUND_RADAR));
    Rig.ok(sensor(hawk, "\"mission\": \"\""));
    rig.seconds(10);
    assertThat(reports(VISTA).stream().filter(r -> r.sensorId().equals(hawk)).reduce((a, b) -> b).orElseThrow().sensor().mission()).isNull();
  }

  // ---------------------------------------------------------------- criterion 48

  @Test
  @DisplayName("Criterion 48: beyond the gmti output's depth a track gets simulator.beyond-reach instead of gmti.pairing, and the sensor names the output; deselecting it rewrites at once")
  void beyondTheDepth() {
    UUID platform = track(HERE, "Hawk 1", 0.0, null);
    UUID at500 = east(500_000);
    UUID at550 = east(550_000);
    rig.started();
    offer(VISTA, "VISTA (out)", 511_980.0, ChannelKind.SENSOR_REPORTS);
    Rig.ok(sensor(platform, "\"create\": true, \"detectAll\": true, \"maxRange\": 400000, \"outputs\": [\"gmti/vista-out\"]"));
    run();
    rig.seconds(1);
    assertThat(sensors()).contains("\"outOfRange\":[]");
    assertThat(related(platform, Sensors.PAIRING)).isEmpty(); // both beyond 400 km: not detected

    Rig.ok(sensor(platform, "\"maxRange\": 600000"));
    rig.seconds(21); // the change drops the revisit begun; the next starts at its time and takes its 10 s (T-196)
    assertThat(related(platform, Sensors.PAIRING)).containsExactly(at500);
    assertThat(related(platform, Sensors.BEYOND)).containsExactly(at550);
    assertThat(sensors()).contains("\"outOfRange\":[\"VISTA (out)\"]");

    // A band from 20 to 1 000 km: the near edge plus 511.98 km is 531.98 km.
    UUID at520 = east(520_000);
    UUID at545 = east(545_000);
    Rig.ok(sensor(platform, "\"detectAll\": false, \"minRange\": 20000, \"maxRange\": 1000000, \"detectionProbability\": 1, \"rangeError\": 0, \"crossRangeError\": 0"));
    rig.seconds(21); // as above: the next whole revisit after the change
    assertThat(related(platform, Sensors.PAIRING)).containsExactlyInAnyOrder(at500, at520);
    assertThat(related(platform, Sensors.BEYOND)).containsExactlyInAnyOrder(at545, at550);

    // Deselecting gmti: the text goes, and gmti.pairing for every detected track at once, without a revisit.
    Rig.ok(sensor(platform, "\"outputs\": []"));
    assertThat(sensors()).contains("\"outOfRange\":[]");
    assertThat(related(platform, Sensors.PAIRING)).containsExactlyInAnyOrder(at500, at520, at545, at550);
    assertThat(related(platform, Sensors.BEYOND)).isEmpty();

    // An output with no depth never warns.
    offer(WIDE, "Wide (out)", null, ChannelKind.SENSOR_REPORTS);
    Rig.ok(sensor(platform, "\"outputs\": [\"test/wide-out\"]"));
    rig.seconds(10);
    assertThat(sensors()).contains("\"outOfRange\":[]");
    assertThat(related(platform, Sensors.BEYOND)).isEmpty();

    // Stopping the simulation takes the text away.
    Rig.ok(sensor(platform, "\"outputs\": [\"gmti/vista-out\"]"));
    assertThat(sensors()).contains("\"outOfRange\":[\"VISTA (out)\"]");
    rig.control("pause");
    rig.seconds(1);
    assertThat(sensors()).contains("\"outOfRange\":[]");
  }

  @Test
  @DisplayName("Criterion 48: without gmti loaded, another output's depth still gives simulator.beyond-reach, and no gmti.pairing")
  void beyondWithoutGmti() {
    rig = new Rig(false);
    UUID platform = track(HERE, "Hawk 1", 0.0, null);
    UUID near = east(100_000);
    UUID far = east(300_000);
    rig.started();
    offer(DEEP, "Deep (out)", 200_000.0, ChannelKind.SENSOR_REPORTS);
    Rig.ok(sensor(platform, "\"create\": true, \"detectAll\": true, \"maxRange\": 400000, \"outputs\": [\"test/deep-out\"]"));
    run();
    rig.seconds(11); // a whole revisit (T-196: 10 dwells of 1 s)
    assertThat(related(platform, Sensors.BEYOND)).containsExactly(far);
    assertThat(related(platform, Sensors.PAIRING)).isEmpty();
    assertThat(sensors()).contains("\"outOfRange\":[\"Deep (out)\"]");
    assertThat(near).isNotNull();
  }

  // ---------------------------------------------------------------- R4

  @Test
  @DisplayName("Measured (R4 on CR-0031): one sensor with 200 tracks in its area at a 10 s revisit: the tick's time and the relations' bytes")
  void measured() {
    UUID platform = track(HERE, "Hawk 1", 0.0, null);
    for (int i = 0; i < 200; i++) {
      track(Geodesy.direct(HERE, 46 + i * 0.4, 30_000 + i * 500), "T" + i, 90.0, 10.0);
    }
    rig.started();
    offer(VISTA, "VISTA (out)", 511_980.0, ChannelKind.SENSOR_REPORTS);
    Rig.ok(sensor(platform, "\"create\": true, \"detectAll\": true, " + WHOLE + ", \"outputs\": [\"gmti/vista-out\"]"));
    run();
    long began = System.nanoTime();
    rig.seconds(1);
    double millis = (System.nanoTime() - began) / 1e6;
    List<UUID> paired = related(platform, Sensors.PAIRING);
    assertThat(paired).hasSize(200);
    int bytes = ("{\"kind\":\"" + Sensors.PAIRING + "\",\"objectId\":\"" + paired.getFirst() + "\"},").length() * paired.size();
    System.out.printf("R4: 200 detections, the revisit's tick %.1f ms (test kit, in-process), relations %d bytes (%d per relation)%n", millis, bytes,
        bytes / paired.size());
    assertThat(millis).isLessThan(Engine.SLOW_TICK.toMillis());
    assertThat(reports(VISTA).getLast().detections()).hasSize(200);
    assertThat(bytes / paired.size()).isCloseTo(70, within(10));
  }
}
