package dev.emcc.plugins.fmv.out;

import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import org.jspecify.annotations.Nullable;

/**
 * Reads the payload of an {@code fmv.camera-pose} item (brief section 10.1) into a {@link Pose}.
 * ECore has checked it against the kind's schema at {@code send} (PQ2 A); this reads it again
 * without trusting that, and a payload it cannot read is refused with the reason.
 */
public final class PoseJson {

  /** The kind's id. */
  public static final String KIND = "fmv.camera-pose";

  private PoseJson() {}

  /**
   * The pose of a payload.
   *
   * @throws IllegalArgumentException with the first thing wrong in it
   */
  public static Pose read(JsonObject payload) {
    JsonObject platform = object(payload, "platform");
    JsonObject pointing = object(payload, "pointing");
    JsonObject fov = object(payload, "fieldOfView");
    JsonObject frame = object(payload, "frame");
    if (!(platform.get("position") instanceof JsonArray position) || position.size() != 3) {
      throw new IllegalArgumentException("platform.position is [longitude, latitude, height]");
    }
    Instant time;
    try {
      time = Instant.parse(text(payload, "time"));
    } catch (DateTimeParseException e) {
      throw new IllegalArgumentException("time is not ISO 8601 UTC: " + e.getParsedString());
    }
    return new Pose(
        text(payload, "camera"),
        time,
        new Pose.Platform(element(position, 0), element(position, 1), element(position, 2), number(platform, "heading"), number(platform, "pitch"),
            number(platform, "roll"), optionalText(platform, "name")),
        new Pose.Pointing(number(pointing, "azimuth"), number(pointing, "depression"), number(pointing, "roll")),
        number(fov, "horizontal"),
        number(fov, "vertical"),
        whole(frame, "width"),
        whole(frame, "height"),
        whole(frame, "rate"),
        optionalText(payload, "mission"));
  }

  private static JsonObject object(JsonObject o, String key) {
    if (o.get(key) instanceof JsonObject v) {
      return v;
    }
    throw new IllegalArgumentException(key + " is missing");
  }

  private static String text(JsonObject o, String key) {
    if (o.get(key) instanceof JsonString s) {
      return s.value();
    }
    throw new IllegalArgumentException(key + " is missing");
  }

  private static @Nullable String optionalText(JsonObject o, String key) {
    return o.get(key) instanceof JsonString s ? s.value() : null;
  }

  private static double number(JsonObject o, String key) {
    if (o.get(key) instanceof JsonNumber n && Double.isFinite(n.doubleValue())) {
      return n.doubleValue();
    }
    throw new IllegalArgumentException(key + " is not a number");
  }

  private static double element(JsonArray a, int i) {
    JsonValue v = a.get(i);
    if (v instanceof JsonNumber n && Double.isFinite(n.doubleValue())) {
      return n.doubleValue();
    }
    throw new IllegalArgumentException("platform.position holds numbers");
  }

  private static int whole(JsonObject o, String key) {
    double v = number(o, key);
    if (v != Math.rint(v) || Math.abs(v) > 100_000) {
      throw new IllegalArgumentException(key + " is a whole number");
    }
    return (int) v;
  }
}
