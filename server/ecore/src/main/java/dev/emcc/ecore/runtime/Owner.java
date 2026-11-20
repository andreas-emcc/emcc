package dev.emcc.ecore.runtime;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The workers, timers and subscriptions of one owner: {@code core} or a plugin. Stopping the owner
 * stops all of them, so a plugin cannot leave anything running (overview 4.1).
 */
public final class Owner {

  /** The shortest timer delay and period. */
  public static final Duration MIN_TIMER_PERIOD = Duration.ofMillis(10);

  private static final Logger LOG = LoggerFactory.getLogger(Owner.class);

  /** Refusals are logged and reported at most this often per owner, whichever cap refused (CR-0005). */
  static final Duration REFUSAL_LOG_INTERVAL = Duration.ofMinutes(1);

  private final WorkerRuntime runtime;
  private final String id;
  private final Set<Cancellable> cancellables = ConcurrentHashMap.newKeySet();

  // Caps (CR-0005): counted with atomics, no lock (ADR-0021).
  private volatile OwnerLimits limits = OwnerLimits.UNLIMITED;
  private final AtomicInteger outstandingAsks = new AtomicInteger();
  private final AtomicInteger activeTimers = new AtomicInteger();
  /** When the next refusal of either cap may be reported again ({@code Refusals#NEVER} before the first). */
  private final AtomicLong nextReport = new AtomicLong(Refusals.NEVER);
  private final Refusals askRefusals = new Refusals(OwnerLimits.Cap.OUTSTANDING_ASKS);
  private final Refusals timerRefusals = new Refusals(OwnerLimits.Cap.ACTIVE_TIMERS);

  // Guarded by this.
  private final Map<String, WorkerCell<?>> workers = new LinkedHashMap<>();
  private boolean stopped;

  Owner(WorkerRuntime runtime, String id) {
    this.runtime = runtime;
    this.id = id;
  }

  public String id() {
    return id;
  }

  /** Sets the caps of this owner (the plugin host does, for each plugin). Unlimited until set. */
  public void limits(OwnerLimits newLimits) {
    limits = Objects.requireNonNull(newLimits, "limits");
  }

  public OwnerLimits limits() {
    return limits;
  }

  /** Asks of this owner's workers that have not been answered, failed or timed out yet. */
  public int outstandingAsks() {
    return outstandingAsks.get();
  }

  /** Timers of this owner that are still active. */
  public int activeTimers() {
    return activeTimers.get();
  }

  /** How many asks were refused because of the cap, since the owner was created. */
  public long refusedAsks() {
    return askRefusals.count.get();
  }

  /** How many timers were refused because of the cap, since the owner was created. */
  public long refusedTimers() {
    return timerRefusals.count.get();
  }

  /** Takes a slot for an ask; false (counted and reported) if the cap is reached. */
  boolean acquireAsk() {
    int limit = limits.outstandingAsks();
    if (acquire(outstandingAsks, limit)) {
      return true;
    }
    askRefusals.refused(limit);
    return false;
  }

  /** Gives back the slot of a completed ask. */
  void releaseAsk() {
    outstandingAsks.decrementAndGet();
  }

  private void acquireTimer() {
    int limit = limits.activeTimers();
    if (!acquire(activeTimers, limit)) {
      timerRefusals.refused(limit);
      throw new IllegalStateException("too many active timers: " + id + " has " + limit + ", its cap");
    }
  }

  /** Increments {@code counter} if it is below {@code limit}. */
  private static boolean acquire(AtomicInteger counter, int limit) {
    while (true) {
      int n = counter.get();
      if (n >= limit) {
        return false;
      }
      if (counter.compareAndSet(n, n + 1)) {
        return true;
      }
    }
  }

  /** Creates and starts a worker. Fails if this owner already has a worker with that name. */
  public <M> WorkerHandle<M> spawn(WorkerOptions<M> options) {
    Objects.requireNonNull(options, "options");
    WorkerCell<M> cell;
    synchronized (this) {
      ensureRunning();
      if (workers.containsKey(options.name())) {
        throw new IllegalArgumentException(id + " already has a worker named " + options.name());
      }
      cell = new WorkerCell<>(runtime, this, options);
      workers.put(options.name(), cell);
    }
    try {
      cell.start();
    } catch (RuntimeException | LinkageError e) {
      synchronized (this) {
        workers.remove(options.name());
      }
      cell.stop();
      throw e;
    }
    return cell;
  }

  /**
   * Stops one of this owner's workers, e.g. the workers of a closed browser session, and forgets
   * it, so its name may be used again. Timers and subscriptions that target it stay until cancelled
   * (deliveries to a stopped worker are refused). No effect for a worker of another owner.
   */
  public void stopWorker(WorkerHandle<?> worker) {
    Objects.requireNonNull(worker, "worker");
    WorkerCell<?> cell;
    synchronized (this) {
      cell = workers.get(worker.name());
      if (cell != worker) {
        return;
      }
      workers.remove(worker.name());
    }
    cell.stop();
  }

  /** Sends {@code message} to {@code target} once, after {@code delay}. */
  public <M> Cancellable once(Duration delay, WorkerHandle<M> target, M message) {
    checkPeriod(delay);
    if (WorkerRuntime.onFencedThread()) {
      LOG.warn("Dropped a timer for {} set from a fenced worker thread", target.id());
      return () -> {};
    }
    WorkerCell<M> cell = cellOf(target);
    Objects.requireNonNull(message, "message");
    acquireTimer();
    OnceTimer<M> timer;
    try {
      timer = new OnceTimer<>(cell, message);
      register(timer);
    } catch (RuntimeException e) {
      activeTimers.decrementAndGet();
      throw e;
    }
    timer.schedule(delay); // if the scheduler throws, the timer has ended and given its slot back
    return timer;
  }

  /**
   * Sends {@code message} to {@code target} repeatedly, with a fixed delay of {@code period}. A tick
   * is skipped while the previous one is still undelivered, so a slow or hung worker never builds
   * up a queue of ticks.
   */
  public <M> Cancellable every(Duration period, WorkerHandle<M> target, M message) {
    checkPeriod(period);
    if (WorkerRuntime.onFencedThread()) {
      LOG.warn("Dropped a timer for {} set from a fenced worker thread", target.id());
      return () -> {};
    }
    WorkerCell<M> cell = cellOf(target);
    Objects.requireNonNull(message, "message");
    acquireTimer();
    PeriodicTimer<M> timer;
    try {
      timer = new PeriodicTimer<>(cell, message, period);
      register(timer);
    } catch (RuntimeException e) {
      activeTimers.decrementAndGet();
      throw e;
    }
    timer.scheduleNext(); // if the scheduler throws, the timer has ended and given its slot back
    return timer;
  }

  /** Subscribes a worker to a topic; {@code mapper} turns the payload into the worker's message. */
  public <T, M> Cancellable subscribe(Topic<T> topic, WorkerHandle<M> subscriber, Function<? super T, ? extends M> mapper) {
    Objects.requireNonNull(topic, "topic");
    Objects.requireNonNull(mapper, "mapper");
    ensureRunning();
    SubscriptionHandle handle = new SubscriptionHandle(runtime.bus().subscribe(topic, cellOf(subscriber), mapper));
    try {
      register(handle);
    } catch (IllegalStateException e) {
      handle.cancel(); // stopped meanwhile
      throw e;
    }
    return handle;
  }

  /** This owner's workers, in the order they were created. */
  public synchronized List<WorkerHandle<?>> workers() {
    return List.copyOf(workers.values());
  }

  public synchronized boolean isStopped() {
    return stopped;
  }

  /**
   * Stops everything of this owner: timers and subscriptions first, then the workers in reverse
   * creation order (see {@link WorkerCell#stop()}).
   */
  public void stop() {
    List<WorkerCell<?>> cells;
    synchronized (this) {
      if (stopped) {
        return;
      }
      stopped = true;
      cells = new ArrayList<>(workers.values());
    }
    for (Cancellable c : List.copyOf(cancellables)) {
      c.cancel();
    }
    cancellables.clear();
    Collections.reverse(cells);
    for (WorkerCell<?> cell : cells) {
      cell.stop();
    }
  }

  synchronized List<WorkerCell<?>> cells() {
    return List.copyOf(workers.values());
  }

  private synchronized void ensureRunning() {
    if (stopped) {
      throw new IllegalStateException(id + " is stopped");
    }
  }

  private void register(Cancellable c) {
    synchronized (this) {
      ensureRunning();
      cancellables.add(c);
    }
  }

  private static void checkPeriod(Duration period) {
    Objects.requireNonNull(period, "period");
    if (period.compareTo(MIN_TIMER_PERIOD) < 0) {
      throw new IllegalArgumentException("timer delay and period must be at least " + MIN_TIMER_PERIOD + ": " + period);
    }
  }

  private static <M> WorkerCell<M> cellOf(WorkerHandle<M> handle) {
    Objects.requireNonNull(handle, "target");
    if (!(handle instanceof WorkerCell<M> cell)) {
      throw new IllegalArgumentException("unknown worker handle: " + handle);
    }
    return cell;
  }

  private final class SubscriptionHandle implements Cancellable {
    private final Cancellable subscription;

    SubscriptionHandle(Cancellable subscription) {
      this.subscription = subscription;
    }

    @Override
    public void cancel() {
      subscription.cancel();
      cancellables.remove(this);
    }
  }

  private final class OnceTimer<M> implements Cancellable {
    private final WorkerCell<M> target;
    private final M message;
    private final @Nullable Object key;
    private final AtomicBoolean ended = new AtomicBoolean();
    private volatile boolean cancelled;
    private volatile @Nullable Cancellable scheduled;

    OnceTimer(WorkerCell<M> target, M message) {
      this.target = target;
      this.message = message;
      this.key = target.keyOf(message); // here, on the caller's thread: never on the scheduler
    }

    void schedule(Duration delay) {
      try {
        scheduled = runtime.scheduler().schedule(delay, this::fire);
      } catch (RuntimeException e) {
        cancel(); // never scheduled: no longer active
        throw e;
      }
    }

    private void fire() {
      end();
      if (!cancelled) {
        target.deliver(Envelope.of(message, key));
      }
    }

    @Override
    public void cancel() {
      cancelled = true;
      Cancellable s = scheduled;
      if (s != null) {
        s.cancel();
      }
      end();
    }

    /** Fired or cancelled, whichever comes first: no longer active. */
    private void end() {
      cancellables.remove(this);
      if (ended.compareAndSet(false, true)) {
        activeTimers.decrementAndGet();
      }
    }
  }

  private final class PeriodicTimer<M> implements Cancellable {
    private final WorkerCell<M> target;
    private final M message;
    private final Duration period;
    private final @Nullable Object key;
    private final AtomicBoolean pending = new AtomicBoolean();
    private final AtomicBoolean ended = new AtomicBoolean();
    private volatile boolean cancelled;
    private volatile @Nullable Cancellable scheduled;

    PeriodicTimer(WorkerCell<M> target, M message, Duration period) {
      this.target = target;
      this.message = message;
      this.period = period;
      this.key = target.keyOf(message); // once, on the caller's thread: never on the scheduler
    }

    void scheduleNext() {
      if (cancelled) {
        return;
      }
      Cancellable s;
      try {
        s = runtime.scheduler().schedule(period, this::fire);
      } catch (RuntimeException e) {
        cancel(); // no next tick: no longer active
        throw e;
      }
      scheduled = s;
      if (cancelled) {
        s.cancel();
      }
    }

    private void fire() {
      if (cancelled) {
        return;
      }
      if (pending.compareAndSet(false, true)) {
        Envelope<M> tick = Envelope.of(message, key)
            .onTaken(() -> pending.set(false))
            .onDropped(() -> pending.set(false));
        SendOutcome outcome = target.deliver(tick);
        if (outcome != SendOutcome.ACCEPTED) {
          pending.set(false);
        }
        if (outcome == SendOutcome.CLOSED) {
          cancel();
          return;
        }
      }
      try {
        scheduleNext();
      } catch (RuntimeException e) {
        LOG.warn("A periodic timer for {} ended: the scheduler refused its next tick", target.id(), e);
      }
    }

    @Override
    public void cancel() {
      cancelled = true;
      Cancellable s = scheduled;
      if (s != null) {
        s.cancel();
      }
      cancellables.remove(this);
      if (ended.compareAndSet(false, true)) {
        activeTimers.decrementAndGet();
      }
    }
  }

  /**
   * Counts the refusals of one cap. Reports go through the owner's shared {@link #nextReport}, so an
   * owner is reported at most once per {@link #REFUSAL_LOG_INTERVAL}, whichever cap refused.
   */
  private final class Refusals {
    private static final long NEVER = Long.MIN_VALUE;

    private final OwnerLimits.Cap cap;
    private final AtomicLong count = new AtomicLong();

    Refusals(OwnerLimits.Cap cap) {
      this.cap = cap;
    }

    void refused(int limit) {
      long total = count.incrementAndGet();
      long now = runtime.nanoTime();
      long next = nextReport.get();
      if ((next == NEVER || now - next >= 0) && nextReport.compareAndSet(next, now + REFUSAL_LOG_INTERVAL.toNanos())) {
        LOG.warn("{} reached its cap of {} {}: {} refused so far (logged at most once a minute)", id, limit, cap.text(), total);
        try {
          runtime.config().listener().capReached(id, cap, limit, total);
        } catch (RuntimeException e) {
          LOG.warn("The runtime listener failed", e);
        }
      }
    }
  }
}
