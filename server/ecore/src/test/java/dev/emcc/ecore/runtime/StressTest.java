package dev.emcc.ecore.runtime;

import static dev.emcc.ecore.runtime.WorkerRuntimeTest.await;
import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.IntConsumer;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

/**
 * Concurrency stress tests (agents/cda.md: many senders, slow and hanging handlers, every policy).
 *
 * <p>No test waits by polling or sleeping. A test that must know "everything sent so far has been
 * handled" sends an <b>end marker</b> with {@link WorkerRuntime#deliverAlways}: it is queued
 * behind every message already accepted and is never dropped or coalesced, so when the worker
 * handles it, everything before it has been handled.
 */
class StressTest {

  record Numbered(int sender, int seq) {}

  record Version(String key, int version) {}

  @Test
  void manyConcurrentSendersLoseNothingSilentlyAndKeepTheirOrder() throws InterruptedException {
    int senders = 16;
    int perSender = 20_000;
    try (WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(new ManualTime()))) {
      AtomicLong processed = new AtomicLong();
      AtomicInteger outOfOrder = new AtomicInteger();
      CountDownLatch end = new CountDownLatch(1);
      WorkerHandle<Numbered> worker = runtime.owner("core").spawn(WorkerOptions.<Numbered>of("sink", () -> {
        int[] last = new int[senders];
        java.util.Arrays.fill(last, -1);
        return (msg, ctx) -> {
          if (msg.sender() < 0) {
            end.countDown();
            return;
          }
          if (msg.seq() <= last[msg.sender()]) {
            outOfOrder.incrementAndGet();
          }
          last[msg.sender()] = msg.seq();
          processed.incrementAndGet();
        };
      }).mailbox(1_000, Overflow.DROP_NEWEST));

      AtomicLong accepted = new AtomicLong();
      AtomicLong dropped = new AtomicLong();
      runConcurrently(senders, sender -> {
        for (int seq = 0; seq < perSender; seq++) {
          switch (worker.send(new Numbered(sender, seq))) {
            case ACCEPTED -> accepted.incrementAndGet();
            case DROPPED -> dropped.incrementAndGet();
            case CLOSED -> throw new AssertionError("closed");
          }
        }
      });
      endWith(runtime, worker, new Numbered(-1, -1), end);

      assertThat(processed.get()).isEqualTo(accepted.get());
      assertThat(accepted.get() + dropped.get()).isEqualTo((long) senders * perSender);
      assertThat(outOfOrder).hasValue(0);
      WorkerStats stats = runtime.stats().getFirst();
      assertThat(stats.accepted()).isEqualTo(accepted.get() + 1); // + the end marker
      assertThat(stats.dropped()).isEqualTo(dropped.get());
    }
  }

  @Test
  void coalescingUnderLoadAlwaysEndsWithTheLatestValuePerKey() throws InterruptedException {
    int senders = 8;
    int keysPerSender = 50;
    int versions = 500;
    try (WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(new ManualTime()))) {
      Map<String, Integer> latest = new ConcurrentHashMap<>();
      AtomicInteger wentBackwards = new AtomicInteger();
      CountDownLatch end = new CountDownLatch(1);
      WorkerHandle<Version> worker = runtime.owner("core").spawn(WorkerOptions.<Version>of("tracks", () -> (msg, ctx) -> {
        if (msg.version() < 0) {
          end.countDown();
          return;
        }
        Integer before = latest.put(msg.key(), msg.version());
        if (before != null && before >= msg.version()) {
          wentBackwards.incrementAndGet();
        }
      }).mailbox(senders * keysPerSender, Overflow.COALESCE_BY_KEY).coalesceKey(StressTest::versionKey));

      runConcurrently(senders, sender -> {
        for (int v = 0; v < versions; v++) {
          for (int k = 0; k < keysPerSender; k++) {
            worker.send(new Version(sender + "-" + k, v));
          }
        }
      });
      endWith(runtime, worker, new Version("end", -1), end);

      assertThat(latest).hasSize(senders * keysPerSender);
      assertThat(latest.values()).containsOnly(versions - 1);
      assertThat(wentBackwards).hasValue(0);
      assertThat(runtime.stats().getFirst().coalesced()).isPositive();
      assertThat(runtime.stats().getFirst().evicted()).isZero();
    }
  }

  private static @Nullable Object versionKey(Object message) {
    return message instanceof Version v ? v.key() : null;
  }

  enum Mode { REPLY, FAIL, IGNORE }

  sealed interface AskerMsg {
    record Go(int id, Mode mode) implements AskerMsg {}

    record Answered(int id, Answer<Integer> answer) implements AskerMsg {}

    record End() implements AskerMsg {}
  }

  record Request(int id, Mode mode, ReplyHandle<Integer> replyTo) {}

  @Test
  void answersRacingTimeoutsGiveExactlyOneAnswerPerAsk() throws InterruptedException {
    int askers = 4;
    int phase1 = 400; // answered while time stands still: Ok and Failed, never TimedOut
    int phase2 = 1_600; // answered while another thread moves time: Ok and TimedOut race
    int phase3 = 100; // never answered: TimedOut
    int total = phase1 + phase2 + phase3;
    ManualTime time = new ManualTime();
    try (WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time))) {
      Owner core = runtime.owner("core");
      CountDownLatch phase1Done = new CountDownLatch(phase1);
      CountDownLatch phase2Done = new CountDownLatch(phase2);
      CountDownLatch phase3Done = new CountDownLatch(phase3);
      WorkerHandle<Request> target = core.spawn(WorkerOptions.<Request>of("target", () -> (req, ctx) -> {
        switch (req.mode()) {
          case REPLY -> req.replyTo().reply(req.id());
          case FAIL -> req.replyTo().fail("asked to fail");
          case IGNORE -> {}
        }
        (req.id() < phase1 ? phase1Done : req.id() < phase1 + phase2 ? phase2Done : phase3Done).countDown();
      }).mailbox(total, Overflow.DROP_NEWEST));

      Map<Integer, AtomicInteger> answersPerAsk = new ConcurrentHashMap<>();
      Map<String, AtomicInteger> kinds = new ConcurrentHashMap<>();
      CountDownLatch ends = new CountDownLatch(askers);
      List<WorkerHandle<AskerMsg>> askerHandles = new ArrayList<>();
      for (int a = 0; a < askers; a++) {
        askerHandles.add(core.spawn(WorkerOptions.<AskerMsg>of("asker-" + a, () -> (msg, ctx) -> {
          switch (msg) {
            case AskerMsg.Go go -> ctx.<Request, Integer>ask(target, r -> new Request(go.id(), go.mode(), r),
                Duration.ofMillis(1 + go.id() % 3), answer -> new AskerMsg.Answered(go.id(), answer));
            case AskerMsg.Answered done -> {
              answersPerAsk.computeIfAbsent(done.id(), id -> new AtomicInteger()).incrementAndGet();
              kinds.computeIfAbsent(done.answer().getClass().getSimpleName(), k -> new AtomicInteger()).incrementAndGet();
            }
            case AskerMsg.End end -> ends.countDown();
          }
        }).mailbox(total, Overflow.DROP_NEWEST)));
      }
      IntConsumer go = id -> {
        Mode mode = id < phase1 ? (id % 4 == 0 ? Mode.FAIL : Mode.REPLY) : id < phase1 + phase2 ? Mode.REPLY : Mode.IGNORE;
        assertThat(askerHandles.get(id % askers).send(new AskerMsg.Go(id, mode))).isEqualTo(SendOutcome.ACCEPTED);
      };

      // Phase 1: time stands still, so every ask is answered by the target.
      for (int id = 0; id < phase1; id++) {
        go.accept(id);
      }
      await(phase1Done);

      // Phase 2: this thread moves time while the target answers: replies and timeouts race.
      for (int id = phase1; id < phase1 + phase2; id++) {
        go.accept(id);
      }
      long deadline = System.nanoTime() + Probe.WAIT.toNanos();
      while (phase2Done.getCount() > 0) {
        assertThat(System.nanoTime()).as("phase 2 finished in time").isLessThan(deadline);
        time.advance(Duration.ofMillis(1));
      }

      // Phase 3: the target ignores the asks; once it has seen them all, time runs out for them.
      for (int id = phase1 + phase2; id < total; id++) {
        go.accept(id);
      }
      await(phase3Done);
      time.advanceSettled(Duration.ofSeconds(1), runtime); // fires every remaining timeout, also stale ones

      // Every source of an answer has now run: the target answered or ignored every request, and
      // every timer has fired. The end markers are queued behind every answer that was delivered.
      for (WorkerHandle<AskerMsg> asker : askerHandles) {
        assertThat(runtime.deliverAlways(asker, AskerMsg.End::new)).isTrue();
      }
      await(ends);

      assertThat(answersPerAsk).hasSize(total);
      assertThat(answersPerAsk.values()).allSatisfy(count -> assertThat(count).hasValue(1));
      assertThat(kinds.keySet()).containsExactlyInAnyOrder("Ok", "Failed", "TimedOut");
    }
  }

  @Test
  void aHangingWorkerDoesNotHoldUpTheOthers() throws InterruptedException {
    ManualTime time = new ManualTime();
    RecordingListener listener = new RecordingListener();
    CountDownLatch release = new CountDownLatch(1);
    try (WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time).listener(listener))) {
      Owner plugin = runtime.owner("plugin-a");
      Probe<String> started = new Probe<>();
      WorkerHandle<String> hanging = plugin.spawn(WorkerOptions.<String>of("hanging", () -> (text, ctx) -> {
        started.add(text);
        await(release);
      }).budget(Duration.ofSeconds(1)));
      int workers = 8;
      int perWorker = 10_000;
      AtomicLong processed = new AtomicLong();
      CountDownLatch ends = new CountDownLatch(workers);
      List<WorkerHandle<Integer>> busy = new ArrayList<>();
      for (int i = 0; i < workers; i++) {
        busy.add(runtime.owner("core").spawn(WorkerOptions.<Integer>of("busy-" + i, () -> (n, ctx) -> {
          if (n < 0) {
            ends.countDown();
          } else {
            processed.incrementAndGet();
          }
        }).mailbox(perWorker, Overflow.DROP_NEWEST)));
      }

      hanging.send("hang");
      started.next();
      time.advance(Duration.ofMillis(1_100));
      assertThat(listener.events.next()).isEqualTo("hung plugin-a/hanging restarting=false");

      runConcurrently(workers, i -> {
        for (int n = 0; n < perWorker; n++) {
          assertThat(busy.get(i).send(n)).isEqualTo(SendOutcome.ACCEPTED);
        }
      });
      for (WorkerHandle<Integer> worker : busy) {
        runtime.deliverAlways(worker, () -> -1);
      }
      await(ends);

      assertThat(processed.get()).isEqualTo((long) workers * perWorker);
      release.countDown();
    }
  }

  /** Queues {@code marker} behind everything accepted so far and waits until it is handled. */
  private static <M> void endWith(WorkerRuntime runtime, WorkerHandle<M> worker, M marker, CountDownLatch end) {
    assertThat(runtime.deliverAlways(worker, () -> marker)).isTrue();
    await(end);
  }

  /** Runs {@code body} on {@code threads} virtual threads at once and waits for all of them. */
  private static void runConcurrently(int threads, IntConsumer body) throws InterruptedException {
    CountDownLatch go = new CountDownLatch(1);
    List<Thread> started = new ArrayList<>();
    List<Throwable> failures = new java.util.concurrent.CopyOnWriteArrayList<>();
    for (int i = 0; i < threads; i++) {
      int index = i;
      started.add(Thread.ofVirtual().start(() -> {
        try {
          await(go);
          body.accept(index);
        } catch (Throwable t) {
          failures.add(t);
        }
      }));
    }
    go.countDown();
    for (Thread t : started) {
      assertThat(t.join(Probe.WAIT)).as("sender finished").isTrue();
    }
    assertThat(failures).isEmpty();
  }
}
