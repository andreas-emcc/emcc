package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.compute.ComputeContext;
import dev.emcc.sdk.compute.ComputeEvent;
import dev.emcc.sdk.compute.ComputeRef;
import dev.emcc.sdk.compute.ComputeSpec;
import dev.emcc.sdk.compute.ComputeTask;
import dev.emcc.sdk.stream.ConversionEvent;
import dev.emcc.sdk.stream.Conversions;
import dev.emcc.sdk.stream.EncodedPicture;
import dev.emcc.sdk.stream.EncoderRef;
import dev.emcc.sdk.stream.EncoderSpec;
import dev.emcc.sdk.stream.RawPicture;
import dev.emcc.sdk.worker.Coalescing;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

/** SDK 1.9.0 part U (CR-0050 point 1; UQ1 A, UQ2 A): the test kit's encoder, from a compute task and back into its inbox. */
class FakeEncoderTest {

  static final EncoderSpec SPEC = EncoderSpec.of("uav-north", 160, 120, 25);
  static final Instant T0 = Instant.parse("2026-11-17T10:00:00Z");

  sealed interface Msg extends Message permits Event, Encoder, Muxed {}

  record Event(ConversionEvent event) implements Msg {}

  record Encoder(ComputeEvent event) implements Msg {}

  record Muxed(long sequence, Instant time, boolean keyframe) implements Msg {}

  /** The render task's inbox: start rendering into an encoder, or an access unit back from it. */
  sealed interface Item extends Message, Coalescing permits Start, Encoded {}

  record Start(EncoderRef encoder, int pictures) implements Item {
    @Override
    public @Nullable Object coalesceKey() {
      return null;
    }
  }

  /** Each access unit has a key of its own, so the inbox never replaces one (CR-0050 point 1.1). */
  record Encoded(EncodedPicture picture) implements Item {
    @Override
    public Object coalesceKey() {
      return picture.sequence();
    }
  }

  /** Writes the asked pictures, counting what the encoder said; sends each access unit back to the worker. */
  static final class Render implements ComputeTask<Item> {
    private final WorkerRef<Msg> to;

    Render(WorkerRef<Msg> to) {
      this.to = to;
    }

    @Override
    public void run(ComputeContext<Item> task) {
      for (Item item; (item = task.take()) != null; ) {
        switch (item) {
          case Start s -> {
            for (int i = 0; i < s.pictures(); i++) {
              SendResult r = s.encoder().write(new RawPicture(T0.plusMillis(40L * i), Bytes.of(new byte[SPEC.pictureBytes()])));
              task.count("write " + r, 1);
            }
          }
          case Encoded e -> task.send(to, new Muxed(e.picture().sequence(), e.picture().time(), e.picture().keyframe()));
        }
      }
    }
  }

  private final List<Msg> received = new ArrayList<>();

  private WorkerRef<Msg> worker(FakePluginContext ctx) {
    return ctx.workers().spawn(WorkerSpec.of("link", Msg.class, () -> (m, c) -> received.add(m)));
  }

  private List<ConversionEvent> events() {
    return received.stream().filter(Event.class::isInstance).map(m -> ((Event) m).event()).toList();
  }

  private static Bytes au(int nal) {
    return Bytes.of(new byte[] {0, 0, 0, 1, 9, 16, 0, 0, 0, 1, (byte) nal});
  }

  @Test
  void picturesGoInAndTheAccessUnitsComeBackIntoTheTasksInboxInOrder() {
    var ctx = FakePluginContext.builder("fmv").compute(1).build();
    WorkerRef<Msg> w = worker(ctx);
    ComputeRef<Item> render =
        ctx.compute().start(ComputeSpec.of("render", Item.class).inbox(8, Overflow.coalesceByKey()), () -> new Render(w), w, Encoder::new);
    EncoderRef encoder = ctx.conversions().encode(SPEC, render, Encoded::new, w, Event::new);
    render.post(new Start(encoder, 3));
    ctx.computeTask("render").awaitIdle();
    FakeConversions.FakeEncoder fake = ctx.conversions().encoder("uav-north");
    assertThat(fake).isEqualTo(encoder);
    // two wait for the process; the third is dropped, not queued (ADR-0059 point 7)
    assertThat(ctx.computeTask("render").counter("write ACCEPTED")).isEqualTo(EncoderRef.MAX_WAITING);
    assertThat(ctx.computeTask("render").counter("write DROPPED")).isEqualTo(1);
    assertThat(fake.waiting()).isEqualTo(2);
    assertThat(fake.dropped()).isEqualTo(1);

    assertThat(fake.emit(true, au(0x65))).isEqualTo(SendResult.ACCEPTED);
    assertThat(fake.emit(false, au(0x41))).isEqualTo(SendResult.ACCEPTED);
    assertThatThrownBy(() -> fake.emit(false, au(0x41))).isInstanceOf(IllegalStateException.class); // none waits
    ctx.computeTask("render").awaitIdle();
    ctx.runUntilIdle();
    assertThat(received).containsSubsequence(new Muxed(0, T0, true), new Muxed(1, T0.plusMillis(40), false));
    assertThat(events().getFirst()).isEqualTo(new ConversionEvent.Running("uav-north", events().getFirst().at()));
    assertThat(fake.emitted()).extracting(EncodedPicture::sequence).containsExactly(0L, 1L);

    encoder.stop();
    ctx.runUntilIdle();
    assertThat(events().getLast()).isInstanceOf(ConversionEvent.Stopped.class);
    assertThat(encoder.write(new RawPicture(T0, Bytes.of(new byte[SPEC.pictureBytes()])))).isEqualTo(SendResult.CLOSED);
    render.stop();
    ctx.computeTask("render").awaitIdle();
  }

  @Test
  void aPictureOfTheWrongSizeIsRefusedAndWhileWaitingPicturesAreDropped() {
    var ctx = FakePluginContext.builder("fmv").compute(1).build();
    WorkerRef<Msg> w = worker(ctx);
    ComputeRef<Item> render = ctx.compute().start(ComputeSpec.of("render", Item.class), () -> new Render(w), w, Encoder::new);
    ctx.conversions().holdNew(true);
    EncoderRef encoder = ctx.conversions().encode(SPEC, render, Encoded::new, w, Event::new);
    assertThatThrownBy(() -> encoder.write(new RawPicture(T0, Bytes.of(new byte[SPEC.pictureBytes() - 1])))).isInstanceOf(IllegalArgumentException.class);
    assertThat(encoder.write(new RawPicture(T0, Bytes.of(new byte[SPEC.pictureBytes()])))).isEqualTo(SendResult.DROPPED);
    FakeConversions.FakeEncoder fake = ctx.conversions().encoder("uav-north");
    assertThatThrownBy(() -> fake.emit(true, au(0x65))).isInstanceOf(IllegalStateException.class); // not running
    fake.run();
    assertThat(encoder.write(new RawPicture(T0, Bytes.of(new byte[SPEC.pictureBytes()])))).isEqualTo(SendResult.ACCEPTED);
    ctx.runUntilIdle();
    assertThat(events()).hasSize(2).first().isInstanceOf(ConversionEvent.Waiting.class);
    assertThat(events().get(1)).isInstanceOf(ConversionEvent.Running.class);
    assertThat(fake.dropped()).isEqualTo(1);
    assertThat(fake.pictures()).hasSize(1);
    render.stop();
    ctx.computeTask("render").awaitIdle();
  }

  @Test
  void aNameIsUniqueAmongRunningEncodersAndAFailedOneWaitsRetryAfter() {
    var ctx = FakePluginContext.builder("fmv").compute(1).build();
    WorkerRef<Msg> w = worker(ctx);
    ComputeRef<Item> render = ctx.compute().start(ComputeSpec.of("render", Item.class), () -> new Render(w), w, Encoder::new);
    ctx.conversions().encode(SPEC, render, Encoded::new, w, Event::new);
    assertThatThrownBy(() -> ctx.conversions().encode(SPEC, render, Encoded::new, w, Event::new)).isInstanceOf(IllegalStateException.class);
    ctx.conversions().encoder("uav-north").fail(ConversionEvent.Failure.STALLED, "");
    assertThatThrownBy(() -> ctx.conversions().encode(SPEC, render, Encoded::new, w, Event::new)).isInstanceOf(IllegalStateException.class);
    ctx.advance(Conversions.RETRY_AFTER);
    EncoderRef again = ctx.conversions().encode(SPEC, render, Encoded::new, w, Event::new);
    assertThat(ctx.conversions().encoders()).hasSize(2);
    ctx.conversions().stopEncoders();
    ctx.runUntilIdle();
    assertThat(events()).filteredOn(ConversionEvent.Failed.class::isInstance).hasSize(1);
    assertThat(events().getLast()).isEqualTo(new ConversionEvent.Stopped("uav-north", events().getLast().at(), "plugin stopped"));
    assertThat(again.write(new RawPicture(T0, Bytes.of(new byte[SPEC.pictureBytes()])))).isEqualTo(SendResult.CLOSED);
    render.stop();
    ctx.computeTask("render").awaitIdle();
  }

  @Test
  void theOutputIsAComputeTaskOfTheSamePlugin() {
    var ctx = FakePluginContext.builder("fmv").compute(1).build();
    var other = FakePluginContext.builder("uav-simulation").compute(1).build();
    WorkerRef<Msg> w = worker(ctx);
    WorkerRef<Msg> ow = worker(other);
    ComputeRef<Item> foreign = other.compute().start(ComputeSpec.of("render", Item.class), () -> new Render(ow), ow, Encoder::new);
    assertThatThrownBy(() -> ctx.conversions().encode(SPEC, foreign, Encoded::new, w, Event::new)).isInstanceOf(IllegalArgumentException.class);
    foreign.stop();
    other.computeTask("render").awaitIdle();
  }
}
