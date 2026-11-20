package dev.emcc.plugins.uavsimulation.pose;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Position;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The four pointing modes (brief function 6). */
class GimbalTest {

  private static final Instant T0 = Instant.parse("2026-11-16T12:00:00Z");
  private static final Position CAMERA = Position.of(17.30, 62.40, 1000.0);

  private static Aim aim(Pointing pointing, double heading) {
    return Gimbal.point(pointing, CAMERA, heading, T0, Duration.ZERO, null, null).aim();
  }

  @Test
  @DisplayName("Criterion 7: fixed angles 90° and 30° stay relative, whatever the heading")
  void fixedAngles() {
    for (double heading : new double[] {0, 45, 300}) {
      assertThat(aim(new Pointing.FixedAngles(90, 30), heading)).isEqualTo(new Aim(90, 30));
    }
    assertThat(new Pointing.FixedAngles(360, -90)).isEqualTo(new Pointing.FixedAngles(0, -90));
  }

  @Test
  @DisplayName("Criterion 8: track a point: north 0°, below 90°, east 90°, and east with heading 90° gives 0°")
  void trackAPoint() {
    Aim north = aim(new Pointing.TrackPoint(17.30, 62.41, 0), 0);
    assertThat(north.azimuth()).isCloseTo(0, within(1e-9));
    assertThat(north.depression()).isCloseTo(41.9, within(0.05))
        .isCloseTo(LookAngles.between(17.30, 62.40, 1000, 17.30, 62.41, 0).depression(), within(1e-12));

    assertThat(aim(new Pointing.TrackPoint(17.30, 62.40, 0), 0)).isEqualTo(new Aim(0, 90));
    assertThat(aim(new Pointing.TrackPoint(17.30, 62.40, 0), 135)).as("straight below: azimuth 0 whatever the heading").isEqualTo(new Aim(0, 90));

    Position east = Geodesy.direct(Position.of(17.30, 62.40), 90, 1500);
    Pointing.TrackPoint eastPoint = new Pointing.TrackPoint(east.longitude(), east.latitude(), 0);
    assertThat(aim(eastPoint, 0).azimuth()).isCloseTo(90, within(0.05));
    double turned = aim(eastPoint, 90).azimuth();
    assertThat(Math.min(turned, 360 - turned)).as("0° relative, either side of north").isLessThan(0.05);
  }

  @Test
  @DisplayName("Criterion 8: the point's height counts (a point at the camera's height lies at the horizon, less the curvature)")
  void pointHeight() {
    Position east = Geodesy.direct(Position.of(17.30, 62.40), 90, 1500);
    Aim level = aim(new Pointing.TrackPoint(east.longitude(), east.latitude(), 1000), 0);
    assertThat(level.depression()).isCloseTo(Math.toDegrees(1500 / (2 * 6_380_000.0)), within(0.001));
  }

  @Test
  @DisplayName("Criterion 9: a target moving east at 20 m/s under a still platform: each frame aims at its extrapolated position")
  void trackAMovingObject() {
    Position start = Geodesy.direct(Position.of(17.30, 62.40), 270, 100);
    Fix target = new Fix(start, 90.0, 20.0, T0);
    Pointing.TrackObject mode = new Pointing.TrackObject(0);
    for (int ms = 0; ms <= 1500; ms += 40) {
      Instant time = T0.plusMillis(ms);
      Gimbal.Pointed p = Gimbal.point(mode, CAMERA, 0, time, Duration.ofMillis(ms), target, null);
      Position there = Geodesy.direct(start, 90, 20 * ms / 1000.0);
      LookAngles expected = LookAngles.between(17.30, 62.40, 1000, there.longitude(), there.latitude(), 0);
      assertThat(p.targetGone()).isFalse();
      assertThat(p.aim().azimuth()).as("at %d ms", ms).isCloseTo(expected.azimuth(), within(0.05));
      assertThat(p.aim().depression()).as("at %d ms", ms).isCloseTo(expected.depression(), within(0.05));
    }
    // By hand, flat: 100 m west at 0 s (depression atan(1000 / 100)), 80 m west at 1 s.
    Aim first = Gimbal.point(mode, CAMERA, 0, T0, Duration.ZERO, target, null).aim();
    Aim second = Gimbal.point(mode, CAMERA, 0, T0.plusSeconds(1), Duration.ofSeconds(1), target, null).aim();
    assertThat(first.azimuth()).isCloseTo(270, within(0.05));
    assertThat(first.depression()).isCloseTo(Math.toDegrees(Math.atan(10)), within(0.05));
    assertThat(second.depression()).isCloseTo(Math.toDegrees(Math.atan(12.5)), within(0.05));
  }

  @Test
  @DisplayName("Criterion 9: the target's altitude counts; without one, the height setting")
  void targetHeight() {
    Position east = Geodesy.direct(Position.of(17.30, 62.40), 90, 1000);
    Fix withAltitude = new Fix(Position.of(east.longitude(), east.latitude(), 1000.0), null, null, T0);
    Fix without = new Fix(Position.of(east.longitude(), east.latitude()), null, null, T0);
    double level = Gimbal.point(new Pointing.TrackObject(0), CAMERA, 0, T0, Duration.ZERO, withAltitude, null).aim().depression();
    double setting = Gimbal.point(new Pointing.TrackObject(1000), CAMERA, 0, T0, Duration.ZERO, without, null).aim().depression();
    double ground = Gimbal.point(new Pointing.TrackObject(0), CAMERA, 0, T0, Duration.ZERO, without, null).aim().depression();
    assertThat(level).isCloseTo(0, within(0.01)).isEqualTo(setting);
    assertThat(ground).isCloseTo(45, within(0.05));
  }

  @Test
  @DisplayName("Criterion 9: a target gone keeps the last angles, and says so (U7)")
  void targetGoneKeepsTheLastAim() {
    Aim last = new Aim(123.4, 56.7);
    Gimbal.Pointed gone = Gimbal.point(new Pointing.TrackObject(0), CAMERA, 80, T0, Duration.ofSeconds(9), null, last);
    assertThat(gone).isEqualTo(new Gimbal.Pointed(last, true));
    Gimbal.Pointed neverSeen = Gimbal.point(new Pointing.TrackObject(0), CAMERA, 80, T0, Duration.ZERO, null, null);
    assertThat(neverSeen).isEqualTo(new Gimbal.Pointed(Aim.DEFAULT, true));
  }

  @Test
  @DisplayName("Criterion 10: sweep 315° to 45° at 10°/s: 315, 0, 45, 0, 315 at 0, 4.5, 9, 13.5 and 18 s, across north")
  void sweep() {
    Pointing.Sweep s = new Pointing.Sweep(315, 45, 10, 30);
    double[][] expected = {{0, 315}, {2, 335}, {4.5, 0}, {9, 45}, {11, 25}, {13.5, 0}, {18, 315}, {22.5, 0}, {27, 45}};
    for (double[] e : expected) {
      Duration since = Duration.ofMillis(Math.round(e[0] * 1000));
      Aim a = Gimbal.point(s, CAMERA, 200, T0, since, null, null).aim();
      double off = Math.abs(a.azimuth() - e[1]);
      assertThat(Math.min(off, 360 - off)).as("at %s s", e[0]).isLessThan(0.01);
      assertThat(a.depression()).isEqualTo(30);
    }
    // Never the long way round: every frame of a period stays inside the sector.
    for (int ms = 0; ms <= 18_000; ms += 40) {
      double az = Gimbal.point(s, CAMERA, 0, T0, Duration.ofMillis(ms), null, null).aim().azimuth();
      assertThat(az >= 315 - 1e-9 || az <= 45 + 1e-9).as("%s at %d ms", az, ms).isTrue();
    }
  }

  @Test
  @DisplayName("Sweep: a sector that does not cross north, and equal bearings refused (U8)")
  void sweepOtherSectors() {
    Pointing.Sweep s = new Pointing.Sweep(30, 120, 30, 10);
    assertThat(Gimbal.sweep(s, Duration.ofSeconds(1))).isCloseTo(60, within(1e-9));
    assertThat(Gimbal.sweep(s, Duration.ofSeconds(4))).isCloseTo(90, within(1e-9));
    assertThat(Gimbal.sweep(s, Duration.ofSeconds(6))).isCloseTo(30, within(1e-9));
    assertThat(new Pointing.Sweep(0, 360 - 1e-6, 1, 0).width()).isCloseTo(360, within(1e-5));
    assertThatThrownBy(() -> new Pointing.Sweep(45, 45, 10, 30)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Pointing.Sweep(0, 360, 10, 30)).as("360 is 0").isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Pointing.Sweep(0, 90, 0, 30)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void refusesWhatTheGeometryCannotUse() {
    assertThatThrownBy(() -> new Pointing.TrackPoint(62.4, 117.3, 0)).as("lon, lat order").isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Pointing.FixedAngles(0, 91)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Gimbal.point(new Pointing.FixedAngles(0, 0), Position.of(17.3, 62.4), 0, T0, Duration.ZERO, null, null))
        .isInstanceOf(NullPointerException.class);
  }
}
