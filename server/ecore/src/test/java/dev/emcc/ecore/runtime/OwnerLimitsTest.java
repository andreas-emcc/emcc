package dev.emcc.ecore.runtime;

import static dev.emcc.ecore.runtime.WorkerRuntimeTest.await;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.function.Consumer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** The caps per owner on outstanding asks and active timers (CR-0005), on the manual clock. */
class OwnerLimitsTest {

  /** Messages of the plugin's worker: run an action in the worker, or receive an answer or a tick. */
  sealed interface Msg {
    record Run(Consumer<HandlerContext<Msg>> action) implements Msg {}

    record Got(Answer<String> answer) implements Msg {}

    record Tick(String name) implements Msg {}
  }

  /** Messages of the asked worker, which keeps every request unanswered until the test answers it. */
  record Get(ReplyHandle<String> replyTo) {}

  private static final Duration LONG = HandlerContext.MAX_ASK_TIMEOUT;

  private final ManualTime time = new ManualTime();
  private final RecordingListener listener = new RecordingListener();
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time).listener(listener));
  private final Owner core = runtime.owner("core");
  private final Owner plugin = runtime.owner("plugin-a");
  private final Probe<ReplyHandle<String>> requests = new Probe<>();
  private final Probe<Answer<String>> answers = new Probe<>();
  private final Probe<String> done = new Probe<>();
  private final Probe<String> ticks = new Probe<>();

  @AfterEach
  void close() {
    runtime.close();
  }

  private WorkerHandle<Get> target() {
    return core.spawn(WorkerOptions.<Get>of("target", () -> (msg, ctx) -> requests.add(msg.replyTo())).mailbox(100_000, Overflow.DROP_NEWEST));
  }

  private WorkerHandle<Msg> worker(Owner owner, String name) {
    return owner.spawn(WorkerOptions.<Msg>of(name, () -> (msg, ctx) -> {
      switch (msg) {
        case Msg.Run run -> {
          try {
            run.action().accept(ctx);
          } finally {
            done.add(name + " ran");
          }
        }
        case Msg.Got got -> answers.add(got.answer());
        case Msg.Tick tick -> ticks.add(tick.name());
      }
    }).mailbox(100_000, Overflow.DROP_NEWEST));
  }

  /** Asks {@code target} from the worker, and waits until ask() has returned. */
  private void ask(WorkerHandle<Msg> asker, WorkerHandle<Get> target, Duration timeout) {
    asker.send(new Msg.Run(ctx -> ctx.ask(target, Get::new, timeout, Msg.Got::new)));
    done.next();
  }

  private static long accepted(WorkerHandle<?> worker) {
    return ((WorkerCell<?>) worker).stats().accepted();
  }

  private List<String> capEvents() {
    return listener.events.drain().stream().filter(e -> e.startsWith("cap ")).toList();
  }

  // ---- asks -----------------------------------------------------------------------------------

  @Test
  void anAskOverTheCapIsFailedAtOnceAndNotSent() {
    plugin.limits(new OwnerLimits(2, 1_000));
    WorkerHandle<Get> target = target();
    WorkerHandle<Msg> asker = worker(plugin, "asker");

    ask(asker, target, LONG);
    ask(asker, target, LONG);
    ask(asker, target, LONG);

    assertThat(answers.next()).isEqualTo(new Answer.Failed<>("too many outstanding asks"));
    assertThat(accepted(target)).as("only two requests sent").isEqualTo(2);
    assertThat(plugin.outstandingAsks()).isEqualTo(2);
    assertThat(plugin.refusedAsks()).isEqualTo(1);
    assertThat(capEvents()).containsExactly("cap plugin-a outstanding asks 2 refused 1");
  }

  @Test
  void anAnswerGivesTheSlotBack() {
    plugin.limits(new OwnerLimits(1, 1_000));
    WorkerHandle<Get> target = target();
    WorkerHandle<Msg> asker = worker(plugin, "asker");

    ask(asker, target, LONG);
    requests.next().reply("first");
    assertThat(answers.next()).isEqualTo(new Answer.Ok<>("first"));
    assertThat(plugin.outstandingAsks()).isZero();

    ask(asker, target, LONG);
    requests.next().reply("second");
    assertThat(answers.next()).isEqualTo(new Answer.Ok<>("second"));
    assertThat(plugin.refusedAsks()).isZero();
  }

  @Test
  void anAskAnsweredByItsRequestFunctionThatThenThrowsGivesItsSlotBackOnce() {
    plugin.limits(new OwnerLimits(1, 1_000));
    WorkerHandle<Get> target = target();
    WorkerHandle<Msg> asker = worker(plugin, "asker");

    asker.send(new Msg.Run(ctx -> ctx.ask(target, replyTo -> {
      replyTo.reply("answered early");
      throw new IllegalStateException("then the request function failed");
    }, LONG, Msg.Got::new)));
    done.next();

    assertThat(answers.next()).isEqualTo(new Answer.Ok<>("answered early"));
    assertThat(plugin.outstandingAsks()).as("given back once, not twice").isZero();
    // The cap still holds: one ask is sent, the next is refused.
    ask(asker, target, LONG);
    ask(asker, target, LONG);
    assertThat(answers.next()).isEqualTo(new Answer.Failed<>("too many outstanding asks"));
    assertThat(accepted(target)).isEqualTo(1);
  }

  @Test
  void everyOtherEndOfAnAskGivesTheSlotBackToo() {
    plugin.limits(new OwnerLimits(1, 1_000));
    WorkerHandle<Get> target = target();
    WorkerHandle<Msg> asker = worker(plugin, "asker");

    ask(asker, target, LONG);
    requests.next().fail("no");
    assertThat(answers.next()).isEqualTo(new Answer.Failed<>("no"));
    assertThat(plugin.outstandingAsks()).as("failed by the target").isZero();

    ask(asker, target, Duration.ofSeconds(2));
    requests.next(); // never answered
    time.advanceSettled(Duration.ofSeconds(2), runtime);
    assertThat(answers.next()).isEqualTo(new Answer.TimedOut<>());
    assertThat(plugin.outstandingAsks()).as("timed out").isZero();

    asker.send(new Msg.Run(ctx -> ctx.ask(target, replyTo -> {
      throw new IllegalStateException("the request function failed");
    }, LONG, Msg.Got::new)));
    done.next();
    assertThat(plugin.outstandingAsks()).as("nothing sent").isZero();

    core.stopWorker(target);
    ask(asker, target, LONG);
    assertThat(answers.next()).isEqualTo(new Answer.Failed<>("core/target is stopped"));
    assertThat(plugin.outstandingAsks()).as("target stopped").isZero();
    assertThat(plugin.refusedAsks()).isZero();
  }

  @Test
  void aRequestRefusedByAFullMailboxGivesTheSlotBack() {
    plugin.limits(new OwnerLimits(1, 1_000));
    CountDownLatch release = new CountDownLatch(1);
    Probe<String> holding = new Probe<>();
    WorkerHandle<Object> full = core.spawn(WorkerOptions.<Object>of("full", () -> (msg, ctx) -> {
      holding.add("holds " + msg);
      await(release);
    }).mailbox(1, Overflow.DROP_NEWEST));
    full.send("hold");
    assertThat(holding.next()).isEqualTo("holds hold"); // taken: the worker blocks
    assertThat(full.send("fill")).isEqualTo(SendOutcome.ACCEPTED); // the one place in the mailbox
    try {
      WorkerHandle<Msg> asker = worker(plugin, "asker");
      asker.send(new Msg.Run(ctx -> ctx.ask(full, replyTo -> "request", LONG, Msg.Got::new)));
      done.next();
      assertThat(answers.next()).isEqualTo(new Answer.Failed<>("the mailbox of core/full is full"));
      assertThat(plugin.outstandingAsks()).isZero();
    } finally {
      release.countDown();
    }
  }

  @Test
  void ownersWithoutLimitsAreNotCapped() {
    assertThat(core.limits()).isEqualTo(OwnerLimits.UNLIMITED);
    WorkerHandle<Get> target = target();
    WorkerHandle<Msg> asker = worker(core, "asker");
    for (int i = 0; i < 20_000; i++) {
      asker.send(new Msg.Run(ctx -> ctx.ask(target, Get::new, LONG, Msg.Got::new)));
    }
    done.next(20_000);
    assertThat(core.outstandingAsks()).isEqualTo(20_000);
    assertThat(core.refusedAsks()).isZero();
  }

  // ---- timers ---------------------------------------------------------------------------------

  @Test
  void aTimerOverTheCapThrowsAndFiredOrCancelledTimersGiveTheirSlotBack() {
    plugin.limits(new OwnerLimits(10, 2));
    WorkerHandle<Msg> worker = worker(plugin, "w");

    plugin.once(Duration.ofSeconds(1), worker, new Msg.Tick("once"));
    Cancellable every = plugin.every(Duration.ofSeconds(5), worker, new Msg.Tick("every"));
    assertThatThrownBy(() -> plugin.once(Duration.ofSeconds(1), worker, new Msg.Tick("third")))
        .isInstanceOf(IllegalStateException.class).hasMessage("too many active timers: plugin-a has 2, its cap");
    assertThatThrownBy(() -> plugin.every(Duration.ofSeconds(1), worker, new Msg.Tick("third")))
        .isInstanceOf(IllegalStateException.class);
    assertThat(plugin.activeTimers()).isEqualTo(2);
    assertThat(plugin.refusedTimers()).isEqualTo(2);

    time.advanceSettled(Duration.ofSeconds(1), runtime);
    assertThat(ticks.next()).isEqualTo("once");
    assertThat(plugin.activeTimers()).as("fired").isEqualTo(1);

    Cancellable second = plugin.once(Duration.ofSeconds(1), worker, new Msg.Tick("second"));
    second.cancel();
    second.cancel(); // twice: given back once
    assertThat(plugin.activeTimers()).as("cancelled").isEqualTo(1);

    every.cancel();
    assertThat(plugin.activeTimers()).isZero();
    plugin.once(Duration.ofSeconds(1), worker, new Msg.Tick("a"));
    plugin.once(Duration.ofSeconds(1), worker, new Msg.Tick("b"));
    assertThatThrownBy(() -> plugin.once(Duration.ofSeconds(1), worker, new Msg.Tick("c"))).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void aFiredTimerCancelledLaterIsGivenBackOnlyOnce() {
    plugin.limits(new OwnerLimits(10, 2));
    WorkerHandle<Msg> worker = worker(plugin, "w");
    Cancellable fired = plugin.once(Duration.ofSeconds(1), worker, new Msg.Tick("fired"));
    plugin.once(Duration.ofSeconds(9), worker, new Msg.Tick("later"));
    time.advanceSettled(Duration.ofSeconds(1), runtime);
    ticks.next();

    fired.cancel();

    assertThat(plugin.activeTimers()).isEqualTo(1);
  }

  @Test
  void aTimerToAStoppedWorkerEndsAndGivesItsSlotBack() {
    plugin.limits(new OwnerLimits(10, 1));
    WorkerHandle<Msg> worker = worker(plugin, "w");
    plugin.every(Duration.ofSeconds(1), worker, new Msg.Tick("every"));
    plugin.stopWorker(worker);

    time.advanceSettled(Duration.ofSeconds(1), runtime);

    assertThat(plugin.activeTimers()).isZero();
  }

  @Test
  void stoppingTheOwnerEndsAllItsTimers() {
    plugin.limits(new OwnerLimits(10, 5));
    WorkerHandle<Msg> worker = worker(plugin, "w");
    plugin.once(Duration.ofSeconds(1), worker, new Msg.Tick("once"));
    plugin.every(Duration.ofSeconds(1), worker, new Msg.Tick("every"));

    plugin.stop();

    assertThat(plugin.activeTimers()).isZero();
  }

  @Test
  void aTimerRefusedInAHandlerFailsThatCallOnlyAndTheWorkerContinues() {
    plugin.limits(new OwnerLimits(10, 1));
    WorkerHandle<Msg> worker = worker(plugin, "w");
    plugin.once(Duration.ofMinutes(1), worker, new Msg.Tick("taken"));

    worker.send(new Msg.Run(ctx -> plugin.once(Duration.ofSeconds(1), ctx.self(), new Msg.Tick("refused"))));
    done.next();
    worker.send(new Msg.Run(ctx -> ticks.add("still running")));
    done.next();

    assertThat(listener.events.next(2)).containsExactly(
        "cap plugin-a active timers 1 refused 1", "failed plugin-a/w: too many active timers: plugin-a has 1, its cap");
    assertThat(ticks.next()).isEqualTo("still running");
    assertThat(((WorkerCell<?>) worker).stats().state()).isEqualTo(WorkerState.RUNNING);
  }

  /** A scheduler on the manual clock that refuses tasks with one given delay, while told to. */
  private static final class RefusingScheduler implements Scheduler {
    private final ManualTime time;
    private volatile @org.jspecify.annotations.Nullable Duration refused;

    RefusingScheduler(ManualTime time) {
      this.time = time;
    }

    @Override
    public Cancellable schedule(Duration delay, Runnable task) {
      if (delay.equals(refused)) {
        throw new IllegalStateException("the scheduler refused it");
      }
      return time.schedule(delay, task);
    }
  }

  @Test
  void aTimerTheSchedulerRefusesGivesItsSlotBack() {
    ManualTime clock = new ManualTime();
    RefusingScheduler scheduler = new RefusingScheduler(clock);
    Duration odd = Duration.ofSeconds(7); // no other task of the runtime has this delay
    try (WorkerRuntime other = WorkerRuntime.start(
        new RuntimeConfig(clock, scheduler, Duration.ofMillis(100), 3, Duration.ofMinutes(10), RuntimeListener.NONE, 2))) {
      Owner owner = other.owner("plugin-b");
      owner.limits(new OwnerLimits(10, 1));
      WorkerHandle<Msg> worker = owner.spawn(WorkerOptions.<Msg>of("w", () -> (msg, ctx) -> {}));

      scheduler.refused = odd;
      assertThatThrownBy(() -> owner.once(odd, worker, new Msg.Tick("once"))).hasMessage("the scheduler refused it");
      assertThat(owner.activeTimers()).as("once").isZero();
      assertThatThrownBy(() -> owner.every(odd, worker, new Msg.Tick("every"))).hasMessage("the scheduler refused it");
      assertThat(owner.activeTimers()).as("every").isZero();

      // A periodic timer whose next tick is refused ends and gives its slot back.
      scheduler.refused = null;
      owner.every(odd, worker, new Msg.Tick("every"));
      assertThat(owner.activeTimers()).isEqualTo(1);
      scheduler.refused = odd;
      clock.advanceSettled(odd, other);
      assertThat(owner.activeTimers()).as("next tick refused").isZero();
      scheduler.refused = null;
      owner.once(odd, worker, new Msg.Tick("again")); // the slot is usable again
    }
  }

  // ---- reporting ------------------------------------------------------------------------------

  @Test
  void refusalsAreCountedAndReportedAtMostOnceAMinutePerOwner() {
    plugin.limits(new OwnerLimits(1, 1));
    WorkerHandle<Msg> worker = worker(plugin, "w");
    plugin.once(Duration.ofHours(1), worker, new Msg.Tick("taken"));
    Runnable refuse = () -> assertThatThrownBy(() -> plugin.once(Duration.ofSeconds(1), worker, new Msg.Tick("x")))
        .isInstanceOf(IllegalStateException.class);

    for (int i = 0; i < 5; i++) {
      refuse.run();
    }
    assertThat(capEvents()).containsExactly("cap plugin-a active timers 1 refused 1");

    time.advanceSettled(Duration.ofSeconds(59), runtime);
    refuse.run();
    assertThat(capEvents()).as("within the minute").isEmpty();

    time.advanceSettled(Duration.ofSeconds(1), runtime);
    refuse.run();
    assertThat(capEvents()).containsExactly("cap plugin-a active timers 1 refused 7");
    assertThat(plugin.refusedTimers()).isEqualTo(7);

    // One report a minute per owner, whichever cap refused: an ask refused now is counted, not reported.
    WorkerHandle<Get> target = target();
    ask(worker, target, LONG);
    ask(worker, target, LONG);
    assertThat(answers.next()).isEqualTo(new Answer.Failed<>("too many outstanding asks"));
    assertThat(plugin.refusedAsks()).isEqualTo(1);
    assertThat(capEvents()).isEmpty();

    time.advanceSettled(Duration.ofMinutes(1), runtime);
    ask(worker, target, LONG);
    answers.next();
    assertThat(capEvents()).containsExactly("cap plugin-a outstanding asks 1 refused 2");
  }

  // ---- concurrency ----------------------------------------------------------------------------

  @Test
  void manyWorkersAskingAtOnceNeverGetMoreThanTheCap() {
    int cap = 50;
    int workers = 16;
    int asksEach = 500;
    plugin.limits(new OwnerLimits(cap, 1_000));
    WorkerHandle<Get> target = target();
    List<WorkerHandle<Msg>> askers = new ArrayList<>();
    for (int w = 0; w < workers; w++) {
      askers.add(worker(plugin, "asker-" + w));
    }
    // All workers start together and ask in one tight loop each, so the asks really overlap.
    CountDownLatch go = new CountDownLatch(1);
    for (WorkerHandle<Msg> asker : askers) {
      asker.send(new Msg.Run(ctx -> {
        await(go);
        for (int i = 0; i < asksEach; i++) {
          ctx.ask(target, Get::new, LONG, Msg.Got::new);
        }
      }));
    }
    go.countDown();
    done.next(workers);

    List<Answer<String>> refused = answers.next(workers * asksEach - cap);
    assertThat(refused).containsOnly(new Answer.Failed<>("too many outstanding asks"));
    List<ReplyHandle<String>> sent = requests.next(cap);
    assertThat(accepted(target)).isEqualTo(cap);
    assertThat(plugin.outstandingAsks()).isEqualTo(cap);
    assertThat(plugin.refusedAsks()).isEqualTo(workers * asksEach - cap);

    sent.forEach(r -> r.reply("ok"));
    assertThat(answers.next(cap)).containsOnly(new Answer.Ok<>("ok"));
    assertThat(plugin.outstandingAsks()).isZero();
  }

  @Test
  void manyWorkersSettingTimersAtOnceNeverGetMoreThanTheCap() {
    int cap = 40;
    int workers = 16;
    int timersEach = 500;
    plugin.limits(new OwnerLimits(10, cap));
    Probe<Boolean> outcomes = new Probe<>();
    List<WorkerHandle<Msg>> setters = new ArrayList<>();
    for (int w = 0; w < workers; w++) {
      setters.add(worker(plugin, "setter-" + w));
    }
    CountDownLatch go = new CountDownLatch(1);
    for (WorkerHandle<Msg> setter : setters) {
      setter.send(new Msg.Run(ctx -> {
        await(go);
        for (int i = 0; i < timersEach; i++) {
          try {
            plugin.once(Duration.ofMinutes(1), ctx.self(), new Msg.Tick("t"));
            outcomes.add(true);
          } catch (IllegalStateException e) {
            outcomes.add(false);
          }
        }
      }));
    }
    go.countDown();
    done.next(workers);

    List<Boolean> all = outcomes.next(workers * timersEach);
    assertThat(all.stream().filter(b -> b).count()).isEqualTo(cap);
    assertThat(plugin.activeTimers()).isEqualTo(cap);
    assertThat(plugin.refusedTimers()).isEqualTo(workers * timersEach - cap);

    time.advanceSettled(Duration.ofMinutes(1), runtime);
    ticks.next(cap);
    assertThat(plugin.activeTimers()).isZero();
  }

  @Test
  void limitsMustBePositive() {
    assertThatThrownBy(() -> new OwnerLimits(0, 1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new OwnerLimits(1, 0)).isInstanceOf(IllegalArgumentException.class);
  }
}
