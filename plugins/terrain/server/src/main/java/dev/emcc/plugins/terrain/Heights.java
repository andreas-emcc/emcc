package dev.emcc.plugins.terrain;

import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.folder.FolderResult;
import dev.emcc.sdk.folder.LocalFolder;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.http.ResponseHandle;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.Reply;
import dev.emcc.sdk.worker.WorkerContext;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * The {@code heights} worker: it owns the index of cells, the cache of parsed cells, the queue of
 * folder calls and who is computing (brief, "Server part"). The line of sight itself runs on the
 * compute workers.
 *
 * <p><b>The folder, with the ACA's R2:</b> the worker queues its own calls so that at most {@link
 * LocalFolder#MAX_CONCURRENT_CALLS} are in progress; a call answered {@code BUSY} goes back to the
 * front of the queue and waits for one of the calls in progress to finish, never retried in a loop.
 * It never opens a file: every byte comes from {@link LocalFolder}.
 *
 * <p><b>The index</b> is made at start and again when the folder setting changes (A5): the folder's
 * listing, its {@code e…}/{@code w…} subfolders' listings, and the first 3 428 bytes of each cell
 * (the headers, checked against the name). A cell is read whole when a viewshed needs it.
 */
final class Heights implements Handler<HeightsMsg> {

  private static final Duration LIST_TIMEOUT = Duration.ofSeconds(15);
  private static final Duration HEADER_TIMEOUT = Duration.ofSeconds(15);
  private static final Duration CELL_TIMEOUT = Duration.ofSeconds(60);
  private static final Duration RETRY_DELAY = Duration.ofMillis(100);
  private static final Duration RETRY_DELAY_MAX = Duration.ofSeconds(5);

  /** Where the height data stands. */
  enum State {
    BUILDING,
    READY,
    NOT_SET,
    NOT_READABLE,
    /** ECore does not provide local folders yet (SDK 1.4.0 part 6). */
    NO_FOLDERS
  }

  private enum Phase {
    WAITING_FOR_INDEX,
    LOADING,
    COMPUTING
  }

  /** One viewshed request from the endpoint to its answer; owned by this worker alone. */
  private static final class Pending {
    final long id;
    final String user;
    final ResponseHandle response;
    final Planner.Request request;
    final long startedNanos;
    /** A height map (function 10), else a viewshed. */
    final boolean heightMap;
    final Map<Long, DtedCell> loaded = new HashMap<>();
    final Set<Long> missing = new HashSet<>();
    Phase phase = Phase.WAITING_FOR_INDEX;
    Planner.@Nullable Plan plan;
    @Nullable Cancellable timer;
    int unreadable;

    Pending(long id, String user, ResponseHandle response, Planner.Request request, long startedNanos, boolean heightMap) {
      this.id = id;
      this.user = user;
      this.response = response;
      this.request = request;
      this.startedNanos = startedNanos;
      this.heightMap = heightMap;
    }

    /** What the request is, for the words of an answer. */
    String subject() {
      return heightMap ? "height map" : "viewshed";
    }
  }

  private final PluginContext plugin;
  private final @Nullable LocalFolder folder;
  private final List<WorkerRef<ComputeMsg>> computers;
  private final int[] computing;
  private final Map<Long, Integer> computingOn = new HashMap<>();

  private Limits limits;
  private CellCache cache;
  private Index index = new Index();
  private State state = State.BUILDING;
  private String stateReason = "";
  private long generation;
  private final Deque<Work> queue = new ArrayDeque<>();
  private final Set<Long> found = new HashSet<>();
  private int inFlight;
  private int inFlightCurrent;
  private boolean busyWait;
  private Duration retryDelay = RETRY_DELAY;
  private final Set<Long> loading = new HashSet<>();
  private final Map<Long, List<Long>> waiters = new HashMap<>();
  private final Map<Long, Pending> pendings = new LinkedHashMap<>();
  private final Map<String, Long> running = new HashMap<>();
  private long nextRequest = 1;

  Heights(PluginContext plugin, @Nullable LocalFolder folder, List<WorkerRef<ComputeMsg>> computers) {
    this.plugin = plugin;
    this.folder = folder;
    this.computers = List.copyOf(computers);
    this.computing = new int[computers.size()];
    this.limits = Limits.read(plugin.settings());
    this.cache = new CellCache(limits.cacheBytes());
  }

  @Override
  public void handle(HeightsMsg message, WorkerContext<HeightsMsg> context) {
    switch (message) {
      case HeightsMsg.Begin begin -> {
        limits = Limits.read(plugin.settings());
        cache.setLimit(limits.cacheBytes());
        rebuild(context);
      }
      case HeightsMsg.SettingsChanged changed -> settingsChanged(Limits.read(changed.settings()), context);
      case HeightsMsg.FolderDone done -> folderDone(done, context);
      case HeightsMsg.RetryPump retry -> {
        if (retry.generation() == generation && busyWait) {
          busyWait = false;
          pump(context);
        }
      }
      case HeightsMsg.Viewshed viewshed -> viewshed(viewshed.request(), context);
      case HeightsMsg.HeightMap heightMap -> heightMap(heightMap.request(), context);
      case HeightsMsg.Status status -> status.request().response().respond(HttpReply.json(200, statusJson()));
      case HeightsMsg.ComputeReply reply -> computeReply(reply, context);
      case HeightsMsg.MapReply reply -> mapReply(reply, context);
      case HeightsMsg.RequestTimeout timeout -> requestTimeout(timeout.requestId());
    }
  }

  // ---------------------------------------------------------------- settings and the index

  private void settingsChanged(Limits next, WorkerContext<HeightsMsg> context) {
    boolean folderChanged = !next.folder().equals(limits.folder());
    limits = next;
    cache.setLimit(next.cacheBytes());
    if (folderChanged) {
      rebuild(context);
    }
  }

  /** Starts a new index: the folder's listing first. Answers to calls of an older index are ignored. */
  private void rebuild(WorkerContext<HeightsMsg> context) {
    generation++;
    queue.clear();
    found.clear();
    busyWait = false;
    inFlightCurrent = 0;
    loading.clear();
    waiters.clear();
    index = new Index();
    cache.clear();
    for (Pending p : pendings.values()) {
      if (p.phase != Phase.COMPUTING) {
        p.phase = Phase.WAITING_FOR_INDEX;
        p.loaded.clear();
        p.missing.clear();
        p.plan = null;
      }
    }
    stateReason = "";
    if (folder == null) {
      setState(State.NO_FOLDERS, "ECore does not provide local folders", context);
      return;
    }
    state = State.BUILDING;
    updateStatus();
    queue.add(Work.list("", LIST_TIMEOUT));
    pump(context);
  }

  private void setState(State next, String reason, WorkerContext<HeightsMsg> context) {
    state = next;
    stateReason = reason;
    updateStatus();
    if (next == State.READY) {
      for (Pending p : List.copyOf(pendings.values())) {
        if (p.phase == Phase.WAITING_FOR_INDEX) {
          plan(p, context);
        }
      }
    } else if (next != State.BUILDING) {
      for (Pending p : List.copyOf(pendings.values())) {
        if (p.phase != Phase.COMPUTING) {
          fail(p, 503, unavailable());
        }
      }
    }
  }

  private String unavailable() {
    return switch (state) {
      case NOT_SET -> "the height folder is not set";
      case NOT_READABLE -> "the height folder is not readable" + (stateReason.isBlank() ? "" : ": " + stateReason);
      case NO_FOLDERS -> "this server cannot read local folders yet";
      default -> "the height data is not ready";
    };
  }

  private void updateStatus() {
    switch (state) {
      case BUILDING -> plugin.status().set(PluginState.OK, "Height data: indexing");
      case NOT_SET -> plugin.status().set(PluginState.OK, "Height folder not set");
      case NOT_READABLE -> plugin.status().set(PluginState.DEGRADED, "Height folder not readable" + (stateReason.isBlank() ? "" : ": " + stateReason));
      case NO_FOLDERS -> plugin.status().set(PluginState.DEGRADED, "Height folder not readable: ECore does not provide local folders yet");
      case READY -> {
        String skipped = index.skipped() == 0 ? "" : "; " + index.skipped() + " files skipped, see the log";
        // A readable folder with no cells is OK (owner, SC A, 2026-11-12): the release ships an empty one.
        // Only a folder that is not set or not readable is an error.
        plugin.status().set(
            PluginState.OK,
            "Height data: " + index.total() + " cells (level 2: " + index.count(2) + ", level 1: " + index.count(1) + ", level 0: " + index.count(0) + ")" + skipped);
      }
    }
  }

  // ---------------------------------------------------------------- the queue of folder calls

  private void pump(WorkerContext<HeightsMsg> context) {
    while (!busyWait && inFlight < LocalFolder.MAX_CONCURRENT_CALLS && !queue.isEmpty()) {
      issue(queue.poll(), context);
    }
  }

  private void issue(Work work, WorkerContext<HeightsMsg> context) {
    LocalFolder f = folder;
    if (f == null) {
      return;
    }
    inFlight++;
    inFlightCurrent++;
    long made = generation;
    Function<FolderResult, HeightsMsg> toMessage = result -> new HeightsMsg.FolderDone(made, work, result);
    switch (work.kind()) {
      case LIST -> f.list(work.path(), work.timeout(), context.self(), toMessage);
      case HEADER -> f.read(work.path(), 0, DtedCell.HEADER_BYTES, work.timeout(), context.self(), toMessage);
      case CELL -> f.read(work.path(), 0, (int) work.size(), work.timeout(), context.self(), toMessage);
    }
  }

  private void folderDone(HeightsMsg.FolderDone done, WorkerContext<HeightsMsg> context) {
    inFlight--;
    boolean current = done.generation() == generation;
    if (current) {
      inFlightCurrent--;
    }
    FolderResult result = done.result();
    if (result instanceof FolderResult.Failed failed && failed.reason() == FolderResult.Reason.BUSY) {
      // never made: it goes back to the front and waits for a call in progress to finish
      if (current) {
        queue.addFirst(done.work());
        busyWait = true;
        if (inFlight == 0) {
          // nothing of ours is in progress that could free a place: one timer, backing off, never a loop of calls
          plugin.timers().once(retryDelay, context.self(), new HeightsMsg.RetryPump(generation));
          retryDelay = retryDelay.multipliedBy(2).compareTo(RETRY_DELAY_MAX) > 0 ? RETRY_DELAY_MAX : retryDelay.multipliedBy(2);
        }
      }
      return;
    }
    busyWait = false;
    retryDelay = RETRY_DELAY;
    if (current) {
      switch (done.work().kind()) {
        case LIST -> listed(done.work(), result, context);
        case HEADER -> headerRead(done.work(), result, context);
        case CELL -> cellRead(done.work(), result, context);
      }
    }
    pump(context);
    if (current && state == State.BUILDING && queue.isEmpty() && inFlightCurrent == 0) {
      setState(State.READY, "", context);
    }
  }

  private void listed(Work work, FolderResult result, WorkerContext<HeightsMsg> context) {
    boolean root = work.path().isEmpty();
    switch (result) {
      case FolderResult.Listing listing -> {
        for (FolderResult.Entry entry : listing.entries()) {
          if (root) {
            if (entry.directory() && CellId.isLongitudeDirectory(entry.name())) {
              queue.add(Work.list(entry.name(), LIST_TIMEOUT));
            }
          } else if (!entry.directory()) {
            CellId id = CellId.parse(work.path(), entry.name());
            if (id == null) {
              continue;
            }
            if (!found.add(id.key())) {
              plugin.log().warn("skipped {}/{}: the cell {} is there twice, under names that differ in case only", work.path(), entry.name(), id.displayName());
              index.skip();
              continue;
            }
            queue.add(Work.header(work.path() + "/" + entry.name(), id, HEADER_TIMEOUT));
          }
        }
      }
      case FolderResult.Failed failed -> {
        if (root) {
          plugin.log().warn("the height folder cannot be listed: {} ({})", failed.reason(), failed.message());
          queue.clear();
          // ECore words the reason (for a folder setting under %emcc%/ that leaves the emcc folder: "outside the emcc folder"); the status and the 503 pass it on
          setState(failed.reason() == FolderResult.Reason.NOT_SET ? State.NOT_SET : State.NOT_READABLE, failed.message(), context);
        } else {
          plugin.log().warn("the folder {} cannot be listed: {} ({})", work.path(), failed.reason(), failed.message());
          index.skip();
        }
      }
      case FolderResult.Read read -> plugin.log().warn("a listing of {} was answered with a read", read.path());
    }
  }

  private void headerRead(Work work, FolderResult result, WorkerContext<HeightsMsg> context) {
    CellId id = work.cell();
    if (id == null) {
      return;
    }
    switch (result) {
      case FolderResult.Read read -> {
        try {
          index.put(DtedCell.parseHeader(id, read.data(), read.fileSize()), work.path());
        } catch (DtedException e) {
          plugin.log().warn("skipped {}: {}", work.path(), e.getMessage());
          index.skip();
        }
      }
      case FolderResult.Failed failed -> {
        plugin.log().warn("skipped {}: {} ({})", work.path(), failed.reason(), failed.message());
        index.skip();
      }
      case FolderResult.Listing listing -> plugin.log().warn("a read of {} was answered with a listing", listing.path());
    }
  }

  private void cellRead(Work work, FolderResult result, WorkerContext<HeightsMsg> context) {
    CellId id = work.cell();
    if (id == null) {
      return;
    }
    long key = id.key();
    loading.remove(key);
    DtedCell cell = null;
    switch (result) {
      case FolderResult.Read read -> {
        if (read.data().size() != work.size()) {
          plugin.log().warn("{} was read short: {} of {} bytes", work.path(), read.data().size(), work.size());
        } else {
          try {
            cell = DtedCell.parse(id, read.data());
            cache.put(cell);
          } catch (DtedException e) {
            plugin.log().warn("skipped {}: {}", work.path(), e.getMessage());
            index.remove(id);
            index.skip();
            updateStatus();
          }
        }
      }
      case FolderResult.Failed failed -> plugin.log().warn("{} cannot be read: {} ({})", work.path(), failed.reason(), failed.message());
      case FolderResult.Listing listing -> plugin.log().warn("a read of {} was answered with a listing", listing.path());
    }
    List<Long> waiting = waiters.remove(key);
    if (waiting == null) {
      return;
    }
    for (long requestId : waiting) {
      Pending p = pendings.get(requestId);
      if (p == null || p.phase != Phase.LOADING) {
        continue;
      }
      p.missing.remove(key);
      if (cell != null) {
        p.loaded.put(key, cell);
      } else {
        p.unreadable++;
      }
      if (p.missing.isEmpty()) {
        dispatch(p, context);
      }
    }
  }

  // ---------------------------------------------------------------- viewsheds

  private void viewshed(EndpointRequest request, WorkerContext<HeightsMsg> context) {
    ResponseHandle response = request.response();
    Planner.Request wanted;
    try {
      JsonObject body = Bodies.object(request);
      double[] observer = Bodies.position(body, "observer");
      double observerHeight = Bodies.number(body, "observerHeight", 0, 1000, "m");
      double targetHeight = Bodies.number(body, "targetHeight", 0, 1000, "m");
      double range = Bodies.number(body, "maxRange", 100, limits.maxRange(), "m");
      if (Math.abs(observer[1]) + range / 110_574.0 > 89.5) {
        throw new BadRequest("a viewshed stays at least half a degree from a pole: the observer's latitude and the range reach " + Bodies.plain(Math.abs(observer[1]) + range / 110_574.0) + " degrees");
      }
      wanted = new Planner.Request(observer[0], observer[1], observerHeight, targetHeight, range);
    } catch (BadRequest e) {
      response.respond(Bodies.error(400, e.getMessage()));
      return;
    }
    admit(request, wanted, false, context);
  }

  /** {@code POST /heightmap} (function 10): checked as a viewshed is, then planned and computed the same way. */
  private void heightMap(EndpointRequest request, WorkerContext<HeightsMsg> context) {
    Planner.Request wanted;
    try {
      JsonObject body = Bodies.object(request);
      double[] centre = Bodies.position(body, "center");
      double radius = Bodies.number(body, "radius", 100, limits.maxRange(), "m");
      if (Math.abs(centre[1]) + radius / 110_574.0 > 89.5) {
        throw new BadRequest("a height map stays at least half a degree from a pole: the centre's latitude and the radius reach " + Bodies.plain(Math.abs(centre[1]) + radius / 110_574.0) + " degrees");
      }
      wanted = new Planner.Request(centre[0], centre[1], 0, 0, radius);
    } catch (BadRequest e) {
      request.response().respond(Bodies.error(400, e.getMessage()));
      return;
    }
    admit(request, wanted, true, context);
  }

  /** One viewshed or height map per user at a time (ADR-0049 point 7); then the request waits for the index, or is planned. */
  private void admit(EndpointRequest request, Planner.Request wanted, boolean heightMap, WorkerContext<HeightsMsg> context) {
    ResponseHandle response = request.response();
    String user = request.user().id();
    Long runningId = running.get(user);
    if (runningId != null) {
      Pending other = pendings.get(runningId);
      response.respond(Bodies.error(409, "a " + (other != null ? other.subject() : "viewshed") + " is already running for you"));
      return;
    }
    if (state == State.NOT_SET || state == State.NOT_READABLE || state == State.NO_FOLDERS) {
      response.respond(Bodies.error(503, unavailable()));
      return;
    }
    long id = nextRequest++;
    Pending p = new Pending(id, user, response, wanted, System.nanoTime(), heightMap);
    pendings.put(id, p);
    running.put(user, id);
    p.timer = plugin.timers().once(Duration.ofSeconds(limits.timeoutSeconds()), context.self(), new HeightsMsg.RequestTimeout(id));
    if (state == State.READY) {
      plan(p, context);
    }
  }

  private void plan(Pending p, WorkerContext<HeightsMsg> context) {
    switch (Planner.plan(index, p.request, limits, p.heightMap ? Planner.Subject.HEIGHT_MAP : Planner.Subject.VIEWSHED)) {
      case Planner.Refused refused -> fail(p, refused.status(), refused.message());
      case Planner.Planned planned -> {
        p.plan = planned.plan();
        p.phase = Phase.LOADING;
        for (CellId id : planned.plan().needed()) {
          long key = id.key();
          DtedCell cached = cache.get(key);
          if (cached != null) {
            p.loaded.put(key, cached);
            continue;
          }
          p.missing.add(key);
          waiters.computeIfAbsent(key, k -> new ArrayList<>()).add(p.id);
          if (loading.add(key)) {
            queue.add(Work.cell(index.path(id), id, index.header(id).expectedSize(), CELL_TIMEOUT));
          }
        }
        pump(context);
        if (p.missing.isEmpty()) {
          dispatch(p, context);
        }
      }
    }
  }

  private void dispatch(Pending p, WorkerContext<HeightsMsg> context) {
    Planner.Plan plan = p.plan;
    if (plan == null || p.loaded.isEmpty()) {
      fail(p, 503, "none of the height cells could be read");
      return;
    }
    long remaining = Duration.ofSeconds(limits.timeoutSeconds()).toNanos() - (System.nanoTime() - p.startedNanos);
    long budget = Math.max(1_000_000_000L, Math.min(remaining, Viewshed.MAX_COMPUTE_NANOS));
    ViewshedJob job = new ViewshedJob(plan.params(), List.copyOf(p.loaded.values()), budget);
    int best = 0;
    for (int c = 1; c < computing.length; c++) {
      if (computing[c] < computing[best]) {
        best = c;
      }
    }
    computing[best]++;
    computingOn.put(p.id, best);
    p.phase = Phase.COMPUTING;
    long id = p.id;
    if (p.heightMap) {
      context.<ComputeMsg, MapComputed>ask(computers.get(best), replyTo -> new ComputeMsg.RunMap(id, job, replyTo), Duration.ofMinutes(5), reply -> new HeightsMsg.MapReply(id, reply));
    } else {
      context.<ComputeMsg, Computed>ask(computers.get(best), replyTo -> new ComputeMsg.Run(id, job, replyTo), Duration.ofMinutes(5), reply -> new HeightsMsg.ComputeReply(id, reply));
    }
  }

  private void mapReply(HeightsMsg.MapReply reply, WorkerContext<HeightsMsg> context) {
    Integer on = computingOn.remove(reply.requestId());
    if (on != null) {
      computing[on]--;
    }
    Pending p = pendings.get(reply.requestId());
    if (p == null) {
      return; // timed out already
    }
    switch (reply.reply()) {
      case Reply.Ok<MapComputed> ok -> {
        MapComputed c = ok.value();
        switch (c.outcome()) {
          case DONE -> answerMap(p, c);
          case TIMED_OUT -> fail(p, 503, "the height map took longer than " + limits.timeoutSeconds() + " seconds");
          case NO_DATA -> fail(p, 404, "there is no height data inside the circle");
        }
      }
      case Reply.Failed<MapComputed> failed -> fail(p, 503, "the height map could not be computed: " + failed.reason());
      case Reply.TimedOut<MapComputed> timedOut -> fail(p, 503, "the height map was not answered in time");
    }
  }

  /**
   * The answer of a height map: the bands from the lowest, each with its index and its lowest and
   * highest height (the span divided evenly), the highest point, the lowest height, and what a viewshed's answer has.
   */
  private void answerMap(Pending p, MapComputed c) {
    Planner.Plan plan = p.plan;
    if (plan == null) {
      fail(p, 503, "the height map has no plan");
      return;
    }
    List<JsonValue> notes = new ArrayList<>();
    for (String note : plan.notes()) {
      notes.add(JsonString.of(note));
    }
    if (c.simplified() > 0) {
      notes.add(JsonString.of("The bands were simplified to " + (1 << c.simplified()) + " cells to fit the map's limits."));
    }
    if (c.leftOut() > 0) {
      notes.add(JsonString.of(c.leftOut() + " of the smallest areas were left out to fit the map's limits."));
    }
    if (p.unreadable > 0) {
      notes.add(JsonString.of(p.unreadable + " height cells could not be read."));
    }
    int count = c.bands().size();
    double span = c.highest() - c.lowest();
    List<JsonValue> bands = new ArrayList<>(count);
    for (int b = 0; b < count; b++) {
      Map<String, JsonValue> band = new LinkedHashMap<>();
      band.put("index", JsonNumber.of(b));
      band.put("lowest", JsonNumber.of(round(c.lowest() + span * b / count)));
      band.put("highest", JsonNumber.of(round(b == count - 1 ? c.highest() : c.lowest() + span * (b + 1) / count)));
      band.put("areas", c.bands().get(b));
      bands.add(JsonObject.of(band));
    }
    Map<String, JsonValue> highest = new LinkedHashMap<>();
    highest.put("position", c.highestPosition());
    highest.put("height", JsonNumber.of(round(c.highest())));
    long millis = (System.nanoTime() - p.startedNanos) / 1_000_000;
    Map<String, JsonValue> members = new LinkedHashMap<>();
    members.put("bands", new JsonArray(bands));
    members.put("highest", JsonObject.of(highest));
    members.put("lowest", JsonNumber.of(round(c.lowest())));
    members.put("level", JsonNumber.of(plan.level()));
    members.put("cells", JsonNumber.of(p.loaded.size()));
    members.put("heightCells", JsonNumber.of(plan.nodes()));
    members.put("simplified", JsonNumber.of(c.simplified()));
    members.put("leftOut", JsonNumber.of(c.leftOut()));
    members.put("positions", JsonNumber.of(c.positions()));
    members.put("partlyWithoutData", JsonBoolean.of(c.partlyWithoutData() || p.unreadable > 0));
    members.put("millis", JsonNumber.of(millis));
    members.put("notes", new JsonArray(notes));
    finish(p);
    p.response.respond(HttpReply.json(200, JsonObject.of(members)));
  }

  /** A height in metres to a millimetre: bilinear heights between samples are not whole, and the answer need not say 412.0000001. */
  private static double round(double metres) {
    return Math.rint(metres * 1000) / 1000;
  }

  private void computeReply(HeightsMsg.ComputeReply reply, WorkerContext<HeightsMsg> context) {
    Integer on = computingOn.remove(reply.requestId());
    if (on != null) {
      computing[on]--;
    }
    Pending p = pendings.get(reply.requestId());
    if (p == null) {
      return; // timed out already
    }
    switch (reply.reply()) {
      case Reply.Ok<Computed> ok -> {
        Computed c = ok.value();
        switch (c.outcome()) {
          case DONE -> answer(p, c);
          case TIMED_OUT -> fail(p, 503, "the viewshed took longer than " + limits.timeoutSeconds() + " seconds");
          case NO_OBSERVER_DATA -> fail(p, 404, "there is no height data at the observer's point");
        }
      }
      case Reply.Failed<Computed> failed -> fail(p, 503, "the viewshed could not be computed: " + failed.reason());
      case Reply.TimedOut<Computed> timedOut -> fail(p, 503, "the viewshed was not answered in time");
    }
  }

  private void answer(Pending p, Computed c) {
    Planner.Plan plan = p.plan;
    if (plan == null) {
      fail(p, 503, "the viewshed has no plan");
      return;
    }
    List<JsonValue> notes = new ArrayList<>();
    for (String note : plan.notes()) {
      notes.add(JsonString.of(note));
    }
    if (c.simplified() > 0) {
      notes.add(JsonString.of("The areas were simplified to " + (1 << c.simplified()) + " cells to fit the map's limits."));
    }
    if (c.leftOut() > 0) {
      notes.add(JsonString.of(c.leftOut() + " of the smallest areas were left out to fit the map's limits."));
    }
    if (p.unreadable > 0) {
      notes.add(JsonString.of(p.unreadable + " height cells could not be read."));
    }
    long millis = (System.nanoTime() - p.startedNanos) / 1_000_000;
    Map<String, JsonValue> members = new LinkedHashMap<>();
    members.put("areas", c.areas());
    members.put("level", JsonNumber.of(plan.level()));
    members.put("cells", JsonNumber.of(p.loaded.size()));
    members.put("heightCells", JsonNumber.of(plan.nodes()));
    members.put("simplified", JsonNumber.of(c.simplified()));
    members.put("leftOut", JsonNumber.of(c.leftOut()));
    members.put("positions", JsonNumber.of(c.positions()));
    members.put("partlyWithoutData", JsonBoolean.of(c.partlyWithoutData() || p.unreadable > 0));
    members.put("millis", JsonNumber.of(millis));
    members.put("notes", new JsonArray(notes));
    finish(p);
    p.response.respond(HttpReply.json(200, JsonObject.of(members)));
  }

  private void requestTimeout(long requestId) {
    Pending p = pendings.get(requestId);
    if (p != null) {
      fail(p, 503, "the " + p.subject() + " took longer than " + limits.timeoutSeconds() + " seconds");
    }
  }

  private void fail(Pending p, int status, String message) {
    finish(p);
    p.response.respond(Bodies.error(status, message));
  }

  /** Forgets a request: its timer, its place among the waiters and the user's running mark. */
  private void finish(Pending p) {
    pendings.remove(p.id);
    running.remove(p.user, p.id);
    Cancellable timer = p.timer;
    if (timer != null) {
      timer.cancel();
    }
    for (long key : p.missing) {
      List<Long> waiting = waiters.get(key);
      if (waiting != null) {
        waiting.remove(Long.valueOf(p.id));
        if (waiting.isEmpty()) {
          waiters.remove(key);
        }
      }
    }
    p.missing.clear();
  }

  // ---------------------------------------------------------------- status

  private JsonObject statusJson() {
    Map<String, JsonValue> members = new LinkedHashMap<>();
    String name = switch (state) {
      case BUILDING -> "building";
      case READY -> "ready";
      case NOT_SET -> "notSet";
      case NOT_READABLE -> "notReadable";
      case NO_FOLDERS -> "noFolders";
    };
    members.put("state", JsonString.of(name));
    members.put("reason", JsonString.of(stateReason));
    members.put("cells", JsonNumber.of(index.total()));
    Map<String, JsonValue> levels = new LinkedHashMap<>();
    for (int level = 2; level >= 0; level--) {
      levels.put(Integer.toString(level), JsonNumber.of(index.count(level)));
    }
    members.put("levels", JsonObject.of(levels));
    members.put("skipped", JsonNumber.of(index.skipped()));
    double[] area = index.area();
    if (area != null) {
      Map<String, JsonValue> box = new LinkedHashMap<>();
      box.put("west", JsonNumber.of(area[0]));
      box.put("south", JsonNumber.of(area[1]));
      box.put("east", JsonNumber.of(area[2]));
      box.put("north", JsonNumber.of(area[3]));
      members.put("area", JsonObject.of(box));
    }
    members.put("cacheCells", JsonNumber.of(cache.size()));
    members.put("cacheBytes", JsonNumber.of(cache.bytes()));
    members.put("running", JsonNumber.of(running.size()));
    return JsonObject.of(members);
  }
}
