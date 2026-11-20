package dev.emcc.plugins.uavsimulation.pose;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.sdk.geo.GeodesicLeg;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Position;
import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The platform between its updates (brief function 5, U4). */
class FixTest {

  private static final Instant T0 = Instant.parse("2026-11-16T12:00:00Z");
  private static final Position AT = Position.of(17.3, 62.4, 500.0);

  private static Instant after(long millis) {
    return T0.plusMillis(millis);
  }

  @Test
  @DisplayName("Criterion 11: at 50 m/s east, 25 m after 0.5 s, 75 m after 1.5 s, still 75 m after 3 s (held)")
  void extrapolatesThenHolds() {
    Fix fix = new Fix(AT, 90.0, 50.0, T0);
    assertMoved(fix.at(after(500)), 25, false);
    assertMoved(fix.at(after(1500)), 75, false);
    assertMoved(fix.at(after(3000)), 75, true);
    assertMoved(fix.at(after(1501)), 75, true);
  }

  private static void assertMoved(Fix.Extrapolated e, double metres, boolean held) {
    GeodesicLeg leg = Geodesy.inverse(AT, e.position());
    assertThat(leg.distanceMetres()).isCloseTo(metres, within(0.1));
    assertThat(leg.initialAzimuth()).isCloseTo(90, within(0.01));
    assertThat(e.position().altitude()).as("the height is held").isEqualTo(500.0);
    assertThat(e.held()).isEqualTo(held);
  }

  @Test
  @DisplayName("Criterion 11: a new update replaces the extrapolation at once")
  void newUpdateReplacesAtOnce() {
    Fix first = new Fix(AT, 90.0, 50.0, T0);
    Position reported = Position.of(17.301, 62.4001, 520.0);
    Fix next = new Fix(reported, 95.0, 50.0, after(1000));
    assertThat(first.at(after(1000)).position()).isNotEqualTo(reported);
    assertThat(next.at(after(1000)).position()).isEqualTo(reported);
    assertThat(next.at(after(1000)).held()).isFalse();
  }

  @Test
  @DisplayName("Criterion 11: speed 0 or absent: no movement, and nothing counted as held")
  void stillPlatforms() {
    for (Fix fix : new Fix[] {new Fix(AT, 90.0, 0.0, T0), new Fix(AT, 90.0, null, T0), new Fix(AT, null, null, T0)}) {
      assertThat(fix.at(after(800))).isEqualTo(new Fix.Extrapolated(AT, false));
      assertThat(fix.at(after(5000))).isEqualTo(new Fix.Extrapolated(AT, false));
    }
  }

  @Test
  @DisplayName("Without a direction the heading is 0, and a moving platform goes north")
  void noDirectionIsNorth() {
    Fix fix = new Fix(AT, null, 10.0, T0);
    assertThat(fix.heading()).isZero();
    Position p = fix.at(after(1000)).position();
    assertThat(Geodesy.inverse(AT, p).initialAzimuth()).isCloseTo(0, within(0.01));
    assertThat(p.latitude()).isGreaterThan(AT.latitude());
  }

  @Test
  @DisplayName("A frame time before the update gives the update's position")
  void timeBeforeTheUpdate() {
    assertThat(new Fix(AT, 90.0, 50.0, T0).at(T0.minusMillis(40))).isEqualTo(new Fix.Extrapolated(AT, false));
  }

  @Test
  @DisplayName("Across the antimeridian the longitude wraps (no split, ADR-0019)")
  void acrossTheAntimeridian() {
    Fix fix = new Fix(Position.of(179.9999, -16.5, 300.0), 90.0, 50.0, T0);
    Position p = fix.at(after(1500)).position();
    assertThat(p.longitude()).isLessThan(-179.99);
    assertThat(Geodesy.inverse(fix.position(), p).distanceMetres()).isCloseTo(75, within(0.1));
  }
}
