package dev.emcc.plugins.basemapwms;

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
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.WorkerContext;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * The plugin's one worker. It reads each server's capabilities (at start, after a settings change, every hour, after a
 * failed map call, and on request), works out which backgrounds are offered and in which projections, answers the lists
 * for the web part and the settings panel, and passes checked map requests on to the servers (ADR-0035).
 *
 * <p>No handler call ever waits for a server: every call goes through the SDK's outbound HTTP, which returns at once, and
 * its outcome arrives later as a message. The SDK allows 16 calls at a time; further map requests wait here, in order, up
 * to {@link #MAX_WAITING}, for at most {@link #QUEUE_WAIT} (ECore has answered {@code 504} by then). The state is touched
 * only by this worker, so it needs no locks.
 */
final class WmsService implements Handler<WmsMsg> {

  static final Duration TICK = Duration.ofMillis(500);
  /** A map request waits for a free call at most this long: the endpoint's timeout. */
  static final Duration QUEUE_WAIT = Duration.ofSeconds(30);
  static final int MAX_WAITING = 200;
  static final Duration READ_EVERY = Duration.ofHours(1);
  static final Duration RETRY_FIRST = Duration.ofMinutes(1);
  static final Duration RETRY_LAST = Duration.ofMinutes(15);
  /** After a failed map call the capabilities are read again at once, but not more often than this. */
  static final Duration REREAD_MIN = Duration.ofSeconds(10);
  static final Duration WARN_INTERVAL = Duration.ofSeconds(60);
  /** The layer list waits for a refresh at most this long: the longest server timeout plus a margin. */
  static final Duration LAYERS_TIMEOUT = Duration.ofSeconds(25);

  private static final long QUEUE_WAIT_TICKS = ticks(QUEUE_WAIT);
  private static final long READ_EVERY_TICKS = ticks(READ_EVERY);
  private static final long RETRY_FIRST_TICKS = ticks(RETRY_FIRST);
  private static final long RETRY_LAST_TICKS = ticks(RETRY_LAST);
  private static final long REREAD_MIN_TICKS = ticks(REREAD_MIN);
  private static final long WARN_TICKS = ticks(WARN_INTERVAL);

  /** A server and what is known about it from its capabilities. */
  private static final class ServerState {
    WmsSettings.Server server;
    final ServerProtocol protocol = ServerProtocol.forName("wms");
    /** The layers of the last successful read, kept after a later read failed. */
    @Nullable List<LayerInfo> layers;
    /** Whether the last read succeeded: only then are the server's backgrounds offered. */
    boolean ok;
    /** Why the last read failed, or {@code null}. */
    @Nullable String error;
    @Nullable Instant readAt;
    /** The read under way, or 0. */
    long currentReadId;
    long nextReadTick;
    int failures;
    long lastReadStartTick = Long.MIN_VALUE / 2;
    long lastWarnTick = Long.MIN_VALUE / 2;
    final List<ResponseHandle> refreshWaiters = new ArrayList<>();

    ServerState(WmsSettings.Server server, long nextReadTick) {
      this.server = server;
      this.nextReadTick = nextReadTick;
    }
  }

  /** A map request that passed its checks and waits for a free call. */
  private record WaitingMap(long callId, ResponseHandle response, String serverId, HttpCall call, Duration timeout, String format, long arrivedTick) {}

  /** A map request whose call is under way. */
  private record RunningMap(ResponseHandle response, String serverId, String format) {}

  private final OutboundHttp http;
  private final Status status;
  private WmsSettings settings = WmsSettings.empty();
  /** Why the latest settings were refused, or {@code null}. */
  private @Nullable String settingsRefused;
  private final Map<String, ServerState> servers = new LinkedHashMap<>();
  /** The offered backgrounds with their projections, in settings order. */
  private Map<String, List<String>> offered = new LinkedHashMap<>();
  /** Rises whenever {@link #offered} changes. */
  private long version = 1;
  private long tick;
  private int inFlight;
  private long lastReadId;
  private long lastCallId;
  /** The capabilities calls under way, by read id: each holds one of the SDK's call slots until its result arrives. */
  private final Map<Long, String> readsOut = new HashMap<>();
  private final ArrayDeque<WaitingMap> waiting = new ArrayDeque<>();
  private final Map<Long, RunningMap> running = new HashMap<>();

  /** @param current the settings in force when the handler is made (also after a restart of the worker) */
  WmsService(JsonObject current, OutboundHttp http, Status status) {
    this.http = http;
    this.status = status;
    try {
      apply(WmsSettings.parse(current));
    } catch (IllegalArgumentException e) {
      settingsRefused = e.getMessage();
    }
    recompute();
  }

  @Override
  public void handle(WmsMsg message, WorkerContext<WmsMsg> context) {
    switch (message) {
      case WmsMsg.MapGet get -> mapGet(get.request(), context);
      case WmsMsg.BackgroundsGet get -> backgroundsGet(get.request());
      case WmsMsg.LayersGet get -> layersGet(get.request(), context);
      case WmsMsg.SettingsChanged changed -> settingsChanged(changed.settings(), context);
      case WmsMsg.Start ignored -> startDueReads(context);
      case WmsMsg.Tick ignored -> tick(context);
      case WmsMsg.ReadDone done -> readDone(done.serverId(), done.readId(), done.result(), context);
      case WmsMsg.MapDone done -> mapDone(done.callId(), done.result(), context);
    }
  }

  // ---------------------------------------------------------------- settings

  private void settingsChanged(JsonObject raw, WorkerContext<WmsMsg> context) {
    WmsSettings next;
    try {
      next = WmsSettings.parse(raw);
    } catch (IllegalArgumentException e) {
      settingsRefused = e.getMessage();
      context.log().warn("setting change refused, the old values stay: {}", settingsRefused);
      recompute();
      return;
    }
    settingsRefused = null;
    apply(next);
    recompute();
    context.log().info("settings applied: {} servers, {} backgrounds", settings.servers().size(), settings.backgrounds().size());
    startDueReads(context);
  }

  /** Takes the settings; a server whose address, version and timeout are unchanged keeps what is known about it. */
  private void apply(WmsSettings next) {
    Map<String, ServerState> before = new HashMap<>(servers);
    servers.clear();
    for (WmsSettings.Server server : next.servers()) {
      ServerState old = before.remove(server.id());
      if (old != null && sameEndpoint(old.server, server)) {
        old.server = server;
        servers.put(server.id(), old);
      } else {
        ServerState created = new ServerState(server, tick);
        if (old != null) {
          created.refreshWaiters.addAll(old.refreshWaiters); // answered when the new server has been read
        }
        servers.put(server.id(), created);
      }
    }
    for (ServerState gone : before.values()) {
      for (ResponseHandle waiter : gone.refreshWaiters) {
        waiter.respond(error(404));
      }
    }
    settings = next;
  }

  private static boolean sameEndpoint(WmsSettings.Server a, WmsSettings.Server b) {
    return a.url().equals(b.url()) && a.version().equals(b.version()) && a.timeoutSeconds() == b.timeoutSeconds();
  }

  // ---------------------------------------------------------------- what is offered

  /** Works out the offered backgrounds from the settings and the reads, raises the version on a change, and sets the status. */
  private void recompute() {
    Map<String, List<String>> next = new LinkedHashMap<>();
    List<String> problems = new ArrayList<>();
    if (settingsRefused != null) {
      problems.add("setting change refused, the old values stay: " + settingsRefused);
    }
    problems.addAll(settings.problems());
    for (ServerState state : servers.values()) {
      if (state.error != null) {
        problems.add("server " + state.server.id() + ": " + state.error);
      }
    }
    for (WmsSettings.Background background : settings.backgrounds()) {
      ServerState state = servers.get(background.serverId());
      List<LayerInfo> layers = state == null ? null : state.layers;
      if (state == null || !state.ok || layers == null) {
        continue; // the server is not configured, not read yet or unreachable: named above
      }
      if (background.transparent() && !background.format().equals("image/png")) {
        problems.add("background " + background.id() + ": transparency needs image/png");
        continue;
      }
      Map<String, LayerInfo> byName = new HashMap<>();
      for (LayerInfo layer : layers) {
        byName.putIfAbsent(layer.name(), layer);
      }
      List<String> missing = new ArrayList<>();
      List<String> common = null;
      for (String name : background.layers()) {
        LayerInfo layer = byName.get(name);
        if (layer == null) {
          missing.add(name);
        } else if (common == null) {
          common = new ArrayList<>(layer.projections());
        } else {
          common.retainAll(layer.projections());
        }
      }
      if (!missing.isEmpty()) {
        problems.add("background " + background.id() + ": the server " + background.serverId() + " has no layer " + String.join(", ", missing));
      } else if (common == null || common.isEmpty()) {
        problems.add("background " + background.id() + ": its layers share no projection");
      } else {
        next.put(background.id(), List.copyOf(common));
      }
    }
    if (!next.equals(offered)) {
      offered = next;
      version++;
    }
    if (problems.isEmpty()) {
      status.set(PluginState.OK, offered.size() + " of " + settings.backgrounds().size() + " backgrounds offered");
    } else {
      String all = String.join("; ", problems);
      status.set(PluginState.DEGRADED, all.length() <= 500 ? all : all.substring(0, 500) + "...");
    }
  }

  // ---------------------------------------------------------------- capabilities reads

  private void tick(WorkerContext<WmsMsg> context) {
    tick++;
    Iterator<WaitingMap> it = waiting.iterator();
    while (it.hasNext()) {
      if (tick - it.next().arrivedTick() >= QUEUE_WAIT_TICKS) {
        it.remove(); // ECore has answered 504 by now: no call
      }
    }
    startDueReads(context);
    pumpMaps(context);
  }

  private void startDueReads(WorkerContext<WmsMsg> context) {
    for (ServerState state : servers.values()) {
      if (inFlight >= OutboundHttp.MAX_CONCURRENT_CALLS) {
        return;
      }
      if (state.currentReadId == 0 && tick >= state.nextReadTick) {
        startRead(state, context);
      }
    }
  }

  private void startRead(ServerState state, WorkerContext<WmsMsg> context) {
    long readId = ++lastReadId;
    String serverId = state.server.id();
    state.currentReadId = readId;
    state.lastReadStartTick = tick;
    readsOut.put(readId, serverId);
    inFlight++;
    http.send(
        state.protocol.capabilitiesCall(state.server),
        Duration.ofSeconds(state.server.timeoutSeconds()),
        context.self(),
        result -> new WmsMsg.ReadDone(serverId, readId, result));
  }

  private void readDone(String serverId, long readId, HttpResult result, WorkerContext<WmsMsg> context) {
    if (readsOut.remove(readId) == null) {
      return; // an answer to a call an earlier instance of this worker started
    }
    inFlight--;
    ServerState state = servers.get(serverId);
    if (state != null && state.currentReadId == readId) {
      state.currentReadId = 0;
      finishRead(state, result, context);
      recompute();
    }
    startDueReads(context);
    pumpMaps(context);
  }

  private void finishRead(ServerState state, HttpResult result, WorkerContext<WmsMsg> context) {
    String problem = null;
    List<LayerInfo> parsed = null;
    switch (result) {
      case HttpResult.Response r when r.status() == 200 -> {
        try {
          parsed = state.protocol.readCapabilities(r.body());
        } catch (CapabilitiesParser.Unreadable e) {
          problem = e.getMessage();
        }
      }
      case HttpResult.Response r -> problem = "the server answered HTTP " + r.status();
      case HttpResult.Failed f -> problem = f.reason().contains("redirect")
          ? "the server redirects; enter the address it redirects to (" + f.reason() + ")"
          : "the server cannot be reached: " + f.reason();
      case HttpResult.TimedOut t -> problem = "no answer within " + state.server.timeoutSeconds() + " s";
    }
    if (problem == null && parsed != null) {
      boolean back = !state.ok && state.failures > 0;
      state.layers = parsed;
      state.ok = true;
      state.error = null;
      state.readAt = Instant.now();
      state.failures = 0;
      state.nextReadTick = tick + READ_EVERY_TICKS;
      if (back) {
        context.log().info("server {} can be read again", state.server.id());
      }
    } else {
      state.ok = false;
      state.error = problem;
      state.readAt = Instant.now();
      state.failures++;
      long backoff = Math.min(RETRY_LAST_TICKS, RETRY_FIRST_TICKS << Math.min(state.failures - 1, 10));
      state.nextReadTick = tick + backoff;
      warn(state, "capabilities of server " + state.server.id() + " cannot be used: " + problem, context);
    }
    for (ResponseHandle waiter : state.refreshWaiters) {
      waiter.respond(layersReply(state));
    }
    state.refreshWaiters.clear();
  }

  /** At most one warning per {@link #WARN_INTERVAL} per server. */
  private void warn(ServerState state, String message, WorkerContext<WmsMsg> context) {
    if (tick - state.lastWarnTick >= WARN_TICKS) {
      state.lastWarnTick = tick;
      context.log().warn("{}", message);
    }
  }

  /** A map call failed in a way that says the server may be down: read its capabilities soon, to learn it. */
  private void rereadSoon(ServerState state) {
    if (state.ok && state.currentReadId == 0 && tick - state.lastReadStartTick >= REREAD_MIN_TICKS) {
      state.nextReadTick = tick;
    }
  }

  // ---------------------------------------------------------------- the lists

  private void backgroundsGet(EndpointRequest request) {
    List<JsonValue> items = new ArrayList<>();
    for (Map.Entry<String, List<String>> e : offered.entrySet()) {
      List<JsonValue> codes = new ArrayList<>();
      for (String code : e.getValue()) {
        codes.add(JsonString.of(code));
      }
      items.add(JsonObject.builder().put("id", JsonString.of(e.getKey())).put("projections", new JsonArray(codes)).build());
    }
    boolean reading = servers.values().stream().anyMatch(s -> s.currentReadId != 0);
    request.response().respond(json(200, JsonObject.builder()
        .put("backgrounds", new JsonArray(items))
        .put("reading", JsonBoolean.of(reading))
        .put("version", JsonNumber.of(version))
        .build()));
  }

  private void layersGet(EndpointRequest request, WorkerContext<WmsMsg> context) {
    ServerState state = servers.get(request.pathParameter("server"));
    if (state == null) {
      request.response().respond(error(404));
      return;
    }
    if (!"true".equals(request.queryParameter("refresh"))) {
      request.response().respond(layersReply(state));
      return;
    }
    state.refreshWaiters.add(request.response());
    if (state.currentReadId == 0) {
      startRead(state, context);
    }
  }

  private static HttpReply layersReply(ServerState state) {
    List<JsonValue> items = new ArrayList<>();
    List<LayerInfo> layers = state.layers;
    if (layers != null) {
      for (LayerInfo layer : layers) {
        List<JsonValue> codes = new ArrayList<>();
        for (String code : layer.projections()) {
          codes.add(JsonString.of(code));
        }
        items.add(JsonObject.builder()
            .put("name", JsonString.of(layer.name()))
            .put("title", JsonString.of(layer.title()))
            .put("projections", new JsonArray(codes))
            .build());
      }
    }
    Instant readAt = state.readAt;
    String problem = state.error;
    return json(200, JsonObject.builder()
        .put("server", JsonString.of(state.server.id()))
        .put("layers", new JsonArray(items))
        .put("readAt", readAt == null ? dev.emcc.sdk.json.JsonNull.INSTANCE : JsonString.of(readAt.toString()))
        .put("error", problem == null ? dev.emcc.sdk.json.JsonNull.INSTANCE : JsonString.of(problem))
        .put("reading", JsonBoolean.of(state.currentReadId != 0))
        .build());
  }

  // ---------------------------------------------------------------- maps

  private void mapGet(EndpointRequest request, WorkerContext<WmsMsg> context) {
    ResponseHandle response = request.response();
    String id = request.pathParameter("background");
    WmsSettings.Background background = settings.backgrounds().stream().filter(b -> b.id().equals(id)).findFirst().orElse(null);
    List<String> projections = offered.get(id);
    ServerState state = background == null ? null : servers.get(background.serverId());
    if (background == null || projections == null || state == null) {
      response.respond(error(400));
      return;
    }
    HttpCall call;
    try {
      call = state.protocol.mapCall(state.server, background, projections, request.query());
    } catch (ServerProtocol.BadMapRequest e) {
      context.log().debug("map request for {} refused: {}", id, e.getMessage());
      response.respond(error(400));
      return;
    }
    if (waiting.isEmpty() && inFlight < OutboundHttp.MAX_CONCURRENT_CALLS) {
      startMap(new WaitingMap(++lastCallId, response, state.server.id(), call, Duration.ofSeconds(state.server.timeoutSeconds()), background.format(), tick), context);
    } else if (waiting.size() >= MAX_WAITING) {
      response.respond(busy());
    } else {
      waiting.add(new WaitingMap(++lastCallId, response, state.server.id(), call, Duration.ofSeconds(state.server.timeoutSeconds()), background.format(), tick));
    }
  }

  private void pumpMaps(WorkerContext<WmsMsg> context) {
    while (inFlight < OutboundHttp.MAX_CONCURRENT_CALLS && !waiting.isEmpty()) {
      startMap(waiting.poll(), context);
    }
  }

  private void startMap(WaitingMap map, WorkerContext<WmsMsg> context) {
    running.put(map.callId(), new RunningMap(map.response(), map.serverId(), map.format()));
    inFlight++;
    long callId = map.callId();
    http.send(map.call(), map.timeout(), context.self(), result -> new WmsMsg.MapDone(callId, result));
  }

  private void mapDone(long callId, HttpResult result, WorkerContext<WmsMsg> context) {
    RunningMap map = running.remove(callId);
    if (map == null) {
      return;
    }
    inFlight--;
    ServerState state = servers.get(map.serverId());
    switch (result) {
      case HttpResult.Response r when r.status() == 200 && mediaType(r.headers()).equalsIgnoreCase(map.format()) -> map.response().respond(image(map.format(), r.body()));
      case HttpResult.Response r -> {
        // Also a service exception: an XML answer, even with status 200.
        if (state != null) {
          warn(state, "server " + map.serverId() + " gave no image: HTTP " + r.status() + ", " + mediaType(r.headers()), context);
          if (r.status() >= 500) {
            rereadSoon(state);
          }
        }
        map.response().respond(error(502));
      }
      case HttpResult.Failed f -> {
        if (state != null) {
          warn(state, "map call to server " + map.serverId() + " failed: " + f.reason(), context);
          rereadSoon(state);
        }
        map.response().respond(error(502));
      }
      case HttpResult.TimedOut t -> {
        if (state != null) {
          warn(state, "map call to server " + map.serverId() + " timed out", context);
          rereadSoon(state);
        }
        map.response().respond(error(502));
      }
    }
    startDueReads(context);
    pumpMaps(context);
  }

  private static String mediaType(Headers headers) {
    String type = headers.first("Content-Type");
    if (type == null) {
      return "";
    }
    int semicolon = type.indexOf(';');
    return (semicolon < 0 ? type : type.substring(0, semicolon)).strip();
  }

  // ---------------------------------------------------------------- replies

  private static HttpReply image(String format, Bytes body) {
    return HttpReply.of(
        200,
        Headers.of("Content-Type", format).with("Cache-Control", "private, max-age=3600").with("X-Content-Type-Options", "nosniff"),
        body);
  }

  private static HttpReply json(int status, JsonValue body) {
    HttpReply reply = HttpReply.json(status, body);
    return new HttpReply(reply.status(), reply.headers().with("Cache-Control", "no-store"), reply.body());
  }

  private static HttpReply error(int status) {
    return HttpReply.of(status, Headers.of("Cache-Control", "no-store").with("X-Content-Type-Options", "nosniff"), Bytes.empty());
  }

  /** Too many map requests waiting: try again in a moment. */
  private static HttpReply busy() {
    return HttpReply.of(503, Headers.of("Cache-Control", "no-store").with("Retry-After", "1").with("X-Content-Type-Options", "nosniff"), Bytes.empty());
  }

  private static long ticks(Duration duration) {
    return duration.toMillis() / TICK.toMillis();
  }
}
