package dev.emcc.ecore.runtime;

import static dev.emcc.ecore.runtime.WorkerRuntimeTest.await;
import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** {@link WorkerRuntime#idle()}, which tests on the manual clock wait for before moving time. */
class IdleTest {

  private final ManualTime time = new ManualTime();
  private final RecordingListener listener = new RecordingListener();
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time).listener(listener));
  private final Owner core = runtime.owner("core");
  private final CountDownLatch release = new CountDownLatch(1);
  private final Probe<String> seen = new Probe<>();

  @AfterEach
  void close() {
    release.countDown();
    runtime.close();
  }

  /** Reports each message inside its call; "block" then waits for the release. */
  private WorkerHandle<String> worker(String name, boolean restartable) {
    return core.spawn(WorkerOptions.<String>of(name, () -> (text, ctx) -> {
      seen.add(name + " " + text);
      if (text.equals("block")) {
        await(release);
      }
    }).budget(Duration.ofSeconds(1)).restartable(restartable));
  }

  @Test
  void aRuntimeWithIdleWorkersIsIdle() {
    assertThat(runtime.idle()).as("no workers").isTrue();
    WorkerHandle<String> worker = worker("w", true);
    worker.send("hello");
    assertThat(seen.next()).isEqualTo("w hello");

    ManualTime.awaitIdle(runtime);

    assertThat(runtime.idle()).isTrue();
  }

  @Test
  void aRunningCallOrAQueuedMessageIsNotIdle() {
    WorkerHandle<String> worker = worker("w", true);
    worker.send("block");
    assertThat(seen.next()).isEqualTo("w block");
    assertThat(runtime.idle()).as("a call runs").isFalse();

    worker.send("queued");
    release.countDown();
    assertThat(seen.next()).isEqualTo("w queued");
    ManualTime.awaitIdle(runtime);
    assertThat(runtime.idle()).isTrue();
  }

  @Test
  void aCallAlreadyReportedHungCountsAsIdle() {
    WorkerHandle<String> worker = worker("stuck", false);
    worker.send("block");
    assertThat(seen.next()).isEqualTo("stuck block");

    time.advance(Duration.ofMillis(1_100)); // over its budget: reported hung, not restarted
    assertThat(listener.events.next()).isEqualTo("hung core/stuck restarting=false");

    assertThat(runtime.idle()).isTrue();
    worker.send("waits behind the stuck call");
    assertThat(runtime.idle()).as("still known stuck").isTrue();
  }

  @Test
  void afterARestartTheStuckOldCallNoLongerCounts() {
    WorkerHandle<String> worker = worker("restarted", true);
    worker.send("block");
    assertThat(seen.next()).isEqualTo("restarted block");

    time.advance(Duration.ofMillis(1_100)); // over its budget: restarted, the old thread stays stuck
    assertThat(listener.events.next(2)).containsExactly("hung core/restarted restarting=true", "restarted core/restarted #1");

    ManualTime.awaitIdle(runtime);
    worker.send("fresh");
    assertThat(seen.next()).isEqualTo("restarted fresh");
    ManualTime.awaitIdle(runtime);
    assertThat(runtime.idle()).isTrue();
  }

  @Test
  void aSettledAdvanceMovesTimeOnlyBetweenCalls() {
    // A tick every 100 ms to a worker whose calls take real time: a plain advance of 10 s could
    // jump past the budget while a call still runs. Settled, no call ever looks hung.
    WorkerHandle<String> worker = core.spawn(WorkerOptions.<String>of("busy", () -> (text, ctx) -> {
      long until = System.nanoTime() + 2_000_000; // 2 ms of real work per tick
      while (System.nanoTime() < until) {
        Thread.onSpinWait();
      }
    }).budget(Duration.ofSeconds(1)));
    core.every(Duration.ofMillis(100), worker, "tick");

    time.advanceSettled(Duration.ofSeconds(10), runtime);

    assertThat(listener.events.drain()).isEmpty();
    ManualTime.awaitIdle(runtime);
    assertThat(runtime.stats().getFirst().processed()).isEqualTo(100);
    assertThat(runtime.stats().getFirst().hung()).isZero();
  }
}
