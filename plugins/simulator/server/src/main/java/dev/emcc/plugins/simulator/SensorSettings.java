package dev.emcc.plugins.simulator;

import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.SensorType;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Position;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import org.jspecify.annotations.Nullable;

/**
 * A sensor's settings (brief functions 27 and 36 to 39, A10): generic physical values in SI units,
 * with limits for sensors in general, not narrowed to any output format (owner, JQ, 2026-11-07). An
 * error of 0 is no error (the owner's answer to A100, 2026-11-08). One record for both types (function
 * 36): a ground radar uses the band, the bearings, the errors, the minimum speed and the dwell
 * settings; a generic sensor its range and position error; both the revisit, the probability, the
 * cap, the mission, the outputs and the job area.
 *
 * @param type fixed when the sensor is made (A5)
 * @param revisitSeconds the ground radar's revisit interval, the generic sensor's revisit time, 1 to 600 s
 * @param minRange the near edge of the band, metres, 0 to 1 000 km, below {@code maxRange}
 * @param maxRange the far edge, metres, up to 1 000 km
 * @param startBearing degrees clockwise from the platform's heading, 0 to 360
 * @param endBearing degrees clockwise from the platform's heading, 0 to 360; below the start it wraps across north
 * @param detectionProbability 0 to 1
 * @param rangeError metres, one sigma, 0 to 10 000
 * @param crossRangeError metres, one sigma, 0 to 10 000
 * @param minimumDetectableSpeed m/s, 0 to 100
 * @param maxDetections the most detections per dwell (per report for a generic sensor), 1 to 1 024
 * @param mission CR-0034: 1 to 64 characters, or null for none
 * @param detectAll "Detect all in range" (owner, Q9); a ground radar's only (A7)
 * @param outputs the chosen sensor outputs (function 29), kept by id, missing ones too
 * @param preset function 37's preset (A4)
 * @param searchWidth a dwell's width, 1° to 360°
 * @param dwellDepth a dwell's depth, metres, 1 to 1 000 km; where used never above the band's (A3)
 * @param dwellInterval the time one dwell takes, 0.1 to 60 s
 * @param mode function 50 (T-197): Random (functions 37 and 44) or Systematic (the scan)
 * @param targetRevisitSeconds function 50: how often a found target gets a dwell of its own in Systematic, 0.5 to 60 s
 * @param range the generic sensor's range, metres, 0.1 to 1 000 km
 * @param positionError the generic sensor's position error, metres, one sigma east and north, 0 to 10 000
 * @param jobArea function 39: four corners in the order drawn, closed, or null for none
 */
record SensorSettings(
    SensorType type,
    double revisitSeconds,
    double minRange,
    double maxRange,
    double startBearing,
    double endBearing,
    double detectionProbability,
    double rangeError,
    double crossRangeError,
    double minimumDetectableSpeed,
    int maxDetections,
    @Nullable String mission,
    boolean detectAll,
    List<ChannelId> outputs,
    Preset preset,
    double searchWidth,
    double dwellDepth,
    double dwellInterval,
    Mode mode,
    double targetRevisitSeconds,
    double range,
    double positionError,
    Geometry.@Nullable Polygon jobArea) {

  static final double MAX_RANGE = 1_000_000;
  static final double MAX_ERROR = 10_000;
  static final double MAX_SPEED = 100;
  static final int MAX_MISSION = 64;
  /** CR-0031: the most relations one object carries. */
  static final int MAX_DETECTIONS = 1_024;
  static final int MAX_OUTPUTS = 100;
  /** Function 39: "A job area has four corners". */
  static final String FOUR_CORNERS = "A job area has four corners";

  /** A ground radar's Mode (function 50, T-197): Random places its dwells over the targets, Systematic scans the area in rows. */
  enum Mode {
    RANDOM("random"),
    SYSTEMATIC("systematic");

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

  /** The Target revisit a sensor starts with, and the Narrow wedge sets (function 50). */
  static final double TARGET_REVISIT = 2;

  /**
   * Function 37's presets (A4; from M8 T-191 and function 50): each sets the three dwell values and the
   * Mode, the Narrow wedge also the Target revisit; changing any of them makes it {@link #CUSTOM}.
   */
  enum Preset {
    /** M7's Narrow wedge (T-180), from M8 "Default" (T-191). */
    DEFAULT("default", 2, 20_000, 0.2, Mode.RANDOM, Double.NaN),
    /** From M8 like the AFSERS radar (T-191): 1.7° by 95 km, one every 0.1 s, Systematic. */
    NARROW("narrow", 1.7, 95_000, 0.1, Mode.SYSTEMATIC, TARGET_REVISIT),
    MEDIUM("medium", 40, 50_000, 1, Mode.RANDOM, Double.NaN),
    /** A fusion node's composite dwell: its depth is the whole band, and follows the band (A3). */
    WIDE("wide", 180, Double.NaN, 4, Mode.RANDOM, Double.NaN),
    CUSTOM("custom", Double.NaN, Double.NaN, Double.NaN, null, Double.NaN);

    final String json;
    final double searchWidth;
    final double dwellDepth;
    final double dwellInterval;
    final @Nullable Mode mode;
    /** NaN when the preset leaves the Target revisit as it is. */
    final double targetRevisitSeconds;

    Preset(String json, double searchWidth, double dwellDepth, double dwellInterval, @Nullable Mode mode, double targetRevisitSeconds) {
      this.json = json;
      this.searchWidth = searchWidth;
      this.dwellDepth = dwellDepth;
      this.dwellInterval = dwellInterval;
      this.mode = mode;
      this.targetRevisitSeconds = targetRevisitSeconds;
    }

    /** Whether {@code s}'s values are this preset's (M7-S5); the Wide wedge's depth is the band's. */
    boolean matches(SensorSettings s) {
      if (this == CUSTOM) {
        return true;
      }
      double depth = Double.isNaN(dwellDepth) ? clampDepth(s.maxRange - s.minRange) : dwellDepth;
      return s.searchWidth == searchWidth && s.dwellDepth == depth && s.dwellInterval == dwellInterval && s.mode == mode
          && (Double.isNaN(targetRevisitSeconds) || s.targetRevisitSeconds == targetRevisitSeconds);
    }

    /** The first preset whose values {@code s} has (T-191: M7's Narrow wedge values now show "Default"), else Custom. */
    static Preset of(SensorSettings s) {
      for (Preset p : values()) {
        if (p != CUSTOM && p.matches(s)) {
          return p;
        }
      }
      return CUSTOM;
    }

    static @Nullable Preset of(String json) {
      for (Preset p : values()) {
        if (p.json.equals(json)) {
          return p;
        }
      }
      return null;
    }
  }

  private static final String PRESETS = "default, narrow, medium, wide or custom";

  /**
   * A new ground radar (functions 27, 37 and, from M7, 42): looking all round (0° to 360°, T-178), the
   * Medium wedge, nothing dropped (A5: a probability of 1, no minimum speed).
   */
  static final SensorSettings GROUND_RADAR = new SensorSettings(SensorType.GROUND_RADAR, 10, 20_000, 150_000, 0, 360, 1, 20, 50, 0, 200, null, false,
      List.of(), Preset.MEDIUM, 40, 50_000, 1, Mode.RANDOM, TARGET_REVISIT, 50_000, 50, null);
  /** A new generic sensor (function 38). */
  static final SensorSettings GENERIC = new SensorSettings(SensorType.GENERIC, 10, 20_000, 150_000, 45, 135, 1, 20, 50, 0, 200, null, false,
      List.of(), Preset.MEDIUM, 40, 50_000, 1, Mode.RANDOM, TARGET_REVISIT, 50_000, 50, null);
  /**
   * An M5 sensor, saved or in a scenario file without a type (A7 of the brief; the owner's A4 here):
   * function 27's M5 defaults for what it lacks, and dwell values that keep M5's look, filled in by
   * {@link #stored}.
   */
  private static final SensorSettings M5 = new SensorSettings(SensorType.GROUND_RADAR, 10, 20_000, 150_000, 45, 135, 0.9, 20, 50, 2, 200, null, false,
      List.of(), Preset.CUSTOM, 90, 130_000, 1, Mode.RANDOM, TARGET_REVISIT, 50_000, 50, null);

  SensorSettings {
    outputs = List.copyOf(outputs);
    if (mission != null && mission.isBlank()) {
      mission = null;
    }
  }

  static SensorSettings defaults(SensorType type) {
    return type == SensorType.GENERIC ? GENERIC : GROUND_RADAR;
  }

  /** A setting outside its limits, named by its JSON member. */
  static final class Invalid extends Exception {
    final String field;

    Invalid(String field, String message) {
      super(field + ": " + message, null, false, false);
      this.field = field;
    }
  }

  /** The type {@code body} names, or {@code fallback} when it names none. */
  static SensorType type(JsonObject body, SensorType fallback) throws Invalid {
    JsonValue v = body.get("type");
    if (v == null) {
      return fallback;
    }
    if (v instanceof JsonString s) {
      for (SensorType t : SensorType.values()) {
        if (t.name().equals(s.value())) {
          return t;
        }
      }
    }
    throw new Invalid("type", "GROUND_RADAR or GENERIC");
  }

  /**
   * A sensor as the state document or a scenario file keeps it; one without a type is an M5 ground
   * radar (A7, A4). It keeps its own values, bearings included (function 42): its preset is kept
   * while its values are still that preset's, and is otherwise the first preset they are, or "Custom":
   * a Narrow wedge saved with 5° before M7 is Custom (M7-S5), one saved with M7's 2°, 20 km and 0.2 s
   * is Default (T-191). One without a Mode is Random (function 50, TT A); a stored "Empty dwells"
   * share is read and ignored (T-196, UQ A).
   */
  static SensorSettings stored(JsonObject stored) throws Invalid {
    if (stored.get("type") != null) {
      SensorSettings s = parse(stored.without("preset"), defaults(type(stored, SensorType.GROUND_RADAR)));
      if (stored.get("preset") == null) {
        return s;
      }
      Preset kept = stored.get("preset") instanceof JsonString p ? Preset.of(p.value()) : null;
      if (kept == null) {
        throw new Invalid("preset", PRESETS);
      }
      return s.withPreset(kept.matches(s) ? kept : Preset.of(s));
    }
    SensorSettings s = parse(stored, M5);
    double width = stored.get("searchWidth") == null ? Detector.span(s) : s.searchWidth;
    double depth = stored.get("dwellDepth") == null ? clampDepth(s.maxRange - s.minRange) : s.dwellDepth;
    return new SensorSettings(s.type, s.revisitSeconds, s.minRange, s.maxRange, s.startBearing, s.endBearing, s.detectionProbability, s.rangeError,
        s.crossRangeError, s.minimumDetectableSpeed, s.maxDetections, s.mission, s.detectAll, s.outputs, Preset.CUSTOM, width, depth, s.dwellInterval,
        s.mode, s.targetRevisitSeconds, s.range, s.positionError, s.jobArea);
  }

  /**
   * The settings in {@code body}; an absent member keeps {@code base}'s value. The type is {@code base}'s
   * and cannot change (A5). An "Empty dwells" share ({@code emptyShare}, removed in M8, T-196) is ignored.
   */
  static SensorSettings parse(JsonObject body, SensorSettings base) throws Invalid {
    if (type(body, base.type) != base.type) {
      throw new Invalid("type", "a sensor's type is fixed when it is made");
    }
    double revisit = number(body, "revisitSeconds", base.revisitSeconds, 1, 600);
    double min = number(body, "minRange", base.minRange, 0, MAX_RANGE);
    double max = number(body, "maxRange", base.maxRange, 0, MAX_RANGE);
    if (!(min < max)) {
      throw new Invalid("maxRange", "the max range must be above the min range");
    }
    double start = number(body, "startBearing", base.startBearing, 0, 360);
    double end = number(body, "endBearing", base.endBearing, 0, 360);
    double pd = number(body, "detectionProbability", base.detectionProbability, 0, 1);
    double rangeError = number(body, "rangeError", base.rangeError, 0, MAX_ERROR);
    double crossError = number(body, "crossRangeError", base.crossRangeError, 0, MAX_ERROR);
    double speed = number(body, "minimumDetectableSpeed", base.minimumDetectableSpeed, 0, MAX_SPEED);
    double most = number(body, "maxDetections", base.maxDetections, 1, MAX_DETECTIONS);
    if (most != Math.rint(most)) {
      throw new Invalid("maxDetections", "a whole number");
    }
    String mission = base.mission;
    JsonValue m = body.get("mission");
    if (m instanceof JsonString s) {
      mission = s.value().isBlank() ? null : s.value();
    } else if (m instanceof JsonNull) {
      mission = null;
    } else if (m != null) {
      throw new Invalid("mission", "a text");
    }
    if (mission != null && mission.length() > MAX_MISSION) {
      throw new Invalid("mission", "at most " + MAX_MISSION + " characters");
    }
    boolean detectAll = base.detectAll;
    JsonValue all = body.get("detectAll");
    if (all instanceof JsonBoolean b) {
      detectAll = b.value();
    } else if (all != null) {
      throw new Invalid("detectAll", "true or false");
    }
    List<ChannelId> outputs = outputs(body, base.outputs);

    double width = number(body, "searchWidth", base.searchWidth, 1, 360);
    double depth = number(body, "dwellDepth", base.dwellDepth, 1_000, MAX_RANGE);
    double interval = number(body, "dwellInterval", base.dwellInterval, 0.1, 60);
    Mode mode = base.mode;
    JsonValue md = body.get("mode");
    if (md != null) {
      mode = md instanceof JsonString s ? Mode.of(s.value()) : null;
      if (mode == null) {
        throw new Invalid("mode", "random or systematic");
      }
    }
    double targetRevisit = number(body, "targetRevisitSeconds", base.targetRevisitSeconds, 0.5, 60);
    Preset preset = base.preset;
    JsonValue p = body.get("preset");
    if (p != null) {
      preset = p instanceof JsonString s ? Preset.of(s.value()) : null;
      if (preset == null) {
        throw new Invalid("preset", PRESETS);
      }
      if (preset != Preset.CUSTOM) {
        width = preset.searchWidth;
        depth = Double.isNaN(preset.dwellDepth) ? base.dwellDepth : preset.dwellDepth;
        interval = preset.dwellInterval;
        mode = preset.mode;
        if (!Double.isNaN(preset.targetRevisitSeconds)) {
          targetRevisit = preset.targetRevisitSeconds;
        }
      }
    } else if (width != base.searchWidth || depth != base.dwellDepth || interval != base.dwellInterval || mode != base.mode
        || (!Double.isNaN(base.preset.targetRevisitSeconds) && targetRevisit != base.targetRevisitSeconds)) {
      preset = Preset.CUSTOM; // changing one of its values makes it "Custom" (A4; function 50: the Mode too)
    }
    if (preset == Preset.WIDE) {
      depth = clampDepth(max - min); // the whole band, also after the band changes (A3)
    }
    double range = number(body, "range", base.range, 100, MAX_RANGE);
    double positionError = number(body, "positionError", base.positionError, 0, MAX_ERROR);
    Geometry.Polygon jobArea = base.jobArea;
    if (body.get("jobArea") != null) {
      jobArea = jobArea(body.get("jobArea"));
    }
    return new SensorSettings(base.type, revisit, min, max, start, end, pd, rangeError, crossError, speed, (int) most, mission, detectAll, outputs,
        preset, width, depth, interval, mode, targetRevisit, range, positionError, jobArea);
  }

  private static double clampDepth(double band) {
    return Math.max(1_000, Math.min(MAX_RANGE, band));
  }

  private static List<ChannelId> outputs(JsonObject body, List<ChannelId> base) throws Invalid {
    JsonValue list = body.get("outputs");
    if (list == null) {
      return base;
    }
    if (!(list instanceof JsonArray a)) {
      throw new Invalid("outputs", "a list of channel ids");
    }
    if (a.size() > MAX_OUTPUTS) {
      throw new Invalid("outputs", "at most " + MAX_OUTPUTS);
    }
    var ids = new LinkedHashSet<ChannelId>();
    for (JsonValue v : a.values()) {
      try {
        if (!ids.add(ChannelId.parse(v instanceof JsonString s ? s.value() : ""))) {
          throw new Invalid("outputs", "a channel is named twice: " + v);
        }
      } catch (IllegalArgumentException e) {
        throw new Invalid("outputs", "not a channel id: " + v);
      }
    }
    return List.copyOf(ids);
  }

  /**
   * Function 39: {@code null} for none, or a GeoJSON {@code Polygon} of one ring with four corners,
   * closed (five positions, the last the first), in WGS84 longitude, latitude order.
   */
  static Geometry.@Nullable Polygon jobArea(JsonValue value) throws Invalid {
    if (value instanceof JsonNull) {
      return null;
    }
    if (!(value instanceof JsonObject o) || !(o.get("type") instanceof JsonString t) || !t.value().equals("Polygon")
        || !(o.get("coordinates") instanceof JsonArray rings)) {
      throw new Invalid("jobArea", "a GeoJSON Polygon or null");
    }
    if (rings.size() != 1 || !(rings.values().getFirst() instanceof JsonArray ring)) {
      throw new Invalid("jobArea", FOUR_CORNERS);
    }
    List<Position> positions = new ArrayList<>();
    for (JsonValue v : ring.values()) {
      if (!(v instanceof JsonArray xy) || xy.size() < 2 || !(xy.values().get(0) instanceof JsonNumber lon) || !(xy.values().get(1) instanceof JsonNumber lat)) {
        throw new Invalid("jobArea", "a position is [longitude, latitude]");
      }
      try {
        positions.add(Position.of(lon.doubleValue(), lat.doubleValue()));
      } catch (IllegalArgumentException e) {
        throw new Invalid("jobArea", "a position outside WGS84: " + v);
      }
    }
    if (positions.size() != 5 || !same(positions.getFirst(), positions.getLast())) {
      throw new Invalid("jobArea", FOUR_CORNERS);
    }
    return new Geometry.Polygon(List.of(positions));
  }

  private static boolean same(Position a, Position b) {
    return a.longitude() == b.longitude() && a.latitude() == b.latitude();
  }

  /** As stored and served; {@link #parse} reads it back. */
  JsonObject json() {
    List<JsonValue> ids = new ArrayList<>();
    outputs.forEach(id -> ids.add(JsonString.of(id.toString())));
    return JsonObject.builder()
        .put("type", JsonString.of(type.name()))
        .put("revisitSeconds", JsonNumber.of(revisitSeconds))
        .put("minRange", JsonNumber.of(minRange))
        .put("maxRange", JsonNumber.of(maxRange))
        .put("startBearing", JsonNumber.of(startBearing))
        .put("endBearing", JsonNumber.of(endBearing))
        .put("detectionProbability", JsonNumber.of(detectionProbability))
        .put("rangeError", JsonNumber.of(rangeError))
        .put("crossRangeError", JsonNumber.of(crossRangeError))
        .put("minimumDetectableSpeed", JsonNumber.of(minimumDetectableSpeed))
        .put("maxDetections", JsonNumber.of(maxDetections))
        .put("mission", mission == null ? JsonNull.INSTANCE : JsonString.of(mission))
        .put("detectAll", JsonBoolean.of(detectAll))
        .put("outputs", new JsonArray(ids))
        .put("preset", JsonString.of(preset.json))
        .put("searchWidth", JsonNumber.of(searchWidth))
        .put("dwellDepth", JsonNumber.of(dwellDepth))
        .put("dwellInterval", JsonNumber.of(dwellInterval))
        .put("mode", JsonString.of(mode.json))
        .put("targetRevisitSeconds", JsonNumber.of(targetRevisitSeconds))
        .put("range", JsonNumber.of(range))
        .put("positionError", JsonNumber.of(positionError))
        .put("jobArea", jobArea == null ? JsonNull.INSTANCE : polygon(jobArea))
        .build();
  }

  static JsonObject polygon(Geometry.Polygon polygon) {
    List<JsonValue> ring = new ArrayList<>();
    for (Position p : polygon.rings().getFirst()) {
      ring.add(JsonArray.of(JsonNumber.of(p.longitude()), JsonNumber.of(p.latitude())));
    }
    return JsonObject.builder().put("type", JsonString.of("Polygon")).put("coordinates", JsonArray.of(new JsonArray(ring))).build();
  }

  SensorSettings withOutputs(List<ChannelId> ids) {
    return new SensorSettings(type, revisitSeconds, minRange, maxRange, startBearing, endBearing, detectionProbability, rangeError, crossRangeError,
        minimumDetectableSpeed, maxDetections, mission, detectAll, ids, preset, searchWidth, dwellDepth, dwellInterval, mode, targetRevisitSeconds, range,
        positionError,
        jobArea);
  }

  SensorSettings withPreset(Preset p) {
    return new SensorSettings(type, revisitSeconds, minRange, maxRange, startBearing, endBearing, detectionProbability, rangeError, crossRangeError,
        minimumDetectableSpeed, maxDetections, mission, detectAll, outputs, p, searchWidth, dwellDepth, dwellInterval, mode, targetRevisitSeconds, range,
        positionError,
        jobArea);
  }

  /** The fallback name of a sensor whose platform has none (function 36). */
  String unnamed() {
    return type == SensorType.GENERIC ? "Generic sensor" : "Ground radar";
  }

  private static double number(JsonObject body, String name, double base, double min, double max) throws Invalid {
    JsonValue v = body.get(name);
    if (v == null) {
      return base;
    }
    if (!(v instanceof JsonNumber n) || !Double.isFinite(n.doubleValue())) {
      throw new Invalid(name, "a number");
    }
    double value = n.doubleValue();
    if (value < min - 1e-9 || value > max + 1e-9) {
      throw new Invalid(name, "from " + format(min) + " to " + format(max));
    }
    return Math.max(min, Math.min(max, value));
  }

  private static String format(double value) {
    return value == Math.rint(value) ? Long.toString((long) value) : String.format(Locale.ROOT, "%s", value);
  }
}
