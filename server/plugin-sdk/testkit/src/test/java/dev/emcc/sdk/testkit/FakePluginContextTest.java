package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpCall;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.http.HttpResult;
import dev.emcc.sdk.topic.Topic;
import dev.emcc.sdk.worker.Coalescing;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.Reply;
import dev.emcc.sdk.worker.ReplyTo;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

class FakePluginContextTest {

  // Messages of a small test worker that records what it handles.
  sealed interface Msg extends Message {}

  record Note(String text) implements Msg {}

  record Keyed(String key, int value) implements Msg, Coalescing {
    public Object coalesceKey() {
      return key;
    }
  }

  record Ask(ReplyTo<Note> replyTo) implements Msg {}

  record Answer(Reply<Note> reply) implements Msg {}

  record Http(HttpResult result) implements Msg {}

  record Request(EndpointRequest request) implements Msg {}

  /** Handled messages, in order, shared by all handler instances of a test. */
  private final List<Msg> handled = new ArrayList<>();

  private FakePluginContext ctx() {
    return FakePluginContext.builder("demo").internetHosts("upstream.example").build();
  }

  private WorkerRef<Msg> recorder(FakePluginContext ctx, String name, WorkerSpec<Msg> spec) {
    return ctx.workers().spawn(spec);
  }

  private WorkerSpec<Msg> spec(String name) {
    return WorkerSpec.of(name, Msg.class, () -> (m, c) -> handled.add(m));
  }

  @Test
  void nothingRunsUntilTheTestSaysSo() {
    var ctx = ctx();
    var w = recorder(ctx, "w", spec("w"));
    assertThat(w.send(new Note("a"))).isEqualTo(SendResult.ACCEPTED);
    assertThat(handled).isEmpty();
    ctx.runUntilIdle();
    assertThat(handled).containsExactly(new Note("a"));
  }

  @Test
  void dropNewestRefusesAndCounts() {
    var ctx = ctx();
    var w = recorder(ctx, "w", spec("w").mailbox(2, Overflow.dropNewest()));
    w.send(new Note("1"));
    w.send(new Note("2"));
    assertThat(w.send(new Note("3"))).isEqualTo(SendResult.DROPPED);
    assertThat(ctx.dropped(w)).isEqualTo(1);
    ctx.runUntilIdle();
    assertThat(handled).containsExactly(new Note("1"), new Note("2"));
  }

  @Test
  void dropOldestEvicts() {
    var ctx = ctx();
    var w = recorder(ctx, "w", spec("w").mailbox(2, Overflow.dropOldest()));
    w.send(new Note("1"));
    w.send(new Note("2"));
    assertThat(w.send(new Note("3"))).isEqualTo(SendResult.ACCEPTED);
    ctx.runUntilIdle();
    assertThat(handled).containsExactly(new Note("2"), new Note("3"));
  }

  @Test
  void coalesceReplacesInPlaceAndNeverCoalescesUnkeyedMessages() {
    var ctx = ctx();
    var w = recorder(ctx, "w", spec("w").mailbox(10, Overflow.coalesceByKey()));
    w.send(new Keyed("a", 1));
    w.send(new Note("x"));
    w.send(new Keyed("b", 1));
    w.send(new Keyed("a", 2));
    w.send(new Note("x"));
    ctx.runUntilIdle();
    assertThat(handled).containsExactly(new Keyed("a", 2), new Note("x"), new Keyed("b", 1), new Note("x"));
  }

  @Test
  void stoppedWorkersAreClosed() {
    var ctx = ctx();
    var w = recorder(ctx, "w", spec("w"));
    ctx.stop(w);
    assertThat(w.send(new Note("late"))).isEqualTo(SendResult.CLOSED);
  }

  @Test
  void askDeliversTheAnswerAsAMessageEvenBeyondCapacity() {
    var ctx = ctx();
    var server = ctx.workers().spawn(WorkerSpec.of("server", Msg.class, () -> (m, c) -> {
      if (m instanceof Ask a) {
        a.replyTo().reply(new Note("pong"));
      }
    }));
    var client = ctx.workers().spawn(WorkerSpec.<Msg>of("client", Msg.class, () -> (m, c) -> {
      handled.add(m);
      if (m instanceof Note n && n.text().equals("go")) {
        c.ask(server, Ask::new, Duration.ofSeconds(2), Answer::new);
        c.self().send(new Note("filler"));   // fills the mailbox of capacity 1
      }
    }).mailbox(1, Overflow.dropNewest()));
    client.send(new Note("go"));
    ctx.runUntilIdle();
    assertThat(handled).contains(new Answer(new Reply.Ok<>(new Note("pong"))));
  }

  @Test
  void askTimesOutWithVirtualTime() {
    var ctx = ctx();
    var silent = ctx.workers().spawn(WorkerSpec.of("silent", Msg.class, () -> (m, c) -> {}));
    var client = ctx.workers().spawn(WorkerSpec.of("client", Msg.class, () -> (m, c) -> {
      handled.add(m);
      if (m instanceof Note) {
        c.ask(silent, Ask::new, Duration.ofSeconds(2), Answer::new);
      }
    }));
    client.send(new Note("go"));
    ctx.advance(Duration.ofMillis(1999));
    assertThat(handled).containsExactly(new Note("go"));
    ctx.advance(Duration.ofMillis(1));
    assertThat(handled).containsExactly(new Note("go"), new Answer(new Reply.TimedOut<>()));
  }

  @Test
  void askFailsWhenTheTargetIsStoppedOrRefuses() {
    var ctx = ctx();
    var stopped = ctx.workers().spawn(WorkerSpec.of("stopped", Msg.class, () -> (m, c) -> {}));
    ctx.stop(stopped);
    var client = ctx.workers().spawn(WorkerSpec.of("client", Msg.class, () -> (m, c) -> {
      handled.add(m);
      if (m instanceof Note) {
        c.ask(stopped, Ask::new, Duration.ofSeconds(2), Answer::new);
      }
    }));
    client.send(new Note("go"));
    ctx.advance(Duration.ofSeconds(5));
    assertThat(handled).hasSize(2);
    assertThat(((Answer) handled.get(1)).reply()).isInstanceOf(Reply.Failed.class);
  }

  @Test
  void restartFencesTheOldContext() {
    var ctx = ctx();
    var target = ctx.workers().spawn(WorkerSpec.of("target", Msg.class, () -> (m, c) -> handled.add(m)));
    var contexts = new ArrayList<dev.emcc.sdk.worker.WorkerContext<Msg>>();
    var w = ctx.workers().spawn(WorkerSpec.of("w", Msg.class, () -> (m, c) -> contexts.add(c)).restartable(true));
    w.send(new Note("first"));
    ctx.runUntilIdle();
    ctx.restart(w);
    contexts.getFirst().ask(target, Ask::new, Duration.ofSeconds(1), Answer::new);
    ctx.advance(Duration.ofSeconds(2));
    assertThat(handled).as("the fenced context's ask went nowhere").isEmpty();
  }

  @Test
  void periodicTimersUseVirtualTimeAndCanBeCancelled() {
    var ctx = ctx();
    var w = recorder(ctx, "w", spec("w"));
    var tick = ctx.timers().every(Duration.ofMillis(100), w, new Note("tick"));
    ctx.advance(Duration.ofSeconds(1));
    assertThat(handled).hasSize(10);
    tick.cancel();
    ctx.advance(Duration.ofSeconds(1));
    assertThat(handled).hasSize(10);
    assertThatThrownBy(() -> ctx.timers().once(Duration.ofMillis(5), w, new Note("x"))).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void asksAboveTheCapFailAtOnceAndAnsweredAsksFreeTheirSlot() {
    var ctx = FakePluginContext.builder("demo").caps(2, 10).build();
    var silent = ctx.workers().spawn(WorkerSpec.of("silent", Msg.class, () -> (m, c) -> {}));
    var client = ctx.workers().spawn(WorkerSpec.of("client", Msg.class, () -> (m, c) -> {
      handled.add(m);
      if (m instanceof Note) {
        c.ask(silent, Ask::new, Duration.ofSeconds(10), Answer::new);
      }
    }));
    for (int i = 0; i < 3; i++) {
      client.send(new Note("ask " + i));
    }
    ctx.runUntilIdle();
    assertThat(ctx.outstandingAsks()).isEqualTo(2);
    assertThat(handled).containsOnlyOnce(new Answer(new Reply.Failed<>("too many outstanding asks")));

    ctx.advance(Duration.ofSeconds(10)); // the two time out: answered, so their slots are free
    assertThat(ctx.outstandingAsks()).isZero();
    client.send(new Note("again"));
    ctx.runUntilIdle();
    assertThat(ctx.outstandingAsks()).isEqualTo(1);
  }

  @Test
  void timersAboveTheCapAreRefusedAndEndedTimersFreeTheirSlot() {
    var ctx = FakePluginContext.builder("demo").caps(10, 2).build();
    var w = recorder(ctx, "w", spec("w"));
    var once = ctx.timers().once(Duration.ofMillis(100), w, new Note("once"));
    var every = ctx.timers().every(Duration.ofMillis(100), w, new Note("tick"));
    assertThatThrownBy(() -> ctx.timers().once(Duration.ofMillis(100), w, new Note("third")))
        .isInstanceOf(IllegalStateException.class).hasMessageContaining("too many active timers");

    ctx.advance(Duration.ofMillis(100)); // the one-off timer fired and is no longer active
    assertThat(ctx.activeTimers()).isEqualTo(1);
    once.cancel(); // after firing: no change
    assertThat(ctx.activeTimers()).isEqualTo(1);
    ctx.timers().once(Duration.ofMillis(100), w, new Note("fits again"));
    every.cancel();
    every.cancel(); // idempotent
    assertThat(ctx.activeTimers()).isEqualTo(1);
  }

  @Test
  void defaultCapsAreEcoresDefaults() {
    var ctx = ctx();
    var w = recorder(ctx, "w", spec("w"));
    for (int i = 0; i < FakePluginContext.DEFAULT_MAX_TIMERS; i++) {
      ctx.timers().once(Duration.ofSeconds(1), w, new Note("t"));
    }
    assertThatThrownBy(() -> ctx.timers().once(Duration.ofSeconds(1), w, new Note("one too many"))).isInstanceOf(IllegalStateException.class);
    assertThat(FakePluginContext.DEFAULT_MAX_TIMERS).isEqualTo(1_000);
    assertThat(FakePluginContext.DEFAULT_MAX_ASKS).isEqualTo(10_000);
  }

  @Test
  void topicMappersRunInsideTheTargetWorker() {
    var ctx = ctx();
    var w = recorder(ctx, "w", spec("w"));
    var topic = Topic.of("demo.notes", Note.class);
    int[] mapped = {0};
    ctx.topics().subscribe(topic, w, n -> {
      mapped[0]++;
      return n;
    });
    ctx.topics().publish(topic, new Note("hello"));
    assertThat(mapped[0]).as("not yet: the mapper runs when the worker handles the delivery").isZero();
    ctx.runUntilIdle();
    assertThat(mapped[0]).isEqualTo(1);
    assertThat(handled).containsExactly(new Note("hello"));
    assertThatThrownBy(() -> ctx.topics().publish(Topic.of("other.notes", Note.class), new Note("x"))).hasMessageContaining("own topics");
  }

  @Test
  void outboundHttpFollowsTheRules() {
    var ctx = ctx();
    var w = recorder(ctx, "w", spec("w"));
    ctx.upstream()
        .respond("https://upstream.example/ok", 200, Headers.of("Content-Type", "text/plain"), Bytes.utf8("hi"))
        .respond("https://upstream.example/moved", 301, Headers.of("Location", "/ok"), Bytes.empty())
        .never("https://upstream.example/slow")
        .respondAfter(Duration.ofSeconds(10), "https://upstream.example/late", 200, Headers.empty(), Bytes.empty());
    for (String path : List.of("ok", "moved", "slow", "late", "unscripted")) {
      ctx.http().send(HttpCall.get(URI.create("https://upstream.example/" + path)), Duration.ofSeconds(5), w, Http::new);
    }
    ctx.http().send(HttpCall.get(URI.create("https://elsewhere.example/x")), Duration.ofSeconds(5), w, Http::new);
    ctx.advance(Duration.ofSeconds(20));

    assertThat(ctx.httpCalls()).hasSize(6);
    List<HttpResult> results = handled.stream().map(m -> ((Http) m).result()).toList();
    assertThat(results).hasSize(6);
    assertThat(results).filteredOn(r -> r instanceof HttpResult.Response resp && resp.status() == 200 && resp.body().toUtf8().equals("hi")).hasSize(1);
    assertThat(results).filteredOn(r -> r instanceof HttpResult.TimedOut).as("slow and late").hasSize(2);
    assertThat(results).filteredOn(r -> r instanceof HttpResult.Failed f && f.reason().contains("redirect")).hasSize(1);
    // Any host may be called (CR-0013): an undeclared one is not refused, it only has no scripted answer here.
    assertThat(results).filteredOn(r -> r instanceof HttpResult.Failed f && f.reason().contains("not allowed")).isEmpty();
    assertThat(results).filteredOn(r -> r instanceof HttpResult.Failed f && f.reason().contains("no fake response")).hasSize(2);
  }

  @Test
  void endpointsAnswerLaterOrGet504Or503Or404() {
    var ctx = ctx();
    var pending = new ArrayList<EndpointRequest>();
    var w = ctx.workers().spawn(WorkerSpec.<Msg>of("tiles", Msg.class, () -> (m, c) -> {
      if (m instanceof Request r) {
        if (r.request().pathParameter("z").equals("0")) {
          r.request().response().respond(HttpReply.of(200, Headers.of("Content-Type", "image/png"), Bytes.utf8("png")));
        } else {
          pending.add(r.request());
        }
      }
    }).mailbox(1, Overflow.dropNewest()));
    ctx.endpoints().register(Endpoint.get("/tiles/{z}/{x}/{y}.png").timeout(Duration.ofSeconds(10)), w, Request::new);

    FakeHttpExchange now = ctx.call("/tiles/0/0/0.png");
    ctx.runUntilIdle();
    assertThat(now.reply().status()).isEqualTo(200);

    FakeHttpExchange later = ctx.call("/tiles/5/17/9.png?style=dark");
    ctx.runUntilIdle();
    assertThat(later.isAnswered()).isFalse();
    assertThat(pending.getFirst().queryParameter("style")).isEqualTo("dark");

    FakeHttpExchange first = ctx.call("/tiles/6/1/1.png");
    FakeHttpExchange refused = ctx.call("/tiles/6/1/2.png");
    assertThat(refused.reply().status()).as("mailbox of 1 is full").isEqualTo(503);
    ctx.runUntilIdle();

    ctx.advance(Duration.ofSeconds(10));
    assertThat(later.reply().status()).isEqualTo(504);
    assertThat(first.reply().status()).isEqualTo(504);
    pending.getFirst().response().respond(HttpReply.status(200));
    assertThat(later.reply().status()).as("a late answer is ignored").isEqualTo(504);
    assertThat(ctx.logEntries()).anyMatch(e -> e.level() == LogEntry.Level.WARN && e.message().contains("ignored"));

    assertThat(ctx.call("/nothing/here").reply().status()).isEqualTo(404);
    assertThatThrownBy(() -> ctx.endpoints().register(Endpoint.get("/tiles/{z}/{x}/{y}.png"), w, Request::new)).hasMessageContaining("already registered");
  }

  @Test
  void effectiveStatusIsTheWorseOfPluginAndEcore() {
    var ctx = ctx();
    ctx.status().set(PluginState.OK, "fine");
    ctx.setEcoreStatus(PluginState.DEGRADED, "worker 'tiles' hung");
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    ctx.status().set(PluginState.FAILED, "upstream gone");
    assertThat(ctx.effectiveStatus().detail()).isEqualTo("upstream gone");
  }

  @Test
  void throwingHandlersFailTheTestByDefaultOrAreCollected() {
    var strict = ctx();
    var boom = strict.workers().spawn(WorkerSpec.of("boom", Msg.class, () -> (m, c) -> {
      throw new IllegalStateException("bug");
    }));
    boom.send(new Note("x"));
    assertThatThrownBy(strict::runUntilIdle).isInstanceOf(AssertionError.class).hasRootCauseMessage("bug");

    var lenient = FakePluginContext.builder("demo").rethrowHandlerErrors(false).build();
    var w = lenient.workers().spawn(WorkerSpec.of("boom", Msg.class, () -> (m, c) -> {
      throw new IllegalStateException("bug");
    }));
    w.send(new Note("x"));
    w.send(new Note("y"));
    lenient.runUntilIdle();
    assertThat(lenient.handlerErrors()).hasSize(2);
  }

  record Names(java.util.List<String> names) implements Msg {}

  @Test
  void mutableMessagesFailAtDelivery() {
    var ctx = ctx();
    var w = recorder(ctx, "w", spec("w"));
    w.send(new Names(java.util.List.of("a", "b")));
    ctx.runUntilIdle();
    assertThat(handled).hasSize(1);
    w.send(new Names(new ArrayList<>(java.util.List.of("a"))));
    assertThatThrownBy(ctx::runUntilIdle).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("mutable java.util.ArrayList");
  }

  record WithLog(dev.emcc.sdk.PluginLog log) implements Msg {}

  @Test
  void sdkServicesInMessagesFailAtDelivery() {
    var ctx = ctx();
    var w = recorder(ctx, "w", spec("w"));
    w.send(new WithLog(ctx.log()));
    assertThatThrownBy(ctx::runUntilIdle).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("SDK service");
  }

  record WithSpec(WorkerSpec<Msg> spec) implements Msg {}

  @Test
  void workerSpecsInMessagesFailAtDelivery() {
    var ctx = ctx();
    var w = recorder(ctx, "w", spec("w"));
    w.send(new WithSpec(spec("other")));
    assertThatThrownBy(ctx::runUntilIdle).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("SDK service");
  }

  @Test
  void logPlaceholdersAreFilled() {
    var ctx = ctx();
    ctx.log().info("fetched {} in {} ms", "5/17/9", 42);
    @Nullable Object missing = null;
    ctx.log().warn("value {}", missing);
    assertThat(ctx.logEntries()).extracting(LogEntry::message).containsExactly("fetched 5/17/9 in 42 ms", "value null");
  }
}
