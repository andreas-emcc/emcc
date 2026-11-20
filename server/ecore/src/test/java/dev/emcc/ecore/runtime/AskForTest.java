package dev.emcc.ecore.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Asks ECore makes on behalf of an owner (a plugin's store and documents calls). */
class AskForTest {

  /** A request to the server worker: answer at once, or keep the handle and never answer. */
  private record Request(boolean answer, ReplyHandle<String> replyTo) {}

  private final ManualTime time = new ManualTime();
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time));
  private final Owner plugin = runtime.owner("cot");
  private final Probe<String> answers = new Probe<>();
  private final List<ReplyHandle<String>> kept = new ArrayList<>();
  private final WorkerHandle<Request> server = runtime.owner("core").spawn(WorkerOptions.<Request>of("server", () -> (r, ctx) -> {
    if (r.answer()) {
      r.replyTo().reply("pong");
    } else {
      kept.add(r.replyTo());
    }
  }));
  private final WorkerHandle<String> caller = plugin.spawn(WorkerOptions.<String>of("caller", () -> (text, ctx) -> answers.add(text)));

  @AfterEach
  void close() {
    runtime.close();
  }

  private void ask(boolean answer, Duration timeout) {
    runtime.<Request, String, String>askFor(plugin, server, replyTo -> new Request(answer, replyTo), timeout, caller,
        a -> switch (a) {
          case Answer.Ok<String> ok -> "ok " + ok.value();
          case Answer.Failed<String> failed -> "failed " + failed.reason();
          case Answer.TimedOut<String> t -> "timed out";
        });
  }

  @Test
  void theAnswerReachesTheCallerAndTheSlotIsGivenBack() {
    ask(true, Duration.ofSeconds(1));

    assertThat(answers.next()).isEqualTo("ok pong");
    assertThat(plugin.outstandingAsks()).isZero();
  }

  @Test
  void withoutAnAnswerItTimesOutOnce() {
    ask(false, Duration.ofSeconds(1));
    assertThat(plugin.outstandingAsks()).isEqualTo(1);

    time.advance(Duration.ofSeconds(1));

    assertThat(answers.next()).isEqualTo("timed out");
    assertThat(plugin.outstandingAsks()).isZero();
  }

  @Test
  void overTheOwnersCapItFailsAtOnceAndCountsAsRefused() {
    plugin.limits(new OwnerLimits(1, 1_000));
    ask(false, Duration.ofMinutes(1)); // takes the one slot

    ask(true, Duration.ofSeconds(1));

    assertThat(answers.next()).isEqualTo("failed " + OwnerLimits.TOO_MANY_ASKS);
    assertThat(plugin.refusedAsks()).isEqualTo(1);
  }

  @Test
  void aStoppedServerFailsTheAskAtOnce() {
    runtime.owner("core").stopWorker(server);

    ask(true, Duration.ofSeconds(1));

    assertThat(answers.next()).isEqualTo("failed core/server is stopped");
    assertThat(plugin.outstandingAsks()).isZero();
  }
}
