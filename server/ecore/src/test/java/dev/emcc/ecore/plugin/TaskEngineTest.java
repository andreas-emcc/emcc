package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.plugin.TaskEngine.Attempt;
import dev.emcc.ecore.plugin.TaskEngine.Change;
import dev.emcc.ecore.plugin.TaskEngine.Restart;
import dev.emcc.ecore.plugin.TaskEngine.RestartRule;
import dev.emcc.ecore.plugin.TaskEngine.State;
import dev.emcc.ecore.runtime.Inbox;
import dev.emcc.ecore.runtime.Overflow;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.SendOutcome;
import dev.emcc.ecore.runtime.WorkerRuntime;
import java.io.IOException;
import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * Connection tasks on ECore's engine (ADR-0036): real sockets on loopback, restarts, children, the
 * cap, fencing and the watch for a run that does not end after its stop.
 */
class TaskEngineTest {

  /**
   * The longest wait for what must happen: generous, since it costs nothing when the test passes and the
   * full build often runs beside other sessions' builds (it timed out at 10 s there; MCA, 2026-11-15).
   */
  private static final Duration WAIT = Duration.ofSeconds(30);
  private static final RestartRule ON_FAILURE = new RestartRule(Restart.ON_FAILURE, Duration.ofSeconds(60), n -> Duration.ofMillis(100));
  private static final RestartRule ALWAYS = new RestartRule(Restart.ALWAYS, Duration.ofSeconds(60), n -> Duration.ofMillis(100));

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final LinkedBlockingQueue<String> watched = new LinkedBlockingQueue<>();
  private final TaskEngine.Watch watch = new TaskEngine.Watch() {
    @Override
    public void notEnding(String name) {
      watched.add("not ending " + name);
    }

    @Override
    public void ended(String name) {
      watched.add("ended " + name);
    }
  };
  private final TaskEngine engine = new TaskEngine("cot", null, runtime, 3, Clock.systemUTC(), watch, Duration.ofMillis(300));
  private final LinkedBlockingQueue<Change> changes = new LinkedBlockingQueue<>();

  @AfterEach
  void close() {
    engine.stopAll();
    runtime.close();
  }

  private static Inbox<String> inbox() {
    return new Inbox<>(100, Overflow.DROP_NEWEST);
  }

  private Change next() throws InterruptedException {
    Change change = changes.poll(WAIT.toSeconds(), TimeUnit.SECONDS);
    assertThat(change).as(() -> "a change within " + WAIT + "; " + diagnosis()).isNotNull();
    return change;
  }

  private <C extends Change> C next(Class<C> type) throws InterruptedException {
    Change change = next();
    assertThat(change).isInstanceOf(type);
    return type.cast(change);
  }

  @Test
  void aTcpClientTaskSendsWhatWorkersPostAndEndsWhenStopped() throws Exception {
    try (ServerSocket peer = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
      Inbox<String> inbox = inbox();
      TaskEngine.Task task = engine.start("tak-out", null, inbox, ON_FAILURE, () -> attempt -> {
        Socket socket = attempt.closeOnStop(new Socket());
        socket.connect(new InetSocketAddress(InetAddress.getLoopbackAddress(), peer.getLocalPort()), 5_000);
        attempt.task.peer(String.valueOf(socket.getRemoteSocketAddress()));
        for (Object item; (item = attempt.take()) != null; ) {
          socket.getOutputStream().write((item + "\n").getBytes(StandardCharsets.UTF_8));
          attempt.task.count("sent", 1);
        }
      }, changes::add);
      next(Change.Running.class);

      try (Socket accepted = peer.accept()) {
        inbox.offer("<event uid=\"a\"/>", null); // as a worker posts, never blocking
        inbox.offer("<event uid=\"b\"/>", null);
        byte[] expected = "<event uid=\"a\"/>\n<event uid=\"b\"/>\n".getBytes(StandardCharsets.UTF_8);
        byte[] got = accepted.getInputStream().readNBytes(expected.length);
        assertThat(new String(got, StandardCharsets.UTF_8)).isEqualTo(new String(expected, StandardCharsets.UTF_8));

        waitUntil(() -> Long.valueOf(2).equals(task.stats().counters().get("sent"))); // counted after the write
        assertThat(task.stats().peer()).contains(String.valueOf(peer.getLocalPort()));
        assertThat(task.lastActivity()).isNotNull();

        task.stop();
        next(Change.Stopped.class);
        assertThat(accepted.getInputStream().read()).as("the socket was closed").isEqualTo(-1);
        assertThat(inbox.offer("late", null)).isEqualTo(SendOutcome.CLOSED);
        assertThat(engine.stats()).isEmpty();
      }
    }
  }

  @Test
  void stoppingEndsABlockedReadOnARegisteredSocket() throws Exception {
    try (ServerSocket peer = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
      CountDownLatch reading = new CountDownLatch(1);
      TaskEngine.Task task = engine.start("tak-in", null, inbox(), ON_FAILURE, () -> attempt -> {
        Socket socket = attempt.closeOnStop(new Socket());
        socket.connect(new InetSocketAddress(InetAddress.getLoopbackAddress(), peer.getLocalPort()), 5_000);
        InputStream in = socket.getInputStream();
        reading.countDown();
        in.read(); // the peer never writes
      }, changes::add);
      next(Change.Running.class);
      try (Socket accepted = peer.accept()) {
        assertThat(reading.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();

        task.stop();

        next(Change.Stopped.class);
        assertThat(watched).as("it ended at once").isEmpty();
      }
    }
  }

  @Test
  void aUdpTaskReceivesDatagramsOnLoopbackUntilItsSocketIsClosed() throws Exception {
    LinkedBlockingQueue<String> received = new LinkedBlockingQueue<>();
    LinkedBlockingQueue<Integer> port = new LinkedBlockingQueue<>();
    TaskEngine.Task task = engine.start("udp-in", null, inbox(), ON_FAILURE, () -> attempt -> {
      DatagramSocket socket = attempt.closeOnStop(new DatagramSocket(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0)));
      attempt.task.listening(String.valueOf(socket.getLocalSocketAddress()));
      port.add(socket.getLocalPort());
      byte[] buffer = new byte[1500];
      while (!attempt.stopping()) {
        DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
        socket.receive(packet);
        received.add(new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8));
      }
    }, changes::add);
    Integer bound = port.poll(WAIT.toSeconds(), TimeUnit.SECONDS);
    assertThat(bound).isNotNull();
    try (DatagramSocket sender = new DatagramSocket()) {
      byte[] data = "<event uid=\"u\"/>".getBytes(StandardCharsets.UTF_8);
      sender.send(new DatagramPacket(data, data.length, InetAddress.getLoopbackAddress(), bound));
    }

    assertThat(received.poll(WAIT.toSeconds(), TimeUnit.SECONDS)).isEqualTo("<event uid=\"u\"/>");
    assertThat(task.stats().listening()).as("loopback").contains("127.0.0.1");
    task.stop();
    next(Change.Running.class);
    next(Change.Stopped.class);
  }

  @Test
  void aFailingRunIsRestartedAfterItsDelayAndCounted() throws Exception {
    AtomicInteger runs = new AtomicInteger();
    CountDownLatch third = new CountDownLatch(1);
    TaskEngine.Task task = engine.start("tak-north", null, inbox(), ON_FAILURE, () -> attempt -> {
      if (runs.incrementAndGet() < 3) {
        throw new IOException("connection refused");
      }
      third.countDown();
      attempt.take(); // waits until stopped
    }, changes::add);

    next(Change.Running.class);
    Change.Restarting first = next(Change.Restarting.class);
    assertThat(first.reason()).contains("connection refused");
    assertThat(Duration.between(first.at(), first.next())).isGreaterThanOrEqualTo(RetryDelay.MIN);
    next(Change.Running.class);
    next(Change.Restarting.class);
    next(Change.Running.class);
    assertThat(third.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();
    assertThat(task.stats().restarts()).isEqualTo(2);
    assertThat(task.state()).isEqualTo(State.RUNNING);
  }

  @Test
  void theRestartRuleDecidesWhatFollowsARunThatReturnedOrThrew() throws Exception {
    engine.start("returns-never", null, inbox(), RestartRule.never(), () -> attempt -> {}, changes::add);
    next(Change.Running.class);
    next(Change.Stopped.class);

    engine.start("throws-never", null, inbox(), RestartRule.never(), () -> attempt -> {
      throw new IllegalStateException("bad settings");
    }, changes::add);
    next(Change.Running.class);
    assertThat(next(Change.Failed.class).reason()).contains("bad settings");

    engine.start("returns-on-failure", null, inbox(), ON_FAILURE, () -> attempt -> {}, changes::add);
    next(Change.Running.class);
    next(Change.Stopped.class);

    AtomicInteger runs = new AtomicInteger();
    TaskEngine.Task always = engine.start("returns-always", null, inbox(), ALWAYS, () -> attempt -> runs.incrementAndGet(), changes::add);
    next(Change.Running.class);
    assertThat(next(Change.Restarting.class).reason()).isEqualTo("the task returned");
    next(Change.Running.class);
    waitUntil(() -> runs.get() >= 2); // the Running change comes before the run's body
    always.stop();
    assertThat(engine.stats()).extracting(TaskEngine.Stats::name).doesNotContain("returns-never", "returns-on-failure");
    assertThat(engine.stats()).filteredOn(st -> st.name().equals("throws-never")).singleElement()
        .satisfies(st -> assertThat(st.state()).as("its failure is kept for the monitor").isEqualTo(State.FAILED));
  }

  @Test
  void namesAreUniqueAndThePluginHasACapChildrenIncluded() throws Exception {
    CountDownLatch child = new CountDownLatch(1);
    engine.start("a", null, inbox(), ON_FAILURE, () -> attempt -> {
      engine.start("a/client-1", attempt, inbox(), RestartRule.never(), () -> c -> c.take(), changes::add);
      child.countDown();
      attempt.take();
    }, changes::add);
    assertThat(child.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();

    assertThatThrownBy(() -> engine.start("a", null, inbox(), ON_FAILURE, () -> attempt -> {}, changes::add))
        .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("running already");
    engine.start("b", null, inbox(), ON_FAILURE, () -> Attempt::take, changes::add);
    assertThatThrownBy(() -> engine.start("c", null, inbox(), ON_FAILURE, () -> attempt -> {}, changes::add))
        .isInstanceOf(IllegalStateException.class).hasMessageContaining("3 connection tasks, the most it may have");
  }

  @Test
  void childrenStopWithTheirParentAndWhenItsRunEnds() throws Exception {
    List<String> started = new CopyOnWriteArrayList<>();
    AtomicInteger runs = new AtomicInteger();
    CountDownLatch secondRun = new CountDownLatch(1);
    TaskEngine.Task parent = engine.start("tak-server", null, inbox(), ON_FAILURE, () -> attempt -> {
      int run = runs.incrementAndGet();
      String name = "tak-server/client-" + run;
      engine.start(name, attempt, inbox(), RestartRule.never(), () -> Attempt::take, c -> {});
      started.add(name);
      if (run == 1) {
        throw new IOException("accept failed"); // the run ends: its child stops
      }
      secondRun.countDown();
      attempt.take();
    }, changes::add);
    assertThat(secondRun.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();
    waitUntil(() -> engine.stats().stream().noneMatch(s -> s.name().equals("tak-server/client-1")));
    assertThat(engine.stats()).extracting(TaskEngine.Stats::name).contains("tak-server", "tak-server/client-2");

    parent.stop();

    waitUntil(() -> engine.stats().isEmpty());
    assertThat(started).containsExactly("tak-server/client-1", "tak-server/client-2");
  }

  @Test
  void aStoppedRunIsFencedAndWhatItRegistersAfterwardsIsClosedAtOnce() throws Exception {
    LinkedBlockingQueue<Attempt> attempts = new LinkedBlockingQueue<>();
    TaskEngine.Task task = engine.start("t", null, inbox(), ON_FAILURE, () -> attempt -> {
      attempts.add(attempt);
      attempt.take();
    }, changes::add);
    Attempt attempt = attempts.poll(WAIT.toSeconds(), TimeUnit.SECONDS);
    assertThat(attempt).isNotNull();
    assertThat(attempt.stopping()).isFalse();

    task.stop();
    next(Change.Running.class);
    next(Change.Stopped.class);

    assertThat(attempt.stopping()).isTrue();
    assertThat(attempt.take()).isNull();
    try (ServerSocket late = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
      attempt.closeOnStop(late);
      assertThat(late.isClosed()).isTrue();
    }
    assertThatThrownBy(() -> engine.start("t/child", attempt, inbox(), RestartRule.never(), () -> a -> {}, c -> {}))
        .isInstanceOf(IllegalStateException.class).hasMessageContaining("has ended");
    assertThat(engine.stats()).isEmpty();
  }

  @Test
  void aRunThatDoesNotEndAfterItsStopIsReportedAndItsSuccessorWaitsForIt() throws Exception {
    CountDownLatch release = new CountDownLatch(1);
    CountDownLatch running = new CountDownLatch(1);
    TaskEngine.Task task = engine.start("stuck", null, inbox(), ON_FAILURE, () -> attempt -> {
      running.countDown();
      release.await(); // blocks on something it never registered
    }, changes::add);
    assertThat(running.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();
    next(Change.Running.class);

    task.stop();

    awaitWatched("not ending stuck");
    assertThat(task.stats().notEnding()).isTrue();
    assertThat(task.state()).isEqualTo(State.STOPPING);
    // The name is free (SDK ConnectionRef.stop), but the successor's first run waits for the old one.
    LinkedBlockingQueue<Change> successor = new LinkedBlockingQueue<>();
    TaskEngine.Task next = engine.start("stuck", null, inbox(), ON_FAILURE, () -> Attempt::take, successor::add);
    Thread.sleep(300);
    assertThat(successor).as("it has not run beside the old one").isEmpty();
    assertThat(next.state()).isEqualTo(State.STARTING);
    assertThat(engine.stats()).extracting(TaskEngine.Stats::state).containsExactly(State.STOPPING, State.STARTING);
    // The stopped one no longer counts toward the cap (3): the successor and two others do.
    TaskEngine.Task x = engine.start("x", null, inbox(), ON_FAILURE, () -> Attempt::take, c -> {});
    TaskEngine.Task y = engine.start("y", null, inbox(), ON_FAILURE, () -> Attempt::take, c -> {});
    assertThatThrownBy(() -> engine.start("z", null, inbox(), ON_FAILURE, () -> Attempt::take, c -> {}))
        .isInstanceOf(IllegalStateException.class).hasMessageContaining("the most it may have");
    x.stop();
    y.stop();

    release.countDown();
    awaitWatched("ended stuck");
    next(Change.Stopped.class);
    assertThat(successor.poll(WAIT.toSeconds(), TimeUnit.SECONDS)).isInstanceOf(Change.Running.class);
    next.stop();
    assertThat(successor.poll(WAIT.toSeconds(), TimeUnit.SECONDS)).isInstanceOf(Change.Stopped.class);
    waitUntil(() -> engine.stats().isEmpty());
  }

  /** C7 gap 1: start and stop a name again and again behind a hung run: no thread waits, and one task at most waits. */
  @Test
  void startsAndStopsBehindAHungRunNeedNoThreadAndNoPile() throws Exception {
    List<String> threadNames = new java.util.concurrent.CopyOnWriteArrayList<>();
    TaskEngine counted = new TaskEngine("cot", null, runtime, 3, Clock.systemUTC(), watch, Duration.ofMillis(300), (name, loader, body) -> {
      threadNames.add(name);
      return runtime.startTaskThread(name, loader, body);
    });
    try {
      CountDownLatch release = new CountDownLatch(1);
      CountDownLatch running = new CountDownLatch(1);
      TaskEngine.Task hung = counted.start("render", null, inbox(), ON_FAILURE, () -> attempt -> {
        running.countDown();
        release.await(); // registered nothing a stop could close
      }, changes::add);
      assertThat(running.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();
      next(Change.Running.class);
      hung.stop();
      awaitWatched("not ending render");

      LinkedBlockingQueue<Change> later = new LinkedBlockingQueue<>();
      for (int i = 0; i < 10; i++) {
        TaskEngine.Task again = counted.start("render", null, inbox(), ON_FAILURE, () -> Attempt::take, later::add);
        again.stop();
        assertThat(later.poll(WAIT.toSeconds(), TimeUnit.SECONDS)).as("its Stopped at once").isInstanceOf(Change.Stopped.class);
      }
      TaskEngine.Task last = counted.start("render", null, inbox(), ON_FAILURE, () -> Attempt::take, later::add);
      Thread.sleep(300);
      assertThat(threadNames).filteredOn(n -> n.equals("ecore-task-cot/render")).as("only the hung run's thread").hasSize(1);
      assertThat(counted.stats()).extracting(TaskEngine.Stats::name).as("the hung one and the newest; no pile")
          .containsExactly("render", "render");
      assertThat(later).as("not beside the hung one").isEmpty();
      assertThat(hung.waiting()).as("one wait registered on the hung run, not one per start (review R3)").isEqualTo(1);

      release.countDown();
      next(Change.Stopped.class);
      assertThat(later.poll(WAIT.toSeconds(), TimeUnit.SECONDS)).isInstanceOf(Change.Running.class);
      assertThat(threadNames).filteredOn(n -> n.equals("ecore-task-cot/render")).hasSize(2);
      last.stop();
      assertThat(later.poll(WAIT.toSeconds(), TimeUnit.SECONDS)).isInstanceOf(Change.Stopped.class);
      waitUntil(() -> counted.stats().isEmpty());
    } finally {
      counted.stopAll();
    }
  }

  /** C7 gap 6: a restarted plugin's engine lets a task of a name wait for the last start's hung run of it. */
  @Test
  void aRestartedPluginsTaskWaitsForTheLastStartsHungRunOfItsName() throws Exception {
    TaskEngine before = new TaskEngine("cot", null, runtime, 3, Clock.systemUTC(), watch, Duration.ofMillis(300));
    TaskEngine after = new TaskEngine("cot", null, runtime, 2, Clock.systemUTC(), watch, Duration.ofMillis(300));
    try {
      CountDownLatch release = new CountDownLatch(1);
      CountDownLatch running = new CountDownLatch(1);
      before.start("render", null, inbox(), ON_FAILURE, () -> attempt -> {
        running.countDown();
        release.await();
      }, changes::add);
      before.start("other", null, inbox(), ON_FAILURE, () -> Attempt::take, c -> {});
      assertThat(running.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();
      next(Change.Running.class);
      before.stopAll(); // the plugin stops; its render run hangs on

      after.inheritFrom(before.unended());
      LinkedBlockingQueue<Change> renderAgain = new LinkedBlockingQueue<>();
      LinkedBlockingQueue<Change> otherAgain = new LinkedBlockingQueue<>();
      TaskEngine.Task filler = after.start("filler", null, inbox(), ON_FAILURE, () -> Attempt::take, c -> {});
      after.start("other", null, inbox(), ON_FAILURE, () -> Attempt::take, otherAgain::add);
      assertThatThrownBy(() -> after.start("render", null, inbox(), ON_FAILURE, () -> Attempt::take, renderAgain::add))
          .as("at the cap").isInstanceOf(IllegalStateException.class);
      filler.stop();
      TaskEngine.Task render = after.start("render", null, inbox(), ON_FAILURE, () -> Attempt::take, renderAgain::add);
      assertThat(otherAgain.poll(WAIT.toSeconds(), TimeUnit.SECONDS)).as("a name whose run ended starts at once")
          .isInstanceOf(Change.Running.class);
      Thread.sleep(300);
      assertThat(renderAgain).as("not beside the last start's hung run").isEmpty();
      assertThat(render.state()).as("a refused start did not use up the last start's run (review R1)").isEqualTo(State.STARTING);

      release.countDown();
      assertThat(renderAgain.poll(WAIT.toSeconds(), TimeUnit.SECONDS)).isInstanceOf(Change.Running.class);
    } finally {
      after.stopAll();
    }
  }

  @Test
  void aNameCanBeUsedAgainAtOnceAfterItsTaskIsStopped() throws Exception {
    for (int i = 0; i < 20; i++) { // a link's settings changed: stop it, start it again
      TaskEngine.Task task = engine.start("tak-north", null, inbox(), ON_FAILURE, () -> attempt -> {
        attempt.take();
        Thread.sleep(5); // ends a moment after its stop
      }, changes::add);
      task.stop();
    }
    TaskEngine.Task last = engine.start("tak-north", null, inbox(), ON_FAILURE, () -> Attempt::take, changes::add);

    waitUntil(() -> engine.stats().size() == 1 && engine.stats().getFirst().state() == State.RUNNING);
    last.stop();
    waitUntil(() -> engine.stats().isEmpty());
    int running = 0;
    int stopped = 0;
    for (Change c; (c = changes.poll(1, TimeUnit.SECONDS)) != null; ) {
      if (c instanceof Change.Running) {
        running++;
        assertThat(running - stopped).as("never two runs of the name at once").isLessThanOrEqualTo(1);
      } else if (c instanceof Change.Stopped) {
        stopped++;
      }
    }
    assertThat(stopped).isEqualTo(21);
  }

  @Test
  void aStopWhileTheFactoryRunsEndsTheRunAsSoonAsItBegins() throws Exception {
    CountDownLatch inFactory = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    LinkedBlockingQueue<Boolean> sawStopping = new LinkedBlockingQueue<>();
    TaskEngine.Task task = engine.start("t", null, inbox(), ON_FAILURE, () -> {
      inFactory.countDown();
      try {
        release.await(WAIT.toSeconds(), TimeUnit.SECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
      return attempt -> {
        sawStopping.add(attempt.stopping());
        attempt.take();
      };
    }, changes::add);
    assertThat(inFactory.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();

    task.stop();
    release.countDown();

    assertThat(sawStopping.poll(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();
    next(Change.Running.class);
    next(Change.Stopped.class);
  }

  @Test
  void aStopWhileARestartWaitsEndsTheTaskWithoutAnotherRun() throws Exception {
    RestartRule slow = new RestartRule(Restart.ON_FAILURE, Duration.ofSeconds(60), n -> Duration.ofSeconds(30));
    AtomicInteger runs = new AtomicInteger();
    TaskEngine.Task task = engine.start("t", null, inbox(), slow, () -> attempt -> {
      runs.incrementAndGet();
      throw new IOException("refused");
    }, changes::add);
    next(Change.Running.class);
    next(Change.Restarting.class);
    assertThat(task.state()).isEqualTo(State.RESTARTING);

    task.stop();
    task.stop(); // a second stop has no effect

    next(Change.Stopped.class);
    assertThat(changes.poll(300, TimeUnit.MILLISECONDS)).as("exactly one final change").isNull();
    assertThat(runs.get()).isEqualTo(1);
    assertThat(engine.stats()).isEmpty();
  }

  @Test
  void endedChildrenLeaveTheirParentsRunSoALongRunDoesNotCollectThem() throws Exception {
    LinkedBlockingQueue<Attempt> runs = new LinkedBlockingQueue<>();
    CountDownLatch done = new CountDownLatch(1);
    engine.start("tak-server", null, inbox(), ON_FAILURE, () -> attempt -> {
      runs.add(attempt);
      for (int i = 1; i <= 300; i++) { // clients that come and go
        String name = "tak-server/client-" + i;
        engine.start(name, attempt, inbox(), RestartRule.never(), () -> child -> {}, c -> {});
        long end = System.nanoTime() + WAIT.toNanos();
        while (engine.stats().stream().anyMatch(s -> s.name().equals(name))) {
          if (System.nanoTime() > end) {
            throw new IllegalStateException(name + " did not end");
          }
          Thread.sleep(1);
        }
      }
      done.countDown();
      attempt.take();
    }, changes::add);
    Attempt server = runs.poll(WAIT.toSeconds(), TimeUnit.SECONDS);
    assertThat(server).isNotNull();

    assertThat(done.await(60, TimeUnit.SECONDS)).isTrue();
    assertThat(server.children()).isZero();
  }

  @Test
  void noTaskOutlivesThePluginsStopWhenStartsRaceIt() throws Exception {
    TaskEngine big = new TaskEngine("cot", null, runtime, 1_000, Clock.systemUTC(), watch, Duration.ofMillis(300));
    AtomicInteger started = new AtomicInteger();
    List<Thread> starters = new java.util.ArrayList<>();
    for (int t = 0; t < 4; t++) {
      int thread = t;
      starters.add(Thread.ofVirtual().start(() -> {
        for (int i = 0; i < 200; i++) {
          try {
            big.start("t" + thread + "-" + i, null, inbox(), ON_FAILURE, () -> Attempt::take, c -> {});
            started.incrementAndGet();
          } catch (IllegalStateException e) {
            return; // the plugin is stopping
          }
        }
      }));
    }
    waitUntil(() -> started.get() >= 8); // the starters are under way

    big.stopAll();
    for (Thread starter : starters) {
      starter.join(WAIT.toMillis());
    }

    waitUntil(() -> big.stats().isEmpty());
    assertThat(started.get()).isPositive();
    assertThatThrownBy(() -> big.start("late", null, inbox(), ON_FAILURE, () -> Attempt::take, c -> {}))
        .isInstanceOf(IllegalStateException.class).hasMessageContaining("is stopping");
  }

  @Test
  void aSuccessorStoppedWhileItWaitsKeepsTheOrderForTheNextOne() throws Exception {
    CountDownLatch release = new CountDownLatch(1);
    CountDownLatch running = new CountDownLatch(1);
    TaskEngine.Task z = engine.start("link", null, inbox(), ON_FAILURE, () -> attempt -> {
      running.countDown();
      release.await(); // stuck: registered nothing
    }, changes::add);
    assertThat(running.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();
    next(Change.Running.class);
    z.stop();

    LinkedBlockingQueue<Change> aChanges = new LinkedBlockingQueue<>();
    Inbox<String> aInbox = inbox();
    TaskEngine.Task a = engine.start("link", null, aInbox, ON_FAILURE, () -> Attempt::take, aChanges::add);
    a.stop(); // while it waits for z

    assertThat(aChanges.poll(1, TimeUnit.SECONDS)).as("its Stopped change at once").isInstanceOf(Change.Stopped.class);
    assertThat(aInbox.offer("late", null)).as("its inbox is closed at once").isEqualTo(SendOutcome.CLOSED);
    assertThat(engine.stats()).as("the pile-up behind the stuck run shows (R1)").filteredOn(st -> st.state() == State.STOPPED)
        .singleElement().satisfies(st -> assertThat(st.reason()).isEqualTo(TaskEngine.WAITING));
    LinkedBlockingQueue<Change> bChanges = new LinkedBlockingQueue<>();
    TaskEngine.Task b = engine.start("link", null, inbox(), ON_FAILURE, () -> Attempt::take, bChanges::add);
    Thread.sleep(300);
    assertThat(bChanges).as("b never runs beside the stuck z").isEmpty();
    assertThat(b.state()).isEqualTo(State.STARTING);
    // Neither z nor a (both stopped) counts toward the cap (3); b does, and two more fit.
    TaskEngine.Task c = engine.start("c", null, inbox(), ON_FAILURE, () -> Attempt::take, x -> {});
    TaskEngine.Task d = engine.start("d", null, inbox(), ON_FAILURE, () -> Attempt::take, x -> {});
    assertThatThrownBy(() -> engine.start("e", null, inbox(), ON_FAILURE, () -> Attempt::take, x -> {}))
        .isInstanceOf(IllegalStateException.class).hasMessageContaining("the most it may have");
    c.stop();
    d.stop();

    release.countDown();
    next(Change.Stopped.class); // z
    assertThat(bChanges.poll(WAIT.toSeconds(), TimeUnit.SECONDS)).isInstanceOf(Change.Running.class);
    assertThat(aChanges.poll(200, TimeUnit.MILLISECONDS)).as("a never ran").isNull();
    b.stop();
    waitUntil(() -> engine.stats().isEmpty());
  }

  @Test
  @org.junit.jupiter.api.Timeout(120) // a broken contract fails, not hangs (review R5)
  void aCloseThatThrowsAnErrorStillLetsTheOthersCloseAndTheTaskEnd() throws Exception {
    // No socket (flaky under load since M8, not reproduced in 40 runs on busy cores; MCA, 2026-11-17): the run blocks
    // on what only its second registered close opens, so the task ends only if that close runs after the first threw.
    CountDownLatch blocked = new CountDownLatch(1);
    CountDownLatch opened = new CountDownLatch(1);
    java.util.concurrent.atomic.AtomicBoolean secondClosed = new java.util.concurrent.atomic.AtomicBoolean();
    TaskEngine.Task task = engine.start("t", null, inbox(), RestartRule.never(), () -> attempt -> {
      attempt.closeOnStop(() -> {
        throw new AssertionError("a plugin's close that fails");
      });
      attempt.closeOnStop(() -> {
        secondClosed.set(true);
        opened.countDown();
      });
      blocked.countDown();
      opened.await(); // a blocking call that only the second close ends, as a socket's read
    }, changes::add);
    next(Change.Running.class);
    assertThat(blocked.await(WAIT.toSeconds(), TimeUnit.SECONDS)).as(() -> "the run blocks; " + diagnosis()).isTrue();

    task.stop();

    next(Change.Stopped.class);
    assertThat(secondClosed).as("closed after the failing close").isTrue();
  }

  @Test
  void thePluginsStopWaitsForWhatTheRunsRegisteredToBeClosed() throws Exception {
    java.util.concurrent.atomic.AtomicBoolean closed = new java.util.concurrent.atomic.AtomicBoolean();
    CountDownLatch registered = new CountDownLatch(1);
    engine.start("t", null, inbox(), ON_FAILURE, () -> attempt -> {
      attempt.closeOnStop(() -> {
        Thread.sleep(300); // a close that takes a moment
        closed.set(true);
      });
      registered.countDown();
      attempt.take();
    }, changes::add);
    assertThat(registered.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();

    engine.stopAll();

    assertThat(closed).as("closed before stopAll returns, so before the class loader goes").isTrue();
  }

  @Test
  void thePluginsStopEndsASuccessorThatWaits() throws Exception {
    CountDownLatch release = new CountDownLatch(1);
    CountDownLatch running = new CountDownLatch(1);
    TaskEngine.Task z = engine.start("link", null, inbox(), ON_FAILURE, () -> attempt -> {
      running.countDown();
      release.await();
    }, changes::add);
    assertThat(running.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();
    z.stop();
    LinkedBlockingQueue<Change> aChanges = new LinkedBlockingQueue<>();
    engine.start("link", null, inbox(), ON_FAILURE, () -> Attempt::take, aChanges::add);

    engine.stopAll();

    assertThat(aChanges.poll(WAIT.toSeconds(), TimeUnit.SECONDS)).isInstanceOf(Change.Stopped.class);
    release.countDown();
    waitUntil(() -> engine.stats().isEmpty());
    assertThat(aChanges.poll(200, TimeUnit.MILLISECONDS)).as("it never ran").isNull();
  }

  @Test
  void aFailedTaskStaysVisibleUntilANewTaskOfItsNameStartsOrThePluginStops() throws Exception {
    for (int i = 1; i <= TaskEngine.MAX_FAILURES + 5; i++) {
      engine.start("udp-" + i, null, inbox(), RestartRule.never(), () -> attempt -> {
        throw new java.net.BindException("Address already in use");
      }, changes::add);
      next(Change.Running.class);
      next(Change.Failed.class);
    }

    waitUntil(() -> engine.stats().size() == TaskEngine.MAX_FAILURES);
    assertThat(engine.stats()).extracting(TaskEngine.Stats::name).as("the oldest are dropped").doesNotContain("udp-1", "udp-5")
        .contains("udp-6", "udp-25");
    assertThat(engine.stats()).allSatisfy(st -> {
      assertThat(st.state()).isEqualTo(State.FAILED);
      assertThat(st.reason()).contains("Address already in use");
    });
    // Failures do not count toward the cap (3).
    TaskEngine.Task again = engine.start("udp-25", null, inbox(), ON_FAILURE, () -> Attempt::take, changes::add);
    engine.start("x", null, inbox(), ON_FAILURE, () -> Attempt::take, c -> {});
    engine.start("y", null, inbox(), ON_FAILURE, () -> Attempt::take, c -> {});
    assertThat(engine.stats()).filteredOn(st -> st.name().equals("udp-25")).as("the new task replaces the failure")
        .singleElement().satisfies(st -> assertThat(st.state()).isNotEqualTo(State.FAILED));
    assertThat(again).isNotNull();

    engine.stopAll();

    waitUntil(() -> engine.stats().isEmpty());
  }

  @Test
  void aTaskOfTheNameMayStartAsSoonAsTheFailureIsOutBeforeTheOldRunHasReleasedTheName() throws Exception {
    // The race behind a flaky run (MCA, 2026-11-11): the Failed change goes out, then the run's thread
    // releases the name. Here the listener holds that window open while another thread starts the name.
    AtomicReference<Object> started = new AtomicReference<>();
    engine.start("udp-1", null, inbox(), RestartRule.never(), () -> attempt -> {
      throw new java.net.BindException("Address already in use");
    }, change -> {
      changes.add(change);
      if (change instanceof Change.Failed) {
        Thread starter = new Thread(() -> {
          try {
            started.set(engine.start("udp-1", null, inbox(), ON_FAILURE, () -> Attempt::take, changes::add));
          } catch (RuntimeException e) {
            started.set(e);
          }
        });
        starter.start();
        try {
          starter.join(300); // with the fix it waits for this task's monitor, so it finishes after the release
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
        }
      }
    });
    next(Change.Running.class);
    next(Change.Failed.class);

    waitUntil(() -> started.get() != null);
    assertThat(started.get()).as("not refused as running already").isInstanceOf(TaskEngine.Task.class);
    next(Change.Running.class);
    assertThat(engine.stats()).filteredOn(st -> st.name().equals("udp-1")).singleElement()
        .satisfies(st -> assertThat(st.state()).isNotEqualTo(State.FAILED));
    engine.stopAll();
    waitUntil(() -> engine.stats().isEmpty());
  }

  @Test
  void aChildsFailureIsNotKeptAndARefusedStartKeepsTheOldFailure() throws Exception {
    engine.start("link", null, inbox(), RestartRule.never(), () -> attempt -> {
      throw new IOException("refused");
    }, changes::add);
    next(Change.Running.class);
    next(Change.Failed.class);
    CountDownLatch childFailed = new CountDownLatch(1);
    TaskEngine.Task server = engine.start("server", null, inbox(), ON_FAILURE, () -> attempt -> {
      engine.start("server/client-1", attempt, inbox(), RestartRule.never(), () -> child -> {
        throw new IOException("connection reset by peer"); // a client goes: not a problem of the plugin
      }, c -> {
        if (c instanceof Change.Failed) {
          childFailed.countDown();
        }
      });
      attempt.take();
    }, changes::add);
    assertThat(childFailed.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();

    waitUntil(() -> engine.stats().stream().noneMatch(st -> st.name().equals("server/client-1")));
    assertThat(engine.stats()).filteredOn(st -> st.state() == State.FAILED).extracting(TaskEngine.Stats::name).containsExactly("link");
    // At the cap (3: server and two more), a refused start of "link" keeps its failure.
    engine.start("x", null, inbox(), ON_FAILURE, () -> Attempt::take, c -> {});
    engine.start("y", null, inbox(), ON_FAILURE, () -> Attempt::take, c -> {});
    assertThatThrownBy(() -> engine.start("link", null, inbox(), ON_FAILURE, () -> Attempt::take, c -> {}))
        .isInstanceOf(IllegalStateException.class);
    assertThat(engine.stats()).filteredOn(st -> st.state() == State.FAILED).extracting(TaskEngine.Stats::name).containsExactly("link");
    server.stop();
  }

  private void awaitWatched(String entry) throws InterruptedException {
    long end = System.nanoTime() + WAIT.toNanos();
    while (true) {
      String seen = watched.poll(Math.max(1, (end - System.nanoTime()) / 1_000_000), TimeUnit.MILLISECONDS);
      assertThat(seen).as("the watch reports " + entry).isNotNull();
      if (seen.equals(entry)) {
        return;
      }
    }
  }

  @Test
  void whenThePluginStopsEveryTaskStopsAndNoNewOneStarts() throws Exception {
    engine.start("a", null, inbox(), ON_FAILURE, () -> Attempt::take, changes::add);
    engine.start("b", null, inbox(), ALWAYS, () -> Attempt::take, changes::add);

    engine.stopAll();

    waitUntil(() -> engine.stats().isEmpty());
    assertThatThrownBy(() -> engine.start("c", null, inbox(), ON_FAILURE, () -> attempt -> {}, changes::add))
        .isInstanceOf(IllegalStateException.class).hasMessageContaining("is stopping");
  }

  @Test
  void countersDetailsAndAddressesAreShownPerTask() throws Exception {
    CountDownLatch reported = new CountDownLatch(1);
    TaskEngine.Task task = engine.start("t", null, inbox(), ON_FAILURE, () -> attempt -> {
      attempt.task.count("received", 3);
      attempt.task.count("received", 2);
      attempt.task.detail("protocol", "CoT 2.0");
      attempt.task.listening("/127.0.0.1:4242");
      reported.countDown();
      attempt.take();
    }, changes::add);
    assertThat(reported.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();
    task.count("skipped:no-cot-type", 1); // from a worker, through the handle

    TaskEngine.Stats stats = task.stats();
    assertThat(stats.counters()).containsEntry("received", 5L).containsEntry("skipped:no-cot-type", 1L);
    assertThat(stats.details()).containsEntry("protocol", "CoT 2.0");
    assertThat(stats.listening()).isEqualTo("/127.0.0.1:4242");
    assertThat(stats.state()).isEqualTo(State.RUNNING);
    assertThat(stats.inbox().queued()).isZero();
  }

  /** An engine like {@link #engine}, whose threads for the names {@code refuse} accepts cannot be had. */
  private TaskEngine engineWithoutThreadsFor(java.util.function.Predicate<String> refuse) {
    return new TaskEngine("cot", null, runtime, 3, Clock.systemUTC(), watch, Duration.ofMillis(300), (name, loader, body) -> {
      if (refuse.test(name)) {
        throw new OutOfMemoryError("unable to create native thread: possibly out of memory or process/resource limits reached");
      }
      return runtime.startTaskThread(name, loader, body);
    });
  }

  @Test
  void aRunWithoutAThreadFailsItsTaskAndFreesItsNameAndItsPlaceInTheCap() throws Exception {
    TaskEngine without = engineWithoutThreadsFor(name -> name.equals("ecore-task-cot/tak-out"));
    try {
      for (int i = 0; i < 3; i++) { // as often as the cap (3): each failure frees its place and its name
        LinkedBlockingQueue<Change> seen = new LinkedBlockingQueue<>();
        TaskEngine.Task task = without.start("tak-out", null, inbox(), ON_FAILURE, () -> Attempt::take, seen::add);

        Change failed = seen.poll(WAIT.toSeconds(), TimeUnit.SECONDS);
        assertThat(failed).isInstanceOf(Change.Failed.class);
        assertThat(((Change.Failed) failed).reason()).startsWith("no thread for its run: ").contains("unable to create native thread");
        assertThat(task.state()).isEqualTo(State.FAILED);
      }
      List<TaskEngine.Task> others = List.of(
          without.start("a", null, inbox(), ON_FAILURE, () -> Attempt::take, c -> {}),
          without.start("b", null, inbox(), ON_FAILURE, () -> Attempt::take, c -> {}),
          without.start("c", null, inbox(), ON_FAILURE, () -> Attempt::take, c -> {}));
      assertThat(without.stats()).filteredOn(st -> st.state() == State.FAILED).singleElement()
          .satisfies(st -> assertThat(st.name()).isEqualTo("tak-out")); // the last failure stays visible, as any
      others.forEach(TaskEngine.Task::stop);
    } finally {
      without.stopAll();
    }
  }

  @Test
  void aRestartWithoutAThreadFailsTheTask() throws Exception {
    AtomicInteger starts = new AtomicInteger();
    TaskEngine without = engineWithoutThreadsFor(name -> name.equals("ecore-task-cot/tak-in") && starts.incrementAndGet() > 1);
    try {
      TaskEngine.Task task = without.start("tak-in", null, inbox(), ON_FAILURE, () -> attempt -> {
        throw new IOException("connection refused");
      }, changes::add);

      next(Change.Running.class);
      next(Change.Restarting.class);
      assertThat(next(Change.Failed.class).reason()).startsWith("no thread for its run: ");
      assertThat(task.state()).isEqualTo(State.FAILED);
      without.start("tak-in", null, inbox(), ON_FAILURE, () -> Attempt::take, c -> {}).stop(); // the name is free
    } finally {
      without.stopAll();
    }
  }

  @Test
  void aStopWithoutAThreadForItsClosingStillClosesWhatTheRunRegistered() throws Exception {
    TaskEngine without = engineWithoutThreadsFor(name -> name.startsWith("ecore-task-stop-"));
    LinkedBlockingQueue<String> closedOn = new LinkedBlockingQueue<>();
    try {
      CountDownLatch registered = new CountDownLatch(1);
      TaskEngine.Task task = without.start("tak-out", null, inbox(), ON_FAILURE, () -> attempt -> {
        CountDownLatch closed = new CountDownLatch(1); // like a socket: only its close ends the wait
        attempt.closeOnStop(() -> {
          closedOn.add((Thread.currentThread().isVirtual() ? "virtual " : "platform ") + Thread.currentThread().getName());
          closed.countDown();
        });
        registered.countDown();
        closed.await();
      }, changes::add);
      next(Change.Running.class);
      assertThat(registered.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();

      task.stop();

      assertThat(closedOn.poll(WAIT.toSeconds(), TimeUnit.SECONDS)).isEqualTo("virtual ecore-task-stop-cot/tak-out");
      next(Change.Stopped.class);
    } finally {
      without.stopAll();
    }
  }

  @Test
  void aSuccessorWithoutAThreadFailsOnlyAfterTheStoppedRunOfItsNameHasEnded() throws Exception {
    AtomicInteger starts = new AtomicInteger();
    TaskEngine without = engineWithoutThreadsFor(name -> name.equals("ecore-task-cot/stuck") && starts.incrementAndGet() == 2);
    try {
      CountDownLatch release = new CountDownLatch(1);
      CountDownLatch running = new CountDownLatch(1);
      TaskEngine.Task stuck = without.start("stuck", null, inbox(), ON_FAILURE, () -> attempt -> {
        running.countDown();
        release.await(); // blocks on something it never registered
      }, changes::add);
      assertThat(running.await(WAIT.toSeconds(), TimeUnit.SECONDS)).isTrue();
      next(Change.Running.class);
      stuck.stop();

      LinkedBlockingQueue<Change> successor = new LinkedBlockingQueue<>();
      TaskEngine.Task next = without.start("stuck", null, inbox(), ON_FAILURE, () -> Attempt::take, successor::add);
      Thread.sleep(300);
      assertThat(successor).as("no final change while the old run still runs").isEmpty();
      assertThat(next.state()).isEqualTo(State.STARTING);

      release.countDown();
      next(Change.Stopped.class);
      Change failed = successor.poll(WAIT.toSeconds(), TimeUnit.SECONDS);
      assertThat(failed).isInstanceOf(Change.Failed.class);
      assertThat(((Change.Failed) failed).reason()).startsWith("no thread for its run: ");
      LinkedBlockingQueue<Change> third = new LinkedBlockingQueue<>();
      without.start("stuck", null, inbox(), ON_FAILURE, () -> Attempt::take, third::add);
      assertThat(third.poll(WAIT.toSeconds(), TimeUnit.SECONDS)).as("the name passed on").isInstanceOf(Change.Running.class);
    } finally {
      without.stopAll();
    }
  }

  /** What the engine's tasks and their threads are doing, for a wait that timed out. */
  private String diagnosis() {
    StringBuilder text = new StringBuilder("tasks ").append(engine.stats());
    Thread.getAllStackTraces().forEach((thread, stack) -> {
      if (thread.getName().startsWith("ecore-task")) {
        text.append("\n").append(thread.getName()).append(' ').append(thread.getState());
        for (StackTraceElement frame : stack) {
          text.append("\n  at ").append(frame);
        }
      }
    });
    return text.toString();
  }

  private static void waitUntil(java.util.function.BooleanSupplier condition) throws InterruptedException {
    long end = System.nanoTime() + WAIT.toNanos();
    while (!condition.getAsBoolean()) {
      assertThat(System.nanoTime()).as("within " + WAIT).isLessThan(end);
      Thread.sleep(20);
    }
  }
}
