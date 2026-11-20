package dev.emcc.ecore.runtime;

import static dev.emcc.ecore.runtime.WorkerRuntimeTest.await;
import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * The runtime's hooks for other parts of ECore: deliveries with a drop hook (endpoint requests get
 * 503 when refused or evicted), answers that always get through (outbound HTTP results), and the
 * scheduler.
 */
class RuntimeDeliveryTest {

  private final ManualTime time = new ManualTime();
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time));
  private final Owner plugin = runtime.owner("basemap-osm");
  private final Probe<String> seen = new Probe<>();
  private final CountDownLatch release = new CountDownLatch(1);

  @AfterEach
  void close() {
    release.countDown();
    runtime.close();
  }

  /** A worker whose first message ("hold") blocks until {@link #release}. */
  private WorkerHandle<String> worker(int capacity, Overflow overflow) {
    WorkerHandle<String> worker = plugin.spawn(WorkerOptions.<String>of("tiles", () -> (text, ctx) -> {
      seen.add(text);
      if (text.equals("hold")) {
        await(release);
      }
    }).mailbox(capacity, overflow).coalesceKey(RuntimeDeliveryTest::tileKey));
    worker.send("hold");
    assertThat(seen.next()).isEqualTo("hold");
    return worker;
  }

  private static @Nullable Object tileKey(Object o) {
    return o instanceof String s && s.startsWith("tile ") ? s : null;
  }

  @Test
  void theMessageIsMadeInTheTargetWorker() {
    Probe<Thread> madeOn = new Probe<>();
    WorkerHandle<String> worker = worker(10, Overflow.DROP_NEWEST);

    SendOutcome outcome = runtime.deliver(worker, () -> {
      madeOn.add(Thread.currentThread());
      return "request";
    }, null, () -> seen.add("dropped"));
    release.countDown();

    assertThat(outcome).isEqualTo(SendOutcome.ACCEPTED);
    assertThat(seen.next()).isEqualTo("request");
    assertThat(madeOn.next().getName()).startsWith("ecore-worker-basemap-osm/tiles");
  }

  @Test
  void anEvictedDeliveryRunsItsDropHook() {
    WorkerHandle<String> worker = worker(1, Overflow.DROP_OLDEST);
    runtime.deliver(worker, () -> "request", null, () -> seen.add("503 for the evicted request"));

    worker.send("newer message");

    assertThat(seen.next()).isEqualTo("503 for the evicted request");
  }

  @Test
  void aRefusedDeliveryIsToldByTheOutcomeNotByTheHook() {
    WorkerHandle<String> worker = worker(1, Overflow.DROP_NEWEST);
    worker.send("fills the mailbox");

    SendOutcome outcome = runtime.deliver(worker, () -> "request", null, () -> seen.add("hook"));

    assertThat(outcome).isEqualTo(SendOutcome.DROPPED);
    release.countDown();
    assertThat(seen.next()).isEqualTo("fills the mailbox");
    assertThat(seen.drain()).doesNotContain("hook");
  }

  @Test
  void aDeliveryNeverWaitsOnABlockSenderMailbox() {
    WorkerHandle<String> worker = worker(1, Overflow.BLOCK_SENDER);
    worker.send("fills the mailbox");

    assertThat(runtime.deliver(worker, () -> "request", null, () -> {})).isEqualTo(SendOutcome.DROPPED);
  }

  @Test
  void aDeliveryDiscardedAtStopRunsItsDropHook() {
    WorkerHandle<String> worker = worker(10, Overflow.DROP_NEWEST);
    runtime.deliver(worker, () -> "request", null, () -> seen.add("503 at stop"));

    // stop() closes the mailbox, running the drop hook, before it waits for the running call.
    // Releasing the worker only after the hook ran means it can never take the request.
    Thread stopper = Thread.ofVirtual().start(plugin::stop);
    assertThat(seen.next()).isEqualTo("503 at stop");
    release.countDown();

    assertThat(joined(stopper)).isTrue(); // the worker thread has ended
    assertThat(seen.drain()).doesNotContain("request");
  }

  @Test
  void theCoalescingKeyComesFromTheKeySource() {
    WorkerHandle<String> worker = worker(10, Overflow.COALESCE_BY_KEY);
    runtime.deliver(worker, () -> "first value", "tile 1/2/3", () -> seen.add("replaced"));

    runtime.deliver(worker, () -> "second value", "tile 1/2/3", () -> {});

    assertThat(seen.next()).isEqualTo("replaced");
    release.countDown();
    assertThat(seen.next()).isEqualTo("second value");
  }

  @Test
  void anAnswerAlwaysGetsThroughAFullMailbox() {
    WorkerHandle<String> worker = worker(1, Overflow.DROP_NEWEST);
    worker.send("fills the mailbox");

    assertThat(runtime.deliverAlways(worker, () -> "http result")).isTrue();
    release.countDown();

    assertThat(seen.next(2)).containsExactly("fills the mailbox", "http result");
  }

  @Test
  void anAlwaysDeliveredMessageDiscardedAtStopRunsItsDropHookAndARefusedOneDoesNot() {
    WorkerHandle<String> worker = worker(1, Overflow.DROP_NEWEST);
    worker.send("fills the mailbox");
    assertThat(runtime.deliverAlways(worker, () -> "channel item", () -> seen.add("dropped at stop"))).isTrue();

    Thread stopper = Thread.ofVirtual().start(plugin::stop);
    assertThat(seen.next()).isEqualTo("dropped at stop");
    release.countDown();

    assertThat(joined(stopper)).isTrue();
    assertThat(runtime.deliverAlways(worker, () -> "late item", () -> seen.add("dropped late"))).as("refused: told by the result").isFalse();
    assertThat(seen.drain()).doesNotContain("channel item", "dropped late");
  }

  @Test
  void anAnswerToAStoppedWorkerIsRefused() {
    WorkerHandle<String> worker = plugin.spawn(WorkerOptions.<String>of("gone", () -> (t, c) -> {}));
    plugin.stop();

    assertThat(runtime.deliverAlways(worker, () -> "http result")).isFalse();
    assertThat(runtime.deliver(worker, () -> "request", null, () -> {})).isEqualTo(SendOutcome.CLOSED);
  }

  @Test
  void scheduledTasksRunOnTheRuntimesScheduler() {
    AtomicInteger runs = new AtomicInteger();
    runtime.schedule(Duration.ofSeconds(10), runs::incrementAndGet);

    time.advanceSettled(Duration.ofSeconds(9), runtime);
    assertThat(runs).hasValue(0);
    time.advanceSettled(Duration.ofSeconds(1), runtime);
    assertThat(runs).hasValue(1);
  }

  private static boolean joined(Thread t) {
    try {
      return t.join(Probe.WAIT);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return false;
    }
  }
}
