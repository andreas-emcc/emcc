package dev.emcc.sdk.testkit;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginLog;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.listener.Listener;
import dev.emcc.sdk.listener.ListenerConnection;
import dev.emcc.sdk.listener.ListenerContext;
import dev.emcc.sdk.listener.ListenerEvent;
import dev.emcc.sdk.listener.ListenerRef;
import dev.emcc.sdk.listener.ListenerSpec;
import dev.emcc.sdk.listener.Listeners;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * The listeners of {@link FakePluginContext} ({@code ctx.listeners()}). Like ECore, it allows only
 * endpoints the plugin's current settings name at the manifest's {@code network.endpoints}
 * ({@link FakePluginContext.Builder#networkEndpoints}), reconnects with the spec's back-off in
 * virtual time, ends a connection that stays idle, fences a loop's context when its connection
 * ends, and caps the number of listeners.
 *
 * <p>Each connection is a {@link FakeConnection} the test feeds. Its loop runs on a thread of its
 * own, but <b>only while the test thread waits for it</b>: {@code runUntilIdle()} resumes a loop
 * that has data, or an end, to read, and waits until it reads again with nothing fed, or ends. So
 * tests stay deterministic. A loop that neither reads nor ends within {@link #STEP_LIMIT} fails
 * the test: it computes instead of reading.
 *
 * <pre>{@code
 * var ctx = FakePluginContext.builder("cot-in").networkEndpoints("/streams").settings(streams).build();
 * plugin.init(ctx);
 * plugin.start();
 * ctx.connection("tak-north").feed(event);
 * ctx.runUntilIdle();
 * ctx.listeners().refuse("tak-north", "connection refused");
 * ctx.connection("tak-north").fail("connection reset");
 * ctx.advance(Duration.ofSeconds(1));                       // the first reconnect is refused
 * }</pre>
 */
public final class FakeListeners implements Listeners {

  /** How long one step of a loop may take, in real time, before the test fails. */
  public static final Duration STEP_LIMIT = Duration.ofSeconds(10);

  private final FakePluginContext ctx;
  private final int maxListeners;
  private final Map<String, State> active = new LinkedHashMap<>();
  /** Stopped listeners whose loop has not ended yet. */
  private final List<State> stopping = new ArrayList<>();
  private final Map<String, FakeConnection> lastConnections = new LinkedHashMap<>();
  private final Map<String, String> refusals = new LinkedHashMap<>();

  FakeListeners(FakePluginContext ctx, int maxListeners) {
    this.ctx = ctx;
    this.maxListeners = maxListeners;
  }

  // ---------------------------------------------------------------- Listeners

  @Override
  public ListenerRef start(ListenerSpec spec, Supplier<? extends Listener> factory) {
    return begin(spec, factory, event -> {});
  }

  @Override
  public <M extends Message> ListenerRef start(
      ListenerSpec spec, Supplier<? extends Listener> factory, WorkerRef<M> events, Function<ListenerEvent, ? extends M> toMessage) {
    Objects.requireNonNull(events, "events");
    Objects.requireNonNull(toMessage, "toMessage");
    return begin(spec, factory, event -> ctx.deliverAlways(events, () -> toMessage.apply(event)));
  }

  private ListenerRef begin(ListenerSpec spec, Supplier<? extends Listener> factory, Consumer<ListenerEvent> events) {
    Objects.requireNonNull(spec, "spec");
    Objects.requireNonNull(factory, "factory");
    if (active.containsKey(spec.name())) {
      throw new IllegalArgumentException("the plugin already has a listener named " + spec.name());
    }
    if (active.size() >= maxListeners) {
      throw new IllegalStateException("too many listeners (" + maxListeners + ")");
    }
    String problem = endpointProblem(spec.host(), spec.port());
    if (problem != null) {
      throw new IllegalArgumentException(problem);
    }
    var state = new State(spec, factory, events, new FakeListenerRef(new HandleId(ctx.nextId("listener-" + spec.name())), spec.name()));
    active.put(spec.name(), state);
    connect(state);
    return state.ref;
  }

  // ---------------------------------------------------------------- test controls

  /** The latest connection of the listener named {@code name}. */
  public FakeConnection connection(String name) {
    FakeConnection c = lastConnections.get(name);
    if (c == null) {
      throw new IllegalArgumentException("listener " + name + " has not connected (yet)");
    }
    return c;
  }

  /** Whether the listener named {@code name} has a connection now. */
  public boolean connected(String name) {
    State s = active.get(name);
    return s != null && s.run != null && !s.run.finished;
  }

  /** From now on, connection attempts of the listener named {@code name} fail with {@code reason}. */
  public void refuse(String name, String reason) {
    refusals.put(name, Objects.requireNonNull(reason, "reason"));
  }

  /** Connection attempts of the listener named {@code name} succeed again. */
  public void accept(String name) {
    refusals.remove(name);
  }

  /** Listeners not stopped, by name. */
  public List<String> names() {
    return List.copyOf(active.keySet());
  }

  // ---------------------------------------------------------------- run by FakePluginContext.runUntilIdle

  /** Lets every loop that has something to read run one step; ends finished connections. True if anything happened. */
  boolean step() {
    boolean progress = false;
    var all = new ArrayList<>(active.values());
    all.addAll(stopping);
    for (State s : all) {
      Run run = s.run;
      if (run == null) {
        continue;
      }
      if (run.step()) {
        progress = true;
      }
      if (run.finished) {
        ended(s, run);
        progress = true;
      }
    }
    return progress;
  }

  // ---------------------------------------------------------------- connecting and ending

  private void connect(State s) {
    if (s.stopped) {
      return;
    }
    String problem = endpointProblem(s.spec.host(), s.spec.port());
    if (problem != null) {
      // The settings changed: ECore does not reconnect to an endpoint they no longer name.
      active.remove(s.spec.name());
      s.events.accept(new ListenerEvent.Disconnected(s.spec.name(), ctx.clock(), problem, null));
      return;
    }
    String refusal = refusals.get(s.spec.name());
    if (refusal != null) {
      retryOrEnd(s, refusal);
      return;
    }
    var run = new Run(s);
    s.run = run;
    s.connectedAt = ctx.now();
    lastConnections.put(s.spec.name(), run.connection);
    s.events.accept(new ListenerEvent.Connected(s.spec.name(), ctx.clock()));
    run.touch();
  }

  private void ended(State s, Run run) {
    s.run = null;
    run.context.fenced = true;
    run.connection.markClosed();
    if (run.thrown != null) {
      ctx.listenerLoopFailed(s.spec.name(), run.thrown);
    }
    if (s.stopped) {
      stopping.remove(s);
      s.events.accept(new ListenerEvent.Disconnected(s.spec.name(), ctx.clock(), "stopped", null));
      return;
    }
    var backoff = s.spec.reconnect();
    if (backoff != null && ctx.now().minus(s.connectedAt).compareTo(backoff.max()) >= 0) {
      s.failures = 0; // it stayed up long enough: start the back-off again
    }
    retryOrEnd(s, Objects.requireNonNull(run.reason));
  }

  private void retryOrEnd(State s, String reason) {
    var backoff = s.spec.reconnect();
    if (backoff == null) {
      active.remove(s.spec.name());
      s.events.accept(new ListenerEvent.Disconnected(s.spec.name(), ctx.clock(), reason, null));
      return;
    }
    Duration delay = backoff.delay(s.failures++);
    s.events.accept(new ListenerEvent.Disconnected(s.spec.name(), ctx.clock(), reason, ctx.clock().plus(delay)));
    ctx.after(delay, () -> connect(s));
  }

  private void stop(State s) {
    if (s.stopped || (active.get(s.spec.name()) != s && s.run == null)) {
      return; // already stopped, or ended without a back-off (its name may belong to a new listener now)
    }
    s.stopped = true;
    active.remove(s.spec.name(), s);
    Run run = s.run;
    if (run != null && !run.finished) {
      stopping.add(s);
      run.connection.end(false, "stopped");
      run.context.fenced = true; // what the loop sends from now on is dropped
    } else {
      s.events.accept(new ListenerEvent.Disconnected(s.spec.name(), ctx.clock(), "stopped", null));
    }
  }

  /** Null if the plugin's current settings name {@code host} and {@code port} at a declared place; otherwise why not. */
  private @Nullable String endpointProblem(String host, int port) {
    List<String> pointers = ctx.networkEndpoints();
    if (pointers.isEmpty()) {
      return "the manifest declares no network endpoints (network.endpoints), so the plugin may not open listeners";
    }
    for (String pointer : pointers) {
      for (JsonObject endpoint : endpointsAt(ctx.settings(), pointer)) {
        if (endpoint.get("host") instanceof JsonString h && h.value().equals(host)
            && endpoint.get("port") instanceof JsonNumber p && p.doubleValue() == port) {
          return null;
        }
      }
    }
    return host + ":" + port + " is not an endpoint the plugin's settings name at " + pointers;
  }

  private static List<JsonObject> endpointsAt(JsonObject settings, String pointer) {
    JsonValue at = settings;
    for (String segment : pointer.substring(1).split("/")) {
      if (at instanceof JsonObject o && o.get(segment) != null) {
        at = Objects.requireNonNull(o.get(segment));
      } else if (at instanceof JsonArray a && segment.matches("[0-9]+") && Integer.parseInt(segment) < a.size()) {
        at = a.get(Integer.parseInt(segment));
      } else {
        return List.of();
      }
    }
    if (at instanceof JsonObject o) {
      return List.of(o);
    }
    var found = new ArrayList<JsonObject>();
    if (at instanceof JsonArray a) {
      a.values().forEach(v -> {
        if (v instanceof JsonObject o) {
          found.add(o);
        }
      });
    }
    return found;
  }

  // ---------------------------------------------------------------- state

  private final class State {
    final ListenerSpec spec;
    final Supplier<? extends Listener> factory;
    final Consumer<ListenerEvent> events;
    final FakeListenerRef ref;
    boolean stopped;
    int failures;
    Duration connectedAt = Duration.ZERO;
    @Nullable Run run;

    State(ListenerSpec spec, Supplier<? extends Listener> factory, Consumer<ListenerEvent> events, FakeListenerRef ref) {
      this.spec = spec;
      this.factory = factory;
      this.events = events;
      this.ref = ref;
      ref.state = this;
    }
  }

  private final class FakeListenerRef implements ListenerRef {
    private final HandleId id;
    private final String name;
    @Nullable State state;

    FakeListenerRef(HandleId id, String name) {
      this.id = id;
      this.name = name;
    }

    @Override
    public HandleId id() {
      return id;
    }

    @Override
    public String name() {
      return name;
    }

    @Override
    public void stop() {
      FakeListeners.this.stop(Objects.requireNonNull(state));
    }

    @Override
    public boolean equals(@Nullable Object other) {
      return other instanceof FakeListeners.FakeListenerRef r && id.equals(r.id);
    }

    @Override
    public int hashCode() {
      return id.hashCode();
    }

    @Override
    public String toString() {
      return "ListenerRef[" + name + "]";
    }
  }

  /**
   * One connection and its loop. The loop's thread and the test thread take turns under {@code
   * lock}: exactly one of them runs at a time, so the fake's single-threaded state is never used
   * by both at once, and the lock hand-over makes each side's writes visible to the other.
   */
  private final class Run {
    final State state;
    final FakeConnection connection;
    final FakeListenerContext context;
    final ReentrantLock lock = new ReentrantLock();
    final Condition turn = lock.newCondition();
    final Thread thread;
    boolean listenerTurn;
    boolean started;
    volatile boolean finished;
    @Nullable String reason;
    @Nullable Throwable thrown;
    Duration lastActivity = Duration.ZERO;

    Run(State state) {
      this.state = state;
      this.connection = new FakeConnection(state.spec.name(), state.spec.host(), state.spec.port(), this::touch);
      this.context = new FakeListenerContext(state);
      this.thread = Thread.ofVirtual().name("fake-listener-" + state.spec.name()).unstarted(this::body);
    }

    /** Data arrived: the idle timeout starts again. */
    void touch() {
      lastActivity = ctx.now();
      Duration idle = state.spec.idleTimeout();
      ctx.after(idle, () -> {
        if (state.run == this && !finished && ctx.now().minus(lastActivity).compareTo(idle) >= 0) {
          connection.end(false, "idle for " + idle);
        }
      });
    }

    /** Test thread: lets the loop run until it waits for data or ends. False if it had nothing to do. */
    boolean step() {
      if (finished || (started && !connection.hasInputOrEnd())) {
        return false;
      }
      lock.lock();
      try {
        listenerTurn = true;
        if (started) {
          turn.signalAll();
        } else {
          started = true;
          thread.start();
        }
        long left = STEP_LIMIT.toNanos();
        while (listenerTurn) {
          if (left <= 0) {
            throw new AssertionError("the loop of listener " + state.spec.name() + " neither read nor ended within " + STEP_LIMIT
                + ": a listener reads and passes the work on, it does not compute (docs/plugins/sdk-v1.md)");
          }
          left = turn.awaitNanos(left);
        }
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new IllegalStateException("interrupted while the listener loop ran", e);
      } finally {
        lock.unlock();
      }
      return true;
    }

    /** Loop thread: the plugin's loop, then the hand-back. */
    void body() {
      String why;
      Throwable failure = null;
      try {
        // Like ECore: the factory, too, is plugin code and runs on the loop's own thread.
        Listener loop = state.factory.get();
        loop.run(new FakeListenerConnection(this), context);
        String ended = connection.endReason();
        why = ended != null ? ended : "the listener loop returned";
      } catch (IOException e) {
        why = e.getMessage() != null ? e.getMessage() : e.toString();
      } catch (RuntimeException | Error e) {
        why = "the listener loop threw " + e;
        failure = e;
      }
      lock.lock();
      try {
        reason = why;
        thrown = failure;
        finished = true;
        listenerTurn = false;
        turn.signalAll();
      } finally {
        lock.unlock();
      }
    }

    /** Loop thread: nothing to read yet, so hand the turn back and wait for the next step. */
    void waitForTurn() throws InterruptedIOException {
      lock.lock();
      try {
        listenerTurn = false;
        turn.signalAll();
        while (!listenerTurn) {
          turn.await(1, TimeUnit.HOURS);
        }
      } catch (InterruptedException e) {
        throw new InterruptedIOException("interrupted");
      } finally {
        lock.unlock();
      }
    }
  }

  private static final class FakeListenerConnection implements ListenerConnection {
    private final Run run;
    private final InputStream input;

    FakeListenerConnection(Run run) {
      this.run = run;
      this.input = new InputStream() {
        @Override
        public int read() throws IOException {
          byte[] one = new byte[1];
          int n = read(one, 0, 1);
          return n < 0 ? -1 : one[0] & 0xff;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
          Objects.checkFromIndexSize(off, len, b.length);
          if (len == 0) {
            return 0;
          }
          while (true) {
            int n = run.connection.take(b, off, len);
            if (n != FakeConnection.NOTHING_YET) {
              return n;
            }
            run.waitForTurn();
          }
        }
      };
    }

    @Override
    public InputStream input() {
      return input;
    }

    @Override
    public void write(Bytes data) throws IOException {
      if (data.size() > MAX_WRITE_BYTES) {
        throw new IllegalArgumentException("a listener writes at most " + MAX_WRITE_BYTES + " bytes at a time: " + data.size());
      }
      run.connection.write(data);
    }

    @Override
    public String host() {
      return run.connection.host();
    }

    @Override
    public int port() {
      return run.connection.port();
    }
  }

  private final class FakeListenerContext implements ListenerContext {
    private final State state;
    private final PluginLog log;
    volatile boolean fenced;

    FakeListenerContext(State state) {
      this.state = state;
      this.log = ctx.logNamed("listener " + state.spec.name());
    }

    @Override
    public <M extends Message> SendResult send(WorkerRef<M> target, M message) {
      Objects.requireNonNull(message, "message");
      return fenced ? SendResult.CLOSED : ctx.deliver(target, message);
    }

    @Override
    public PluginLog log() {
      return log;
    }

    @Override
    public boolean stopping() {
      return state.stopped;
    }

    @Override
    public ListenerRef self() {
      return state.ref;
    }
  }
}
