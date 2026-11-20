package dev.emcc.plugins.basemaposm;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.Status;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpCall;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.http.HttpResult;
import dev.emcc.sdk.http.OutboundHttp;
import dev.emcc.sdk.http.ResponseHandle;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.WorkerContext;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import org.jspecify.annotations.Nullable;

/**
 * The tile proxy: answers tile requests from the cache or from the upstream.
 *
 * <p>No handler call ever waits for the upstream. A cache miss starts the upstream request through
 * the SDK's outbound HTTP, which ECore runs outside the worker, and returns at once; the outcome
 * arrives later as {@link TileMsg.Fetched}, and only then are the waiting browser requests
 * answered. More misses than the concurrency limit wait in a bounded queue, for at most {@link
 * #QUEUE_WAIT}. Requests for a tile that is already being fetched share that one fetch.
 *
 * <p>When the upstream keeps failing, a circuit breaker answers {@code 502} at once for {@link
 * #BREAKER_OPEN} instead of letting every request wait for a timeout, then lets one request
 * through to find out whether the upstream is back. No tiles are fetched except those a browser
 * asks for (no prefetching).
 *
 * <p>The state is touched only by this worker, so it needs no locks.
 */
final class TileProxy implements Handler<TileMsg> {

  /** The OSM tile usage policy asks for modest use; the SDK allows 16 concurrent calls per plugin. */
  static final int MAX_CONCURRENT_FETCHES = 8;
  /** Tiles being fetched or queued; one more request gets 503. */
  static final int MAX_PENDING_TILES = 256;
  /** Browser requests waiting for one tile; one more gets 503. */
  static final int MAX_WAITERS_PER_TILE = 32;
  /** Failures in a row that open the circuit breaker. */
  static final int FAILURES_TO_OPEN = 5;

  static final Duration TICK = Duration.ofMillis(500);
  /** How long a request may wait in the queue for a free fetch slot before it gets 503. */
  static final Duration QUEUE_WAIT = Duration.ofSeconds(3);
  static final Duration BREAKER_OPEN = Duration.ofSeconds(30);
  /** At most one warning per interval. */
  static final Duration WARN_INTERVAL = Duration.ofSeconds(60);

  static final String USER_AGENT = "emc2-basemap-osm/0.1 (emc2 development and demonstration; OSM tile usage policy)";
  private static final long QUEUE_WAIT_TICKS = ticks(QUEUE_WAIT);
  private static final long BREAKER_TICKS = ticks(BREAKER_OPEN);
  private static final long WARN_TICKS = ticks(WARN_INTERVAL);

  private enum Breaker { CLOSED, OPEN, HALF_OPEN }

  /** One tile being fetched or waiting for a fetch slot, with the browser requests waiting for it. */
  private static final class Pending {
    final List<ResponseHandle> waiters = new ArrayList<>();
    final long queuedAtTick;
    boolean started;
    /** The settings generation this fetch started under: after the upstream URL changed, its answer is not cached. */
    long generation;

    Pending(long queuedAtTick) {
      this.queuedAtTick = queuedAtTick;
    }
  }

  /** The settings in force; {@code null} until a valid set exists (the plugin is then FAILED and answers 503). */
  private @Nullable TileSettings settings;
  private final OutboundHttp http;
  private final Status status;
  private final TileCache cache = new TileCache(1);
  /** Why the latest settings were refused, or {@code null}. */
  private @Nullable String settingsProblem;
  /** Counts upstream URL changes. */
  private long generation;
  private final LinkedHashMap<TileKey, Pending> pending = new LinkedHashMap<>();
  private final ArrayDeque<TileKey> queue = new ArrayDeque<>();
  private int inFlight;
  private long tick;
  private Breaker breaker = Breaker.CLOSED;
  private long breakerOpenUntilTick;
  private @Nullable TileKey trial;
  private int failuresInARow;
  private boolean degraded;
  private String upstreamProblem = "";
  private long lastWarnTick = -1;
  private int suppressedWarnings;

  /**
   * @param current the settings in force when this handler is made: at start, and after a restart of the worker, the
   *     values valid at that moment, not the ones of the first start. If they are not usable the proxy answers 503 until
   *     a good change arrives.
   */
  TileProxy(JsonObject current, OutboundHttp http, Status status) {
    this.http = http;
    this.status = status;
    try {
      TileSettings parsed = TileSettings.parse(current);
      this.settings = parsed;
      this.cache.resize(parsed.cacheTiles());
    } catch (IllegalArgumentException e) {
      this.settingsProblem = e.getMessage();
    }
    updateStatus();
  }

  @Override
  public void handle(TileMsg message, WorkerContext<TileMsg> context) {
    switch (message) {
      case TileMsg.Get get -> get(get.request(), context);
      case TileMsg.Fetched fetched -> fetched(fetched.key(), fetched.result(), context);
      case TileMsg.Tick ignored -> tick(context);
      case TileMsg.SettingsChanged changed -> settingsChanged(changed.settings(), context);
    }
  }

  private void get(EndpointRequest request, WorkerContext<TileMsg> context) {
    ResponseHandle response = request.response();
    TileSettings current = settings;
    if (current == null) {
      response.respond(error(503)); // no valid settings yet
      return;
    }
    TileKey key = TileKey.parse(
        request.pathParameters().get("z"), request.pathParameters().get("x"), request.pathParameters().get("y"), current.maxZoom());
    if (key == null) {
      response.respond(error(400));
      return;
    }
    Bytes cached = cache.get(key);
    if (cached != null) {
      response.respond(tile(cached));
      return;
    }
    Pending existing = pending.get(key);
    if (existing != null) {
      if (existing.waiters.size() >= MAX_WAITERS_PER_TILE) {
        response.respond(busy());
      } else {
        existing.waiters.add(response);
      }
      return;
    }
    if (breaker == Breaker.OPEN && tick >= breakerOpenUntilTick) {
      breaker = Breaker.HALF_OPEN;
      trial = null;
    }
    if (breaker == Breaker.OPEN || (breaker == Breaker.HALF_OPEN && trial != null && pending.containsKey(trial))) {
      response.respond(error(502)); // fail fast: the upstream is known to be down
      return;
    }
    if (pending.size() >= MAX_PENDING_TILES) {
      response.respond(busy());
      return;
    }
    if (breaker == Breaker.HALF_OPEN) {
      trial = key; // the one request that finds out whether the upstream is back
    }
    Pending created = new Pending(tick);
    created.waiters.add(response);
    pending.put(key, created);
    queue.add(key);
    startQueued(context);
  }

  /** Starts upstream requests for queued tiles while a fetch slot is free. Returns at once. */
  private void startQueued(WorkerContext<TileMsg> context) {
    TileSettings current = settings;
    if (current == null) {
      return;
    }
    while (inFlight < MAX_CONCURRENT_FETCHES && !queue.isEmpty()) {
      TileKey key = queue.poll();
      Pending entry = pending.get(key);
      if (entry == null) {
        continue;
      }
      entry.started = true;
      entry.generation = generation;
      inFlight++;
      http.send(
          HttpCall.get(current.uriFor(key)).header("User-Agent", USER_AGENT),
          current.upstreamTimeout(),
          context.self(),
          result -> new TileMsg.Fetched(key, result));
    }
  }

  private void fetched(TileKey key, HttpResult result, WorkerContext<TileMsg> context) {
    Pending entry = pending.get(key);
    if (entry == null || !entry.started) {
      return; // an answer to a fetch an earlier instance of this worker started: nobody waits for it
    }
    pending.remove(key);
    inFlight--;
    // A fetch that started before the upstream URL changed finishes with the old settings: it answers
    // the browser, but says nothing about the new upstream and its tile is not cached.
    boolean current = entry.generation == generation;
    switch (result) {
      case HttpResult.Response r when r.status() == 200 && isPng(r.body()) -> {
        if (current) {
          cache.put(key, r.body());
          upstreamWorks(context);
        }
        answer(entry, tile(r.body()));
      }
      case HttpResult.Response r when r.status() == 404 -> {
        if (current) {
          upstreamWorks(context);
        }
        answer(entry, error(404));
      }
      case HttpResult.Response r -> {
        if (current) {
          upstreamFailed(key, r.status() == 200 ? "upstream sent no PNG" : "upstream answered " + r.status(), context);
        }
        answer(entry, error(502));
      }
      case HttpResult.Failed f -> {
        if (current) {
          upstreamFailed(key, f.reason(), context);
        }
        answer(entry, error(502));
      }
      case HttpResult.TimedOut t -> {
        if (current) {
          upstreamFailed(key, "no answer within the upstream timeout", context);
        }
        answer(entry, error(504));
      }
    }
    startQueued(context);
  }

  private void tick(WorkerContext<TileMsg> context) {
    tick++;
    Iterator<TileKey> waiting = queue.iterator();
    while (waiting.hasNext()) {
      TileKey key = waiting.next();
      Pending entry = pending.get(key);
      if (entry == null) {
        waiting.remove();
      } else if (tick - entry.queuedAtTick >= QUEUE_WAIT_TICKS) {
        waiting.remove();
        pending.remove(key);
        answer(entry, busy());
      }
    }
    startQueued(context);
  }

  private void upstreamWorks(WorkerContext<TileMsg> context) {
    failuresInARow = 0;
    breaker = Breaker.CLOSED;
    trial = null;
    if (degraded) {
      degraded = false;
      updateStatus();
      context.log().info("upstream tile server reachable again");
    }
  }

  private void upstreamFailed(TileKey key, String reason, WorkerContext<TileMsg> context) {
    warn(reason, context);
    switch (breaker) {
      case CLOSED -> {
        if (++failuresInARow >= FAILURES_TO_OPEN) {
          openBreaker(reason, context);
        }
      }
      case HALF_OPEN -> {
        if (key.equals(trial)) {
          openBreaker(reason, context);
        }
      }
      case OPEN -> { }
    }
  }

  private void openBreaker(String reason, WorkerContext<TileMsg> context) {
    breaker = Breaker.OPEN;
    breakerOpenUntilTick = tick + BREAKER_TICKS;
    trial = null;
    degraded = true;
    upstreamProblem = "upstream tile server unreachable: " + reason;
    updateStatus();
    // Tiles still waiting for a fetch slot would only fail too: answer them now.
    for (TileKey key : queue) {
      Pending entry = pending.remove(key);
      if (entry != null) {
        answer(entry, error(502));
      }
    }
    queue.clear();
  }

  /**
   * A change from the settings view (ECore has checked it against the manifest's schema). The new values apply to
   * everything that starts from now on; fetches already running finish with the old ones. A new upstream URL empties
   * the cache (the tiles may look different) and forgets what was learned about the old upstream.
   */
  private void settingsChanged(JsonObject raw, WorkerContext<TileMsg> context) {
    TileSettings next;
    try {
      next = TileSettings.parse(raw);
    } catch (IllegalArgumentException e) {
      settingsProblem = e.getMessage();
      context.log().warn("setting change refused{}: {}", settings == null ? "" : ", the old values stay", settingsProblem);
      updateStatus();
      return;
    }
    TileSettings old = settings;
    if (old == null || !old.upstreamTemplate().equals(next.upstreamTemplate())) {
      generation++;
      cache.clear();
      breaker = Breaker.CLOSED;
      trial = null;
      failuresInARow = 0;
      degraded = false;
    }
    cache.resize(next.cacheTiles());
    settings = next;
    settingsProblem = null;
    updateStatus();
    context.log().info(
        "settings applied: upstream host {}, max zoom {}, cache {} tiles, timeout {} s",
        next.uriFor(new TileKey(0, 0, 0)).getHost(),
        next.maxZoom(),
        next.cacheTiles(),
        next.upstreamTimeout().toSeconds());
    startQueued(context); // tiles that waited while there were no valid settings
  }

  /** The plugin's own status from what is known: no valid settings, a refused change, an unreachable upstream, or fine. */
  private void updateStatus() {
    if (settings == null) {
      status.set(PluginState.FAILED, "bad setting: " + settingsProblem);
    } else if (settingsProblem != null) {
      status.set(PluginState.DEGRADED, "setting change refused, the old values stay: " + settingsProblem);
    } else if (degraded) {
      status.set(PluginState.DEGRADED, upstreamProblem);
    } else {
      status.set(PluginState.OK, "ready");
    }
  }

  /** At most one warning per {@link #WARN_INTERVAL}, however many tiles fail. */
  private void warn(String reason, WorkerContext<TileMsg> context) {
    if (lastWarnTick >= 0 && tick - lastWarnTick < WARN_TICKS) {
      suppressedWarnings++;
      return;
    }
    context.log().warn("tile fetch failed: {} ({} more failures not logged)", reason, suppressedWarnings);
    lastWarnTick = tick;
    suppressedWarnings = 0;
  }

  private static void answer(Pending entry, HttpReply reply) {
    for (ResponseHandle waiter : entry.waiters) {
      waiter.respond(reply);
    }
  }

  private static boolean isPng(Bytes body) {
    final int[] signature = {0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};
    if (body.size() < signature.length) {
      return false;
    }
    for (int i = 0; i < signature.length; i++) {
      if ((body.get(i) & 0xFF) != signature[i]) {
        return false;
      }
    }
    return true;
  }

  private static long ticks(Duration duration) {
    return duration.toMillis() / TICK.toMillis();
  }

  private static HttpReply tile(Bytes png) {
    return HttpReply.of(
        200,
        Headers.of("Content-Type", "image/png").with("Cache-Control", "public, max-age=3600").with("X-Content-Type-Options", "nosniff"),
        png);
  }

  private static HttpReply error(int status) {
    return HttpReply.of(status, Headers.of("Cache-Control", "no-store").with("X-Content-Type-Options", "nosniff"), Bytes.empty());
  }

  /** Too many tiles at once, or waited too long for a fetch slot: try again in a moment. */
  private static HttpReply busy() {
    return HttpReply.of(
        503, Headers.of("Cache-Control", "no-store").with("Retry-After", "1").with("X-Content-Type-Options", "nosniff"), Bytes.empty());
  }
}
