package dev.emcc.ecore.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Compute workers (rule C7): handler calls on a bounded pool of platform threads, watched as usual. */
class ComputeWorkerTest {

  private static final Duration BUDGET = Duration.ofSeconds(30);

  private final ManualTime time = new ManualTime();
  private final RecordingListener listener = new RecordingListener();
  private final WorkerRuntime runtime =
      WorkerRuntime.start(RuntimeConfig.defaults().time(time).listener(listener).computeThreads(2));
  private final Probe<String> seen = new Probe<>();
  private final CountDownLatch release = new CountDownLatch(1);

  @AfterEach
  void close() {
    release.countDown();
    runtime.close();
  }

  private WorkerHandle<String> spawn(String name, boolean compute, MessageHandler<String> handler) {
    return runtime.owner("core").spawn(WorkerOptions.of(name, () -> handler).budget(BUDGET).compute(compute));
  }

  private static String where() {
    Thread t = Thread.currentThread();
    return (t.isVirtual() ? "virtual " : "platform ") + t.getName().replaceAll("-\\d+$", "-n").replaceAll("#\\d+$", "");
  }

  @Test
  void aComputeWorkersCallsRunOnThePoolAndAnOrdinaryWorkersOnItsVirtualThread() {
    spawn("compute", true, (text, ctx) -> seen.add("compute on " + where())).send("go");
    assertThat(seen.next()).isEqualTo("compute on platform ecore-compute-n");

    spawn("ordinary", false, (text, ctx) -> seen.add("ordinary on " + where())).send("go");
    assertThat(seen.next()).isEqualTo("ordinary on virtual ecore-worker-core/ordinary");
  }

  @Test
  void atMostAsManyCallsRunAsThePoolHasThreadsAndTheOthersWait() {
    AtomicInteger running = new AtomicInteger();
    AtomicInteger most = new AtomicInteger();
    CountDownLatch twoIn = new CountDownLatch(2);
    List<WorkerHandle<String>> workers = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      workers.add(spawn("compute-" + i, true, (text, ctx) -> {
        most.accumulateAndGet(running.incrementAndGet(), Math::max);
        twoIn.countDown();
        WorkerRuntimeTest.await(release);
        running.decrementAndGet();
        seen.add("done");
      }));
    }
    workers.forEach(w -> w.send("go"));
    WorkerRuntimeTest.await(twoIn);
    assertThat(seen.drain()).isEmpty();

    release.countDown();

    assertThat(seen.next(4)).containsOnly("done");
    assertThat(most.get()).isEqualTo(2);
  }

  @Test
  void aComputeCallSendsAsItsWorkerAndHasItsContextClassLoader() {
    ClassLoader plugin = new java.net.URLClassLoader("plugin-x", new java.net.URL[0], getClass().getClassLoader());
    WorkerHandle<String> echo = spawn("echo", false, (text, ctx) -> seen.add(text));
    runtime.owner("core").spawn(WorkerOptions.<String>of("compute", () -> (text, ctx) -> {
      seen.add("loader " + Thread.currentThread().getContextClassLoader().getName());
      seen.add("send " + echo.send("from " + ctx.self().id()));
    }).compute(true).contextClassLoader(plugin)).send("go");

    assertThat(seen.next(3)).containsExactlyInAnyOrder("loader plugin-x", "send ACCEPTED", "from core/compute");
  }

  @Test
  void theBudgetCountsFromTheStartOfTheCallNotFromTheWaitForAPoolThread() {
    WorkerRuntime one = WorkerRuntime.start(RuntimeConfig.defaults().time(time).listener(listener).computeThreads(1));
    try {
      CountDownLatch blocking = new CountDownLatch(1);
      one.owner("core").spawn(WorkerOptions.<String>of("first", () -> (text, ctx) -> {
        blocking.countDown();
        WorkerRuntimeTest.await(release);
      }).compute(true).budget(Duration.ofSeconds(60))).send("go");
      WorkerRuntimeTest.await(blocking);
      one.owner("core").spawn(WorkerOptions.<String>of("second", () -> (text, ctx) -> seen.add("second ran"))
          .compute(true).budget(Duration.ofSeconds(1))).send("go");

      time.advance(Duration.ofSeconds(2)); // the second waits for the pool longer than its budget
      release.countDown();

      assertThat(seen.next()).isEqualTo("second ran");
      assertThat(listener.events.drain()).noneMatch(e -> e.startsWith("hung core/second"));
    } finally {
      one.close();
    }
  }

  private static void waitUntil(java.util.function.BooleanSupplier condition) throws InterruptedException {
    long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (!condition.getAsBoolean()) {
      assertThat(System.nanoTime()).as("within 10 s").isLessThan(end);
      Thread.sleep(5);
    }
  }

  @Test
  void aCallThatStillWaitsForAPoolThreadWhenItsWorkerStopsIsDroppedOnce() throws Exception {
    WorkerRuntime one = WorkerRuntime.start(RuntimeConfig.defaults().time(time).listener(listener).computeThreads(1));
    try {
      CountDownLatch blocking = new CountDownLatch(1);
      one.owner("core").spawn(WorkerOptions.<String>of("first", () -> (text, ctx) -> {
        blocking.countDown();
        WorkerRuntimeTest.await(release);
      }).compute(true).budget(Duration.ofSeconds(60))).send("go");
      WorkerRuntimeTest.await(blocking);
      Owner plugin = one.owner("cot");
      // A short budget: the stop waits that long for the worker thread before it interrupts its wait for the pool.
      WorkerHandle<String> second = plugin.spawn(WorkerOptions.<String>of("second", () -> (text, ctx) -> seen.add("second ran"))
          .compute(true).budget(Duration.ofMillis(300)));
      AtomicInteger drops = new AtomicInteger();
      assertThat(one.deliverAlways(second, () -> {
        seen.add("made");
        return "item";
      }, drops::incrementAndGet)).isTrue();
      waitUntil(() -> one.stats().stream().anyMatch(w -> w.worker().id().equals("cot/second") && w.queued() == 0)); // taken; waits for the pool

      plugin.stop(); // interrupts the wait: the call is cancelled before it starts
      waitUntil(() -> drops.get() > 0); // run by the worker's own thread, after the stop returned
      release.countDown();
      Thread.sleep(100);

      assertThat(drops.get()).as("its drop hook ran once").isEqualTo(1);
      assertThat(seen.drain()).doesNotContain("made", "second ran");
    } finally {
      one.close();
    }
  }

  @Test
  void aHungComputeCallIsInterruptedOnItsPoolThreadWhenTheWorkerRestarts() {
    AtomicInteger instances = new AtomicInteger();
    runtime.owner("core").spawn(WorkerOptions.<String>of("compute", () -> {
      int instance = instances.incrementAndGet();
      return (text, ctx) -> {
        seen.add("instance " + instance + " got " + text);
        try {
          if (!release.await(Probe.HOLD.toMillis(), TimeUnit.MILLISECONDS)) {
            seen.add("never released");
          }
        } catch (InterruptedException e) {
          seen.add("instance " + instance + " interrupted on " + where());
        }
      };
    }).compute(true).budget(BUDGET).restartable(true)).send("block");
    assertThat(seen.next()).isEqualTo("instance 1 got block");

    time.advance(BUDGET.plusMillis(100));

    assertThat(seen.next()).isEqualTo("instance 1 interrupted on platform ecore-compute-n");
    assertThat(listener.events.next()).isEqualTo("hung core/compute restarting=true");
  }

  @Test
  void stoppingTheWorkerInterruptsACallThatDoesNotFinishWithinTheBudget() {
    WorkerHandle<String> worker = runtime.owner("core").spawn(WorkerOptions.<String>of("compute", () -> (text, ctx) -> {
      seen.add("blocks");
      try {
        release.await(Probe.HOLD.toMillis(), TimeUnit.MILLISECONDS);
      } catch (InterruptedException e) {
        seen.add("interrupted");
      }
    }).compute(true).budget(Duration.ofMillis(200)));
    worker.send("go");
    assertThat(seen.next()).isEqualTo("blocks");

    runtime.owner("core").stop();

    assertThat(seen.next()).isEqualTo("interrupted");
  }

  @Test
  void aCallStillWaitingForAPoolThreadWhenTheWorkerStopsNeverRuns() {
    WorkerRuntime one = WorkerRuntime.start(RuntimeConfig.defaults().time(time).listener(listener).computeThreads(1));
    try {
      CountDownLatch blocking = new CountDownLatch(1);
      one.owner("core").spawn(WorkerOptions.<String>of("first", () -> (text, ctx) -> {
        blocking.countDown();
        WorkerRuntimeTest.await(release);
      }).compute(true).budget(Duration.ofSeconds(60))).send("go");
      WorkerRuntimeTest.await(blocking);
      WorkerHandle<String> second = one.owner("other").spawn(WorkerOptions.<String>of("second",
          () -> (text, ctx) -> seen.add("second ran")).compute(true).budget(Duration.ofMillis(200)));
      second.send("go");
      awaitTaken(one, "other/second"); // its call now waits for the only pool thread

      one.owner("other").stop(); // waits the budget, then interrupts the waiting worker thread
      release.countDown();
      // The pool runs its calls in order: had the second call stayed queued, it would run before this one.
      one.owner("core").spawn(WorkerOptions.<String>of("after", () -> (text, ctx) -> seen.add("after ran"))
          .compute(true)).send("go");

      assertThat(seen.next()).isEqualTo("after ran");
      assertThat(seen.drain()).isEmpty();
    } finally {
      one.close();
    }
  }

  /** Until the worker has taken its message from the mailbox (bounded by {@link Probe#WAIT}). */
  private static void awaitTaken(WorkerRuntime runtime, String worker) {
    long end = System.nanoTime() + Probe.WAIT.toNanos();
    while (runtime.stats().stream().noneMatch(s -> s.worker().id().equals(worker) && s.queued() == 0)) {
      assertThat(System.nanoTime()).as("worker " + worker + " takes its message").isLessThan(end);
      java.util.concurrent.locks.LockSupport.parkNanos(1_000_000);
    }
  }
}
