package dev.emcc.sdk.channel;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.worker.Coalescing;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.2.0: what a sender sends to an output channel (ADR-0037 point 4). The key is the object's
 * id: ECore's inbox per channel keeps only the latest item per object, so a removal replaces a
 * pending update. An offering plugin may post the items on to its connection task's inbox with
 * {@code Overflow.coalesceByKey()}, which keeps the same rule.
 *
 * <p>SDK 1.4.0 (ADR-0048 point 4; CR-0030 part 1): each item is of one {@link ChannelKind}, and a
 * channel gets only the kinds it takes ({@link ChannelSpec#kinds()}). {@link Update} and {@link
 * Removal} are ground truth; {@link SensorReport}, keyed by its sensor, is a sensor report. A
 * receiver that switches over the items adds a case for {@code SensorReport}, or a {@code default},
 * even if its channels
 * take ground truth only.
 */
public sealed interface ChannelItem extends Message, Coalescing {

  /**
   * The object's id; for a {@link SensorReport}, its sensor's id. The inbox keeps the latest item
   * per {@link #coalesceKey()}, which is this id, except for a sensor report with a sequence (SDK
   * 1.5.0, CR-0040): its sensor and dwell number.
   */
  UUID id();

  /** SDK 1.4.0: the kind of data this item is; ground truth unless it is a {@link SensorReport}. */
  default ChannelKind kind() {
    return ChannelKind.GROUND_TRUTH;
  }

  @Override
  default Object coalesceKey() {
    return id();
  }

  /**
   * An object's content with its id. A channel carries data that need not be on the map, so there
   * is no stored version or meta. The content's {@code dataSource} tells the channel where it came
   * from, so that an output never sends an object back to its own link (ADR-0037 point 3).
   *
   * @param id the object's id
   * @param content its content
   */
  record Update(UUID id, MapObjectContent content) implements ChannelItem {
    public Update {
      Objects.requireNonNull(id, "id");
      Objects.requireNonNull(content, "content");
    }
  }

  /**
   * The object is gone. A channel that can send a delete ({@link ChannelCapability#DELETE}) sends
   * one; any other stops sending the object.
   *
   * @param id the object's id
   */
  record Removal(UUID id) implements ChannelItem {
    public Removal {
      Objects.requireNonNull(id, "id");
    }
  }

  /**
   * SDK 1.4.0: one sensor's report at one time (ADR-0048 points 4 to 7): the sensor's platform, the
   * time, the area it looked at and what it detected there. The inbox keeps the latest report per
   * sensor, so a slow output loses whole reports, never part of one (ADR-0037 point 6). Named
   * {@code Dwell} until the owner's rename of 2026-11-07, before the 1.4.0 freeze: the record is
   * generic, and "dwell" is STANAG 4607's word.
   *
   * <p>How outputs map it: {@code gmti} sends it as a 4607 dwell with its target reports; {@code cot},
   * {@code ais} and {@code adsb} send each detection as an ordinary position of the detected object.
   *
   * @param sensorId the sensor's id, the key: one per simulated sensor, stable while it exists
   * @param platform where the sensor's platform was at the report's time, longitude first
   * @param time when the sensor looked
   * @param area the area the sensor looked at: a Polygon, Circle, Ellipse or ArcBand
   * @param detections what it detected, at most {@link #MAX_DETECTIONS}; empty when it saw nothing
   * @param sensor CR-0033: what the sensor says of itself, or {@code null} when the sender says
   *     nothing (a sender built before CR-0033); a receiver then sends "no statement"
   * @param sequence SDK 1.5.0 (CR-0040): where this report stands in its sensor's revisits, one report
   *     being one dwell, or {@code null} for one report per revisit, as in 1.4.0 (a receiver then
   *     treats it as dwell 0 and the last of its revisit, and numbers the revisits itself). With a
   *     sequence the inbox keeps the latest report per sensor <b>and dwell number</b> ({@link
   *     #coalesceKey()}), so a revisit's dwells never replace each other
   */
  record SensorReport(UUID sensorId, Position platform, Instant time, Geometry area, List<Detection> detections, @Nullable Sensor sensor,
      @Nullable Sequence sequence) implements ChannelItem {

    /** The most detections in one report: what one STANAG 4607 dwell segment can count. */
    public static final int MAX_DETECTIONS = 65_535;

    /** A report without the sensor's description (CR-0033 point 2: senders built before it still compile). */
    public SensorReport(UUID sensorId, Position platform, Instant time, Geometry area, List<Detection> detections) {
      this(sensorId, platform, time, area, detections, null, null);
    }

    /** The SDK 1.4.0 report, without a sequence (CR-0040: kept, so the change is compatible). */
    public SensorReport(UUID sensorId, Position platform, Instant time, Geometry area, List<Detection> detections, @Nullable Sensor sensor) {
      this(sensorId, platform, time, area, detections, sensor, null);
    }

    /** SDK 1.5.0 (CR-0040): this report with {@code sequence}, or none for {@code null}. */
    public SensorReport withSequence(@Nullable Sequence sequence) {
      return new SensorReport(sensorId, platform, time, area, detections, sensor, sequence);
    }

    public SensorReport {
      Objects.requireNonNull(sensorId, "sensorId");
      Objects.requireNonNull(platform, "platform");
      Objects.requireNonNull(time, "time");
      Objects.requireNonNull(area, "area");
      if (!(area instanceof Geometry.Polygon || area instanceof Geometry.Circle || area instanceof Geometry.Ellipse || area instanceof Geometry.ArcBand)) {
        throw new IllegalArgumentException("a sensor report's area is a Polygon, Circle, Ellipse or ArcBand: " + area.getClass().getSimpleName());
      }
      detections = List.copyOf(detections);
      if (detections.size() > MAX_DETECTIONS) {
        throw new IllegalArgumentException("at most " + MAX_DETECTIONS + " detections in one sensor report: " + detections.size());
      }
    }

    @Override
    public UUID id() {
      return sensorId;
    }

    @Override
    public ChannelKind kind() {
      return ChannelKind.SENSOR_REPORTS;
    }

    /**
     * SDK 1.5.0 (CR-0040 point 2): the sensor's id, and with a {@link #sequence()} also the dwell
     * number, so the inbox keeps the latest report per sensor and dwell number.
     */
    @Override
    public Object coalesceKey() {
      return sequence == null ? sensorId : new DwellKey(sensorId, sequence.dwell());
    }

    private record DwellKey(UUID sensorId, int dwell) {}

    /**
     * SDK 1.5.0 (CR-0040 point 1; T-169): where a report stands in its sensor's revisits, when one
     * report is one dwell and a revisit has several, as the simulator's ground radar sends them.
     * {@code gmti} out sends it as STANAG 4607's {@code D2}, {@code D3} and {@code D4}.
     *
     * @param revisit the revisit's number, 0 or more, counted by the sensor from its start and
     *     growing by one per revisit
     * @param dwell the dwell's number within its revisit, 0 to {@link #MAX_DWELLS_PER_REVISIT},
     *     in the order sent
     * @param lastOfRevisit true on the revisit's last dwell only
     */
    public record Sequence(long revisit, int dwell, boolean lastOfRevisit) {
      /** The highest dwell number in one revisit (CR-0040): what STANAG 4607's {@code D3} holds. */
      public static final int MAX_DWELLS_PER_REVISIT = 65_535;

      public Sequence {
        if (revisit < 0) {
          throw new IllegalArgumentException("a revisit's number is 0 or more: " + revisit);
        }
        if (dwell < 0 || dwell > MAX_DWELLS_PER_REVISIT) {
          throw new IllegalArgumentException("a dwell's number is 0 to " + MAX_DWELLS_PER_REVISIT + ": " + dwell);
        }
      }
    }
  }

  /**
   * CR-0033: what a sensor says of itself in a {@link SensorReport}: its name and how it was set. A
   * receiver takes what its format needs, and an absent value ({@code null}) is "no statement".
   *
   * <p><b>Generic</b> (owner, JQ, 2026-11-07): the values are physical, in SI units, with ranges
   * for sensors in general, not narrowed to one output format such as STANAG 4607. Each output
   * maps them to its own format; a receiver whose field cannot hold one sends "no statement" for
   * it, never a clamped value, and counts it (its brief says how).
   *
   * @param name the sensor's name: its platform track's name, else a name the sender gives; 1 to
   *     {@link #MAX_NAME} characters, not blank
   * @param mission CR-0034: the mission the sensor's platform flies, e.g. an ATO mission number; 1 to
   *     {@link #MAX_MISSION} characters, any letters, or {@code null} for none (a blank text is kept
   *     as {@code null}). Generic like the other values (JQ): each output fits it to its format
   * @param revisit the time between the sensor's looks at its area, positive
   * @param rangeError metres, one sigma, along the line of sight; finite and not negative
   * @param crossRangeError metres, one sigma, across the line of sight; finite and not negative
   * @param minimumDetectableSpeed the slowest radial speed it detects, m/s; finite and not negative
   * @param detectionProbability the probability that it detects a target in its area, 0 to 1
   * @param platformDirection the platform's direction at the report's time, degrees clockwise from
   *     true north, at least 0 and below 360
   * @param platformSpeed the platform's speed at the report's time, m/s; finite and not negative
   * @param type SDK 1.5.0 (CR-0039 point 7, CR-0040 point 3): what type of sensor it is, or {@code
   *     null} for no statement, which counts as {@link SensorType#GENERIC} when a sender chooses
   *     channels ({@link ChannelInfo#takesSensorType}); {@code gmti} out still sends a report without
   *     a type (CR-0040 point 5)
   * @param jobArea SDK 1.5.0 (CR-0039 point 7; T-168): the area the sensor is tasked to cover, a
   *     {@code Polygon} without holes, or {@code null} for no statement; {@code gmti} out sends it as
   *     the job's bounding area (STANAG 4607 {@code J6} to {@code J13}), others may ignore it
   */
  record Sensor(
      String name,
      @Nullable String mission,
      @Nullable Duration revisit,
      @Nullable Double rangeError,
      @Nullable Double crossRangeError,
      @Nullable Double minimumDetectableSpeed,
      @Nullable Double detectionProbability,
      @Nullable Double platformDirection,
      @Nullable Double platformSpeed,
      @Nullable SensorType type,
      Geometry.@Nullable Polygon jobArea) {

    /** The longest name, in characters. */
    public static final int MAX_NAME = 64;

    /** CR-0034: the longest mission, in characters. */
    public static final int MAX_MISSION = 64;

    public Sensor {
      Objects.requireNonNull(name, "name");
      if (name.isBlank() || name.length() > MAX_NAME) {
        throw new IllegalArgumentException("a sensor's name has 1 to " + MAX_NAME + " characters and is not blank: \"" + name + "\"");
      }
      if (mission != null && mission.isBlank()) {
        mission = null;
      }
      if (mission != null && mission.length() > MAX_MISSION) {
        throw new IllegalArgumentException("a sensor's mission has 1 to " + MAX_MISSION + " characters: " + mission.length());
      }
      if (revisit != null && (revisit.isNegative() || revisit.isZero())) {
        throw new IllegalArgumentException("revisit is positive: " + revisit);
      }
      notNegative("rangeError", rangeError);
      notNegative("crossRangeError", crossRangeError);
      notNegative("minimumDetectableSpeed", minimumDetectableSpeed);
      notNegative("platformSpeed", platformSpeed);
      if (detectionProbability != null && !(detectionProbability >= 0 && detectionProbability <= 1)) {
        throw new IllegalArgumentException("detectionProbability is 0 to 1: " + detectionProbability);
      }
      if (platformDirection != null && !(platformDirection >= 0 && platformDirection < 360)) {
        throw new IllegalArgumentException("platformDirection is at least 0 and below 360: " + platformDirection);
      }
      if (jobArea != null && jobArea.rings().size() != 1) {
        throw new IllegalArgumentException("a job area is a Polygon without holes: " + jobArea.rings().size() + " rings");
      }
    }

    /** The SDK 1.4.0 sensor (CR-0034), without a type or a job area (CR-0039: kept, so the change is compatible). */
    public Sensor(
        String name,
        @Nullable String mission,
        @Nullable Duration revisit,
        @Nullable Double rangeError,
        @Nullable Double crossRangeError,
        @Nullable Double minimumDetectableSpeed,
        @Nullable Double detectionProbability,
        @Nullable Double platformDirection,
        @Nullable Double platformSpeed) {
      this(name, mission, revisit, rangeError, crossRangeError, minimumDetectableSpeed, detectionProbability, platformDirection, platformSpeed, null, null);
    }

    /** CR-0033's sensor, without a mission (CR-0034: kept, so the change is compatible). */
    public Sensor(
        String name,
        @Nullable Duration revisit,
        @Nullable Double rangeError,
        @Nullable Double crossRangeError,
        @Nullable Double minimumDetectableSpeed,
        @Nullable Double detectionProbability,
        @Nullable Double platformDirection,
        @Nullable Double platformSpeed) {
      this(name, null, revisit, rangeError, crossRangeError, minimumDetectableSpeed, detectionProbability, platformDirection, platformSpeed);
    }

    /** A sensor that says only its name. */
    public static Sensor named(String name) {
      return new Sensor(name, null, null, null, null, null, null, null, null);
    }

    /** CR-0034: this sensor with {@code mission}, or none for {@code null} or a blank text. */
    public Sensor withMission(@Nullable String mission) {
      return new Sensor(name, mission, revisit, rangeError, crossRangeError, minimumDetectableSpeed, detectionProbability, platformDirection, platformSpeed, type, jobArea);
    }

    /** SDK 1.5.0 (CR-0039 point 7): this sensor with {@code type}, or no statement for {@code null}. */
    public Sensor withType(@Nullable SensorType type) {
      return new Sensor(name, mission, revisit, rangeError, crossRangeError, minimumDetectableSpeed, detectionProbability, platformDirection, platformSpeed, type, jobArea);
    }

    /** SDK 1.5.0 (CR-0039 point 7): this sensor with {@code jobArea}, or none for {@code null}. */
    public Sensor withJobArea(Geometry.@Nullable Polygon jobArea) {
      return new Sensor(name, mission, revisit, rangeError, crossRangeError, minimumDetectableSpeed, detectionProbability, platformDirection, platformSpeed, type, jobArea);
    }

    private static void notNegative(String what, @Nullable Double value) {
      if (value != null && !(Double.isFinite(value) && value >= 0)) {
        throw new IllegalArgumentException(what + " is finite and not negative: " + value);
      }
    }
  }

  /**
   * SDK 1.4.0: one thing a sensor detected in a {@link SensorReport} (owner, 2026-11-05, Q7): the detected
   * object's id and content, with the measured position as the content's geometry, the sensor's
   * errors in it.
   *
   * @param objectId the detected object's id
   * @param content its content as the sensor reports it: a {@code Point} geometry at the measured position
   */
  record Detection(UUID objectId, MapObjectContent content) {
    public Detection {
      Objects.requireNonNull(objectId, "objectId");
      Objects.requireNonNull(content, "content");
      if (!(content.geometry() instanceof Geometry.Point)) {
        throw new IllegalArgumentException("a detection is at a point, the measured position");
      }
    }
  }
}
