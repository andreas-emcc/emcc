package dev.emcc.ecore.runtime;

import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Objects;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.LongAdder;
import java.util.function.Consumer;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * A worker: a mailbox, a handler and one virtual thread that feeds the mailbox's messages to the
 * handler one at a time (rule C2).
 *
 * <p><b>Generations.</b> Each thread runs one generation of the worker. When the watchdog restarts
 * a hung worker, the generation increases, the old thread is fenced and interrupted, and a new
 * thread runs a fresh handler from the factory on the same mailbox. A fenced thread can never take
 * another message, and whatever it sends is dropped. The message that hung is not delivered again.
 * The new thread calls the factory itself, under the budget like a handler call, so that a
 * plugin's factory never runs on the watchdog's thread.
 *
 * <p>The small amount of shared state (generation, the running call) is guarded by this object's
 * monitor, which is never held while running plugin code, sending, or calling the listener.
 */
final class WorkerCell<M> implements WorkerHandle<M> {

  private static final Logger LOG = LoggerFactory.getLogger(WorkerCell.class);

  /** The worker generation the current thread runs, if it is a worker thread. */
  private static final ThreadLocal<@Nullable ThreadState> CURRENT = new ThreadLocal<>();

  /** A worker thread's identity: which worker and generation, and whether it is fenced. */
  static final class ThreadState {
    final WorkerCell<?> cell;
    final int generation;
    volatile boolean fenced;

    ThreadState(WorkerCell<?> cell, int generation) {
      this.cell = cell;
      this.generation = generation;
    }
  }

  private final WorkerRuntime runtime;
  /** The owner whose caps this worker's asks count against. */
  private final Owner ownerScope;
  private final WorkerInfo info;
  private final WorkerOptions<M> options;
  private final Mailbox<M> mailbox;
  private final long budgetNanos;

  // Guarded by this.
  private int generation;
  private @Nullable Thread thread;
  private @Nullable ThreadState threadState;
  /** A compute worker's running call: the pool thread it runs on, so that fencing and stop reach it. */
  private @Nullable Thread callThread;
  private boolean active;
  private long activeStart;
  private boolean hungReported;
  /**
   * What the running call handles, for a hang report ({@link HungCall}): the message's class, or
   * {@link #MAKING} / {@link #MAKING_HANDLER}. One write per message (a second only for a deferred
   * message, once made), before the call counts as active; read by the watchdog. Never the message
   * itself; its type's name is built only for a report.
   */
  private volatile Object activeCall = MAKING;
  private WorkerState state = WorkerState.RUNNING;
  private final ArrayDeque<Long> restartTimes = new ArrayDeque<>();
  private long hung;
  private long restarts;

  private final LongAdder processed = new LongAdder();
  private final LongAdder failures = new LongAdder();
  private final LongAdder totalNanos = new LongAdder();
  private final AtomicLong maxNanos = new AtomicLong();

  private static final String MAKING = "(making the message)";
  private static final String MAKING_HANDLER = "(making a fresh handler)";

  WorkerCell(WorkerRuntime runtime, Owner owner, WorkerOptions<M> options) {
    this.runtime = runtime;
    this.ownerScope = owner;
    this.info = new WorkerInfo(owner.id() + "/" + options.name(), owner.id(), options.name());
    this.options = options;
    this.mailbox = new Mailbox<>(options.capacity(), options.overflow());
    this.budgetNanos = options.budget().toNanos();
  }

  /** The thread state of the calling thread, or {@code null} if it is not a worker thread. */
  static @Nullable ThreadState current() {
    return CURRENT.get();
  }

  // ---- WorkerHandle ---------------------------------------------------------------------------

  @Override
  public String id() {
    return info.id();
  }

  @Override
  public String owner() {
    return info.owner();
  }

  @Override
  public String name() {
    return info.name();
  }

  @Override
  public SendOutcome send(M message) {
    Objects.requireNonNull(message, "message");
    ThreadState sender = CURRENT.get();
    if (sender != null && sender.fenced) {
      LOG.warn("Dropped a message to {} sent from the fenced thread of {}", info.id(), sender.cell.id());
      return SendOutcome.DROPPED;
    }
    // Worker threads never wait (BLOCK_SENDER degrades to DROPPED for them).
    return mailbox.offer(Envelope.of(message, keyOf(message)), sender == null, options.sendTimeout());
  }

  @Override
  public String toString() {
    return "Worker[" + info.id() + "]";
  }

  // ---- Runtime side ---------------------------------------------------------------------------

  WorkerInfo info() {
    return info;
  }

  /** A delivery by the runtime (timer, topic, ask request): never waits. */
  SendOutcome deliver(Envelope<M> envelope) {
    return mailbox.offer(envelope, false, Duration.ZERO);
  }

  /** An answer: always queued unless the worker is stopped ({@link SendOutcome#CLOSED}). */
  SendOutcome deliverSystem(Envelope<M> envelope) {
    return mailbox.offer(envelope, false, Duration.ZERO);
  }

  /**
   * The coalescing key of a message or topic payload. A failing key function means "no key".
   *
   * <p>For a plugin worker this is plugin code ({@code Coalescing.coalesceKey()}, a data accessor),
   * so it runs only on threads that act for a sender: the sending worker's or the publishing
   * worker's own handler call (under that call's budget), or the thread that sets a timer (the key
   * is taken once, when the timer is made). Never on the scheduler or the watchdog.
   */
  @Nullable Object keyOf(Object messageOrPayload) {
    try {
      return options.coalesceKey().apply(messageOrPayload);
    } catch (Throwable e) { // plugin code (Coalescing.coalesceKey) on the sender's thread
      LOG.warn("Worker {}: the coalescing key function failed; not coalescing", info.id(), e);
      return null;
    }
  }

  /** Creates the first handler and starts the thread. Throws if the handler factory fails. */
  void start() {
    launch(0, newHandler());
  }

  private MessageHandler<M> newHandler() {
    return Objects.requireNonNull(options.handlerFactory().get(), "the handler factory returned null");
  }

  /** Starts generation {@code gen}; with no {@code handler}, its thread gets one from the factory first. */
  private void launch(int gen, @Nullable MessageHandler<M> handler) {
    ThreadState ts = new ThreadState(this, gen);
    Thread t = Thread.ofVirtual().name("ecore-worker-" + info.id() + "#" + gen).unstarted(() -> runLoop(ts, handler));
    synchronized (this) {
      if (gen != generation || state == WorkerState.STOPPED || state == WorkerState.FAILED) {
        return;
      }
      thread = t;
      threadState = ts;
    }
    t.start();
  }

  private void runLoop(ThreadState ts, @Nullable MessageHandler<M> first) {
    CURRENT.set(ts);
    ClassLoader loader = options.contextClassLoader();
    if (loader != null) {
      Thread.currentThread().setContextClassLoader(loader); // from the thread's start, factory included
    }
    HandlerContext<M> context = new Context(ts);
    try {
      MessageHandler<M> handler = first != null ? first : handlerFromFactory(ts);
      if (handler == null) {
        return; // the factory failed, or this thread was fenced while it ran
      }
      while (!ts.fenced) {
        Envelope<M> envelope;
        try {
          envelope = mailbox.take();
        } catch (InterruptedException e) {
          continue; // re-check the fence
        }
        if (envelope == null) {
          return; // stopped
        }
        if (!process(ts, handler, context, envelope)) {
          return; // fenced during the call
        }
      }
    } finally {
      CURRENT.remove();
    }
  }

  /**
   * Calls the handler factory on this worker's thread after a restart, watched like a handler call,
   * and reports the restart. Returns null if it failed (the worker is then closed) or this thread
   * was fenced meanwhile.
   */
  private @Nullable MessageHandler<M> handlerFromFactory(ThreadState ts) {
    synchronized (this) {
      if (ts.generation != generation) {
        return null;
      }
      activeCall = MAKING_HANDLER;
      active = true;
      activeStart = runtime.clock().nanoTime();
      hungReported = false;
    }
    MessageHandler<M> handler = null;
    Throwable failure = null;
    try {
      handler = newHandler();
    } catch (Throwable e) { // plugin code; see process()
      failure = e;
    }
    synchronized (this) {
      if (ts.generation != generation) {
        return null;
      }
      active = false;
      hungReported = false;
      if (state == WorkerState.HUNG) {
        state = WorkerState.RUNNING;
      }
    }
    Thread.interrupted();
    if (failure != null) {
      fail(failure);
      return null;
    }
    long count;
    synchronized (this) {
      count = restarts;
    }
    notifyListener(l -> l.workerRestarted(info, count));
    return handler;
  }

  /** Runs one handler call. Returns false if this thread was fenced meanwhile. */
  private boolean process(ThreadState ts, MessageHandler<M> handler, HandlerContext<M> context, Envelope<M> envelope) {
    M given = envelope.given();
    long start = runtime.clock().nanoTime();
    boolean fenced;
    synchronized (this) {
      fenced = ts.generation != generation;
      if (!fenced) {
        activeCall = given != null ? given.getClass() : MAKING; // before the call counts as active; not from a fenced thread
        if (!options.compute()) { // a compute call is active from when it starts on its pool thread
          active = true;
          activeStart = start;
          hungReported = false;
        }
      }
    }
    if (fenced) {
      envelope.dropped(); // taken but never made, outside the monitor: e.g. an output channel's items handed over come down
      return false;
    }
    Throwable failure = null;
    String[] messageType = {"(message not made: its mapper failed)"};
    Runnable call = () -> {
      M message = envelope.resolve();
      messageType[0] = message.getClass().getName();
      if (given == null && !ts.fenced) {
        // Made now. Best effort, without the lock: a restart between the check and the write could
        // leave this type in place of the new thread's for a report; the cost of a lock per deferred
        // message is not worth that.
        activeCall = message.getClass();
      }
      handler.handle(message, context);
    };
    if (options.compute()) {
      failure = onComputeThread(ts, call, envelope::dropped);
    } else {
      try {
        call.run();
      } catch (Throwable e) {
        // Everything is handled here, Errors included (LinkageError, OutOfMemoryError...): rethrowing
        // would end this thread and leave the mailbox without a consumer, and the worker would later
        // look hung. Reporting it and going on to the next message is the only safe choice.
        failure = e;
      }
    }
    long elapsed = runtime.clock().nanoTime() - start;
    boolean current;
    boolean recovered;
    synchronized (this) {
      current = ts.generation == generation;
      recovered = current && hungReported;
      if (current) {
        active = false;
        hungReported = false;
        if (state == WorkerState.HUNG) {
          state = WorkerState.RUNNING;
        }
      }
    }
    if (!current) {
      LOG.info("Worker {}: the fenced handler call of generation {} returned", info.id(), ts.generation);
      return false;
    }
    Thread.interrupted(); // a late interrupt must not leak into the next call
    processed.increment();
    totalNanos.add(elapsed);
    maxNanos.accumulateAndGet(elapsed, Math::max);
    if (failure != null) {
      Throwable error = failure;
      failures.increment();
      LOG.error("Worker {}: handler call for {} failed; message dropped, continuing with the next one",
          info.id(), messageType[0], error);
      notifyListener(l -> l.handlerFailed(info, error));
    }
    if (recovered) {
      Duration took = Duration.ofNanos(elapsed);
      HungCall hungCall = hungCall(activeCall, start);
      LOG.warn("Worker {} recovered: the hung call returned after {} ms. The call was {}.", info.id(), took.toMillis(), hungCall.text());
      notifyListener(l -> l.workerRecovered(info, took, hungCall));
    }
    return true;
  }

  /**
   * Runs a compute worker's handler call on the runtime's pool of platform threads (rule C7), as the
   * worker's own call: same thread state (sender, fence), same context class loader. This worker's
   * thread waits for it, which a virtual thread does without holding a carrier; the watchdog's budget
   * starts when the call does, not while it waits for a free pool thread. Returns what the
   * call threw, or null; also null when the call was fenced meanwhile (the caller sees that from the
   * generation). An interrupt of the waiting thread (stop) is passed on to the call; a call still
   * waiting for a pool thread when the worker stops never runs, and {@code notRun} runs instead.
   */
  private @Nullable Throwable onComputeThread(ThreadState ts, Runnable call, Runnable notRun) {
    ClassLoader loader = options.contextClassLoader();
    Future<@Nullable Throwable> result;
    try {
      result = runtime.computePool().submit(() -> {
        Thread me = Thread.currentThread();
        ClassLoader previous = me.getContextClassLoader();
        CURRENT.set(ts);
        if (loader != null) {
          me.setContextClassLoader(loader);
        }
        boolean stopped;
        synchronized (this) {
          stopped = state == WorkerState.STOPPED; // stopped while the call waited for a pool thread
          if (!stopped && ts.generation == generation) {
            callThread = me;
            active = true; // the budget counts from here, not from the wait for a pool thread
            activeStart = runtime.clock().nanoTime();
            hungReported = false;
          }
        }
        try {
          if (!stopped) {
            call.run();
          } else {
            notRun.run();
          }
          return null;
        } catch (Throwable e) { // as in process(): every throwable is the call's failure
          return e;
        } finally {
          synchronized (this) {
            if (callThread == me) {
              callThread = null;
            }
          }
          CURRENT.remove();
          me.setContextClassLoader(previous);
          Thread.interrupted(); // the pool thread starts its next call clean
        }
      });
    } catch (RejectedExecutionException e) {
      notRun.run();
      return e; // the runtime is closing
    }
    while (true) {
      try {
        return result.get();
      } catch (InterruptedException e) {
        if (ts.fenced) {
          return null; // the watchdog restarted the worker; the stuck call is no longer ours
        }
        Thread running;
        synchronized (this) {
          running = callThread;
        }
        if (running != null) {
          running.interrupt(); // stop: interrupt the call, as for an ordinary worker
        } else if (result.cancel(false)) {
          notRun.run(); // at most once with the callable's own (the drop hook is once-only)
          return null; // stop while the call still waits for a pool thread: it never runs
        }
      } catch (ExecutionException e) {
        return e.getCause();
      } catch (CancellationException e) {
        return e;
      }
    }
  }

  /**
   * True if no message waits and none is being handled, or the call that runs is already reported
   * hung (advancing a manual clock cannot change anything for it). See {@link WorkerRuntime#idle()}.
   * The cell's lock and the mailbox's lock are taken one after the other, never together.
   */
  boolean idle() {
    synchronized (this) {
      if (active) {
        return hungReported;
      }
    }
    return mailbox.idle();
  }

  /**
   * What a call that started at {@code start} handles, and the JVM's GC time since. Never under the
   * cell's lock, and never fails: a report must go on to the restart.
   */
  private HungCall hungCall(Object call, long start) {
    String message = call instanceof Class<?> type ? HungCall.typeName(type) : String.valueOf(call);
    try {
      GcHistory.Since gc = runtime.gcHistory().since(start);
      return new HungCall(message, gc.millis(), gc.fromStart());
    } catch (RuntimeException e) {
      return new HungCall(message, HungCall.GC_UNKNOWN, false);
    }
  }

  /** Called by the watchdog: reports a call over budget and restarts the worker if allowed. */
  void checkWatchdog(long now) {
    Thread stuck = null;
    Thread stuckCall = null;
    boolean restart = false;
    long elapsed;
    long start;
    Object call;
    int newGeneration = 0;
    synchronized (this) {
      if (!active || hungReported || state != WorkerState.RUNNING) {
        return;
      }
      start = activeStart;
      call = activeCall;
      elapsed = now - activeStart;
      if (elapsed <= budgetNanos) {
        return;
      }
      hungReported = true;
      hung++;
      state = WorkerState.HUNG;
      if (options.restartable() && mayRestart(now)) {
        restartTimes.addLast(now);
        restarts++;
        generation++;
        newGeneration = generation;
        if (threadState != null) {
          threadState.fenced = true;
        }
        stuck = thread;
        stuckCall = callThread;
        thread = null;
        callThread = null;
        threadState = null;
        active = false;
        hungReported = false;
        state = WorkerState.RUNNING;
        restart = true;
      }
    }

    Duration took = Duration.ofNanos(elapsed);
    HungCall hungCall = hungCall(call, start); // after the cell's lock: the GC history's is a leaf lock of its own
    if (restart) {
      LOG.warn("Worker {} hung: handler call running for {} ms (budget {} ms). Restarting with a fresh handler. The call was {}.",
          info.id(), took.toMillis(), options.budget().toMillis(), hungCall.text());
    } else if (options.restartable()) {
      LOG.error("Worker {} hung: handler call running for {} ms (budget {} ms). Restart limit reached ({} within {}); not restarting. The call was {}.",
          info.id(), took.toMillis(), options.budget().toMillis(), runtime.config().restartLimit(), runtime.config().restartWindow(),
          hungCall.text());
    } else {
      LOG.error("Worker {} hung: handler call running for {} ms (budget {} ms). The worker is not restartable. The call was {}.",
          info.id(), took.toMillis(), options.budget().toMillis(), hungCall.text());
    }
    boolean restarting = restart;
    notifyListener(l -> l.workerHung(info, took, restarting, hungCall));
    if (!restart) {
      return;
    }
    if (stuck != null) {
      stuck.interrupt();
    }
    if (stuckCall != null) {
      stuckCall.interrupt(); // a compute worker's call on its pool thread
    }
    mailbox.abandonProcessing(); // the stuck call is no longer this worker's (outside the cell's lock)
    launch(newGeneration, null); // the new thread calls the factory and reports the restart
  }

  /** Called with the monitor held. */
  private boolean mayRestart(long now) {
    long window = runtime.config().restartWindow().toNanos();
    while (!restartTimes.isEmpty() && now - restartTimes.getFirst() > window) {
      restartTimes.removeFirst();
    }
    return restartTimes.size() < runtime.config().restartLimit();
  }

  private void fail(Throwable error) {
    synchronized (this) {
      state = WorkerState.FAILED;
    }
    mailbox.close();
    LOG.error("Worker {}: restart failed, the handler factory threw; the worker is closed", info.id(), error);
    notifyListener(l -> l.workerFailed(info, error));
  }

  /**
   * Stops the worker: closes the mailbox (sends get {@link SendOutcome#CLOSED}, queued messages are
   * discarded and pending asks for them fail), and lets a running call finish within the budget.
   */
  void stop() {
    Thread t;
    synchronized (this) {
      if (state == WorkerState.STOPPED) {
        return;
      }
      state = WorkerState.STOPPED;
      t = thread;
    }
    int discarded = mailbox.close();
    if (discarded > 0) {
      LOG.debug("Worker {} stopped; {} queued messages discarded", info.id(), discarded);
    }
    if (t == null || t == Thread.currentThread()) {
      return;
    }
    try {
      if (!t.join(options.budget())) {
        t.interrupt();
        LOG.warn("Worker {}: the running call did not finish within {} ms at stop; interrupted",
            info.id(), options.budget().toMillis());
      }
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }

  WorkerStats stats() {
    Mailbox.Counters c = mailbox.counters();
    WorkerState s;
    long h;
    long r;
    synchronized (this) {
      s = state;
      h = hung;
      r = restarts;
    }
    return new WorkerStats(info, s, c.queued(), options.capacity(), c.accepted(), c.dropped(), c.evicted(),
        c.coalesced(), processed.sum(), failures.sum(), h, r, Duration.ofNanos(maxNanos.get()),
        Duration.ofNanos(totalNanos.sum()));
  }

  private void notifyListener(Consumer<RuntimeListener> event) {
    try {
      event.accept(runtime.config().listener());
    } catch (Throwable e) { // must never end a worker or the watchdog
      LOG.warn("The runtime listener failed", e);
    }
  }

  /** The context of one generation. Fenced together with its thread. */
  private final class Context implements HandlerContext<M> {

    private final ThreadState ts;

    Context(ThreadState ts) {
      this.ts = ts;
    }

    @Override
    public WorkerHandle<M> self() {
      return WorkerCell.this;
    }

    @Override
    public <Q, R> void ask(
        WorkerHandle<Q> target,
        Function<ReplyHandle<R>, ? extends Q> request,
        Duration timeout,
        Function<Answer<R>, ? extends M> toMessage) {
      Objects.requireNonNull(target, "target");
      Objects.requireNonNull(request, "request");
      Objects.requireNonNull(timeout, "timeout");
      Objects.requireNonNull(toMessage, "toMessage");
      if (timeout.compareTo(MIN_ASK_TIMEOUT) < 0 || timeout.compareTo(MAX_ASK_TIMEOUT) > 0) {
        throw new IllegalArgumentException("ask timeout must be " + MIN_ASK_TIMEOUT + ".." + MAX_ASK_TIMEOUT + ": " + timeout);
      }
      if (ts.fenced) {
        LOG.warn("Dropped an ask to {} from the fenced handler of {}", target.id(), info.id());
        return;
      }
      if (!(target instanceof WorkerCell<Q> targetCell)) {
        throw new IllegalArgumentException("unknown worker handle: " + target);
      }
      if (!ownerScope.acquireAsk()) {
        // Over the owner's cap (CR-0005): answered at once, through the usual single answer.
        new PendingAsk<R, M>(runtime.nextAskId(), WorkerCell.this, toMessage, () -> {})
            .complete(new Answer.Failed<>(OwnerLimits.TOO_MANY_ASKS));
        return;
      }
      PendingAsk<R, M> pending = new PendingAsk<>(runtime.nextAskId(), WorkerCell.this, toMessage, ownerScope::releaseAsk);
      Q requestMessage;
      try {
        requestMessage = Objects.requireNonNull(request.apply(pending), "the request function returned null");
      } catch (RuntimeException | Error e) {
        pending.abandon(); // nothing was sent; gives the slot back unless the ask already ended
        throw e;
      }
      pending.startTimer(runtime.scheduler(), timeout);
      Envelope<Q> envelope = Envelope.of(requestMessage, targetCell.keyOf(requestMessage))
          .onDropped(() -> pending.complete(new Answer.Failed<>("the request was evicted from the mailbox of " + targetCell.id())));
      switch (targetCell.deliver(envelope)) {
        case ACCEPTED -> {}
        case DROPPED -> pending.complete(new Answer.Failed<>("the mailbox of " + targetCell.id() + " is full"));
        case CLOSED -> pending.complete(new Answer.Failed<>(targetCell.id() + " is stopped"));
      }
    }
  }
}
