package dev.emcc.sdk.channel;

import dev.emcc.sdk.model.FieldRef;
import java.util.EnumSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.2.0: what a plugin offers as an output channel, one per output link (ADR-0037 point 4).
 * Immutable; the methods return a new spec. ECore adds the plugin's id to make the {@link
 * ChannelId}.
 *
 * <pre>{@code
 * ChannelSpec.of("tak-north", "TAK North (out)", "cot")
 *     .can(ChannelCapability.DELETE)
 *     .fields(List.of(new FieldRef("cot", "callsign")))
 *     .kinds(Set.of(ChannelKind.GROUND_TRUTH, ChannelKind.SENSOR_REPORTS))   // SDK 1.4.0
 *     .fieldSet("cot.unit")                                                  // SDK 1.4.0
 *     .maxAreaDepth(511_980)                           // SDK 1.4.0, CR-0035: after the kinds
 *     .sensorTypes(Set.of(SensorType.GROUND_RADAR))    // SDK 1.5.0, CR-0039: after the kinds
 *
 * // SDK 1.9.0 (CR-0048 point 4): a channel that takes a kind its plugin declares, and nothing else
 * ChannelSpec.of("uav-north", "UAV North (out)", "stanag-4609")
 *     .declaredKinds(Set.of("fmv.camera-pose"))
 *     .kinds(Set.of())
 * }</pre>
 *
 * @param link the link's name: lowercase words separated by hyphens, at most 64 characters, unique
 *     among the plugin's channels
 * @param name the display name, 1 to 128 characters
 * @param outputType what the channel sends, e.g. {@code cot}; later {@code adatp-36}, {@code ais}:
 *     lowercase words separated by hyphens, at most 64 characters
 * @param capabilities what it can do besides updates; empty by default
 * @param fields the declared fields its protocol uses (ADR-0038), so that a sender can offer them;
 *     empty by default. <b>Deprecated from SDK 1.4.0</b> in favour of {@code fieldSet} (ADR-0050
 *     point 7); kept, and still listed to senders
 * @param kinds SDK 1.4.0: the kinds of data it takes (ADR-0048 point 4), at least one; ground truth
 *     only by default, which is what every 1.3.0 channel takes
 * @param fieldSet SDK 1.4.0: the full id of the field set its protocol uses (ADR-0050 point 7),
 *     e.g. {@code cot.unit}, or {@code null}; a sender such as the simulator offers that set and
 *     adds it to the objects it sends out
 * @param maxAreaDepth SDK 1.4.0 (CR-0035; owner, KM): how deep beyond the near edge of a sensor report's
 *     area the channel carries detections, in metres, finite and positive, or {@code null} (the
 *     default) for no limit. Only on a channel that takes {@link ChannelKind#SENSOR_REPORTS}: set the
 *     kinds first. See {@link #maxAreaDepth(double)}
 * @param sensorTypes SDK 1.5.0 (CR-0039 point 7; T-169): the sensor types whose reports the channel
 *     takes; empty (the default) takes every type. Only on a channel that takes {@link
 *     ChannelKind#SENSOR_REPORTS}: set the kinds first. {@code gmti} takes {@link
 *     SensorType#GROUND_RADAR} only; a sender offers a sensor only the channels that take its type
 * @param declaredKinds SDK 1.9.0 (CR-0048 point 4): the ids of the channel kinds it takes that its
 *     own plugin declares in its manifest's {@code channelKinds}, each {@code <plugin-id>.<name>};
 *     empty by default, at most {@link #MAX_DECLARED_KINDS}. ECore refuses an offer that names a kind
 *     its plugin does not declare. A channel takes at least one kind of either sort: with declared
 *     kinds, {@code kinds} may be empty
 */
public record ChannelSpec(String link, String name, String outputType, Set<ChannelCapability> capabilities, List<FieldRef> fields, Set<ChannelKind> kinds,
    @Nullable String fieldSet, @Nullable Double maxAreaDepth, Set<SensorType> sensorTypes, Set<String> declaredKinds) {

  /** SDK 1.9.0: the most declared kinds one channel takes (as many as a plugin may declare). */
  public static final int MAX_DECLARED_KINDS = 16;

  private static final Pattern TYPE = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");
  private static final Pattern SET_ID = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*\\.[a-z][a-z0-9]*(-[a-z0-9]+)*");

  public ChannelSpec {
    Objects.requireNonNull(link, "link");
    Objects.requireNonNull(name, "name");
    Objects.requireNonNull(outputType, "outputType");
    ChannelId.checkLink(link);
    if (name.isBlank() || name.length() > 128) {
      throw new IllegalArgumentException("a channel's name must be 1..128 characters");
    }
    if (!TYPE.matcher(outputType).matches() || outputType.length() > 64) {
      throw new IllegalArgumentException("an output type is lowercase words separated by hyphens: " + outputType);
    }
    capabilities = capabilities.isEmpty() ? Set.of() : Set.copyOf(EnumSet.copyOf(capabilities));
    fields = List.copyOf(fields);
    if (Set.copyOf(fields).size() != fields.size()) {
      throw new IllegalArgumentException("a field is listed twice: " + fields);
    }
    Objects.requireNonNull(kinds, "kinds");
    Objects.requireNonNull(declaredKinds, "declaredKinds");
    declaredKinds = Set.copyOf(declaredKinds);
    if (declaredKinds.size() > MAX_DECLARED_KINDS) {
      throw new IllegalArgumentException("a channel takes at most " + MAX_DECLARED_KINDS + " declared kinds: " + declaredKinds.size());
    }
    for (String kind : declaredKinds) {
      DeclaredItem.checkKind(kind);
    }
    if (kinds.isEmpty() && declaredKinds.isEmpty()) {
      throw new IllegalArgumentException("a channel takes at least one kind of data");
    }
    kinds = kinds.isEmpty() ? Set.of() : Set.copyOf(EnumSet.copyOf(kinds));
    if (fieldSet != null && (!SET_ID.matcher(fieldSet).matches() || fieldSet.length() > 129)) {
      throw new IllegalArgumentException("a field set's id must be '<plugin-id>.<set>': " + fieldSet);
    }
    if (maxAreaDepth != null) {
      if (!Double.isFinite(maxAreaDepth) || maxAreaDepth <= 0) {
        throw new IllegalArgumentException("a channel's max area depth is finite and positive, in metres: " + maxAreaDepth);
      }
      if (!kinds.contains(ChannelKind.SENSOR_REPORTS)) {
        throw new IllegalArgumentException("only a channel that takes sensor reports has a max area depth (it takes " + kinds + ")");
      }
    }
    Objects.requireNonNull(sensorTypes, "sensorTypes");
    sensorTypes = sensorTypes.isEmpty() ? Set.of() : Set.copyOf(EnumSet.copyOf(sensorTypes));
    if (!sensorTypes.isEmpty() && !kinds.contains(ChannelKind.SENSOR_REPORTS)) {
      throw new IllegalArgumentException("only a channel that takes sensor reports takes sensor types (it takes " + kinds + ")");
    }
  }

  /** The SDK 1.5.0 constructor (CR-0039), without declared kinds (CR-0048: kept, so the change is compatible). */
  public ChannelSpec(String link, String name, String outputType, Set<ChannelCapability> capabilities, List<FieldRef> fields, Set<ChannelKind> kinds,
      @Nullable String fieldSet, @Nullable Double maxAreaDepth, Set<SensorType> sensorTypes) {
    this(link, name, outputType, capabilities, fields, kinds, fieldSet, maxAreaDepth, sensorTypes, Set.of());
  }

  /** The SDK 1.4.0 constructor (CR-0035), taking every sensor type (CR-0039: kept, so the change is compatible). */
  public ChannelSpec(String link, String name, String outputType, Set<ChannelCapability> capabilities, List<FieldRef> fields, Set<ChannelKind> kinds,
      @Nullable String fieldSet, @Nullable Double maxAreaDepth) {
    this(link, name, outputType, capabilities, fields, kinds, fieldSet, maxAreaDepth, Set.of(), Set.of());
  }

  /** The 1.2.0 constructor: a channel that takes ground truth only. */
  public ChannelSpec(String link, String name, String outputType, Set<ChannelCapability> capabilities, List<FieldRef> fields) {
    this(link, name, outputType, capabilities, fields, Set.of(ChannelKind.GROUND_TRUTH), null, null, Set.of(), Set.of());
  }

  /** The SDK 1.4.0 part 1 constructor, without a field set. */
  public ChannelSpec(String link, String name, String outputType, Set<ChannelCapability> capabilities, List<FieldRef> fields, Set<ChannelKind> kinds) {
    this(link, name, outputType, capabilities, fields, kinds, null, null, Set.of(), Set.of());
  }

  /** The SDK 1.4.0 part 3 constructor, without a max area depth (CR-0035: kept, so the change is compatible). */
  public ChannelSpec(String link, String name, String outputType, Set<ChannelCapability> capabilities, List<FieldRef> fields, Set<ChannelKind> kinds,
      @Nullable String fieldSet) {
    this(link, name, outputType, capabilities, fields, kinds, fieldSet, null, Set.of(), Set.of());
  }

  /** A spec without capabilities or fields. */
  public static ChannelSpec of(String link, String name, String outputType) {
    return new ChannelSpec(link, name, outputType, Set.of(), List.of());
  }

  /** The spec with {@code more} capabilities as well. */
  public ChannelSpec can(ChannelCapability... more) {
    EnumSet<ChannelCapability> all = EnumSet.noneOf(ChannelCapability.class);
    all.addAll(capabilities);
    all.addAll(List.of(more));
    return new ChannelSpec(link, name, outputType, all, fields, kinds, fieldSet, maxAreaDepth, sensorTypes, declaredKinds);
  }

  /** The spec with these declared fields instead of its own. */
  public ChannelSpec fields(List<FieldRef> value) {
    return new ChannelSpec(link, name, outputType, capabilities, value, kinds, fieldSet, maxAreaDepth, sensorTypes, declaredKinds);
  }

  /** SDK 1.4.0: the spec taking these kinds of data instead of its own (at least one; from 1.9.0 none when it takes declared kinds). */
  public ChannelSpec kinds(Set<ChannelKind> value) {
    return new ChannelSpec(link, name, outputType, capabilities, fields, value, fieldSet, maxAreaDepth, sensorTypes, declaredKinds);
  }

  /** SDK 1.4.0: the spec naming this field set (its full id), or none for {@code null}. */
  public ChannelSpec fieldSet(@Nullable String value) {
    return new ChannelSpec(link, name, outputType, capabilities, fields, kinds, value, maxAreaDepth, sensorTypes, declaredKinds);
  }

  /**
   * SDK 1.4.0 (CR-0035; owner, KL and KM): the spec carrying detections at most {@code metres} beyond
   * the near edge of a sensor report's area. The channel must take {@link ChannelKind#SENSOR_REPORTS}, so set
   * the kinds first.
   *
   * <p><b>The near edge</b> is the area's distance from the report's {@code platform} at its nearest
   * point, measured along the range from the platform: an {@code ArcBand}'s inner radius, and 0 for
   * an area that holds the platform, such as a {@code Circle} round it.
   *
   * <p><b>The output's promise, both ways</b> (the ACA's R1, as re-checked): the channel carries every
   * detection whose distance from the platform is at most the near edge plus this depth, and it keeps
   * the area's near edge and cuts its far edge there; it leaves out, and counts, the detections
   * farther out. A sender compares with the same sum to warn that units in a sensor's coverage are not
   * sent (the simulator's brief, function 30). It is the output's limit, <b>not a sensor's maximum
   * range</b> (ADR-0048 point 7), which the sensor keeps. {@code gmti} declares 511 980 m, the deepest
   * area STANAG 4607's {@code D26} holds.
   */
  public ChannelSpec maxAreaDepth(double metres) {
    return new ChannelSpec(link, name, outputType, capabilities, fields, kinds, fieldSet, metres, sensorTypes, declaredKinds);
  }

  /**
   * SDK 1.5.0 (CR-0039 point 7): the spec taking reports of these sensor types only, or of every
   * type for an empty set. The channel must take {@link ChannelKind#SENSOR_REPORTS}, so set the kinds
   * first.
   */
  public ChannelSpec sensorTypes(Set<SensorType> value) {
    return new ChannelSpec(link, name, outputType, capabilities, fields, kinds, fieldSet, maxAreaDepth, value, declaredKinds);
  }

  /**
   * SDK 1.9.0 (CR-0048 point 4): the spec taking these kinds that its own plugin declares, by id
   * ({@code <plugin-id>.<name>}), instead of its own declared kinds.
   */
  public ChannelSpec declaredKinds(Set<String> value) {
    return new ChannelSpec(link, name, outputType, capabilities, fields, kinds, fieldSet, maxAreaDepth, sensorTypes, value);
  }

  /** SDK 1.9.0: whether the channel takes the declared kind {@code kind} (its id). */
  public boolean takesDeclared(String kind) {
    return declaredKinds.contains(kind);
  }

  /** SDK 1.4.0: whether the channel takes {@code kind}. */
  public boolean takes(ChannelKind kind) {
    return kinds.contains(kind);
  }

  /** SDK 1.5.0: whether it takes reports of {@code type}; {@code null}, no statement, counts as {@link SensorType#GENERIC}. */
  public boolean takesSensorType(@Nullable SensorType type) {
    return kinds.contains(ChannelKind.SENSOR_REPORTS) && (sensorTypes.isEmpty() || sensorTypes.contains(type == null ? SensorType.GENERIC : type));
  }
}
