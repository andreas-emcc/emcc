package dev.emcc.ecore.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class WorkerRuntimeTest {

  private final ManualTime time = new ManualTime();
  private final RecordingListener listener = new RecordingListener();
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time).listener(listener));
  private final Owner core = runtime.owner("core");

  @AfterEach
  void close() {
    runtime.close();
  }

  @Test
  void stopWorkerStopsOneWorkerAndFreesItsName() {
    Probe<String> seen = new Probe<>();
    WorkerHandle<String> first = core.spawn(WorkerOptions.<String>of("session", () -> (text, ctx) -> seen.add("first " + text)));
    WorkerHandle<String> other = core.spawn(WorkerOptions.<String>of("other", () -> (text, ctx) -> seen.add("other " + text)));
    WorkerHandle<String> elsewhere = runtime.owner("plugin-a").spawn(WorkerOptions.<String>of("session", () -> (text, ctx) -> {}));

    core.stopWorker(first);
    core.stopWorker(elsewhere); // not this owner's: no effect

    assertThat(first.send("late")).isEqualTo(SendOutcome.CLOSED);
    assertThat(elsewhere.send("still there")).isEqualTo(SendOutcome.ACCEPTED);
    other.send("still running");
    assertThat(seen.next()).isEqualTo("other still running");
    WorkerHandle<String> again = core.spawn(WorkerOptions.<String>of("session", () -> (text, ctx) -> seen.add("again " + text)));
    again.send("hello");
    assertThat(seen.next()).isEqualTo("again hello");
  }

  @Test
  void aWorkersThreadHasTheConfiguredContextClassLoaderFromItsStart() {
    ClassLoader pluginLoader = new java.net.URLClassLoader("plugin-x", new java.net.URL[0], getClass().getClassLoader());
    Probe<String> seen = new Probe<>();
    WorkerHandle<String> worker = core.spawn(WorkerOptions.<String>of("w",
            () -> (text, ctx) -> seen.add(Thread.currentThread().getContextClassLoader().getName()))
        .contextClassLoader(pluginLoader));
    WorkerHandle<String> plain = core.spawn(WorkerOptions.<String>of("plain",
        () -> (text, ctx) -> seen.add(String.valueOf(Thread.currentThread().getContextClassLoader() == pluginLoader))));

    worker.send("which loader?");
    plain.send("which loader?");

    assertThat(seen.next(2)).containsExactlyInAnyOrder("plugin-x", "false");
  }

  @Test
  void handlesMessagesOneAtATimeInOrderOnOneVirtualThread() {
    Probe<Integer> seen = new Probe<>();
    Probe<Thread> threads = new Probe<>();
    WorkerHandle<Integer> worker = core.spawn(WorkerOptions.<Integer>of("counter", () -> (n, ctx) -> {
      threads.add(Thread.currentThread());
      seen.add(n);
    }));

    for (int i = 0; i < 100; i++) {
      assertThat(worker.send(i)).isEqualTo(SendOutcome.ACCEPTED);
    }

    assertThat(seen.next(100)).isSorted().hasSize(100);
    var used = threads.next(100);
    assertThat(used).allSatisfy(t -> assertThat(t.isVirtual()).isTrue());
    assertThat(used.stream().distinct()).hasSize(1);
  }

  @Test
  void aFailingHandlerCallIsReportedAndTheWorkerContinues() {
    Probe<String> seen = new Probe<>();
    WorkerHandle<String> worker = core.spawn(WorkerOptions.<String>of("fragile", () -> (text, ctx) -> {
      if (text.equals("boom")) {
        throw new IllegalStateException("boom");
      }
      seen.add(text);
    }));

    worker.send("boom");
    worker.send("after");

    assertThat(seen.next()).isEqualTo("after");
    assertThat(listener.events.next()).isEqualTo("failed core/fragile: boom");
    ManualTime.awaitIdle(runtime); // "after" is seen inside its call; the counters follow when it ends
    assertThat(statsOf(worker).failures()).isEqualTo(1);
    assertThat(statsOf(worker).processed()).isEqualTo(2);
  }

  @Test
  void anErrorInAHandlerIsReportedLikeAnExceptionAndTheWorkerContinues() {
    Probe<String> seen = new Probe<>();
    WorkerHandle<String> worker = core.spawn(WorkerOptions.<String>of("errors", () -> (text, ctx) -> {
      switch (text) {
        case "linkage" -> throw new NoClassDefFoundError("some/missing/Class");
        case "memory" -> throw new OutOfMemoryError("simulated");
        default -> seen.add(text);
      }
    }).budget(Duration.ofSeconds(1)));

    worker.send("linkage");
    worker.send("memory");
    worker.send("after");

    assertThat(seen.next()).isEqualTo("after");
    assertThat(listener.events.next(2))
        .containsExactly("failed core/errors: some/missing/Class", "failed core/errors: simulated");
    time.advanceSettled(Duration.ofSeconds(5), runtime); // settled: moves only once the calls have ended; a dead worker thread would never be idle
    WorkerStats stats = statsOf(worker);
    assertThat(stats.state()).isEqualTo(WorkerState.RUNNING);
    assertThat(stats.hung()).isZero();
    assertThat(stats.failures()).isEqualTo(2);
    assertThat(stats.processed()).isEqualTo(3);
    worker.send("still alive");
    assertThat(seen.next()).isEqualTo("still alive");
  }

  @Test
  void sendingToAStoppedWorkerReturnsClosed() {
    WorkerHandle<String> worker = core.spawn(WorkerOptions.<String>of("w", () -> (text, ctx) -> {}));
    core.stop();

    assertThat(worker.send("late")).isEqualTo(SendOutcome.CLOSED);
    assertThat(statsOf(worker).state()).isEqualTo(WorkerState.STOPPED);
  }

  @Test
  void stopLetsTheRunningCallFinishAndDiscardsTheQueue() throws InterruptedException {
    CountDownLatch release = new CountDownLatch(1);
    Probe<String> seen = new Probe<>();
    WorkerHandle<String> worker = core.spawn(WorkerOptions.<String>of("slow", () -> (text, ctx) -> {
      seen.add("started " + text);
      await(release);
      seen.add("finished " + text);
    }));
    worker.send("first");
    assertThat(seen.next()).isEqualTo("started first");
    worker.send("queued 1");
    runtime.deliver(worker, () -> "queued 2", null, () -> seen.add("discarded queued 2"));

    // stop() discards the queue (running drop hooks) before it waits for the running call, so
    // the worker is released only once nothing is left for it to take.
    Thread stopper = Thread.ofVirtual().start(core::stop);
    assertThat(seen.next()).isEqualTo("discarded queued 2");
    release.countDown();
    assertThat(stopper.join(Probe.WAIT)).isTrue(); // the worker thread has ended

    assertThat(seen.next()).isEqualTo("finished first");
    assertThat(seen.drain()).isEmpty(); // neither queued message was handled
    assertThat(statsOf(worker).evicted()).isEqualTo(2);
  }

  @Test
  void workerNamesAreUniqueWithinAnOwner() {
    core.spawn(WorkerOptions.<String>of("same", () -> (text, ctx) -> {}));

    assertThatThrownBy(() -> core.spawn(WorkerOptions.<String>of("same", () -> (text, ctx) -> {})))
        .isInstanceOf(IllegalArgumentException.class);
    runtime.owner("other-plugin").spawn(WorkerOptions.<String>of("same", () -> (text, ctx) -> {}));
  }

  @Test
  void spawnFailsWhenTheHandlerFactoryThrows() {
    assertThatThrownBy(() -> core.spawn(WorkerOptions.<String>of("broken", () -> {
          throw new IllegalStateException("no handler");
        })))
        .hasMessage("no handler");

    // The name is free again, and the owner still works.
    core.spawn(WorkerOptions.<String>of("broken", () -> (text, ctx) -> {}));
  }

  @Test
  void aWorkerNeverBlocksOnASendEvenToABlockSenderMailbox() {
    CountDownLatch release = new CountDownLatch(1);
    Probe<String> started = new Probe<>();
    WorkerHandle<String> busy = core.spawn(WorkerOptions.<String>of("busy", () -> (text, ctx) -> {
      started.add(text);
      await(release);
    }).mailbox(1, Overflow.BLOCK_SENDER).sendTimeout(Duration.ofSeconds(60)));
    busy.send("occupy the handler");
    assertThat(started.next()).isEqualTo("occupy the handler");
    busy.send("fill the mailbox");

    Probe<SendOutcome> outcome = new Probe<>();
    WorkerHandle<String> sender = core.spawn(WorkerOptions.<String>of("sender", () -> (text, ctx) -> outcome.add(busy.send(text))));
    sender.send("one more");

    // Would otherwise wait up to 60 s (rule C5): a worker gets DROPPED at once instead.
    assertThat(outcome.next()).isEqualTo(SendOutcome.DROPPED);
    release.countDown();
  }

  @Test
  void statsCountAcceptedAndDroppedMessages() {
    CountDownLatch release = new CountDownLatch(1);
    Probe<String> started = new Probe<>();
    WorkerHandle<String> worker = core.spawn(WorkerOptions.<String>of("small", () -> (text, ctx) -> {
      started.add(text);
      await(release);
    }).mailbox(2, Overflow.DROP_NEWEST));
    worker.send("running");
    started.next();

    worker.send("q1");
    worker.send("q2");
    assertThat(worker.send("q3")).isEqualTo(SendOutcome.DROPPED);

    WorkerStats stats = statsOf(worker);
    assertThat(stats.accepted()).isEqualTo(3);
    assertThat(stats.dropped()).isEqualTo(1);
    assertThat(stats.queued()).isEqualTo(2);
    assertThat(stats.capacity()).isEqualTo(2);
    release.countDown();
  }

  @Test
  void closingTheRuntimeStopsEveryOwner() {
    WorkerHandle<String> coreWorker = core.spawn(WorkerOptions.<String>of("a", () -> (text, ctx) -> {}));
    WorkerHandle<String> pluginWorker = runtime.owner("basemap-osm").spawn(WorkerOptions.<String>of("b", () -> (text, ctx) -> {}));

    runtime.close();

    assertThat(coreWorker.send("x")).isEqualTo(SendOutcome.CLOSED);
    assertThat(pluginWorker.send("x")).isEqualTo(SendOutcome.CLOSED);
    assertThatThrownBy(() -> runtime.owner("core")).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void optionsAndOwnerIdsAreValidated() {
    assertThatThrownBy(() -> WorkerOptions.<String>of("Bad Name", () -> (t, c) -> {})).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> WorkerOptions.<String>of("w", () -> (t, c) -> {}).mailbox(0, Overflow.DROP_NEWEST))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> WorkerOptions.<String>of("w", () -> (t, c) -> {}).budget(Duration.ofMillis(1)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> WorkerOptions.<String>of("w", () -> (t, c) -> {}).budget(Duration.ofMinutes(2)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> runtime.owner("Not_an_id")).isInstanceOf(IllegalArgumentException.class);
  }

  private WorkerStats statsOf(WorkerHandle<?> worker) {
    return runtime.stats().stream().filter(s -> s.worker().id().equals(worker.id())).findFirst().orElseThrow();
  }

  static void await(CountDownLatch latch) {
    try {
      if (!latch.await(Probe.HOLD.toMillis(), TimeUnit.MILLISECONDS)) {
        throw new IllegalStateException("latch not released within " + Probe.HOLD);
      }
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("interrupted", e);
    }
  }
}
