package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.Permissions;
import dev.emcc.sdk.connection.ConnectionSpec;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.stream.ConversionEvent;
import dev.emcc.sdk.stream.ConversionRef;
import dev.emcc.sdk.stream.ConversionSpec;
import dev.emcc.sdk.stream.StreamRef;
import dev.emcc.sdk.stream.StreamSpec;
import dev.emcc.sdk.stream.Streams;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** SDK 1.8.0 part E (CR-0044): the test kit's streams and conversions. */
class FakeStreamsTest {

  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final String VIEW = Permissions.ofPlugin("fmv", "view");

  record Conv(ConversionEvent event) implements Message {}

  record Video(StreamRef stream, Bytes datagram, boolean startPoint) implements Message {}

  record HoldsService(Streams streams) implements Message {}

  private final List<ConversionEvent> events = new ArrayList<>();

  private static StreamSpec spec(String name) {
    return StreamSpec.of(name, "video/mp2t", VIEW, LABEL);
  }

  private static Bytes bytes(int... values) {
    var b = new byte[values.length];
    for (int i = 0; i < values.length; i++) {
      b[i] = (byte) values[i];
    }
    return Bytes.of(b);
  }

  /** One 188-byte transport stream packet, with or without the random access indicator. */
  private static Bytes packet(boolean randomAccess) {
    var b = new byte[188];
    b[0] = 0x47;
    b[3] = 0x30; // adaptation field and payload
    b[4] = 1;
    b[5] = (byte) (randomAccess ? 0x40 : 0);
    return Bytes.of(b);
  }

  private WorkerRef<Conv> worker(FakePluginContext ctx) {
    return ctx.workers().spawn(WorkerSpec.of("link", Conv.class, () -> (m, c) -> events.add(m.event())));
  }

  @Test
  void aStreamOpensOnceByNameUpToTheCap() {
    var ctx = FakePluginContext.builder("fmv").maxStreams(2).build();
    StreamRef a = ctx.streams().open(spec("a"));
    assertThat(a.name()).isEqualTo("a");
    assertThat(ctx.stream("a")).isEqualTo(a);
    assertThatThrownBy(() -> ctx.streams().open(spec("a"))).isInstanceOf(IllegalStateException.class).hasMessageContaining("open");
    ctx.streams().open(spec("b"));
    assertThatThrownBy(() -> ctx.streams().open(spec("c"))).isInstanceOf(IllegalStateException.class).hasMessageContaining("2 streams");
    a.close();
    StreamRef again = ctx.streams().open(spec("a"));
    assertThat(again).isNotEqualTo(a);
    assertThat(ctx.stream("a")).isEqualTo(again);
    assertThat(ctx.streams().streams()).hasSize(3);
    assertThat(ctx.streams().openStreams()).extracting(StreamRef::name).containsExactly("b", "a");
    assertThatThrownBy(() -> ctx.stream("x")).isInstanceOf(IllegalArgumentException.class);
    assertThat(FakePluginContext.DEFAULT_MAX_STREAMS).isEqualTo(Streams.MAX_OPEN);
    assertThatThrownBy(() -> FakePluginContext.builder("fmv").maxStreams(0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> FakePluginContext.builder("fmv").maxStreams(33)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aLateViewerStartsAtTheLastStartPointWithTheHeader() {
    var ctx = FakePluginContext.builder("fmv").build();
    StreamRef s = ctx.streams().open(spec("link-1"));
    FakeStreams.FakeViewer early = ctx.stream("link-1").join();
    s.header(bytes(0xAA));
    assertThat(s.write(bytes(1), false)).isEqualTo(SendResult.ACCEPTED);
    assertThat(early.started()).isFalse();
    s.write(bytes(2), true);
    s.write(bytes(3), false);
    s.write(bytes(4), true);
    s.write(bytes(5), false);
    FakeStreams.FakeViewer late = ctx.stream("link-1").join();
    s.write(bytes(6), false);

    assertThat(ctx.stream("link-1").startPoints()).containsExactly(1, 3);
    assertThat(ctx.stream("link-1").chunks()).hasSize(6);
    assertThat(early.received()).containsExactly(bytes(0xAA), bytes(2), bytes(3), bytes(4), bytes(5), bytes(6));
    assertThat(late.received()).containsExactly(bytes(0xAA), bytes(4), bytes(5), bytes(6));
    assertThat(late.bytes()).isEqualTo(bytes(0xAA, 4, 5, 6));
    assertThat(s.viewers()).isEqualTo(2);
    late.leave();
    assertThat(s.viewers()).isEqualTo(1);
    s.write(bytes(7), false);
    assertThat(late.received()).hasSize(4);
  }

  @Test
  void aClosedStreamEndsItsViewersAndRefusesWrites() {
    var ctx = FakePluginContext.builder("fmv").build();
    StreamRef s = ctx.streams().open(spec("a"));
    s.write(bytes(1), true);
    FakeStreams.FakeViewer v = ctx.stream("a").join();
    s.close();
    s.close();
    assertThat(v.ended()).isTrue();
    assertThat(s.viewers()).isZero();
    assertThat(s.write(bytes(2), true)).isEqualTo(SendResult.CLOSED);
    s.header(bytes(9));
    s.label(SecurityLabel.of("NATO", "NATO SECRET"));
    assertThat(ctx.stream("a").header()).isEqualTo(Bytes.empty());
    assertThat(ctx.stream("a").label()).isEqualTo(LABEL);
    assertThat(ctx.stream("a").isClosed()).isTrue();
    assertThat(ctx.stream("a").join().ended()).isTrue();
  }

  @Test
  void chunksHeadersAndLabelsAreChecked() {
    var ctx = FakePluginContext.builder("fmv").build();
    StreamRef s = ctx.streams().open(spec("a"));
    assertThatThrownBy(() -> s.write(Bytes.empty(), false)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> s.write(Bytes.of(new byte[Streams.MAX_CHUNK + 1]), false)).isInstanceOf(IllegalArgumentException.class);
    assertThat(s.write(Bytes.of(new byte[Streams.MAX_CHUNK]), false)).isEqualTo(SendResult.ACCEPTED);
    assertThatThrownBy(() -> s.header(Bytes.of(new byte[Streams.MAX_HEADER + 1]))).isInstanceOf(IllegalArgumentException.class);
    s.header(Bytes.of(new byte[Streams.MAX_HEADER]));
    var secret = SecurityLabel.of("NATO", "NATO SECRET");
    s.label(secret);
    assertThat(ctx.stream("a").label()).isEqualTo(secret);
    assertThat(ctx.stream("a").spec().label()).isEqualTo(LABEL);
    ctx.streams().closeAll();
    assertThat(ctx.streams().openStreams()).isEmpty();
  }

  /** Writes what its inbox brings to the stream named in it. */
  static final class Writer implements ConnectionTask<Video> {
    @Override
    public void run(TaskContext<Video> task) {
      for (Video v; (v = task.take()) != null; ) {
        if (v.stream().write(v.datagram(), v.startPoint()) == SendResult.ACCEPTED) {
          task.count("written", 1);
        }
      }
    }
  }

  @Test
  void aConnectionTaskWritesToAStreamHandedToItInAMessage() {
    var ctx = FakePluginContext.builder("fmv").build();
    StreamRef s = ctx.streams().open(spec("link-1"));
    var task = ctx.connections().start(ConnectionSpec.of("link-1", Video.class), Writer::new);
    task.post(new Video(s, bytes(1), true));
    task.post(new Video(s, bytes(2), false));
    ctx.connectionTask("link-1").awaitIdle();
    ctx.runUntilIdle();
    assertThat(ctx.stream("link-1").chunks()).extracting(FakeStreams.Chunk::bytes).containsExactly(bytes(1), bytes(2));
    assertThat(ctx.stream("link-1").startPoints()).containsExactly(0);
    task.stop();
  }

  @Test
  void theStreamsServiceIsNoMessageValue() {
    var ctx = FakePluginContext.builder("fmv").build();
    assertThatThrownBy(() -> MessageCheck.requireImmutable(new HoldsService(ctx.streams()))).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("SDK service");
    MessageCheck.requireImmutable(new Video(ctx.streams().open(spec("a")), bytes(1), false));
  }

  @Test
  void theStreamPathIsNotForThePluginsOwnEndpoints() {
    assertThatThrownBy(() -> Endpoint.get("/stream/{name}")).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aRunningConversionCopiesItsInputToTheStreamAndMarksTheStartPoints() {
    var ctx = FakePluginContext.builder("fmv").build();
    var w = worker(ctx);
    StreamRef s = ctx.streams().open(spec("link-1"));
    ConversionRef c = ctx.conversions().start(ConversionSpec.mpeg2ToH264(s), w, Conv::new);
    ctx.runUntilIdle();
    assertThat(events).singleElement().isInstanceOf(ConversionEvent.Running.class);
    assertThat(c.target()).isEqualTo(s);

    assertThat(c.write(packet(false))).isEqualTo(SendResult.ACCEPTED);
    c.write(packet(true));
    assertThat(s.write(bytes(9), true)).isEqualTo(SendResult.DROPPED);
    assertThat(ctx.stream("link-1").chunks()).extracting(FakeStreams.Chunk::startPoint).containsExactly(false, true);
    assertThat(ctx.stream("link-1").dropped()).isEqualTo(1);
    assertThat(ctx.conversions().conversion("link-1").input()).hasSize(2);
    assertThatThrownBy(() -> ctx.conversions().start(ConversionSpec.mpeg2ToH264(s), w, Conv::new)).isInstanceOf(IllegalStateException.class);

    c.stop();
    c.stop();
    ctx.runUntilIdle();
    assertThat(events.get(1)).isEqualTo(new ConversionEvent.Stopped("link-1", ctx.clock(), "stopped"));
    assertThat(events).hasSize(2);
    assertThat(c.write(packet(true))).isEqualTo(SendResult.CLOSED);
    assertThat(s.write(bytes(9), true)).isEqualTo(SendResult.ACCEPTED);
  }

  @Test
  void withNoFreeSlotAConversionWaitsAndDropsItsInput() {
    var ctx = FakePluginContext.builder("fmv").build();
    var w = worker(ctx);
    StreamRef s = ctx.streams().open(spec("link-1"));
    ctx.conversions().holdNew(true);
    ConversionRef c = ctx.conversions().start(ConversionSpec.mpeg2ToH264(s), w, Conv::new);
    assertThat(c.write(packet(true))).isEqualTo(SendResult.DROPPED);
    assertThat(s.write(bytes(1), true)).isEqualTo(SendResult.ACCEPTED); // not yet the conversion's
    var fake = ctx.conversions().conversion("link-1");
    assertThat(fake.state()).isEqualTo(FakeConversions.FakeConversion.State.WAITING);
    assertThat(fake.dropped()).isEqualTo(1);
    fake.run();
    ctx.runUntilIdle();
    assertThat(events).hasSize(2);
    assertThat(events.get(0)).isInstanceOf(ConversionEvent.Waiting.class);
    assertThat(events.get(1)).isInstanceOf(ConversionEvent.Running.class);
    assertThat(c.write(packet(true))).isEqualTo(SendResult.ACCEPTED);
    assertThatThrownBy(fake::run).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void aFailedConversionMayStartAgainAfterAMinute() {
    var ctx = FakePluginContext.builder("fmv").build();
    var w = worker(ctx);
    StreamRef s = ctx.streams().open(spec("link-1"));
    ctx.conversions().start(ConversionSpec.mpeg2ToH264(s), w, Conv::new);
    ctx.conversions().conversion("link-1").fail(ConversionEvent.Failure.STALLED, "no output");
    ctx.runUntilIdle();
    assertThat(events.get(1)).isEqualTo(new ConversionEvent.Failed("link-1", ctx.clock(), ConversionEvent.Failure.STALLED, "no output"));
    assertThat(ctx.conversions().conversion("link-1").write(packet(true))).isEqualTo(SendResult.CLOSED);
    assertThatThrownBy(() -> ctx.conversions().start(ConversionSpec.mpeg2ToH264(s), w, Conv::new)).isInstanceOf(IllegalStateException.class).hasMessageContaining("failed");
    ctx.advance(Duration.ofSeconds(59));
    assertThatThrownBy(() -> ctx.conversions().start(ConversionSpec.mpeg2ToH264(s), w, Conv::new)).isInstanceOf(IllegalStateException.class);
    ctx.advance(Duration.ofSeconds(1));
    ConversionRef again = ctx.conversions().start(ConversionSpec.mpeg2ToH264(s), w, Conv::new);
    assertThat(ctx.conversions().conversions()).hasSize(2);
    assertThat(ctx.conversions().conversion("link-1")).isEqualTo(again);
  }

  @Test
  void closingTheTargetStopsItsConversion() {
    var ctx = FakePluginContext.builder("fmv").build();
    var w = worker(ctx);
    StreamRef s = ctx.streams().open(spec("link-1"));
    ConversionRef c = ctx.conversions().start(ConversionSpec.mpeg2ToH264(s), w, Conv::new);
    s.close();
    ctx.runUntilIdle();
    assertThat(events).extracting(e -> e.getClass().getSimpleName()).containsExactly("Running", "Stopped");
    assertThat(((ConversionEvent.Stopped) events.get(1)).reason()).isEqualTo("stream closed");
    assertThat(c.write(packet(true))).isEqualTo(SendResult.CLOSED);
    assertThatThrownBy(() -> ctx.conversions().start(ConversionSpec.mpeg2ToH264(s), w, Conv::new)).isInstanceOf(IllegalStateException.class).hasMessageContaining("closed");
  }

  @Test
  void aConversionNeedsAStreamOfTheSameContext() {
    var ctx = FakePluginContext.builder("fmv").build();
    var other = FakePluginContext.builder("fmv").build();
    var w = worker(ctx);
    StreamRef foreign = other.streams().open(spec("a"));
    assertThatThrownBy(() -> ctx.conversions().start(ConversionSpec.mpeg2ToH264(foreign), w, Conv::new)).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("this fake context");
    StreamRef mine = ctx.streams().open(spec("a"));
    assertThat(ctx.conversions().start(ConversionSpec.mpeg2ToH264(mine), w, Conv::new)).isNotNull();
    assertThatThrownBy(() -> ctx.conversions().conversion("b")).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void theRandomAccessCheckReadsEveryPacket() {
    assertThat(FakeConversions.hasRandomAccess(packet(true))).isTrue();
    assertThat(FakeConversions.hasRandomAccess(packet(false))).isFalse();
    var two = new byte[376];
    System.arraycopy(packet(false).toArray(), 0, two, 0, 188);
    System.arraycopy(packet(true).toArray(), 0, two, 188, 188);
    assertThat(FakeConversions.hasRandomAccess(Bytes.of(two))).isTrue();
    assertThat(FakeConversions.hasRandomAccess(bytes(1, 2, 3))).isFalse();
  }
}
