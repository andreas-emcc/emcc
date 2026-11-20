package dev.emcc.plugins.fmv.out.wms;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginLog;
import dev.emcc.sdk.document.DocumentResult;
import dev.emcc.sdk.document.Documents;
import dev.emcc.sdk.http.HttpCall;
import dev.emcc.sdk.http.HttpResult;
import dev.emcc.sdk.http.OutboundHttp;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * {@code fmv}'s WMS tiles and their cache (brief section 10.5 point 17; ADR-0058 point 4, ADR-0059
 * point 8), the output worker's helper. A tile a link wants is looked up in the plugin's documents
 * first; one that is not kept is fetched through the SDK's outbound HTTP from the admin's server, at
 * most {@link #MAX_IN_FLIGHT} at a time and {@link #MAX_PER_SECOND} a second (O7), and kept as one
 * document under {@link WmsGrid#PREFIX}, at most {@link #MAX_TILES} of them, the least recently
 * used removed first (O12). A kept tile of another server, layer or format is used, and fetched
 * again when it can be (owner, 2026-11-17); one of another tile size never is (its ground differs).
 *
 * <p>The documents cannot be listed, so the order of use lives in one more document, {@link
 * #INDEX_KEY}, outside the prefix, written at most every {@link #INDEX_EVERY}. A tile whose document
 * is there but not in the index (a crash before the index was written) is taken in when it is next
 * looked up. Pure worker code: it never blocks, and every answer comes back as a message.
 *
 * @param <M> the worker's message type
 */
public final class WmsCache<M extends Message> {

  /** The most tiles kept (O12): of the 1 000 documents a plugin may keep, with the index. */
  public static final int MAX_TILES = 900;

  /** The largest tile kept or fetched (section 10.5 point 17). */
  public static final int MAX_TILE_BYTES = 512 * 1024;

  /** Requests at a time (O7). */
  public static final int MAX_IN_FLIGHT = 4;

  /** Requests a second (O7). */
  public static final int MAX_PER_SECOND = 20;

  /** Each request's timeout. */
  public static final Duration TIMEOUT = Duration.ofSeconds(10);

  /** The document of the tiles' order of use; outside {@link WmsGrid#PREFIX}, so no other document starts with it. */
  public static final String INDEX_KEY = "wms-cache-index";

  /** The index is written at most this often while it has changed. */
  public static final Duration INDEX_EVERY = Duration.ofSeconds(30);

  /** Which call a document answer belongs to. */
  public enum Op {
    GET,
    PUT,
    DELETE,
    INDEX_GET,
    INDEX_PUT
  }

  /** Wraps the answers as the worker's messages. */
  public interface Wrap<M> {
    M document(Op op, String key, DocumentResult result);

    M fetched(String key, HttpResult result);
  }

  /** What the cache gives the worker. */
  public sealed interface Outcome {
    /** A tile's image for the links that want it: from the cache, or fetched. */
    record Deliver(WmsGrid.Tile tile, Bytes image, Set<String> links, boolean fromCache) implements Outcome {}

    /** A fetch that failed, for the links that wanted the tile. */
    record Failed(WmsGrid.Tile tile, Set<String> links, String reason) implements Outcome {}
  }

  private enum State {
    GETTING,
    QUEUED,
    FETCHING
  }

  private static final class Want {
    final WmsGrid.Tile tile;
    final Set<String> links = new LinkedHashSet<>();
    State state = State.GETTING;
    /** The kept image of another server, already delivered, while a new one is fetched. */
    @Nullable Bytes kept;

    Want(WmsGrid.Tile tile) {
      this.tile = tile;
    }
  }

  private enum IndexState {
    NOT_ASKED,
    LOADING,
    LOADED
  }

  private final Documents documents;
  private final OutboundHttp http;
  private final WorkerRef<M> self;
  private final Wrap<M> wrap;
  private final Supplier<Instant> now;
  private final PluginLog log;

  private WmsSettings settings = WmsSettings.OFF;
  private WmsGrid grid = WmsSettings.OFF.grid();
  /** The kept tiles' sizes by key, least recently used first. */
  private final LinkedHashMap<String, Integer> index = new LinkedHashMap<>(1024, 0.75f, true);
  private IndexState indexState = IndexState.NOT_ASKED;
  private boolean dirty;
  private Instant written = Instant.EPOCH;
  private final Map<String, Want> wants = new HashMap<>();
  private final Deque<String> queue = new ArrayDeque<>();
  private final Deque<Instant> starts = new ArrayDeque<>();
  private int inFlight;
  private long fetched;
  private long fromCache;
  private long failed;
  private long keepFailed;
  private @Nullable String lastFailure;

  public WmsCache(Documents documents, OutboundHttp http, WorkerRef<M> self, Wrap<M> wrap, Supplier<Instant> now, PluginLog log) {
    this.documents = documents;
    this.http = http;
    this.self = self;
    this.wrap = wrap;
    this.now = now;
    this.log = log;
  }

  // ------------------------------------------------------------------- settings and wants

  /** Takes the settings; the first call reads the index. A change forgets the wants (the views plan again). */
  public void apply(WmsSettings next) {
    if (indexState == IndexState.NOT_ASKED) {
      indexState = IndexState.LOADING;
      documents.get(INDEX_KEY, self, r -> wrap.document(Op.INDEX_GET, INDEX_KEY, r));
    }
    if (!next.equals(settings)) {
      settings = next;
      grid = next.grid();
      wants.clear();
      queue.clear();
      lastFailure = null;
    }
  }

  public WmsSettings settings() {
    return settings;
  }

  public WmsGrid grid() {
    return grid;
  }

  /** Whether the views plan WMS tiles: when tiles are fetched, or some are kept (they are used while it is off). */
  public boolean active() {
    return fetching() || (indexState == IndexState.LOADED && !index.isEmpty());
  }

  /** Whether tiles are fetched now. */
  public boolean fetching() {
    return settings.whyNotFetching() == null;
  }

  /** A link wants a tile: it is looked up, then fetched. A tile already being fetched for another server's kept one is delivered at once. */
  public List<Outcome> want(String link, WmsGrid.Tile tile) {
    Want w = wants.get(tile.key());
    if (w != null) {
      w.links.add(link);
      Bytes kept = w.kept;
      return kept == null ? List.of() : List.of(new Outcome.Deliver(tile, kept, Set.of(link), true));
    }
    w = new Want(tile);
    w.links.add(link);
    wants.put(tile.key(), w);
    String key = tile.key();
    documents.get(key, self, r -> wrap.document(Op.GET, key, r));
    return List.of();
  }

  /** A link no longer wants a tile. A fetch under way goes on, so its tile is kept. */
  public void unwant(String link, String key) {
    Want w = wants.get(key);
    if (w == null) {
      return;
    }
    w.links.remove(link);
    if (w.links.isEmpty() && w.state != State.FETCHING) {
      wants.remove(key);
      queue.remove(key);
    }
  }

  // ------------------------------------------------------------------- answers

  /** Takes a document answer. */
  public List<Outcome> onDocument(Op op, String key, DocumentResult result) {
    List<Outcome> out = new ArrayList<>();
    switch (op) {
      case INDEX_GET -> loadIndex(result);
      case GET -> onGet(key, result, out);
      case PUT -> {
        if (result instanceof DocumentResult.Failed f) {
          keepFailed++;
          index.remove(key);
          dirty = true;
          log.warn("WMS: the tile {} could not be kept: {}", key, f.reason());
        }
      }
      case DELETE -> {
        if (result instanceof DocumentResult.Failed f) {
          log.warn("WMS: the tile {} could not be removed: {}", key, f.reason());
        }
      }
      case INDEX_PUT -> {
        if (result instanceof DocumentResult.Failed f) {
          dirty = true; // written again at the next chance
          log.warn("WMS: the cache's index could not be written: {}", f.reason());
        }
      }
    }
    pump();
    return out;
  }

  private void onGet(String key, DocumentResult result, List<Outcome> out) {
    Want w = wants.get(key);
    if (w == null || w.state != State.GETTING) {
      return;
    }
    Kept k = result instanceof DocumentResult.Found f ? Kept.read(f.value(), settings.tilePixels()) : null;
    if (result instanceof DocumentResult.Failed f) {
      log.warn("WMS: the tile {} could not be read: {}", key, f.reason());
    }
    if (k != null) {
      index.put(key, k.image().size()); // used now, or taken in after a lost index
      dirty = true;
      fromCache++;
      out.add(new Outcome.Deliver(w.tile, k.image(), Set.copyOf(w.links), true));
      if (fetching() && !k.server().equals(server(settings))) {
        w.kept = k.image(); // another server's tile: used, and fetched again (owner, 2026-11-17)
        w.state = State.QUEUED;
        queue.add(key);
      } else {
        wants.remove(key);
      }
    } else if (fetching()) {
      w.state = State.QUEUED;
      queue.add(key);
    } else {
      wants.remove(key);
    }
  }

  /** Takes a fetch's answer. */
  public List<Outcome> onFetched(String key, HttpResult result) {
    inFlight--;
    List<Outcome> out = new ArrayList<>();
    Want w = wants.get(key);
    if (w != null && w.state == State.FETCHING) {
      wants.remove(key);
      String why = switch (result) {
        case HttpResult.Response r when r.status() == 200 && isImage(r.body()) -> null;
        case HttpResult.Response r when r.status() == 200 -> "not an image (a WMS exception?)";
        case HttpResult.Response r -> "HTTP " + r.status();
        case HttpResult.Failed f -> f.reason();
        case HttpResult.TimedOut t -> "timed out after " + TIMEOUT.toSeconds() + " s";
      };
      if (why == null) {
        Bytes image = ((HttpResult.Response) result).body();
        fetched++;
        lastFailure = null;
        out.add(new Outcome.Deliver(w.tile, image, Set.copyOf(w.links), false));
        keep(w.tile, image);
      } else {
        failed++;
        if (!why.equals(lastFailure)) {
          log.warn("WMS: a tile from {} failed: {}", settings.host(), why);
        }
        lastFailure = why;
        out.add(new Outcome.Failed(w.tile, Set.copyOf(w.links), why));
      }
    }
    pump();
    return out;
  }

  // ------------------------------------------------------------------- the tick

  /** Starts queued fetches while there is room, and writes the index when it is due. */
  public void tick() {
    pump();
    Instant t = now.get();
    if (dirty && indexState == IndexState.LOADED && Duration.between(written, t).compareTo(INDEX_EVERY) >= 0) {
      List<JsonValue> tiles = new ArrayList<>();
      for (var e : index.entrySet()) {
        tiles.add(JsonArray.of(JsonString.of(e.getKey()), JsonNumber.of(e.getValue())));
      }
      documents.put(INDEX_KEY, JsonObject.builder().put("tiles", new JsonArray(tiles)).build(), self, r -> wrap.document(Op.INDEX_PUT, INDEX_KEY, r));
      dirty = false;
      written = t;
    }
  }

  private void pump() {
    if (!fetching()) {
      return;
    }
    Instant t = now.get();
    while (!starts.isEmpty() && Duration.between(starts.peekFirst(), t).compareTo(Duration.ofSeconds(1)) >= 0) {
      starts.removeFirst();
    }
    String url = Objects.requireNonNull(settings.url());
    String layer = Objects.requireNonNull(settings.layer());
    while (inFlight < MAX_IN_FLIGHT && starts.size() < MAX_PER_SECOND && !queue.isEmpty()) {
      String key = queue.poll();
      Want w = wants.get(key);
      if (w == null || w.state != State.QUEUED) {
        continue;
      }
      HttpCall call = HttpCall.get(grid.getMap(url, layer, settings.format(), w.tile)).header("User-Agent", "emcc-fmv").header("Accept", settings.format())
          .maxResponseBytes(MAX_TILE_BYTES);
      String token = settings.token();
      if (token != null) {
        call = call.credential(token);
      }
      w.state = State.FETCHING;
      inFlight++;
      starts.addLast(t);
      http.send(call, TIMEOUT, self, r -> wrap.fetched(key, r));
    }
  }

  // ------------------------------------------------------------------- keeping

  private void keep(WmsGrid.Tile tile, Bytes image) {
    String key = tile.key();
    while (index.size() >= MAX_TILES && !index.containsKey(key)) {
      String oldest = index.keySet().iterator().next();
      index.remove(oldest);
      documents.delete(oldest, self, r -> wrap.document(Op.DELETE, oldest, r));
    }
    JsonObject doc = JsonObject.builder()
        .put("crs", JsonNumber.of(grid.crs().code()))
        .put("metresPerPixel", JsonNumber.of(grid.metresPerPixel()))
        .put("tilePixels", JsonNumber.of(grid.tilePixels()))
        .put("column", JsonNumber.of(tile.column()))
        .put("row", JsonNumber.of(tile.row()))
        .put("url", JsonString.of(Objects.requireNonNull(settings.url())))
        .put("layer", JsonString.of(Objects.requireNonNull(settings.layer())))
        .put("format", JsonString.of(settings.format()))
        .put("source", JsonString.of(Objects.requireNonNull(settings.source())))
        .put("licence", JsonString.of(Objects.requireNonNull(settings.licence())))
        .put("fetched", JsonString.of(now.get().toString()))
        .put("image", JsonString.of(Base64.getEncoder().encodeToString(image.toArray())))
        .build();
    documents.put(key, doc, self, r -> wrap.document(Op.PUT, key, r));
    index.put(key, image.size());
    dirty = true;
  }

  private void loadIndex(DocumentResult result) {
    LinkedHashMap<String, Integer> loaded = new LinkedHashMap<>();
    if (result instanceof DocumentResult.Found f && f.value().get("tiles") instanceof JsonArray tiles) {
      for (JsonValue v : tiles.values()) {
        if (v instanceof JsonArray a && a.size() == 2 && a.get(0) instanceof JsonString k && a.get(1) instanceof JsonNumber n
            && k.value().startsWith(WmsGrid.PREFIX) && k.value().length() <= 128 && Documents.KEY_PATTERN.matcher(k.value()).matches()) {
          loaded.put(k.value(), (int) Math.max(0, Math.min(MAX_TILE_BYTES, n.doubleValue())));
        }
      }
    } else if (result instanceof DocumentResult.Failed f) {
      log.warn("WMS: the cache's index could not be read: {}; tiles are taken in again as they are used", f.reason());
    }
    // tiles kept while the index was read are the newest
    for (var e : index.entrySet()) {
      loaded.remove(e.getKey());
      loaded.put(e.getKey(), e.getValue());
    }
    index.clear();
    index.putAll(loaded);
    while (index.size() > MAX_TILES) {
      String oldest = index.keySet().iterator().next();
      index.remove(oldest);
      documents.delete(oldest, self, r -> wrap.document(Op.DELETE, oldest, r));
      dirty = true;
    }
    indexState = IndexState.LOADED;
  }

  // ------------------------------------------------------------------- the status

  /** The tiles kept. */
  public int kept() {
    return index.size();
  }

  /** The kept tiles' bytes. */
  public long keptBytes() {
    long n = 0;
    for (int b : index.values()) {
      n += b;
    }
    return n;
  }

  public long fetchedTotal() {
    return fetched;
  }

  public long fromCacheTotal() {
    return fromCache;
  }

  public long failedTotal() {
    return failed;
  }

  public long keepFailedTotal() {
    return keepFailed;
  }

  /** The last fetch's failure, until one succeeds. */
  public @Nullable String lastFailure() {
    return lastFailure;
  }

  /** The tiles waiting to be fetched. */
  public int queued() {
    return queue.size();
  }

  // ------------------------------------------------------------------- helpers

  /** A kept tile: its image and the server, layer and format it came from. */
  private record Kept(Bytes image, String server) {
    static @Nullable Kept read(JsonObject doc, int tilePixels) {
      if (!(doc.get("image") instanceof JsonString image) || !(doc.get("tilePixels") instanceof JsonNumber pixels) || pixels.doubleValue() != tilePixels) {
        return null; // not a tile, or another tile size: its ground differs
      }
      byte[] bytes;
      try {
        bytes = Base64.getDecoder().decode(image.value());
      } catch (IllegalArgumentException e) {
        return null;
      }
      if (bytes.length > MAX_TILE_BYTES || !isImage(Bytes.of(bytes))) {
        return null;
      }
      return new Kept(Bytes.of(bytes), text(doc, "url") + " " + text(doc, "layer") + " " + text(doc, "format"));
    }
  }

  private static String server(WmsSettings s) {
    return s.url() + " " + s.layer() + " " + s.format();
  }

  private static String text(JsonObject o, String key) {
    return o.get(key) instanceof JsonString s ? s.value() : "";
  }

  /** A JPEG or a PNG, by its first bytes: a WMS sends an XML exception with status 200. */
  static boolean isImage(Bytes b) {
    if (b.size() >= 3 && (b.get(0) & 0xFF) == 0xFF && (b.get(1) & 0xFF) == 0xD8 && (b.get(2) & 0xFF) == 0xFF) {
      return true;
    }
    return b.size() >= 8 && (b.get(0) & 0xFF) == 0x89 && b.get(1) == 'P' && b.get(2) == 'N' && b.get(3) == 'G' && b.get(4) == 0x0D && b.get(5) == 0x0A
        && b.get(6) == 0x1A && b.get(7) == 0x0A;
  }
}
