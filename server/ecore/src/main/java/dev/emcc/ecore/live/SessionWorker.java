package dev.emcc.ecore.live;

import dev.emcc.ecore.geo.GeoArea;
import dev.emcc.ecore.json.InvalidDocumentException;
import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.json.ModelSchemas.Document;
import dev.emcc.ecore.json.Problem;
import dev.emcc.ecore.runtime.Answer;
import dev.emcc.ecore.runtime.HandlerContext;
import dev.emcc.ecore.runtime.MessageHandler;
import dev.emcc.ecore.runtime.SendOutcome;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.ecore.store.AreaSnapshot;
import dev.emcc.ecore.store.ChangeOutcome;
import dev.emcc.ecore.store.FoundObjects;
import dev.emcc.ecore.store.LayerPage;
import dev.emcc.ecore.store.Requester;
import dev.emcc.ecore.store.StoreChange;
import dev.emcc.ecore.store.StoreMsg;
import dev.emcc.ecore.store.Workspaces;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.Position;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

/**
 * One browser session: its subscriptions to the live picture and its change requests
 * ({@code server/live-picture-protocol.md}, version 2).
 *
 * <p><b>Subscriptions.</b> A browser opens several, each with its own id: the whole picture, layers
 * and counts ({@code objects: false}), or an area of interest ({@link AreaView}). Each has its own
 * sequence. On {@code subscribe} the session asks the object store for the subscription's start
 * ({@link StoreMsg.GetArea}) and sends it as a snapshot in parts, one subscription's at a time, one
 * part per handler call and at most {@link #SNAPSHOT_WINDOW} waiting in the writer (flow control),
 * so a snapshot of any size fits the budget and never fills the writer. Meanwhile that
 * subscription's batches are kept, and afterwards only the changes after the snapshot's sequence
 * number are judged. Every batch must continue exactly where the subscription's last one ended; a
 * gap (or a resync from the hub) gives it a fresh snapshot instead. So the browser never misses a
 * change without getting a new snapshot.
 *
 * <p><b>Moves.</b> An {@code area} message asks the object store for the new area (at most one
 * query per subscription at a time and per {@link #MIN_AREA_INTERVAL}; the latest area wins). The
 * answer is consistent with a sequence number S, the subscription has judged the changes up to L.
 * If L is at least S, the new view is brought to L with the changes judged since the query was
 * sent; otherwise the answer waits until the batches reach S. Then the old and new views are
 * compared at the same change, and one {@code area-objects} message goes out (S3 recommendation 4).
 *
 * <p><b>Change requests.</b> Every one is the session user's, whatever its {@code source.plugin}
 * says. First, before any other check, the user's permission (overview 4.4): {@code objects.edit}
 * for an object, {@code layers.edit} for a layer, read from the raw request; without it the request
 * is refused ({@code PERMISSION_DENIED}, or an error when it cannot be answered) and does not count
 * toward {@link #MAX_OUTSTANDING}. Then the schema, ECore's own plugin ids and the limit. The server
 * sets {@code source.user} from the session (model rule 8) and drops {@code source.system}, whatever
 * the browser sent. Every request with a readable {@code requestId} gets exactly one {@code
 * change-outcome}: applied, rejected, or unknown when the store did not answer in time.
 *
 * <p><b>Object queries</b> (CR-0015 items 8 and 9): {@code get-objects} and {@code query-layer} ask
 * the object store, at most {@link #MAX_QUERIES} at a time. Every one with a readable {@code
 * queryId} gets exactly one answer: {@code objects}, {@code layer-page} or {@code query-failed}.
 *
 * <p>Nothing here blocks: the socket is written by the session's {@link Writer}. If the writer's
 * mailbox is full, the browser does not keep up, and the session is closed (the browser reconnects
 * and gets fresh snapshots).
 */
final class SessionWorker implements MessageHandler<LiveMsg.Session> {

  /** How long the session waits for the object store. */
  static final Duration STORE_TIMEOUT = Duration.ofSeconds(10);
  static final Duration SNAPSHOT_TIMEOUT = Duration.ofSeconds(30);
  /** At most this many changes are kept per subscription while its snapshot is on its way; beyond, another snapshot follows. */
  private static final int MAX_KEPT = 100_000;
  /** A fill that times out or is refused is asked for again, at most this many times in a row (review F2). */
  static final int MAX_FILL_TRIES = 3;
  private static final int MAX_MESSAGE = 1024;
  /** At most this many change requests of one session wait for the object store (F2). */
  static final int MAX_OUTSTANDING = 100;
  /**
   * How many snapshot parts may wait in the writer at a time (F3). Each sent part lets the next one
   * go, so a snapshot of any size never fills the writer, and each handler call serializes one part.
   */
  static final int SNAPSHOT_WINDOW = 4;
  /**
   * At least this long between two snapshots of one subscription id of the same workspaces (F2): a
   * subscribe loop cannot flood the store. A switch to other workspaces is not held (owner, 2026-10-28).
   */
  static final Duration MIN_SNAPSHOT_INTERVAL = Duration.ofSeconds(2);
  /** At least this long between two area queries of one subscription; of the moves in between, the latest counts. */
  static final Duration MIN_AREA_INTERVAL = Duration.ofMillis(250);
  /**
   * At most this many area queries of one session per second (conformance review F1): a whole-world
   * area of {@link #MAX_RING} positions costs the store about 67 ms at 200 000 objects, so one
   * browser can hold the store at most about a quarter of the time.
   */
  static final int MAX_MOVES_PER_SECOND = 4;
  /** Subscriptions per connection. */
  static final int MAX_SUBSCRIPTIONS = 32;
  /** The most workspaces a subscription may name (a manifest declares at most 16; View and "*" besides). */
  static final int MAX_WORKSPACES = 64;
  /**
   * Positions in an area's ring. The store's area query grows with them (a whole-world ring at 200 000
   * objects: 64 positions 30 ms, 256 about 67 ms, 1 024 about 215 ms, 8 192 about 1.5 s); the shell
   * thins a longer visible ring to this many, and the margin covers the difference.
   */
  static final int MAX_RING = 256;
  /** Ids per {@code area-objects} message. */
  private static final int LEFT_PER_MESSAGE = 10_000;
  private static final Pattern SUBSCRIPTION_ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");
  /** An id as the model writes it: a lowercase UUID ({@code model/README.md}). */
  private static final Pattern ID = Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
  /** At most this many object queries of one session wait for the object store; one more is refused as busy. */
  static final int MAX_QUERIES = 8;
  /**
   * The shell's own {@code source.plugin} (CR-0015 item 10): the one id of ECore's ({@code core},
   * {@code core-...}) a browser may use. No web part can: the shell fills in the calling plugin's
   * own id, and the plugin host refuses a plugin whose id is ECore's.
   */
  static final String SHELL_PLUGIN = "core-shell";

  private static final Logger LOG = LoggerFactory.getLogger(SessionWorker.class);

  private enum Kind { WHOLE, COUNTS, AREA }

  /** An area the browser asked for. */
  private record Move(GeoArea area, double resolution) {}

  /** A move's filled view whose answer ({@code sequenceNo}) is newer than the changes its subscription has judged. */
  private record HeldMove(Move move, long sequenceNo, AreaView.Filled filled) {}

  /** One subscription's state. */
  private static final class Sub {
    final String id;
    final long token;
    final Kind kind;
    final int budget;
    /** The workspaces whose layers and objects it gets: those it named that its user may see (ADR-0039). */
    final Set<String> workspaces;
    @Nullable Move area;
    // The snapshot.
    boolean awaitingSnapshot;
    boolean resyncAfterSnapshot;
    boolean snapshotAsked;
    boolean snapshotDue;
    final List<StoreChange> kept = new ArrayList<>();
    /** The last change judged for the browser; -1 before the first snapshot. */
    long lastSent = -1;
    // What the browser holds.
    @Nullable AreaView view;
    @Nullable Map<UUID, Integer> counts;
    // Moves.
    @Nullable Move pending;
    /** The move asked for (the store, then the fill worker), while {@link #moveAsked}. */
    @Nullable Move asked;
    boolean moveAsked;
    boolean moveDue;
    long moveAsks;
    long lastMoveNanos;
    boolean moveTaken;
    @Nullable List<StoreChange> sinceAsk;
    @Nullable HeldMove held;
    // Fills that timed out or were refused in a row.
    int snapshotFillFailures;
    int moveFillFailures;

    Sub(String id, long token, Kind kind, @Nullable Move area, int budget, Set<String> workspaces) {
      this.id = id;
      this.token = token;
      this.kind = kind;
      this.area = area;
      this.budget = budget;
      this.workspaces = Set.copyOf(workspaces);
    }
  }

  /** A snapshot ready to go out, or going out. */
  private record Outgoing(Sub sub, AreaSnapshot start, List<MapObject> objects) {}

  private final String id;
  /** The session's user, fixed at login: {@code source.user} and the permissions of its change requests. */
  private final Requester.User user;
  private final ModelJson json;
  private final WorkerRuntime runtime;
  private final WorkerHandle<StoreMsg> objectStore;
  /** Where the area views are filled (rule C7). */
  private final WorkerHandle<AreaFill.Fill> fill;
  private final WorkerHandle<LiveMsg.Writer> writer;
  private final Clock clock;
  private final int perMessage;
  private final int maxBudget;
  private final int maxHeld;
  private final AtomicLong inbound;
  private final Workspaces workspaces;
  private final java.util.function.Consumer<SessionTimes.Picked> onTime;
  /** The workspaces the user may see, fixed for the session as its permissions are. */
  private final Set<String> visible;

  private final Map<String, Sub> subs = new LinkedHashMap<>();
  private long tokens;
  /**
   * Each subscription id's last snapshot, also after it closed: a subscribe loop is throttled too,
   * but a workspace switch (the same id for other workspaces than its last snapshot's) is not
   * (PCA-object-list's finding; owner, 2026-10-28); the session's cap bounds those.
   */
  private final Map<String, LastSnapshot> snapshotAt = new HashMap<>();

  /** When a subscription id last took a snapshot, and of which workspaces. */
  private record LastSnapshot(Set<String> workspaces, long at) {}
  /** When the session's recent snapshots were taken: at most {@link #MAX_SUBSCRIPTIONS} per {@link #MIN_SNAPSHOT_INTERVAL}. */
  private final ArrayDeque<Long> recentSnapshots = new ArrayDeque<>();
  /** When the session's recent area queries were asked: at most {@link #MAX_MOVES_PER_SECOND} per second. */
  private final ArrayDeque<Long> recentMoves = new ArrayDeque<>();
  private final ArrayDeque<Outgoing> ready = new ArrayDeque<>();
  /** The snapshot whose parts are going out, if any; the generation tells its parts' acknowledgements apart. */
  private @Nullable Outgoing sending;
  private long generation;
  private int nextObject;
  private int partsInFlight;
  private int outstanding;
  private int queries;
  private boolean closed;

  /**
   * @param perMessage how many objects or events go into one message
   * @param maxBudget the most objects a subscription gets individually
   * @param maxHeld the most objects the session's area subscriptions may hold together (their views)
   * @param workspaces who may see which workspace (ADR-0039): the session sends only what its user may see
   */
  SessionWorker(String id, Requester.User user, ModelJson json, WorkerRuntime runtime, WorkerHandle<StoreMsg> objectStore,
      WorkerHandle<AreaFill.Fill> fill, WorkerHandle<LiveMsg.Writer> writer, Clock clock, int perMessage, int maxBudget, int maxHeld,
      AtomicLong inbound, Workspaces workspaces) {
    this(id, user, json, runtime, objectStore, fill, writer, clock, perMessage, maxBudget, maxHeld, inbound, workspaces, t -> {});
  }

  /** @param onTime gets each well-formed {@code time} the browser sends (SDK 1.4.0, ADR-0045 point 4) */
  SessionWorker(String id, Requester.User user, ModelJson json, WorkerRuntime runtime, WorkerHandle<StoreMsg> objectStore,
      WorkerHandle<AreaFill.Fill> fill, WorkerHandle<LiveMsg.Writer> writer, Clock clock, int perMessage, int maxBudget, int maxHeld,
      AtomicLong inbound, Workspaces workspaces, java.util.function.Consumer<SessionTimes.Picked> onTime) {
    this.onTime = java.util.Objects.requireNonNull(onTime, "onTime");
    this.id = id;
    this.user = user;
    this.json = json;
    this.runtime = runtime;
    this.objectStore = objectStore;
    this.fill = fill;
    this.writer = writer;
    this.clock = clock;
    this.perMessage = perMessage;
    this.maxBudget = maxBudget;
    this.maxHeld = maxHeld;
    this.inbound = inbound;
    this.workspaces = workspaces;
    this.visible = workspaces.visibleTo(user);
  }

  @Override
  public void handle(LiveMsg.Session message, HandlerContext<LiveMsg.Session> context) {
    if (message instanceof LiveMsg.Session.Inbound in) {
      inbound.addAndGet(-in.text().length()); // taken from the mailbox: no longer waiting
    }
    if (closed) {
      return;
    }
    switch (message) {
      case LiveMsg.Session.Inbound in -> inbound(in.text(), context);
      case LiveMsg.Session.Batch batch -> List.copyOf(subs.values()).forEach(s -> batch(s, batch.changes(), context));
      case LiveMsg.Session.Resync resync -> List.copyOf(subs.values()).forEach(s -> resync(s, context));
      case LiveMsg.Session.Snapshotted answered -> {
        Sub s = open(answered.subscription(), answered.token());
        if (s != null) {
          snapshotted(s, answered.answer(), context);
        }
      }
      case LiveMsg.Session.Moved moved -> {
        Sub s = open(moved.subscription(), moved.token());
        if (s != null && s.moveAsked && moved.ask() == s.moveAsks) {
          moved(s, new Move(moved.area(), moved.resolution()), moved.answer(), context);
        }
      }
      case LiveMsg.Session.SnapshotFilled filled -> {
        Sub s = open(filled.subscription(), filled.token());
        if (s != null && s.snapshotAsked) {
          snapshotFilled(s, filled.start(), filled.answer(), context);
        }
      }
      case LiveMsg.Session.MoveFilled filled -> {
        Sub s = open(filled.subscription(), filled.token());
        if (s != null && s.moveAsked && filled.ask() == s.moveAsks) {
          moveFilled(s, new Move(filled.area(), filled.resolution()), filled.answer(), filled.filled(), context);
        }
      }
      case LiveMsg.Session.KeepAlive keepAlive -> writer.send(LiveMsg.Writer.Ping.PING);
      case LiveMsg.Session.PartSent sent -> {
        if (sent.generation() == generation && sending != null) {
          partsInFlight--;
          fillWindow(context);
        }
      }
      case LiveMsg.Session.SnapshotDue due -> {
        Sub s = open(due.subscription(), due.token());
        if (s != null) {
          s.snapshotDue = false;
          if (s.awaitingSnapshot && !s.snapshotAsked) {
            askWhenAllowed(s, context); // the session's cap again: others may have come due at the same moment
          }
        }
      }
      case LiveMsg.Session.MoveDue due -> {
        Sub s = open(due.subscription(), due.token());
        if (s != null) {
          s.moveDue = false;
          maybeMove(s, context);
        }
      }
      case LiveMsg.Session.Outcome outcome -> outcome(outcome.request(), outcome.answer());
      case LiveMsg.Session.Found found -> found(found.queryId(), found.answer());
      case LiveMsg.Session.Paged paged -> paged(paged.queryId(), paged.answer());
    }
  }

  /** The subscription, if it is still the one with this token (not closed, not opened again). */
  private @Nullable Sub open(String subscription, long token) {
    Sub s = subs.get(subscription);
    return s != null && s.token == token ? s : null;
  }

  // ---- From the browser -------------------------------------------------------------------------

  private void inbound(String text, HandlerContext<LiveMsg.Session> context) {
    JsonNode message;
    try {
      message = json.parse(text);
    } catch (InvalidDocumentException e) {
      error(null, null, "not valid JSON");
      return;
    }
    JsonNode type = message.get("type");
    switch (type == null || !type.isString() ? "" : type.asString()) {
      case "subscribe" -> subscribe(message, context);
      case "area" -> area(message, context);
      case "unsubscribe" -> unsubscribe(message, context);
      case "change-request" -> changeRequest(message.get("request"), context);
      case "get-objects" -> getObjects(message, context);
      case "query-layer" -> queryLayer(message, context);
      case "time" -> time(message);
      default -> error(null, null, "unknown message type " + (type == null ? "(none)" : type.toString()));
    }
  }

  /**
   * A {@code time} message (SDK 1.4.0, ADR-0045 point 4): the time the page's user picked, checked
   * here (ECore checks that an interval is well formed); a malformed one gets an {@code error} and
   * changes nothing.
   */
  private void time(JsonNode message) {
    SessionTimes.Picked time;
    try {
      time = userTime(message.get("time"));
    } catch (IllegalArgumentException | java.time.DateTimeException e) {
      error(null, null, "time not taken: " + e.getMessage());
      return;
    }
    onTime.accept(time);
  }

  private static final Pattern UTC = Pattern.compile("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z");

  /**
   * The web SDK's {@code UserTime} as JSON (CR-0032): {@code {"time":…, "interval":{"from":…,
   * "to":…}}}, each part left out at its default (now; no interval), never {@code null}, nothing
   * else; UTC timestamps as the data model writes them (at most milliseconds), and an interval's
   * start not after its end. {@code {}} is now.
   *
   * @throws IllegalArgumentException if it is not one
   */
  static SessionTimes.Picked userTime(@Nullable JsonNode t) {
    if (t == null || !t.isObject()) {
      throw new IllegalArgumentException("a time is an object with time and interval, each left out at its default");
    }
    for (String name : t.propertyNames()) {
      if (!name.equals("time") && !name.equals("interval")) {
        throw new IllegalArgumentException("a time has no " + name);
      }
    }
    java.time.Instant at = t.has("time") ? utc(t, "time") : null;
    JsonNode interval = t.get("interval");
    if (interval == null) {
      return new SessionTimes.Picked(at, null, null);
    }
    if (!interval.isObject()) {
      throw new IllegalArgumentException("the interval is an object with from and to, or left out for none (never null)");
    }
    for (String name : interval.propertyNames()) {
      if (!name.equals("from") && !name.equals("to")) {
        throw new IllegalArgumentException("an interval has no " + name);
      }
    }
    return new SessionTimes.Picked(at, utc(interval, "from"), utc(interval, "to")); // refuses a start after the end
  }

  private static java.time.Instant utc(JsonNode t, String name) {
    JsonNode v = t.get(name);
    if (v == null || !v.isString() || !UTC.matcher(v.asString()).matches()) {
      throw new IllegalArgumentException(name + " is a UTC timestamp, e.g. 2026-11-06T12:00:00Z");
    }
    return java.time.Instant.parse(v.asString());
  }

  /** The message's subscription id if it is well formed, else null (after an error). */
  private @Nullable String subscriptionId(JsonNode message) {
    JsonNode node = message.get("subscription");
    if (node == null || !node.isString() || !SUBSCRIPTION_ID.matcher(node.asString()).matches()) {
      error(null, null, "a subscription id has 1 to 64 letters, digits, - or _");
      return null;
    }
    return node.asString();
  }

  private void subscribe(JsonNode message, HandlerContext<LiveMsg.Session> context) {
    String sid = subscriptionId(message);
    if (sid == null) {
      return;
    }
    if (subs.containsKey(sid)) {
      error(null, sid, "subscription " + sid + " is open already");
      return;
    }
    if (subs.size() >= MAX_SUBSCRIPTIONS) {
      error(null, sid, "at most " + MAX_SUBSCRIPTIONS + " subscriptions per connection");
      return;
    }
    Sub s;
    try {
      JsonNode objects = message.get("objects");
      if (objects != null && !objects.isBoolean()) {
        throw new IllegalArgumentException("objects is true or false");
      }
      Set<String> named = workspaces(message.get("workspaces"));
      if (objects != null && !objects.asBoolean()) {
        s = new Sub(sid, ++tokens, Kind.COUNTS, null, maxBudget, named);
      } else if (message.get("area") != null) {
        s = new Sub(sid, ++tokens, Kind.AREA, move(message), budget(message.get("budget")), named);
      } else {
        s = new Sub(sid, ++tokens, Kind.WHOLE, null, maxBudget, named);
      }
    } catch (IllegalArgumentException e) {
      error(null, sid, "subscription " + sid + " not opened: " + e.getMessage());
      return;
    }
    subs.put(sid, s);
    requestSnapshot(s, context);
  }

  /**
   * A subscription's workspaces (ADR-0039; owner, 2026-10-27): View without {@code workspaces};
   * {@code "*"} in the list, every one the user may see; otherwise those named that the user may
   * see. One the user may not see, or that no plugin declares, is left out without a word, so a
   * browser cannot learn which workspaces exist.
   */
  private Set<String> workspaces(@Nullable JsonNode node) {
    if (node == null) {
      return Set.of(Workspaces.VIEW);
    }
    if (!node.isArray() || node.size() > MAX_WORKSPACES) {
      throw new IllegalArgumentException("workspaces is a list of at most " + MAX_WORKSPACES + " workspace ids or \"*\"");
    }
    for (JsonNode w : node) {
      if (!w.isString()) {
        throw new IllegalArgumentException("workspaces is a list of workspace ids or \"*\"");
      }
    }
    Set<String> named = new HashSet<>();
    for (JsonNode w : node) {
      if (w.asString().equals("*")) {
        return visible;
      }
      if (visible.contains(w.asString())) {
        named.add(w.asString());
      }
    }
    return named;
  }

  /** The changes of {@code s}'s workspaces among {@code changes}: the others are judged, but not sent. */
  private static List<StoreChange> visible(Sub s, List<StoreChange> changes) {
    return changes.stream().filter(c -> s.workspaces.contains(c.workspace())).toList();
  }

  private int budget(@Nullable JsonNode node) {
    if (node == null) {
      return maxBudget;
    }
    if (!node.canConvertToInt() || !node.isIntegralNumber() || node.asInt() < 1) {
      throw new IllegalArgumentException("budget is a whole number of at least 1");
    }
    return Math.min(node.asInt(), maxBudget);
  }

  /** The area and resolution of a {@code subscribe} or {@code area} message. */
  private static Move move(JsonNode message) {
    JsonNode area = message.get("area");
    if (area == null || !area.isObject()) {
      throw new IllegalArgumentException("area is an object with ring, inside and an optional margin");
    }
    JsonNode ring = area.get("ring");
    if (ring == null || !ring.isArray() || ring.size() > MAX_RING) {
      throw new IllegalArgumentException("area.ring is an array of at most " + MAX_RING + " positions");
    }
    List<Position> positions = new ArrayList<>(ring.size());
    for (JsonNode p : ring) {
      positions.add(position(p, "area.ring"));
    }
    Position inside = position(area.get("inside"), "area.inside");
    double metres = 0;
    double share = 0;
    JsonNode margin = area.get("margin");
    if (margin != null) {
      JsonNode m = margin.get("metres");
      JsonNode sh = margin.get("share");
      if (!margin.isObject() || (m == null) == (sh == null) || margin.size() != 1) {
        throw new IllegalArgumentException("area.margin is {\"metres\": m} or {\"share\": s}");
      }
      metres = m == null ? 0 : finite(m, "area.margin.metres");
      share = sh == null ? 0 : finite(sh, "area.margin.share");
    }
    GeoArea geo = new GeoArea(positions, inside, metres, share);
    JsonNode resolution = message.get("resolution");
    double metresPerPixel = resolution == null ? 0 : finite(resolution, "resolution");
    if (resolution != null && !(metresPerPixel > 0)) {
      throw new IllegalArgumentException("resolution is more than 0");
    }
    return new Move(geo, metresPerPixel);
  }

  private static Position position(@Nullable JsonNode node, String what) {
    if (node == null || !node.isArray() || node.size() < 2 || !node.get(0).isNumber() || !node.get(1).isNumber()) {
      throw new IllegalArgumentException(what + " holds [longitude, latitude] positions");
    }
    return Position.of(node.get(0).asDouble(), node.get(1).asDouble());
  }

  private static double finite(JsonNode node, String what) {
    if (!node.isNumber() || !Double.isFinite(node.asDouble()) || node.asDouble() < 0) {
      throw new IllegalArgumentException(what + " is a number of at least 0");
    }
    return node.asDouble();
  }

  private void area(JsonNode message, HandlerContext<LiveMsg.Session> context) {
    String sid = subscriptionId(message);
    if (sid == null) {
      return;
    }
    Sub s = subs.get(sid);
    if (s == null || s.kind != Kind.AREA) {
      error(null, sid, "no area subscription " + sid);
      return;
    }
    try {
      s.pending = move(message);
    } catch (IllegalArgumentException e) {
      error(null, sid, "area of " + sid + " not moved: " + e.getMessage());
      return;
    }
    maybeMove(s, context);
  }

  private void unsubscribe(JsonNode message, HandlerContext<LiveMsg.Session> context) {
    String sid = subscriptionId(message);
    if (sid == null) {
      return;
    }
    Sub s = subs.remove(sid);
    if (s == null) {
      return;
    }
    ready.removeIf(o -> o.sub() == s);
    if (sending != null && sending.sub() == s) {
      sending = null;
      generation++; // acknowledgements of its parts no longer count
      partsInFlight = 0;
      startNext(context);
    }
  }

  private void changeRequest(@Nullable JsonNode tree, HandlerContext<LiveMsg.Session> context) {
    if (tree == null || !tree.isObject()) {
      error(null, null, "a change-request needs a request object"); // no entityType to read
      return;
    }
    if (denied(tree)) {
      return;
    }
    ChangeRequest request;
    try {
      request = (ChangeRequest) json.fromTree(Document.CHANGE_REQUEST, tree);
    } catch (InvalidDocumentException e) {
      invalidRequest(tree, e);
      return;
    }
    String plugin = request.source().plugin();
    if ((plugin.equals("core") || plugin.startsWith("core-")) && !plugin.equals(SHELL_PLUGIN)) {
      send(changeOutcome(new ChangeOutcome.Rejected(new ChangeRejection(request.requestId(), request.entityType(),
          request.operation(), request.entityId(), ChangeRejection.Code.VALIDATION_FAILED,
          "source.plugin " + plugin + " is reserved for ECore", List.of(), now())), request.requestId()));
      return;
    }
    // F4: the user comes from the session; a browser is no external system. source.plugin is the
    // shell's word for the calling web part, recorded as the source and for its extension namespace,
    // never for permissions (the session's user's, checked above).
    ChangeRequest trusted = new ChangeRequest(request.requestId(), request.entityType(), request.operation(),
        request.entityId(), request.baseVersion(), request.data(), request.externalRef(), new Actor(plugin, user.id(), null),
        request.fields()); // data model 1.2.0: kept, so the store decides on them rather than they are dropped
    if (outstanding >= MAX_OUTSTANDING) {
      send(changeOutcome(new ChangeOutcome.Rejected(new ChangeRejection(trusted.requestId(), trusted.entityType(),
          trusted.operation(), trusted.entityId(), ChangeRejection.Code.INTERNAL_ERROR,
          "too many change requests in progress (" + MAX_OUTSTANDING + "); send it again later", List.of(), now())),
          trusted.requestId()));
      return;
    }
    outstanding++;
    context.<StoreMsg, ChangeOutcome>ask(objectStore, reply -> new StoreMsg.Apply(trusted, user, reply), STORE_TIMEOUT,
        answer -> new LiveMsg.Session.Outcome(trusted, answer));
  }

  /**
   * Whether the user lacks the permission for the request's entity type (overview 4.4: checked before
   * anything else, as soon as {@code entityType} can be read); then the request is answered here and
   * goes no further. An unreadable or unknown {@code entityType} is left to the schema check.
   */
  private boolean denied(JsonNode tree) {
    EntityType entityType;
    try {
      entityType = EntityType.fromJson(text(tree.get("entityType")));
    } catch (RuntimeException e) {
      return false;
    }
    String message = earlyRefusal(tree, entityType);
    if (message == null) {
      return false;
    }
    UUID requestId = uuid(tree.get("requestId"));
    UUID entityId = uuid(tree.get("entityId"));
    Operation operation;
    try {
      operation = Operation.fromJson(text(tree.get("operation")));
    } catch (RuntimeException e) {
      operation = null;
    }
    if (requestId == null || entityId == null || operation == null) {
      error(requestId, null, message);
    } else {
      send(changeOutcome(new ChangeOutcome.Rejected(new ChangeRejection(requestId, entityType, operation, entityId,
          ChangeRejection.Code.PERMISSION_DENIED, message, List.of(), now())), requestId));
    }
    return true;
  }

  /**
   * The session's first check of a change's permission (ADR-0039; owner, 2026-10-27): it cannot
   * tell which workspace an object's layer, or a stored layer, is in, so it refuses only a user who
   * holds none of the permissions that could allow the change; a layer create names its workspace
   * and is checked exactly, one the user may not see as View, as the object store does. The object
   * store decides exactly in every case.
   */
  private @Nullable String earlyRefusal(JsonNode tree, EntityType entityType) {
    JsonNode data = tree.get("data");
    if (entityType == EntityType.LAYER && "create".equals(text(tree.get("operation"))) && data != null && data.isObject()) {
      JsonNode named = data.get("workspace");
      if (named == null || named.isString()) {
        String workspace = Workspaces.ofLayer(named == null ? null : named.asString());
        return workspaces.refusal(user, entityType, visible.contains(workspace) ? workspace : Workspaces.VIEW);
      }
    }
    return workspaces.mayChangeSomewhere(user, entityType) ? null : Requester.refusal(entityType);
  }

  /** A request the schema refuses: a VALIDATION_FAILED rejection if it can be addressed, else an error. */
  private void invalidRequest(JsonNode tree, InvalidDocumentException e) {
    UUID requestId = uuid(tree.get("requestId"));
    UUID entityId = uuid(tree.get("entityId"));
    EntityType entityType = null;
    Operation operation = null;
    try {
      entityType = EntityType.fromJson(text(tree.get("entityType")));
      operation = Operation.fromJson(text(tree.get("operation")));
    } catch (RuntimeException ignored) {
      // not addressable as a rejection
    }
    if (requestId == null || entityId == null || entityType == null || operation == null) {
      error(requestId, null, "the change request is not valid: " + summary(e.problems()));
      return;
    }
    List<ChangeRejection.Detail> details = e.problems().stream().limit(50)
        .map(p -> new ChangeRejection.Detail(p.path(), p.problem())).toList();
    send(changeOutcome(new ChangeOutcome.Rejected(new ChangeRejection(requestId, entityType, operation, entityId,
        ChangeRejection.Code.VALIDATION_FAILED, limit("the change request is not valid: " + summary(e.problems())),
        details, now())), requestId));
  }

  // ---- Object queries (CR-0015 items 8 and 9) -----------------------------------------------------

  /** The message's query id if it is well formed, else null (after an error). */
  private @Nullable String queryId(JsonNode message) {
    JsonNode node = message.get("queryId");
    if (node == null || !node.isString() || !SUBSCRIPTION_ID.matcher(node.asString()).matches()) {
      error(null, null, "a query id has 1 to 64 letters, digits, - or _");
      return null;
    }
    return node.asString();
  }

  private void getObjects(JsonNode message, HandlerContext<LiveMsg.Session> context) {
    String qid = queryId(message);
    if (qid == null) {
      return;
    }
    JsonNode ids = message.get("ids");
    if (ids == null || !ids.isArray() || ids.size() > StoreMsg.MAX_IDS) {
      queryFailed(qid, "invalid", "ids is an array of at most " + StoreMsg.MAX_IDS + " object ids");
      return;
    }
    List<UUID> list = new ArrayList<>(ids.size());
    for (JsonNode node : ids) {
      UUID id = id(node);
      if (id == null) {
        queryFailed(qid, "invalid", "not an id: " + node);
        return;
      }
      list.add(id);
    }
    if (mayQuery(qid)) {
      context.<StoreMsg, FoundObjects>ask(objectStore, reply -> new StoreMsg.GetObjects(list, visible, reply), STORE_TIMEOUT,
          answer -> new LiveMsg.Session.Found(qid, answer));
    }
  }

  private void queryLayer(JsonNode message, HandlerContext<LiveMsg.Session> context) {
    String qid = queryId(message);
    if (qid == null) {
      return;
    }
    UUID layerId = id(message.get("layerId"));
    JsonNode page = message.get("page");
    JsonNode pageSize = message.get("pageSize");
    if (layerId == null) {
      queryFailed(qid, "invalid", "layerId is a layer's id");
    } else if (!wholeNumber(page, 0, Integer.MAX_VALUE)) {
      queryFailed(qid, "invalid", "page is a whole number from 0");
    } else if (!wholeNumber(pageSize, 1, StoreMsg.MAX_PAGE_SIZE)) {
      queryFailed(qid, "invalid", "pageSize is a whole number from 1 to " + StoreMsg.MAX_PAGE_SIZE);
    } else if (mayQuery(qid)) {
      int pageNo = page.asInt();
      int size = pageSize.asInt();
      context.<StoreMsg, LayerPage>ask(objectStore, reply -> new StoreMsg.GetLayerPage(layerId, pageNo, size, visible, reply),
          STORE_TIMEOUT, answer -> new LiveMsg.Session.Paged(qid, answer));
    }
  }

  private static boolean wholeNumber(@Nullable JsonNode node, int min, int max) {
    return node != null && node.isIntegralNumber() && node.canConvertToInt() && node.asInt() >= min && node.asInt() <= max;
  }

  /** Whether one more query may wait for the store (then it counts), else it is refused as busy. */
  private boolean mayQuery(String qid) {
    if (queries >= MAX_QUERIES) {
      queryFailed(qid, "busy", "at most " + MAX_QUERIES + " queries at a time; ask again when one is answered");
      return false;
    }
    queries++;
    return true;
  }

  private void found(String qid, Answer<FoundObjects> answer) {
    queries--;
    switch (answer) {
      case Answer.Ok<FoundObjects> ok -> {
        ObjectNode message = envelope("objects", null);
        message.put("queryId", qid);
        message.put("sequenceNo", ok.value().sequenceNo());
        ArrayNode found = message.putArray("found");
        ok.value().found().forEach(o -> found.add(json.toTree(o)));
        ArrayNode missing = message.putArray("missing");
        ok.value().missing().forEach(id -> missing.add(id.toString()));
        send(message);
      }
      case Answer.TimedOut<FoundObjects> t -> storeDidNotAnswer(qid);
      case Answer.Failed<FoundObjects> failed -> queryFailed(qid, "unavailable", "the object store failed: " + failed.reason());
    }
  }

  private void paged(String qid, Answer<LayerPage> answer) {
    queries--;
    switch (answer) {
      case Answer.Ok<LayerPage> ok -> {
        switch (ok.value()) {
          case LayerPage.Page page -> {
            ObjectNode message = envelope("layer-page", null);
            message.put("queryId", qid);
            message.put("sequenceNo", page.sequenceNo());
            message.put("layerId", page.layerId().toString());
            message.put("page", page.page());
            message.put("pageSize", page.pageSize());
            message.put("total", page.total());
            ArrayNode objects = message.putArray("objects");
            page.objects().forEach(o -> objects.add(json.toTree(o)));
            send(message);
          }
          case LayerPage.NoLayer none -> queryFailed(qid, "no-layer", "no layer " + none.layerId());
        }
      }
      case Answer.TimedOut<LayerPage> t -> storeDidNotAnswer(qid);
      case Answer.Failed<LayerPage> failed -> queryFailed(qid, "unavailable", "the object store failed: " + failed.reason());
    }
  }

  private void storeDidNotAnswer(String qid) {
    queryFailed(qid, "unavailable", "the object store did not answer within " + STORE_TIMEOUT.toSeconds() + " s");
  }

  private void queryFailed(String qid, String problem, String text) {
    ObjectNode message = envelope("query-failed", null);
    message.put("queryId", qid);
    message.put("problem", problem);
    message.put("message", limit(text));
    send(message);
  }

  private void outcome(ChangeRequest request, Answer<ChangeOutcome> answer) {
    outstanding--;
    send(changeOutcome(ChangeOutcome.of(request, answer, now()), request.requestId()));
  }

  // ---- Snapshots --------------------------------------------------------------------------------

  /**
   * The subscription needs a (new) snapshot. At most one is asked for at a time, at most one per id
   * and {@link #MIN_SNAPSHOT_INTERVAL} while it asks for the workspaces of the id's last snapshot,
   * and at most {@link #MAX_SUBSCRIPTIONS} per session and interval (F2: neither a subscribe loop
   * nor many ids can flood the store); until then its batches are kept. A switch to other
   * workspaces under the same id is answered at once, within the session's cap.
   */
  private void requestSnapshot(Sub s, HandlerContext<LiveMsg.Session> context) {
    s.awaitingSnapshot = true;
    s.resyncAfterSnapshot = false;
    if (s.snapshotAsked || s.snapshotDue || isGoingOut(s)) {
      return; // one is on its way
    }
    askWhenAllowed(s, context);
  }

  /** Asks for the subscription's snapshot now, or schedules it for when the limits allow it (and checks them again then). */
  private void askWhenAllowed(Sub s, HandlerContext<LiveMsg.Session> context) {
    long now = runtime.nanoTime();
    long interval = MIN_SNAPSHOT_INTERVAL.toNanos();
    while (!recentSnapshots.isEmpty() && recentSnapshots.peekFirst() <= now - interval) {
      recentSnapshots.pollFirst();
    }
    LastSnapshot last = snapshotAt.get(s.id);
    long wait = last == null || !last.workspaces().equals(s.workspaces) ? 0 : last.at() + interval - now;
    if (recentSnapshots.size() >= MAX_SUBSCRIPTIONS) {
      wait = Math.max(wait, recentSnapshots.peekFirst() + interval - now);
    }
    if (wait > 0) {
      s.snapshotDue = true;
      WorkerHandle<LiveMsg.Session> self = context.self();
      LiveMsg.Session due = new LiveMsg.Session.SnapshotDue(s.id, s.token);
      runtime.schedule(Duration.ofNanos(wait), () -> runtime.deliverAlways(self, () -> due));
      return;
    }
    askSnapshot(s, context);
  }

  private boolean isGoingOut(Sub s) {
    return (sending != null && sending.sub() == s) || ready.stream().anyMatch(o -> o.sub() == s);
  }

  private void askSnapshot(Sub s, HandlerContext<LiveMsg.Session> context) {
    s.snapshotAsked = true;
    long now = runtime.nanoTime();
    if (snapshotAt.size() > 4 * MAX_SUBSCRIPTIONS) {
      snapshotAt.values().removeIf(last -> last.at() <= now - MIN_SNAPSHOT_INTERVAL.toNanos());
    }
    snapshotAt.put(s.id, new LastSnapshot(s.workspaces, now));
    recentSnapshots.addLast(now);
    Move latest = s.pending != null ? s.pending : s.moveAsked ? s.asked : s.held != null ? s.held.move() : null;
    if (s.kind == Kind.AREA && latest != null) {
      s.area = latest; // a snapshot takes the latest area at once, also one still being moved to
    }
    s.pending = null;
    // A move still out is overtaken by the snapshot (its answers are ignored).
    s.moveAsked = false;
    s.asked = null;
    s.sinceAsk = null;
    s.held = null;
    GeoArea area = s.kind == Kind.AREA ? Objects.requireNonNull(s.area).area() : null;
    boolean objects = s.kind != Kind.COUNTS;
    String sid = s.id;
    long token = s.token;
    Set<String> named = s.workspaces;
    context.<StoreMsg, AreaSnapshot>ask(objectStore, reply -> new StoreMsg.GetArea(area, objects, named, reply), SNAPSHOT_TIMEOUT,
        answer -> new LiveMsg.Session.Snapshotted(sid, token, answer));
  }

  private void snapshotted(Sub s, Answer<AreaSnapshot> answer, HandlerContext<LiveMsg.Session> context) {
    s.snapshotAsked = false;
    switch (answer) {
      case Answer.Ok<AreaSnapshot> ok -> {
        AreaSnapshot start = ok.value();
        if (s.kind == Kind.AREA && heldBesides(s) + start.objects().size() > maxHeld) {
          subs.remove(s.id);
          error(null, s.id, "subscription " + s.id + " closed: its area holds " + start.objects().size()
              + " objects, and this connection may hold at most " + maxHeld + " in its areas");
          return;
        }
        if (s.kind == Kind.AREA) {
          // The fill worker makes the view (rule C7). Until it answers the snapshot stays asked for, and
          // the changes that arrive meanwhile are kept, as while the object store was asked.
          s.snapshotAsked = true;
          Move area = Objects.requireNonNull(s.area);
          String sid = s.id;
          long token = s.token;
          int budget = s.budget;
          context.<AreaFill.Fill, AreaView.Filled>ask(fill, reply -> new AreaFill.Fill(area.area(), area.resolution(), budget, start, reply),
              SNAPSHOT_TIMEOUT, filled -> new LiveMsg.Session.SnapshotFilled(sid, token, start, filled));
          return;
        }
        if (s.kind == Kind.COUNTS) {
          s.counts = new HashMap<>(start.objectCounts());
        }
        ready.add(new Outgoing(s, start, s.kind == Kind.WHOLE ? start.objects() : List.of()));
        startNext(context);
      }
      case Answer.TimedOut<AreaSnapshot> t -> {
        LOG.warn("Live session {}: no snapshot for {} from the object store within {}; asking again", id, s.id, SNAPSHOT_TIMEOUT);
        requestSnapshot(s, context);
      }
      case Answer.Failed<AreaSnapshot> failed -> {
        s.awaitingSnapshot = false;
        s.lastSent = -1;
        error(null, s.id, "no snapshot: " + failed.reason());
      }
    }
  }

  /** The fill worker's view for a snapshot: the session takes it over, and the snapshot goes out. */
  private void snapshotFilled(Sub s, AreaSnapshot start, Answer<AreaView.Filled> answer, HandlerContext<LiveMsg.Session> context) {
    s.snapshotAsked = false;
    String why = switch (answer) {
      case Answer.Ok<AreaView.Filled> ok -> {
        s.snapshotFillFailures = 0;
        // Again now: other areas of this connection may have been filled meanwhile (review F1).
        if (heldBesides(s) + ok.value().members().size() > maxHeld) {
          subs.remove(s.id);
          error(null, s.id, "subscription " + s.id + " closed: its area holds " + ok.value().members().size()
              + " objects, and this connection may hold at most " + maxHeld + " in its areas");
          yield null;
        }
        s.view = AreaView.of(ok.value());
        ready.add(new Outgoing(s, start, ok.value().singles()));
        startNext(context);
        yield null;
      }
      case Answer.TimedOut<AreaView.Filled> t -> "was not filled within " + SNAPSHOT_TIMEOUT;
      case Answer.Failed<AreaView.Filled> failed -> "could not be filled: " + failed.reason();
    };
    if (why == null) {
      return;
    }
    if (++s.snapshotFillFailures < MAX_FILL_TRIES) {
      LOG.warn("Live session {}: the area of {} {}; asking again", id, s.id, why);
      requestSnapshot(s, context);
    } else {
      s.snapshotFillFailures = 0;
      s.awaitingSnapshot = false;
      s.lastSent = -1;
      error(null, s.id, "no snapshot: the area " + why);
    }
  }

  private void startNext(HandlerContext<LiveMsg.Session> context) {
    if (sending != null || closed) {
      return;
    }
    Outgoing next = ready.poll();
    if (next == null) {
      return;
    }
    ObjectNode begin = envelope("snapshot-begin", next.sub().id);
    begin.put("sequenceNo", next.start().sequenceNo());
    ArrayNode layers = begin.putArray("layers");
    for (Layer layer : next.start().layers()) {
      layers.add(json.toTree(layer));
    }
    begin.put("objectCount", next.objects().size());
    if (next.sub().kind == Kind.COUNTS) {
      begin.set("objectCounts", counts(Objects.requireNonNull(next.sub().counts)));
    }
    send(begin, null);
    generation++;
    sending = next;
    nextObject = 0;
    partsInFlight = 0;
    fillWindow(context);
  }

  /** Sends parts until {@link #SNAPSHOT_WINDOW} wait in the writer; ends the snapshot after the last one. */
  private void fillWindow(HandlerContext<LiveMsg.Session> context) {
    Outgoing out = sending;
    if (out == null) {
      return;
    }
    List<MapObject> objects = out.objects();
    WorkerHandle<LiveMsg.Session> self = context.self();
    long current = generation;
    Runnable sent = () -> runtime.deliverAlways(self, () -> new LiveMsg.Session.PartSent(current));
    while (!closed && partsInFlight < SNAPSHOT_WINDOW && nextObject < objects.size()) {
      ObjectNode part = envelope("snapshot-objects", out.sub().id);
      ArrayNode array = part.putArray("objects");
      objects.subList(nextObject, Math.min(objects.size(), nextObject + perMessage)).forEach(o -> array.add(json.toTree(o)));
      nextObject += perMessage;
      partsInFlight++;
      send(part, sent);
    }
    if (nextObject >= objects.size() && partsInFlight == 0) {
      finishSnapshot(out, context);
    }
  }

  private void finishSnapshot(Outgoing out, HandlerContext<LiveMsg.Session> context) {
    Sub s = out.sub();
    long sequenceNo = out.start().sequenceNo();
    ObjectNode end = envelope("snapshot-end", s.id);
    end.put("sequenceNo", sequenceNo);
    send(end, null);
    if (s.kind == Kind.AREA) {
      send(clusters(s, Objects.requireNonNull(s.view).fullClusters(), sequenceNo));
    }
    s.lastSent = sequenceNo;
    s.awaitingSnapshot = false;
    sending = null;
    List<StoreChange> after = List.copyOf(s.kept);
    s.kept.clear();
    if (s.resyncAfterSnapshot) {
      requestSnapshot(s, context);
    } else {
      batch(s, after, context);
      maybeMove(s, context);
    }
    startNext(context);
  }

  private void resync(Sub s, HandlerContext<LiveMsg.Session> context) {
    if (s.awaitingSnapshot) {
      // A snapshot taken already may miss the lost events; one still waiting for its interval will not.
      s.resyncAfterSnapshot |= s.snapshotAsked || isGoingOut(s);
    } else if (s.lastSent >= 0) {
      requestSnapshot(s, context);
    }
  }

  // ---- Batches ----------------------------------------------------------------------------------

  private void batch(Sub s, List<StoreChange> changes, HandlerContext<LiveMsg.Session> context) {
    if (changes.isEmpty() || (s.lastSent < 0 && !s.awaitingSnapshot)) {
      return;
    }
    if (s.awaitingSnapshot) {
      if (s.kept.size() + changes.size() > MAX_KEPT) {
        s.kept.clear();
        s.resyncAfterSnapshot = true;
      } else {
        s.kept.addAll(changes);
      }
      return;
    }
    List<StoreChange> fresh = changes.stream().filter(c -> c.event().sequenceNo() > s.lastSent).toList();
    for (int i = 0; i < fresh.size(); i++) {
      if (fresh.get(i).event().sequenceNo() != s.lastSent + 1 + i) {
        LOG.info("Live session {}: change event {} missing for {}; sending a fresh snapshot", id, s.lastSent + 1 + i, s.id);
        requestSnapshot(s, context);
        return;
      }
    }
    if (fresh.isEmpty()) {
      return;
    }
    HeldMove held = s.held;
    if (held != null) {
      long at = held.sequenceNo();
      List<StoreChange> upTo = fresh.stream().filter(c -> c.event().sequenceNo() <= at).toList();
      if (!upTo.isEmpty()) {
        judge(s, upTo);
      }
      if (s.lastSent >= at) {
        s.held = null;
        applyMove(s, held.move(), held.filled(), List.of());
        List<StoreChange> rest = fresh.subList(upTo.size(), fresh.size());
        if (!rest.isEmpty()) {
          judge(s, rest);
        }
        maybeMove(s, context);
      }
      return;
    }
    judge(s, fresh);
    if (s.pending != null && !s.moveAsked) {
      maybeMove(s, context); // a move dropped by judge (too many changes meanwhile) is asked for again
    }
  }

  /** Judges changes that continue the subscription without a gap, and sends what its browser must know. */
  private void judge(Sub s, List<StoreChange> fresh) {
    List<StoreChange> since = s.sinceAsk;
    if (since != null && since.size() + fresh.size() > MAX_KEPT) {
      // Too much changed while the move is out (review F7): drop it and ask for it again afresh.
      Move move = s.asked;
      endMove(s);
      s.moveAsks++; // its answers are no longer awaited
      if (s.pending == null) {
        s.pending = move;
      }
    } else if (since != null) {
      since.addAll(fresh);
    }
    // Judged up to the last change, also when it is in a workspace this subscription does not get:
    // its sequenceNo still tells the browser that a change of its own has been judged.
    long sequenceNo = fresh.getLast().event().sequenceNo();
    List<StoreChange> mine = visible(s, fresh);
    switch (s.kind) {
      case WHOLE -> sendChanges(s, mine.stream().map(StoreChange::event).toList(), sequenceNo);
      case COUNTS -> {
        boolean changed = count(Objects.requireNonNull(s.counts), mine);
        sendChanges(s, mine.stream().map(StoreChange::event).filter(e -> e.entityType() == EntityType.LAYER).toList(), sequenceNo);
        if (changed) {
          ObjectNode message = envelope("counts", s.id);
          message.put("sequenceNo", sequenceNo);
          message.set("counts", counts(s.counts));
          send(message);
        }
      }
      case AREA -> {
        AreaView.Update update = Objects.requireNonNull(s.view).apply(mine);
        sendChanges(s, update.events(), sequenceNo);
        sendAreaObjects(s, update, sequenceNo);
        if (update.clusters() != null) {
          send(clusters(s, update.clusters(), sequenceNo));
        }
      }
    }
    s.lastSent = sequenceNo;
  }

  /** Follows the objects per layer, every layer counted (0 when empty); true if the counts changed. */
  private static boolean count(Map<UUID, Integer> counts, List<StoreChange> changes) {
    boolean changed = false;
    for (StoreChange c : changes) {
      ChangeEvent event = c.event();
      if (event.entityType() == EntityType.LAYER) {
        if (event.operation() == Operation.CREATE) {
          counts.putIfAbsent(event.entityId(), 0);
          changed = true;
        } else if (event.operation() == Operation.DELETE) {
          counts.remove(event.entityId()); // only empty layers are deleted (model rule 11)
          changed = true;
        }
        continue;
      }
      UUID before = c.before() == null ? null : c.before().content().layerId();
      UUID after = event.state() instanceof MapObject o ? o.content().layerId() : null;
      if (!Objects.equals(before, after)) {
        if (before != null) {
          counts.merge(before, -1, Integer::sum);
        }
        if (after != null) {
          counts.merge(after, 1, Integer::sum);
        }
        changed = true;
      }
    }
    return changed;
  }

  // ---- Moves ------------------------------------------------------------------------------------

  /** Asks the object store for the latest area the browser named, if nothing is in the way. */
  private void maybeMove(Sub s, HandlerContext<LiveMsg.Session> context) {
    Move move = s.pending;
    if (move == null || s.moveAsked || s.moveDue || s.held != null || s.awaitingSnapshot || closed) {
      return;
    }
    long now = runtime.nanoTime();
    long second = Duration.ofSeconds(1).toNanos();
    while (!recentMoves.isEmpty() && recentMoves.peekFirst() <= now - second) {
      recentMoves.pollFirst();
    }
    long wait = s.moveTaken ? s.lastMoveNanos + MIN_AREA_INTERVAL.toNanos() - now : 0;
    if (recentMoves.size() >= MAX_MOVES_PER_SECOND) {
      wait = Math.max(wait, recentMoves.peekFirst() + second - now);
    }
    if (wait > 0) {
      s.moveDue = true;
      WorkerHandle<LiveMsg.Session> self = context.self();
      LiveMsg.Session due = new LiveMsg.Session.MoveDue(s.id, s.token);
      runtime.schedule(Duration.ofNanos(wait), () -> runtime.deliverAlways(self, () -> due));
      return;
    }
    s.pending = null;
    s.moveAsked = true;
    s.asked = move;
    s.moveTaken = true;
    s.lastMoveNanos = now;
    recentMoves.addLast(now);
    s.sinceAsk = new ArrayList<>();
    String sid = s.id;
    long token = s.token;
    long ask = ++s.moveAsks;
    Set<String> named = s.workspaces;
    context.<StoreMsg, AreaSnapshot>ask(objectStore, reply -> new StoreMsg.GetArea(move.area(), true, named, reply), SNAPSHOT_TIMEOUT,
        answer -> new LiveMsg.Session.Moved(sid, token, ask, move.area(), move.resolution(), answer));
  }

  private void moved(Sub s, Move move, Answer<AreaSnapshot> answer, HandlerContext<LiveMsg.Session> context) {
    switch (answer) {
      case Answer.Ok<AreaSnapshot> ok -> {
        AreaSnapshot at = ok.value();
        if (heldBesides(s) + at.objects().size() > maxHeld) {
          endMove(s);
          error(null, s.id, "area of " + s.id + " not moved: it holds " + at.objects().size()
              + " objects, and this connection may hold at most " + maxHeld + " in its areas");
          break;
        }
        // The fill worker makes the new view (rule C7). Until it answers the move stays asked for, and the
        // changes judged meanwhile are kept, as while the object store was asked.
        String sid = s.id;
        long token = s.token;
        long ask = s.moveAsks;
        int budget = s.budget;
        context.<AreaFill.Fill, AreaView.Filled>ask(fill, reply -> new AreaFill.Fill(move.area(), move.resolution(), budget, at, reply),
            SNAPSHOT_TIMEOUT, filled -> new LiveMsg.Session.MoveFilled(sid, token, ask, move.area(), move.resolution(), at, filled));
        return;
      }
      case Answer.TimedOut<AreaSnapshot> t -> {
        endMove(s);
        LOG.warn("Live session {}: no area for {} from the object store within {}; asking again", id, s.id, SNAPSHOT_TIMEOUT);
        if (s.pending == null) {
          s.pending = move;
        }
      }
      case Answer.Failed<AreaSnapshot> failed -> {
        endMove(s);
        error(null, s.id, "the area could not be queried: " + failed.reason());
      }
    }
    maybeMove(s, context);
  }

  /** The move asked for is over: no more changes are kept for it. */
  private static List<StoreChange> endMove(Sub s) {
    s.moveAsked = false;
    s.asked = null;
    List<StoreChange> since = Objects.requireNonNullElse(s.sinceAsk, List.of());
    s.sinceAsk = null;
    return since;
  }

  /** The fill worker's view for a move: applied once the subscription has judged the changes up to its answer. */
  private void moveFilled(Sub s, Move move, AreaSnapshot answer, Answer<AreaView.Filled> filled, HandlerContext<LiveMsg.Session> context) {
    List<StoreChange> since = endMove(s);
    switch (filled) {
      case Answer.Ok<AreaView.Filled> ok -> {
        s.moveFillFailures = 0;
        long at = answer.sequenceNo();
        if (s.lastSent >= at) {
          applyMove(s, move, ok.value(), since.stream().filter(c -> c.event().sequenceNo() > at).toList());
        } else {
          s.held = new HeldMove(move, at, ok.value()); // the batches up to it are still on their way
          return;
        }
      }
      case Answer.TimedOut<AreaView.Filled> t -> moveFillFailed(s, move, "was not filled within " + SNAPSHOT_TIMEOUT);
      case Answer.Failed<AreaView.Filled> failed -> moveFillFailed(s, move, "could not be filled: " + failed.reason());
    }
    maybeMove(s, context);
  }

  /** Asks for the move again (a newer one the browser sent meanwhile wins), at most {@link #MAX_FILL_TRIES} times in a row. */
  private void moveFillFailed(Sub s, Move move, String why) {
    if (++s.moveFillFailures < MAX_FILL_TRIES) {
      LOG.warn("Live session {}: the new area of {} {}; asking again", id, s.id, why);
      if (s.pending == null) {
        s.pending = move;
      }
    } else {
      s.moveFillFailures = 0;
      error(null, s.id, "area of " + s.id + " not moved: it " + why);
    }
  }

  /** The objects the session's other area subscriptions hold (conformance review F1: memory per browser). */
  private long heldBesides(Sub s) {
    long held = 0;
    for (Sub other : subs.values()) {
      AreaView view = other.view;
      if (other != s && view != null) {
        held += view.memberCount();
      }
    }
    return held;
  }

  /** Replaces the view with one of the new area, brought to the same change, and tells the browser the difference. */
  private void applyMove(Sub s, Move move, AreaView.Filled filled, List<StoreChange> after) {
    if (heldBesides(s) + filled.members().size() > maxHeld) {
      error(null, s.id, "area of " + s.id + " not moved: it holds " + filled.members().size()
          + " objects, and this connection may hold at most " + maxHeld + " in its areas");
      return;
    }
    AreaView next = AreaView.of(filled);
    List<StoreChange> mine = visible(s, after);
    if (!mine.isEmpty()) {
      next.apply(mine); // what the old view has judged since the answer; the browser learns it from the difference
    }
    AreaView.Update update = next.movedFrom(Objects.requireNonNull(s.view));
    s.view = next;
    s.area = move;
    sendAreaObjects(s, update, s.lastSent);
    if (update.clusters() != null) {
      send(clusters(s, update.clusters(), s.lastSent));
    }
  }

  // ---- To the browser ---------------------------------------------------------------------------

  /** One {@code changes} message, also with no events, or several of at most {@link #perMessage} events. */
  private void sendChanges(Sub s, List<ChangeEvent> events, long sequenceNo) {
    int from = 0;
    do {
      List<ChangeEvent> part = events.subList(from, Math.min(events.size(), from + perMessage));
      from += perMessage;
      ObjectNode message = envelope("changes", s.id);
      message.put("sequenceNo", from >= events.size() ? sequenceNo : part.getLast().sequenceNo());
      ArrayNode array = message.putArray("events");
      part.forEach(e -> array.add(json.toTree(e)));
      send(message);
    } while (from < events.size() && !closed);
  }

  private void sendAreaObjects(Sub s, AreaView.Update update, long sequenceNo) {
    if (!update.hasAreaObjects()) {
      return;
    }
    List<MapObject> entered = update.entered();
    List<UUID> left = update.left();
    for (int i = 0, e = 0, l = 0; (e < entered.size() || l < left.size()) && !closed; i++) {
      ObjectNode message = envelope("area-objects", s.id);
      message.put("sequenceNo", sequenceNo);
      ArrayNode objects = message.putArray("entered");
      entered.subList(e, Math.min(entered.size(), e + perMessage)).forEach(o -> objects.add(json.toTree(o)));
      ArrayNode ids = message.putArray("left");
      left.subList(l, Math.min(left.size(), l + LEFT_PER_MESSAGE)).forEach(id -> ids.add(id.toString()));
      e = Math.min(entered.size(), e + perMessage);
      l = Math.min(left.size(), l + LEFT_PER_MESSAGE);
      send(message);
    }
  }

  private ObjectNode clusters(Sub s, AreaView.Clusters clusters, long sequenceNo) {
    ObjectNode message = envelope("clusters", s.id);
    message.put("sequenceNo", sequenceNo);
    message.put("level", clusters.level());
    message.put("full", clusters.full());
    ArrayNode upsert = message.putArray("upsert");
    for (AreaView.ClusterOut c : clusters.upsert()) {
      ObjectNode cluster = upsert.addObject();
      cluster.put("cell", c.cell());
      ArrayNode position = cluster.putArray("position");
      position.add(round(c.lon()));
      position.add(round(c.lat()));
      cluster.put("count", c.count());
      cluster.set("byLayer", counts(c.byLayer()));
      ObjectNode identities = cluster.putObject("byIdentity");
      for (Identity identity : Identity.values()) {
        identities.put(identity.json, c.byIdentity().get(identity.ordinal()));
      }
    }
    ArrayNode remove = message.putArray("remove");
    clusters.remove().forEach(remove::add);
    return message;
  }

  /** Degrees to 7 decimals (about a centimetre): enough for a cluster's mean. */
  private static double round(double degrees) {
    return Math.round(degrees * 1e7) / 1e7;
  }

  private static ObjectNode counts(Map<UUID, Integer> counts) {
    ObjectNode node = JsonNodeFactory.instance.objectNode();
    counts.entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(e -> node.put(e.getKey().toString(), e.getValue()));
    return node;
  }

  private ObjectNode changeOutcome(@Nullable ChangeOutcome outcome, UUID requestId) {
    ObjectNode message = envelope("change-outcome", null);
    message.put("requestId", requestId.toString());
    switch (outcome) {
      case ChangeOutcome.Applied applied -> {
        message.put("outcome", "applied");
        message.set("event", json.toTree(applied.event()));
      }
      case ChangeOutcome.Rejected rejected -> {
        message.put("outcome", "rejected");
        message.set("rejection", json.toTree(rejected.rejection()));
      }
      case null -> message.put("outcome", "unknown");
    }
    return message;
  }

  private void error(@Nullable UUID requestId, @Nullable String subscription, String text) {
    ObjectNode message = envelope("error", subscription);
    if (requestId != null) {
      message.put("requestId", requestId.toString());
    }
    message.put("message", limit(text));
    send(message);
  }

  private static ObjectNode envelope(String type, @Nullable String subscription) {
    ObjectNode message = JsonNodeFactory.instance.objectNode();
    message.put("type", type);
    if (subscription != null) {
      message.put("subscription", subscription);
    }
    return message;
  }

  private void send(ObjectNode message) {
    send(message, null);
  }

  private void send(ObjectNode message, @Nullable Runnable afterSent) {
    if (closed) {
      return;
    }
    if (writer.send(new LiveMsg.Writer.Text(message.toString(), afterSent)) != SendOutcome.ACCEPTED) {
      LOG.warn("Live session {}: the browser does not keep up; closing the session", id);
      closed = true;
      runtime.deliverAlways(writer, () -> new LiveMsg.Writer.Close(LiveSink.TRY_AGAIN_LATER, "the browser does not keep up"));
    }
  }

  // ---- Helpers ----------------------------------------------------------------------------------

  private Instant now() {
    return clock.instant().truncatedTo(ChronoUnit.MILLIS);
  }

  private static String limit(String text) {
    return text.length() > MAX_MESSAGE ? text.substring(0, MAX_MESSAGE - 1) + "…" : text;
  }

  private static String summary(List<Problem> problems) {
    return problems.stream().limit(3).map(p -> (p.path().isEmpty() ? "" : p.path() + ": ") + p.problem())
        .reduce((a, b) -> a + "; " + b).orElse("invalid");
  }

  /** An id as the model writes it (lowercase), else null. */
  private static @Nullable UUID id(@Nullable JsonNode node) {
    return node != null && node.isString() && ID.matcher(node.asString()).matches() ? UUID.fromString(node.asString()) : null;
  }

  private static @Nullable UUID uuid(@Nullable JsonNode node) {
    try {
      return node != null && node.isString() ? UUID.fromString(node.asString()) : null;
    } catch (IllegalArgumentException e) {
      return null;
    }
  }

  private static String text(@Nullable JsonNode node) {
    if (node == null || !node.isString()) {
      throw new IllegalArgumentException("not a string");
    }
    return node.asString();
  }
}
