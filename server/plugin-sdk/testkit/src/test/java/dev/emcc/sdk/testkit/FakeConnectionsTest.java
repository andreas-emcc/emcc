package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.connection.Backoff;
import dev.emcc.sdk.connection.ConnectionEvent;
import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.connection.ConnectionSpec;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.Restart;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.Coalescing;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;

/** SDK 1.2.0 (CR-0025 part 2): the test kit's connection tasks, as ECore runs them (ADR-0036). */
class FakeConnectionsTest {

  sealed interface Msg extends Message permits Event, Got {}

  record Event(ConnectionEvent event) implements Msg {}

  record Got(String text) implements Msg {}

  record Out(String uid, String text) implements Message, Coalescing {
    @Override
    public @Nullable Object coalesceKey() {
      return uid;
    }
  }

  private final List<Msg> received = new ArrayList<>();

  private WorkerRef<Msg> worker(FakePluginContext ctx) {
    return ctx.workers().spawn(WorkerSpec.of("link", Msg.class, () -> (m, c) -> received.add(m)));
  }

  private List<ConnectionEvent> events() {
    return received.stream().filter(m -> m instanceof Event).map(m -> ((Event) m).event()).toList();
  }

  /** Echoes each inbox item to the worker, and returns when its inbox says "end" or it is stopped. */
  static final class Echo implements ConnectionTask<Out> {
    private final WorkerRef<Msg> to;

    Echo(WorkerRef<Msg> to) {
      this.to = to;
    }

    @Override
    public void run(TaskContext<Out> task) {
      for (Out o; (o = task.take()) != null; ) {
        if (o.text().equals("end")) {
          return;
        }
        if (o.text().equals("boom")) {
          throw new IllegalStateException("boom");
        }
        task.count("sent", 1);
        task.send(to, new Got(o.text()));
      }
    }
  }

  @Test
  void aTaskTakesWhatWorkersPostAndSendsToWorkersAtTheNextRun() {
    var ctx = FakePluginContext.builder("cot").build();
    WorkerRef<Msg> w = worker(ctx);
    ConnectionRef<Out> out = ctx.connections().start(ConnectionSpec.of("tak-out", Out.class), () -> new Echo(w), w, Event::new);
    assertThat(out.post(new Out("a", "hello"))).isEqualTo(SendResult.ACCEPTED);
    ctx.connectionTask("tak-out").awaitIdle();
    ctx.runUntilIdle();
    assertThat(events()).hasSize(1).first().isInstanceOf(ConnectionEvent.Running.class);
    assertThat(received).contains(new Got("hello"));
    assertThat(ctx.connectionTask("tak-out").counter("sent")).isEqualTo(1);
    assertThat(ctx.connectionTask("tak-out").state()).isEqualTo(FakeConnections.FakeTask.State.RUNNING);
  }

  @Test
  void theInboxAppliesItsOverflowPolicy() {
    var ctx = FakePluginContext.builder("cot").build();
    // A task that never takes, so the inbox fills.
    ConnectionTask<Out> idle = task -> {
      // Blocks without taking, until the stop closes what it registered.
      var in = task.closeOnStop(new java.io.PipedInputStream(new java.io.PipedOutputStream()));
      in.read();
    };
    ConnectionRef<Out> drop = ctx.connections().start(ConnectionSpec.of("drop", Out.class).inbox(1, Overflow.dropNewest()), () -> idle);
    assertThat(drop.post(new Out("a", "1"))).isEqualTo(SendResult.ACCEPTED);
    assertThat(drop.post(new Out("b", "2"))).isEqualTo(SendResult.DROPPED);

    ConnectionRef<Out> keyed = ctx.connections().start(ConnectionSpec.of("keyed", Out.class).inbox(2, Overflow.coalesceByKey()), () -> idle);
    keyed.post(new Out("a", "1"));
    keyed.post(new Out("b", "1"));
    keyed.post(new Out("a", "2"));
    assertThat(new ArrayList<Object>(ctx.connectionTask("keyed").inbox())).as("replaced in place").containsExactly(new Out("a", "2"), new Out("b", "1"));
    keyed.post(new Out("c", "1"));
    assertThat(new ArrayList<Object>(ctx.connectionTask("keyed").inbox())).as("full: the oldest goes").containsExactly(new Out("b", "1"), new Out("c", "1"));
    drop.stop();
    keyed.stop();
  }

  @RepeatedTest(20)
  void stoppingEndsTheTaskFencesItAndFreesItsName() {
    var ctx = FakePluginContext.builder("cot").build();
    WorkerRef<Msg> w = worker(ctx);
    ConnectionRef<Out> out = ctx.connections().start(ConnectionSpec.of("tak-out", Out.class), () -> new Echo(w), w, Event::new);
    ctx.connectionTask("tak-out").awaitIdle();
    out.stop();
    ctx.connectionTask("tak-out").awaitIdle();
    ctx.runUntilIdle();
    assertThat(events()).last().isInstanceOf(ConnectionEvent.Stopped.class);
    assertThat(out.post(new Out("a", "late"))).isEqualTo(SendResult.CLOSED);
    assertThat(ctx.connections().names()).isEmpty();
    ctx.connections().start(ConnectionSpec.of("tak-out", Out.class), () -> new Echo(w)).stop();
  }

  @RepeatedTest(20)
  void aFailedRunRestartsWithTheBackoffAndAFreshTask() {
    var ctx = FakePluginContext.builder("cot").build();
    WorkerRef<Msg> w = worker(ctx);
    var made = new AtomicInteger();
    ConnectionRef<Out> out = ctx.connections().start(
        ConnectionSpec.of("tak-out", Out.class).restart(Restart.onFailure(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60)))),
        () -> {
          made.incrementAndGet();
          return new Echo(w);
        },
        w, Event::new);
    var task = ctx.connectionTask("tak-out");
    task.awaitIdle();
    task.fail("connection reset");
    task.awaitIdle();
    ctx.runUntilIdle();
    assertThat(events()).last().isInstanceOfSatisfying(ConnectionEvent.Restarting.class, r -> assertThat(r.reason()).contains("connection reset"));
    assertThat(task.state()).isEqualTo(FakeConnections.FakeTask.State.RESTARTING);
    out.post(new Out("a", "kept"));
    ctx.advance(Duration.ofSeconds(1));
    task.awaitIdle();
    ctx.runUntilIdle();
    assertThat(made.get()).as("a fresh task for the new run").isEqualTo(2);
    assertThat(task.restarts()).isEqualTo(1);
    assertThat(received).as("items posted while it restarted wait for the new run").contains(new Got("kept"));
    out.stop();
  }

  @Test
  void withoutARestartAThrowingRunFailsAndAReturningOneStops() {
    var ctx = FakePluginContext.builder("cot").build();
    WorkerRef<Msg> w = worker(ctx);
    ConnectionRef<Out> a = ctx.connections().start(ConnectionSpec.of("a", Out.class), () -> new Echo(w), w, Event::new);
    a.post(new Out("x", "boom"));
    ctx.connectionTask("a").awaitIdle();
    ctx.runUntilIdle();
    assertThat(events()).last().isInstanceOfSatisfying(ConnectionEvent.Failed.class, f -> assertThat(f.reason()).isEqualTo("boom"));
    ConnectionRef<Out> b = ctx.connections().start(ConnectionSpec.of("b", Out.class), () -> new Echo(w), w, Event::new);
    b.post(new Out("x", "end"));
    ctx.connectionTask("b").awaitIdle();
    ctx.runUntilIdle();
    assertThat(events()).last().isInstanceOf(ConnectionEvent.Stopped.class);
    assertThat(ctx.connectionTask("b").state()).isEqualTo(FakeConnections.FakeTask.State.STOPPED);
  }

  @Test
  void restartAlwaysRunsAgainAfterAReturnToo() {
    var ctx = FakePluginContext.builder("cot").build();
    WorkerRef<Msg> w = worker(ctx);
    ConnectionRef<Out> out = ctx.connections().start(
        ConnectionSpec.of("poller", Out.class).restart(Restart.always(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(2)))),
        () -> new Echo(w), w, Event::new);
    out.post(new Out("x", "end"));
    ctx.connectionTask("poller").awaitIdle();
    ctx.runUntilIdle();
    assertThat(events()).last().isInstanceOf(ConnectionEvent.Restarting.class);
    ctx.advance(Duration.ofSeconds(1));
    ctx.connectionTask("poller").awaitIdle();
    ctx.runUntilIdle();
    assertThat(events()).last().isInstanceOf(ConnectionEvent.Running.class);
    out.stop();
  }

  @Test
  void theCapCountsChildrenAndChildrenStopWithTheirParent() throws Exception {
    var ctx = FakePluginContext.builder("cot").maxConnectionTasks(2).build();
    ConnectionTask<Out> child = task -> task.take();
    ConnectionTask<Out> parent = task -> {
      task.startChild(ConnectionSpec.of("client", Out.class), () -> child);
      task.take();
    };
    ConnectionRef<Out> server = ctx.connections().start(ConnectionSpec.of("server", Out.class), () -> parent);
    ctx.connectionTask("server").awaitIdle();
    long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
    while (!ctx.connections().names().contains("server/client") && System.nanoTime() < deadline) {
      Thread.onSpinWait();
    }
    assertThat(ctx.connections().names()).containsExactly("server", "server/client");
    assertThatThrownBy(() -> ctx.connections().start(ConnectionSpec.of("third", Out.class), () -> child))
        .isInstanceOf(IllegalStateException.class).hasMessageContaining("children included");
    server.stop();
    ctx.connectionTask("server/client").awaitIdle();
    ctx.connectionTask("server").awaitIdle();
    ctx.runUntilIdle();
    assertThat(ctx.connections().names()).isEmpty();
  }

  @Test
  void tasksTheirFactoriesAndChildrenRunOnPlatformThreads() {
    // CR-0027: as in ECore, so that a test of a two-way link cannot hang on Windows (JDK-8334574).
    var ctx = FakePluginContext.builder("cot").build();
    var seen = new CopyOnWriteArrayList<String>();
    ConnectionTask<Out> parent = task -> {
      seen.add("task " + Thread.currentThread().isVirtual());
      task.startChild(ConnectionSpec.of("reader", Out.class), () -> {
        seen.add("child factory " + Thread.currentThread().isVirtual());
        return t -> {
          seen.add("child " + Thread.currentThread().isVirtual());
          t.take();
        };
      });
      task.take();
    };
    ConnectionRef<Out> ref = ctx.connections().start(ConnectionSpec.of("link", Out.class), () -> {
      seen.add("factory " + Thread.currentThread().isVirtual());
      return parent;
    });
    waitUntil(() -> seen.size() == 4);
    assertThat(seen).containsExactlyInAnyOrder("factory false", "task false", "child factory false", "child false");
    ref.stop();
    ctx.connectionTask("link/reader").awaitIdle();
    ctx.connectionTask("link").awaitIdle();
  }

  /** Waits, in real time, until a task's thread has done what {@code done} checks. */
  private static void waitUntil(BooleanSupplier done) {
    long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
    while (!done.getAsBoolean()) {
      assertThat(System.nanoTime()).as("waited too long").isLessThan(deadline);
      Thread.onSpinWait();
    }
  }

  @Test
  void aChildAtTheCapIsRefusedAndTheParentCarriesOn() {
    var ctx = FakePluginContext.builder("cot").maxConnectionTasks(1).build();
    var seen = new CopyOnWriteArrayList<String>();
    ConnectionTask<Out> server = task -> {
      try {
        task.startChild(ConnectionSpec.of("client-1", Out.class), () -> t -> t.take());
        seen.add("started");
      } catch (IllegalStateException atTheCap) {
        seen.add(String.valueOf(atTheCap.getMessage()));
        task.count("clients refused", 1);
      }
      task.take();
    };
    ConnectionRef<Out> ref = ctx.connections().start(ConnectionSpec.of("server", Out.class), () -> server);
    ctx.connectionTask("server").awaitIdle();
    assertThat(seen).singleElement().asString().contains("children included");
    assertThat(ctx.connectionTask("server").counter("clients refused")).isEqualTo(1);
    assertThat(ctx.connections().names()).containsExactly("server");
    ref.stop();
  }

  @RepeatedTest(20)
  void afterTheStopSendsAreDroppedAndWhatIsRegisteredClosesAtOnce() {
    var ctx = FakePluginContext.builder("cot").build();
    WorkerRef<Msg> w = worker(ctx);
    var seen = new CopyOnWriteArrayList<Object>();
    ConnectionTask<Out> t = task -> {
      seen.add(String.valueOf(task.take()));
      seen.add(task.send(w, new Got("late")));
      var closed = new AtomicBoolean();
      task.closeOnStop((AutoCloseable) () -> closed.set(true));
      seen.add(closed.get());
      seen.add(task.stopping());
    };
    ConnectionRef<Out> ref = ctx.connections().start(ConnectionSpec.of("tak-out", Out.class), () -> t);
    ctx.connectionTask("tak-out").awaitIdle();
    ref.stop();
    ctx.connectionTask("tak-out").awaitIdle();
    ctx.runUntilIdle();
    assertThat(seen).containsExactly("null", SendResult.CLOSED, true, true);
    assertThat(received).doesNotContain(new Got("late"));
  }

  @Test
  void theBackoffDoublesAndStartsAgainAfterALongEnoughRun() {
    var ctx = FakePluginContext.builder("cot").build();
    WorkerRef<Msg> w = worker(ctx);
    ConnectionRef<Out> ref = ctx.connections().start(
        ConnectionSpec.of("tak-out", Out.class).restart(Restart.onFailure(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(4)))),
        () -> new Echo(w), w, Event::new);
    var task = ctx.connectionTask("tak-out");
    var delays = new ArrayList<Duration>();
    for (int i = 0; i < 4; i++) {
      task.awaitIdle();
      ctx.runUntilIdle();
      if (i == 3) {
        ctx.advance(Duration.ofSeconds(4)); // this run lasts as long as the maximum
      }
      task.fail("reset " + i);
      task.awaitIdle();
      ctx.runUntilIdle();
      var restarting = (ConnectionEvent.Restarting) events().getLast();
      delays.add(Duration.between(restarting.at(), restarting.retryAt()));
      ctx.advance(delays.getLast());
    }
    assertThat(delays).containsExactly(Duration.ofSeconds(1), Duration.ofSeconds(2), Duration.ofSeconds(4), Duration.ofSeconds(1));
    assertThat(task.restarts()).isEqualTo(4);
    ref.stop();
  }

  @Test
  void pollWaitsAtMostItsTimeoutAndDetailsAndActivityAreShown() {
    var ctx = FakePluginContext.builder("cot").build();
    var seen = new CopyOnWriteArrayList<@Nullable Object>();
    ConnectionTask<Out> t = task -> {
      try {
        task.poll(Duration.ZERO);
      } catch (IllegalArgumentException tooShort) {
        seen.add("refused");
      }
      seen.add(String.valueOf(task.poll(Duration.ofMillis(5))));
      seen.add(String.valueOf(task.lastActivity()));
      task.detail("protocol", "cot");
      task.count("bytes out", 3);
      seen.add(task.lastActivity());
      seen.add(task.poll(Duration.ofSeconds(10)));
      task.take();
    };
    ConnectionRef<Out> ref = ctx.connections().start(ConnectionSpec.of("tak-out", Out.class), () -> t);
    waitUntil(() -> seen.size() == 4);
    var task = ctx.connectionTask("tak-out");
    task.awaitIdle();
    ref.post(new Out("a", "x"));
    waitUntil(() -> seen.size() == 5);
    assertThat(seen).containsExactly("refused", "null", "null", ctx.clock(), new Out("a", "x"));
    assertThat(task.details()).containsEntry("protocol", "cot");
    assertThat(task.counter("bytes out")).isEqualTo(3);
    ref.stop();
  }

  @RepeatedTest(20)
  void aStopWhileRestartingEndsTheTaskForGood() {
    var ctx = FakePluginContext.builder("cot").build();
    WorkerRef<Msg> w = worker(ctx);
    var made = new AtomicInteger();
    ConnectionRef<Out> ref = ctx.connections().start(
        ConnectionSpec.of("tak-out", Out.class).restart(Restart.onFailure(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(4)))),
        () -> {
          made.incrementAndGet();
          return new Echo(w);
        },
        w, Event::new);
    var task = ctx.connectionTask("tak-out");
    task.awaitIdle();
    task.fail("reset");
    task.awaitIdle();
    ctx.runUntilIdle();
    assertThat(task.state()).isEqualTo(FakeConnections.FakeTask.State.RESTARTING);
    ref.stop();
    ctx.runUntilIdle();
    assertThat(task.state()).isEqualTo(FakeConnections.FakeTask.State.STOPPED);
    assertThat(events()).last().isInstanceOf(ConnectionEvent.Stopped.class);
    ctx.advance(Duration.ofSeconds(5));
    ctx.runUntilIdle();
    assertThat(made.get()).as("no run after the stop").isEqualTo(1);
    assertThat(events()).filteredOn(e -> e instanceof ConnectionEvent.Stopped).hasSize(1);
    assertThat(ctx.connections().names()).isEmpty();
  }

  @RepeatedTest(20)
  void aParentThatRestartsStopsItsChildrenAndStartsThemAgain() {
    var ctx = FakePluginContext.builder("cot").build();
    ConnectionTask<Out> parent = task -> {
      task.startChild(ConnectionSpec.of("client-1", Out.class), () -> t -> t.take());
      task.take();
    };
    ConnectionRef<Out> ref = ctx.connections().start(
        ConnectionSpec.of("server", Out.class).restart(Restart.onFailure(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(4)))),
        () -> parent);
    var server = ctx.connectionTask("server");
    server.awaitIdle();
    var first = ctx.connectionTask("server/client-1");
    first.awaitIdle();
    server.fail("reset");
    server.awaitIdle();
    ctx.runUntilIdle();
    first.awaitIdle();
    ctx.runUntilIdle();
    assertThat(first.state()).isEqualTo(FakeConnections.FakeTask.State.STOPPED);
    assertThat(server.state()).isEqualTo(FakeConnections.FakeTask.State.RESTARTING);
    assertThat(ctx.connections().names()).containsExactly("server");
    ctx.advance(Duration.ofSeconds(1));
    server.awaitIdle();
    assertThat(ctx.connectionTask("server/client-1")).as("a fresh child for the new run").isNotSameAs(first);
    assertThat(ctx.connections().names()).containsExactly("server", "server/client-1");
    ref.stop();
  }

  /** A TCP server on loopback that counts its clients. */
  static final class Server implements ConnectionTask<Out> {
    @Override
    public void run(TaskContext<Out> task) throws IOException {
      var server = task.closeOnStop(new ServerSocket());
      server.bind(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0));
      task.listening(server.getLocalSocketAddress());
      while (!task.stopping()) {
        try (Socket client = server.accept()) {
          task.count("clients", 1);
          task.peer(client.getRemoteSocketAddress());
        }
      }
    }
  }

  @Test
  void aRealSocketOnLoopbackClosesWhenTheTaskStops() throws Exception {
    var ctx = FakePluginContext.builder("cot").build();
    ConnectionRef<Out> ref = ctx.connections().start(ConnectionSpec.of("listen", Out.class), Server::new);
    var task = ctx.connectionTask("listen");
    long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
    while (task.listening() == null && System.nanoTime() < deadline) {
      Thread.onSpinWait();
    }
    var at = (InetSocketAddress) task.listening();
    assertThat(at).isNotNull();
    assertThat(at.getAddress().isLoopbackAddress()).isTrue();
    try (var client = new Socket(at.getAddress(), at.getPort())) {
      while (task.counter("clients") == 0 && System.nanoTime() < deadline) {
        Thread.onSpinWait();
      }
    }
    assertThat(task.counter("clients")).isEqualTo(1);
    ref.stop();
    task.awaitIdle(); // the blocked accept ended because the registered socket closed
    ctx.runUntilIdle();
    assertThat(task.state()).isEqualTo(FakeConnections.FakeTask.State.STOPPED);
  }

  @Test
  void tlsNeedsCredentialsByName() throws Exception {
    var ctx = FakePluginContext.builder("cot").tlsCredentials("tak-north", javax.net.ssl.SSLContext.getDefault()).build();
    var seen = new ArrayList<String>();
    ConnectionTask<Out> t = task -> {
      seen.add(task.tls("tak-north") != null ? "factory" : "none");
      try {
        task.tls("unknown");
      } catch (IllegalArgumentException e) {
        seen.add("refused");
      }
    };
    ctx.connections().start(ConnectionSpec.of("tls", Out.class), () -> t);
    ctx.connectionTask("tls").awaitIdle();
    assertThat(seen).containsExactly("factory", "refused");
  }

  @Test
  void tlsRefusesExpiredAndUnreadableCredentialsAsECoreDoes() throws Exception {
    var ctx = FakePluginContext.builder("cot")
        .expiredTlsCredentials("tak-north", java.time.LocalDate.of(2026, 1, 31))
        .unreadableTlsCredentials("tak-south", "wrong password")
        .build();
    WorkerRef<Msg> w = worker(ctx);
    var seen = new ArrayList<String>();
    ConnectionTask<Out> t = task -> {
      for (String name : List.of("tak-north", "tak-south")) {
        try {
          task.tls(name);
        } catch (IllegalStateException e) {
          seen.add(e.getMessage());
        }
      }
      task.sslContext("tak-north"); // fails the start, as in ECore
    };
    ctx.connections().start(ConnectionSpec.of("tls", Out.class), () -> t, w, Event::new);
    ctx.connectionTask("tls").awaitIdle();
    ctx.runUntilIdle();
    assertThat(seen).containsExactly(
        "the TLS credential tak-north: its certificate expired on 2026-01-31",
        "the TLS credential tak-south cannot be read: wrong password");
    assertThat(events()).last().isInstanceOfSatisfying(ConnectionEvent.Failed.class, x -> assertThat(x.reason()).contains("expired on 2026-01-31"));
    assertThat(ctx.connectionTask("tls").state()).isEqualTo(FakeConnections.FakeTask.State.FAILED);
  }

  @Test
  void aCredentialSetUpLaterReplacesAnEarlierOne() throws Exception {
    var ctx = FakePluginContext.builder("cot")
        .expiredTlsCredentials("tak-north", java.time.LocalDate.of(2026, 1, 31))
        .tlsCredentials("tak-north", javax.net.ssl.SSLContext.getDefault())
        .build();
    var seen = new ArrayList<String>();
    ConnectionTask<Out> t = task -> seen.add(task.tls("tak-north") != null ? "factory" : "none");
    ctx.connections().start(ConnectionSpec.of("tls", Out.class), () -> t);
    ctx.connectionTask("tls").awaitIdle();
    assertThat(seen).containsExactly("factory");
  }

  @Test
  void aScriptedTaskContextRefusesExpiredAndUnreadableCredentials() {
    var task = FakeTaskContext.<Out>of("tak-out")
        .expiredTlsCredentials("tak-north", java.time.LocalDate.of(2026, 1, 31))
        .unreadableTlsCredentials("tak-south", "no such file");
    assertThatThrownBy(() -> task.tls("tak-north")).isInstanceOf(IllegalStateException.class)
        .hasMessage("the TLS credential tak-north: its certificate expired on 2026-01-31");
    assertThatThrownBy(() -> task.sslContext("tak-south")).isInstanceOf(IllegalStateException.class)
        .hasMessage("the TLS credential tak-south cannot be read: no such file");
    assertThatThrownBy(() -> task.tls("unknown")).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aTaskRunsAloneOnAScriptedContext() throws Exception {
    var task = FakeTaskContext.<Out>of("tak-out", new Out("a", "one"), new Out("b", "two"));
    WorkerRef<Msg> w = worker(FakePluginContext.builder("cot").build());
    task.run(new Echo(w));
    assertThat(task.sent()).extracting(FakeTaskContext.Sent::message).containsExactly(new Got("one"), new Got("two"));
    assertThat(task.counter("sent")).isEqualTo(2);
    task.stop();
    assertThat(task.take()).isNull();
    assertThat(task.send(w, new Got("late"))).isEqualTo(SendResult.CLOSED);
  }
}
