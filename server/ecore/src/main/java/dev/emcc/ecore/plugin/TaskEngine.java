package dev.emcc.ecore.plugin;

import dev.emcc.ecore.runtime.Cancellable;
import dev.emcc.ecore.runtime.Inbox;
import dev.emcc.ecore.runtime.WorkerRuntime;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import java.util.function.IntFunction;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * One plugin's connection tasks (ADR-0036, CR-0025 part 2), on ECore's own types; the SDK's
 * {@code Connections}, {@code TaskContext} and {@code ConnectionRef} are thin adapters over it. SDK
 * 1.9.0 (ADR-0064, M9 C7): a second engine per plugin runs its compute tasks the same way ({@link
 * #COMPUTE}, threads named {@code ecore-compute-<plugin>/<task>}); its caps are {@link ComputeHub}'s.
 *
 * <ul>
 *   <li><b>A task</b> has a name, unique per plugin among the tasks that are not stopped, a bounded
 *       {@link Inbox} that outlives its runs, a restart rule, and a factory that gives a fresh
 *       {@link Body} for each run. Each run is plugin code on a platform thread of its own ({@link
 *       WorkerRuntime#startTaskThread}; CR-0027: JDK-8334574), the only place where plugin code
 *       may block (rule C6).
 *   <li><b>A run ends</b> when its body returns or throws. Its context is then fenced, the
 *       closeables it registered are closed and its child tasks are stopped. Then, by the rule:
 *       a restart after the {@link RetryDelay} ({@link Restart#ON_FAILURE} when it threw, {@link
 *       Restart#ALWAYS} also when it returned), or the end: failed when it threw, stopped when it
 *       returned.
 *   <li><b>Stopping</b> a task fences its run, closes its inbox ({@code take} answers {@code
 *       null}), and closes what the run registered, so that a blocked read ends, and stops its
 *       children; the closing happens on a short platform thread of its own, so a {@code close} that
 *       blocks never holds up the caller. A run that has not ended {@link #NOT_ENDING_AFTER} later
 *       is reported to the {@link Watch} (the plugin becomes DEGRADED).
 *   <li><b>The name is free again at once</b> (SDK {@code ConnectionRef.stop}): a new task of that
 *       name is accepted, and its first run waits until the stopped one's run has ended, so two
 *       never run side by side (owner, 2026-10-24 and 2026-10-26).
 *   <li><b>Child tasks</b> are started by a run, and stopped with it: when it ends, restarts or is
 *       stopped. They count toward the plugin's cap; an ended child leaves its parent's run.
 *   <li><b>At most {@code maxTasks}</b> tasks per plugin that are not stopped, children included
 *       (SDK 1.2.0 {@code Connections.MAX_TASKS}).
 *   <li><b>Changes</b> go to the task's listener in the order they happen, exactly one final one.
 * </ul>
 *
 * <p>Thread-safe. No lock is held while plugin code runs. The locks, always taken in this order:
 * the engine's {@code names}, a task's own monitor, a run's ({@link Attempt}) monitor, then the
 * leaf locks of the runtime (an inbox's or a mailbox's), of the {@link EventQueue} a change goes
 * to, and of the failures kept for the monitor. None is taken in the other order.
 */
final class TaskEngine {

  /** How long after its stop a run may take to end before it is reported (owner, 2026-10-24). */
  static final Duration NOT_ENDING_AFTER = Duration.ofSeconds(5);

  private static final Logger LOG = LoggerFactory.getLogger(TaskEngine.class);
  /** How often a successor's first run looks whether it was stopped while it waits for its predecessor. */
  private static final long WAIT_STEP_MILLIS = 100;

  /** When a task runs again. */
  enum Restart {
    /** Never: the task ends with its first run. */
    NEVER,
    /** When a run threw. */
    ON_FAILURE,
    /** When a run threw or returned: only a stop ends the task. */
    ALWAYS
  }

  /** The restart rule, with its back-off (unused for {@link Restart#NEVER}). */
  record RestartRule(Restart when, Duration max, IntFunction<Duration> delay) {
    RestartRule {
      Objects.requireNonNull(when, "when");
      Objects.requireNonNull(max, "max");
      Objects.requireNonNull(delay, "delay");
    }

    static RestartRule never() {
      return new RestartRule(Restart.NEVER, Duration.ZERO, n -> Duration.ZERO);
    }
  }

  /** Starts the platform thread of a run or of a closing at a stop ({@link WorkerRuntime#startTaskThread}). */
  @FunctionalInterface
  interface Threads {
    /** Starts {@code body} on a new thread; throws when none can be had (an {@link OutOfMemoryError}, say). */
    Thread start(String name, @Nullable ClassLoader loader, Runnable body);
  }

  /** One run of a task: plugin code, on the task's own platform thread. */
  @FunctionalInterface
  interface Body {
    void run(Attempt attempt) throws Exception;
  }

  /** A task's state, as ECore knows it itself (ADR-0036 point 6). */
  enum State {
    /** Before its first run; also while it waits for a stopped predecessor of the same name to end. */
    STARTING,
    RUNNING,
    RESTARTING,
    STOPPING,
    STOPPED,
    FAILED
  }

  /** A change of a task's state, for its listener (the plugin's events). */
  sealed interface Change {
    String name();

    Instant at();

    record Running(String name, Instant at) implements Change {}

    record Restarting(String name, Instant at, Instant next, String reason) implements Change {}

    record Stopped(String name, Instant at) implements Change {}

    record Failed(String name, Instant at, String reason) implements Change {}
  }

  /** What the engine reports about runs that do not end after their stop. */
  interface Watch {
    /** {@code name}'s run did not end within {@link #NOT_ENDING_AFTER} after its stop. */
    void notEnding(String name);

    /** {@code name}'s run, reported as not ending, has ended after all. */
    void ended(String name);

    Watch NONE = new Watch() {
      @Override
      public void notEnding(String name) {}

      @Override
      public void ended(String name) {}
    };
  }

  /**
   * One task as the monitor view shows it.
   *
   * @param id unique among the server's tasks, also over a plugin's restart: a new task of the
   *     same name has another, so its counters are not taken for the old one's
   */
  record Stats(long id, String name, State state, Instant since, long restarts, @Nullable Instant next, @Nullable String reason,
      @Nullable String listening, @Nullable String peer, Map<String, Long> counters, Map<String, String> details,
      @Nullable Instant lastActivity, boolean notEnding, Inbox.Counters inbox) {}

  /**
   * How many failed tasks the monitor keeps per plugin, the oldest dropped first; only tasks a
   * plugin starts itself, not child tasks (owner, 2026-10-26).
   */
  static final int MAX_FAILURES = 20;

  /** The kinds of task an engine runs: in its texts and its threads' names. */
  static final String CONNECTION = "connection";
  static final String COMPUTE = "compute";

  private final String pluginId;
  /** {@link #CONNECTION} or {@link #COMPUTE}. */
  private final String kind;
  /** Its threads' names start so: {@code ecore-task-} or {@code ecore-compute-}. */
  private final String prefix;
  private final @Nullable ClassLoader loader;
  private final WorkerRuntime runtime;
  private final int maxTasks;
  private final Clock clock;
  private final Watch watch;
  private final Duration notEndingAfter;
  /** Starts the threads of runs and of their closing (platform threads; CR-0027). */
  private final Threads threads;
  // Guarded by names, the first lock in the engine's order: the cap, the names, the plugin's stop.
  private final Object names = new Object();
  /**
   * By name, the newest task of each name: the one that holds the name. A task gives it up only
   * when it and every earlier task of the name have ended (N1), so a later one always waits.
   */
  private final Map<String, Task> byName = new ConcurrentHashMap<>();
  /**
   * Every task that has not ended, children and stopped ones included: the monitor's, the cap's, the
   * stop's. A stopped task that still waits for an earlier run of its name stays until it gives up
   * its name, so a pile-up behind a stuck run shows in the monitor (owner, 2026-10-26).
   */
  private final Set<Task> living = ConcurrentHashMap.newKeySet();
  private boolean closed;
  /** Orders tasks of the same name in the monitor: a stopped one before its successor. */
  private static final AtomicLong SERIALS = new AtomicLong(); // shared by every plugin's engine: ids unique per server
  /**
   * The last failure of each name, as it was when it failed, until a new task of the name starts or
   * the plugin stops; at most {@link #MAX_FAILURES}, the oldest dropped. Its monitor is the last lock
   * in the engine's order: held only to change the map.
   */
  private final Map<String, Stats> failures = new java.util.LinkedHashMap<>();
  /**
   * The previous start's tasks that had not ended when this engine was made (C7 gap 6): by name, so that a new task of
   * the name waits for a hung one of the plugin's last start too. An entry leaves when its task gives up its name, or
   * when a task of this engine takes it over.
   */
  private volatile Map<String, Task> leftovers = new ConcurrentHashMap<>();

  TaskEngine(String pluginId, @Nullable ClassLoader loader, WorkerRuntime runtime, int maxTasks, Clock clock, Watch watch) {
    this(pluginId, loader, runtime, maxTasks, clock, watch, NOT_ENDING_AFTER);
  }

  TaskEngine(String pluginId, @Nullable ClassLoader loader, WorkerRuntime runtime, int maxTasks, Clock clock, Watch watch,
      Duration notEndingAfter) {
    this(pluginId, loader, runtime, maxTasks, clock, watch, notEndingAfter, runtime::startTaskThread);
  }

  TaskEngine(String pluginId, @Nullable ClassLoader loader, WorkerRuntime runtime, int maxTasks, Clock clock, Watch watch,
      Duration notEndingAfter, Threads threads) {
    this(CONNECTION, pluginId, loader, runtime, maxTasks, clock, watch, notEndingAfter, threads);
  }

  /** An engine of {@code kind} ({@link #CONNECTION} or {@link #COMPUTE}). */
  TaskEngine(String kind, String pluginId, @Nullable ClassLoader loader, WorkerRuntime runtime, int maxTasks, Clock clock, Watch watch,
      Duration notEndingAfter, Threads threads) {
    if (!kind.equals(CONNECTION) && !kind.equals(COMPUTE)) {
      throw new IllegalArgumentException("a task engine runs connection or compute tasks: " + kind);
    }
    this.kind = kind;
    this.prefix = kind.equals(CONNECTION) ? "ecore-task-" : "ecore-compute-";
    this.pluginId = pluginId;
    this.loader = loader;
    this.runtime = runtime;
    this.maxTasks = maxTasks;
    this.clock = clock;
    this.watch = watch;
    this.notEndingAfter = notEndingAfter;
    this.threads = threads;
  }

  int maxTasks() {
    return maxTasks;
  }

  /**
   * C7 gap 6: when the plugin stops, its tasks that have not given up their names yet, those it took over from the start
   * before included, by name. Only these are kept, not the engine (review R3); each entry leaves by itself when its task
   * gives up the name.
   */
  Map<String, Task> unended() {
    Map<String, Task> out = new ConcurrentHashMap<>();
    Map<String, Task> all = new java.util.HashMap<>(leftovers);
    all.putAll(byName); // a newer task of a name waits for the older one already
    all.forEach((name, task) -> {
      if (!task.isReleased()) {
        out.put(name, task);
        task.whenReleased(() -> out.remove(name, task));
      }
    });
    return out;
  }

  /** C7 gap 6: before the first start, the last start's {@link #unended} tasks; a new task of such a name waits for it. */
  void inheritFrom(@Nullable Map<String, Task> previous) {
    if (previous != null) {
      leftovers = previous;
    }
  }

  /**
   * Starts a task, or a child task of {@code parent}'s current run.
   *
   * @param changes gets the task's changes in order; must not block
   * @throws IllegalStateException beyond the cap, when the plugin is stopping, or when the parent's run has ended
   * @throws IllegalArgumentException when a task of that name runs (is not stopped)
   */
  Task start(String name, @Nullable Attempt parent, Inbox<?> inbox, RestartRule rule, Supplier<? extends Body> factory,
      Consumer<Change> changes) {
    Task task = create(name, parent, inbox, rule, factory, changes);
    task.launch();
    return task;
  }

  /**
   * As {@link #start}, but the first run begins only at {@link Task#launch}: for a caller that must
   * finish its handle before plugin code can use it. Launch it at once.
   */
  Task create(String name, @Nullable Attempt parent, Inbox<?> inbox, RestartRule rule, Supplier<? extends Body> factory,
      Consumer<Change> changes) {
    Objects.requireNonNull(name, "name");
    Objects.requireNonNull(inbox, "inbox");
    Objects.requireNonNull(rule, "rule");
    Objects.requireNonNull(factory, "factory");
    Objects.requireNonNull(changes, "changes");
    Task task;
    synchronized (names) {
      if (closed) {
        throw new IllegalStateException("plugin " + pluginId + " is stopping");
      }
      Task holder = byName.get(name);
      Task leftover = null;
      if (holder == null) {
        leftover = leftovers.get(name); // C7 gap 6: the plugin's last start left it running; taken only once registered (R1)
        holder = leftover;
      }
      // A holder that has ended (its final change is out) no longer holds the name, even before its
      // run's thread has released it: a start that follows a Failed or Stopped change is not refused
      // (MCA, 2026-11-11). Its successor waits for it, as for a stopped one. Names, then the task's
      // monitor: the engine's lock order.
      if (holder != null && !holder.stopped && !holder.hasEnded()) {
        throw new IllegalArgumentException("a " + kind + " task named " + name + " is running already");
      }
      if (living.stream().filter(t -> !t.stopped).count() >= maxTasks) {
        throw new IllegalStateException("plugin " + pluginId + " has " + maxTasks + " " + kind + " tasks, the most it may have");
      }
      task = new Task(name, inbox, rule, factory, changes, parent, null);
      if (parent != null && !parent.adopt(task)) { // before anything that cannot be undone (review R2)
        throw new IllegalStateException("the run that starts " + name + " has ended");
      }
      if (holder != null) {
        // a stopped or ended holder: its successor waits for it; one that only waits itself hands its wait over and
        // stops waiting (C7 gap 1; names, then one task's monitor at a time: the engine's order)
        Task before = holder.handOver();
        if (before != holder) {
          before.unwait(holder.onPredecessorReleased);
        }
        task.waitFor(before);
        if (holder.notEndingReported()) {
          LOG.warn("Plugin {}: " + kind + " task {} starts again, but its stopped run has not ended; the new one waits for it",
              pluginId, name);
        }
      }
      if (leftover != null) {
        leftovers.remove(name, leftover); // this engine's task holds the name now
      }
      synchronized (failures) {
        failures.remove(name); // a new task of the name: its old failure is history (not on a refused start)
      }
      byName.put(name, task);
      living.add(task);
    }
    return task;
  }

  /** The reason a stopped task shows while it still waits for an earlier run of its name to end (R1). */
  static final String WAITING = "stopped; waiting for an earlier run of its name to end";

  /** How long the plugin's stop waits for its tasks' resources to be closed, before its class loader goes. */
  static final Duration CLOSE_AT_STOP = Duration.ofSeconds(2);

  /**
   * When the plugin stops: every task stops, and no new one starts. Waits at most {@link
   * #CLOSE_AT_STOP} for what the runs registered to be closed, so that the plugin's {@code close}
   * code still finds its classes (the class loader is closed after this).
   */
  void stopAll() {
    List<Task> all;
    synchronized (names) {
      closed = true;
      all = List.copyOf(living);
      synchronized (failures) {
        failures.clear();
      }
    }
    List<Attempt> runs = new ArrayList<>();
    for (Task t : all) {
      Attempt running = t.stopAndGetRun(); // the very run it ended, also one that began just now
      if (running != null) {
        runs.add(running);
      }
    }
    long deadline = System.nanoTime() + CLOSE_AT_STOP.toNanos();
    for (Attempt a : runs) {
      if (!a.awaitClosed(Duration.ofNanos(Math.max(0, deadline - System.nanoTime())))) {
        LOG.warn("Plugin {}: " + kind + " task {} was still closing what it registered {} ms after the plugin's stop; "
            + "the plugin's class loader is closed now", pluginId, a.task.name, CLOSE_AT_STOP.toMillis());
      }
    }
  }

  /** Every task that has not ended, by name (a stopped one before its successor). */
  List<Stats> stats() {
    List<Stats> result = new ArrayList<>();
    new ArrayList<>(living).forEach(t -> result.add(t.stats()));
    synchronized (failures) {
      result.addAll(failures.values()); // failed tasks stay visible (owner, 2026-10-26)
    }
    result.sort(Comparator.comparing(Stats::name).thenComparingLong(Stats::id));
    return result;
  }

  /** One task: its runs, one after the other, each on a thread of its own. */
  final class Task {
    final String name;
    final Inbox<?> inbox;
    private final long serial = SERIALS.incrementAndGet();
    private final RestartRule rule;
    private final @Nullable RetryDelay retry;
    private final @Nullable Attempt parent;
    /**
     * A stopped task of the same name that had not ended when this one started; this one's first
     * run waits for it. Dropped once it has ended, so no chain of old tasks is kept (N2).
     */
    private @Nullable Task predecessor; // guarded by this
    /** Down once this task and every earlier task of its name have ended: then a successor may run. */
    private final CountDownLatch endLatch = new CountDownLatch(1);
    private boolean released; // guarded by this
    /** C7 gap 1: what runs once this task has given up its name (a successor's first run); guarded by this. */
    private final List<Runnable> afterRelease = new ArrayList<>();
    /** This task's own wait for its predecessor, as registered there, so that a hand-over can take it back (R3). */
    final Runnable onPredecessorReleased = this::predecessorReleased;
    private final Map<String, AtomicLong> counters = new ConcurrentHashMap<>();
    private final Map<String, String> details = new ConcurrentHashMap<>();
    private volatile @Nullable Instant lastActivity;
    private volatile @Nullable String listening;
    private volatile @Nullable String peer;
    // Guarded by this.
    private @Nullable Supplier<? extends Body> factory; // dropped when the task ends
    private Consumer<Change> changes;
    private State state = State.STARTING;
    private Instant since;
    private long restarts;
    private @Nullable Instant next;
    private @Nullable String reason;
    private @Nullable Attempt current;
    private @Nullable Cancellable pending;
    private @Nullable Cancellable watchTimer;
    private boolean notEnding;
    private boolean ended;
    volatile boolean stopped;

    Task(String name, Inbox<?> inbox, RestartRule rule, Supplier<? extends Body> factory, Consumer<Change> changes,
        @Nullable Attempt parent, @Nullable Task predecessor) {
      this.name = name;
      this.inbox = inbox;
      this.rule = rule;
      this.factory = factory;
      this.changes = changes;
      this.parent = parent;
      this.predecessor = predecessor;
      this.retry = rule.when() == Restart.NEVER ? null : new RetryDelay(rule.max(), rule.delay());
      this.since = clock.instant();
    }

    /**
     * Begins the first run; once. A task whose earlier run of its name has not ended waits for it without a thread (C7
     * gap 1: a plugin that starts and stops a name again and again behind a hung run parked a thread each time): its
     * first run begins when that one gives up the name.
     */
    void launch() {
      Task before;
      synchronized (this) {
        before = predecessor;
      }
      if (before == null) {
        run();
      } else {
        before.whenReleased(onPredecessorReleased);
      }
    }

    /** The earlier run of the name has ended: the first run begins, or, stopped meanwhile, this one gives up the name. */
    private void predecessorReleased() {
      synchronized (this) {
        predecessor = null;
        if (ended) {
          release();
          return;
        }
      }
      run();
    }

    /** Runs {@code next} once this task has given up its name: at once if it has. Outside every lock. */
    void whenReleased(Runnable next) {
      synchronized (this) {
        if (!released) {
          afterRelease.add(next);
          return;
        }
      }
      next.run();
    }

    synchronized boolean isReleased() {
      return released;
    }

    /** Takes back a wait registered with {@link #whenReleased} (a successor that handed its wait over). */
    synchronized void unwait(Runnable registered) {
      afterRelease.remove(registered);
    }

    /** Before its launch: the task its first run waits for. */
    synchronized void waitFor(@Nullable Task before) {
      predecessor = before;
    }

    /** How many waits are registered here (tests: no pile behind a hung run). */
    synchronized int waiting() {
      return afterRelease.size();
    }

    /**
     * C7 gap 1: the task a new one of this name waits for. A stopped task that never ran and only waits for an earlier
     * one gives up its name now and hands that wait over, so a pile of such tasks never forms; else this one. Called
     * with the engine's names lock held (names, then the task's monitor: the engine's order).
     */
    Task handOver() {
      synchronized (this) {
        Task before = predecessor;
        if (!ended || released || before == null || current != null) {
          return this;
        }
        predecessor = null;
        released = true;
        byName.remove(name, this);
        living.remove(this);
        endLatch.countDown();
        if (!afterRelease.isEmpty()) {
          afterRelease.clear(); // none: only a newer task of the name waits, and that is the one being made
        }
        return before;
      }
    }

    private void run() {
      try {
        threads.start(prefix + pluginId + "/" + name, loader, this::attempt);
      } catch (Throwable e) { // no platform thread to be had: the task fails, and its name and its place in the cap free up
        String why = "no thread for its run: " + e;
        LOG.warn("Plugin {}: " + kind + " task {} cannot run: {}", pluginId, name, why);
        Task before;
        synchronized (this) {
          before = predecessor;
        }
        if (before == null) {
          failWithoutARun(why);
        } else { // the name passes on only after the earlier run of it has ended; waiting needs no socket
          runtime.startLoop(prefix + "wait-" + pluginId + "/" + name, null, () -> {
            awaitEnd(before);
            synchronized (this) {
              predecessor = null;
            }
            failWithoutARun(why);
          });
        }
      }
    }

    /** A run that could not begin: the task fails, or ends stopped if it was stopped meanwhile. */
    private void failWithoutARun(String why) {
      synchronized (this) {
        finish(stopped ? State.STOPPED : State.FAILED, stopped ? null : why);
        release();
      }
    }

    /** On the run's thread: one run, from the factory to the decision what comes next. */
    private void attempt() {
      Task before;
      synchronized (this) {
        before = predecessor;
      }
      if (before != null) {
        awaitEnd(before); // also when this one is stopped meanwhile: the name passes on only after both
        synchronized (this) {
          predecessor = null;
        }
      }
      Attempt attempt = new Attempt(this, Thread.currentThread());
      Supplier<? extends Body> make;
      synchronized (this) {
        if (stopped) {
          finish(State.STOPPED, null);
          release();
          return;
        }
        make = Objects.requireNonNull(factory);
        current = attempt;
        state = State.RUNNING;
        since = clock.instant();
        next = null;
        changes.accept(new Change.Running(name, since));
      }
      long started = runtime.nanoTime();
      String failure = null;
      try {
        make.get().run(attempt); // plugin code
      } catch (Throwable e) { // plugin code: every end is reported
        failure = String.valueOf(e);
        if (!stopped && !(e instanceof java.io.IOException)) {
          LOG.warn("Plugin {}: " + kind + " task {} threw", pluginId, name, e);
        }
      } finally {
        attempt.end(); // never throws (closeQuietly)
        listening = null;
        peer = null;
      }
      Duration ranFor = Duration.ofNanos(runtime.nanoTime() - started);
      boolean reportEnded = false;
      synchronized (this) {
        current = null;
        if (stopped) {
          reportEnded = notEnding;
          finish(State.STOPPED, null);
          release();
        } else if (failure != null ? rule.when() == Restart.NEVER : rule.when() != Restart.ALWAYS) {
          finish(failure == null ? State.STOPPED : State.FAILED, failure);
          release();
        } else {
          Duration delay = Objects.requireNonNull(retry).after(ranFor);
          Instant now = clock.instant();
          pending = runtime.schedule(delay, this::run); // first: the task restarts whatever the listener does
          state = State.RESTARTING;
          since = now;
          next = now.plus(delay);
          reason = failure == null ? "the task returned" : failure;
          restarts++;
          changes.accept(new Change.Restarting(name, now, next, reason));
        }
      }
      if (reportEnded) {
        watch.ended(name);
      }
    }

    /** Waits on this (the successor's) thread until {@code before} and every task of the name before it have ended. */
    private void awaitEnd(Task before) {
      boolean interrupted = false;
      while (true) {
        try {
          before.endLatch.await();
          break;
        } catch (InterruptedException e) {
          interrupted = true; // ECore interrupts no task thread; keep waiting, so the order holds
        }
      }
      if (interrupted) {
        Thread.currentThread().interrupt();
      }
    }

    /** The task ends: exactly one final change. Called with this held. */
    private void finish(State end, @Nullable String why) {
      if (ended) {
        return;
      }
      ended = true;
      state = end;
      since = clock.instant();
      next = null;
      reason = why;
      Cancellable timer = watchTimer;
      if (timer != null) {
        timer.cancel();
      }
      inbox.close();
      if (predecessor == null) {
        living.remove(this); // gone from the monitor's list before its final change arrives
      } else {
        reason = WAITING; // still in the monitor's list until the run it waits for has ended (owner, 2026-10-26)
      }
      Attempt p = parent;
      if (p != null) {
        p.forget(this); // a server's ended clients do not pile up in its run
      }
      if (end == State.FAILED && parent == null) { // a link's task; a child (a server's client, say) comes and goes (owner, 2026-10-26)
        Stats last = stats();
        synchronized (failures) {
          failures.remove(name);
          failures.put(name, last);
          if (failures.size() > MAX_FAILURES) {
            failures.remove(failures.keySet().iterator().next()); // the oldest
          }
        }
      }
      changes.accept(end == State.FAILED ? new Change.Failed(name, since, Objects.requireNonNull(why)) : new Change.Stopped(name, since));
      factory = null; // what the plugin's factory holds (a client's socket, say) is not kept
      changes = change -> {};
    }

    /**
     * After {@link #finish}, once every earlier task of the name has ended too (no predecessor is
     * waited for any more): the name passes on, and a successor's first run may begin. Called with
     * this held; once.
     */
    private void release() {
      if (released || predecessor != null) {
        return;
      }
      released = true;
      byName.remove(name, this);
      living.remove(this);
      endLatch.countDown(); // last: a successor's first run comes after this task's final change
      if (!afterRelease.isEmpty()) { // on a virtual thread: never under this task's lock (rule C4)
        List<Runnable> next = List.copyOf(afterRelease);
        afterRelease.clear();
        try {
          runtime.startLoop(prefix + "next-" + pluginId + "/" + name, null, () -> next.forEach(Runnable::run));
        } catch (RuntimeException e) { // the runtime is closing: nothing runs any more
          LOG.warn("Plugin {}: " + kind + " task {}: the next task of its name cannot begin: {}", pluginId, name, e.toString());
        }
      }
    }

    /** Stops the task; its run ends when its blocking call does (registered closeables are closed). */
    void stop() {
      stopAndGetRun();
    }

    /** As {@link #stop}; returns the run it ended, whose closing has begun, or {@code null}. */
    @Nullable Attempt stopAndGetRun() {
      Attempt running;
      synchronized (this) {
        if (stopped) {
          return null;
        }
        stopped = true;
        Cancellable p = pending;
        if (p != null) {
          p.cancel();
        }
        running = current;
        if (running == null) {
          // Between runs, or before its first. Its Stopped change and its closed inbox come at once; one
          // that waits for a predecessor passes its name on only when that one has ended (its thread releases it).
          finish(State.STOPPED, null);
          release();
          return null;
        }
        state = State.STOPPING;
        since = clock.instant();
        watchTimer = runtime.schedule(notEndingAfter, () -> runtime.startLoop(
            prefix + "watch-" + pluginId + "/" + name, loader, () -> checkEnded(running)));
      }
      inbox.close(); // a take() that waits answers null
      // The plugin's close() calls on a thread of their own: one that blocks never holds up the caller.
      String closer = prefix + "stop-" + pluginId + "/" + name;
      try {
        threads.start(closer, loader, running::end);
      } catch (Throwable e) { // no platform thread to be had: what the run registered is still closed
        LOG.warn("Plugin {}: " + kind + " task {} closes on a virtual thread: {}", pluginId, name, e.toString());
        runtime.startLoop(closer, loader, running::end);
      }
      return running;
    }

    /** {@link #NOT_ENDING_AFTER} after the stop, on a virtual thread: has the run ended? */
    private void checkEnded(Attempt running) {
      boolean report;
      synchronized (this) {
        report = !ended && current == running;
        notEnding |= report;
      }
      if (report) {
        LOG.warn("Plugin {}: " + kind + " task {} has not ended {} ms after its stop (it registered nothing that a "
            + "close would end); a new task of its name waits for it", pluginId, name, notEndingAfter.toMillis());
        watch.notEnding(name);
      }
    }

    /** {@code delta} more of the counter {@code key}; any thread. */
    void count(String key, long delta) {
      counters.computeIfAbsent(key, k -> new AtomicLong()).addAndGet(delta);
      lastActivity = clock.instant();
    }

    void detail(String key, String value) {
      details.put(key, value);
    }

    @Nullable Instant lastActivity() {
      return lastActivity;
    }

    void listening(@Nullable String address) {
      listening = address;
    }

    void peer(@Nullable String address) {
      peer = address;
    }

    synchronized State state() {
      return state;
    }

    /** The thread of its current run, or null between runs (a compute task's CPU time, ADR-0064 point 5). */
    synchronized @Nullable Thread runThread() {
      Attempt a = current;
      return a == null ? null : a.thread;
    }

    /** Whether it was stopped, by its plugin, the admin or the plugin's stop. */
    boolean isStopped() {
      return stopped;
    }

    synchronized boolean notEndingReported() {
      return notEnding;
    }

    /** Whether the task has ended: its final change ({@code Failed} or {@code Stopped}) is out. */
    synchronized boolean hasEnded() {
      return ended;
    }

    synchronized Stats stats() {
      Map<String, Long> c = new TreeMap<>();
      counters.forEach((k, v) -> c.put(k, v.get()));
      return new Stats(serial, name, state, since, restarts, next, reason, listening, peer, Map.copyOf(c), Map.copyOf(new TreeMap<>(details)),
          lastActivity, notEnding, inbox.counters());
    }
  }

  /**
   * One run of a task: what its body may use. Fenced when it ends; from then on nothing it does
   * counts. A run that lives long should hand each client's socket to a child task, which closes
   * it when it ends, rather than register it here, where it stays until the run ends.
   */
  final class Attempt {
    final Task task;
    final Thread thread;
    private final List<AutoCloseable> closeables = new ArrayList<>(); // guarded by this
    private final Set<Task> children = new LinkedHashSet<>(); // guarded by this; an ended child leaves
    private final CountDownLatch closed = new CountDownLatch(1);
    private volatile boolean fenced;

    Attempt(Task task, Thread thread) {
      this.task = task;
      this.thread = thread;
    }

    /** True once this run has ended or its task was stopped. */
    boolean stopping() {
      return fenced || task.stopped;
    }

    /** The next inbox item; {@code null} when the task stops. */
    @Nullable Object take() throws InterruptedException {
      return stopping() ? null : task.inbox.take();
    }

    /** The next inbox item within {@code timeout}; {@code null} when the time is up or the task stops. */
    @Nullable Object poll(Duration timeout) throws InterruptedException {
      return stopping() ? null : task.inbox.poll(timeout);
    }

    /** Registers {@code closeable}, closed when this run ends or its task stops; closed at once if that has happened. */
    <C extends AutoCloseable> C closeOnStop(C closeable) {
      Objects.requireNonNull(closeable, "closeable");
      synchronized (this) {
        if (!fenced) {
          closeables.add(closeable);
          return closeable;
        }
      }
      closeQuietly(closeable);
      return closeable;
    }

    /** Called with the engine's {@code names} held. */
    private boolean adopt(Task child) {
      synchronized (this) {
        if (!fenced) {
          children.add(child);
          return true;
        }
      }
      return false;
    }

    /** An ended child leaves the run. Called with the child's monitor held. */
    private void forget(Task child) {
      synchronized (this) {
        children.remove(child);
      }
    }

    synchronized int children() {
      return children.size();
    }

    /**
     * Fences the run, closes what it registered and stops its children; once. Never throws. A second
     * caller (the run's own thread, after a stop) waits at most {@link #CLOSE_AT_STOP} for the first
     * to finish closing, so the run does not end, and no successor begins, while it still closes.
     */
    void end() {
      @Nullable List<AutoCloseable> close;
      @Nullable List<Task> stop;
      synchronized (this) {
        if (fenced) {
          close = null;
          stop = null;
        } else {
          fenced = true;
          close = List.copyOf(closeables);
          stop = List.copyOf(children);
          closeables.clear();
          children.clear();
        }
      }
      if (close == null) {
        awaitClosed(CLOSE_AT_STOP);
        return;
      }
      try {
        close.forEach(TaskEngine::closeQuietly);
        stop.forEach(Task::stop);
      } finally {
        closed.countDown();
      }
    }

    /** Waits at most {@code timeout} until {@link #end} has closed what the run registered; true if it has. */
    boolean awaitClosed(Duration timeout) {
      try {
        return closed.await(timeout.toNanos(), TimeUnit.NANOSECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return closed.getCount() == 0;
      }
    }
  }

  /** Closes plugin code's resource; whatever its {@code close} throws is logged, never passed on. */
  static void closeQuietly(@Nullable AutoCloseable closeable) {
    if (closeable == null) {
      return;
    }
    try {
      closeable.close();
    } catch (Throwable e) { // plugin code, also an Error: the other resources must still close
      LOG.debug("Closing {} failed: {}", closeable, e.toString());
    }
  }
}
