package dev.emcc.sdk.testkit;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginLog;
import dev.emcc.sdk.connection.ConnectionEvent;
import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.connection.ConnectionSpec;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.Connections;
import dev.emcc.sdk.connection.Restart;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.Coalescing;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.SocketAddress;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.2.0: the connection tasks of {@link FakePluginContext} ({@code ctx.connections()};
 * ADR-0036). Like ECore, it runs each task on a platform thread of its own (CR-0027, so that a test
 * of a two-way link cannot hang on Windows), with a fresh task from the factory for every run, an
 * inbox with the spec's capacity and overflow, restarts with the spec's back-off in virtual time,
 * fencing, child tasks stopped with their parent, and a cap.
 *
 * <p><b>Tasks really run</b>, concurrently with the test, since they may open real sockets on
 * loopback. What a task does to the plugin (its sends to workers, its events) is handed to the
 * test thread and happens at the next {@code ctx.runUntilIdle()}. A task waiting for its inbox can
 * be waited for: {@link FakeTask#awaitIdle()} returns once it waits in {@code take} or {@code poll}
 * with an empty inbox, or has ended.
 *
 * <p>One difference from ECore: a task's {@code send} returns {@link SendResult#ACCEPTED} or {@link
 * SendResult#CLOSED} at once, and the worker's mailbox policy applies at the delivery; a message
 * it drops is counted in {@link FakeTask#droppedSends()}.
 *
 * <pre>{@code
 * var ctx = FakePluginContext.builder("cot").settings(links).build();
 * plugin.init(ctx);
 * plugin.start();
 * FakeTask<?> out = ctx.connectionTask("tak-out");
 * out.awaitIdle();                             // waiting for its inbox
 * ctx.runUntilIdle();                          // its events and sends reach the workers
 * out.fail("connection reset");                // its registered sockets close, take throws
 * out.awaitIdle();
 * ctx.advance(Duration.ofSeconds(1));          // the back-off, then a fresh run
 * }</pre>
 */
public final class FakeConnections implements Connections {

  /** How long {@link FakeTask#awaitIdle()} waits, in real time, before the test fails. */
  public static final Duration WAIT_LIMIT = Duration.ofSeconds(10);

  private final FakePluginContext ctx;
  private final int maxTasks;
  private final Map<String, SSLContext> credentials;
  private final Map<String, String> refusedCredentials;
  /** Tasks not stopped, children included, by name. Guarded by {@code this}. */
  private final Map<String, Task<?>> active = new LinkedHashMap<>();
  /** Every task started, by name, the latest of each name. Guarded by {@code this}. */
  private final Map<String, Task<?>> latest = new LinkedHashMap<>();
  /** What tasks hand to the test thread: deliveries, events, ends. */
  private final ConcurrentLinkedQueue<Runnable> toTestThread = new ConcurrentLinkedQueue<>();

  FakeConnections(FakePluginContext ctx, int maxTasks, Map<String, SSLContext> credentials, Map<String, String> refusedCredentials) {
    this.ctx = ctx;
    this.maxTasks = maxTasks;
    this.credentials = Map.copyOf(credentials);
    this.refusedCredentials = Map.copyOf(refusedCredentials);
  }

  // ---------------------------------------------------------------- Connections

  @Override
  public <I extends Message> ConnectionRef<I> start(ConnectionSpec<I> spec, Supplier<? extends ConnectionTask<I>> factory) {
    return begin(spec, factory, spec.name(), null, event -> {});
  }

  @Override
  public <I extends Message, M extends Message> ConnectionRef<I> start(
      ConnectionSpec<I> spec, Supplier<? extends ConnectionTask<I>> factory, WorkerRef<M> events, Function<ConnectionEvent, ? extends M> toMessage) {
    Objects.requireNonNull(events, "events");
    Objects.requireNonNull(toMessage, "toMessage");
    return begin(spec, factory, spec.name(), null, event -> ctx.deliverAlways(events, () -> toMessage.apply(event)));
  }

  private synchronized <I extends Message> ConnectionRef<I> begin(
      ConnectionSpec<I> spec, Supplier<? extends ConnectionTask<I>> factory, String name, @Nullable Task<?> parent, Consumer<ConnectionEvent> events) {
    Objects.requireNonNull(spec, "spec");
    Objects.requireNonNull(factory, "factory");
    if (active.containsKey(name)) {
      throw new IllegalArgumentException("the plugin already has a connection task named " + name);
    }
    if (active.size() >= maxTasks) {
      throw new IllegalStateException("too many connection tasks (" + maxTasks + "), children included");
    }
    if (parent != null && parent.stopped) {
      throw new IllegalStateException("task " + parent.name + " is stopping: no new children");
    }
    var task = new Task<>(spec, factory, name, parent, events, new HandleId(ctx.nextId("connection-" + name)));
    active.put(name, task);
    latest.put(name, task);
    if (parent != null) {
      parent.children.add(task);
    }
    launch(task);
    return task.ref;
  }

  // ---------------------------------------------------------------- test controls

  /** The latest task named {@code name} (a child's name has its parent's in front, with a slash). */
  public synchronized FakeTask<?> task(String name) {
    Task<?> t = latest.get(name);
    if (t == null) {
      throw new IllegalArgumentException("no connection task named " + name + " has been started");
    }
    return t.handle;
  }

  /** Stops every task, e.g. at the end of a test; then {@code ctx.runUntilIdle()} reports their ends. */
  public void stopAll() {
    List<Task<?>> all;
    synchronized (this) {
      all = List.copyOf(active.values());
    }
    for (Task<?> t : all) {
      stop(t);
    }
  }

  /** As {@link #task(String)}, typed by the task's inbox type, so that a test reads {@code inbox()} and {@code posted()} typed. */
  @SuppressWarnings("unchecked")
  public synchronized <I extends Message> FakeTask<I> task(String name, Class<I> inboxType) {
    FakeTask<?> t = task(name);
    Task<?> state = latest.get(name);
    if (state == null || !state.spec.inboxType().equals(inboxType)) {
      throw new IllegalArgumentException("task " + name + " takes " + (state == null ? "?" : state.spec.inboxType().getName()) + ", not " + inboxType.getName());
    }
    return (FakeTask<I>) t;
  }

  /** The names of the tasks not stopped, children included. */
  public synchronized List<String> names() {
    return List.copyOf(active.keySet());
  }

  // ---------------------------------------------------------------- run by FakePluginContext.runUntilIdle

  /** Does on the test thread what the tasks handed over. True if anything was done. */
  boolean step() {
    boolean progress = false;
    for (Runnable r; (r = toTestThread.poll()) != null; ) {
      r.run();
      progress = true;
    }
    return progress;
  }

  // ---------------------------------------------------------------- running and ending

  private <I extends Message> void launch(Task<I> task) {
    synchronized (this) {
      if (task.stopped) {
        return;
      }
      var run = new Run<>(task);
      task.run = run;
      task.state = FakeTask.State.RUNNING;
      task.runStartedAt = ctx.now();
      Instant at = ctx.clock();
      toTestThread.add(() -> task.events.accept(new ConnectionEvent.Running(task.name, at)));
      run.thread.start();
    }
  }

  /** Test thread: a run ended; restart it, or end the task for good. */
  private <I extends Message> void ended(Task<I> task, Run<I> run, String reason, boolean threw) {
    List<Task<?>> children;
    synchronized (this) {
      children = List.copyOf(task.children);
      task.children.clear();
    }
    for (Task<?> child : children) {
      stop(child); // children belong to their parent's run
    }
    if (task.stopped) {
      endForGood(task, FakeTask.State.STOPPED, new ConnectionEvent.Stopped(task.name, ctx.clock()));
      return;
    }
    Restart restart = task.spec.restart();
    dev.emcc.sdk.connection.Backoff backoff =
        switch (restart) {
          case Restart.Never n -> null;
          case Restart.OnFailure f -> threw ? f.backoff() : null;
          case Restart.Always a -> a.backoff();
        };
    if (backoff == null) {
      if (threw) {
        ctx.logNamed("connection " + task.name).warn("the connection task failed: {}", reason);
        endForGood(task, FakeTask.State.FAILED, new ConnectionEvent.Failed(task.name, ctx.clock(), reason));
      } else {
        endForGood(task, FakeTask.State.STOPPED, new ConnectionEvent.Stopped(task.name, ctx.clock()));
      }
      return;
    }
    if (ctx.now().minus(task.runStartedAt).compareTo(backoff.max()) >= 0) {
      task.failures = 0; // it ran long enough: the back-off starts again
    }
    Duration delay = backoff.delay(task.failures++);
    task.state = FakeTask.State.RESTARTING;
    task.restarts++;
    task.events.accept(new ConnectionEvent.Restarting(task.name, ctx.clock(), reason, ctx.clock().plus(delay)));
    ctx.after(delay, () -> launch(task));
  }

  private void endForGood(Task<?> task, FakeTask.State state, ConnectionEvent event) {
    if (task.endedForGood) {
      return;
    }
    task.endedForGood = true;
    synchronized (this) {
      task.state = state;
      task.stopped = true;
      active.remove(task.name, task);
      if (task.parent != null) {
        task.parent.children.remove(task);
      }
    }
    task.events.accept(event);
  }

  /** Any thread: stops the task and its children. */
  private void stop(Task<?> task) {
    List<Task<?>> children;
    boolean running;
    synchronized (this) {
      if (task.stopped) {
        return;
      }
      Run<?> current = task.run;
      if (current != null) {
        current.fenced = true; // before stopped, so that a run that sees the stop is fenced already
      }
      task.stopped = true;
      active.remove(task.name, task);
      children = List.copyOf(task.children);
      running = current != null && !current.finished;
    }
    task.wakeUp();
    Run<?> run = task.run;
    if (run != null) {
      run.closeAll();
    }
    for (Task<?> child : children) {
      stop(child);
    }
    if (!running) {
      // Waiting for a restart, or never ran: nothing will end, so it ends here.
      toTestThread.add(() -> endForGood(task, FakeTask.State.STOPPED, new ConnectionEvent.Stopped(task.name, ctx.clock())));
    }
  }

  // ---------------------------------------------------------------- state

  private final class Task<I extends Message> {
    final ConnectionSpec<I> spec;
    final Supplier<? extends ConnectionTask<I>> factory;
    final String name;
    final @Nullable Task<?> parent;
    final Consumer<ConnectionEvent> events;
    final FakeRef<I> ref;
    final FakeTask<I> handle;
    final List<Task<?>> children = new ArrayList<>();
    final ReentrantLock lock = new ReentrantLock();
    final Condition changed = lock.newCondition();
    final ArrayDeque<I> inbox = new ArrayDeque<>();
    final List<I> posted = new ArrayList<>();
    final Map<String, Long> counters = new ConcurrentHashMap<>();
    final Map<String, String> details = new ConcurrentHashMap<>();
    volatile @Nullable SocketAddress listening;
    volatile @Nullable SocketAddress peer;
    volatile @Nullable Instant lastActivity;
    volatile boolean stopped;
    volatile boolean waiting;
    volatile FakeTask.State state = FakeTask.State.STARTING;
    volatile @Nullable Run<I> run;
    volatile int droppedSends;
    int failures;
    int restarts;
    /** Test thread: the end for good has been reported. */
    boolean endedForGood;
    Duration runStartedAt = Duration.ZERO;

    Task(ConnectionSpec<I> spec, Supplier<? extends ConnectionTask<I>> factory, String name, @Nullable Task<?> parent, Consumer<ConnectionEvent> events, HandleId id) {
      this.spec = spec;
      this.factory = factory;
      this.name = name;
      this.parent = parent;
      this.events = events;
      this.ref = new FakeRef<>(this, id);
      this.handle = new FakeTask<>(this);
    }

    SendResult post(I item) {
      Objects.requireNonNull(item, "item");
      if (stopped) {
        return SendResult.CLOSED;
      }
      lock.lock();
      try {
        posted.add(item);
        SendResult result = offer(item);
        changed.signalAll();
        return result;
      } finally {
        lock.unlock();
      }
    }

    /** Under {@code lock}: the inbox's overflow policy, as a worker's mailbox has it. */
    private SendResult offer(I item) {
      if (spec.overflow() instanceof Overflow.CoalesceByKey<?> && item instanceof Coalescing c && c.coalesceKey() != null) {
        var replaced = new ArrayDeque<I>(inbox.size());
        boolean done = false;
        for (Iterator<I> it = inbox.iterator(); it.hasNext(); ) {
          I queued = it.next();
          if (!done && queued instanceof Coalescing q && Objects.equals(q.coalesceKey(), c.coalesceKey())) {
            replaced.add(item);
            done = true;
          } else {
            replaced.add(queued);
          }
        }
        if (done) {
          inbox.clear();
          inbox.addAll(replaced);
          return SendResult.ACCEPTED;
        }
      }
      if (inbox.size() < spec.inboxCapacity()) {
        inbox.add(item);
        return SendResult.ACCEPTED;
      }
      if (spec.overflow() instanceof Overflow.DropNewest<?>) {
        return SendResult.DROPPED;
      }
      inbox.poll(); // dropOldest, and coalesceByKey with nothing replaced
      inbox.add(item);
      return SendResult.ACCEPTED;
    }

    /** Task thread: the next item, or null when stopping or (with a deadline) at the deadline. */
    @Nullable I take(Run<I> current, @Nullable Duration timeout) {
      lock.lock();
      try {
        long left = timeout == null ? Long.MAX_VALUE : timeout.toNanos();
        while (inbox.isEmpty() && !stopped && current.failure == null) {
          if (left <= 0) {
            return null;
          }
          waiting = true;
          try {
            left = changed.awaitNanos(Math.min(left, TimeUnit.HOURS.toNanos(1)));
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
          } finally {
            waiting = false;
          }
        }
        String failed = current.failure;
        if (failed != null) {
          throw new UncheckedIOException(new IOException(failed));
        }
        return stopped ? null : inbox.poll();
      } finally {
        lock.unlock();
      }
    }

    void wakeUp() {
      lock.lock();
      try {
        changed.signalAll();
      } finally {
        lock.unlock();
      }
    }

    boolean idle() {
      Run<I> r = run;
      if (r == null || r.finished) {
        return true;
      }
      if (r.failure != null || stopped) {
        return false; // it has to end first
      }
      lock.lock();
      try {
        return waiting && inbox.isEmpty();
      } finally {
        lock.unlock();
      }
    }
  }

  /** One run of a task: its thread, its registered resources, its fence. */
  private final class Run<I extends Message> {
    final Task<I> task;
    final Thread thread;
    final List<AutoCloseable> resources = new ArrayList<>();
    final FakeTaskContextImpl<I> context;
    volatile boolean fenced;
    volatile boolean finished;
    /** Set by {@link FakeTask#fail}: this run, not the next, fails with it. */
    volatile @Nullable String failure;

    Run(Task<I> task) {
      this.task = task;
      this.context = new FakeTaskContextImpl<>(task, this);
      // A platform thread, as in ECore (CR-0027); a daemon, as a virtual thread is, so that a task
      // that never ends cannot keep the test's JVM alive.
      this.thread =
          Thread.ofPlatform().daemon(true).name("fake-connection-" + task.name).unstarted(this::body);
    }

    void body() {
      String reason = "the task returned";
      boolean threw = false;
      try {
        // Like ECore: the factory, too, is plugin code and runs on the task's own thread.
        task.factory.get().run(context);
      } catch (Exception | Error e) {
        reason = e.getMessage() != null ? e.getMessage() : e.toString();
        threw = !task.stopped; // a read that ends because the task was stopped is no failure
      }
      String injected = failure;
      if (injected != null && !task.stopped) {
        reason = injected; // fail(reason) ended this run, also when its socket said "Socket closed"
        threw = true;
      }
      fenced = true;
      closeAll();
      String why = reason;
      boolean failed = threw;
      // Queued before it counts as finished, so that awaitIdle never returns before the end is handed over.
      toTestThread.add(() -> ended(task, this, why, failed));
      finished = true;
    }

    void closeAll() {
      List<AutoCloseable> all;
      synchronized (resources) {
        all = List.copyOf(resources);
      }
      for (AutoCloseable r : all) {
        try {
          r.close();
        } catch (Exception e) {
          // closing is best-effort, as in ECore
        }
      }
    }
  }

  private final class FakeTaskContextImpl<I extends Message> implements TaskContext<I> {
    private final Task<I> task;
    private final Run<I> run;
    private final PluginLog log;

    FakeTaskContextImpl(Task<I> task, Run<I> run) {
      this.task = task;
      this.run = run;
      this.log = ctx.logNamed("connection " + task.name);
    }

    @Override
    public @Nullable I take() {
      return task.take(run, null);
    }

    @Override
    public @Nullable I poll(Duration timeout) {
      Objects.requireNonNull(timeout, "timeout");
      if (timeout.compareTo(Duration.ofMillis(1)) < 0 || timeout.compareTo(Duration.ofHours(1)) > 0) {
        throw new IllegalArgumentException("poll timeout must be 1 ms..1 h: " + timeout);
      }
      return task.take(run, timeout);
    }

    @Override
    public <C extends AutoCloseable> C closeOnStop(C resource) {
      Objects.requireNonNull(resource, "resource");
      synchronized (run.resources) {
        run.resources.add(resource);
      }
      if (run.fenced) {
        run.closeAll(); // registered after the stop: closed at once
      }
      return resource;
    }

    @Override
    public <M extends Message> SendResult send(WorkerRef<M> target, M message) {
      Objects.requireNonNull(target, "target");
      Objects.requireNonNull(message, "message");
      if (run.fenced) {
        return SendResult.CLOSED;
      }
      toTestThread.add(() -> {
        if (ctx.deliver(target, message) == SendResult.DROPPED) {
          task.droppedSends++;
        }
      });
      return SendResult.ACCEPTED;
    }

    @Override
    public <J extends Message> ConnectionRef<J> startChild(ConnectionSpec<J> spec, Supplier<? extends ConnectionTask<J>> factory) {
      if (run.fenced) {
        throw new IllegalStateException("task " + task.name + " is stopping: no new children");
      }
      return begin(spec, factory, task.name + "/" + spec.name(), task, event -> {});
    }

    @Override
    public void count(String name, long delta) {
      task.handle.count(name, delta);
    }

    @Override
    public void detail(String key, String value) {
      task.details.put(Objects.requireNonNull(key, "key"), Objects.requireNonNull(value, "value"));
    }

    @Override
    public void listening(SocketAddress address) {
      task.listening = Objects.requireNonNull(address, "address");
    }

    @Override
    public void peer(SocketAddress address) {
      task.peer = Objects.requireNonNull(address, "address");
    }

    @Override
    public @Nullable Instant lastActivity() {
      return task.lastActivity;
    }

    @Override
    public SSLSocketFactory tls(String name) {
      return sslContext(name).getSocketFactory();
    }

    @Override
    public SSLContext sslContext(String name) {
      return FakeTls.context(credentials, refusedCredentials, name, "FakePluginContext.Builder.tlsCredentials");
    }

    @Override
    public boolean stopping() {
      return task.stopped || run.fenced;
    }

    @Override
    public PluginLog log() {
      return log;
    }

    @Override
    public ConnectionRef<I> self() {
      return task.ref;
    }
  }

  private final class FakeRef<I extends Message> implements ConnectionRef<I> {
    private final Task<I> task;
    private final HandleId id;

    FakeRef(Task<I> task, HandleId id) {
      this.task = task;
      this.id = id;
    }

    @Override
    public HandleId id() {
      return id;
    }

    @Override
    public String name() {
      return task.name;
    }

    @Override
    public SendResult post(I item) {
      return task.post(item);
    }

    @Override
    public void count(String name, long delta) {
      task.handle.count(name, delta);
    }

    @Override
    public void detail(String key, String value) {
      task.details.put(Objects.requireNonNull(key, "key"), Objects.requireNonNull(value, "value"));
    }

    @Override
    public void stop() {
      FakeConnections.this.stop(task);
    }

    @Override
    public boolean equals(@Nullable Object other) {
      return other instanceof FakeConnections.FakeRef<?> r && id.equals(r.id);
    }

    @Override
    public int hashCode() {
      return id.hashCode();
    }

    @Override
    public String toString() {
      return "ConnectionRef[" + task.name + "]";
    }
  }

  /**
   * A test's view of one connection task (from {@link FakePluginContext#connectionTask(String)}):
   * its state, what workers posted, its counters and details, and controls to fail or stop it.
   *
   * @param <I> the type of the task's inbox items
   */
  public final class FakeTask<I extends Message> {

    /** Where a task is, as the monitor view shows it. */
    public enum State { STARTING, RUNNING, RESTARTING, STOPPED, FAILED }

    private final Task<I> task;

    private FakeTask(Task<I> task) {
      this.task = task;
    }

    public String name() {
      return task.name;
    }

    public State state() {
      return task.state;
    }

    /** How often ECore ran a fresh task after a run ended. */
    public int restarts() {
      return task.restarts;
    }

    /** Every item workers posted, in order, also those the overflow dropped. */
    public List<I> posted() {
      task.lock.lock();
      try {
        return List.copyOf(task.posted);
      } finally {
        task.lock.unlock();
      }
    }

    /** The items waiting in the inbox now. */
    public List<I> inbox() {
      task.lock.lock();
      try {
        return List.copyOf(task.inbox);
      } finally {
        task.lock.unlock();
      }
    }

    /** The plugin's own counter {@code name}, 0 if never counted. */
    public long counter(String name) {
      return task.counters.getOrDefault(name, 0L);
    }

    public Map<String, Long> counters() {
      return Map.copyOf(task.counters);
    }

    public Map<String, String> details() {
      return Map.copyOf(task.details);
    }

    public @Nullable SocketAddress listening() {
      return task.listening;
    }

    public @Nullable SocketAddress peer() {
      return task.peer;
    }

    /** Sends to workers that their mailbox dropped at delivery (in the fake, {@code send} returns at once). */
    public int droppedSends() {
      return task.droppedSends;
    }

    /** The names of its children not stopped. */
    public List<String> children() {
      synchronized (FakeConnections.this) {
        return task.children.stream().map(c -> c.name).toList();
      }
    }

    /**
     * Fails the running run as a broken connection does: its registered resources close, so a
     * blocked read ends with an {@code IOException}, and a {@code take} or {@code poll} throws an
     * {@link UncheckedIOException} with {@code reason}. The run's end reports {@code reason}, and
     * the next run starts clean.
     */
    public void fail(String reason) {
      Run<I> run = task.run;
      if (run == null || run.finished) {
        throw new IllegalStateException("task " + task.name + " is not running");
      }
      run.failure = Objects.requireNonNull(reason, "reason");
      task.wakeUp();
      run.closeAll();
    }

    /** Stops the task, as {@link ConnectionRef#stop()} does. */
    public void stop() {
      task.ref.stop();
    }

    /**
     * Waits, in real time, until the task waits in {@code take} or {@code poll} with an empty inbox,
     * or its run has ended; then the test thread can run until idle. Fails after {@link #WAIT_LIMIT}.
     */
    public void awaitIdle() {
      long deadline = System.nanoTime() + WAIT_LIMIT.toNanos();
      while (!task.idle()) {
        if (System.nanoTime() > deadline) {
          throw new AssertionError("connection task " + task.name + " neither waited for its inbox nor ended within " + WAIT_LIMIT);
        }
        Thread.onSpinWait();
        Thread.yield();
      }
    }

    void count(String name, long delta) {
      task.counters.merge(Objects.requireNonNull(name, "name"), delta, Long::sum);
      task.lastActivity = ctx.clock();
    }
  }
}
