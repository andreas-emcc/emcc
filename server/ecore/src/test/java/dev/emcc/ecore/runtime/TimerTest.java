package dev.emcc.ecore.runtime;

import static dev.emcc.ecore.runtime.WorkerRuntimeTest.await;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class TimerTest {

  private static final Duration PERIOD = Duration.ofMillis(100);

  private final ManualTime time = new ManualTime();
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time));
  private final Owner core = runtime.owner("core");
  private final Probe<String> seen = new Probe<>();

  @AfterEach
  void close() {
    runtime.close();
  }

  private WorkerHandle<String> recorder() {
    return core.spawn(WorkerOptions.<String>of("recorder", () -> (text, ctx) -> seen.add(text)));
  }

  @Test
  void onceSendsTheMessageAfterTheDelay() {
    WorkerHandle<String> worker = recorder();
    core.once(Duration.ofSeconds(1), worker, "tick");

    time.advanceSettled(Duration.ofMillis(999), runtime);
    assertThat(statsOf(worker).accepted()).isZero();

    time.advanceSettled(Duration.ofMillis(1), runtime);
    assertThat(seen.next()).isEqualTo("tick");
  }

  @Test
  void everySendsRepeatedly() {
    WorkerHandle<String> worker = recorder();
    core.every(PERIOD, worker, "tick");

    for (int i = 0; i < 3; i++) {
      time.advanceSettled(PERIOD, runtime);
      assertThat(seen.next()).isEqualTo("tick");
    }
  }

  @Test
  void theCoalescingKeyOfATimerMessageIsTakenOnceOnTheCallersThread() {
    Probe<String> keyCalls = new Probe<>();
    WorkerHandle<String> worker = core.spawn(WorkerOptions.<String>of("keyed", () -> (text, ctx) -> seen.add(text))
        .mailbox(10, Overflow.COALESCE_BY_KEY)
        .coalesceKey(message -> {
          keyCalls.add(Thread.currentThread().getName()); // plugin code (Coalescing) in a plugin worker
          return message;
        }));
    Cancellable ticks = core.every(PERIOD, worker, "tick");
    core.once(PERIOD.multipliedBy(10), worker, "once");

    for (int i = 0; i < 3; i++) {
      time.advanceSettled(PERIOD, runtime);
      assertThat(seen.next()).isEqualTo("tick");
    }
    ticks.cancel();
    time.advanceSettled(PERIOD.multipliedBy(10), runtime);
    assertThat(seen.next()).isEqualTo("once");

    String caller = Thread.currentThread().getName();
    assertThat(keyCalls.drain()).containsExactly(caller, caller);
  }

  @Test
  void aTimerWhoseMessageKeyCannotBeTakenStillDeliversUncoalescedAndKeepsItsSlotRight() {
    WorkerHandle<String> worker = core.spawn(WorkerOptions.<String>of("keyed", () -> (text, ctx) -> seen.add(text))
        .mailbox(10, Overflow.COALESCE_BY_KEY)
        .coalesceKey(message -> {
          throw new IllegalStateException("no key for " + message); // plugin code that fails, on the caller's thread
        }));

    core.once(PERIOD, worker, "once"); // the failure is logged; the message is not coalesced
    Cancellable ticks = core.every(PERIOD, worker, "tick");
    assertThat(core.activeTimers()).isEqualTo(2);

    time.advanceSettled(PERIOD, runtime);
    assertThat(seen.next(2)).containsExactlyInAnyOrder("once", "tick");
    assertThat(core.activeTimers()).as("the once timer has ended").isEqualTo(1);
    ticks.cancel();
    assertThat(core.activeTimers()).isZero();
  }

  @Test
  void aPeriodicTimerSkipsTicksWhileThePreviousTickIsUndelivered() {
    CountDownLatch release = new CountDownLatch(1);
    AtomicInteger calls = new AtomicInteger();
    WorkerHandle<String> slow = core.spawn(WorkerOptions.<String>of("slow", () -> (text, ctx) -> {
      seen.add(text + " " + calls.incrementAndGet());
      if (calls.get() == 1) {
        await(release);
      }
    }));
    core.every(PERIOD, slow, "tick");

    time.advance(PERIOD);
    assertThat(seen.next()).isEqualTo("tick 1"); // taken; the handler now hangs on it
    time.advance(PERIOD.multipliedBy(4)); // four more periods: one tick queued, three skipped
    release.countDown();

    assertThat(seen.next()).isEqualTo("tick 2");
    assertThat(statsOf(slow).accepted()).isEqualTo(2);
  }

  @Test
  void aCancelledTimerSendsNothing() {
    WorkerHandle<String> worker = recorder();
    Cancellable timer = core.every(PERIOD, worker, "tick");

    timer.cancel();
    timer.cancel(); // idempotent
    time.advanceSettled(PERIOD.multipliedBy(5), runtime);

    assertThat(statsOf(worker).accepted()).isZero();
  }

  @Test
  void stoppingAnOwnerCancelsItsTimers() {
    WorkerHandle<String> worker = recorder();
    Owner plugin = runtime.owner("some-plugin");
    plugin.every(PERIOD, worker, "from the plugin");
    plugin.once(PERIOD, worker, "also from the plugin");

    plugin.stop();
    time.advanceSettled(PERIOD.multipliedBy(5), runtime);

    assertThat(statsOf(worker).accepted()).isZero();
    assertThatThrownBy(() -> plugin.once(PERIOD, worker, "after stop")).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void aTimerToAStoppedWorkerEndsItself() {
    WorkerHandle<String> worker = runtime.owner("short-lived").spawn(WorkerOptions.<String>of("w", () -> (t, c) -> {}));
    core.every(PERIOD, worker, "tick");
    runtime.owner("short-lived").stop();

    time.advanceSettled(PERIOD.multipliedBy(3), runtime); // the first tick finds the worker stopped and cancels the timer

    assertThat(statsOf(worker).accepted()).isZero();
  }

  @Test
  void periodsShorterThanTenMillisecondsAreRefused() {
    WorkerHandle<String> worker = recorder();

    assertThatThrownBy(() -> core.every(Duration.ofMillis(9), worker, "tick")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> core.once(Duration.ZERO, worker, "tick")).isInstanceOf(IllegalArgumentException.class);
  }

  private WorkerStats statsOf(WorkerHandle<?> worker) {
    return runtime.stats().stream().filter(s -> s.worker().id().equals(worker.id())).findFirst().orElseThrow();
  }
}
