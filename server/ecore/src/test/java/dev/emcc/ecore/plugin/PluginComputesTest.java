package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.compute.ComputeContext;
import dev.emcc.sdk.compute.ComputeEvent;
import dev.emcc.sdk.compute.ComputeEvent.Refusal;
import dev.emcc.sdk.compute.ComputeRef;
import dev.emcc.sdk.compute.ComputeSpec;
import dev.emcc.sdk.compute.ComputeTask;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** SDK 1.9.0 (CR-0048 point 5, ADR-0064; M9 C7): compute tasks through {@link PluginComputes}, as plugins use them. */
class PluginComputesTest {

  /** What the task posts back, and the events. */
  record Text(String text) implements Message {}

  record Event(ComputeEvent event) implements Message {}

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final ComputeHub hub = new ComputeHub(2);
  private final LinkedBlockingQueue<Message> got = new LinkedBlockingQueue<>();
  private final List<String> notEnding = new CopyOnWriteArrayList<>();
  private final List<String> threadNames = new CopyOnWriteArrayList<>();
  private final CountDownLatch never = new CountDownLatch(1);
  private int spawned;

  @AfterEach
  void close() {
    never.countDown(); // lets a task that would not stop end
    runtime.close();
  }

  private PluginComputes computes(String plugin, int declared, int allowed) {
    TaskEngine.Watch watch = new TaskEngine.Watch() {
      @Override
      public void notEnding(String name) {
        notEnding.add(plugin + "/" + name);
      }

      @Override
      public void ended(String name) {}
    };
    return new PluginComputes(plugin, declared, declared == 0 ? "" : "renders cameras.", allowed, hub, runtime, getClass().getClassLoader(),
        Clock.systemUTC(), new PluginLocalFolders(plugin, List.of(), JsonObject::empty, runtime, runtime.ioExecutor()), watch,
        Duration.ofMillis(300), (name, loader, body) -> {
          threadNames.add(name);
          return runtime.startTaskThread(name, loader, body);
        });
  }

  private WorkerRef<Message> worker(String plugin) {
    PluginWorkers w = new PluginWorkers(plugin, runtime.owner(plugin), getClass().getClassLoader());
    return w.spawn(WorkerSpec.of("w-" + ++spawned, Message.class, () -> (message, ctx) -> got.add(message)));
  }

  /** Echoes each item back to {@code to}, counting them. */
  private static Supplier<ComputeTask<Text>> echo(WorkerRef<Message> to) {
    return () -> (ComputeContext<Text> task) -> {
      for (Text t; (t = task.take()) != null; ) {
        task.send(to, new Text("rendered " + t.text()));
        task.count("rendered", 1);
      }
    };
  }

  private Message next() throws InterruptedException {
    Message m = got.poll(10, TimeUnit.SECONDS);
    assertThat(m).as("within 10 s").isNotNull();
    return m;
  }

  private ComputeEvent nextEvent() throws InterruptedException {
    Message m = next();
    assertThat(m).isInstanceOf(Event.class);
    return ((Event) m).event();
  }

  private <I extends Message> ComputeRef<I> start(PluginComputes c, ComputeSpec<I> spec, Supplier<? extends ComputeTask<I>> factory,
      WorkerRef<Message> events) {
    return c.start(spec, factory, events, Event::new);
  }

  @Test
  void aTaskRunsOnACoreThreadOfItsOwnTakesWhatIsPostedAndStopsOnItsStop() throws Exception {
    PluginComputes fmv = computes("fmv", 2, 2);
    WorkerRef<Message> link = worker("fmv");
    ComputeRef<Text> camera = start(fmv, ComputeSpec.of("camera-north", Text.class), echo(link), link);

    assertThat(nextEvent()).isInstanceOf(ComputeEvent.Running.class);
    assertThat(camera.post(new Text("pose 1"))).isEqualTo(SendResult.ACCEPTED);
    assertThat(next()).isEqualTo(new Text("rendered pose 1"));
    assertThat(threadNames).containsExactly("ecore-compute-fmv/camera-north");
    assertThat(hub.held()).isEqualTo(1);
    PluginComputes.Status status = fmv.status();
    assertThat(status.declared()).isEqualTo(2);
    assertThat(status.running()).isEqualTo(1);
    assertThat(status.tasks()).singleElement().satisfies(t -> {
      assertThat(t.state()).isEqualTo("RUNNING");
      assertThat(t.counters()).containsEntry("rendered", 1L);
      assertThat(t.cpuMillis()).isGreaterThanOrEqualTo(0);
      assertThat(t.waitMillis()).isLessThanOrEqualTo(t.runMillis());
    });

    camera.stop();
    assertThat(nextEvent()).isInstanceOfSatisfying(ComputeEvent.Stopped.class, s -> assertThat(s.reason()).as("its plugin stopped it").isNull());
    assertThat(hub.held()).as("its place in the server's cap is free once its thread has ended").isZero();
    assertThat(camera.post(new Text("late"))).isEqualTo(SendResult.CLOSED);
    assertThat(fmv.status().tasks()).isEmpty();
  }

  @Test
  void startsAboveALimitAreRefusedWithAStoppedRefAndCountedNeverThrown() throws Exception {
    WorkerRef<Message> events = worker("fmv");
    ComputeRef<Text> undeclared = start(computes("plain", 0, 0), ComputeSpec.of("x", Text.class), echo(events), events);
    assertThat(((ComputeEvent.Refused) nextEvent()).refusal()).isEqualTo(Refusal.NOT_DECLARED);
    assertThat(undeclared.post(new Text("p"))).isEqualTo(SendResult.CLOSED);

    start(computes("off", 2, 0), ComputeSpec.of("x", Text.class), echo(events), events);
    assertThat(((ComputeEvent.Refused) nextEvent()).refusal()).isEqualTo(Refusal.SWITCHED_OFF);

    PluginComputes fmv = computes("fmv", 2, 1);
    start(fmv, ComputeSpec.of("first", Text.class), echo(events), events);
    assertThat(nextEvent()).isInstanceOf(ComputeEvent.Running.class);
    start(fmv, ComputeSpec.of("second", Text.class), echo(events), events);
    assertThat(((ComputeEvent.Refused) nextEvent()).refusal()).isEqualTo(Refusal.PLUGIN_LIMIT);

    PluginComputes other = computes("other", 4, 4);
    WorkerRef<Message> otherEvents = worker("other");
    start(other, ComputeSpec.of("a", Text.class), echo(otherEvents), otherEvents);
    assertThat(nextEvent()).isInstanceOf(ComputeEvent.Running.class);
    start(other, ComputeSpec.of("b", Text.class), echo(otherEvents), otherEvents);
    assertThat(((ComputeEvent.Refused) nextEvent()).refusal()).as("the server's cap of 2: fmv's and other's first").isEqualTo(Refusal.TOTAL_CAP);

    assertThat(fmv.status().refusals()).containsEntry("PLUGIN_LIMIT", 1L);
    assertThat(other.status().refusals()).containsEntry("TOTAL_CAP", 1L);
    assertThat(hub.held()).isEqualTo(2);
    fmv.stopAll();
    assertThatThrownBy(() -> start(fmv, ComputeSpec.of("after", Text.class), echo(events), events))
        .as("once the plugin has stopped, not a refusal").isInstanceOf(IllegalStateException.class).hasMessageContaining("is stopping");
  }

  @Test
  void loweringTheAdminsNumberStopsTheNewestFirstWithTheReason() throws Exception {
    PluginComputes fmv = computes("fmv", 3, 3);
    hubFree();
    WorkerRef<Message> events = worker("fmv");
    start(fmv, ComputeSpec.of("old", Text.class), echo(events), events);
    assertThat(nextEvent()).isInstanceOf(ComputeEvent.Running.class);
    start(fmv, ComputeSpec.of("new", Text.class), echo(events), events);
    assertThat(nextEvent()).isInstanceOf(ComputeEvent.Running.class);

    assertThat(fmv.allowed(1)).isEqualTo(1);

    assertThat(nextEvent()).isInstanceOfSatisfying(ComputeEvent.Stopped.class, s -> {
      assertThat(s.task()).isEqualTo("new");
      assertThat(s.reason()).isEqualTo("the admin lowered the plugin's compute threads to 1");
    });
    assertThat(fmv.allowed()).isEqualTo(1);
    assertThat(fmv.status().tasks()).singleElement().satisfies(t -> assertThat(t.name()).isEqualTo("old"));
    assertThat(fmv.allowed(9)).as("at most the declaration").isEqualTo(3);
  }

  private void hubFree() {
    assertThat(hub.held()).isZero();
  }

  @Test
  void aTaskThatWillNotStopIsHungItsPluginToldAndItKeepsItsPlaceInTheCapOnly() throws Exception {
    PluginComputes fmv = computes("fmv", 2, 1);
    WorkerRef<Message> events = worker("fmv");
    ComputeRef<Text> stuck = start(fmv, ComputeSpec.of("stuck", Text.class), () -> task -> never.await(), events);
    assertThat(nextEvent()).isInstanceOf(ComputeEvent.Running.class);

    stuck.stop();

    assertThat(nextEvent()).isInstanceOfSatisfying(ComputeEvent.Hung.class, h -> assertThat(h.task()).isEqualTo("stuck"));
    assertThat(notEnding).containsExactly("fmv/stuck");
    assertThat(fmv.status().tasks()).singleElement().satisfies(t -> assertThat(t.hung()).isTrue());
    assertThat(hub.held()).as("its thread still holds a core").isEqualTo(1);
    start(fmv, ComputeSpec.of("fresh", Text.class), echo(events), events);
    assertThat(nextEvent()).as("its place in allowed() is free").isInstanceOf(ComputeEvent.Running.class);

    never.countDown();
    assertThat(nextEvent()).isInstanceOfSatisfying(ComputeEvent.Stopped.class, s -> assertThat(s.task()).isEqualTo("stuck"));
    assertThat(hub.held()).isEqualTo(1);
  }

  @Test
  void aStoppedTasksSendsAndPostsAreDropped() throws Exception {
    PluginComputes fmv = computes("fmv", 1, 1);
    WorkerRef<Message> link = worker("fmv");
    CountDownLatch stopped = new CountDownLatch(1);
    CountDownLatch running = new CountDownLatch(1);
    List<SendResult> after = new CopyOnWriteArrayList<>();
    ComputeRef<Text> task = fmv.start(ComputeSpec.of("late", Text.class), () -> (ComputeContext<Text> t) -> {
      running.countDown();
      while (!t.stopping()) {
        t.poll(Duration.ofMillis(10));
      }
      stopped.await();
      after.add(t.send(link, new Text("too late")));
      after.add(t.self().post(new Text("too late")));
      after.add(PluginComputes.onFencedComputeThread() ? SendResult.CLOSED : SendResult.ACCEPTED);
    });
    assertThat(running.await(10, TimeUnit.SECONDS)).as("its first run is on").isTrue(); // a stop before it would end it unrun
    task.stop();
    stopped.countDown();
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (after.size() < 3 && System.nanoTime() < deadline) {
      Thread.onSpinWait();
    }
    assertThat(after).containsExactly(SendResult.CLOSED, SendResult.CLOSED, SendResult.CLOSED);
    assertThat(got.poll(200, TimeUnit.MILLISECONDS)).as("nothing reached the worker").isNull();
  }

  @Test
  void aSecondStartOfARunningNameThrowsAndTakesNoPlaceAndATaskSendsOnlyToItsOwnPlugin() throws Exception {
    PluginComputes fmv = computes("fmv", 2, 2);
    WorkerRef<Message> events = worker("fmv");
    start(fmv, ComputeSpec.of("same", Text.class), echo(events), events);
    assertThat(nextEvent()).isInstanceOf(ComputeEvent.Running.class);
    assertThatThrownBy(() -> start(fmv, ComputeSpec.of("same", Text.class), echo(events), events))
        .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("compute task named same is running already");
    assertThat(hub.held()).isEqualTo(1);
    assertThat(fmv.status().running()).isEqualTo(1);

    WorkerRef<Message> foreign = worker("other");
    List<Throwable> thrown = new CopyOnWriteArrayList<>();
    fmv.start(ComputeSpec.of("sneaky", Text.class), () -> t -> {
      try {
        t.send(foreign, new Text("x"));
      } catch (IllegalArgumentException e) {
        thrown.add(e);
      }
    });
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (thrown.isEmpty() && System.nanoTime() < deadline) {
      Thread.onSpinWait();
    }
    assertThat(thrown).singleElement().satisfies(e -> assertThat(e).hasMessageContaining("only to its own plugin's workers"));
  }
}
