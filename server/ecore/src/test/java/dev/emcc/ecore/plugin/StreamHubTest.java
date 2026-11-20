package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.User;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.stream.StreamRef;
import dev.emcc.sdk.stream.StreamSpec;
import dev.emcc.sdk.stream.Streams;
import dev.emcc.sdk.worker.SendResult;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/** The stream channel's hub (SDK 1.8.0, CR-0044 E1; T-208): start buffer, slow viewers, limits, rate, close and stop. */
class StreamHubTest {

  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final String VIEW = "plugin.fmv.view";
  private static final User VIEWER = User.of("u1", "Una", Set.of(VIEW));
  private static final StreamLimits SMALL = new StreamLimits(10, 6, 2, 3);

  private final AtomicLong now = new AtomicLong(1_000_000_000L);

  private StreamHub hub(StreamLimits limits) {
    return new StreamHub(null, limits, now::get, false);
  }

  private static StreamSpec spec(String name) {
    return StreamSpec.of(name, "video/mp2t", VIEW, LABEL);
  }

  private static Bytes b(String text) {
    return Bytes.utf8(text);
  }

  private static List<String> queued(StreamHub.Viewer viewer) {
    return viewer.queuedNow().stream().map(c -> new String(c, StandardCharsets.UTF_8)).toList();
  }

  private static StreamHub.Viewer joined(StreamHub.Join join) {
    assertThat(join).isInstanceOf(StreamHub.Join.Joined.class);
    return ((StreamHub.Join.Joined) join).viewer();
  }

  @Test
  void aNewViewerStartsAtTheLastStartPointWithTheHeaderFirst() {
    StreamHub hub = hub(StreamLimits.DEFAULT);
    StreamRef s = hub.member("fmv").open(spec("link-1"));
    s.header(b("H"));
    assertThat(s.write(b("x"), false)).as("before any start point").isEqualTo(SendResult.ACCEPTED);
    s.write(b("A"), true);
    s.write(b("a"), false);

    StreamHub.Viewer late = joined(hub.join("fmv", "link-1", VIEWER));
    assertThat(queued(late)).as("header, then the chunks since the last start point").containsExactly("H", "A", "a");

    s.write(b("B"), true);
    s.write(b("b"), false);
    assertThat(queued(late)).as("then the live chunks").containsExactly("H", "A", "a", "B", "b");
    StreamHub.Viewer later = joined(hub.join("fmv", "link-1", VIEWER));
    assertThat(queued(later)).containsExactly("H", "B", "b");
    assertThat(s.viewers()).isEqualTo(2);
  }

  @Test
  void aViewerBeforeAnyStartPointWaitsForOne() {
    StreamHub hub = hub(StreamLimits.DEFAULT);
    StreamRef s = hub.member("fmv").open(spec("link-1"));
    s.write(b("x"), false);
    StreamHub.Viewer v = joined(hub.join("fmv", "link-1", VIEWER));
    s.write(b("y"), false);
    assertThat(queued(v)).isEmpty();
    s.header(b("H"));
    s.write(b("A"), true);
    assertThat(queued(v)).containsExactly("H", "A");
  }

  @Test
  void aStartBufferPastItsBoundIsEmptiedUntilTheNextStartPoint() {
    StreamHub hub = hub(SMALL); // start buffer 10 B
    StreamRef s = hub.member("fmv").open(spec("link-1"));
    s.write(b("AAAA"), true);
    s.write(b("aaaa"), false);
    s.write(b("bbbb"), false); // 12 B: past the bound
    assertThat(hub.stats().getFirst().startBufferBytes()).isZero();
    StreamHub.Viewer v = joined(hub.join("fmv", "link-1", VIEWER));
    assertThat(queued(v)).as("nothing to start from: it waits").isEmpty();
    s.write(b("c"), false);
    s.write(b("B"), true);
    assertThat(queued(v)).containsExactly("B");
    assertThat(hub.stats().getFirst().startBufferBytes()).isEqualTo(1);
  }

  @Test
  void aSlowViewerLosesItsQueueAndResumesAtTheNextStartPointHeaderFirst() {
    StreamHub hub = hub(new StreamLimits(1000, 6, 8, 32)); // a viewer's queue: 6 B
    StreamRef s = hub.member("fmv").open(spec("link-1"));
    s.header(b("H"));
    s.write(b("A"), true);
    StreamHub.Viewer slow = joined(hub.join("fmv", "link-1", VIEWER));
    StreamHub.Viewer other = joined(hub.join("fmv", "link-1", VIEWER));
    for (String c : List.of("a", "b", "c", "d", "e", "f", "g")) {
      assertThat(s.write(b(c), false)).as("the plugin is never slowed").isEqualTo(SendResult.ACCEPTED);
    }
    // its start (H, A: 2 B) is allowed beyond the bound; then 6 B more: past it at "g"
    assertThat(queued(slow)).as("lost, waiting for a start point").isEmpty();
    s.write(b("h"), false);
    assertThat(queued(slow)).isEmpty();
    s.write(b("B"), true);
    assertThat(queued(slow)).as("header first, never a cut picture").containsExactly("H", "B");
    assertThat(hub.stats().getFirst().losses()).as("both viewers took nothing").isEqualTo(2);
    assertThat(queued(other)).containsExactly("H", "B");
  }

  @Test
  void aLossAtAStartPointResumesThereAtOnce() {
    StreamHub hub = hub(new StreamLimits(1000, 4, 8, 32));
    StreamRef s = hub.member("fmv").open(spec("link-1"));
    s.write(b("A"), true);
    StreamHub.Viewer v = joined(hub.join("fmv", "link-1", VIEWER));
    s.write(b("aaaa"), false);
    s.write(b("B"), true); // past 1 + 4 B: lost, and B is a start point
    assertThat(queued(v)).containsExactly("B");
    assertThat(hub.stats().getFirst().losses()).isEqualTo(1);
  }

  @Test
  void viewersAreLimitedPerStreamAndInAll() {
    StreamHub hub = hub(SMALL); // 2 per stream, 3 in all
    StreamHub.Member fmv = hub.member("fmv");
    fmv.open(spec("one"));
    fmv.open(spec("two"));
    StreamHub.Viewer a = joined(hub.join("fmv", "one", VIEWER));
    joined(hub.join("fmv", "one", VIEWER));
    assertThat(hub.join("fmv", "one", VIEWER)).isInstanceOf(StreamHub.Join.Busy.class);
    joined(hub.join("fmv", "two", VIEWER));
    assertThat(hub.join("fmv", "two", VIEWER)).as("3 in all").isInstanceOf(StreamHub.Join.Busy.class);
    assertThat(hub.viewers()).isEqualTo(3);
    a.cancel();
    assertThat(hub.viewers()).isEqualTo(2);
    joined(hub.join("fmv", "two", VIEWER));
  }

  @Test
  void anUnknownStreamIsNotFoundAndAMissingPermissionIsForbidden() {
    StreamHub hub = hub(StreamLimits.DEFAULT);
    hub.member("fmv").open(spec("link-1"));
    assertThat(hub.join("fmv", "link-2", VIEWER)).isInstanceOf(StreamHub.Join.NotFound.class);
    assertThat(hub.join("gmti", "link-1", VIEWER)).isInstanceOf(StreamHub.Join.NotFound.class);
    assertThat(hub.join("fmv", "link-1", User.of("u2", "Bo", Set.of()))).isInstanceOf(StreamHub.Join.Forbidden.class);
    assertThat(hub.join("fmv", "link-1", User.noLoginUser())).as("no login: every permission").isInstanceOf(StreamHub.Join.Joined.class);
  }

  @Test
  void chunksPastTheRateAreDroppedAndCountedUntilTheNextSecond() {
    StreamHub hub = hub(StreamLimits.DEFAULT);
    StreamRef s = hub.member("fmv").open(spec("link-1"));
    Bytes chunk = Bytes.of(new byte[Streams.MAX_CHUNK]);
    long fit = Streams.MAX_RATE / 8 / Streams.MAX_CHUNK;
    for (int i = 0; i < fit; i++) {
      assertThat(s.write(chunk, false)).isEqualTo(SendResult.ACCEPTED);
    }
    assertThat(s.write(chunk, false)).isEqualTo(SendResult.DROPPED);
    assertThat(hub.stats().getFirst().dropped()).isEqualTo(1);
    now.addAndGet(TimeUnit.SECONDS.toNanos(1));
    assertThat(s.write(chunk, false)).isEqualTo(SendResult.ACCEPTED);
    assertThat(hub.stats().getFirst().bytesIn()).isEqualTo((fit + 1) * Streams.MAX_CHUNK);
  }

  @Test
  void writesAndHeadersAreChecked() {
    StreamHub hub = hub(StreamLimits.DEFAULT);
    StreamRef s = hub.member("fmv").open(spec("link-1"));
    assertThatThrownBy(() -> s.write(Bytes.empty(), true)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> s.write(Bytes.of(new byte[Streams.MAX_CHUNK + 1]), true)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> s.header(Bytes.of(new byte[Streams.MAX_HEADER + 1]))).isInstanceOf(IllegalArgumentException.class);
    s.label(SecurityLabel.of("NATO", "RESTRICTED"));
    assertThat(((StreamHub.Stream) s).label().classification()).isEqualTo("RESTRICTED");
  }

  @Test
  void aNameIsOpenOnceAndAPluginHasAtMostMaxOpen() {
    StreamHub hub = hub(StreamLimits.DEFAULT);
    StreamHub.Member fmv = hub.member("fmv");
    StreamRef first = fmv.open(spec("s0"));
    assertThatThrownBy(() -> fmv.open(spec("s0"))).isInstanceOf(IllegalStateException.class);
    for (int i = 1; i < Streams.MAX_OPEN; i++) {
      fmv.open(spec("s" + i));
    }
    assertThatThrownBy(() -> fmv.open(spec("more"))).isInstanceOf(IllegalStateException.class);
    first.close();
    StreamRef again = fmv.open(spec("s0"));
    assertThat(again).as("a new handle, equal by id").isNotEqualTo(first).isEqualTo(again);
    assertThat(again.hashCode()).isEqualTo(again.id().hashCode());
  }

  @Test
  void closingEndsTheViewersAndLaterWritesAreClosed() {
    StreamHub hub = hub(StreamLimits.DEFAULT);
    StreamRef s = hub.member("fmv").open(spec("link-1"));
    s.write(b("A"), true);
    StreamHub.Viewer v = joined(hub.join("fmv", "link-1", VIEWER));
    s.close();
    s.close(); // no effect
    assertThat(v.endReason()).isEqualTo("the plugin closed it");
    assertThat(s.write(b("B"), true)).isEqualTo(SendResult.CLOSED);
    assertThat(s.viewers()).as("its viewers leave when their threads end").isEqualTo(1);
    assertThat(hub.join("fmv", "link-1", VIEWER)).isInstanceOf(StreamHub.Join.NotFound.class);
    assertThat(hub.stats()).isEmpty();
  }

  @Test
  void aStoppedPluginsStreamsCloseAndItOpensNoMore() {
    StreamHub hub = hub(StreamLimits.DEFAULT);
    StreamHub.Member fmv = hub.member("fmv");
    StreamRef s = fmv.open(spec("link-1"));
    s.write(b("A"), true);
    StreamHub.Viewer v = joined(hub.join("fmv", "link-1", VIEWER));
    hub.release(fmv);
    assertThat(v.endReason()).isEqualTo("the plugin stopped");
    assertThat(s.write(b("B"), true)).isEqualTo(SendResult.CLOSED);
    assertThatThrownBy(() -> fmv.open(spec("link-2"))).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void aViewerWhoseWriteTakesNothingFor30sIsClosed() {
    StreamHub hub = hub(StreamLimits.DEFAULT);
    StreamRef s = hub.member("fmv").open(spec("link-1"));
    StreamHub.Viewer stalled = joined(hub.join("fmv", "link-1", VIEWER));
    StreamHub.Viewer idle = joined(hub.join("fmv", "link-1", VIEWER));
    stalled.writingSince = now.get();
    now.addAndGet(Streams.VIEWER_STALL.toNanos() - 1);
    hub.checkStalls();
    assertThat(stalled.endReason()).isNull();
    now.addAndGet(1);
    hub.checkStalls();
    assertThat(stalled.endReason()).isEqualTo("it took nothing for 30 s");
    assertThat(idle.endReason()).as("a quiet stream does not close its viewers").isNull();
    assertThat(s.viewers()).isEqualTo(2);
  }

  @Test
  void aViewersThreadWritesWhatIsQueuedFlushesAndEndsItsResponse() throws Exception {
    StreamHub hub = hub(StreamLimits.DEFAULT);
    StreamRef s = hub.member("fmv").open(spec("link-1"));
    s.header(b("H"));
    s.write(b("A"), true);
    StreamHub.Viewer v = joined(hub.join("fmv", "link-1", VIEWER));
    RecordingSink sink = new RecordingSink();
    v.start(sink);
    Thread t = Thread.ofVirtual().start(v::runLoop);
    assertThat(sink.flushed.await(5, TimeUnit.SECONDS)).isTrue();
    assertThat(sink.text()).isEqualTo("HA");
    s.write(b("B"), true);
    s.close();
    t.join(5_000);
    assertThat(t.isAlive()).isFalse();
    assertThat(sink.ended).isTrue();
    assertThat(s.viewers()).isZero();
    assertThat(hub.viewers()).isZero();
  }

  @Test
  void aViewerWhoseBrowserWentAwayEndsAndLeaves() throws Exception {
    StreamHub hub = hub(StreamLimits.DEFAULT);
    StreamRef s = hub.member("fmv").open(spec("link-1"));
    s.write(b("A"), true);
    StreamHub.Viewer v = joined(hub.join("fmv", "link-1", VIEWER));
    RecordingSink sink = new RecordingSink();
    sink.fail = true;
    v.start(sink);
    v.runLoop(); // ends at the first write
    assertThat(v.endReason()).isEqualTo("the browser went away (IOException)");
    assertThat(sink.ended).isTrue();
    assertThat(s.viewers()).isZero();
  }

  @Test
  void endingTheViewersBeforeTheWebServerStopsKeepsTheStreamsOpen() {
    StreamHub hub = hub(StreamLimits.DEFAULT);
    StreamRef s = hub.member("fmv").open(spec("link-1"));
    StreamHub.Viewer v = joined(hub.join("fmv", "link-1", VIEWER));
    RecordingSink sink = new RecordingSink();
    v.start(sink);
    hub.endViewers("the server is stopping");
    assertThat(v.endReason()).isEqualTo("the server is stopping");
    assertThat(sink.aborted).isTrue();
    assertThat(s.write(b("A"), true)).isEqualTo(SendResult.ACCEPTED);
  }

  @Test
  void aRunningHubGivesEachViewerAThreadAndClosesAtTheEnd() throws Exception {
    try (WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults())) {
      StreamHub hub = new StreamHub(runtime, StreamLimits.DEFAULT);
      StreamRef s = hub.member("fmv").open(spec("link-1"));
      s.write(b("A"), true);
      StreamHub.Viewer v = joined(hub.join("fmv", "link-1", VIEWER));
      RecordingSink sink = new RecordingSink();
      v.start(sink);
      assertThat(sink.flushed.await(5, TimeUnit.SECONDS)).isTrue();
      s.write(b("B"), false);
      long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
      while (!sink.text().equals("AB") && System.nanoTime() < until) {
        Thread.onSpinWait();
      }
      assertThat(sink.text()).as("the live chunk too").isEqualTo("AB");
      hub.close();
      assertThat(sink.endedLatch.await(5, TimeUnit.SECONDS)).isTrue();
      assertThat(s.write(b("C"), true)).isEqualTo(SendResult.CLOSED);
    }
  }

  /** A browser that takes everything. */
  private static final class RecordingSink implements StreamSink {
    private final ByteArrayOutputStream out = new ByteArrayOutputStream();
    final CountDownLatch flushed = new CountDownLatch(1);
    final CountDownLatch endedLatch = new CountDownLatch(1);
    volatile boolean ended;
    volatile boolean aborted;
    volatile boolean fail;

    @Override
    public synchronized void write(byte[] chunk) throws IOException {
      if (fail) {
        throw new IOException("gone");
      }
      out.write(chunk);
    }

    @Override
    public void flush() {
      flushed.countDown();
    }

    @Override
    public void end() {
      ended = true;
      endedLatch.countDown();
    }

    @Override
    public void abort() {
      aborted = true;
    }

    synchronized String text() {
      return out.toString(StandardCharsets.UTF_8);
    }
  }
}
