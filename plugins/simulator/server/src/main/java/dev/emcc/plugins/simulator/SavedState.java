package dev.emcc.plugins.simulator;

import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * The simulator's own state in its plugin documents (ADR-0041 points 4 and 5; brief functions 20
 * and 21; A15, A24). The route objects hold the routes, their lists and their events, and the
 * tracks hold their hidden mark and what a reset restores (Q8). The documents hold the rest:
 *
 * <ul>
 *   <li>{@code state}: {@code {format, savedAt, routes: [{id, state}], outputs: ["plugin/link"],
 *       trackDocuments, sensors: [{platform, settings}]}}, the sensors from M5 (function 27);
 *   <li>{@code tracks-0}, {@code tracks-1}, …: {@code {tracks: [{id, route, atStart, seconds, leg,
 *       fraction, nextEvent}]}}, at most {@link #PER_DOCUMENT} each, well under the SDK's 1 MiB.
 * </ul>
 *
 * A track's place is kept as its leg and the fraction of it, so a route edited after the save still
 * places it on the route (A23); {@code leg} is -1 for a track at its start or a convoy member still
 * waiting, whose {@code seconds} are then its clock. Reading is lenient: an entry it cannot use is
 * skipped.
 */
final class SavedState {

  static final String STATE = "state";
  static final int FORMAT = 1;
  static final int PER_DOCUMENT = 1_000;

  /**
   * A track's progress on its route.
   *
   * @param seconds its clock on the route's plan when saved
   * @param leg the leg it was on, or -1
   * @param fraction how far along that leg
   * @param nextEvent the first point whose events it has not passed (A17)
   */
  record Progress(UUID route, boolean atStart, double seconds, int leg, double fraction, int nextEvent) {}

  /** What was read back. */
  record Loaded(Map<UUID, String> routeStates, List<ChannelId> outputs, int trackDocuments, Map<UUID, Progress> tracks,
      Map<UUID, SensorSettings> sensors) {

    /** Nothing saved yet. */
    static Loaded empty() {
      return new Loaded(Map.of(), List.of(), 0, new LinkedHashMap<>(), Map.of());
    }
  }

  private SavedState() {}

  static String tracksKey(int n) {
    return "tracks-" + n;
  }

  static JsonObject state(Instant savedAt, Map<UUID, String> routeStates, List<ChannelId> outputs, int trackDocuments, JsonArray sensors) {
    List<JsonValue> routes = new ArrayList<>();
    routeStates.forEach((id, state) -> routes.add(JsonObject.builder().put("id", JsonString.of(id.toString())).put("state", JsonString.of(state)).build()));
    return JsonObject.builder()
        .put("format", JsonNumber.of(FORMAT))
        .put("savedAt", JsonString.of(savedAt.toString()))
        .put("routes", new JsonArray(routes))
        .put("outputs", new JsonArray(outputs.stream().map(o -> (JsonValue) JsonString.of(o.toString())).toList()))
        .put("trackDocuments", JsonNumber.of(trackDocuments))
        .put("sensors", sensors)
        .build();
  }

  /** The track documents, in order. */
  static List<JsonObject> tracks(Map<UUID, Progress> progress) {
    List<JsonObject> documents = new ArrayList<>();
    List<JsonValue> page = new ArrayList<>();
    for (var e : progress.entrySet()) {
      Progress p = e.getValue();
      page.add(JsonObject.builder()
          .put("id", JsonString.of(e.getKey().toString()))
          .put("route", JsonString.of(p.route().toString()))
          .put("atStart", JsonBoolean.of(p.atStart()))
          .put("seconds", JsonNumber.of(p.seconds()))
          .put("leg", JsonNumber.of(p.leg()))
          .put("fraction", JsonNumber.of(p.fraction()))
          .put("nextEvent", JsonNumber.of(p.nextEvent()))
          .build());
      if (page.size() == PER_DOCUMENT) {
        documents.add(JsonObject.builder().put("tracks", new JsonArray(page)).build());
        page = new ArrayList<>();
      }
    }
    if (!page.isEmpty()) {
      documents.add(JsonObject.builder().put("tracks", new JsonArray(page)).build());
    }
    return documents;
  }

  /** The state document's route states, outputs and number of track documents. */
  static Loaded readState(JsonObject state) {
    Map<UUID, String> routes = new LinkedHashMap<>();
    if (state.get("routes") instanceof JsonArray list) {
      for (JsonValue v : list.values()) {
        if (v instanceof JsonObject o && uuid(o.get("id")) instanceof UUID id && o.get("state") instanceof JsonString s) {
          routes.put(id, s.value());
        }
      }
    }
    List<ChannelId> outputs = new ArrayList<>();
    if (state.get("outputs") instanceof JsonArray list) {
      for (JsonValue v : list.values()) {
        if (v instanceof JsonString s) {
          try {
            outputs.add(ChannelId.parse(s.value()));
          } catch (IllegalArgumentException e) {
            // skipped: not a channel id
          }
        }
      }
    }
    int documents = state.get("trackDocuments") instanceof JsonNumber n ? Math.clamp((long) n.doubleValue(), 0, 1_000) : 0;
    return new Loaded(routes, outputs, documents, new LinkedHashMap<>(), Sensors.read(state.get("sensors")));
  }

  /** Adds the tracks of one track document to {@code into}. */
  static void readTracks(JsonObject document, Map<UUID, Progress> into) {
    if (!(document.get("tracks") instanceof JsonArray list)) {
      return;
    }
    for (JsonValue v : list.values()) {
      if (v instanceof JsonObject o && uuid(o.get("id")) instanceof UUID id && uuid(o.get("route")) instanceof UUID route
          && o.get("seconds") instanceof JsonNumber seconds && Double.isFinite(seconds.doubleValue())) {
        boolean atStart = o.get("atStart") instanceof JsonBoolean b && b.value();
        int leg = o.get("leg") instanceof JsonNumber l ? (int) l.doubleValue() : -1;
        double fraction = o.get("fraction") instanceof JsonNumber f && Double.isFinite(f.doubleValue()) ? f.doubleValue() : 0;
        int nextEvent = o.get("nextEvent") instanceof JsonNumber e ? Math.max(0, (int) e.doubleValue()) : 0;
        into.put(id, new Progress(route, atStart, seconds.doubleValue(), leg, fraction, nextEvent));
      }
    }
  }

  private static @Nullable UUID uuid(@Nullable JsonValue value) {
    if (value instanceof JsonString s) {
      try {
        return UUID.fromString(s.value());
      } catch (IllegalArgumentException e) {
        return null;
      }
    }
    return null;
  }
}
