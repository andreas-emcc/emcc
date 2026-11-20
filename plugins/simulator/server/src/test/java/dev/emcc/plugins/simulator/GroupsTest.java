package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.ONE_LEG;
import static dev.emcc.plugins.simulator.Routes.TWO_LEGS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.sdk.geo.GeodesicLeg;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Position;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Convoys and formations on a route (brief functions 11 and 12; criteria 8 and 9). */
class GroupsTest {

  private static final String STEADY = "{\"points\": [{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]}";

  private final Rig rig = new Rig();

  private static double metres(Position a, Position b) {
    return Geodesy.inverse(a, b).distanceMetres();
  }

  private double speed(UUID track) {
    return rig.object(track).content().symbol().modifiers().speed();
  }

  @Test
  @DisplayName("Criterion 8: a convoy leaves one by one at the spacing, in list order (A7)")
  void aConvoyLeavesOneByOne() {
    UUID a = rig.symbol(Position.of(17.0, 58.0));
    UUID b = rig.symbol(Position.of(17.1, 58.0));
    UUID c = rig.symbol(Position.of(17.2, 58.0));
    UUID route = rig.route(TWO_LEGS, STEADY);
    rig.started();
    rig.putOnRoute(route, "convoy", ", \"spacing\": 200", b, a, c);
    // They wait at the first point, in list order b, a, c.
    for (UUID t : List.of(a, b, c)) {
      assertThat(metres(rig.position(t), TWO_LEGS.getFirst())).isLessThan(0.01);
    }
    rig.control(route, "start");
    GeodesicLeg first = Geodesy.inverse(TWO_LEGS.get(0), TWO_LEGS.get(1));
    for (int t = 1; t <= 10; t++) {
      rig.seconds(1);
      // The one ahead is 200 m away after 2 s: each leaves 2 s after the one ahead.
      double[] along = {100.0 * t, 100.0 * (t - 2), 100.0 * (t - 4)};
      UUID[] order = {b, a, c};
      for (int i = 0; i < 3; i++) {
        double d = Math.max(0, along[i]);
        Position expected = Geodesy.direct(TWO_LEGS.get(0), first.initialAzimuth(), d);
        assertThat(metres(rig.position(order[i]), expected)).as("member %d at t=%d", i, t).isLessThan(1);
        assertThat(speed(order[i])).as("member %d's speed at t=%d", i, t).isEqualTo(along[i] >= 0 ? 100 : 0);
      }
    }
  }

  @Test
  @DisplayName("Criterion 8: with \"stop\", every member of a convoy stops at the last point")
  void aConvoyStopsAtTheLastPoint() {
    UUID a = rig.symbol(ONE_LEG.getFirst());
    UUID b = rig.symbol(ONE_LEG.getFirst());
    UUID route = rig.route(ONE_LEG, "{\"points\": [{\"speed\": 1000}, {\"speed\": 1000}]}");
    rig.started();
    rig.putOnRoute(route, "convoy", ", \"spacing\": 2000", a, b);
    rig.control(route, "start");
    rig.seconds(29);
    assertThat(metres(rig.position(a), ONE_LEG.get(1))).isLessThan(0.01);
    assertThat(metres(rig.position(b), ONE_LEG.get(1))).isGreaterThan(1000);
    rig.seconds(3);
    assertThat(metres(rig.position(b), ONE_LEG.get(1))).isLessThan(0.01);
    assertThat(speed(a)).isZero();
    assertThat(speed(b)).isZero();
    assertThat(rig.get("/routes/" + route).reply().body().toUtf8()).contains("\"state\":\"ended\"");
  }

  @Test
  @DisplayName("A7: a convoy longer than its route: each leaves when the one ahead has arrived")
  void aSpacingLongerThanTheRoute() {
    UUID a = rig.symbol(ONE_LEG.getFirst());
    UUID b = rig.symbol(ONE_LEG.getFirst());
    UUID route = rig.route(ONE_LEG, "{\"points\": [{\"speed\": 1000}, {\"speed\": 1000}]}");
    rig.started();
    rig.putOnRoute(route, "convoy", ", \"spacing\": 90000", a, b);
    rig.control(route, "start");
    rig.seconds(29);
    assertThat(metres(rig.position(a), ONE_LEG.get(1))).isLessThan(0.01);
    assertThat(metres(rig.position(b), ONE_LEG.getFirst())).isLessThan(1000);
    assertThat(speed(b)).isEqualTo(1000);
  }

  @Test
  @DisplayName("Criterion 9: a formation keeps its shape, with offsets from the first leg, and turns with the direction of travel")
  void aFormationKeepsItsShapeAndTurns() {
    // Placed east of each other, the route's first leg runs north-east: offsets are relative to it.
    UUID left = rig.symbol(Position.of(17.000, 58.000, 100.0));
    UUID middle = rig.symbol(Position.of(17.002, 58.001, 200.0));
    UUID right = rig.symbol(Position.of(17.004, 58.000, 300.0));
    UUID route = rig.route(TWO_LEGS, STEADY);
    rig.started();
    Position centre = Formation.centre(List.of(Position.of(17.000, 58.000), Position.of(17.002, 58.001), Position.of(17.004, 58.000)));
    rig.putOnRoute(route, "formation", "", left, middle, right);

    // At the start, each is as far from the first point as it was from the centre, in the same place
    // relative to the first leg, which it was assigned along; the route's altitude is empty, so each
    // keeps the centre's altitude (the mean, 200) plus its offset (A11).
    for (UUID t : List.of(left, middle, right)) {
      Position before = switch (t == left ? 0 : t == middle ? 1 : 2) {
        case 0 -> Position.of(17.000, 58.000);
        case 1 -> Position.of(17.002, 58.001);
        default -> Position.of(17.004, 58.000);
      };
      GeodesicLeg was = Geodesy.inverse(centre, before);
      GeodesicLeg is = Geodesy.inverse(TWO_LEGS.getFirst(), rig.position(t));
      assertThat(is.distanceMetres()).isCloseTo(was.distanceMetres(), within(0.1));
      double turn = ((is.initialAzimuth() - was.initialAzimuth()) % 360 + 540) % 360 - 180;
      assertThat(turn).isCloseTo(0, within(0.1));
    }
    assertThat(List.of(rig.position(left).altitude(), rig.position(middle).altitude(), rig.position(right).altitude()))
        .containsExactly(100.0, 200.0, 300.0);
    double[] distances = {metres(centre, Position.of(17.000, 58.000)), metres(centre, Position.of(17.002, 58.001)), metres(centre, Position.of(17.004, 58.000))};

    rig.control(route, "start");
    RoutePlan plan = Routes.plan(TWO_LEGS, STEADY);
    double secondLeg = plan.arrivalSeconds(1) + 60;
    rig.seconds((int) Math.ceil(secondLeg));
    double at = Math.ceil(secondLeg);
    RoutePlan.Motion c = plan.at(at);
    assertThat(c.leg()).isEqualTo(1);
    UUID[] all = {left, middle, right};
    for (int i = 0; i < 3; i++) {
      Position p = rig.position(all[i]);
      assertThat(metres(c.position(), p)).as("member %d's distance from the centre", i).isCloseTo(distances[i], within(0.5));
      assertThat(rig.object(all[i]).content().symbol().modifiers().direction()).isCloseTo(c.azimuth(), within(0.001));
    }
    // The shape turned: the right one is still to the right of the direction of travel.
    double bearing = Geodesy.inverse(c.position(), rig.position(right)).initialAzimuth();
    double relative = ((bearing - c.azimuth()) % 360 + 360) % 360;
    assertThat(relative).isBetween(0.0, 180.0);
  }

  @Test
  @DisplayName("A11: a formation on a route with altitudes keeps its altitude offsets")
  void aFormationKeepsItsAltitudeOffsets() {
    UUID low = rig.symbol(Position.of(17.000, 58.000, 100.0));
    UUID high = rig.symbol(Position.of(17.001, 58.000, 300.0));
    UUID route = rig.route(ONE_LEG, "{\"points\": [{\"speed\": 100, \"altitude\": 1000}, {\"speed\": 100}]}");
    rig.started();
    rig.putOnRoute(route, "formation", "", low, high);
    assertThat(rig.position(low).altitude()).isEqualTo(900.0);
    assertThat(rig.position(high).altitude()).isEqualTo(1100.0);
    assertThat(rig.extension(route).toString()).contains("altitude=200");
  }

  @Test
  void aFormationsCentreIsTheMeanAcrossTheAntimeridian() {
    Position centre = Formation.centre(List.of(Position.of(179.9, 10.0), Position.of(-179.9, 10.2)));
    assertThat(Math.abs(centre.longitude())).isCloseTo(180, within(0.001));
    assertThat(centre.latitude()).isCloseTo(10.1, within(0.001));
  }
}
