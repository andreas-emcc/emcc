package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.runtime.ManualTime;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.listener.Backoff;
import dev.emcc.sdk.listener.Listener;
import dev.emcc.sdk.listener.ListenerEvent;
import dev.emcc.sdk.listener.ListenerSpec;
import dev.emcc.sdk.listener.Listeners;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.LockSupport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * The delays between a listener's reconnects (SDK v1 {@code Backoff}): {@code initial} first, then
 * doubling up to {@code max}; a connection that lasted at least {@code max} starts again from {@code
 * initial}. Time is manual: the test moves the runtime's clock and scheduler, nothing really waits.
 */
class ListenerBackoffTest {

  sealed interface Msg extends Message {
    record Event(ListenerEvent event) implements Msg {}
  }

  private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-13T10:00:00Z"), ZoneOffset.UTC);

  private final ManualTime time = new ManualTime();
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time));
  private final PluginWorkers workers = new PluginWorkers("cot", runtime.owner("cot"), getClass().getClassLoader());
  private final Probe<ListenerEvent> events = new Probe<>();
  private final WorkerRef<Msg> worker = workers.spawn(WorkerSpec.of("streams", Msg.class,
      () -> (message, ctx) -> events.add(((Msg.Event) message).event())));
  private final ServerSocket server = serverSocket();
  private final PluginListeners listeners = new PluginListeners("cot", getClass().getClassLoader(), runtime, ListenerConfig.DEFAULT,
      () -> JsonObject.of(Map.of("servers", new JsonArray(List.of(JsonObject.of(Map.of(
          "host", JsonString.of("127.0.0.1"), "port", JsonNumber.of(server.getLocalPort()))))))),
      List.of("/servers"), CLOCK);
  /** Connections the loop keeps open until the test counts the latch down; the others end at once. */
  private final ConcurrentLinkedQueue<CountDownLatch> held = new ConcurrentLinkedQueue<>();

  @AfterEach
  void close() throws IOException {
    held.forEach(CountDownLatch::countDown);
    listeners.stopAll();
    server.close();
    runtime.close();
  }

  private static ServerSocket serverSocket() {
    try {
      ServerSocket s = new ServerSocket(0, 10, InetAddress.getLoopbackAddress());
      s.setSoTimeout((int) Probe.WAIT.toMillis());
      return s;
    } catch (IOException e) {
      throw new java.io.UncheckedIOException(e);
    }
  }

  private Listener loop() {
    CountDownLatch hold = held.poll();
    return (connection, ctx) -> {
      try {
        if (hold != null && !hold.await(Probe.WAIT.toMillis(), TimeUnit.MILLISECONDS)) {
          throw new AssertionError("the test never let the connection end");
        }
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new java.io.InterruptedIOException("stopped");
      }
    };
  }

  /** Takes the next connection, and returns the delay its end announced for the reconnect. */
  private Duration nextConnection() throws IOException {
    try (Socket peer = server.accept()) {
      assertThat(peer.isConnected()).isTrue();
    }
    return retryDelay();
  }

  /** Reconnects scheduled so far, as the test has seen them. */
  private long scheduled;

  private Duration retryDelay() {
    ListenerEvent event;
    do {
      event = events.next();
    } while (!(event instanceof ListenerEvent.Disconnected));
    ListenerEvent.Disconnected d = (ListenerEvent.Disconnected) event;
    assertThat(d.retryAt()).as(d.reason()).isNotNull();
    awaitScheduled(++scheduled);
    return Duration.between(d.at(), d.retryAt());
  }

  /**
   * Waits until the listener has scheduled its {@code n}th reconnect. Only then may the test move the
   * manual clock: moved earlier, the reconnect would be scheduled from the moved time and never fall
   * due. The event comes before the scheduling; the counter after it.
   */
  private void awaitScheduled(long n) {
    long deadline = System.nanoTime() + Probe.WAIT.toNanos();
    while (listeners.stats().isEmpty() || listeners.stats().getFirst().reconnects() < n) {
      assertThat(System.nanoTime() - deadline).as("reconnect " + n + " scheduled").isNegative();
      LockSupport.parkNanos(1_000_000);
    }
  }

  @Test
  void reconnectsWaitInitialFirstThenDoubleUpToMaxAndStartAgainAfterALongConnection() throws IOException {
    listeners.start(ListenerSpec.tcp("tak-north", "127.0.0.1", server.getLocalPort())
        .reconnect(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60))), this::loop, worker, Msg.Event::new);

    CountDownLatch longOne = new CountDownLatch(1);
    List<Duration> delays = new ArrayList<>();
    for (int i = 0; i < 8; i++) {
      Duration delay = nextConnection();
      delays.add(delay);
      if (i == 7) {
        held.add(longOne); // the next connection stays up
      }
      time.advanceSettled(delay, runtime); // the reconnect falls due
    }
    assertThat(delays).extracting(Duration::toSeconds).containsExactly(1L, 2L, 4L, 8L, 16L, 32L, 60L, 60L);

    try (Socket peer = server.accept()) {
      ListenerEvent connected;
      do {
        connected = events.next();
      } while (!(connected instanceof ListenerEvent.Connected));
      time.advanceSettled(Duration.ofSeconds(60), runtime); // the connection lasts max
      longOne.countDown();
      assertThat(retryDelay()).as("after a connection that lasted max").isEqualTo(Duration.ofSeconds(1));
    }
    time.advanceSettled(Duration.ofSeconds(1), runtime);
    assertThat(nextConnection()).as("the next early end doubles again").isEqualTo(Duration.ofSeconds(2));
  }

  @Test
  void aWorkerThatHangsGetsAtMostTheBoundOfEventsTheLatestLast() throws IOException {
    CountDownLatch hold = new CountDownLatch(1);
    AtomicBoolean first = new AtomicBoolean(true);
    Probe<ListenerEvent> got = new Probe<>();
    WorkerRef<Msg> stuck = workers.spawn(WorkerSpec.of("stuck", Msg.class, () -> (message, ctx) -> {
      got.add(((Msg.Event) message).event());
      if (first.getAndSet(false)) {
        try {
          hold.await(Probe.WAIT.toMillis(), TimeUnit.MILLISECONDS); // hangs on the first event, while the others pile up
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
        }
      }
    }).budget(Duration.ofSeconds(30)));
    listeners.start(ListenerSpec.tcp("tak-north", "127.0.0.1", server.getLocalPort())
        .reconnect(Backoff.exponential(Duration.ofMillis(100), Duration.ofMillis(100))), this::loop, stuck, Msg.Event::new);

    int cycles = 60; // a Connected and a Disconnected each: 120 events
    for (int i = 0; i < cycles; i++) {
      try (Socket peer = server.accept()) {
        assertThat(peer.isConnected()).isTrue();
      }
      awaitScheduled(i + 1); // this connection's end is reported and its reconnect scheduled
      if (i < cycles - 1) {
        time.advance(Duration.ofMillis(100)); // the reconnect falls due (not settled: the worker hangs)
      }
    }
    hold.countDown();
    ManualTime.awaitIdle(runtime);

    List<ListenerEvent> events = got.drain();
    assertThat(events).as("the first, then at most the bound of the latest").hasSizeLessThanOrEqualTo(1 + Listeners.MAX_PENDING_EVENTS)
        .hasSizeLessThan(2 * cycles);
    assertThat(events.getFirst()).isInstanceOf(ListenerEvent.Connected.class);
    assertThat(events.getLast()).as("the latest event is never dropped").isInstanceOfSatisfying(ListenerEvent.Disconnected.class,
        d -> assertThat(d.retryAt()).isNotNull());
  }

  @Test
  void aConnectionShorterThanMaxCountsAsAFailure() throws IOException {
    listeners.start(ListenerSpec.tcp("tak-north", "127.0.0.1", server.getLocalPort())
        .reconnect(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60))), this::loop, worker, Msg.Event::new);
    assertThat(nextConnection()).isEqualTo(Duration.ofSeconds(1));
    CountDownLatch shortOne = new CountDownLatch(1);
    held.add(shortOne);
    time.advanceSettled(Duration.ofSeconds(1), runtime);

    try (Socket peer = server.accept()) {
      ListenerEvent connected;
      do {
        connected = events.next();
      } while (!(connected instanceof ListenerEvent.Connected));
      time.advanceSettled(Duration.ofSeconds(59), runtime); // just under max
      shortOne.countDown();
      assertThat(retryDelay()).isEqualTo(Duration.ofSeconds(2));
    }
  }
}
