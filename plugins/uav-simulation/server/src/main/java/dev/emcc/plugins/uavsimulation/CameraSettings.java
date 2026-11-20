package dev.emcc.plugins.uavsimulation;

import dev.emcc.plugins.uavsimulation.pose.Frame;
import dev.emcc.plugins.uavsimulation.pose.Pointing;
import dev.emcc.plugins.uavsimulation.pose.Pose;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Position;
import java.util.Locale;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * A camera's settings (brief section 5), with their limits. The values of every mode are kept, so a
 * user who switches modes and back finds the earlier values, as a settings form does; only the chosen
 * mode's are used. Read from a request body or a stored document by {@link #parse}, which refuses a
 * value outside its limits with the field's name; written by {@link #json}.
 *
 * @param mode the pointing mode
 * @param point Track a point: the point (longitude, latitude), or {@code null} before one is set
 * @param pointHeight Track a point, and Track an object when the target has no altitude: metres HAE
 * @param target Track an object: the target object's id, or {@code null} before one is chosen
 * @param azimuth Fixed angles: relative to the heading, 0 to below 360
 * @param depression Fixed angles and Sweep: positive down
 * @param sectorStart Sweep: the sector's start, 0 to below 360
 * @param sectorEnd Sweep: the sector's end, 0 to below 360, not the start
 * @param sweepRate Sweep: degrees a second
 * @param horizontalFov degrees
 * @param frame the frame's size and rate
 * @param height the camera's height where the platform has no altitude, metres HAE
 * @param mission the Mission, empty for none
 * @param output the output channel the poses go to (brief function 9; C1), or {@code null} for none:
 *     kept by its id, also while it is missing
 */
record CameraSettings(
    Mode mode,
    @Nullable Position point,
    double pointHeight,
    @Nullable UUID target,
    double azimuth,
    double depression,
    double sectorStart,
    double sectorEnd,
    double sweepRate,
    double horizontalFov,
    Frame frame,
    double height,
    String mission,
    @Nullable ChannelId output) {

  /** The pointing modes, by their JSON names. */
  enum Mode {
    TRACK_POINT("trackPoint"),
    TRACK_OBJECT("trackObject"),
    FIXED("fixed"),
    SWEEP("sweep");

    final String json;

    Mode(String json) {
      this.json = json;
    }

    static @Nullable Mode of(String json) {
      for (Mode m : values()) {
        if (m.json.equals(json)) {
          return m;
        }
      }
      return null;
    }
  }

  static final double MIN_POINT_HEIGHT = -1_000;
  static final double MAX_POINT_HEIGHT = 10_000;
  static final double MIN_SWEEP_RATE = 0.5;
  static final double MAX_SWEEP_RATE = 90;
  static final double MIN_FOV = 0.1;
  static final double MAX_FOV = 120;
  static final double MIN_HEIGHT = 10;
  static final double MAX_HEIGHT = 20_000;
  static final int MAX_MISSION = 64;

  /** Brief section 5's defaults: Fixed angles, ahead and 30° down, 20°, 1280 × 720 at 25, 1 000 m. */
  static final CameraSettings DEFAULTS = new CameraSettings(Mode.FIXED, null, 0, null, 0, 30, 315, 45, 10, 20, Frame.DEFAULT, 1_000, "", null);

  /** A value outside its limits, or of the wrong type: the field's name and what it must be. */
  static final class Invalid extends Exception {
    final String field;

    Invalid(String field, String message) {
      super(message, null, false, false);
      this.field = field;
    }
  }

  /** The settings as the pose needs them, or {@code null} when the chosen mode lacks a value (B4). */
  Pose.@Nullable Setup setup() {
    Pointing pointing = switch (mode) {
      case TRACK_POINT -> point == null ? null : new Pointing.TrackPoint(point.longitude(), point.latitude(), pointHeight);
      case TRACK_OBJECT -> target == null ? null : new Pointing.TrackObject(pointHeight);
      case FIXED -> new Pointing.FixedAngles(azimuth, depression);
      case SWEEP -> new Pointing.Sweep(sectorStart, sectorEnd, sweepRate, depression);
    };
    return pointing == null ? null : new Pose.Setup(pointing, horizontalFov, frame, height, mission);
  }

  /**
   * Brief section 5: Track a point's point defaults to the platform's position when the mode is
   * chosen. These settings with {@code at} as the point when Track a point has none, else as they are.
   */
  CameraSettings withDefaultPoint(Position at) {
    if (mode != Mode.TRACK_POINT || point != null) {
      return this;
    }
    return new CameraSettings(mode, Position.of(at.longitude(), at.latitude()), pointHeight, target, azimuth, depression, sectorStart, sectorEnd,
        sweepRate, horizontalFov, frame, height, mission, output);
  }

  /** What the chosen mode still needs before the camera can start, or {@code null} when nothing (B4). */
  @Nullable Invalid missing() {
    if (mode == Mode.TRACK_POINT && point == null) {
      return new Invalid("point", "Track a point needs a point");
    }
    if (mode == Mode.TRACK_OBJECT && target == null) {
      return new Invalid("target", "Track an object needs a target");
    }
    return null;
  }

  /**
   * {@code base} with the values {@code body} names. A field that is absent keeps its value; {@code
   * null} clears the point, the target and the Mission.
   *
   * @throws Invalid naming the first field outside its limits
   */
  static CameraSettings parse(JsonObject body, CameraSettings base) throws Invalid {
    Mode mode = base.mode;
    JsonValue m = body.get("mode");
    if (m != null) {
      mode = m instanceof JsonString s ? Mode.of(s.value()) : null;
      if (mode == null) {
        throw new Invalid("mode", "one of trackPoint, trackObject, fixed, sweep");
      }
    }
    Position point = point(body.get("point"), base.point);
    double pointHeight = number(body, "pointHeight", base.pointHeight, MIN_POINT_HEIGHT, MAX_POINT_HEIGHT, "−1 000 to 10 000 m");
    UUID target = base.target;
    JsonValue t = body.get("target");
    if (t instanceof JsonNull) {
      target = null;
    } else if (t != null) {
      target = t instanceof JsonString s ? uuid(s.value()) : null;
      if (target == null) {
        throw new Invalid("target", "an object's id");
      }
    }
    double azimuth = azimuth(body, "azimuth", base.azimuth);
    double depression = number(body, "depression", base.depression, -90, 90, "−90° to 90°");
    double sectorStart = azimuth(body, "sectorStart", base.sectorStart);
    double sectorEnd = azimuth(body, "sectorEnd", base.sectorEnd);
    if (sectorStart == sectorEnd) {
      throw new Invalid(body.has("sectorEnd") || !body.has("sectorStart") ? "sectorEnd" : "sectorStart", "the sector's start and end must differ");
    }
    double sweepRate = number(body, "sweepRate", base.sweepRate, MIN_SWEEP_RATE, MAX_SWEEP_RATE, "0.5 to 90°/s");
    double horizontalFov = number(body, "horizontalFov", base.horizontalFov, MIN_FOV, MAX_FOV, "0.1° to 120°");
    Frame frame = frame(body, base.frame);
    double height = number(body, "height", base.height, MIN_HEIGHT, MAX_HEIGHT, "10 to 20 000 m");
    String mission = base.mission;
    JsonValue mi = body.get("mission");
    if (mi instanceof JsonNull) {
      mission = "";
    } else if (mi instanceof JsonString s) {
      mission = s.value().isBlank() ? "" : s.value();
    } else if (mi != null) {
      throw new Invalid("mission", "a text");
    }
    if (mission.codePointCount(0, mission.length()) > MAX_MISSION) {
      throw new Invalid("mission", "at most 64 characters");
    }
    ChannelId output = output(body.get("output"), base.output);
    return new CameraSettings(mode, point, pointHeight, target, azimuth, depression, sectorStart, sectorEnd, sweepRate, horizontalFov, frame, height, mission,
        output);
  }

  /** The settings as JSON, the shape {@link #parse} reads. */
  JsonObject json() {
    var b = JsonObject.builder()
        .put("mode", JsonString.of(mode.json))
        .put("point", point == null ? JsonNull.INSTANCE : JsonArray.of(JsonNumber.of(point.longitude()), JsonNumber.of(point.latitude())))
        .put("pointHeight", JsonNumber.of(pointHeight))
        .put("target", target == null ? JsonNull.INSTANCE : JsonString.of(target.toString()))
        .put("azimuth", JsonNumber.of(azimuth))
        .put("depression", JsonNumber.of(depression))
        .put("sectorStart", JsonNumber.of(sectorStart))
        .put("sectorEnd", JsonNumber.of(sectorEnd))
        .put("sweepRate", JsonNumber.of(sweepRate))
        .put("horizontalFov", JsonNumber.of(horizontalFov))
        .put("frameSize", JsonString.of(frame.width() + "x" + frame.height()))
        .put("frameRate", JsonNumber.of(frame.rate()))
        .put("height", JsonNumber.of(height))
        .put("mission", JsonString.of(mission))
        .put("output", output == null ? JsonNull.INSTANCE : JsonString.of(output.toString()));
    return b.build();
  }

  private static double number(JsonObject body, String field, double base, double min, double max, String limits) throws Invalid {
    JsonValue v = body.get(field);
    if (v == null) {
      return base;
    }
    if (!(v instanceof JsonNumber n) || !Double.isFinite(n.doubleValue()) || n.doubleValue() < min || n.doubleValue() > max) {
      throw new Invalid(field, limits);
    }
    return n.doubleValue() + 0.0;
  }

  /** An azimuth, 0 to 360, with 360 taken as 0. */
  private static double azimuth(JsonObject body, String field, double base) throws Invalid {
    double a = number(body, field, base, 0, 360, "0° to 360°");
    return a == 360 ? 0 : a;
  }

  private static @Nullable Position point(@Nullable JsonValue v, @Nullable Position base) throws Invalid {
    if (v == null) {
      return base;
    }
    if (v instanceof JsonNull) {
      return null;
    }
    if (v instanceof JsonArray a && a.size() == 2 && a.get(0) instanceof JsonNumber lon && a.get(1) instanceof JsonNumber lat
        && lon.doubleValue() >= -180 && lon.doubleValue() <= 180 && lat.doubleValue() >= -90 && lat.doubleValue() <= 90) {
      return Position.of(lon.doubleValue() + 0.0, lat.doubleValue() + 0.0);
    }
    throw new Invalid("point", "[longitude, latitude]: longitude −180 to 180, latitude −90 to 90");
  }

  /** C1: an output channel's id, {@code plugin/link}; {@code null} clears it. Whether it is on offer is the worker's check. */
  private static @Nullable ChannelId output(@Nullable JsonValue v, @Nullable ChannelId base) throws Invalid {
    if (v == null) {
      return base;
    }
    if (v instanceof JsonNull) {
      return null;
    }
    if (v instanceof JsonString s) {
      try {
        return ChannelId.parse(s.value());
      } catch (IllegalArgumentException e) {
        // refused below
      }
    }
    throw new Invalid("output", "an output's id, plugin/link");
  }

  private static Frame frame(JsonObject body, Frame base) throws Invalid {
    int width = base.width();
    int height = base.height();
    JsonValue size = body.get("frameSize");
    if (size != null) {
      String s = size instanceof JsonString str ? str.value().toLowerCase(Locale.ROOT) : "";
      switch (s) {
        case "640x360" -> {
          width = 640;
          height = 360;
        }
        case "1280x720" -> {
          width = 1280;
          height = 720;
        }
        case "1920x1080" -> {
          width = 1920;
          height = 1080;
        }
        default -> throw new Invalid("frameSize", "640x360, 1280x720 or 1920x1080");
      }
    }
    int rate = base.rate();
    JsonValue r = body.get("frameRate");
    if (r != null) {
      if (!(r instanceof JsonNumber n) || n.doubleValue() != Math.rint(n.doubleValue()) || n.doubleValue() < Frame.MIN_RATE || n.doubleValue() > Frame.MAX_RATE) {
        throw new Invalid("frameRate", "a whole number, 1 to 30 frames a second");
      }
      rate = (int) n.doubleValue();
    }
    return new Frame(width, height, rate);
  }

  static @Nullable UUID uuid(String s) {
    try {
      UUID id = UUID.fromString(s);
      return id.toString().equals(s.toLowerCase(Locale.ROOT)) ? id : null;
    } catch (IllegalArgumentException e) {
      return null;
    }
  }
}
