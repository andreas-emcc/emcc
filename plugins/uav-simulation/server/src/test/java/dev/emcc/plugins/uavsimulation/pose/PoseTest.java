package dev.emcc.plugins.uavsimulation.pose;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.sdk.DataType;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** A frame's pose from a platform object and a camera's settings (brief functions 3 and 4). */
class PoseTest {

  private static final Instant T0 = Instant.parse("2026-11-16T12:00:00Z");
  private static final String UAV = "10030100001101000000";
  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "RESTRICTED");
  private static final Pose.Setup FIXED = new Pose.Setup(new Pointing.FixedAngles(90, 30), 20, Frame.DEFAULT, 1000, "");

  private static MapObjectContent symbol(Geometry geometry, @Nullable Double direction, @Nullable Double speed, @Nullable String name, SecurityLabel label) {
    Modifiers m = direction == null && speed == null ? null : new Modifiers(Map.of(), direction, speed);
    return new MapObjectContent(MapObjectContent.SYMBOL, DataType.GENERAL, MapObjectContent.MANUAL, null, UUID.randomUUID(), geometry,
        new Symbol(SymbolStandard.APP_6D, UAV, m), null, name == null ? null : new ObjectProperties(name, null), label, Extensions.empty());
  }

  private static Platform platform(Position at, @Nullable Double direction, @Nullable Double speed) {
    Platform p = Platform.of(symbol(new Geometry.Point(at), direction, speed, "Hawk 1", LABEL), T0);
    assertThat(p).isNotNull();
    return p;
  }

  private static Pose pose(Pose.Setup setup, Platform platform, long millis) {
    return Pose.at("camera-1", setup, platform, null, T0.plusMillis(millis), Duration.ofMillis(millis), null).pose();
  }

  @Test
  @DisplayName("Criterion 6: a platform at [17.3, 62.4, 500] gives poses at 500 m; at [17.3, 62.4] the Height setting")
  void height() {
    assertThat(pose(FIXED, platform(Position.of(17.3, 62.4, 500), 45.0, null), 0).position()).isEqualTo(Position.of(17.3, 62.4, 500));
    assertThat(pose(FIXED, platform(Position.of(17.3, 62.4), 45.0, null), 0).position()).isEqualTo(Position.of(17.3, 62.4, 1000));
    Pose.Setup high = new Pose.Setup(FIXED.pointing(), 20, Frame.DEFAULT, 2500, "");
    assertThat(pose(high, platform(Position.of(17.3, 62.4), 45.0, null), 0).position().altitude()).isEqualTo(2500);
  }

  @Test
  @DisplayName("Criterion 7: azimuth 90°, depression 30° on direction 45°; heading 0 without one; pitch and roll 0; vertical 11.33°")
  void fixedAnglesPose() {
    Pose p = pose(FIXED, platform(Position.of(17.3, 62.4, 500), 45.0, null), 40);
    assertThat(p.heading()).isEqualTo(45);
    assertThat(p.aim()).isEqualTo(new Aim(90, 30));
    assertThat(p.pitch()).isZero();
    assertThat(p.roll()).isZero();
    assertThat(p.cameraRoll()).isZero();
    assertThat(p.horizontalFov()).isEqualTo(20);
    assertThat(p.verticalFov()).isCloseTo(11.33, within(0.01));
    assertThat(p.frame()).isEqualTo(new Frame(1280, 720, 25));
    assertThat(p.time()).isEqualTo(T0.plusMillis(40));
    assertThat(p.cameraId()).isEqualTo("camera-1");
    assertThat(pose(FIXED, platform(Position.of(17.3, 62.4, 500), null, null), 0).heading()).isZero();
  }

  @Test
  @DisplayName("Criterion 24: the sway moves the camera's azimuth, depression and roll only: wrapped, held at ±90° and wrapped to ±180°")
  void swayed() {
    Pose p = pose(FIXED, platform(Position.of(17.3, 62.4, 500), 45.0, null), 40);
    assertThat(p.swayed(Sway.Offsets.NONE)).isSameAs(p);
    Pose s = p.swayed(new Sway.Offsets(0.25, -0.5, 0.1));
    assertThat(s.aim().azimuth()).isCloseTo(90.25, within(1e-12));
    assertThat(s.aim().depression()).isCloseTo(29.5, within(1e-12));
    assertThat(s.cameraRoll()).isCloseTo(0.1, within(1e-12));
    assertThat(s.heading()).isEqualTo(45);
    assertThat(s.pitch()).isZero();
    assertThat(s.roll()).isZero();
    assertThat(s.position()).isEqualTo(p.position());
    assertThat(s.time()).isEqualTo(p.time());
    assertThat(s.label()).isEqualTo(p.label());

    Pose north = pose(new Pose.Setup(new Pointing.FixedAngles(359.9, 90), 20, Frame.DEFAULT, 1000, ""), platform(Position.of(17.3, 62.4, 500), 0.0, null), 0);
    Pose over = north.swayed(new Sway.Offsets(0.3, 0.4, -180.5));
    assertThat(over.aim().azimuth()).isCloseTo(0.2, within(1e-9));
    assertThat(over.aim().depression()).isEqualTo(90);
    assertThat(over.cameraRoll()).isCloseTo(179.5, within(1e-9));
    assertThat(north.swayed(new Sway.Offsets(-0.2, 0, 0)).aim().azimuth()).isCloseTo(359.7, within(1e-9));
  }

  @Test
  @DisplayName("Criterion 11: the pose's position is the platform's, extrapolated to the frame time, then held")
  void extrapolatedPosition() {
    Platform moving = platform(Position.of(17.3, 62.4, 500), 90.0, 50.0);
    Pose.Computed half = Pose.at("c", FIXED, moving, null, T0.plusMillis(500), Duration.ZERO, null);
    Pose.Computed late = Pose.at("c", FIXED, moving, null, T0.plusMillis(3000), Duration.ZERO, null);
    assertThat(Geodesy.inverse(Position.of(17.3, 62.4), half.pose().position()).distanceMetres()).isCloseTo(25, within(0.1));
    assertThat(half.held()).isFalse();
    assertThat(Geodesy.inverse(Position.of(17.3, 62.4), late.pose().position()).distanceMetres()).isCloseTo(75, within(0.1));
    assertThat(late.held()).isTrue();
    assertThat(late.pose().position().altitude()).isEqualTo(500);
  }

  @Test
  @DisplayName("Criterion 13: the pose carries the platform's label as stored, its name and the Mission")
  void namesAndLabel() {
    Pose.Setup withMission = new Pose.Setup(FIXED.pointing(), 20, Frame.DEFAULT, 1000, "Övning Nord");
    Pose p = pose(withMission, platform(Position.of(17.3, 62.4), 0.0, null), 0);
    assertThat(p.label()).isEqualTo(LABEL);
    assertThat(p.platformName()).isEqualTo("Hawk 1");
    assertThat(p.mission()).isEqualTo("Övning Nord");
    SecurityLabel secret = SecurityLabel.of("NATO", "SECRET");
    Platform relabelled = Platform.of(symbol(new Geometry.Point(Position.of(17.3, 62.4)), 0.0, null, null, secret), T0);
    assertThat(pose(withMission, relabelled, 40).label()).isEqualTo(secret);
    assertThat(pose(withMission, relabelled, 40).platformName()).isNull();
  }

  @Test
  @DisplayName("Criterion 9: Track an object through the pose: the target's aim, and Target gone without it")
  void trackAnObjectPose() {
    Pose.Setup track = new Pose.Setup(new Pointing.TrackObject(0), 20, Frame.DEFAULT, 1000, "");
    Platform still = platform(Position.of(17.30, 62.40), null, null);
    Position east = Geodesy.direct(Position.of(17.30, 62.40), 90, 1000);
    Fix target = new Fix(east, null, null, T0);
    Pose.Computed seen = Pose.at("c", track, still, target, T0, Duration.ZERO, null);
    assertThat(seen.targetGone()).isFalse();
    assertThat(seen.pose().aim().azimuth()).isCloseTo(90, within(0.05));
    assertThat(seen.pose().aim().depression()).isCloseTo(45, within(0.05));
    Pose.Computed gone = Pose.at("c", track, still, null, T0.plusMillis(40), Duration.ofMillis(40), seen.pose().aim());
    assertThat(gone.targetGone()).isTrue();
    assertThat(gone.pose().aim()).isEqualTo(seen.pose().aim());
  }

  @Test
  @DisplayName("Function 3: only a core.symbol is a platform; the name is stripped, a blank one is none")
  void platformFromAnObject() {
    Position at = Position.of(17.3, 62.4, 300);
    Platform p = Platform.of(symbol(new Geometry.Point(at), 12.5, 40.0, "  Hawk 2 ", LABEL), T0);
    assertThat(p).isEqualTo(new Platform(new Fix(at, 12.5, 40.0, T0), "Hawk 2", LABEL));
    assertThat(Platform.of(symbol(new Geometry.Point(at), null, null, "   ", LABEL), T0).name()).isNull();
    // A core.symbol always has a Point (the model refuses another geometry); a shape is no platform.
    MapObjectContent c = symbol(new Geometry.Point(at), null, null, null, LABEL);
    MapObjectContent shape = new MapObjectContent("core.shape", c.dataType(), c.dataSource(), c.time(), c.layerId(), c.geometry(), null, null, null, LABEL, Extensions.empty());
    assertThat(Platform.of(shape, T0)).isNull();
  }

  @Test
  void setupRefusesWhatTheGeometryCannotUse() {
    assertThatThrownBy(() -> new Pose.Setup(FIXED.pointing(), 0, Frame.DEFAULT, 1000, "")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Pose.Setup(FIXED.pointing(), 20, Frame.DEFAULT, Double.NaN, "")).isInstanceOf(IllegalArgumentException.class);
  }
}
