package dev.emcc.plugins.simulator;

import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.testkit.TestJson;
import java.util.List;

/** Route lines and definitions for the tests. Latitude differs from longitude everywhere. */
final class Routes {

  /** Two legs east of Stockholm, about 36 and 44 km, turning at the middle point. */
  static final List<Position> TWO_LEGS = List.of(Position.of(18.0, 59.3), Position.of(18.5, 59.5), Position.of(19.0, 59.2));

  /** One leg of about 28 km. */
  static final List<Position> ONE_LEG = List.of(Position.of(18.0, 59.3), Position.of(18.5, 59.3));

  private Routes() {}

  static JsonObject json(String text) {
    return (JsonObject) TestJson.parse(text);
  }

  /** The definition of {@code extension}, which must have no problems. */
  static RouteDefinition definition(String extension, int points) {
    RouteDefinition.Parsed parsed = RouteDefinition.parse(json(extension), points);
    if (!parsed.problems().isEmpty() || parsed.definition() == null) {
      throw new AssertionError("problems: " + parsed.problems());
    }
    return parsed.definition();
  }

  static RoutePlan plan(List<Position> line, String extension) {
    return RoutePlan.of(line, definition(extension, line.size()));
  }

  /** A point entry: an instant speed in m/s, no altitude. */
  static String speed(double metresPerSecond) {
    return "{\"speed\": " + metresPerSecond + "}";
  }
}
