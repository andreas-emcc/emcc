package dev.emcc.sdk.geo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.sdk.model.Position;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * SDK 1.2.0 (CR-0025 part 7): geodesics, against GeographicLib's published examples
 * (geographiclib.sourceforge.io, Python documentation, "Examples"; read 2026-10-25), with points
 * where latitude differs from longitude, a path across the antimeridian, and the poles.
 */
class GeodesyTest {

  private static final double MM = 0.001;
  private static final double DEG = 1e-5; // the examples print five decimals

  @Test
  void theInverseProblemGivesTheDistanceWellingtonToSalamanca() {
    // Wellington (lat -41.32, lon 174.81) to Salamanca (lat 40.96, lon -5.50): 19959679.267 m.
    GeodesicLeg leg = Geodesy.inverse(Position.of(174.81, -41.32), Position.of(-5.50, 40.96));
    assertThat(leg.distanceMetres()).isCloseTo(19_959_679.267, within(MM));
  }

  @Test
  void theDirectProblemGivesThePoint20000KmSouthWestOfPerth() {
    // Perth (lat -32.06, lon 115.74), azimuth 225, 20 000 km: (32.11195529, -63.95925278).
    Position p = Geodesy.direct(Position.of(115.74, -32.06), 225, 20_000e3);
    assertThat(p.latitude()).isCloseTo(32.11195529, within(1e-8));
    assertThat(p.longitude()).isCloseTo(-63.95925278, within(1e-8));
  }

  @Test
  void aPathAcrossTheAntimeridianGivesTheWaypointsBeijingToSanFrancisco() {
    // InverseLine(40.1, 116.6, 37.6, -122.4), every 1000 km: distance, latitude, longitude, azimuth.
    GeodesicPath path = Geodesy.path(List.of(Position.of(116.6, 40.1), Position.of(-122.4, 37.6)));
    assertThat(path.lengthMetres()).isCloseTo(9_513_998, within(0.5));
    assertThat(path.legLengths()).hasSize(1);
    PathPoint start = path.at(0);
    assertThat(start.azimuth()).isCloseTo(42.91642, within(DEG));
    PathPoint first = path.at(1_000e3);
    assertThat(first.position().latitude()).isCloseTo(46.37321, within(DEG));
    assertThat(first.position().longitude()).isCloseTo(125.44903, within(DEG));
    assertThat(first.azimuth()).isCloseTo(48.99365, within(DEG));
    PathPoint pastTheAntimeridian = path.at(5_000e3);
    assertThat(pastTheAntimeridian.position().latitude()).isCloseTo(58.43499, within(DEG));
    assertThat(pastTheAntimeridian.position().longitude()).as("183.03167 east is 176.96833 west").isCloseTo(183.03167 - 360, within(DEG));
    assertThat(pastTheAntimeridian.azimuth()).isCloseTo(96.29014, within(DEG));
    assertThat(pastTheAntimeridian.fraction()).isCloseTo(5_000e3 / path.lengthMetres(), within(1e-12));
    PathPoint end = path.at(1e9);
    assertThat(end.position().latitude()).isCloseTo(37.6, within(1e-9));
    assertThat(end.position().longitude()).isCloseTo(-122.4, within(1e-9));
    assertThat(end.azimuth()).isCloseTo(138.89027, within(DEG));
    assertThat(end.fraction()).isEqualTo(1);
    assertThat(Geodesy.inverse(Position.of(116.6, 40.1), Position.of(-122.4, 37.6)).finalAzimuth()).isCloseTo(138.89027, within(DEG));
  }

  @Test
  void aQuarterMeridianReachesThePole() {
    // WGS84's quarter meridian: 10 001 965.729 m.
    GeodesicLeg leg = Geodesy.inverse(Position.of(30, 0), Position.of(30, 90));
    assertThat(leg.distanceMetres()).isCloseTo(10_001_965.729, within(MM));
    assertThat(leg.initialAzimuth()).isCloseTo(0, within(1e-9));
    Position pole = Geodesy.direct(Position.of(30, 0), 0, leg.distanceMetres());
    assertThat(pole.latitude()).isCloseTo(90, within(1e-9));
    Position south = Geodesy.direct(Position.of(-150, 0), 180, 10_001_965.729);
    assertThat(south.latitude()).as("the published length is rounded to the millimetre: 3e-9 degrees there").isCloseTo(-90, within(1e-8));
  }

  @Test
  void aPathWithSeveralLegsFindsTheLegAndKeepsAltitudes() {
    // lon differs from lat in every point, so a swapped order would show
    Position a = Position.of(18.0686, 59.3293, 45.0);
    Position b = Position.of(18.1012, 59.3507, 60.0);
    Position c = Position.of(18.1500, 59.3000);
    GeodesicPath path = Geodesy.path(List.of(a, b, b, c));
    List<Double> legs = path.legLengths();
    assertThat(legs).hasSize(3);
    assertThat(legs.get(1)).as("a repeated point is a leg of length 0").isZero();
    assertThat(path.lengthMetres()).isCloseTo(legs.get(0) + legs.get(2), within(1e-9));
    PathPoint second = path.at(legs.get(0) + legs.get(2) / 2);
    assertThat(second.leg()).isEqualTo(2);
    assertThat(second.fraction()).isCloseTo(0.5, within(1e-12));
    assertThat(second.position().altitude()).as("the leg start's altitude").isEqualTo(60.0);
    assertThat(path.at(-5).position()).isEqualTo(Position.of(a.longitude(), a.latitude(), 45.0));
    assertThat(Geodesy.direct(a, 90, 1000).altitude()).isEqualTo(45.0);
    assertThat(Geodesy.inverse(a, b).distanceMetres()).isCloseTo(legs.get(0), within(1e-9));
  }

  @Test
  void directCrossesTheAntimeridianAndThePoleAndInverseGoesBack() {
    Position from = Position.of(179.5, 10.25);
    Position east = Geodesy.direct(from, 90, 200_000);
    assertThat(east.longitude()).as("past 180 east is west").isBetween(-180.0, -178.0);
    assertThat(Geodesy.inverse(from, east).distanceMetres()).isCloseTo(200_000, within(MM));
    Position overThePole = Geodesy.direct(Position.of(30, 89.5), 0, 200_000);
    assertThat(overThePole.longitude()).as("over the pole the other side").isCloseTo(-150, within(1e-6));
    assertThat(overThePole.latitude()).isLessThan(89.5);
  }

  @Test
  void equalAndAntipodalPointsHaveAGeodesic() {
    GeodesicLeg same = Geodesy.inverse(Position.of(18.07, 59.33), Position.of(18.07, 59.33));
    assertThat(same.distanceMetres()).isZero();
    GeodesicLeg antipodal = Geodesy.inverse(Position.of(10, 20), Position.of(-170, -20));
    assertThat(antipodal.distanceMetres()).isCloseTo(20_003_931.4586, within(1.0)); // half a meridian: off the equator, antipodes are joined over a pole
  }

  @Test
  void pathPointsAreCheckedAndAPathIsSafeToShare() throws Exception {
    assertThatThrownBy(() -> new PathPoint(Position.of(1, 2), 0, -1, 0)).hasMessageContaining("leg");
    assertThatThrownBy(() -> new PathPoint(Position.of(1, 2), 0, 0, 1.5)).hasMessageContaining("fraction");
    GeodesicPath path = Geodesy.path(List.of(Position.of(116.6, 40.1), Position.of(-122.4, 37.6)));
    PathPoint expected = path.at(5_000e3);
    // The SDK only describes (no threads in it); a test may use them to check that a path is shared safely.
    var pool = java.util.concurrent.Executors.newFixedThreadPool(4);
    try {
      var results = pool.invokeAll(java.util.Collections.nCopies(64, () -> path.at(5_000e3)));
      for (var r : results) {
        assertThat(r.get()).isEqualTo(expected);
      }
    } finally {
      pool.shutdownNow();
    }
  }

  @Test
  void azimuthsAreZeroToBelow360AndBadInputIsRefused() {
    assertThat(Geodesy.azimuth(-90)).isEqualTo(270);
    assertThat(Geodesy.azimuth(360)).isEqualTo(0);
    assertThat(Geodesy.azimuth(-0.0)).isEqualTo(0.0);
    assertThat(Geodesy.inverse(Position.of(10, 0), Position.of(9, 0)).initialAzimuth()).isCloseTo(270, within(1e-9));
    assertThatThrownBy(() -> Geodesy.path(List.of(Position.of(1, 2)))).hasMessageContaining("two points");
    assertThatThrownBy(() -> Geodesy.direct(Position.of(1, 2), Double.NaN, 1)).hasMessageContaining("finite");
    assertThatThrownBy(() -> Geodesy.path(List.of(Position.of(1, 2), Position.of(3, 4))).at(Double.POSITIVE_INFINITY)).hasMessageContaining("finite");
  }
}
