package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.TWO_LEGS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The plan's inverses: the time at a leg's fraction (function 9) and at a distance (a convoy's spacing, A7). */
class RoutePlanInverseTest {

  @Test
  @DisplayName("secondsAt is the inverse of at, on steady legs, ramps up, ramps down and a ramp from 0")
  void secondsAtIsTheInverseOfAt() {
    for (String points : new String[] {
        "[{\"speed\": 100}, {\"speed\": 50}, {\"speed\": 50}]",
        "[{\"speed\": 10}, {\"speedKind\": \"ramp\", \"speed\": 300}, {\"speedKind\": \"ramp\", \"speed\": 20}]",
        "[{\"speed\": 0}, {\"speedKind\": \"ramp\", \"speed\": 200}, {\"speedKind\": \"ramp\", \"speed\": 0}]"}) {
      RoutePlan plan = Routes.plan(TWO_LEGS, "{\"points\": " + points + "}");
      assertThat(plan.problems()).as(points).isEmpty();
      for (double t = 0; t < plan.durationSeconds(); t += plan.durationSeconds() / 37) {
        RoutePlan.Motion m = plan.at(t);
        assertThat(plan.secondsAt(m.leg(), m.fraction())).as("%s at %.1f s", points, t).isCloseTo(t, within(1e-6 * plan.durationSeconds()));
        assertThat(plan.secondsAtDistance(m.distance())).isCloseTo(t, within(1e-6 * plan.durationSeconds()));
      }
    }
  }

  @Test
  void pastTheLastLegIsTheLastLeg() {
    RoutePlan plan = Routes.plan(TWO_LEGS, "{\"points\": [{\"speed\": 100}, {\"speed\": 50}, {\"speed\": 50}]}");
    assertThat(plan.secondsAt(7, 0.5)).isEqualTo(plan.secondsAt(1, 0.5));
    assertThat(plan.secondsAt(1, 1)).isEqualTo(plan.durationSeconds());
    assertThat(plan.secondsAtDistance(plan.lengthMetres() * 2)).isEqualTo(plan.durationSeconds());
    assertThat(plan.secondsAtDistance(200)).isCloseTo(2, within(1e-9));
  }
}
