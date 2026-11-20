package dev.emcc.ecore.runtime;

import static dev.emcc.ecore.runtime.WorkerRuntimeTest.await;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URL;
import java.net.URLClassLoader;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class TopicTest {

  /** A topic payload with a natural coalescing key. */
  record Position(String trackId, double lon, double lat) {}

  private static final Topic<Position> POSITIONS = Topic.of("tracks.position", Position.class);

  private final ManualTime time = new ManualTime();
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time));
  private final Owner core = runtime.owner("core");

  @AfterEach
  void close() {
    runtime.close();
  }

  @Test
  void everySubscriberGetsThePayloadThroughItsOwnMapper() {
    Probe<String> a = new Probe<>();
    Probe<String> b = new Probe<>();
    WorkerHandle<String> first = core.spawn(WorkerOptions.<String>of("first", () -> (text, ctx) -> a.add(text)));
    WorkerHandle<String> second = core.spawn(WorkerOptions.<String>of("second", () -> (text, ctx) -> b.add(text)));
    core.subscribe(POSITIONS, first, p -> "first sees " + p.trackId());
    core.subscribe(POSITIONS, second, p -> "second sees " + p.lon() + "," + p.lat());

    int accepted = runtime.publish(POSITIONS, new Position("t1", 15.65, 60.12));

    assertThat(accepted).isEqualTo(2);
    assertThat(a.next()).isEqualTo("first sees t1");
    assertThat(b.next()).isEqualTo("second sees 15.65,60.12"); // lon first
  }

  @Test
  void theMapperRunsInTheSubscribersWorker() {
    Probe<Thread> mapperThread = new Probe<>();
    Probe<Thread> handlerThread = new Probe<>();
    WorkerHandle<String> worker = core.spawn(WorkerOptions.<String>of("w", () -> (text, ctx) -> handlerThread.add(Thread.currentThread())));
    core.subscribe(POSITIONS, worker, p -> {
      mapperThread.add(Thread.currentThread());
      return p.trackId();
    });

    runtime.publish(POSITIONS, new Position("t1", 1, 2));

    assertThat(mapperThread.next()).isSameAs(handlerThread.next()).isNotSameAs(Thread.currentThread());
  }

  @Test
  void coalescingUsesTheKeyOfThePayload() {
    CountDownLatch release = new CountDownLatch(1);
    Probe<String> seen = new Probe<>();
    WorkerHandle<String> tracks = core.spawn(WorkerOptions.<String>of("tracks", () -> (text, ctx) -> {
      seen.add(text);
      if (text.equals("hold")) {
        await(release);
      }
    }).mailbox(100, Overflow.COALESCE_BY_KEY).coalesceKey(TopicTest::trackKey));
    core.subscribe(POSITIONS, tracks, p -> p.trackId() + "@" + p.lon());
    tracks.send("hold");
    assertThat(seen.next()).isEqualTo("hold");

    runtime.publish(POSITIONS, new Position("t1", 1, 0));
    runtime.publish(POSITIONS, new Position("t2", 1, 0));
    runtime.publish(POSITIONS, new Position("t1", 2, 0));
    runtime.publish(POSITIONS, new Position("t1", 3, 0));
    release.countDown();

    assertThat(seen.next(2)).containsExactly("t1@3.0", "t2@1.0");
  }

  private static @Nullable Object trackKey(Object messageOrPayload) {
    return messageOrPayload instanceof Position p ? p.trackId() : null;
  }

  @Test
  void publishingNeverWaitsForABlockSenderSubscriber() {
    CountDownLatch release = new CountDownLatch(1);
    Probe<String> started = new Probe<>();
    WorkerHandle<String> blocked = core.spawn(WorkerOptions.<String>of("blocked", () -> (text, ctx) -> {
      started.add(text);
      await(release);
    }).mailbox(1, Overflow.BLOCK_SENDER).sendTimeout(Duration.ofSeconds(60)));
    core.subscribe(POSITIONS, blocked, Position::trackId);
    blocked.send("occupy");
    started.next();
    runtime.publish(POSITIONS, new Position("fills the mailbox", 0, 0));

    long before = System.nanoTime();
    int accepted = runtime.publish(POSITIONS, new Position("t1", 0, 0));

    assertThat(accepted).isZero();
    // Only time tells "returned at once" from "waited for room": a blocking publish would wait the
    // subscriber's 60 s send timeout. Half of that is far above any non-blocking publish under load.
    assertThat(Duration.ofNanos(System.nanoTime() - before)).isLessThan(Duration.ofSeconds(30));
    release.countDown();
  }

  @Test
  void aCancelledSubscriptionReceivesNothing() {
    Probe<String> seen = new Probe<>();
    WorkerHandle<String> worker = core.spawn(WorkerOptions.<String>of("w", () -> (text, ctx) -> seen.add(text)));
    Cancellable subscription = core.subscribe(POSITIONS, worker, Position::trackId);

    subscription.cancel();

    assertThat(runtime.publish(POSITIONS, new Position("t1", 0, 0))).isZero();
  }

  @Test
  void payloadsAndTopicsAreTypeChecked() {
    WorkerHandle<String> worker = core.spawn(WorkerOptions.<String>of("w", () -> (text, ctx) -> {}));
    core.subscribe(POSITIONS, worker, Position::trackId);
    @SuppressWarnings({"unchecked", "rawtypes"})
    Topic<Object> raw = (Topic) POSITIONS;

    assertThatThrownBy(() -> runtime.publish(raw, "not a position")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Topic.of("NoDots", String.class)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void theFirstSubscribersTypeCannotBreakThePublisher() {
    List<String> warnings = new CopyOnWriteArrayList<>();
    runtime.bus().warn = warnings::add;
    Probe<String> seen = new Probe<>();
    WorkerHandle<String> worker = core.spawn(WorkerOptions.<String>of("w", () -> (text, ctx) -> seen.add(text)));
    core.subscribe(Topic.of("tracks.position", String.class), worker, s -> "wrong " + s); // first, with another type
    core.subscribe(POSITIONS, worker, p -> "right " + p.trackId());

    assertThat(runtime.publish(POSITIONS, new Position("t1", 15.65, 60.12))).isEqualTo(1);
    assertThat(runtime.publish(POSITIONS, new Position("t2", 15.65, 60.12))).isEqualTo(1);

    assertThat(seen.next(2)).containsExactly("right t1", "right t2");
    assertThat(warnings).singleElement().asString() // once per subscription, not per publish
        .contains("tracks.position").contains(Position.class.getName()).contains("java.lang.String");
  }

  @Test
  void aPublisherWhoseClassesAreLoadedAgainPublishesAsBefore() throws Exception {
    List<String> warnings = new CopyOnWriteArrayList<>();
    runtime.bus().warn = warnings::add;
    Probe<String> seen = new Probe<>();
    WorkerHandle<String> worker = core.spawn(WorkerOptions.<String>of("w", () -> (text, ctx) -> seen.add(text)));
    core.subscribe(POSITIONS, worker, p -> "before " + p.trackId()); // the plugin's first start
    runtime.publish(POSITIONS, new Position("t1", 15.65, 60.12));
    assertThat(seen.next()).isEqualTo("before t1");

    try (URLClassLoader again = new URLClassLoader("plugin-again",
        new URL[] {Position.class.getProtectionDomain().getCodeSource().getLocation()}, null)) {
      Class<?> loaded = again.loadClass(Position.class.getName()); // its second start: the same record, a new class
      assertThat(loaded).isNotSameAs(Position.class);
      var constructor = loaded.getDeclaredConstructor(String.class, double.class, double.class);
      constructor.setAccessible(true); // a package-private record, in another loader's package
      Object position = constructor.newInstance("t2", 15.65, 60.12);
      @SuppressWarnings("unchecked")
      Topic<Object> restarted = Topic.of("tracks.position", (Class<Object>) loaded);
      core.subscribe(restarted, worker, p -> "after " + p);

      assertThat(runtime.publish(restarted, position)).isEqualTo(1);
      assertThat(seen.next()).startsWith("after Position[trackId=t2");
      assertThat(warnings).singleElement().asString().contains("plugin-again");
    }
  }
}
