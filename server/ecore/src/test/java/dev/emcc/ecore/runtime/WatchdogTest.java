package dev.emcc.ecore.runtime;

import static dev.emcc.ecore.runtime.WorkerRuntimeTest.await;
import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class WatchdogTest {

  private static final Duration BUDGET = Duration.ofSeconds(1);
  private static final Duration OVER_BUDGET = BUDGET.plusMillis(100);

  private final ManualTime time = new ManualTime();
  private final RecordingListener listener = new RecordingListener();
  private WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time).listener(listener));
  private final Probe<String> seen = new Probe<>();
  private final CountDownLatch release = new CountDownLatch(1);

  @AfterEach
  void close() {
    release.countDown();
    runtime.close();
  }

  /**
   * A handler factory whose handlers number themselves. "block" waits for {@link #release}; when
   * interrupted (fenced by a restart), the handler tries to send once more and reports the outcome.
   */
  private MessageHandler<String> numberedHandler(AtomicInteger instances) {
    int instance = instances.incrementAndGet();
    return (text, ctx) -> {
      if (!text.equals("block")) {
        seen.add("instance " + instance + " got " + text);
        return;
      }
      seen.add("instance " + instance + " blocks");
      try {
        if (!release.await(Probe.HOLD.toMillis(), TimeUnit.MILLISECONDS)) {
          seen.add("instance " + instance + " was never released");
        }
      } catch (InterruptedException e) {
        seen.add("instance " + instance + " interrupted; its send was " + ctx.self().send("from the fenced thread"));
      }
    };
  }

  @Test
  void aCallOverBudgetIsReportedAndTheWorkerRecoversWhenItReturns() {
    WorkerHandle<String> worker = runtime.owner("core").spawn(WorkerOptions.<String>of("w", () -> (text, ctx) -> {
      seen.add(text);
      if (text.equals("block")) {
        await(release);
      }
    }).budget(BUDGET));
    worker.send("block");
    assertThat(seen.next()).isEqualTo("block");

    time.advance(BUDGET); // exactly at the budget: not hung yet
    assertThat(statsOf(worker).state()).isEqualTo(WorkerState.RUNNING);
    time.advance(Duration.ofMillis(100));

    assertThat(listener.events.next()).isEqualTo("hung core/w restarting=false");
    assertThat(statsOf(worker).state()).isEqualTo(WorkerState.HUNG);
    assertThat(statsOf(worker).hung()).isEqualTo(1);

    release.countDown();
    assertThat(listener.events.next()).isEqualTo("recovered core/w");
    worker.send("after");
    assertThat(seen.next()).isEqualTo("after");
    assertThat(statsOf(worker).state()).isEqualTo(WorkerState.RUNNING);
  }

  @Test
  void aRestartableWorkerGetsAFreshHandlerAndTheStuckThreadIsFenced() {
    AtomicInteger instances = new AtomicInteger();
    WorkerHandle<String> worker = runtime.owner("core").spawn(
        WorkerOptions.<String>of("w", () -> numberedHandler(instances)).budget(BUDGET).restartable(true));
    worker.send("block");
    assertThat(seen.next()).isEqualTo("instance 1 blocks");

    time.advance(OVER_BUDGET);

    assertThat(listener.events.next(2)).containsExactly("hung core/w restarting=true", "restarted core/w #1");
    // The stuck thread was interrupted; anything it sends now is dropped.
    assertThat(seen.next()).isEqualTo("instance 1 interrupted; its send was DROPPED");
    // The fresh handler works, and the message that hung is not delivered again.
    worker.send("ping");
    assertThat(seen.next()).isEqualTo("instance 2 got ping");
    WorkerStats stats = statsOf(worker);
    assertThat(stats.state()).isEqualTo(WorkerState.RUNNING);
    assertThat(stats.restarts()).isEqualTo(1);
    assertThat(instances).hasValue(2);
  }

  @Test
  void aFencedThreadCanNeitherPublishNorSetTimers() {
    Topic<String> topic = Topic.of("core.news", String.class);
    Owner core = runtime.owner("core");
    WorkerHandle<String> listenerWorker = core.spawn(WorkerOptions.<String>of("listener", () -> (text, ctx) -> seen.add("listener got " + text)));
    core.subscribe(topic, listenerWorker, text -> text);
    WorkerHandle<String> worker = core.spawn(WorkerOptions.<String>of("w", () -> (text, ctx) -> {
      if (!text.equals("block")) {
        return;
      }
      seen.add("blocks");
      try {
        release.await(Probe.HOLD.toMillis(), TimeUnit.MILLISECONDS);
      } catch (InterruptedException e) {
        int published = runtime.publish(topic, "from the fenced thread");
        core.once(Duration.ofSeconds(1), listenerWorker, "timer from the fenced thread");
        seen.add("fenced; published to " + published);
      }
    }).budget(BUDGET).restartable(true));
    worker.send("block");
    assertThat(seen.next()).isEqualTo("blocks");

    time.advance(OVER_BUDGET);
    assertThat(seen.next()).isEqualTo("fenced; published to 0");
    time.advanceSettled(Duration.ofSeconds(2), runtime); // the timer would have fired by now

    runtime.publish(topic, "normal news");
    assertThat(seen.next()).isEqualTo("listener got normal news"); // nothing from the fenced thread before it
  }

  @Test
  void afterTheRestartLimitAHungWorkerIsNotRestartedAgain() {
    runtime.close();
    runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time).listener(listener).restarts(1, Duration.ofMinutes(1)));
    AtomicInteger instances = new AtomicInteger();
    WorkerHandle<String> worker = runtime.owner("core").spawn(
        WorkerOptions.<String>of("w", () -> numberedHandler(instances)).budget(BUDGET).restartable(true));

    worker.send("block");
    assertThat(seen.next()).isEqualTo("instance 1 blocks");
    time.advance(OVER_BUDGET);
    assertThat(listener.events.next(2)).containsExactly("hung core/w restarting=true", "restarted core/w #1");
    assertThat(seen.next()).startsWith("instance 1 interrupted");

    worker.send("block");
    assertThat(seen.next()).isEqualTo("instance 2 blocks");
    time.advance(OVER_BUDGET);

    assertThat(listener.events.next()).isEqualTo("hung core/w restarting=false");
    assertThat(statsOf(worker).state()).isEqualTo(WorkerState.HUNG);
    assertThat(instances).hasValue(2);
  }

  @Test
  void theRestartWindowForgetsOldRestarts() {
    runtime.close();
    runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time).listener(listener).restarts(1, Duration.ofSeconds(10)));
    AtomicInteger instances = new AtomicInteger();
    WorkerHandle<String> worker = runtime.owner("core").spawn(
        WorkerOptions.<String>of("w", () -> numberedHandler(instances)).budget(BUDGET).restartable(true));

    worker.send("block");
    seen.next();
    time.advance(OVER_BUDGET);
    assertThat(listener.events.next(2)).containsExactly("hung core/w restarting=true", "restarted core/w #1");
    seen.next();

    time.advanceSettled(Duration.ofSeconds(11), runtime); // the first restart leaves the window
    worker.send("block");
    assertThat(seen.next()).isEqualTo("instance 2 blocks");
    time.advance(OVER_BUDGET);

    assertThat(listener.events.next(2)).containsExactly("hung core/w restarting=true", "restarted core/w #2");
  }

  @Test
  void aRestartWhoseFactoryThrowsClosesTheWorker() {
    AtomicInteger instances = new AtomicInteger();
    WorkerHandle<String> worker = runtime.owner("core").spawn(WorkerOptions.<String>of("w", () -> {
      if (instances.get() >= 1) {
        throw new IllegalStateException("cannot create a second handler");
      }
      return numberedHandler(instances);
    }).budget(BUDGET).restartable(true));
    worker.send("block");
    seen.next();

    time.advance(OVER_BUDGET);

    assertThat(listener.events.next(2))
        .containsExactly("hung core/w restarting=true", "worker failed core/w: cannot create a second handler");
    assertThat(statsOf(worker).state()).isEqualTo(WorkerState.FAILED);
    assertThat(worker.send("anything")).isEqualTo(SendOutcome.CLOSED);
  }

  @Test
  void theFactoryOfARestartRunsOnTheNewWorkerThreadNotOnTheWatchdog() {
    AtomicInteger instances = new AtomicInteger();
    WorkerHandle<String> worker = runtime.owner("core").spawn(WorkerOptions.<String>of("w", () -> {
      seen.add("factory on " + Thread.currentThread().getName());
      return numberedHandler(instances);
    }).budget(BUDGET).restartable(true));
    assertThat(seen.next()).isEqualTo("factory on " + Thread.currentThread().getName()); // the first one: at spawn
    worker.send("block");
    assertThat(seen.next()).isEqualTo("instance 1 blocks");

    time.advance(OVER_BUDGET);

    assertThat(seen.next(2)).contains("factory on ecore-worker-core/w#1");
    worker.send("ping");
    assertThat(seen.next()).isEqualTo("instance 2 got ping");
  }

  private WorkerStats statsOf(WorkerHandle<?> worker) {
    return runtime.stats().stream().filter(s -> s.worker().id().equals(worker.id())).findFirst().orElseThrow();
  }
}
