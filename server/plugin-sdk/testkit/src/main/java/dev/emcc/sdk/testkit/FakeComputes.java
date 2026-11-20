package dev.emcc.sdk.testkit;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginLog;
import dev.emcc.sdk.compute.ComputeContext;
import dev.emcc.sdk.compute.ComputeEvent;
import dev.emcc.sdk.compute.ComputeRef;
import dev.emcc.sdk.compute.ComputeSpec;
import dev.emcc.sdk.compute.ComputeTask;
import dev.emcc.sdk.compute.Computes;
import dev.emcc.sdk.connection.Backoff;
import dev.emcc.sdk.connection.Restart;
import dev.emcc.sdk.folder.LocalFolders;
import dev.emcc.sdk.worker.Coalescing;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
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
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.9.0 (CR-0048 point 5; ADR-0064): the compute tasks of {@link FakePluginContext} ({@code
 * ctx.compute()}). Like ECore, it runs each task on a platform thread of its own, with a fresh task
 * from the factory for every run, an inbox with the spec's capacity and overflow, restarts with the
 * spec's back-off in virtual time, fencing, and the limits: the manifest's declaration, the admin's
 * {@code allowed} and ECore's total cap, counted as running tasks (owner YQ1 A).
 *
 * <p><b>Tasks really run</b>, concurrently with the test. What a task does to the plugin (its sends
 * to workers, its events) is handed to the test thread and happens at the next {@code
 * ctx.runUntilIdle()}. {@link FakeCompute#awaitIdle()} returns once the task waits in {@code take}
 * or {@code poll} with an empty inbox, or has ended.
 *
 * <p><b>Two differences from ECore:</b> a task's {@code send} returns {@link SendResult#ACCEPTED} or
 * {@link SendResult#CLOSED} at once, and the worker's mailbox policy applies at the delivery; and a
 * task that does not end after its stop is not marked {@link ComputeEvent.Hung} (a test sees it in
 * {@link FakeCompute#awaitIdle()}, which fails).
 *
 * <pre>{@code
 * var ctx = FakePluginContext.builder("fmv").compute(2).build();
 * plugin.init(ctx);
 * plugin.start();
 * ctx.runUntilIdle();
 * FakeComputes.FakeCompute<?> camera = ctx.computeTask("camera-north");
 * camera.awaitIdle();                    // waiting for its inbox
 * ctx.runUntilIdle();                    // its events and sends reach the workers
 * ctx.compute().allow(0);                // the admin switches the threads off: the task stops
 * ctx.compute().refuseNext(ComputeEvent.Refusal.TOTAL_CAP);
 * }</pre>
 */
public final class FakeComputes implements Computes {

  /** How long {@link FakeCompute#awaitIdle()} waits, in real time. */
  public static final Duration WAIT_LIMIT = Duration.ofSeconds(10);

  private final FakePluginContext ctx;
  private final int declared;
  private volatile int allowed;
  private volatile int totalCap;
  /** Running tasks by name, in start order (restarting ones included). */
  private final Map<String, Task<?>> active = new LinkedHashMap<>();
  private final Map<String, Task<?>> latest = new LinkedHashMap<>();
  private final ConcurrentLinkedQueue<Runnable> toTestThread = new ConcurrentLinkedQueue<>();
  private final Map<ComputeEvent.Refusal, Integer> refused = new ConcurrentHashMap<>();
  private volatile ComputeEvent.@Nullable Refusal refuseNext;
  private volatile boolean released;

  FakeComputes(FakePluginContext ctx, int declared, int allowed, int totalCap) {
    if (declared < 0 || declared > MAX_DECLARED) {
      throw new IllegalArgumentException("a manifest declares 1 to " + MAX_DECLARED + " compute threads, or none: " + declared);
    }
    this.ctx = ctx;
    this.declared = declared;
    this.allowed = Math.min(allowed, declared);
    this.totalCap = totalCap;
  }

  // ---------------------------------------------------------------- Computes

  @Override
  public <I extends Message> ComputeRef<I> start(ComputeSpec<I> spec, Supplier<? extends ComputeTask<I>> factory) {
    return begin(spec, factory, event -> {});
  }

  @Override
  public <I extends Message, M extends Message> ComputeRef<I> start(
      ComputeSpec<I> spec, Supplier<? extends ComputeTask<I>> factory, WorkerRef<M> events, Function<ComputeEvent, ? extends M> toMessage) {
    Objects.requireNonNull(events, "events");
    Objects.requireNonNull(toMessage, "toMessage");
    return begin(spec, factory, event -> ctx.deliverAlways(events, () -> toMessage.apply(event)));
  }

  @Override
  public int declared() {
    return declared;
  }

  @Override
  public int allowed() {
    return allowed;
  }

  private synchronized <I extends Message> ComputeRef<I> begin(ComputeSpec<I> spec, Supplier<? extends ComputeTask<I>> factory, Consumer<ComputeEvent> events) {
    Objects.requireNonNull(spec, "spec");
    Objects.requireNonNull(factory, "factory");
    if (released) {
      throw new IllegalStateException("the plugin " + ctx.pluginId() + " has stopped");
    }
    if (active.containsKey(spec.name())) {
      throw new IllegalArgumentException("the plugin already runs a compute task named " + spec.name());
    }
    var task = new Task<>(spec, factory, events, new HandleId(ctx.nextId("compute-" + spec.name())));
    latest.put(spec.name(), task);
    ComputeEvent.Refusal refusal = refusal();
    if (refusal != null) {
      refused.merge(refusal, 1, Integer::sum);
      task.stopped = true;
      task.state = FakeCompute.State.REFUSED;
      Instant at = ctx.clock();
      toTestThread.add(() -> events.accept(new ComputeEvent.Refused(spec.name(), at, refusal)));
      return task.ref;
    }
    active.put(spec.name(), task);
    launch(task);
    return task.ref;
  }

  /** Under the monitor: why a start now is refused, or null. */
  private ComputeEvent.@Nullable Refusal refusal() {
    ComputeEvent.Refusal scripted = refuseNext;
    if (scripted != null) {
      refuseNext = null;
      return scripted;
    }
    if (declared == 0) {
      return ComputeEvent.Refusal.NOT_DECLARED;
    }
    if (allowed == 0) {
      return ComputeEvent.Refusal.SWITCHED_OFF;
    }
    if (active.size() >= allowed) {
      return ComputeEvent.Refusal.PLUGIN_LIMIT;
    }
    if (active.size() >= totalCap) {
      return ComputeEvent.Refusal.TOTAL_CAP; // the fake's plugin is the only one: its tasks are the total
    }
    return null;
  }

  // ---------------------------------------------------------------- test controls

  /**
   * What the admin does in the plugin's Settings entry (owner PQ1 A): allows {@code threads} (0 to
   * the declaration). Lowering it below the running tasks stops the newest first, each with {@link
   * ComputeEvent.Stopped} and a reason; 0 stops all.
   */
  public void allow(int threads) {
    if (threads < 0 || threads > declared) {
      throw new IllegalArgumentException("allowed is 0 to the declaration (" + declared + "): " + threads);
    }
    List<Task<?>> excess;
    synchronized (this) {
      allowed = threads;
      List<Task<?>> running = new ArrayList<>(active.values());
      excess = running.size() > threads ? List.copyOf(running.subList(threads, running.size())).reversed() : List.of();
    }
    for (Task<?> t : excess) {
      stop(t, "the admin lowered the plugin's compute threads to " + threads);
    }
  }

  /** ECore's total cap of running compute tasks, which the fake's plugin alone uses. */
  public void totalCap(int tasks) {
    if (tasks < 1) {
      throw new IllegalArgumentException("the total cap is at least 1: " + tasks);
    }
    totalCap = tasks;
  }

  /** Makes the next start refused with {@code refusal}, as when other plugins hold the total cap. */
  public void refuseNext(ComputeEvent.Refusal refusal) {
    refuseNext = Objects.requireNonNull(refusal, "refusal");
  }

  /** How many starts were refused for {@code refusal}, as the Monitor counts them. */
  public int refused(ComputeEvent.Refusal refusal) {
    return refused.getOrDefault(refusal, 0);
  }

  /** The latest compute task named {@code name}, also a refused or stopped one. */
  public synchronized FakeCompute<?> task(String name) {
    Task<?> t = latest.get(name);
    if (t == null) {
      throw new IllegalArgumentException("no compute task named " + name + " has been started");
    }
    return t.handle;
  }

  /** As {@link #task(String)}, typed by the task's inbox type. */
  @SuppressWarnings("unchecked")
  public synchronized <I extends Message> FakeCompute<I> task(String name, Class<I> inboxType) {
    Task<?> t = latest.get(name);
    if (t == null || !t.spec.inboxType().equals(inboxType)) {
      throw new IllegalArgumentException("task " + name + " takes " + (t == null ? "?" : t.spec.inboxType().getName()) + ", not " + inboxType.getName());
    }
    return (FakeCompute<I>) t.handle;
  }

  /** The names of the running tasks (restarting ones included), in start order. */
  public synchronized List<String> names() {
    return List.copyOf(active.keySet());
  }

  /** Stops every task, e.g. at the end of a test; then {@code ctx.runUntilIdle()} reports their ends. */
  public void stopAll() {
    List<Task<?>> all;
    synchronized (this) {
      all = List.copyOf(active.values());
    }
    all.forEach(t -> stop(t, null));
  }

  /** What ECore's plugin host does when the plugin stops: every task stops, and {@code start} throws from then on. */
  public void release() {
    released = true;
    stopAll();
  }

  // ---------------------------------------------------------------- run by FakePluginContext.runUntilIdle

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
      task.state = FakeCompute.State.RUNNING;
      task.runStartedAt = ctx.now();
      Instant at = ctx.clock();
      toTestThread.add(() -> task.events.accept(new ComputeEvent.Running(task.spec.name(), at)));
      run.thread.start();
    }
  }

  /** Test thread: a run ended; restart it, or end the task for good. */
  private <I extends Message> void ended(Task<I> task, String reason, boolean threw) {
    if (task.stopped) {
      endForGood(task, FakeCompute.State.STOPPED, new ComputeEvent.Stopped(task.spec.name(), ctx.clock(), task.stopReason));
      return;
    }
    Backoff backoff =
        switch (task.spec.restart()) {
          case Restart.Never n -> null;
          case Restart.OnFailure f -> threw ? f.backoff() : null;
          case Restart.Always a -> a.backoff();
        };
    if (backoff == null) {
      if (threw) {
        ctx.logNamed("compute " + task.spec.name()).warn("the compute task failed: {}", reason);
        endForGood(task, FakeCompute.State.FAILED, new ComputeEvent.Failed(task.spec.name(), ctx.clock(), reason));
      } else {
        endForGood(task, FakeCompute.State.STOPPED, new ComputeEvent.Stopped(task.spec.name(), ctx.clock(), null));
      }
      return;
    }
    if (ctx.now().minus(task.runStartedAt).compareTo(backoff.max()) >= 0) {
      task.failures = 0;
    }
    Duration delay = backoff.delay(task.failures++);
    task.state = FakeCompute.State.RESTARTING;
    task.restarts++;
    task.events.accept(new ComputeEvent.Restarting(task.spec.name(), ctx.clock(), reason, ctx.clock().plus(delay)));
    ctx.after(delay, () -> launch(task)); // it keeps its place under the limits while it waits
  }

  private void endForGood(Task<?> task, FakeCompute.State state, ComputeEvent event) {
    if (task.endedForGood) {
      return;
    }
    task.endedForGood = true;
    synchronized (this) {
      task.state = state;
      task.stopped = true;
      active.remove(task.spec.name(), task);
    }
    task.events.accept(event);
  }

  /** Any thread: stops the task. */
  private void stop(Task<?> task, @Nullable String reason) {
    boolean running;
    synchronized (this) {
      if (task.stopped) {
        return;
      }
      Run<?> current = task.run;
      if (current != null) {
        current.fenced = true; // before stopped, so that a run that sees the stop is fenced already
      }
      task.stopReason = reason;
      task.stopped = true;
      active.remove(task.spec.name(), task);
      running = current != null && !current.finished;
    }
    task.wakeUp();
    if (!running) {
      toTestThread.add(() -> endForGood(task, FakeCompute.State.STOPPED, new ComputeEvent.Stopped(task.spec.name(), ctx.clock(), reason)));
    }
  }

  /** SDK 1.9.0 (CR-0050): whether {@code ref} is a task of this fake service, so of the same plugin. */
  boolean owns(ComputeRef<?> ref) {
    return ref instanceof FakeComputes.FakeRef<?> r && r.owner() == this;
  }

  // ---------------------------------------------------------------- state

  private final class Task<I extends Message> {
    final ComputeSpec<I> spec;
    final Supplier<? extends ComputeTask<I>> factory;
    final Consumer<ComputeEvent> events;
    final FakeRef<I> ref;
    final FakeCompute<I> handle;
    final ReentrantLock lock = new ReentrantLock();
    final Condition changed = lock.newCondition();
    final ArrayDeque<I> inbox = new ArrayDeque<>();
    final List<I> posted = new ArrayList<>();
    final Map<String, Long> counters = new ConcurrentHashMap<>();
    final Map<String, String> details = new ConcurrentHashMap<>();
    volatile boolean stopped;
    volatile @Nullable String stopReason;
    volatile boolean waiting;
    volatile FakeCompute.State state = FakeCompute.State.STARTING;
    volatile @Nullable Run<I> run;
    volatile int droppedSends;
    int failures;
    int restarts;
    boolean endedForGood;
    Duration runStartedAt = Duration.ZERO;

    Task(ComputeSpec<I> spec, Supplier<? extends ComputeTask<I>> factory, Consumer<ComputeEvent> events, HandleId id) {
      this.spec = spec;
      this.factory = factory;
      this.events = events;
      this.ref = new FakeRef<>(this, id);
      this.handle = new FakeCompute<>(this);
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

    /** Under {@code lock}: the inbox's overflow policy, as for connection tasks. */
    private SendResult offer(I item) {
      if (spec.overflow() instanceof Overflow.CoalesceByKey<?> && item instanceof Coalescing c && c.coalesceKey() != null) {
        for (Iterator<I> it = inbox.iterator(); it.hasNext(); ) {
          if (it.next() instanceof Coalescing q && Objects.equals(q.coalesceKey(), c.coalesceKey())) {
            var replaced = new ArrayDeque<I>(inbox.size());
            for (I queued : inbox) {
              replaced.add(queued instanceof Coalescing k && Objects.equals(k.coalesceKey(), c.coalesceKey()) ? item : queued);
            }
            inbox.clear();
            inbox.addAll(replaced);
            return SendResult.ACCEPTED;
          }
        }
      }
      if (inbox.size() < spec.inboxCapacity()) {
        inbox.add(item);
        return SendResult.ACCEPTED;
      }
      if (spec.overflow() instanceof Overflow.DropNewest<?>) {
        return SendResult.DROPPED;
      }
      inbox.poll();
      inbox.add(item);
      return SendResult.ACCEPTED;
    }

    @Nullable I take(@Nullable Duration timeout) {
      lock.lock();
      try {
        long left = timeout == null ? Long.MAX_VALUE : timeout.toNanos();
        while (inbox.isEmpty() && !stopped) {
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
      if (stopped) {
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

  private final class Run<I extends Message> {
    final Task<I> task;
    final Thread thread;
    final ContextImpl<I> context;
    volatile boolean fenced;
    volatile boolean finished;

    Run(Task<I> task) {
      this.task = task;
      this.context = new ContextImpl<>(task, this);
      // A platform thread, as in ECore (JFR measures its CPU time); a daemon, so that a task that
      // never ends cannot keep the test's JVM alive.
      this.thread = Thread.ofPlatform().daemon(true).name("fake-compute-" + task.spec.name()).unstarted(this::body);
    }

    void body() {
      String reason = "the task returned";
      boolean threw = false;
      try {
        task.factory.get().run(context);
      } catch (Exception | Error e) {
        reason = e.getMessage() != null ? e.getMessage() : e.toString();
        threw = !task.stopped;
      }
      fenced = true;
      String why = reason;
      boolean failed = threw;
      toTestThread.add(() -> ended(task, why, failed));
      finished = true;
    }
  }

  private final class ContextImpl<I extends Message> implements ComputeContext<I> {
    private final Task<I> task;
    private final Run<I> run;
    private final PluginLog log;

    ContextImpl(Task<I> task, Run<I> run) {
      this.task = task;
      this.run = run;
      this.log = ctx.logNamed("compute " + task.spec.name());
    }

    @Override
    public @Nullable I take() {
      return task.take(null);
    }

    @Override
    public @Nullable I poll(Duration timeout) {
      Objects.requireNonNull(timeout, "timeout");
      if (timeout.compareTo(Duration.ofMillis(1)) < 0 || timeout.compareTo(Duration.ofHours(1)) > 0) {
        throw new IllegalArgumentException("poll timeout must be 1 ms..1 h: " + timeout);
      }
      return task.take(timeout);
    }

    @Override
    public boolean stopping() {
      return task.stopped || run.fenced;
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
    public void count(String name, long delta) {
      task.counters.merge(Objects.requireNonNull(name, "name"), delta, Long::sum);
    }

    @Override
    public void detail(String key, String value) {
      if (!task.details.containsKey(Objects.requireNonNull(key, "key")) && task.details.size() >= 32) {
        throw new IllegalStateException("a compute task has at most 32 details");
      }
      task.details.put(key, Objects.requireNonNull(value, "value"));
    }

    @Override
    public LocalFolders folders() {
      return ctx.folders();
    }

    @Override
    public PluginLog log() {
      return log;
    }

    @Override
    public ComputeRef<I> self() {
      return task.ref;
    }
  }

  private final class FakeRef<I extends Message> implements ComputeRef<I> {
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

    /** The fake service that started it. */
    FakeComputes owner() {
      return FakeComputes.this;
    }

    @Override
    public String name() {
      return task.spec.name();
    }

    @Override
    public SendResult post(I item) {
      return task.post(item);
    }

    @Override
    public void stop() {
      FakeComputes.this.stop(task, null);
    }

    @Override
    public boolean equals(@Nullable Object other) {
      return other instanceof FakeComputes.FakeRef<?> r && id.equals(r.id);
    }

    @Override
    public int hashCode() {
      return id.hashCode();
    }

    @Override
    public String toString() {
      return "ComputeRef[" + task.spec.name() + "]";
    }
  }

  /**
   * A test's view of one compute task (from {@link FakePluginContext#computeTask(String)}): its
   * state, what workers posted, its counters and details, and a stop.
   *
   * @param <I> the type of the task's inbox items
   */
  public final class FakeCompute<I extends Message> {

    /** Where a task is, as the Monitor shows it. */
    public enum State { STARTING, RUNNING, RESTARTING, STOPPED, FAILED, REFUSED }

    private final Task<I> task;

    private FakeCompute(Task<I> task) {
      this.task = task;
    }

    public String name() {
      return task.spec.name();
    }

    public State state() {
      return task.state;
    }

    /** How often a fresh task ran after a run ended. */
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

    /** Sends to workers that their mailbox dropped at delivery. */
    public int droppedSends() {
      return task.droppedSends;
    }

    /** Stops the task, as {@link ComputeRef#stop()} does. */
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
          throw new AssertionError("compute task " + task.spec.name() + " neither waited for its inbox nor ended within " + WAIT_LIMIT);
        }
        Thread.onSpinWait();
        Thread.yield();
      }
    }
  }
}
