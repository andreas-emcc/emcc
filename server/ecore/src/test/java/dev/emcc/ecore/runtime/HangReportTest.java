package dev.emcc.ecore.runtime;

import static dev.emcc.ecore.runtime.WorkerRuntimeTest.await;
import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * A hang report names the message type and the JVM's garbage collection time during the call, so
 * that a hang can be traced (MCA, 2026-10-16).
 */
class HangReportTest {

  /** Messages of a test worker. */
  sealed interface Msg {
    record Block() implements Msg {}

    record Hello() implements Msg {}

    /** Asks the echo worker; the answer is made into a message by code that blocks until released. */
    record AskSlowly() implements Msg {}
  }

  private final ManualTime time = new ManualTime();
  private final RecordingListener listener = new RecordingListener();
  /** The JVM's GC time as the runtime sees it: moved by the test. */
  private final AtomicLong gcMillis = new AtomicLong(10_000);
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time).listener(listener).gcTime(gcMillis::get));
  private final CountDownLatch release = new CountDownLatch(1);
  private final Probe<String> seen = new Probe<>();

  @AfterEach
  void close() {
    release.countDown();
    runtime.close();
  }

  private WorkerHandle<Msg> worker(boolean restartable) {
    return runtime.owner("core").spawn(WorkerOptions.<Msg>of("w", () -> (message, ctx) -> {
      seen.add(message.getClass().getSimpleName());
      if (message instanceof Msg.Block) {
        await(release);
      }
    }).budget(Duration.ofSeconds(1)).restartable(restartable));
  }

  @Test
  void aHungCallIsReportedWithItsMessageTypeAndTheGcTimeDuringIt() {
    WorkerHandle<Msg> worker = worker(false);
    time.advanceSettled(Duration.ofMillis(300), runtime); // the watchdog has sampled the GC time a few times
    worker.send(new Msg.Hello());
    assertThat(seen.next()).isEqualTo("Hello");
    worker.send(new Msg.Block());
    assertThat(seen.next()).isEqualTo("Block");

    gcMillis.addAndGet(700); // the JVM paused for garbage collection during the call
    time.advance(Duration.ofMillis(1_100)); // over its budget

    assertThat(listener.calls.next()).isEqualTo("hung core/w: handling HangReportTest.Msg.Block; 700 ms of it JVM garbage collection");
    release.countDown();
    assertThat(listener.calls.next()).isEqualTo("recovered core/w: handling HangReportTest.Msg.Block; 700 ms of it JVM garbage collection");
  }

  @Test
  void aCallOlderThanTheGcSamplesHasAtLeastTheirGcTime() {
    WorkerHandle<Msg> worker = worker(true);
    worker.send(new Msg.Block()); // at time 0, before the first watchdog sample
    assertThat(seen.next()).isEqualTo("Block");
    time.advance(Duration.ofMillis(200));
    gcMillis.addAndGet(50);
    time.advance(Duration.ofMillis(900));

    assertThat(listener.calls.next()).isEqualTo("hung core/w: handling HangReportTest.Msg.Block; at least 50 ms of it JVM garbage collection");
  }

  @Test
  void aMessageStillBeingMadeOrAFreshHandlerBeingMadeIsSaidSo() {
    WorkerHandle<String> echo = runtime.owner("core").spawn(WorkerOptions.<String>of("echo", () -> (text, ctx) -> { }));
    WorkerHandle<ReplyHandle<String>> answering = runtime.owner("core").spawn(
        WorkerOptions.<ReplyHandle<String>>of("answering", () -> (reply, ctx) -> reply.reply("hi")));
    int[] factoryCalls = {0};
    CountDownLatch factory = new CountDownLatch(1);
    WorkerHandle<Msg> asking = runtime.owner("core").spawn(WorkerOptions.<Msg>of("asking", () -> {
      if (++factoryCalls[0] > 1) {
        seen.add("factory");
        await(factory); // the fresh handler after the restart takes its time
      }
      return (message, ctx) -> {
        seen.add(message.getClass().getSimpleName());
        if (message instanceof Msg.AskSlowly) {
          ctx.<ReplyHandle<String>, String>ask(answering, reply -> reply, Duration.ofSeconds(30), answer -> {
            seen.add("making");
            await(release); // the answer's mapper runs in this worker, under its watchdog
            return new Msg.Hello();
          });
        }
      };
    }).budget(Duration.ofSeconds(1)).restartable(true));
    echo.send("unused");
    time.advanceSettled(Duration.ofMillis(300), runtime);

    asking.send(new Msg.AskSlowly());
    assertThat(seen.next(2)).containsExactly("AskSlowly", "making");
    time.advance(Duration.ofMillis(1_100));
    assertThat(listener.calls.next()).isEqualTo("hung core/asking: handling (making the message); 0 ms of it JVM garbage collection");

    // Restarted: the fresh handler's factory hangs in turn.
    assertThat(seen.next()).isEqualTo("factory");
    time.advance(Duration.ofMillis(1_100));
    assertThat(listener.calls.next()).isEqualTo("hung core/asking: handling (making a fresh handler); 0 ms of it JVM garbage collection");
    factory.countDown();
  }

  @Test
  void aComputeWorkerAndAWorkerOverItsRestartLimitReportTheirCallsToo() {
    WorkerRuntime limited = WorkerRuntime.start(RuntimeConfig.defaults().time(time).listener(listener).gcTime(gcMillis::get)
        .restarts(0, Duration.ofMinutes(10)));
    try {
      WorkerHandle<Msg> compute = limited.owner("core").spawn(WorkerOptions.<Msg>of("compute", () -> (message, ctx) -> {
        seen.add("compute " + message.getClass().getSimpleName());
        await(release);
      }).budget(Duration.ofSeconds(1)).compute(true));
      time.advanceSettled(Duration.ofMillis(300), limited);
      compute.send(new Msg.Block());
      assertThat(seen.next()).isEqualTo("compute Block");
      gcMillis.addAndGet(20);
      time.advance(Duration.ofMillis(1_100));
      assertThat(listener.events.next()).isEqualTo("hung core/compute restarting=false"); // restartable, but no restarts left
      assertThat(listener.calls.next()).isEqualTo("hung core/compute: handling HangReportTest.Msg.Block; 20 ms of it JVM garbage collection");
    } finally {
      release.countDown();
      limited.close();
    }
  }

  @Test
  void aGcSourceThatFailsNeitherStopsTheWatchdogNorAReport() {
    WorkerRuntime failing = WorkerRuntime.start(RuntimeConfig.defaults().time(time).listener(listener).gcTime(() -> {
      throw new IllegalStateException("no GC time");
    }));
    try {
      WorkerHandle<Msg> worker = failing.owner("core").spawn(WorkerOptions.<Msg>of("w", () -> (message, ctx) -> {
        seen.add(message.getClass().getSimpleName());
        await(release);
      }).budget(Duration.ofSeconds(1)).restartable(true));
      worker.send(new Msg.Block());
      assertThat(seen.next()).isEqualTo("Block");
      time.advance(Duration.ofMillis(1_100));
      assertThat(listener.events.next(2)).containsExactly("hung core/w restarting=true", "restarted core/w #1"); // the restart still happens
      assertThat(listener.calls.next()).isEqualTo("hung core/w: handling HangReportTest.Msg.Block; JVM garbage collection time unknown");
    } finally {
      release.countDown();
      failing.close();
    }
  }

  @Test
  void theGcHistoryTakesTheLastSampleAtOrBeforeTheStartAndKeepsTheNewestOnes() {
    AtomicLong gc = new AtomicLong(100);
    GcHistory history = new GcHistory(gc::get);
    assertThat(history.since(0)).isEqualTo(new GcHistory.Since(0, false)); // nothing sampled yet

    history.sample(1_000);
    gc.set(130);
    history.sample(2_000);
    gc.set(170);
    assertThat(history.since(2_000)).isEqualTo(new GcHistory.Since(40, true));
    assertThat(history.since(1_500)).isEqualTo(new GcHistory.Since(70, true)); // from the sample at 1 000
    assertThat(history.since(500)).isEqualTo(new GcHistory.Since(70, false)); // older than every sample: at least

    for (int i = 0; i < GcHistory.SIZE; i++) {
      history.sample(10_000 + i); // the first two samples fall out
    }
    assertThat(history.since(1_500)).isEqualTo(new GcHistory.Since(0, false));
    gc.set(171);
    assertThat(history.since(10_000 + GcHistory.SIZE)).isEqualTo(new GcHistory.Since(1, true));
  }

  @Test
  void aMessageTypeIsNamedWithoutItsPackageNeverWithItsContent() {
    assertThat(HungCall.typeName(Msg.Hello.class)).isEqualTo("HangReportTest.Msg.Hello");
    assertThat(HungCall.typeName(String.class)).isEqualTo("String");
    assertThat(new HungCall("StoreMsg.GetArea", 4_870, true).text()).isEqualTo("handling StoreMsg.GetArea; 4870 ms of it JVM garbage collection");
    assertThat(new HungCall("StoreMsg.GetArea", HungCall.GC_UNKNOWN, false).text())
        .isEqualTo("handling StoreMsg.GetArea; JVM garbage collection time unknown");
  }
}
