package dev.emcc.plugins.uavsimulation.pose;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Position;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The line of sight by WGS84 ECEF and the local north, east, down frame (brief function 6). */
class LookAnglesTest {

  @Test
  @DisplayName("ECEF: reference points on the axes, and a point where latitude differs from longitude")
  void ecefMatchesReferencePoints() {
    assertThat(LookAngles.ecef(0, 0, 0)).containsExactly(new double[] {6_378_137.0, 0, 0}, within(1e-6));
    assertThat(LookAngles.ecef(90, 0, 100)).containsExactly(new double[] {0, 6_378_237.0, 0}, within(1e-6));
    // The pole: the semi-minor axis b = a (1 - f).
    assertThat(LookAngles.ecef(0, 90, 0)[2]).isCloseTo(6_356_752.314245, within(1e-6));
    // lon 17.3, lat 62.4 (a swapped order would fail each check): on the ellipsoid at height 0, its
    // geodetic latitude back from ECEF, and 136 m higher lies 136 m out along the same normal.
    double[] p = LookAngles.ecef(17.3, 62.4, 0);
    double horizontal = Math.hypot(p[0], p[1]);
    double b = LookAngles.A * (1 - LookAngles.F);
    assertThat(Math.toDegrees(Math.atan2(p[1], p[0]))).isCloseTo(17.3, within(1e-9));
    assertThat(Math.pow(horizontal / LookAngles.A, 2) + Math.pow(p[2] / b, 2)).isCloseTo(1, within(1e-12));
    assertThat(Math.toDegrees(Math.atan2(p[2], (1 - LookAngles.E2) * horizontal))).isCloseTo(62.4, within(1e-9));
    double[] up = LookAngles.ecef(17.3, 62.4, 136);
    assertThat(Math.sqrt(Math.pow(up[0] - p[0], 2) + Math.pow(up[1] - p[1], 2) + Math.pow(up[2] - p[2], 2))).isCloseTo(136, within(1e-6));
    assertThat(Math.toDegrees(Math.atan2(up[2] - p[2], Math.hypot(up[0] - p[0], up[1] - p[1])))).isCloseTo(62.4, within(1e-6));
  }

  @Test
  @DisplayName("Criterion 8: a point 0.01° north, 1 000 m below: azimuth 0, depression the ECEF line's (about 41.9°)")
  void pointNorthAndBelow() {
    LookAngles look = LookAngles.between(17.30, 62.40, 1000, 17.30, 62.41, 0);
    assertThat(look.azimuth()).isCloseTo(0, within(1e-9));
    // 0.01° of latitude at 62.4° N is about 1 115.6 m (Geodesy); the Earth's curvature lowers the point by
    // d² / 2R, about 0.1 m, and tilts the local vertical by d / R: together about 0.005° more depression.
    double metres = Geodesy.inverse(Position.of(17.30, 62.40), Position.of(17.30, 62.41)).distanceMetres();
    double flat = Math.toDegrees(Math.atan2(1000, metres));
    assertThat(look.depression()).isCloseTo(41.9, within(0.05)).isCloseTo(flat, within(0.02)).isGreaterThan(flat);
  }

  @Test
  @DisplayName("Criterion 8: a point straight below gives depression 90 and azimuth 0; straight above −90")
  void straightBelowAndAbove() {
    assertThat(LookAngles.between(17.30, 62.40, 1000, 17.30, 62.40, 0)).isEqualTo(new LookAngles(0, 90));
    assertThat(LookAngles.between(17.30, 62.40, 0, 17.30, 62.40, 1000)).isEqualTo(new LookAngles(0, -90));
    assertThat(LookAngles.between(17.30, 62.40, 1000, 17.30, 62.40, 1000)).isEqualTo(new LookAngles(0, 90));
  }

  @Test
  @DisplayName("Criterion 8: a point due east gives azimuth 90; due west 270, south 180")
  void compassPoints() {
    Position camera = Position.of(17.30, 62.40);
    for (double bearing : new double[] {90, 180, 270}) {
      Position p = Geodesy.direct(camera, bearing, 2000);
      LookAngles look = LookAngles.between(17.30, 62.40, 1000, p.longitude(), p.latitude(), 0);
      // The geodesic's start bearing and the chord's local azimuth differ by far less than 0.01° at 2 km.
      assertThat(look.azimuth()).as("bearing %s", bearing).isCloseTo(bearing, within(0.01));
      assertThat(look.depression()).isCloseTo(Math.toDegrees(Math.atan2(1000, 2000)), within(0.02));
    }
  }

  @Test
  @DisplayName("A point far away lies below the horizon at height 0: the Earth's curvature, no flat Earth")
  void farPointIsBelowTheHorizon() {
    // 100 km away at the same height: the chord dips below the local horizontal by about d / 2R = 0.45°.
    Position p = Geodesy.direct(Position.of(17.30, 62.40), 45, 100_000);
    LookAngles look = LookAngles.between(17.30, 62.40, 1000, p.longitude(), p.latitude(), 1000);
    assertThat(look.depression()).isCloseTo(Math.toDegrees(100_000 / (2 * 6_380_000.0)), within(0.01));
  }

  @Test
  void refusesAnglesOutOfRange() {
    assertThatThrownBy(() -> new LookAngles(360, 0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new LookAngles(0, 90.5)).isInstanceOf(IllegalArgumentException.class);
  }
}
