package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.ONE_LEG;
import static dev.emcc.plugins.simulator.Routes.TWO_LEGS;
import static dev.emcc.plugins.simulator.Routes.plan;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.simulator.RoutePlan.Motion;
import dev.emcc.sdk.geo.GeodesicLeg;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Position;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** The kinematics of a route (brief functions 5 and 6; criteria 3, 4 and 5). */
class RoutePlanTest {

  private static double metresBetween(Position a, Position b) {
    return Geodesy.inverse(a, b).distanceMetres();
  }

  @Nested
  @DisplayName("Criterion 3: movement along the geodesics, latitude ≠ longitude")
  class Movement {

    private final RoutePlan plan = plan(TWO_LEGS, "{\"points\": [{\"speed\": 100}, {\"speed\": 50}, {\"speed\": 50}]}");
    private final GeodesicLeg first = Geodesy.inverse(TWO_LEGS.get(0), TWO_LEGS.get(1));
    private final GeodesicLeg second = Geodesy.inverse(TWO_LEGS.get(1), TWO_LEGS.get(2));

    @Test
    void eachTickIsWithinOneMetreOfTheSdksGeodesic() {
      assertThat(plan.problems()).isEmpty();
      double firstLegTime = first.distanceMetres() / 100;
      for (int t = 0; t < firstLegTime; t += 1) {
        Position expected = Geodesy.direct(TWO_LEGS.get(0), first.initialAzimuth(), 100.0 * t);
        Motion m = plan.at(t);
        assertThat(metresBetween(m.position(), expected)).as("t=%d", t).isLessThan(1);
        assertThat(m.speed()).isEqualTo(100);
        assertThat(m.leg()).isZero();
      }
      for (int t = (int) Math.ceil(firstLegTime); t < plan.durationSeconds(); t += 1) {
        Position expected = Geodesy.direct(TWO_LEGS.get(1), second.initialAzimuth(), 50.0 * (t - firstLegTime));
        Motion m = plan.at(t);
        assertThat(metresBetween(m.position(), expected)).as("t=%d", t).isLessThan(1);
        assertThat(m.speed()).isEqualTo(50);
        assertThat(m.leg()).isOne();
      }
    }

    @Test
    void turnsSharplyAtThePointAndTheDirectionFollowsTheLeg() {
      double atPoint = first.distanceMetres() / 100;
      Motion before = plan.at(atPoint - 0.01);
      Motion after = plan.at(atPoint + 0.01);
      assertThat(before.azimuth()).isCloseTo(first.finalAzimuth(), within(0.01));
      assertThat(after.azimuth()).isCloseTo(second.initialAzimuth(), within(0.01));
      assertThat(Math.abs(after.azimuth() - before.azimuth())).isGreaterThan(30);
      assertThat(plan.at(1).azimuth()).isCloseTo(first.initialAzimuth(), within(0.01));
    }

    @Test
    void stopsAtTheLastPoint() {
      Motion end = plan.at(plan.durationSeconds() + 5);
      assertThat(end.ended()).isTrue();
      assertThat(end.speed()).isZero();
      assertThat(metresBetween(end.position(), TWO_LEGS.get(2))).isLessThan(0.01);
      assertThat(plan.durationSeconds()).isCloseTo(first.distanceMetres() / 100 + second.distanceMetres() / 50, within(1e-6));
    }

    @Test
    void servesLengthsTimesAndSpeedsPerPoint() {
      assertThat(plan.legMetres(0)).isZero();
      assertThat(plan.legMetres(1)).isCloseTo(first.distanceMetres(), within(1e-6));
      assertThat(plan.distanceMetres(2)).isCloseTo(first.distanceMetres() + second.distanceMetres(), within(1e-6));
      assertThat(plan.arrivalSeconds(1)).isCloseTo(first.distanceMetres() / 100, within(1e-9));
      assertThat(plan.speed(1)).isEqualTo(50);
    }
  }

  @Nested
  @DisplayName("Criterion 4: ramps")
  class Ramps {

    @Test
    void aSpeedRampHasAConstantAcceleration() {
      RoutePlan plan = plan(ONE_LEG, "{\"points\": [{\"speed\": 10}, {\"speedKind\": \"ramp\", \"speed\": 30}]}");
      double length = plan.lengthMetres();
      double duration = 2 * length / (10 + 30);
      assertThat(plan.durationSeconds()).isCloseTo(duration, within(1e-9));
      double acceleration = 20 / duration;
      for (double t : new double[] {0, 100, 500, duration / 2, duration - 1}) {
        Motion m = plan.at(t);
        assertThat(m.speed()).as("speed at %s", t).isCloseTo(10 + acceleration * t, within(1e-9));
        assertThat(m.distance()).as("distance at %s", t).isCloseTo(10 * t + acceleration * t * t / 2, within(1e-6));
      }
    }

    @Test
    void anAltitudeRampClimbsInProportionToTheDistance() {
      RoutePlan plan = plan(TWO_LEGS, "{\"points\": [{\"speed\": 100, \"altitude\": 1000}, "
          + "{\"speedKind\": \"ramp\", \"speed\": 200, \"altitudeKind\": \"ramp\", \"altitude\": 3000}, {\"speed\": 200, \"altitude\": 500}]}");
      for (double t = 0; t < plan.arrivalSeconds(1); t += 7) {
        Motion m = plan.at(t);
        assertThat(m.altitude()).as("t=%s", t).isCloseTo(1000 + 2000 * m.distance() / plan.legMetres(1), within(1e-6));
      }
      // An instant altitude is a step at its point.
      assertThat(plan.at(plan.arrivalSeconds(1) + 1).altitude()).isEqualTo(3000);
      assertThat(plan.at(plan.durationSeconds() + 1).altitude()).isEqualTo(500);
    }

    @Test
    void anInstantAltitudeIsAStepAtItsPoint() {
      RoutePlan plan = plan(TWO_LEGS, "{\"points\": [{\"speed\": 100, \"altitude\": 1000}, {\"speed\": 100, \"altitude\": 2000}, {\"speed\": 100}]}");
      assertThat(plan.at(plan.arrivalSeconds(1) - 0.5).altitude()).isEqualTo(1000);
      assertThat(plan.at(plan.arrivalSeconds(1) + 0.5).altitude()).isEqualTo(2000);
    }

    @Test
    void aRampOnTheFirstPointActsAsInstant() {
      RoutePlan ramp = plan(ONE_LEG, "{\"points\": [{\"speedKind\": \"ramp\", \"speed\": 40, \"altitudeKind\": \"ramp\", \"altitude\": 700}, {\"speed\": 40}]}");
      assertThat(ramp.problems()).isEmpty();
      assertThat(ramp.at(0).speed()).isEqualTo(40);
      assertThat(ramp.at(0).altitude()).isEqualTo(700);
      assertThat(ramp.durationSeconds()).isCloseTo(ramp.lengthMetres() / 40, within(1e-9));
    }

    @Test
    void anEmptyAltitudeKeepsTheObjectsOwn() {
      RoutePlan plan = plan(TWO_LEGS, "{\"points\": [{\"speed\": 100, \"altitude\": 800}, {\"speed\": 100}, {\"speed\": 100}]}");
      assertThat(plan.at(10).altitude()).isEqualTo(800);
      assertThat(plan.at(plan.arrivalSeconds(1) + 1).altitude()).as("null: keep the object's own").isNull();
    }
  }

  @Nested
  @DisplayName("Criterion 5: the time helper")
  class TimeHelper {

    @Test
    void aTimeAtARampPointGivesItsSpeedRoundedInTheUsersUnit() {
      // Mean speed 2L/(10 + v) = L/t, so v = 2L/t - 10, rounded to whole km/h.
      RoutePlan plan = plan(ONE_LEG, "{\"points\": [{\"speed\": 10}, {\"speedKind\": \"ramp\", \"time\": {\"seconds\": 1000, \"unit\": \"kmh\"}}]}");
      double exact = 2 * plan.lengthMetres() / 1000 - 10;
      double kmh = Math.round(exact * 3.6);
      assertThat(plan.problems()).isEmpty();
      assertThat(plan.speed(1)).isCloseTo(kmh / 3.6, within(1e-9));
      assertThat(plan.speedSource(1)).isEqualTo(RoutePlan.SpeedSource.OWN_TIME);
      assertThat(plan.speed(1)).isNotEqualTo(exact);
    }

    @Test
    void aTimeAtAnInstantPointSetsTheSpeedOfTheLegIntoIt() {
      // Owner's Q2: the time at point 2 sets point 1's speed, rounded to whole knots.
      RoutePlan plan = plan(TWO_LEGS, "{\"points\": [{\"speed\": 100}, {\"speed\": 70}, {\"speed\": 5, \"time\": {\"seconds\": 600, \"unit\": \"kn\"}}]}");
      double exact = plan.legMetres(2) / 600;
      assertThat(plan.problems()).isEmpty();
      assertThat(plan.speed(1)).isCloseTo(Math.round(exact / (1852.0 / 3600)) * (1852.0 / 3600), within(1e-9));
      assertThat(plan.speedSource(1)).isEqualTo(RoutePlan.SpeedSource.NEXT_TIME);
      assertThat(plan.speed(2)).as("its own speed holds from the point on").isEqualTo(5);
      assertThat(plan.arrivalSeconds(2) - plan.arrivalSeconds(1)).isCloseTo(600, within(5.0));
    }

    @Test
    void aLastStepPointNeedsNoSpeedOfItsOwn() {
      // The route stops at its last point, so a time there, which sets the leg's speed, is enough.
      RoutePlan plan = plan(ONE_LEG, "{\"points\": [{\"speed\": 10}, {\"time\": {\"seconds\": 500, \"unit\": \"mps\"}}]}");
      assertThat(plan.problems()).isEmpty();
      assertThat(plan.speed(0)).isEqualTo(Math.round(plan.lengthMetres() / 500));
      assertThat(plan.speed(1)).isNaN();
      assertThat(plan(TWO_LEGS, "{\"points\": [{\"speed\": 10}, {\"time\": {\"seconds\": 500}}, {\"speed\": 10}]}").problems())
          .as("a point between still needs its own speed").extracting(Problem::point).containsExactly(1);
    }

    @Test
    void aTimeFromTheRoutesStartCountsFromTheFirstPoint() {
      RoutePlan plan = plan(TWO_LEGS, "{\"points\": [{\"speed\": 100}, {\"speed\": 70}, {\"speed\": 5, \"time\": {\"seconds\": 900, \"from\": \"start\", \"unit\": \"mps\"}}]}");
      double first = plan.legMetres(1) / 100;
      assertThat(plan.speed(1)).isEqualTo(Math.round(plan.legMetres(2) / (900 - first)));
    }

    @Test
    void aTimeFromTheStartAfterARampPointSolvesBothLegs() {
      RoutePlan plan = plan(TWO_LEGS, "{\"points\": [{\"speed\": 20}, {\"speedKind\": \"ramp\", \"speed\": 999}, "
          + "{\"speed\": 5, \"time\": {\"seconds\": 1500, \"from\": \"start\", \"unit\": \"mps\"}}]}");
      assertThat(plan.problems()).isEmpty();
      double v = plan.speed(1);
      double total = 2 * plan.legMetres(1) / (20 + v) + plan.legMetres(2) / v;
      assertThat(total).as("whole m/s rounding moves it a little").isCloseTo(1500, within(30.0));
      double exact = RoutePlan.solveRampThenSteady(1500, 20, plan.legMetres(1), plan.legMetres(2));
      assertThat(2 * plan.legMetres(1) / (20 + exact) + plan.legMetres(2) / exact).isCloseTo(1500, within(1e-6));
    }

    @Test
    void movingAPointKeepsTheTypedTimeAndRecomputesTheSpeed() {
      String values = "{\"points\": [{\"speed\": 10}, {\"speedKind\": \"ramp\", \"time\": {\"seconds\": 1000, \"unit\": \"mps\"}}]}";
      RoutePlan before = plan(ONE_LEG, values);
      RoutePlan after = plan(java.util.List.of(ONE_LEG.get(0), Position.of(18.7, 59.4)), values);
      assertThat(after.speed(1)).isNotEqualTo(before.speed(1));
      assertThat(after.speed(1)).isEqualTo(Math.round(2 * after.lengthMetres() / 1000 - 10));
    }

    @Test
    void aTimeARampCannotReachIsReported() {
      // 28 km from 50 m/s: a ramp reaches the point within 2L/50 ≈ 1 140 s at most.
      RoutePlan plan = plan(ONE_LEG, "{\"points\": [{\"speed\": 50}, {\"speedKind\": \"ramp\", \"time\": {\"seconds\": 3000}}]}");
      assertThat(plan.problems()).singleElement().satisfies(p -> {
        assertThat(p.point()).isOne();
        assertThat(p.message()).contains("cannot be reached");
      });
    }

    @Test
    void aTimeNotAfterThePreviousPointIsReported() {
      RoutePlan plan = plan(TWO_LEGS, "{\"points\": [{\"speed\": 10}, {\"speed\": 10}, {\"speed\": 10, \"time\": {\"seconds\": 100, \"from\": \"start\"}}]}");
      assertThat(plan.problems()).singleElement().extracting(Problem::message).asString().contains("must be later than");
    }

    @Test
    void twoTimesForOneSpeedAreReported() {
      RoutePlan plan = plan(TWO_LEGS, "{\"points\": [{\"speed\": 10}, {\"speedKind\": \"ramp\", \"time\": {\"seconds\": 2000}}, "
          + "{\"speed\": 10, \"time\": {\"seconds\": 900}}]}");
      assertThat(plan.problems()).singleElement().satisfies(p -> {
        assertThat(p.point()).isEqualTo(2);
        assertThat(p.message()).contains("already sets");
      });
    }

    @Test
    void theFirstPointHasNoTime() {
      RoutePlan plan = plan(ONE_LEG, "{\"points\": [{\"speed\": 10, \"time\": {\"seconds\": 5}}, {\"speed\": 10}]}");
      assertThat(plan.problems()).extracting(Problem::point).containsExactly(0);
    }
  }

  @Nested
  @DisplayName("Open question 13: speed 0, and ramps next to an empty altitude")
  class SpeedZero {

    @Test
    void aRampMayStartFromAndEndAtZero() {
      RoutePlan plan = plan(TWO_LEGS, "{\"points\": [{\"speed\": 0}, {\"speedKind\": \"ramp\", \"speed\": 50}, {\"speedKind\": \"ramp\", \"speed\": 0}]}");
      assertThat(plan.problems()).isEmpty();
      assertThat(plan.at(0).speed()).isZero();
      assertThat(plan.at(plan.durationSeconds() - 0.001).speed()).isCloseTo(0, within(0.01));
    }

    @Test
    void aStepToZeroIsAllowedOnlyAtTheLastPoint() {
      assertThat(plan(TWO_LEGS, "{\"points\": [{\"speed\": 10}, {\"speed\": 10}, {\"speed\": 0}]}").problems()).isEmpty();
      assertThat(plan(TWO_LEGS, "{\"points\": [{\"speed\": 10}, {\"speed\": 0}, {\"speedKind\": \"ramp\", \"speed\": 10}]}").problems())
          .singleElement().extracting(Problem::point).isEqualTo(1);
    }

    @Test
    void everyLegNeedsAMeanSpeedAboveZero() {
      assertThat(plan(ONE_LEG, "{\"points\": [{\"speed\": 0}, {\"speed\": 10}]}").problems())
          .singleElement().extracting(Problem::message).asString().contains("mean speed of 0");
    }

    @Test
    void anAltitudeRampNeedsAltitudesAtBothEnds() {
      assertThat(plan(ONE_LEG, "{\"points\": [{\"speed\": 10}, {\"speed\": 10, \"altitudeKind\": \"ramp\", \"altitude\": 100}]}").problems())
          .singleElement().extracting(Problem::message).asString().contains("altitudes at both ends");
    }
  }
}
