package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.compute.ComputeContext;
import dev.emcc.sdk.compute.ComputeEvent;
import dev.emcc.sdk.compute.ComputeRef;
import dev.emcc.sdk.compute.ComputeSpec;
import dev.emcc.sdk.compute.ComputeTask;
import dev.emcc.sdk.connection.Backoff;
import dev.emcc.sdk.connection.Restart;
import dev.emcc.sdk.worker.Coalescing;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

/** SDK 1.9.0 (CR-0048 point 5; ADR-0064): the test kit's compute tasks, with the limits (owner YQ1 A, PQ1 A). */
class FakeComputesTest {

  sealed interface Msg extends Message permits Event, Rendered {}

  record Event(ComputeEvent event) implements Msg {}

  record Rendered(String camera, int frame) implements Msg {}

  record Pose(String camera, int frame) implements Message, Coalescing {
    @Override
    public @Nullable Object coalesceKey() {
      return camera;
    }
  }

  private final List<Msg> received = new ArrayList<>();

  private WorkerRef<Msg> worker(FakePluginContext ctx) {
    return ctx.workers().spawn(WorkerSpec.of("link", Msg.class, () -> (m, c) -> received.add(m)));
  }

  private List<ComputeEvent> events() {
    return received.stream().filter(m -> m instanceof Event).map(m -> ((Event) m).event()).toList();
  }

  /** "Renders" each pose: sends it back; frame -1 throws. */
  static final class Renderer implements ComputeTask<Pose> {
    private final WorkerRef<Msg> to;

    Renderer(WorkerRef<Msg> to) {
      this.to = to;
    }

    @Override
    public void run(ComputeContext<Pose> task) {
      task.detail("frame", "1280x720");
      for (Pose p; (p = task.take()) != null; ) {
        if (p.frame() < 0) {
          throw new IllegalStateException("bad pose");
        }
        task.count("rendered", 1);
        task.send(to, new Rendered(p.camera(), p.frame()));
      }
    }
  }

  @Test
  void aTaskTakesWhatWorkersPostAndSendsToWorkersAtTheNextRun() {
    var ctx = FakePluginContext.builder("fmv").compute(2).build();
    WorkerRef<Msg> w = worker(ctx);
    ComputeRef<Pose> camera = ctx.compute().start(ComputeSpec.of("camera-north", Pose.class), () -> new Renderer(w), w, Event::new);
    assertThat(ctx.compute().declared()).isEqualTo(2);
    assertThat(ctx.compute().allowed()).isEqualTo(2);
    assertThat(camera.post(new Pose("north", 1))).isEqualTo(SendResult.ACCEPTED);
    ctx.computeTask("camera-north").awaitIdle();
    ctx.runUntilIdle();
    assertThat(received).contains(new Rendered("north", 1));
    assertThat(events().getFirst()).isInstanceOf(ComputeEvent.Running.class);
    assertThat(ctx.computeTask("camera-north").counter("rendered")).isEqualTo(1);
    assertThat(ctx.computeTask("camera-north").details()).containsEntry("frame", "1280x720");
    camera.stop();
    ctx.computeTask("camera-north").awaitIdle();
    ctx.runUntilIdle();
    assertThat(events().getLast()).isInstanceOf(ComputeEvent.Stopped.class);
    assertThat(((ComputeEvent.Stopped) events().getLast()).reason()).isNull();
    assertThat(camera.post(new Pose("north", 2))).isEqualTo(SendResult.CLOSED);
    assertThat(ctx.computeTask("camera-north").state()).isEqualTo(FakeComputes.FakeCompute.State.STOPPED);
  }

  @Test
  void theInboxKeepsTheNewestPosePerCamera() {
    var ctx = FakePluginContext.builder("fmv").compute(1).build();
    WorkerRef<Msg> w = worker(ctx);
    // a task that never takes: the inbox fills
    ComputeRef<Pose> camera = ctx.compute().start(ComputeSpec.of("camera-north", Pose.class).inbox(4, Overflow.coalesceByKey()), () -> task -> {
      while (!task.stopping()) {
        Thread.onSpinWait(); // busy, never taking: the inbox fills
      }
    }, w, Event::new);
    camera.post(new Pose("north", 1));
    camera.post(new Pose("south", 1));
    camera.post(new Pose("north", 2));
    assertThat(ctx.computeTask("camera-north", Pose.class).posted()).hasSize(3);
    assertThat(ctx.computeTask("camera-north", Pose.class).inbox()).containsExactly(new Pose("north", 2), new Pose("south", 1));
    camera.stop();
    ctx.computeTask("camera-north").awaitIdle();
  }

  @Test
  void aStartAboveTheLimitsIsRefusedWithTheReason() {
    var ctx = FakePluginContext.builder("fmv").compute(2).computeTotalCap(3).build();
    WorkerRef<Msg> w = worker(ctx);
    ctx.compute().start(ComputeSpec.of("one", Pose.class), () -> new Renderer(w), w, Event::new);
    ctx.compute().start(ComputeSpec.of("two", Pose.class), () -> new Renderer(w), w, Event::new);
    ComputeRef<Pose> three = ctx.compute().start(ComputeSpec.of("three", Pose.class), () -> new Renderer(w), w, Event::new);
    ctx.runUntilIdle();
    assertThat(three.post(new Pose("x", 1))).isEqualTo(SendResult.CLOSED);
    assertThat(events()).anySatisfy(e -> assertThat(e).isEqualTo(new ComputeEvent.Refused("three", e.at(), ComputeEvent.Refusal.PLUGIN_LIMIT)));
    assertThat(ctx.compute().refused(ComputeEvent.Refusal.PLUGIN_LIMIT)).isEqualTo(1);
    assertThat(ctx.computeTask("three").state()).isEqualTo(FakeComputes.FakeCompute.State.REFUSED);
    // the total cap, as when other plugins hold it
    ctx.compute().refuseNext(ComputeEvent.Refusal.TOTAL_CAP);
    ctx.compute().start(ComputeSpec.of("four", Pose.class), () -> new Renderer(w), w, Event::new);
    ctx.runUntilIdle();
    assertThat(ctx.compute().refused(ComputeEvent.Refusal.TOTAL_CAP)).isEqualTo(1);
    assertThatThrownBy(() -> ctx.compute().start(ComputeSpec.of("one", Pose.class), () -> new Renderer(w))).isInstanceOf(IllegalArgumentException.class);
    ctx.compute().stopAll();
  }

  @Test
  void withoutADeclarationOrSwitchedOffEveryStartIsRefused() {
    var none = FakePluginContext.builder("fmv").build();
    WorkerRef<Msg> w = worker(none);
    none.compute().start(ComputeSpec.of("a", Pose.class), () -> new Renderer(w), w, Event::new);
    none.runUntilIdle();
    assertThat(none.compute().refused(ComputeEvent.Refusal.NOT_DECLARED)).isEqualTo(1);
    var off = FakePluginContext.builder("fmv").compute(2).computeAllowed(0).build();
    off.compute().start(ComputeSpec.of("a", Pose.class), () -> new Renderer(w));
    assertThat(off.compute().refused(ComputeEvent.Refusal.SWITCHED_OFF)).isEqualTo(1);
  }

  @Test
  void loweringAllowedStopsTheNewestFirstWithAReason() {
    var ctx = FakePluginContext.builder("fmv").compute(3).build();
    WorkerRef<Msg> w = worker(ctx);
    for (String name : List.of("one", "two", "three")) {
      ctx.compute().start(ComputeSpec.of(name, Pose.class), () -> new Renderer(w), w, Event::new);
      ctx.computeTask(name).awaitIdle();
    }
    ctx.compute().allow(1);
    for (String name : List.of("two", "three")) {
      ctx.computeTask(name).awaitIdle();
    }
    ctx.runUntilIdle();
    assertThat(ctx.compute().names()).containsExactly("one");
    assertThat(events()).filteredOn(e -> e instanceof ComputeEvent.Stopped).extracting(ComputeEvent::task).containsExactlyInAnyOrder("two", "three");
    assertThat(events()).filteredOn(e -> e instanceof ComputeEvent.Stopped s && s.reason() != null && s.reason().contains("lowered")).hasSize(2);
    assertThat(ctx.compute().allowed()).isEqualTo(1);
    assertThatThrownBy(() -> ctx.compute().allow(4)).isInstanceOf(IllegalArgumentException.class);
    ctx.compute().stopAll();
  }

  @Test
  void aFailedRunRestartsWithTheBackoffAndAFreshTask() {
    var ctx = FakePluginContext.builder("fmv").compute(1).build();
    WorkerRef<Msg> w = worker(ctx);
    int[] made = {0};
    ComputeRef<Pose> camera = ctx.compute().start(
        ComputeSpec.of("camera", Pose.class).restart(Restart.onFailure(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60)))),
        () -> {
          made[0]++;
          return new Renderer(w);
        }, w, Event::new);
    ctx.computeTask("camera").awaitIdle();
    camera.post(new Pose("x", -1));
    ctx.computeTask("camera").awaitIdle();
    ctx.runUntilIdle();
    assertThat(events()).anySatisfy(e -> assertThat(e).isInstanceOf(ComputeEvent.Restarting.class));
    ctx.advance(Duration.ofSeconds(1));
    ctx.computeTask("camera").awaitIdle();
    assertThat(made[0]).isEqualTo(2);
    assertThat(ctx.computeTask("camera").restarts()).isEqualTo(1);
    assertThat(ctx.compute().names()).as("it keeps its place while restarting").containsExactly("camera");
    camera.stop();
  }

  @Test
  void aFencedTaskSendsNothing() {
    var ctx = FakePluginContext.builder("fmv").compute(1).build();
    WorkerRef<Msg> w = worker(ctx);
    SendResult[] after = new SendResult[1];
    ComputeRef<Pose> camera = ctx.compute().start(ComputeSpec.of("camera", Pose.class), () -> task -> {
      while (task.take() != null) {
        // until stopped
      }
      after[0] = task.send(w, new Rendered("late", 0));
    });
    ctx.computeTask("camera").awaitIdle();
    camera.stop();
    ctx.computeTask("camera").awaitIdle();
    ctx.runUntilIdle();
    assertThat(after[0]).isEqualTo(SendResult.CLOSED);
    assertThat(received).doesNotContain(new Rendered("late", 0));
  }
}
