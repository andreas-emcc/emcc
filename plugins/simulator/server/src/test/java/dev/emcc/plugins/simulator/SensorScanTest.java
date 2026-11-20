package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.TWO_LEGS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.sdk.DataType;
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
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Relation;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * A ground radar's Systematic mode (brief function 50, T-197; criteria 74 and 75): the scan in rows,
 * passes back to back, and found targets revisited by dwells of their own. Checked with the test kit's
 * {@code FakeChannels}, as in {@link SensorM7Test}.
 */
class SensorScanTest {

  /** Latitude ≠ longitude. */
  static final Position PLATFORM = SensorTypesTest.PLATFORM;
  private static final ChannelId GMTI = new ChannelId("gmti", "vista-out");
  /** Criterion 74's sensor: the Narrow wedge (1.7° by 95 km, 0.1 s, Systematic) over 0° to 17° and 20 to 210 km, no errors. */
  private static final String SCAN = "\"create\": true, \"preset\": \"narrow\", \"startBearing\": 0, \"endBearing\": 17, \"minRange\": 20000,"
      + " \"maxRange\": 210000, \"rangeError\": 0, \"crossRangeError\": 0, \"outputs\": [\"gmti/vista-out\"]";

  private Rig rig = new Rig();

  // ---------------------------------------------------------------- helpers

  /** A platform heading north (0°), standing. */
  private UUID platform() {
    UUID id = UUID.randomUUID();
    var symbol = new Symbol(SymbolStandard.APP_6D, Rig.SIDC, new Modifiers(Map.of(), 0.0, null));
    create(id, new MapObjectContent(MapObjectContent.SYMBOL, DataType.GENERAL, MapObjectContent.MANUAL, null, rig.layer.id(), new Geometry.Point(PLATFORM),
        symbol, null, null, rig.ctx.defaultLabel(), Extensions.empty()));
    return id;
  }

  /** A standing track at {@code bearing} and {@code metres} from the platform. */
  private UUID at(double bearing, double metres) {
    UUID id = UUID.randomUUID();
    create(id, new MapObjectContent(MapObjectContent.SYMBOL, DataType.GENERAL, MapObjectContent.MANUAL, null, rig.layer.id(),
        new Geometry.Point(Geodesy.direct(PLATFORM, bearing, metres)), new Symbol(SymbolStandard.APP_6D, Rig.SIDC, null), null, null,
        rig.ctx.defaultLabel(), Extensions.empty()));
    return id;
  }

  private void create(UUID id, MapObjectContent content) {
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.createObject(id, content)));
  }

  /** Moves a track, as a user's drag does. */
  private void move(UUID id, double bearing, double metres) {
    var o = rig.object(id);
    MapObjectContent c = o.content();
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.updateObject(o, new MapObjectContent(c.type(), c.dataType(), c.dataSource(),
        c.time(), c.layerId(), new Geometry.Point(Geodesy.direct(PLATFORM, bearing, metres)), c.symbol(), c.style(), c.properties(), c.label(),
        c.extensions(), c.fieldSets(), c.relations()))));
    rig.ctx.runUntilIdle();
  }

  private void start(UUID radar, String settings) {
    rig.started();
    rig.ctx.channels().addOther(ChannelInfo.of("gmti", ChannelSpec.of(GMTI.link(), "VISTA (out)", "gmti").kinds(Set.of(ChannelKind.SENSOR_REPORTS))
        .sensorTypes(Set.of(SensorType.GROUND_RADAR))));
    rig.ctx.runUntilIdle();
    Rig.ok(sensor(radar, settings));
    UUID route = rig.route(TWO_LEGS, "{\"points\": [{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]}");
    rig.ctx.runUntilIdle();
    rig.control(route, "start");
  }

  private FakeHttpExchange sensor(UUID platform, String settings) {
    return rig.post("/sensors", "{\"platform\": \"" + platform + "\", " + settings + "}");
  }

  /** Every report sent, in order. */
  private List<ChannelItem.SensorReport> sent() {
    return rig.ctx.channels().sent(GMTI).stream().filter(ChannelItem.SensorReport.class::isInstance).map(ChannelItem.SensorReport.class::cast).toList();
  }

  private List<ChannelItem.SensorReport> pass(long number) {
    return sent().stream().filter(r -> r.sequence() != null && r.sequence().revisit() == number).toList();
  }

  private static Geometry.ArcBand band(ChannelItem.SensorReport r) {
    return (Geometry.ArcBand) r.area();
  }

  /**
   * A found target's own dwell: not one of criterion 74's grid cells, which start at a multiple of 1.7°
   * in the row from 20 or from 115 km, 95 km deep.
   */
  private static boolean own(ChannelItem.SensorReport r) {
    Geometry.ArcBand b = band(r);
    double col = b.startBearing() / 1.7;
    boolean row = Math.abs(b.innerRadius() - 20_000) < 1e-6 || Math.abs(b.innerRadius() - 115_000) < 1e-6;
    boolean cell = Math.abs(col - Math.rint(col)) < 1e-6 && row && Math.abs(b.outerRadius() - b.innerRadius() - 95_000) < 1e-6;
    return !cell;
  }

  // ---------------------------------------------------------------- criterion 74

  @Test
  @DisplayName("Criterion 74: Systematic over 0° to 17° and 20 to 210 km in 1.7° by 95 km: a pass of 20 dwells, row by row and side by side clockwise, covering the area without overlap; the last flagged; the next pass 0.1 s later; the Revisit interval changes nothing")
  void theScan() {
    UUID radar = platform();
    start(radar, SCAN);
    rig.seconds(5);
    List<ChannelItem.SensorReport> first = pass(0);
    assertThat(first).hasSize(20);
    for (int k = 0; k < 20; k++) {
      Geometry.ArcBand b = band(first.get(k));
      int col = k % 10;
      assertThat(b.center()).isEqualTo(PLATFORM);
      assertThat(b.startBearing()).as("dwell %d", k).isCloseTo(1.7 * col, within(1e-6));
      assertThat(b.endBearing()).as("dwell %d", k).isCloseTo(Math.min(1.7 * (col + 1), 17.0), within(1e-6));
      assertThat(b.innerRadius()).as("dwell %d", k).isCloseTo(k < 10 ? 20_000.0 : 115_000.0, within(1e-6));
      assertThat(b.outerRadius()).as("dwell %d", k).isCloseTo(k < 10 ? 115_000.0 : 210_000.0, within(1e-6));
      assertThat(first.get(k).sequence()).isEqualTo(new ChannelItem.SensorReport.Sequence(0, k, k == 19));
      for (int j = 0; j < k; j++) {
        assertThat(SensorTypesTest.overlap(band(first.get(j)), b)).as("dwells %d and %d", j, k).isFalse();
      }
    }
    assertThat(Duration.between(first.getLast().time(), pass(1).getFirst().time())).isEqualTo(Duration.ofMillis(100));
    assertThat(rig.get("/scenario-state").reply().body().toUtf8()).as("the Mode is saved in a scenario (criterion 76)").contains("\"mode\":\"systematic\"");

    Rig.ok(sensor(radar, "\"revisitSeconds\": 600"));
    long before = sent().getLast().sequence().revisit();
    rig.seconds(5);
    List<ChannelItem.SensorReport> later = pass(before + 2);
    assertThat(later).as("a whole pass, back to back as before").hasSize(20);
    assertThat(Duration.between(pass(before + 1).getLast().time(), later.getFirst().time())).isEqualTo(Duration.ofMillis(100));
  }

  // ---------------------------------------------------------------- criterion 75

  @Test
  @DisplayName("Criterion 75: a track at 8° and 60 km found by the scan gets a dwell of its own, centred on it, every 2 s between the scan's dwells (every 1 s with a Target revisit of 1 s)")
  void foundTargets() {
    UUID radar = platform();
    UUID track = at(8, 60_000);
    start(radar, SCAN);
    rig.seconds(9);
    List<ChannelItem.SensorReport> all = sent();
    ChannelItem.SensorReport found = all.stream().filter(r -> !own(r) && r.detections().stream().anyMatch(d -> d.objectId().equals(track))).findFirst()
        .orElseThrow();
    assertThat(found.sequence()).as("the cell 6.8° to 8.5°, 20 to 115 km").isEqualTo(new ChannelItem.SensorReport.Sequence(0, 4, false));
    List<ChannelItem.SensorReport> owns = all.stream().filter(SensorScanTest::own).toList();
    assertThat(owns).hasSizeGreaterThanOrEqualTo(3);
    for (int n = 0; n < owns.size(); n++) {
      ChannelItem.SensorReport r = owns.get(n);
      assertThat(Duration.between(found.time(), r.time())).as("own dwell %d", n).isEqualTo(Duration.ofSeconds(2L * (n + 1)));
      Geometry.ArcBand b = band(r);
      assertThat(Detector.normal(b.startBearing() + Detector.normal(b.endBearing() - b.startBearing()) / 2)).isCloseTo(8.0, within(1e-6));
      assertThat((b.innerRadius() + b.outerRadius()) / 2).isCloseTo(60_000.0, within(1.0));
      assertThat(r.detections()).singleElement().satisfies(d -> assertThat(d.objectId()).isEqualTo(track));
      assertThat(r.sequence().lastOfRevisit()).as("between the scan's dwells").isFalse();
    }
    assertThat(pass(1)).as("20 cells and one own dwell").hasSize(21);
    assertThat(pass(1).getLast().sequence().lastOfRevisit()).isTrue();
    assertThat(own(pass(1).getLast())).as("a pass ends at its last cell").isFalse();

    rig = new Rig();
    UUID radar2 = platform();
    UUID track2 = at(8, 60_000);
    start(radar2, SCAN);
    Rig.ok(sensor(radar2, "\"targetRevisitSeconds\": 1")); // after the preset, which would set 2 s
    rig.seconds(7);
    List<Instant> times = sent().stream().filter(SensorScanTest::own).map(ChannelItem.SensorReport::time).toList();
    assertThat(times).hasSizeGreaterThanOrEqualTo(4);
    for (int n = 1; n < times.size(); n++) {
      assertThat(Duration.between(times.get(n - 1), times.get(n))).isEqualTo(Duration.ofSeconds(1));
    }
    assertThat(track2).isNotNull();
  }

  @Test
  @DisplayName("The scan's rate (the MCA's check of 2026-11-15): the Narrow wedge as \"New sensor\" gives it, all round over 20 to 150 km (212 columns, the last cut to 1.3°, 2 rows), sends 600 dwells a minute, each 0.1 s after the one before, across rows, passes and a found target's own dwells")
  void tenDwellsASecond() {
    UUID radar = platform();
    UUID track = at(100, 60_000);
    start(radar, "\"create\": true, \"preset\": \"narrow\", \"rangeError\": 0, \"crossRangeError\": 0, \"outputs\": [\"gmti/vista-out\"]");
    rig.seconds(91);
    List<ChannelItem.SensorReport> all = sent();
    // A cell starts at a multiple of 1.7° in the row from 20 km or the cut one from 115 km; the rest are the target's own.
    java.util.function.Predicate<ChannelItem.SensorReport> cell = r -> {
      double col = band(r).startBearing() / 1.7;
      return Math.abs(col - Math.rint(col)) < 1e-6 && (band(r).innerRadius() == 20_000 || band(r).innerRadius() == 115_000);
    };
    List<ChannelItem.SensorReport> cells = pass(0).stream().filter(cell).toList();
    assertThat(cells).as("212 × 2 cells, and the found target's own dwells between them").hasSize(424);
    assertThat(band(cells.get(211)).startBearing()).isCloseTo(211 * 1.7, within(1e-6));
    assertThat(band(cells.get(211)).endBearing()).as("the row's last cell, cut at 360°").isCloseTo(0.0, within(1e-6));
    assertThat(all.stream().filter(cell.negate())).as("the found target's own dwells are among them").isNotEmpty()
        .allMatch(r -> r.detections().stream().anyMatch(d -> d.objectId().equals(track)));
    Instant start = all.getFirst().time();
    List<ChannelItem.SensorReport> minute = all.stream().filter(r -> r.time().isBefore(start.plusSeconds(60))).toList();
    assertThat(minute).as("one dwell per 0.1 s").hasSize(600);
    for (int k = 1; k < all.size(); k++) {
      assertThat(Duration.between(all.get(k - 1).time(), all.get(k).time())).as("dwell %d", k).isEqualTo(Duration.ofMillis(100));
    }
  }

  @Test
  @DisplayName("Criterion 75 (lost and found again): after the track leaves, its own dwells go on until 3 in a row find nothing, then stop; the scan finds it again when it is back")
  void lostAndFound() {
    UUID radar = platform();
    UUID track = at(8, 60_000);
    start(radar, SCAN);
    rig.seconds(4); // found in the first pass at 1.4 s, its first own dwell 2 s later
    long before = sent().stream().filter(SensorScanTest::own).count();
    assertThat(before).isEqualTo(1);
    move(track, 8, 400_000); // beyond the band: no dwell finds it
    rig.seconds(12);
    List<ChannelItem.SensorReport> after = sent().stream().filter(SensorScanTest::own).skip(before).toList();
    assertThat(after).as("three more, finding nothing, then none").hasSize(3).allMatch(r -> r.detections().isEmpty());
    move(track, 8, 60_000);
    rig.seconds(5);
    assertThat(sent().stream().filter(SensorScanTest::own).skip(before + 3).toList()).as("found again by the scan, revisited again").isNotEmpty()
        .allMatch(r -> r.detections().stream().anyMatch(d -> d.objectId().equals(track)));
  }

  // ---------------------------------------------------------------- function 50's other rules (the review of e4563fea, remark 2)

  private List<UUID> related(UUID object, String kind) {
    return rig.object(object).content().relations().stream().filter(r -> r.kind().equals(kind)).map(Relation::objectId).toList();
  }

  /** A job area of four corners round {@code corners} (closed), as the Sensors panel sends it. */
  private static String jobArea(Position... corners) {
    StringBuilder ring = new StringBuilder();
    for (Position p : corners) {
      ring.append('[').append(p.longitude()).append(", ").append(p.latitude()).append("], ");
    }
    ring.append('[').append(corners[0].longitude()).append(", ").append(corners[0].latitude()).append(']');
    return "\"jobArea\": {\"type\": \"Polygon\", \"coordinates\": [[" + ring + "]]}";
  }

  @Test
  @DisplayName("Function 50: two found targets due together whose dwells would overlap share one dwell, which holds both; the pairing is set at the pass's last dwell, each track once")
  void sharedAndPaired() {
    UUID radar = platform();
    UUID a = at(8, 60_000);
    UUID b = at(8.3, 62_000);
    start(radar, SCAN);
    rig.seconds(1);
    assertThat(related(radar, Sensors.PAIRING)).as("before the first pass ends").isEmpty();
    rig.seconds(6);
    List<ChannelItem.SensorReport> owns = sent().stream().filter(SensorScanTest::own).toList();
    assertThat(owns).as("one shared dwell every 2 s, not one each").hasSizeGreaterThanOrEqualTo(2);
    for (int n = 1; n < owns.size(); n++) {
      assertThat(Duration.between(owns.get(n - 1).time(), owns.get(n).time())).isEqualTo(Duration.ofSeconds(2));
    }
    assertThat(owns).allSatisfy(r -> assertThat(r.detections().stream().map(ChannelItem.Detection::objectId).toList()).containsExactlyInAnyOrder(a, b));
    // Seen in a scan dwell and in their own: paired once each.
    assertThat(related(radar, Sensors.PAIRING)).containsExactlyInAnyOrder(a, b);
  }

  @Test
  @DisplayName("Function 50: with a job area only the cells whose centre is inside it are scanned; with none inside, the first cell, so each pass still has one")
  void jobAreaCells() {
    UUID radar = platform();
    // A wedge from 359° to 8.5° out to 300 km: the cells of 0° to 8.5° (5 columns, 2 rows) have their centres inside.
    String wedge = jobArea(PLATFORM, Geodesy.direct(PLATFORM, 359, 300_000), Geodesy.direct(PLATFORM, 4.25, 320_000), Geodesy.direct(PLATFORM, 8.5, 300_000));
    start(radar, SCAN + ", " + wedge);
    rig.seconds(3);
    List<ChannelItem.SensorReport> first = pass(0);
    assertThat(first).hasSize(10);
    assertThat(first).allSatisfy(r -> assertThat(band(r).endBearing()).isLessThanOrEqualTo(8.5 + 1e-6));
    assertThat(first.getLast().sequence().lastOfRevisit()).isTrue();

    rig = new Rig();
    UUID far = platform();
    Position east = Position.of(20.0, 60.0);
    String elsewhere = jobArea(east, Position.of(20.5, 60.0), Position.of(20.5, 60.3), Position.of(20.0, 60.3));
    start(far, SCAN + ", " + elsewhere);
    rig.seconds(3);
    assertThat(pass(0)).singleElement().satisfies(r -> {
      assertThat(r.sequence().lastOfRevisit()).isTrue();
      assertThat(band(r).startBearing()).isZero();
      assertThat(band(r).innerRadius()).isEqualTo(20_000.0);
    });
    assertThat(Duration.between(pass(0).getFirst().time(), pass(1).getFirst().time())).isEqualTo(Duration.ofMillis(100));
  }

  // ---------------------------------------------------------------- M9: the aim (owner YV A) and the turn (owner YW, YW2 A, YW3 A)

  /** Turns the platform to {@code heading}, as its route or a user's edit does. */
  private void turn(UUID platform, double heading) {
    var o = rig.object(platform);
    MapObjectContent c = o.content();
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.updateObject(o, new MapObjectContent(c.type(), c.dataType(), c.dataSource(),
        c.time(), c.layerId(), c.geometry(), new Symbol(SymbolStandard.APP_6D, Rig.SIDC, new Modifiers(Map.of(), heading, null)), c.style(), c.properties(),
        c.label(), c.extensions(), c.fieldSets(), c.relations()))));
    rig.ctx.runUntilIdle();
  }

  /** Moves a track to {@code p}. */
  private void moveTo(UUID id, Position p) {
    var o = rig.object(id);
    MapObjectContent c = o.content();
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.updateObject(o, new MapObjectContent(c.type(), c.dataType(), c.dataSource(),
        c.time(), c.layerId(), new Geometry.Point(p), c.symbol(), c.style(), c.properties(), c.label(), c.extensions(), c.fieldSets(), c.relations()))));
    rig.ctx.runUntilIdle();
  }

  /** Whether a report is one of criterion 74's grid cells with the platform heading {@code heading}: from a multiple of 1.7° off it, in a row from 20 or 115 km. */
  private static boolean cell(ChannelItem.SensorReport r, double heading) {
    Geometry.ArcBand b = band(r);
    double col = Detector.normal(b.startBearing() - heading) / 1.7;
    boolean row = Math.abs(b.innerRadius() - 20_000) < 1e-6 || Math.abs(b.innerRadius() - 115_000) < 1e-6;
    return Math.abs(col - Math.rint(col)) < 1e-6 && col < 10 && row && Math.abs(b.outerRadius() - b.innerRadius() - 95_000) < 1e-6;
  }

  private boolean detects(ChannelItem.SensorReport r, UUID track) {
    return r.detections().stream().anyMatch(d -> d.objectId().equals(track));
  }

  @Test
  @DisplayName("M9 (owner YV A): a found target moving across the line of sight 1 km from the sensor, measured with 20 m range and 50 m cross-range error, gets its own dwell centred on where it is, with its detection, every Target revisit, also while the scan is in the other rows")
  void ownDwellsAimAtTheTarget() {
    UUID radar = platform();
    // The owner's scenario: 180° to 360° from the heading, 0 to 5 km, 1.7° by 2 km cells every 0.1 s, a Target revisit of 1 s.
    Position from = Geodesy.direct(PLATFORM, 270, 1_000);
    UUID track = UUID.randomUUID();
    create(track, new MapObjectContent(MapObjectContent.SYMBOL, DataType.GENERAL, MapObjectContent.MANUAL, null, rig.layer.id(), new Geometry.Point(from),
        new Symbol(SymbolStandard.APP_6D, Rig.SIDC, new Modifiers(Map.of(), 0.0, 8.33)), null, null, rig.ctx.defaultLabel(), Extensions.empty()));
    start(radar, "\"create\": true, \"preset\": \"custom\", \"mode\": \"systematic\", \"searchWidth\": 1.7, \"dwellDepth\": 2000, \"dwellInterval\": 0.1,"
        + " \"targetRevisitSeconds\": 1, \"startBearing\": 180, \"endBearing\": 360, \"minRange\": 0, \"maxRange\": 5000, \"rangeError\": 20,"
        + " \"crossRangeError\": 50, \"outputs\": [\"gmti/vista-out\"]");
    for (int s = 1; s <= 40; s++) {
      moveTo(track, Geodesy.direct(from, 0, 8.33 * s)); // 30 km/h north, across the line of sight
      rig.seconds(1);
    }
    List<ChannelItem.SensorReport> all = sent();
    Instant found = all.stream().filter(r -> detects(r, track)).findFirst().orElseThrow().time();
    for (int n = 1; n <= 30; n++) {
      Instant due = found.plusSeconds(n);
      assertThat(all.stream().filter(r -> r.time().equals(due)).toList()).as("its own dwell %d s after it was found", n).singleElement().satisfies(r -> {
        assertThat(detects(r, track)).isTrue();
        Geometry.ArcBand b = band(r);
        assertThat(Detector.normal(b.endBearing() - b.startBearing())).as("the search width").isCloseTo(1.7, within(1e-6));
        assertThat(b.outerRadius() - b.innerRadius()).as("the dwell depth").isCloseTo(2_000.0, within(1e-6));
      });
    }
    assertThat(all.stream().filter(r -> r.time().isAfter(found) && r.time().isBefore(found.plusSeconds(30)) && band(r).innerRadius() >= 2_000))
        .as("meanwhile the scan was in the other rows").hasSizeGreaterThan(100);
    assertThat(all.stream().filter(r -> detects(r, track)).flatMap(r -> r.detections().stream()).filter(d -> d.objectId().equals(track))
        .map(d -> ((Geometry.Point) d.content().geometry()).coordinates()).distinct().count()).as("reported with its errors, as before").isGreaterThan(20);
  }

  @Test
  @DisplayName("M9 (owner YW): a platform that turns 90° in the middle of a pass: the pass goes on from its next cell, 0.1 s later, turned with it; every later scan dwell lies inside the arc from its heading")
  void theScanTurnsWithThePlatform() {
    UUID radar = platform();
    start(radar, SCAN);
    rig.seconds(2);
    int before = sent().size();
    assertThat(before).as("the turn falls inside the first pass, after its 11th cell").isEqualTo(11);
    turn(radar, 90);
    rig.seconds(2);
    List<ChannelItem.SensorReport> first = pass(0);
    assertThat(first).hasSize(20);
    for (int k = 0; k < 20; k++) {
      ChannelItem.SensorReport r = first.get(k);
      double heading = k < before ? 0 : 90;
      assertThat(cell(r, heading)).as("dwell %d in the frame of heading %s", k, heading).isTrue();
      assertThat(Detector.normal(band(r).startBearing() - heading)).as("dwell %d: the same column", k).isCloseTo(1.7 * (k % 10), within(1e-6));
      assertThat(band(r).innerRadius()).as("dwell %d: the same row", k).isEqualTo(k < 10 ? 20_000.0 : 115_000.0);
      assertThat(band(r).center()).isEqualTo(PLATFORM);
      assertThat(r.sequence()).isEqualTo(new ChannelItem.SensorReport.Sequence(0, k, k == 19));
      if (k > 0) {
        assertThat(Duration.between(first.get(k - 1).time(), r.time())).as("dwell %d", k).isEqualTo(Duration.ofMillis(100));
      }
    }
    assertThat(sent().subList(before, sent().size())).as("inside the arc of 90° to 107°")
        .allSatisfy(r -> assertThat(Detector.normal(band(r).endBearing() - 90)).isBetween(1.0, 17.0 + 1e-6));
  }

  @Test
  @DisplayName("M9 (owner YW2 A): a found target outside the arc after a turn gets no own dwell; each due one counts a miss, so after 3 it is dropped and only the scan finds it again; one miss does not drop it")
  void outsideTheArcIsAMiss() {
    UUID radar = platform();
    UUID track = at(8, 60_000);
    start(radar, SCAN);
    Rig.ok(sensor(radar, "\"targetRevisitSeconds\": 1"));
    rig.seconds(3);
    assertThat(sent().stream().filter(r -> SensorScanTest.own(r) && detects(r, track))).as("found, with own dwells").isNotEmpty();
    int before = sent().size();
    turn(radar, 90); // the track, at 8°, is now 82° left of the arc
    rig.seconds(6);
    List<ChannelItem.SensorReport> turned = sent().subList(before, sent().size());
    assertThat(turned).as("no own dwell: only the scan's cells, turned").hasSizeGreaterThan(50).allMatch(r -> cell(r, 90) && !detects(r, track));
    int back = sent().size();
    turn(radar, 0);
    rig.seconds(5);
    List<ChannelItem.SensorReport> again = sent().subList(back, sent().size()).stream().filter(r -> detects(r, track)).toList();
    assertThat(again).hasSizeGreaterThanOrEqualTo(2);
    assertThat(cell(again.getFirst(), 0)).as("dropped after 3 misses: the scan finds it first").isTrue();
    assertThat(own(again.get(1))).isTrue();
    assertThat(Duration.between(again.getFirst().time(), again.get(1).time())).as("its own dwell a Target revisit after the scan found it").isEqualTo(Duration.ofSeconds(1));

    // One miss: still found, its own dwells go on on the same beat.
    rig = new Rig();
    UUID radar2 = platform();
    UUID track2 = at(8, 60_000);
    start(radar2, SCAN);
    Rig.ok(sensor(radar2, "\"targetRevisitSeconds\": 1"));
    rig.seconds(3);
    turn(radar2, 90);
    rig.seconds(1);
    turn(radar2, 0);
    rig.seconds(3);
    List<Instant> owns = sent().stream().filter(r -> own(r) && detects(r, track2)).map(ChannelItem.SensorReport::time).toList();
    assertThat(owns).hasSizeGreaterThanOrEqualTo(4);
    List<Duration> gaps = new java.util.ArrayList<>();
    for (int n = 1; n < owns.size(); n++) {
      gaps.add(Duration.between(owns.get(n - 1), owns.get(n)));
    }
    assertThat(gaps).as("every Target revisit, the one outside the arc left out").containsOnly(Duration.ofSeconds(1), Duration.ofSeconds(2))
        .containsOnlyOnce(Duration.ofSeconds(2));
  }

  @Test
  @DisplayName("M9 (owner YW3 A): Random keeps T-193's bearings, planned at the revisit's start: a turn in a revisit leaves its dwells in the old arc; the next revisit is planned in the new one")
  void randomKeepsItsPlannedBearings() {
    UUID radar = platform();
    start(radar, "\"create\": true, \"preset\": \"custom\", \"mode\": \"random\", \"searchWidth\": 1.7, \"dwellDepth\": 95000, \"dwellInterval\": 0.1,"
        + " \"revisitSeconds\": 2, \"startBearing\": 0, \"endBearing\": 17, \"minRange\": 20000, \"maxRange\": 210000, \"rangeError\": 0,"
        + " \"crossRangeError\": 0, \"outputs\": [\"gmti/vista-out\"]");
    rig.seconds(2);
    int before = sent().size();
    assertThat(before).as("the turn falls inside the first revisit, after its 11th dwell").isEqualTo(11);
    turn(radar, 90);
    rig.seconds(3);
    assertThat(pass(0)).hasSize(20).allSatisfy(r -> {
      assertThat(band(r).startBearing()).isBetween(-1e-6, 17.0);
      assertThat(band(r).endBearing()).isBetween(1.0, 17.0 + 1e-6);
    });
    assertThat(pass(1)).hasSize(20).allSatisfy(r -> {
      assertThat(band(r).startBearing()).isBetween(90 - 1e-6, 107.0);
      assertThat(band(r).endBearing()).isBetween(91.0, 107.0 + 1e-6);
    });
  }
}
