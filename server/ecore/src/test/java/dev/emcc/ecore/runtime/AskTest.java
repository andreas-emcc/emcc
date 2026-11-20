package dev.emcc.ecore.runtime;

import static dev.emcc.ecore.runtime.WorkerRuntimeTest.await;
import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class AskTest {

  /** Messages of the asking worker. */
  sealed interface AskerMsg {
    record Start(Duration timeout) implements AskerMsg {}

    record Got(Answer<String> answer) implements AskerMsg {}

    record Hold(CountDownLatch release) implements AskerMsg {}
  }

  /** Messages of the asked worker. */
  sealed interface TargetMsg {
    record Get(ReplyHandle<String> replyTo) implements TargetMsg {}

    record Hold(CountDownLatch release) implements TargetMsg {}
  }

  private final ManualTime time = new ManualTime();
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time));
  private final Owner core = runtime.owner("core");
  private final Probe<Answer<String>> answers = new Probe<>();
  private final Probe<String> started = new Probe<>();
  /** Reported right after ask() or reply() returned, i.e. once the request or answer is queued. */
  private final Probe<String> queued = new Probe<>();

  @AfterEach
  void close() {
    runtime.close();
  }

  /** A target that handles Get with {@code onGet}, and blocks on Hold. */
  private WorkerHandle<TargetMsg> target(java.util.function.Consumer<ReplyHandle<String>> onGet, int capacity, Overflow overflow) {
    return core.spawn(WorkerOptions.<TargetMsg>of("target", () -> (msg, ctx) -> {
      switch (msg) {
        case TargetMsg.Get get -> onGet.accept(get.replyTo());
        case TargetMsg.Hold hold -> {
          started.add("target holds");
          await(hold.release());
        }
      }
    }).mailbox(capacity, overflow));
  }

  private WorkerHandle<AskerMsg> asker(WorkerHandle<TargetMsg> target, int capacity) {
    return core.spawn(WorkerOptions.<AskerMsg>of("asker", () -> (msg, ctx) -> {
      switch (msg) {
        case AskerMsg.Start start -> {
          ctx.ask(target, TargetMsg.Get::new, start.timeout(), AskerMsg.Got::new);
          queued.add("request queued"); // ask() queues the request before it returns
        }
        case AskerMsg.Got got -> answers.add(got.answer());
        case AskerMsg.Hold hold -> {
          started.add("asker holds");
          await(hold.release());
        }
      }
    }).mailbox(capacity, Overflow.DROP_NEWEST));
  }

  @Test
  void theAnswerArrivesAsAMessage() {
    WorkerHandle<AskerMsg> asker = asker(target(r -> r.reply("pong"), 10, Overflow.DROP_NEWEST), 10);

    asker.send(new AskerMsg.Start(Duration.ofSeconds(2)));

    assertThat(answers.next()).isEqualTo(new Answer.Ok<>("pong"));
  }

  @Test
  void theTargetCanFailTheRequest() {
    WorkerHandle<AskerMsg> asker = asker(target(r -> r.fail("not today"), 10, Overflow.DROP_NEWEST), 10);

    asker.send(new AskerMsg.Start(Duration.ofSeconds(2)));

    assertThat(answers.next()).isEqualTo(new Answer.Failed<>("not today"));
  }

  @Test
  void noAnswerWithinTheTimeoutGivesTimedOutAndALateAnswerIsIgnored() {
    AtomicReference<ReplyHandle<String>> kept = new AtomicReference<>();
    WorkerHandle<AskerMsg> asker = asker(target(r -> {
      kept.set(r);
      started.add("target got the request");
    }, 10, Overflow.DROP_NEWEST), 10);
    asker.send(new AskerMsg.Start(Duration.ofSeconds(2)));
    assertThat(started.next()).isEqualTo("target got the request");

    time.advanceSettled(Duration.ofSeconds(2), runtime);
    assertThat(answers.next()).isEqualTo(new Answer.TimedOut<>());

    kept.get().reply("too late");
    asker.send(new AskerMsg.Start(Duration.ofSeconds(2))); // a second ask, never answered
    assertThat(started.next()).isEqualTo("target got the request");
    time.advanceSettled(Duration.ofSeconds(2), runtime);
    assertThat(answers.next()).isEqualTo(new Answer.TimedOut<>()); // not "too late"
  }

  @Test
  void aStoppedTargetFailsTheAskAtOnce() {
    WorkerHandle<TargetMsg> target = target(r -> r.reply("pong"), 10, Overflow.DROP_NEWEST);
    WorkerHandle<AskerMsg> asker = runtime.owner("plugin-a").spawn(WorkerOptions.<AskerMsg>of("asker", () -> (msg, ctx) -> {
      if (msg instanceof AskerMsg.Start start) {
        ctx.ask(target, TargetMsg.Get::new, start.timeout(), AskerMsg.Got::new);
      } else if (msg instanceof AskerMsg.Got got) {
        answers.add(got.answer());
      }
    }));
    core.stop();

    asker.send(new AskerMsg.Start(Duration.ofSeconds(2)));

    assertThat(answers.next()).isEqualTo(new Answer.Failed<>("core/target is stopped"));
  }

  @Test
  void aFullTargetMailboxFailsTheAskAtOnce() {
    CountDownLatch release = new CountDownLatch(1);
    WorkerHandle<TargetMsg> target = target(r -> r.reply("pong"), 1, Overflow.DROP_NEWEST);
    WorkerHandle<AskerMsg> asker = asker(target, 10);
    target.send(new TargetMsg.Hold(release));
    assertThat(started.next()).isEqualTo("target holds");
    target.send(new TargetMsg.Hold(release)); // fills the mailbox

    asker.send(new AskerMsg.Start(Duration.ofSeconds(2)));

    assertThat(answers.next()).isEqualTo(new Answer.Failed<>("the mailbox of core/target is full"));
    release.countDown();
  }

  @Test
  void anEvictedRequestFailsTheAsk() {
    CountDownLatch release = new CountDownLatch(1);
    WorkerHandle<TargetMsg> target = target(r -> r.reply("pong"), 1, Overflow.DROP_OLDEST);
    WorkerHandle<AskerMsg> asker = asker(target, 10);
    target.send(new TargetMsg.Hold(release));
    assertThat(started.next()).isEqualTo("target holds");
    asker.send(new AskerMsg.Start(Duration.ofSeconds(2)));
    assertThat(queued.next()).isEqualTo("request queued");

    target.send(new TargetMsg.Hold(release)); // evicts the request

    assertThat(answers.next()).isEqualTo(new Answer.Failed<>("the request was evicted from the mailbox of core/target"));
    release.countDown();
  }

  @Test
  void theAnswerIsDeliveredEvenWhenTheAskersMailboxIsFull() {
    CountDownLatch targetRelease = new CountDownLatch(1);
    CountDownLatch askerRelease = new CountDownLatch(1);
    WorkerHandle<TargetMsg> target = target(r -> {
      r.reply("pong");
      queued.add("answer queued"); // reply() queues the answer before it returns
    }, 10, Overflow.DROP_NEWEST);
    WorkerHandle<AskerMsg> asker = asker(target, 1);
    target.send(new TargetMsg.Hold(targetRelease)); // the request waits behind this
    assertThat(started.next()).isEqualTo("target holds");
    asker.send(new AskerMsg.Start(Duration.ofSeconds(2)));
    assertThat(queued.next()).isEqualTo("request queued");
    asker.send(new AskerMsg.Hold(askerRelease));
    assertThat(started.next()).isEqualTo("asker holds");
    assertThat(asker.send(new AskerMsg.Start(Duration.ofSeconds(2)))).isEqualTo(SendOutcome.ACCEPTED); // fills it
    assertThat(asker.send(new AskerMsg.Start(Duration.ofSeconds(2)))).isEqualTo(SendOutcome.DROPPED); // it is full

    targetRelease.countDown(); // the target answers into the full mailbox
    assertThat(queued.next()).isEqualTo("answer queued");
    askerRelease.countDown();

    assertThat(answers.next()).isEqualTo(new Answer.Ok<>("pong"));
  }

  @Test
  void theTimeoutIsValidated() {
    Probe<Throwable> errors = new Probe<>();
    WorkerHandle<TargetMsg> target = target(r -> r.reply("pong"), 10, Overflow.DROP_NEWEST);
    WorkerHandle<String> asker = core.spawn(WorkerOptions.<String>of("bad-asker", () -> (msg, ctx) -> {
      try {
        ctx.ask(target, TargetMsg.Get::new, Duration.ZERO, a -> "unused");
      } catch (IllegalArgumentException e) {
        errors.add(e);
      }
    }));

    asker.send("go");

    assertThat(errors.next()).hasMessageStartingWith("ask timeout must be");
  }
}
