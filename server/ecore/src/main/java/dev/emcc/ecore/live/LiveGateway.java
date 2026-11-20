package dev.emcc.ecore.live;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.runtime.MessageHandler;
import dev.emcc.ecore.runtime.Overflow;
import dev.emcc.ecore.runtime.Owner;
import dev.emcc.ecore.runtime.SendOutcome;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.ecore.store.ObjectStore;
import dev.emcc.ecore.store.Requester;
import dev.emcc.ecore.store.StoreMsg;
import dev.emcc.ecore.store.Workspaces;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The live picture gateway (overview 4.5, ADR-0006): the edge opens one {@link LiveSession} per
 * browser WebSocket and passes its text messages in; the gateway answers through the session's
 * {@link LiveSink}. The protocol is in {@code server/live-picture-protocol.md}.
 *
 * <p>Workers, all under the runtime owner {@value #OWNER}: one hub that batches the change events,
 * and per session a session worker (state, change requests) and a writer (the socket).
 */
public final class LiveGateway {

  /** The version of the protocol, sent in {@code welcome}. */
  public static final int PROTOCOL = 2;
  /** How often change events go out to the browsers (spike S2: batches at a limited cadence). */
  public static final Duration BATCH_INTERVAL = Duration.ofMillis(200);
  /** Objects per {@code snapshot-objects} message, and events per {@code changes} message. */
  static final int PER_MESSAGE = 1_000;
  /** Messages a session's writer may hold for a slow browser before the session is closed. */
  static final int WRITER_CAPACITY = 1_000;
  /**
   * Fill requests that may wait per fill worker: every subscription of every session it serves can
   * have one out (200 sessions × 32 subscriptions over the workers). A full mailbox refuses at once,
   * and the session asks again.
   */
  static final int FILL_CAPACITY = 10_000;
  /** The default limit of open sessions. */
  public static final int DEFAULT_MAX_SESSIONS = 200;
  /** The default cap on a subscription's budget (S3 recommendation 6: the budget with a GPU). */
  public static final int DEFAULT_MAX_BUDGET = 100_000;
  /**
   * The most objects one browser's area subscriptions may hold together (conformance review F1):
   * three whole views of 200 000 objects (the map view, draw-symbols and one more), at about 26 MB
   * each (the ITA's note, owner 2026-10-12).
   */
  static final int MAX_HELD = 600_000;
  /**
   * How many characters of a browser's messages may wait for its session at a time (F1): two
   * messages of the largest size (1 Mi characters). Above, the browser sends faster than its session
   * can handle, and the session is closed. Worst case for the server: 2 Mi characters (2 to 4 MiB as
   * Java strings) per session, so 400 to 800 MiB for the default 200 sessions.
   */
  static final long INBOUND_BUDGET = 2L * 1024 * 1024;
  /** The runtime owner of the gateway's workers. */
  public static final String OWNER = "core-live";
  /** How often the hub looks for session or writer workers that hung or failed (F3). */
  static final Duration HEALTH_INTERVAL = Duration.ofSeconds(5);
  /** How often every browser gets a WebSocket ping, so that an idle timeout only ends dead connections (F6). */
  static final Duration KEEPALIVE_INTERVAL = Duration.ofSeconds(30);

  /**
   * The gateway's limits; tests make them small.
   *
   * @param writerBudget the watchdog budget of a writer's socket write
   */
  record Limits(
      Duration batchInterval, int perMessage, int maxSessions, long inboundBudget, Duration writerBudget, int maxBudget, int maxHeld) {
    Limits {
      if (maxSessions < 1) {
        throw new IllegalArgumentException("maxSessions must be at least 1: " + maxSessions);
      }
      if (maxBudget < 1) {
        throw new IllegalArgumentException("maxBudget must be at least 1: " + maxBudget);
      }
    }

    static Limits defaults(int maxSessions, int maxBudget) {
      return new Limits(BATCH_INTERVAL, PER_MESSAGE, maxSessions, INBOUND_BUDGET, WorkerOptions.MAX_BUDGET, maxBudget, MAX_HELD);
    }
  }

  private static final Logger LOG = LoggerFactory.getLogger(LiveGateway.class);

  private final WorkerRuntime runtime;
  private final WorkerHandle<StoreMsg> objectStore;
  private final ModelJson json;
  private final Clock clock;
  private final Limits limits;
  /** Who may see which workspace's layers and objects (ADR-0039 point 7). */
  private final Workspaces workspaces;
  private final Owner owner;
  private final WorkerHandle<LiveMsg.Hub> hub;
  /** The compute workers that fill area views (rule C7), one per compute thread; session n uses number n mod their count. */
  private final List<WorkerHandle<AreaFill.Fill>> fills;
  private final AtomicLong sessionNumbers = new AtomicLong();
  private final AtomicInteger open = new AtomicInteger();
  private final Map<String, LiveSession> sessions = new ConcurrentHashMap<>();
  private volatile Supplier<List<String>> atWelcome = List::of;
  private volatile SessionTimes times = SessionTimes.NONE;

  /**
   * @param maxSessions how many browser sessions may be open at a time
   * @param maxBudget the most objects a subscription gets individually (its {@code budget} is capped by it)
   */
  public LiveGateway(WorkerRuntime runtime, WorkerHandle<StoreMsg> objectStore, ModelJson json, Clock clock, int maxSessions,
      int maxBudget) {
    this(runtime, objectStore, json, clock, maxSessions, maxBudget, new Workspaces());
  }

  /**
   * @param workspaces who may see which workspace (ADR-0039): each session sends its user only what
   *     it may see
   */
  public LiveGateway(WorkerRuntime runtime, WorkerHandle<StoreMsg> objectStore, ModelJson json, Clock clock, int maxSessions,
      int maxBudget, Workspaces workspaces) {
    this(runtime, objectStore, json, clock, Limits.defaults(maxSessions, maxBudget), workspaces);
  }

  LiveGateway(WorkerRuntime runtime, WorkerHandle<StoreMsg> objectStore, ModelJson json, Clock clock, Limits limits) {
    this(runtime, objectStore, json, clock, limits, new Workspaces());
  }

  LiveGateway(WorkerRuntime runtime, WorkerHandle<StoreMsg> objectStore, ModelJson json, Clock clock, Limits limits,
      Workspaces workspaces) {
    this(runtime, objectStore, json, clock, limits, AreaFill::new, workspaces);
  }

  /** With the fill workers' handler from {@code fillHandler} (tests hold fills back with it). */
  LiveGateway(WorkerRuntime runtime, WorkerHandle<StoreMsg> objectStore, ModelJson json, Clock clock, Limits limits,
      Supplier<? extends MessageHandler<AreaFill.Fill>> fillHandler) {
    this(runtime, objectStore, json, clock, limits, fillHandler, new Workspaces());
  }

  LiveGateway(WorkerRuntime runtime, WorkerHandle<StoreMsg> objectStore, ModelJson json, Clock clock, Limits limits,
      Supplier<? extends MessageHandler<AreaFill.Fill>> fillHandler, Workspaces workspaces) {
    this.limits = limits;
    this.workspaces = workspaces;
    this.runtime = runtime;
    this.objectStore = objectStore;
    this.json = json;
    this.clock = clock;
    this.owner = runtime.owner(OWNER);
    this.hub = owner.spawn(WorkerOptions.<LiveMsg.Hub>of("hub", () -> new Hub(runtime, this::workerDead, () -> atWelcome.get()))
        .mailbox(100_000, Overflow.DROP_NEWEST));
    owner.subscribe(ObjectStore.CHANGES, hub, LiveMsg.Hub.Changed::new);
    owner.every(limits.batchInterval(), hub, LiveMsg.Hub.Tick.TICK);
    List<WorkerHandle<AreaFill.Fill>> fillWorkers = new ArrayList<>();
    for (int i = 0; i < runtime.computeThreads(); i++) {
      fillWorkers.add(owner.spawn(WorkerOptions.<AreaFill.Fill>of("area-fill-" + i, fillHandler)
          .compute(true)
          .restartable(true) // stateless: a fresh one after a hang (review F2)
          .mailbox(FILL_CAPACITY, Overflow.DROP_NEWEST)));
    }
    this.fills = List.copyOf(fillWorkers);
  }

  /**
   * A session's worker or writer hung or failed: its browser gets nothing more, so close the socket
   * and the session (F3). Called on the hub's thread, so the closing happens on the runtime's I/O
   * threads: a socket that blocks must not hold up the hub and with it every session.
   */
  private void workerDead(String sessionName) {
    LiveSession session = sessions.get(sessionName);
    if (session != null && session.dead.compareAndSet(false, true)) {
      LOG.error("Live session {}: a worker hung or failed; closing the connection", sessionName);
      runtime.ioExecutor().execute(() -> {
        // The session first: a socket whose close never returns must not keep it (live-hardening R2).
        try {
          session.close();
        } catch (RuntimeException e) {
          LOG.debug("Live session {}: ending the session failed", sessionName, e); // the socket is closed anyway
        }
        try {
          session.sink.close(LiveSink.SERVER_ERROR, "server error");
        } catch (RuntimeException e) {
          LOG.debug("Live session {}: closing failed", sessionName, e);
        }
      });
    }
  }

  /** The writer has closed the socket (or failed to): the session ends too, even if the edge never hears of it. */
  private void writerClosed(String sessionName) {
    LiveSession session = sessions.get(sessionName);
    if (session != null) {
      session.close();
    }
  }

  /** Thrown by {@link #open} when the limit of open sessions is reached. */
  public static final class TooManySessions extends IllegalStateException {
    TooManySessions(int limit) {
      super("too many live sessions (" + limit + ")");
    }
  }

  /**
   * Opens a session for a browser connection and sends it {@code welcome}.
   *
   * @param user the login session's user, fixed for the life of the session: set as {@code
   *     source.user} of its change requests, whose permissions they need (overview 4.4); in the
   *     no-login mode the local user, who has every permission
   * @throws TooManySessions if {@link #openSessions()} has reached the limit
   */
  public LiveSession open(Requester.User user, LiveSink sink) {
    return open(user, new SessionTimes.SessionUser(user.id(), user.id(), user.permissions(), user.all()), sink);
  }

  /**
   * As {@link #open(Requester.User, LiveSink)}, with the user as plugins see it, for the session's
   * times (SDK 1.4.0, {@code SessionTimeChange.user}).
   */
  public LiveSession open(Requester.User user, SessionTimes.SessionUser sdkUser, LiveSink sink) {
    if (open.incrementAndGet() > limits.maxSessions()) {
      open.decrementAndGet();
      throw new TooManySessions(limits.maxSessions());
    }
    try {
      return start(user, sdkUser, sink);
    } catch (RuntimeException | Error e) {
      open.decrementAndGet();
      throw e;
    }
  }

  private LiveSession start(Requester.User user, SessionTimes.SessionUser sdkUser, LiveSink sink) {
    long number = sessionNumbers.incrementAndGet();
    String name = "session-" + number;
    String key = UUID.randomUUID().toString(); // the page's session id (welcome, SessionTimeChange, X-Emc2-Session)
    SessionTimes told = times;
    WorkerHandle<AreaFill.Fill> fill = fills.get((int) (number % fills.size()));
    AtomicLong inbound = new AtomicLong();
    WorkerHandle<LiveMsg.Writer> writer = owner.spawn(
        WorkerOptions.<LiveMsg.Writer>of(name + "-writer", () -> new Writer(name, sink, () -> writerClosed(name)))
            .mailbox(WRITER_CAPACITY, Overflow.DROP_NEWEST)
            .budget(limits.writerBudget()));
    WorkerHandle<LiveMsg.Session> session = owner.spawn(
        WorkerOptions.<LiveMsg.Session>of(name,
                () -> new SessionWorker(name, user, json, runtime, objectStore, fill, writer, clock, limits.perMessage(),
                    limits.maxBudget(), limits.maxHeld(), inbound, workspaces, time -> told.changed(key, time)))
            .mailbox(10_000, Overflow.DROP_NEWEST));
    writer.send(new LiveMsg.Writer.Text("{\"type\":\"welcome\",\"protocol\":" + PROTOCOL + ",\"session\":\"" + key + "\"}"));
    runtime.deliverAlways(hub, () -> new LiveMsg.Hub.Register(session, writer, user.id())); // the hub sends the notices
    told.started(key, sdkUser);
    LiveSession live = new LiveSession(session, writer, inbound, sink, key, told);
    sessions.put(name, live);
    return live;
  }

  /**
   * Messages every browser gets right after {@code welcome}, e.g. {@code data-types} and {@code
   * settings}: complete lists, so a browser that missed a change between loading the page and
   * connecting is current again. The hub reads them once it has registered the session, after the
   * writer has taken {@code welcome}, so a change in between reaches the browser either way.
   */
  public void atWelcome(Supplier<List<String>> notices) {
    this.atWelcome = java.util.Objects.requireNonNull(notices, "notices");
  }

  /**
   * Where the sessions' times go (SDK 1.4.0, ADR-0045): the plugin host's. Sessions opened before
   * keep the one they started with.
   */
  public void sessionTimes(SessionTimes times) {
    this.times = java.util.Objects.requireNonNull(times, "times");
  }

  /**
   * Sends a complete JSON message to every open browser, through the hub. {@code message} is called
   * when the hub sends it, so it gives the value current then: of two quick changes, the last
   * message any browser gets is the latest value, whatever order the callers reach the hub in. A
   * browser whose writer is full misses it (it is about to be disconnected).
   */
  public void broadcast(Supplier<String> message) {
    java.util.Objects.requireNonNull(message, "message");
    runtime.deliverAlways(hub, () -> new LiveMsg.Hub.Broadcast(message));
  }

  /**
   * Sends a complete JSON message to every open browser of {@code user} (the {@code source.user} id
   * its sessions were opened with), through the hub, e.g. SDK 1.4.0's {@code display} notice
   * (ADR-0046 point 6). A browser whose writer is full misses it, as with {@link #broadcast}.
   */
  public void toUser(String user, String message) {
    java.util.Objects.requireNonNull(user, "user");
    java.util.Objects.requireNonNull(message, "message");
    runtime.deliverAlways(hub, () -> new LiveMsg.Hub.ToUser(user, message));
  }

  /** How many sessions are open. */
  public int openSessions() {
    return open.get();
  }

  private static final String BUSY = "{\"type\":\"error\",\"message\":\"the server is busy; message dropped\"}";

  /** One browser connection. */
  public final class LiveSession {
    private final WorkerHandle<LiveMsg.Session> session;
    private final WorkerHandle<LiveMsg.Writer> writer;
    /** Characters of this browser's messages that wait for the session worker (F1). */
    private final AtomicLong inbound;
    private final LiveSink sink;
    private final AtomicBoolean closed = new AtomicBoolean();
    private final AtomicBoolean dead = new AtomicBoolean();
    /** Over the inbound budget: the connection is being closed, further messages are ignored. */
    private final AtomicBoolean closing = new AtomicBoolean();

    /** The page's session id, as {@code welcome} sends it (SDK 1.4.0). */
    private final String key;
    private final SessionTimes times;

    private LiveSession(WorkerHandle<LiveMsg.Session> session, WorkerHandle<LiveMsg.Writer> writer, AtomicLong inbound,
        LiveSink sink, String key, SessionTimes times) {
      this.key = key;
      this.times = times;
      this.session = session;
      this.writer = writer;
      this.inbound = inbound;
      this.sink = sink;
    }

    /** Tells the session it missed changes, as the hub does when it could not hand it a batch (for tests). */
    void missedChanges() {
      runtime.deliverAlways(session, () -> LiveMsg.Session.Resync.RESYNC);
    }

    /**
     * A text message from the browser. Never blocks. A session too busy to take it says so; a
     * browser whose messages waiting for the session exceed the budget is disconnected (1008).
     */
    public void receive(String text) {
      if (closing.get()) {
        return;
      }
      long size = text.length();
      if (inbound.addAndGet(size) > limits.inboundBudget()) {
        inbound.addAndGet(-size);
        if (closing.compareAndSet(false, true)) {
          runtime.deliverAlways(writer,
              () -> new LiveMsg.Writer.Close(LiveSink.POLICY_VIOLATION, "the browser sends faster than it is served"));
        }
        return;
      }
      if (session.send(new LiveMsg.Session.Inbound(text)) != SendOutcome.ACCEPTED) {
        inbound.addAndGet(-size);
        writer.send(new LiveMsg.Writer.Text(BUSY));
      }
    }

    /** The browser has gone: stops the session's workers. Calling it again has no effect. */
    public void close() {
      if (!closed.compareAndSet(false, true)) {
        return;
      }
      sessions.remove(session.name());
      runtime.deliverAlways(hub, () -> new LiveMsg.Hub.Unregister(session));
      owner.stopWorker(session);
      owner.stopWorker(writer);
      open.decrementAndGet();
      times.ended(key); // now, once, for every session (owner, Q10; the ACA's R2)
    }

    /** The page's session id, as {@code welcome} sent it (SDK 1.4.0). */
    public String key() {
      return key;
    }

    String name() {
      return session.name();
    }

    WorkerHandle<LiveMsg.Session> handle() {
      return session;
    }
  }
}
