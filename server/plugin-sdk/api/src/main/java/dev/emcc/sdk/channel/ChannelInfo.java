package dev.emcc.sdk.channel;

import dev.emcc.sdk.model.FieldRef;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.2.0: an output channel as senders see it (ADR-0037 point 4): its id, display name, output
 * type, what it can do, the declared fields its protocol uses, and (SDK 1.4.0) the kinds of data it
 * takes, its field set and how deep an area it carries, (SDK 1.5.0) the sensor types it takes, and
 * (SDK 1.9.0) the channel kinds its plugin declares that it takes, and its state (CR-0050 point 2).
 *
 * @param id the offering plugin and the link
 * @param name the display name
 * @param outputType what it sends, e.g. {@code cot}
 * @param capabilities what it can do besides updates
 * @param fields the declared fields its protocol uses
 * @param kinds SDK 1.4.0: the kinds of data it takes; a sender sends it only those (ADR-0048 point 4)
 * @param fieldSet SDK 1.4.0: the full id of the field set its protocol uses, or {@code null}; a
 *     sender offers it and adds it to the objects it sends out (ADR-0050 point 7)
 * @param maxAreaDepth SDK 1.4.0 (CR-0035): how deep beyond the near edge of a sensor report's area it
 *     carries detections, in metres, or {@code null} for no limit; what it means is {@link
 *     ChannelSpec#maxAreaDepth(double)}'s. A sender warns about the detections it would send beyond
 *     the near edge plus this depth, since the channel leaves them out
 * @param sensorTypes SDK 1.5.0 (CR-0039 point 7): the sensor types whose reports it takes, empty for
 *     every type; a sender offers a sensor only the channels that take its type ({@link
 *     #takesSensorType})
 * @param declaredKinds SDK 1.9.0 (CR-0048 point 4): the ids of the declared channel kinds it takes
 *     ({@code <plugin-id>.<name>}); a sender sends it {@link DeclaredItem}s of those only ({@link
 *     #takesDeclared})
 * @param state SDK 1.9.0 (CR-0050 point 2): how it is, as its offering plugin set it; {@link
 *     ChannelState#READY} until it sets one
 * @param stateDetail SDK 1.9.0: the state's plain-text detail, e.g. "No destination", 0 to {@link
 *     #MAX_STATE_DETAIL} characters, no control characters; empty until set
 */
public record ChannelInfo(ChannelId id, String name, String outputType, Set<ChannelCapability> capabilities, List<FieldRef> fields, Set<ChannelKind> kinds,
    @Nullable String fieldSet, @Nullable Double maxAreaDepth, Set<SensorType> sensorTypes, Set<String> declaredKinds, ChannelState state, String stateDetail) {

  /** SDK 1.9.0: the longest state detail, in characters. */
  public static final int MAX_STATE_DETAIL = 128;

  public ChannelInfo {
    Objects.requireNonNull(id, "id");
    Objects.requireNonNull(state, "state");
    Objects.requireNonNull(stateDetail, "stateDetail");
    if (stateDetail.length() > MAX_STATE_DETAIL) {
      throw new IllegalArgumentException("a channel's state detail is at most " + MAX_STATE_DETAIL + " characters: " + stateDetail.length());
    }
    if (stateDetail.chars().anyMatch(Character::isISOControl)) {
      throw new IllegalArgumentException("a channel's state detail is plain text, without control characters");
    }
    var spec = new ChannelSpec(id.link(), name, outputType, capabilities, fields, kinds, fieldSet, maxAreaDepth, sensorTypes, declaredKinds); // the same checks
    capabilities = spec.capabilities();
    fields = spec.fields();
    kinds = spec.kinds();
    sensorTypes = spec.sensorTypes();
    declaredKinds = spec.declaredKinds();
  }

  /** The SDK 1.9.0 part P constructor (CR-0048), without a state (CR-0050: kept, so the change is compatible): {@link ChannelState#READY}. */
  public ChannelInfo(ChannelId id, String name, String outputType, Set<ChannelCapability> capabilities, List<FieldRef> fields, Set<ChannelKind> kinds,
      @Nullable String fieldSet, @Nullable Double maxAreaDepth, Set<SensorType> sensorTypes, Set<String> declaredKinds) {
    this(id, name, outputType, capabilities, fields, kinds, fieldSet, maxAreaDepth, sensorTypes, declaredKinds, ChannelState.READY, "");
  }

  /** The SDK 1.5.0 constructor (CR-0039), without declared kinds (CR-0048: kept, so the change is compatible). */
  public ChannelInfo(ChannelId id, String name, String outputType, Set<ChannelCapability> capabilities, List<FieldRef> fields, Set<ChannelKind> kinds,
      @Nullable String fieldSet, @Nullable Double maxAreaDepth, Set<SensorType> sensorTypes) {
    this(id, name, outputType, capabilities, fields, kinds, fieldSet, maxAreaDepth, sensorTypes, Set.of());
  }

  /** The SDK 1.4.0 constructor (CR-0035), taking every sensor type (CR-0039: kept, so the change is compatible). */
  public ChannelInfo(ChannelId id, String name, String outputType, Set<ChannelCapability> capabilities, List<FieldRef> fields, Set<ChannelKind> kinds,
      @Nullable String fieldSet, @Nullable Double maxAreaDepth) {
    this(id, name, outputType, capabilities, fields, kinds, fieldSet, maxAreaDepth, Set.of(), Set.of(), ChannelState.READY, "");
  }

  /** The 1.2.0 constructor: a channel that takes ground truth only. */
  public ChannelInfo(ChannelId id, String name, String outputType, Set<ChannelCapability> capabilities, List<FieldRef> fields) {
    this(id, name, outputType, capabilities, fields, Set.of(ChannelKind.GROUND_TRUTH), null, null);
  }

  /** The SDK 1.4.0 part 1 constructor, without a field set. */
  public ChannelInfo(ChannelId id, String name, String outputType, Set<ChannelCapability> capabilities, List<FieldRef> fields, Set<ChannelKind> kinds) {
    this(id, name, outputType, capabilities, fields, kinds, null, null);
  }

  /** The SDK 1.4.0 part 3 constructor, without a max area depth (CR-0035: kept, so the change is compatible). */
  public ChannelInfo(ChannelId id, String name, String outputType, Set<ChannelCapability> capabilities, List<FieldRef> fields, Set<ChannelKind> kinds,
      @Nullable String fieldSet) {
    this(id, name, outputType, capabilities, fields, kinds, fieldSet, null);
  }

  /** The channel {@code plugin} offers with {@code spec}, as ECore lists it. */
  public static ChannelInfo of(String plugin, ChannelSpec spec) {
    return new ChannelInfo(new ChannelId(plugin, spec.link()), spec.name(), spec.outputType(), spec.capabilities(), spec.fields(), spec.kinds(), spec.fieldSet(),
        spec.maxAreaDepth(), spec.sensorTypes(), spec.declaredKinds(), ChannelState.READY, "");
  }

  /** SDK 1.9.0 (CR-0050 point 2): this channel with another state and detail, as ECore lists it after {@link ChannelRef#state}. */
  public ChannelInfo withState(ChannelState state, String detail) {
    return new ChannelInfo(id, name, outputType, capabilities, fields, kinds, fieldSet, maxAreaDepth, sensorTypes, declaredKinds, state, detail);
  }

  /** SDK 1.4.0: whether it takes {@code kind}. */
  public boolean takes(ChannelKind kind) {
    return kinds.contains(kind);
  }

  /**
   * SDK 1.5.0 (CR-0039 point 7): whether it takes reports of {@code type}: it takes sensor reports,
   * and its {@link #sensorTypes()} are empty or hold the type. {@code null}, a sensor that says no
   * type, counts as {@link SensorType#GENERIC}.
   */
  public boolean takesSensorType(@Nullable SensorType type) {
    return kinds.contains(ChannelKind.SENSOR_REPORTS) && (sensorTypes.isEmpty() || sensorTypes.contains(type == null ? SensorType.GENERIC : type));
  }

  /** SDK 1.9.0 (CR-0048 point 4): whether it takes the declared kind {@code kind} (its id, e.g. {@code fmv.camera-pose}). */
  public boolean takesDeclared(String kind) {
    return declaredKinds.contains(kind);
  }

  /** Whether it can send a delete ({@link ChannelCapability#DELETE}). */
  public boolean canDelete() {
    return capabilities.contains(ChannelCapability.DELETE);
  }
}
