package dev.emcc.plugins.simulator;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.sdk.DataType;
import dev.emcc.sdk.geo.GeodesicLeg;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import java.util.ArrayList;
import java.util.List;
import java.util.SplittableRandom;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** What a revisit sees (brief function 28; criteria 36 to 40), on the detection model alone. */
class DetectorTest {

  /** Latitude ≠ longitude. */
  private static final Position PLATFORM = Position.of(17.0, 58.0);
  private static final String GROUND = "10031000001211000000";
  private static final String AIR = "10030100001101000000";
  private static final String DISMOUNTED = "10032700001100000000";

  private static SensorSettings settings(String json) throws SensorSettings.Invalid {
    return SensorSettings.parse(Routes.json(json), RIGHT);
  }

  private static Detector.Target target(double bearing, double metres, String sidc, Double speed, Double direction) {
    Position at = Geodesy.direct(PLATFORM, bearing, metres);
    var content = new MapObjectContent(MapObjectContent.SYMBOL, DataType.GENERAL, MapObjectContent.MANUAL, null, UUID.randomUUID(), new Geometry.Point(at),
        new Symbol(SymbolStandard.APP_6D, sidc, null), null, null, SecurityLabel.of("NATO", "UNCLASSIFIED"), Extensions.empty());
    return new Detector.Target(UUID.randomUUID(), content, at, speed, direction);
  }

  private static List<UUID> ids(Detector.Look look) {
    return look.seen().stream().map(Detector.Seen::id).toList();
  }

  /** M5's right-looking sensor, 45° to 135°: from M7 a new ground radar looks all round (function 42). */
  static final SensorSettings RIGHT = right();

  private static SensorSettings right() {
    try {
      return SensorSettings.parse(Routes.json("{\"startBearing\": 45, \"endBearing\": 135}"), SensorSettings.GROUND_RADAR);
    } catch (SensorSettings.Invalid e) {
      throw new AssertionError(e);
    }
  }

  @Test
  @DisplayName("Criterion 36: the band and bearings turn with the heading, and a sector may cross north")
  void theArea() throws Exception {
    SensorSettings defaults = RIGHT;
    assertThat(Detector.area(PLATFORM, 0, defaults)).isEqualTo(new Geometry.ArcBand(PLATFORM, 20_000, 150_000, 45, 135));
    assertThat(Detector.area(PLATFORM, 90, defaults)).isEqualTo(new Geometry.ArcBand(PLATFORM, 20_000, 150_000, 135, 225));
    assertThat(Detector.area(PLATFORM, 0, settings("{\"startBearing\": 300, \"endBearing\": 60}")))
        .isEqualTo(new Geometry.ArcBand(PLATFORM, 20_000, 150_000, 300, 60));
    assertThat(Detector.area(PLATFORM, 300, defaults)).isEqualTo(new Geometry.ArcBand(PLATFORM, 20_000, 150_000, 345, 75));
    // Across north, a track at 10° is inside and one at 90° is not.
    SensorSettings north = settings("{\"startBearing\": 300, \"endBearing\": 60, \"detectionProbability\": 1, \"minimumDetectableSpeed\": 0}");
    Detector.Target in = target(10, 50_000, GROUND, null, null);
    Detector.Target out = target(90, 50_000, GROUND, null, null);
    assertThat(ids(Detector.look(PLATFORM, 0, List.of(in, out), north, new SplittableRandom(1)))).containsExactly(in.id());
    assertThat(Detector.nearEdge(defaults)).isEqualTo(20_000);
  }

  @Test
  @DisplayName("Criterion 36, equal bearings (the owner's MX A): 45° to 45° and 0° to 360° give the full ring, an ArcBand with equal bearings, and detect all round")
  void equalBearings() throws Exception {
    for (String bearings : List.of("\"startBearing\": 90, \"endBearing\": 90", "\"startBearing\": 45, \"endBearing\": 45", "\"startBearing\": 0, \"endBearing\": 360")) {
      SensorSettings all = settings("{" + bearings + ", \"detectionProbability\": 1, \"minimumDetectableSpeed\": 0}");
      assertThat(Detector.span(all)).isEqualTo(360);
      assertThat(Detector.area(PLATFORM, 30, all)).isEqualTo(new Geometry.ArcBand(PLATFORM, 20_000, 150_000, Detector.normal(30 + all.startBearing()), Detector.normal(30 + all.startBearing())));
      List<Detector.Target> round = new ArrayList<>();
      for (double bearing = 0; bearing < 360; bearing += 45) round.add(target(bearing, 50_000, GROUND, null, null));
      Detector.Target near = target(75, 10_000, GROUND, null, null); // inside the min range
      List<Detector.Target> targets = new ArrayList<>(round);
      targets.add(near);
      assertThat(ids(Detector.look(PLATFORM, 30, targets, all, new SplittableRandom(1)))).containsExactlyInAnyOrderElementsOf(round.stream().map(Detector.Target::id).toList());
    }
    SensorSettings disc = settings("{\"startBearing\": 45, \"endBearing\": 45, \"minRange\": 0}");
    assertThat(Detector.area(PLATFORM, 0, disc)).isEqualTo(new Geometry.Circle(PLATFORM, 150_000));
  }

  @Test
  @DisplayName("Criterion 37: Pd 1 and no errors detects only the track inside and fast enough; Pd 0 none; every track type is detected (owner, A99)")
  void detection() throws Exception {
    SensorSettings sure = settings("{\"detectionProbability\": 1, \"rangeError\": 0, \"crossRangeError\": 0, \"minimumDetectableSpeed\": 2}");
    Detector.Target moving = target(90, 50_000, GROUND, 10.0, 90.0);
    Detector.Target slow = target(90, 60_000, GROUND, 1.0, 90.0);
    Detector.Target crossing = target(90, 70_000, GROUND, 10.0, 0.0); // across the beam: radial speed about 0
    Detector.Target behind = target(270, 50_000, GROUND, 10.0, 270.0);
    Detector.Target air = target(100, 80_000, AIR, 200.0, 280.0); // towards the platform
    Detector.Target dismounted = target(120, 30_000, DISMOUNTED, 3.0, 120.0);
    Detector.Look look = Detector.look(PLATFORM, 0, List.of(moving, slow, crossing, behind, air, dismounted), sure, new SplittableRandom(1));
    assertThat(ids(look)).containsExactly(dismounted.id(), moving.id(), air.id()); // nearest first
    assertThat(look.seen().getFirst().measured()).isEqualTo(dismounted.position()); // errors 0: no error
    SensorSettings never = settings("{\"detectionProbability\": 0}");
    assertThat(Detector.look(PLATFORM, 0, List.of(moving, air), never, new SplittableRandom(1)).seen()).isEmpty();
  }

  @Test
  @DisplayName("Criterion 38: over 1 000 revisits with a fixed seed, the spread along and across the line of sight matches the sigmas within 10 %")
  void errors() throws Exception {
    SensorSettings s = settings("{\"detectionProbability\": 1, \"rangeError\": 20, \"crossRangeError\": 50}");
    Detector.Target t = target(90, 50_000, GROUND, 10.0, 90.0);
    double lineOfSight = Geodesy.inverse(PLATFORM, t.position()).finalAzimuth();
    var random = new SplittableRandom(42);
    List<Double> along = new ArrayList<>();
    List<Double> across = new ArrayList<>();
    for (int i = 0; i < 1_000; i++) {
      Position measured = Detector.look(PLATFORM, 0, List.of(t), s, random).seen().getFirst().measured();
      GeodesicLeg offset = Geodesy.inverse(t.position(), measured);
      double angle = Math.toRadians(offset.initialAzimuth() - lineOfSight);
      along.add(offset.distanceMetres() * Math.cos(angle));
      across.add(offset.distanceMetres() * Math.sin(angle));
    }
    assertThat(sigma(along)).isCloseTo(20, within(2.0));
    assertThat(sigma(across)).isCloseTo(50, within(5.0));
  }

  private static double sigma(List<Double> values) {
    double mean = values.stream().mapToDouble(Double::doubleValue).average().orElseThrow();
    return Math.sqrt(values.stream().mapToDouble(v -> (v - mean) * (v - mean)).sum() / (values.size() - 1));
  }

  @Test
  @DisplayName("Criterion 39: \"Detect all in range\" detects every track within the max range at its true position, standing or outside the bearings, in a Circle")
  void detectAll() throws Exception {
    SensorSettings all = settings("{\"detectAll\": true, \"detectionProbability\": 0, \"minimumDetectableSpeed\": 100}");
    Detector.Target standing = target(90, 50_000, GROUND, null, null);
    Detector.Target behind = target(270, 140_000, AIR, 10.0, 0.0);
    Detector.Target far = target(90, 151_000, GROUND, 10.0, 90.0);
    Detector.Look look = Detector.look(PLATFORM, 0, List.of(standing, behind, far), all, new SplittableRandom(1));
    assertThat(ids(look)).containsExactly(standing.id(), behind.id());
    assertThat(look.seen()).allMatch(seen -> seen.measured().equals(seen.content().geometry() instanceof Geometry.Point p ? p.coordinates() : null));
    assertThat(look.area()).isEqualTo(new Geometry.Circle(PLATFORM, 150_000));
    assertThat(look.nearEdge()).isZero();
  }

  @Test
  @DisplayName("Criterion 40: 300 tracks inside with \"most detections per dwell\" 200 give the 200 nearest, and count 100")
  void theCap() throws Exception {
    SensorSettings s = settings("{\"detectAll\": true, \"maxRange\": 1000000}");
    List<Detector.Target> targets = new ArrayList<>();
    for (int i = 300; i >= 1; i--) {
      targets.add(target(90, i * 1_000.0, GROUND, null, null));
    }
    Detector.Look look = Detector.look(PLATFORM, 0, targets, s, new SplittableRandom(1));
    assertThat(look.seen()).hasSize(200);
    assertThat(look.overCap()).isEqualTo(100);
    assertThat(look.seen().getLast().distance()).isCloseTo(200_000, within(1.0));
  }
}
