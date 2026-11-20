package dev.emcc.plugins.simulator;

import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelInfo;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.channel.ChannelKind;
import dev.emcc.sdk.channel.ChannelList;
import dev.emcc.sdk.channel.Channels;
import dev.emcc.sdk.channel.SensorType;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.FieldRef;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.worker.SendResult;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * The simulation's outputs (brief function 18, ADR-0037 point 4): the output channels other plugins
 * offer, which of them users chose, and what was sent. Owned by the engine worker.
 *
 * <p>The choice is kept by {@link ChannelId}. A chosen channel that is not offered now, or answered
 * {@code CLOSED}, is <b>missing, not dropped</b> (ACA note N8): it is used again when the list offers
 * it again, and users may remove it.
 *
 * <p>From M5 (ADR-0048 point 6) one instance holds the Ground truth outputs and one per sensor its
 * sensor outputs: each offers only the channels that take its {@link ChannelKind}. Each item sent
 * lists the channel's field set in its content (function 31, the ACA's R7), never the stored track.
 */
final class Outputs {

  private final ChannelKind kind;
  /** A sensor's type (function 36): only the channels that take it; null takes every channel of the kind. */
  private final @Nullable SensorType sensorType;
  private ChannelList list = ChannelList.empty();
  private final Set<ChannelId> chosen = new LinkedHashSet<>();
  /** Chosen channels that answered {@code CLOSED} since the list last changed. */
  private final Set<ChannelId> closed = new HashSet<>();
  long sent;
  long dropped;
  long closedAnswers;
  long removals;

  Outputs(ChannelKind kind) {
    this(kind, null);
  }

  /** A sensor's outputs (function 36, CR-0039 point 7): the channels whose {@code sensorTypes} take its type. */
  Outputs(ChannelKind kind, @Nullable SensorType sensorType) {
    this.kind = kind;
    this.sensorType = sensorType;
  }

  private boolean takes(ChannelInfo c) {
    return c.takes(kind) && (sensorType == null || c.takesSensorType(sensorType));
  }

  /** A new list from {@code channels().watch}: every chosen channel it offers is tried again. */
  void listed(ChannelList channels) {
    list = channels;
    closed.clear();
  }

  /** Every channel offered now, of any kind. */
  ChannelList list() {
    return list;
  }

  List<ChannelId> chosen() {
    return List.copyOf(chosen);
  }

  void choose(List<ChannelId> ids) {
    chosen.clear();
    chosen.addAll(ids);
  }

  boolean offered(ChannelId id) {
    return info(id).isPresent();
  }

  /** The channel {@code id} as offered now, if it takes this kind. */
  Optional<ChannelInfo> info(ChannelId id) {
    return list.find(id).filter(this::takes);
  }

  /** The channels offered now that take this kind. */
  List<ChannelInfo> channels() {
    return list.channels().stream().filter(this::takes).toList();
  }

  boolean missing(ChannelId id) {
    return !offered(id) || closed.contains(id);
  }

  /** Whether any chosen channel can be sent to now. */
  boolean any() {
    return chosen.stream().anyMatch(id -> !missing(id));
  }

  /** Sends {@code item} to every chosen channel that is not missing; {@code send} never blocks (rule C5). */
  void send(Channels channels, ChannelItem item) {
    send(channels, set -> item);
  }

  /** Sends an update of {@code content}, with each channel's field set added (function 31). */
  void sendUpdate(Channels channels, java.util.UUID id, MapObjectContent content) {
    send(channels, set -> new ChannelItem.Update(id, withSet(content, set)));
  }

  /** {@code content} as an item for a channel of field set {@code set} carries it: that set listed. */
  static MapObjectContent withSet(MapObjectContent content, @Nullable String set) {
    return set == null ? content : content.withFieldSet(set);
  }

  /** Sends to every chosen channel that is not missing the item {@code item} makes for its field set. */
  void send(Channels channels, Function<@Nullable String, ChannelItem> item) {
    for (ChannelId id : chosen) {
      ChannelInfo info = info(id).orElse(null);
      if (info == null || missing(id)) {
        continue;
      }
      ChannelItem sending = item.apply(info.fieldSet());
      SendResult result = channels.send(id, sending);
      switch (result) {
        case ACCEPTED -> {
          if (sending instanceof ChannelItem.Removal) {
            removals++;
          } else {
            sent++;
          }
        }
        case DROPPED -> dropped++;
        case CLOSED -> {
          closedAnswers++;
          closed.add(id);
        }
      }
    }
  }

  /** {@code GET /outputs}: every channel offered, and the chosen ones, missing ones marked. */
  JsonObject json() {
    List<JsonValue> channels = new ArrayList<>();
    for (ChannelInfo c : channels()) {
      List<JsonValue> fields = new ArrayList<>();
      for (FieldRef f : c.fields()) {
        fields.add(JsonObject.builder().put("plugin", JsonString.of(f.plugin())).put("name", JsonString.of(f.name())).build());
      }
      channels.add(JsonObject.builder()
          .put("id", JsonString.of(c.id().toString()))
          .put("plugin", JsonString.of(c.id().plugin()))
          .put("name", JsonString.of(c.name()))
          .put("outputType", JsonString.of(c.outputType()))
          .put("canDelete", JsonBoolean.of(c.canDelete()))
          .put("fields", new JsonArray(fields))
          .put("fieldSet", c.fieldSet() == null ? JsonNull.INSTANCE : JsonString.of(c.fieldSet()))
          .put("maxAreaDepth", c.maxAreaDepth() == null ? JsonNull.INSTANCE : JsonNumber.of(c.maxAreaDepth()))
          .put("sensorTypes", new JsonArray(c.sensorTypes().stream().sorted().map(t -> (JsonValue) JsonString.of(t.name())).toList()))
          .put("chosen", JsonBoolean.of(chosen.contains(c.id())))
          .build());
    }
    List<JsonValue> picked = new ArrayList<>();
    for (ChannelId id : chosen) {
      picked.add(JsonObject.builder().put("id", JsonString.of(id.toString())).put("missing", JsonBoolean.of(missing(id))).build());
    }
    return JsonObject.builder().put("channels", new JsonArray(channels)).put("chosen", new JsonArray(picked)).build();
  }

  /** The status's part (brief function 17a). */
  String status() {
    List<String> missing = chosen.stream().filter(this::missing).map(ChannelId::toString).toList();
    String named = String.join(", ", missing.subList(0, Math.min(3, missing.size()))) + (missing.size() > 3 ? " and " + (missing.size() - 3) + " more" : "");
    return "outputs " + chosen.size() + " chosen" + (missing.isEmpty() ? "" : " (missing: " + named + ")")
        + ", sent " + sent + ", removals " + removals + ", dropped " + dropped + ", closed " + closedAnswers;
  }
}
