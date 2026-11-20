package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.json;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.simulator.RouteDefinition.GroupKind;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Reading and checking the route's extension (brief function 4; criterion 25's limits). */
class RouteDefinitionTest {

  private static final UUID A = UUID.fromString("018f0000-0000-7000-8000-00000000000a");
  private static final UUID B = UUID.fromString("018f0000-0000-7000-8000-00000000000b");

  private static RouteDefinition.Parsed parse(String extension, int points) {
    return RouteDefinition.parse(json(extension), points);
  }

  @Test
  void readsWhatUsersTyped() {
    RouteDefinition.Parsed parsed = parse("""
        {"points": [
           {"speedKind": "instant", "speed": 8.5, "altitudeKind": "instant", "altitude": 120},
           {"speedKind": "ramp", "time": {"seconds": 600, "from": "start", "unit": "kmh"}, "altitudeKind": "ramp", "altitude": 300,
            "events": [{"kind": "hide", "objects": ["%s"]}]}],
         "groups": [{"kind": "single", "objects": [{"id": "%s"}]},
                    {"kind": "convoy", "spacing": 50, "objects": [{"id": "%s"}]}],
         "end": "restart",
         "edit": {"number": 4, "objects": "disconnect"}}
        """.formatted(A, A, B), 2);
    assertThat(parsed.problems()).isEmpty();
    RouteDefinition d = parsed.definition();
    assertThat(d).isNotNull();
    assertThat(d.points().get(1).time()).isEqualTo(new RouteDefinition.TypedTime(600, RouteDefinition.From.START, SpeedUnit.KMH));
    assertThat(d.points().get(1).events()).singleElement().satisfies(e -> assertThat(e.objects()).containsExactly(A));
    assertThat(d.groups()).extracting(RouteDefinition.Group::kind).containsExactly(GroupKind.SINGLE, GroupKind.CONVOY);
    assertThat(d.objectIds()).containsExactly(A, B);
    assertThat(d.end()).isEqualTo(RouteDefinition.End.RESTART);
    assertThat(d.edit()).isEqualTo(new RouteDefinition.EditChoice(4, RouteDefinition.Choice.DISCONNECT));
  }

  @Test
  void needsOneEntryPerPoint() {
    assertThat(parse("{\"points\": [{\"speed\": 1}, {\"speed\": 1}]}", 3).problems())
        .singleElement().extracting(Problem::message).asString().contains("3 points but values for 2");
  }

  @Test
  void aRouteWithoutTheSimulatorsValuesCannotRun() {
    RouteDefinition.Parsed parsed = RouteDefinition.parse(null, 2);
    assertThat(parsed.definition()).isNull();
    assertThat(parsed.problems()).isNotEmpty();
  }

  @Test
  @DisplayName("Criterion 25: a speed above 2 000 m/s or an altitude outside −1 000 to 30 000 m is invalid in any unit shown")
  void theOwnersLimits() {
    // The route stores m/s and metres whatever unit is shown, so the limits are checked on those.
    assertThat(parse("{\"points\": [{\"speed\": 2000, \"altitude\": -1000}, {\"speed\": 0, \"altitude\": 30000}]}", 2).problems()).isEmpty();
    assertThat(parse("{\"points\": [{\"speed\": 2000.001}, {\"speed\": 1}]}", 2).problems()).singleElement()
        .extracting(Problem::message).asString().contains("from 0 to 2000 m/s");
    assertThat(parse("{\"points\": [{\"speed\": -1}, {\"speed\": 1}]}", 2).problems()).hasSize(1);
    assertThat(parse("{\"points\": [{\"speed\": 1, \"altitude\": -1000.5}, {\"speed\": 1}]}", 2).problems()).hasSize(1);
    assertThat(parse("{\"points\": [{\"speed\": 1}, {\"speed\": 1, \"altitude\": 30000.5}]}", 2).problems()).singleElement()
        .extracting(Problem::point).isEqualTo(1);
    assertThat(parse("{\"points\": [{\"speed\": 1}, {\"time\": {\"seconds\": 604801}}]}", 2).problems()).hasSize(1);
    assertThat(parse("{\"points\": [{\"speed\": 1}, {\"time\": {\"seconds\": 604800}}]}", 2).problems()).isEmpty();
  }

  @Test
  void atMostAThousandPoints() {
    String entries = "{\"speed\": 1}," .repeat(1000);
    String thousandOne = "{\"points\": [" + entries + "{\"speed\": 1}]}";
    assertThat(parse(thousandOne, 1001).problems()).singleElement().extracting(Problem::message).asString().contains("at most 1000 points");
    assertThat(parse("{\"points\": [" + entries.substring(0, entries.length() - 1) + "]}", 1000).problems()).isEmpty();
  }

  @Test
  void eventsNameObjectsOfTheRoute() {
    String extension = """
        {"points": [{"speed": 1}, {"speed": 1, "events": [{"kind": "hide", "objects": ["%s"]}]}],
         "groups": [{"kind": "single", "objects": [{"id": "%s"}]}]}""";
    assertThat(parse(extension.formatted(A, A), 2).problems()).isEmpty();
    assertThat(parse(extension.formatted(B, A), 2).problems()).singleElement().extracting(Problem::message).asString().contains("not on the route");
  }

  @Test
  void anObjectIsOnARouteOnce() {
    String extension = """
        {"points": [{"speed": 1}, {"speed": 1}],
         "groups": [{"kind": "single", "objects": [{"id": "%s"}]}, {"kind": "single", "objects": [{"id": "%s"}]}]}""";
    assertThat(parse(extension.formatted(A, A), 2).problems()).singleElement().extracting(Problem::message).asString().contains("twice");
  }

  @Test
  void wrongTypesAndUnknownValuesAreProblemsNotFailures() {
    assertThat(parse("{\"points\": [{\"speed\": \"fast\"}, {\"speedKind\": \"jump\", \"speed\": 1}]}", 2).problems()).hasSize(2);
    assertThat(parse("{\"points\": 3}", 2).definition()).isNull();
    assertThat(parse("{\"points\": [{\"speed\": 1}, {\"speed\": 1, \"time\": {\"seconds\": 5, \"unit\": \"furlongs\"}}]}", 2).problems()).hasSize(1);
    assertThat(parse("{\"points\": [{\"speed\": 1}, {\"speed\": 1}], \"groups\": [{\"kind\": \"single\", \"objects\": [{\"id\": \"x\"}]}]}", 2).problems())
        .hasSize(1);
  }
}
