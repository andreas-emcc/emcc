package dev.emcc.ecore.plugin;

import dev.emcc.ecore.plugin.TaskEngine.Change;
import dev.emcc.ecore.runtime.Inbox;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginLog;
import dev.emcc.sdk.compute.ComputeContext;
import dev.emcc.sdk.compute.ComputeEvent;
import dev.emcc.sdk.compute.ComputeEvent.Refusal;
import dev.emcc.sdk.compute.ComputeRef;
import dev.emcc.sdk.compute.ComputeSpec;
import dev.emcc.sdk.compute.ComputeTask;
import dev.emcc.sdk.compute.Computes;
import dev.emcc.sdk.connection.Connections;
import dev.emcc.sdk.folder.LocalFolders;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.lang.management.ManagementFactory;
import java.lang.management.ThreadMXBean;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * One plugin's compute tasks (SDK 1.9.0, CR-0048 point 5, ADR-0064; M9 C7): its {@code
 * context.compute()}. Each task runs on a compute engine of its own ({@link TaskEngine#COMPUTE}): a
 * platform thread per run, a restart with back-off, an inbox, the stop and the fence, as a
 * connection task.
 *
 * <ul>
 *   <li><b>The counting</b> (owner YQ1 A): a task counts against the plugin's {@link #allowed()}
 *       from its start until it is stopped or marked {@link ComputeEvent.Hung}, and against the
 *       server's {@link ComputeHub} until its thread has ended. A start above either is refused: a
 *       stopped ref and {@link ComputeEvent.Refused}, counted per reason; ECore does not retry it.
 *   <li><b>The admin's number</b> ({@link #allowed(int)}, PQ1 A): lowering it stops the newest
 *       tasks first, each {@code Stopped} with a reason; 0 stops all.
 *   <li><b>A task that will not stop</b> within {@link Computes#STOP_GRACE} is {@code Hung}: the
 *       plugin DEGRADED (the {@code watch}), its place in {@code allowed()} free again, its place in
 *       the server's cap kept while its thread lives.
 *   <li><b>The fence:</b> once its run has ended or it is stopped, what the task sends, posts to
 *       itself or posts to a connection task ({@link #onFencedComputeThread}) is dropped.
 * </ul>
 *
 * <p>Locks: this object's monitor guards the list of tasks and the counts, and is taken under an
 * engine task's monitor (a change arrives so) but never the other way round: no engine call is made
 * while it is held (rule C4).
 */
public final class PluginComputes implements Computes {

  /** The most details a task may set (SDK {@code ComputeContext.detail}). */
  static final int MAX_DETAILS = 32;

  private static final Duration MIN_POLL = Duration.ofMillis(1);
  private static final Duration MAX_POLL = Duration.ofHours(1);
  private static final ThreadMXBean THREADS = ManagementFactory.getThreadMXBean();
  /** The compute task whose run this thread is, while it runs: the fence for the SDK's other calls. */
  private static final ThreadLocal<@Nullable Running> CURRENT = new ThreadLocal<>();

  private final String pluginId;
  private final int declared;
  private final String reason;
  private final ComputeHub hub;
  private final WorkerRuntime runtime;
  private final Clock clock;
  private final LocalFolders folders;
  private final TaskEngine engine;
  private final AtomicLong ids = new AtomicLong();
  // Guarded by this.
  private int allowed;
  private final List<Running> tasks = new ArrayList<>(); // oldest first
  private final Map<Refusal, Long> refusals = new EnumMap<>(Refusal.class);
  /** Set when the plugin stops: a start throws, as the SDK says, rather than being refused. */
  private boolean closed;

  /**
   * @param declared the manifest's {@code compute.threads}, 0 without the declaration
   * @param reason the manifest's {@code compute.reason}, empty without it
   * @param allowed the admin's number now, 0 to {@code declared}
   * @param watch told when a task has not ended {@link Computes#STOP_GRACE} after its stop (DEGRADED)
   */
  PluginComputes(String pluginId, int declared, String reason, int allowed, ComputeHub hub, WorkerRuntime runtime,
      @Nullable ClassLoader loader, Clock clock, LocalFolders folders, TaskEngine.Watch watch) {
    this(pluginId, declared, reason, allowed, hub, runtime, loader, clock, folders, watch, STOP_GRACE, runtime::startTaskThread);
  }

  /** With another grace and other threads (tests). */
  PluginComputes(String pluginId, int declared, String reason, int allowed, ComputeHub hub, WorkerRuntime runtime,
      @Nullable ClassLoader loader, Clock clock, LocalFolders folders, TaskEngine.Watch watch, Duration grace, TaskEngine.Threads threads) {
    if (declared < 0 || declared > MAX_DECLARED) {
      throw new IllegalArgumentException("declared compute threads must be 0.." + MAX_DECLARED + ": " + declared);
    }
    this.pluginId = Objects.requireNonNull(pluginId, "pluginId");
    this.declared = declared;
    this.reason = Objects.requireNonNull(reason, "reason");
    this.allowed = clampAllowed(allowed);
    this.hub = Objects.requireNonNull(hub, "hub");
    this.runtime = Objects.requireNonNull(runtime, "runtime");
    this.clock = Objects.requireNonNull(clock, "clock");
    this.folders = Objects.requireNonNull(folders, "folders");
    TaskEngine.Watch hung = new TaskEngine.Watch() {
      @Override
      public void notEnding(String name) {
        hung(name);
        watch.notEnding(name);
      }

      @Override
      public void ended(String name) {
        watch.ended(name);
      }
    };
    this.engine = new TaskEngine(TaskEngine.COMPUTE, pluginId, loader, runtime, MAX_DECLARED, clock, hung, grace, threads);
  }

  /** C7 gap 6: at the plugin's stop, its compute tasks that have not ended, by name ({@link TaskEngine#unended}). */
  java.util.Map<String, TaskEngine.Task> unended() {
    return engine.unended();
  }

  /** C7 gap 6: the last start's {@link #unended} compute tasks; a new task of such a name waits for it. */
  void inheritFrom(java.util.@Nullable Map<String, TaskEngine.Task> previous) {
    engine.inheritFrom(previous);
  }

  private int clampAllowed(int value) {
    return Math.max(0, Math.min(value, declared));
  }

  /** Whether the calling thread runs a compute task's run that is fenced: its SDK calls are dropped. */
  static boolean onFencedComputeThread() {
    Running r = CURRENT.get();
    return r != null && r.fenced();
  }

  @Override
  public <I extends Message> ComputeRef<I> start(ComputeSpec<I> spec, Supplier<? extends ComputeTask<I>> factory) {
    return begin(spec, factory, event -> {});
  }

  @Override
  public <I extends Message, M extends Message> ComputeRef<I> start(ComputeSpec<I> spec, Supplier<? extends ComputeTask<I>> factory,
      WorkerRef<M> events, Function<ComputeEvent, ? extends M> toMessage) {
    Objects.requireNonNull(toMessage, "toMessage");
    EventQueue<ComputeEvent, M> queue = new EventQueue<>(
        runtime, PluginWorkers.handleOf(Objects.requireNonNull(events, "events")), toMessage, Connections.MAX_PENDING_EVENTS);
    return begin(spec, factory, queue::add);
  }

  @Override
  public int declared() {
    return declared;
  }

  @Override
  public synchronized int allowed() {
    return allowed;
  }

  /**
   * The admin's new number (PQ1 A), 0 to {@link #declared()}: above it, the newest running tasks
   * stop first, each with the reason; 0 stops all.
   *
   * @return the number now, clamped
   */
  int allowed(int value) {
    int now = clampAllowed(value);
    List<Running> stop = new ArrayList<>();
    synchronized (this) {
      allowed = now;
      int counted = 0;
      for (Running r : tasks) {
        if (r.counted) {
          counted++;
        }
      }
      for (int i = tasks.size() - 1; i >= 0 && counted > now; i--) {
        Running r = tasks.get(i);
        if (r.counted) {
          r.stopReason = "the admin lowered the plugin's compute threads to " + now;
          uncountLocked(r);
          stop.add(r);
          counted--;
        }
      }
    }
    for (Running r : stop) { // outside this lock: the engine's locks come first
      TaskEngine.Task t = r.task;
      if (t != null) {
        t.stop();
      } // else it is being created: begin stops it once it has its task
    }
    return now;
  }

  /** When the plugin stops: every task stops and no new one starts; a task's place in the cap goes when its thread ends. */
  void stopAll() {
    synchronized (this) {
      closed = true;
      tasks.forEach(this::uncountLocked);
    }
    engine.stopAll();
  }

  private <I extends Message> ComputeRef<I> begin(ComputeSpec<I> spec, Supplier<? extends ComputeTask<I>> factory,
      Consumer<ComputeEvent> events) {
    Objects.requireNonNull(spec, "spec");
    Objects.requireNonNull(factory, "factory");
    String name = spec.name();
    HandleId id = new HandleId(pluginId + "/compute/" + name + "#" + ids.incrementAndGet());
    Refusal refusal = null;
    Running running = new Running(name, events);
    synchronized (this) {
      if (closed) {
        throw new IllegalStateException("plugin " + pluginId + " is stopping");
      }
      if (declared == 0) {
        refusal = Refusal.NOT_DECLARED;
      } else if (allowed == 0) {
        refusal = Refusal.SWITCHED_OFF;
      } else if (tasks.stream().filter(r -> r.counted).count() >= allowed) {
        refusal = Refusal.PLUGIN_LIMIT;
      } else if (!hub.take()) {
        refusal = Refusal.TOTAL_CAP;
      } else {
        running.counted = true;
        running.setCapHeld();
        tasks.add(running);
      }
      if (refusal != null) {
        refusals.merge(refusal, 1L, Long::sum);
      }
    }
    Inbox<I> inbox = new Inbox<>(spec.inboxCapacity(), PluginWorkers.overflow(spec.overflow()));
    Ref<I> ref = new Ref<>(id, name, inbox, running, pluginId);
    if (refusal != null) {
      inbox.close(); // a stopped ref: post answers CLOSED
      events.accept(new ComputeEvent.Refused(name, clock.instant(), refusal));
      return ref;
    }
    TaskEngine.Task task;
    try {
      task = engine.create(name, null, inbox, PluginConnections.rule(spec.restart()),
          () -> attempt -> runOnce(attempt, running, ref, factory), change -> changed(running, change));
    } catch (RuntimeException e) { // a task of that name runs, or the plugin is stopping: no place taken
      synchronized (this) {
        tasks.remove(running);
        uncountLocked(running);
      }
      running.giveCapPlace();
      throw e;
    }
    running.task = task; // before any plugin code can use the handle
    task.launch();
    if (running.stopReason != null) {
      task.stop(); // the admin lowered the number while it was being created
    }
    return ref;
  }

  /** On the task's thread: one run, with its context, fenced when it ends. */
  private <I extends Message> void runOnce(TaskEngine.Attempt attempt, Running running, Ref<I> ref,
      Supplier<? extends ComputeTask<I>> factory) throws Exception {
    Context<I> context = new Context<>(attempt, ref, running);
    running.runStarted(attempt);
    CURRENT.set(running);
    try {
      factory.get().run(context); // plugin code; the factory too: a throw counts as a run that threw
    } finally {
      CURRENT.remove();
      running.runEnded();
    }
  }

  /** A change of a task's state: its event, and at its end its places given back. Under the engine task's monitor. */
  private void changed(Running running, Change change) {
    switch (change) {
      case Change.Running r -> running.events.accept(new ComputeEvent.Running(r.name(), r.at()));
      case Change.Restarting r -> running.events.accept(new ComputeEvent.Restarting(r.name(), r.at(), r.reason(), r.next()));
      case Change.Stopped s -> {
        ended(running);
        running.events.accept(new ComputeEvent.Stopped(s.name(), s.at(), running.stopReason));
      }
      case Change.Failed f -> {
        ended(running);
        running.events.accept(new ComputeEvent.Failed(f.name(), f.at(), f.reason()));
      }
    }
  }

  private void ended(Running running) {
    synchronized (this) {
      tasks.remove(running);
      uncountLocked(running);
    }
    running.giveCapPlace();
  }

  /** The engine found a stopped task of {@code name} still running after the grace: it is hung. */
  private void hung(String name) {
    Running found = null;
    synchronized (this) {
      for (Running r : tasks) {
        if (r.name.equals(name) && !r.hung && r.task != null && r.task.isStopped()) {
          r.hung = true;
          uncountLocked(r);
          found = r;
          break;
        }
      }
    }
    if (found != null) {
      found.events.accept(new ComputeEvent.Hung(name, clock.instant()));
    }
  }

  private void uncountLocked(Running r) {
    r.counted = false;
  }

  /** The plugin's compute threads as the Monitor shows them (ADR-0064 point 5). */
  public Status status() {
    List<Running> all;
    Map<String, Long> refused = new TreeMap<>();
    int counted = 0;
    int allowedNow;
    synchronized (this) {
      all = List.copyOf(tasks);
      refusals.forEach((k, v) -> refused.put(k.name(), v));
      for (Running r : tasks) {
        if (r.counted) {
          counted++;
        }
      }
      allowedNow = allowed;
    }
    List<TaskStatus> each = new ArrayList<>();
    for (Running r : all) { // outside this lock: stats() takes the engine task's monitor
      TaskEngine.Task t = r.task;
      if (t != null) {
        each.add(r.status(t.stats()));
      }
    }
    return new Status(declared, reason, allowedNow, counted, Map.copyOf(refused), List.copyOf(each));
  }

  /**
   * The plugin's compute threads, for the Monitor.
   *
   * @param running the tasks that count against {@code allowed} now
   * @param refusals the refused starts since the plugin started, by {@link Refusal}
   */
  public record Status(int declared, String reason, int allowed, int running, Map<String, Long> refusals, List<TaskStatus> tasks) {}

  /**
   * One compute task, for the Monitor.
   *
   * @param state {@code STARTING}, {@code RUNNING}, {@code RESTARTING}, {@code STOPPING}, {@code STOPPED} or {@code FAILED}
   * @param hung true once it did not end {@link Computes#STOP_GRACE} after its stop
   * @param cpuMillis its runs' CPU time so far, from the thread CPU clock (owner: not JFR); -1 if the JVM has none
   * @param runMillis how long its runs have lasted so far
   * @param waitMillis of those, how long it waited in {@code take} or {@code poll}: the busy share is the rest
   */
  public record TaskStatus(long id, String name, String state, long sinceMillis, long restarts, @Nullable Long nextMillis,
      @Nullable String reason, Map<String, Long> counters, Map<String, String> details, boolean hung, long cpuMillis, long runMillis,
      long waitMillis, Inbox.Counters inbox) {}

  /** One task as this plugin keeps it: its counts and its run's time. */
  private final class Running {
    final String name;
    final Consumer<ComputeEvent> events;
    volatile TaskEngine.@Nullable Task task;
    volatile @Nullable String stopReason;
    // Guarded by PluginComputes.this.
    boolean counted;
    boolean hung;
    /** Holds a place in the hub; given back once, when its thread has ended or its start failed. */
    private final java.util.concurrent.atomic.AtomicBoolean capHeld = new java.util.concurrent.atomic.AtomicBoolean();
    private volatile TaskEngine.@Nullable Attempt attempt;
    private volatile long runStartedNanos;
    private final AtomicLong ranNanos = new AtomicLong();
    private final AtomicLong waitNanos = new AtomicLong();
    private final AtomicLong cpuNanosBefore = new AtomicLong(); // ended runs'
    private volatile long threadCpuAtStart;

    Running(String name, Consumer<ComputeEvent> events) {
      this.name = name;
      this.events = events;
    }

    /** Its plugin stops it: its place in {@code allowed()} is free at once (A3), its place in the cap when its thread ends. */
    void stopByPlugin() {
      synchronized (PluginComputes.this) {
        uncountLocked(this);
      }
      TaskEngine.Task t = task;
      if (t != null) {
        t.stop();
      }
    }

    void setCapHeld() {
      capHeld.set(true);
    }

    void giveCapPlace() {
      if (capHeld.compareAndSet(true, false)) {
        hub.give();
      }
    }

    boolean fenced() {
      TaskEngine.Attempt a = attempt;
      return a == null || a.stopping();
    }

    void runStarted(TaskEngine.Attempt a) {
      threadCpuAtStart = cpuNanos(a.thread);
      runStartedNanos = System.nanoTime();
      attempt = a;
    }

    void runEnded() {
      TaskEngine.Attempt a = attempt;
      if (a != null) {
        long cpu = cpuNanos(a.thread);
        if (cpu >= 0 && threadCpuAtStart >= 0) {
          cpuNanosBefore.addAndGet(cpu - threadCpuAtStart);
        }
      }
      ranNanos.addAndGet(System.nanoTime() - runStartedNanos);
      runStartedNanos = 0;
    }

    TaskStatus status(TaskEngine.Stats s) {
      long now = System.nanoTime();
      long started = runStartedNanos;
      long run = ranNanos.get() + (started == 0 ? 0 : now - started);
      long cpu = cpuNanosBefore.get();
      TaskEngine.Task t = task;
      Thread thread = t == null ? null : t.runThread();
      if (thread != null && started != 0) {
        long c = cpuNanos(thread);
        if (c >= 0 && threadCpuAtStart >= 0) {
          cpu += c - threadCpuAtStart;
        }
      }
      boolean isHung;
      synchronized (PluginComputes.this) {
        isHung = hung;
      }
      return new TaskStatus(s.id(), s.name(), s.state().name(), s.since().toEpochMilli(), s.restarts(),
          s.next() == null ? null : s.next().toEpochMilli(), s.reason(), s.counters(), s.details(), isHung,
          THREADS.isThreadCpuTimeSupported() ? cpu / 1_000_000 : -1, run / 1_000_000, waitNanos.get() / 1_000_000, s.inbox());
    }
  }

  /** The CPU time of a platform thread, or -1 when the JVM cannot say. */
  private static long cpuNanos(Thread thread) {
    try {
      return THREADS.isThreadCpuTimeSupported() ? THREADS.getThreadCpuTime(thread.threadId()) : -1;
    } catch (UnsupportedOperationException e) {
      return -1;
    }
  }

  /** SDK 1.9.0 (CR-0050 point 1.1): the plugin whose compute task {@code ref} is, or null for a handle ECore did not make. */
  static @Nullable String pluginOf(ComputeRef<?> ref) {
    return ref instanceof Ref<?> r ? r.pluginId : null;
  }

  /** A task as the plugin holds it: an immutable handle with an opaque id; may travel in messages. */
  private static final class Ref<I extends Message> implements ComputeRef<I> {
    private final HandleId id;
    private final String name;
    private final Inbox<I> inbox;
    private final PluginComputes.Running running;
    final String pluginId;

    Ref(HandleId id, String name, Inbox<I> inbox, PluginComputes.Running running, String pluginId) {
      this.id = id;
      this.name = name;
      this.inbox = inbox;
      this.running = running;
      this.pluginId = pluginId;
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
    public SendResult post(I item) {
      Objects.requireNonNull(item, "item");
      if (onFencedComputeThread()) {
        return SendResult.CLOSED; // a stopped task's thread: dropped
      }
      return PluginWorkers.result(inbox.offer(item, PluginWorkers.coalesceKey(item))); // the key before the lock (rule C4)
    }

    @Override
    public void stop() {
      running.stopByPlugin();
    }

    @Override
    public boolean equals(@Nullable Object other) {
      return other instanceof Ref<?> r && id.equals(r.id);
    }

    @Override
    public int hashCode() {
      return id.hashCode();
    }

    @Override
    public String toString() {
      return "ComputeRef[" + id.value() + "]";
    }
  }

  /** What one run of a task may do (SDK {@link ComputeContext}); fenced when the run ends. */
  private final class Context<I extends Message> implements ComputeContext<I> {
    private final TaskEngine.Attempt attempt;
    private final Ref<I> self;
    private final Running running;
    private final PluginLog log;

    Context(TaskEngine.Attempt attempt, Ref<I> self, Running running) {
      this.attempt = attempt;
      this.self = self;
      this.running = running;
      this.log = new PluginLogger(pluginId, "compute-" + self.name());
    }

    @Override
    @SuppressWarnings("unchecked") // the inbox holds only I: ComputeRef<I>.post is its only writer
    public @Nullable I take() {
      long before = System.nanoTime();
      try {
        return (I) attempt.take();
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return null;
      } finally {
        running.waitNanos.addAndGet(System.nanoTime() - before);
      }
    }

    @Override
    @SuppressWarnings("unchecked")
    public @Nullable I poll(Duration timeout) {
      Objects.requireNonNull(timeout, "timeout");
      if (timeout.compareTo(MIN_POLL) < 0 || timeout.compareTo(MAX_POLL) > 0) {
        throw new IllegalArgumentException("poll timeout must be 1 ms..1 h: " + timeout);
      }
      long before = System.nanoTime();
      try {
        return (I) attempt.poll(timeout);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return null;
      } finally {
        running.waitNanos.addAndGet(System.nanoTime() - before);
      }
    }

    @Override
    public boolean stopping() {
      return attempt.stopping();
    }

    @Override
    public <M extends Message> SendResult send(WorkerRef<M> target, M message) {
      Objects.requireNonNull(message, "message");
      var handle = PluginWorkers.handleOf(Objects.requireNonNull(target, "target"));
      if (!handle.owner().equals(pluginId)) {
        throw new IllegalArgumentException("a compute task sends only to its own plugin's workers: " + target.id().value());
      }
      if (attempt.stopping()) {
        return SendResult.CLOSED; // fenced: the run is over
      }
      return target.send(message); // plugins' workers never block a sender
    }

    @Override
    public void count(String name, long delta) {
      if (!attempt.stopping()) {
        attempt.task.count(Objects.requireNonNull(name, "name"), delta);
      }
    }

    @Override
    public void detail(String key, String value) {
      Objects.requireNonNull(key, "key");
      Objects.requireNonNull(value, "value");
      if (attempt.stopping()) {
        return;
      }
      TaskEngine.Stats s = attempt.task.stats();
      if (s.details().size() >= MAX_DETAILS && !s.details().containsKey(key)) {
        throw new IllegalStateException("a compute task sets at most " + MAX_DETAILS + " details");
      }
      attempt.task.detail(key, value);
    }

    @Override
    public LocalFolders folders() {
      return folders;
    }

    @Override
    public PluginLog log() {
      return log;
    }

    @Override
    public ComputeRef<I> self() {
      return self;
    }
  }
}
