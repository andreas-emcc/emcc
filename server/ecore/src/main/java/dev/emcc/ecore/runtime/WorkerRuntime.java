package dev.emcc.ecore.runtime;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * ECore's worker runtime and message bus. Created by ECore at start and closed at stop.
 *
 * <pre>{@code
 * Owner core = runtime.owner("core");
 * WorkerHandle<StoreMsg> store = core.spawn(WorkerOptions.of("object-store", ObjectStore::new));
 * store.send(new StoreMsg.Apply(request, Requester.NO_USER, reply));
 * }</pre>
 */
public final class WorkerRuntime implements AutoCloseable {

  private static final Logger LOG = LoggerFactory.getLogger(WorkerRuntime.class);
  private static final Pattern OWNER_ID = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");

  private final RuntimeConfig config;
  private final Scheduler scheduler;
  private final @Nullable SystemScheduler ownScheduler;
  private final TopicBus bus = new TopicBus();
  private final AtomicLong askIds = new AtomicLong();
  private final ExecutorService io =
      Executors.newThreadPerTaskExecutor(Thread.ofVirtual().name("ecore-io-", 0).factory());
  /** Platform threads for compute workers' handler calls (rule C7); each worker has at most one call in it. */
  private final ExecutorService compute;

  // Guarded by this.
  private final Map<String, Owner> owners = new LinkedHashMap<>();
  private boolean closed;
  private @Nullable Cancellable watchdog;
  /** The JVM's GC time, sampled on each watchdog tick, for the hang reports. */
  private final GcHistory gcHistory;

  private WorkerRuntime(RuntimeConfig config) {
    this.config = config;
    this.gcHistory = new GcHistory(config.gcTime());
    this.compute = Executors.newFixedThreadPool(
        config.computeThreads(), Thread.ofPlatform().name("ecore-compute-", 0).daemon(true).factory());
    Scheduler given = config.scheduler();
    if (given != null) {
      this.scheduler = given;
      this.ownScheduler = null;
    } else {
      SystemScheduler own = new SystemScheduler();
      this.scheduler = own;
      this.ownScheduler = own;
    }
  }

  /** Creates the runtime and starts its watchdog. */
  public static WorkerRuntime start(RuntimeConfig config) {
    WorkerRuntime runtime = new WorkerRuntime(Objects.requireNonNull(config, "config"));
    runtime.scheduleWatchdog();
    LOG.info("Worker runtime started (watchdog every {} ms)", config.watchdogInterval().toMillis());
    return runtime;
  }

  /** The scope of {@code ownerId} ({@code core} or a plugin id); created on first use. */
  public synchronized Owner owner(String ownerId) {
    Objects.requireNonNull(ownerId, "ownerId");
    if (closed) {
      throw new IllegalStateException("the worker runtime is closed");
    }
    if (!OWNER_ID.matcher(ownerId).matches()) {
      throw new IllegalArgumentException("owner id must be lowercase words separated by hyphens: " + ownerId);
    }
    return owners.computeIfAbsent(ownerId, id -> new Owner(this, id));
  }

  /**
   * Publishes {@code payload} on {@code topic}. Never blocks. Returns how many subscribers accepted
   * it (the others dropped it under their overflow policy).
   */
  public <T> int publish(Topic<T> topic, T payload) {
    Objects.requireNonNull(topic, "topic");
    if (onFencedThread()) {
      LOG.warn("Dropped a publication on {} from a fenced worker thread", topic.name());
      return 0;
    }
    return bus.publish(topic, payload);
  }

  // ---- For other parts of ECore (plugin host, edge, outbound HTTP); never given to plugins ----

  /**
   * True if the calling thread is a worker thread that the watchdog has fenced after a restart.
   * Parts of ECore that act on behalf of a worker (e.g. outbound HTTP) drop the request then.
   */
  public static boolean onFencedThread() {
    WorkerCell.ThreadState current = WorkerCell.current();
    return current != null && current.fenced;
  }

  /**
   * Delivers a message that ECore makes for {@code target}, e.g. an endpoint request. Never blocks.
   * {@code message} runs in the target's worker. The coalescing key is taken from {@code keySource}
   * (e.g. a topic payload), if not null. {@code onDropped} runs if the message is accepted but
   * later evicted, replaced by coalescing or discarded at stop; a refusal is told by the outcome
   * instead (e.g. answer an endpoint request with 503 in both cases).
   */
  public <M> SendOutcome deliver(
      WorkerHandle<M> target, Supplier<? extends M> message, @Nullable Object keySource, Runnable onDropped) {
    WorkerCell<M> cell = cellOf(target);
    Objects.requireNonNull(message, "message");
    Objects.requireNonNull(onDropped, "onDropped");
    Object key = keySource == null ? null : cell.keyOf(keySource);
    return cell.deliver(Envelope.<M>deferred(message, key).onDropped(onDropped));
  }

  /**
   * Delivers an answer to something {@code target} asked for (e.g. an outbound HTTP result): always
   * queued, whatever the overflow policy, and never coalesced. {@code message} runs in the target's
   * worker. Returns false if the worker is stopped.
   */
  public <M> boolean deliverAlways(WorkerHandle<M> target, Supplier<? extends M> message) {
    return cellOf(target).deliverSystem(Envelope.system(Objects.requireNonNull(message, "message")))
        == SendOutcome.ACCEPTED;
  }

  /**
   * Like {@link #deliverAlways(WorkerHandle, Supplier)}, and {@code onDropped} runs if the message
   * is discarded at the worker's stop instead of made (e.g. an output channel's item, whose count
   * of items handed over must come down either way). A restart keeps the mailbox, so it does not
   * drop the message. Not run when this returns false.
   */
  public <M> boolean deliverAlways(WorkerHandle<M> target, Supplier<? extends M> message, Runnable onDropped) {
    Objects.requireNonNull(onDropped, "onDropped");
    return cellOf(target).deliverSystem(Envelope.<M>system(Objects.requireNonNull(message, "message")).onDropped(onDropped))
        == SendOutcome.ACCEPTED;
  }

  /**
   * An ask that ECore makes on behalf of {@code owner} (e.g. a plugin's store query): like {@link
   * HandlerContext#ask}, it counts under the owner's cap of outstanding asks (CR-0005) and ends
   * exactly once (the answer, a delivery failure or the timeout); the end is converted by {@code
   * toMessage} in {@code replyTo}'s worker and always delivered. Over the cap it ends at once with
   * {@link OwnerLimits#TOO_MANY_ASKS}. From a fenced thread it is dropped.
   *
   * @param timeout {@link HandlerContext#MIN_ASK_TIMEOUT} to {@link HandlerContext#MAX_ASK_TIMEOUT}
   */
  public <Q, R, M> void askFor(Owner owner, WorkerHandle<Q> target, Function<ReplyHandle<R>, ? extends Q> request,
      Duration timeout, WorkerHandle<M> replyTo, Function<Answer<R>, ? extends M> toMessage) {
    Objects.requireNonNull(owner, "owner");
    Objects.requireNonNull(request, "request");
    Objects.requireNonNull(toMessage, "toMessage");
    if (timeout.compareTo(HandlerContext.MIN_ASK_TIMEOUT) < 0 || timeout.compareTo(HandlerContext.MAX_ASK_TIMEOUT) > 0) {
      throw new IllegalArgumentException(
          "ask timeout must be " + HandlerContext.MIN_ASK_TIMEOUT + ".." + HandlerContext.MAX_ASK_TIMEOUT + ": " + timeout);
    }
    WorkerCell<Q> targetCell = cellOf(target);
    WorkerCell<M> asker = cellOf(replyTo);
    if (onFencedThread()) {
      LOG.warn("Dropped an ask to {} from a fenced thread, for {}", target.id(), owner.id());
      return;
    }
    if (!owner.acquireAsk()) {
      new PendingAsk<R, M>(nextAskId(), asker, toMessage, () -> {}).complete(new Answer.Failed<>(OwnerLimits.TOO_MANY_ASKS));
      return;
    }
    PendingAsk<R, M> pending = new PendingAsk<>(nextAskId(), asker, toMessage, owner::releaseAsk);
    Q message;
    try {
      message = Objects.requireNonNull(request.apply(pending), "the request function returned null");
    } catch (RuntimeException | Error e) {
      pending.abandon();
      throw e;
    }
    pending.startTimer(scheduler, timeout);
    Envelope<Q> envelope = Envelope.of(message, targetCell.keyOf(message))
        .onDropped(() -> pending.complete(new Answer.Failed<>("the request was evicted from the mailbox of " + targetCell.id())));
    switch (targetCell.deliver(envelope)) {
      case ACCEPTED -> {}
      case DROPPED -> pending.complete(new Answer.Failed<>("the mailbox of " + targetCell.id() + " is full"));
      case CLOSED -> pending.complete(new Answer.Failed<>(targetCell.id() + " is stopped"));
    }
  }

  /**
   * Starts a dedicated virtual thread for a plugin listener's loop (overview 4.2: "a dedicated
   * virtual thread with a loop"; SDK v1 listeners). The loop may block in socket reads and writes;
   * it runs no handler and has no watchdog budget. Its context class loader is {@code loader}.
   */
  public Thread startLoop(String name, @Nullable ClassLoader loader, Runnable body) {
    return start(Thread.ofVirtual().name(Objects.requireNonNull(name, "name")), loader, body);
  }

  /**
   * Starts a platform thread, a daemon, for a plugin's connection task (ADR-0036 as amended by
   * CR-0027): one run, or the plugin's {@code close} calls at its stop. Not a virtual thread: on
   * Windows a virtual thread blocked writing a socket may never wake while another blocks reading
   * it (JDK-8334574), and a task and its child do exactly that. Its context class loader is {@code
   * loader}.
   */
  public Thread startTaskThread(String name, @Nullable ClassLoader loader, Runnable body) {
    return start(Thread.ofPlatform().daemon(true).name(Objects.requireNonNull(name, "name")), loader, body);
  }

  private static Thread start(Thread.Builder builder, @Nullable ClassLoader loader, Runnable body) {
    Thread t = builder.unstarted(Objects.requireNonNull(body, "body"));
    if (loader != null) {
      t.setContextClassLoader(loader);
    }
    t.start();
    return t;
  }

  /**
   * Virtual threads for ECore's own I/O completions, e.g. the HTTP client behind the SDK's outbound
   * HTTP. Never for plugin code or handler calls. Shut down when the runtime closes.
   */
  public Executor ioExecutor() {
    return io;
  }

  /** Runs a short task after {@code delay} on the runtime's scheduler (e.g. an endpoint timeout). */
  public Cancellable schedule(Duration delay, Runnable task) {
    return scheduler.schedule(Objects.requireNonNull(delay, "delay"), Objects.requireNonNull(task, "task"));
  }

  private static <M> WorkerCell<M> cellOf(WorkerHandle<M> handle) {
    Objects.requireNonNull(handle, "target");
    if (!(handle instanceof WorkerCell<M> cell)) {
      throw new IllegalArgumentException("unknown worker handle: " + handle);
    }
    return cell;
  }

  /**
   * True if no worker of this runtime has a message waiting or a handler call running, except calls
   * already reported hung. Tests on a manual clock wait for this before they advance the clock:
   * advancing while a call is still finishing would make it look hung to the watchdog. Work outside
   * the workers (I/O executor tasks, other threads about to send) is not seen.
   *
   * <p><b>A test aid only; not for production logic</b>: the answer is stale as soon as it is given.
   */
  public boolean idle() {
    for (Owner owner : ownersSnapshot()) {
      for (WorkerCell<?> cell : owner.cells()) {
        if (!cell.idle()) {
          return false;
        }
      }
    }
    return true;
  }

  /** Every owner so far ({@code core-…} and the plugins), e.g. for their refusal counters in the monitor view. */
  public List<Owner> owners() {
    return ownersSnapshot();
  }

  /** Counters of every worker, for the monitor view and metrics. */
  public List<WorkerStats> stats() {
    List<WorkerStats> result = new ArrayList<>();
    for (Owner owner : ownersSnapshot()) {
      for (WorkerCell<?> cell : owner.cells()) {
        result.add(cell.stats());
      }
    }
    return List.copyOf(result);
  }

  /** Stops every owner, newest first, then the watchdog and the scheduler. */
  @Override
  public void close() {
    List<Owner> toStop;
    Cancellable wd;
    synchronized (this) {
      if (closed) {
        return;
      }
      closed = true;
      toStop = new ArrayList<>(owners.values());
      wd = watchdog;
    }
    if (wd != null) {
      wd.cancel();
    }
    Collections.reverse(toStop);
    for (Owner owner : toStop) {
      owner.stop();
    }
    if (ownScheduler != null) {
      ownScheduler.close();
    }
    io.shutdownNow();
    compute.shutdownNow();
    LOG.info("Worker runtime stopped");
  }

  /** How many platform threads run compute workers' handler calls at a time (rule C7). */
  public int computeThreads() {
    return config.computeThreads();
  }

  /** Where compute workers' handler calls run. */
  ExecutorService computePool() {
    return compute;
  }

  RuntimeConfig config() {
    return config;
  }

  /** The runtime's monotonic time in nanoseconds (the manual clock in tests), e.g. for intervals. */
  public long nanoTime() {
    return config.clock().nanoTime();
  }

  RuntimeClock clock() {
    return config.clock();
  }

  Scheduler scheduler() {
    return scheduler;
  }

  TopicBus bus() {
    return bus;
  }

  String nextAskId() {
    return "ask-" + askIds.incrementAndGet();
  }

  private synchronized List<Owner> ownersSnapshot() {
    return List.copyOf(owners.values());
  }

  private void scheduleWatchdog() {
    synchronized (this) {
      if (closed) {
        return;
      }
    }
    Cancellable next = scheduler.schedule(config.watchdogInterval(), this::watchdogTick);
    synchronized (this) {
      watchdog = next;
      if (closed) {
        next.cancel();
      }
    }
  }

  /** The JVM's GC time as the watchdog sampled it, for the hang reports. */
  GcHistory gcHistory() {
    return gcHistory;
  }

  private void watchdogTick() {
    try {
      long now = config.clock().nanoTime();
      gcHistory.sample(now);
      for (Owner owner : ownersSnapshot()) {
        for (WorkerCell<?> cell : owner.cells()) {
          cell.checkWatchdog(now);
        }
      }
    } catch (RuntimeException e) {
      LOG.error("The watchdog check failed", e);
    } finally {
      scheduleWatchdog();
    }
  }
}
