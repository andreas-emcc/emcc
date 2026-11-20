package dev.emcc.plugins.fmv;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.fmv.klv.Klv;
import dev.emcc.plugins.fmv.ts.Ts;
import dev.emcc.plugins.fmv.ts.Ts.Es;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.FakeStreams;
import dev.emcc.sdk.testkit.TestJson;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The transport with real sockets on loopback (brief section 4; criteria 1, 3, 4, 11): datagrams of
 * a transport stream into a link, through the task and the worker, to the stream and the map objects.
 */
class TransportTest {

  static final int VIDEO = 481;
  static final int KLV = 497;
  static final double LAT = 62.39;
  static final double LON = 17.31;

  FakePluginContext ctx;
  FmvPlugin plugin;
  DatagramSocket sender;
  int port;

  @BeforeEach
  void start() throws Exception {
    ctx = Manifest.context().build();
    plugin = new FmvPlugin(ctx::clock);
    plugin.init(ctx);
    plugin.start();
    ctx.runUntilIdle();
    sender = new DatagramSocket();
    try (var probe = new DatagramSocket(0, InetAddress.getLoopbackAddress())) {
      port = probe.getLocalPort();
    }
    ctx.changeSettings((JsonObject) TestJson.parse("{\"links\":[{\"name\":\"FMV link 1\",\"port\":" + port + "}]}"));
    waitUntil(() -> ctx.effectiveStatus().detail().contains("Listening"));
  }

  @AfterEach
  void stop() {
    sender.close();
    ctx.connections().stopAll();
    assertThat(ctx.handlerErrors()).isEmpty();
  }

  @Test
  void aBurstOfDatagramsIsNotLostWhileTheTaskReads() throws Exception {
    // A sender that stalls and then catches up sends a burst: 150 datagrams (197 KB) in a tight loop, more than a
    // default receive buffer of 64 KB holds if the reader is not quicker than the sender. The task asks for 4 MiB.
    byte[] datagram = new byte[1316];
    for (int p = 0; p < datagram.length; p += 188) {
      datagram[p] = 0x47;
      datagram[p + 1] = 0x1F; // null packets (PID 0x1FFF)
      datagram[p + 2] = (byte) 0xFF;
      datagram[p + 3] = 0x10;
    }
    for (int i = 0; i < 150; i++) {
      send(datagram);
    }
    waitUntil(() -> ctx.connectionTask("fmv-link-1").counter("datagrams") >= 150);
    assertThat(ctx.connectionTask("fmv-link-1").counter("datagrams")).isEqualTo(150);
    assertThat(ctx.connectionTask("fmv-link-1").details().get("receive buffer")).as("what the system granted").endsWith(" bytes");
  }

  void send(byte[] datagram) throws Exception {
    sender.send(new DatagramPacket(datagram, datagram.length, InetAddress.getLoopbackAddress(), port));
  }

  void waitUntil(BooleanSupplier condition) {
    long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
    while (true) {
      ctx.runUntilIdle();
      if (condition.getAsBoolean()) {
        return;
      }
      if (System.nanoTime() > deadline) {
        throw new AssertionError("waited 15 s; status: " + ctx.effectiveStatus().detail());
      }
      Thread.yield();
    }
  }

  static byte[] pat() {
    return Ts.pat(0, 1, 480);
  }

  static byte[] pmt() {
    return Ts.pmt(0, 1, 480, new Es(0x1B, VIDEO), new Es(0x06, KLV, Ts.klva()));
  }

  /** The 14th keyframe or any frame: 7 packets would be usual; here a few are enough. */
  static byte[] frame(int cc, boolean keyframe) {
    byte[] pes = Ts.datagram(new byte[] {0, 0, 1, (byte) 0xE0, 0, 0, (byte) 0x80, 0, 0}, Ts.h264Sps(66, 80, 45, 0, 0));
    return keyframe ? Ts.videoStart(VIDEO, cc, true, pes) : Ts.videoMiddle(VIDEO, cc, false, new byte[100]);
  }

  static byte[] klvSet(double heading) {
    int lat = (int) Math.round(LAT / (90.0 / Integer.MAX_VALUE));
    int lon = (int) Math.round(LON / (180.0 / Integer.MAX_VALUE));
    return Klv.set(Klv.u(5, (long) (heading / 360.0 * 65535), 2), Klv.u(13, lat & 0xFFFFFFFFL, 4), Klv.u(14, lon & 0xFFFFFFFFL, 4),
        Klv.u(16, (long) (2.0 / 180.0 * 65535), 2), Klv.u(18, 0, 4), Klv.u(21, (long) (5000.0 / 5_000_000.0 * 4294967295.0), 4), Klv.text(10, "MQ-9"));
  }

  List<MapObject> objects(String dataType) {
    return ctx.store().objects().stream().filter(o -> o.content().dataType().equals(dataType)).toList();
  }

  @Test
  void criterion1and11_aReplayReachesTheStreamUnchangedWithItsStartPointsAndHeader() throws Exception {
    // The tables and a keyframe open the stream; the worker opens it after the first datagram.
    send(Ts.datagram(pat(), pmt(), frame(0, true)));
    waitUntil(() -> !ctx.streams().openStreams().isEmpty());
    FakeStreams.FakeStream stream = ctx.streams().stream("fmv-link-1");
    assertThat(stream.spec().mediaType()).isEqualTo("video/mp2t");

    Thread.sleep(150); // the task looks at its inbox every 20 ms: it must hold the stream before the datagrams that follow
    List<byte[]> sent = new ArrayList<>();
    sent.add(Ts.datagram(frame(1, false), frame(2, false)));
    sent.add(Ts.datagram(frame(3, true)));
    sent.add(Ts.datagram(frame(4, false)));
    sent.add(Ts.datagram(Ts.klvPes(KLV, 0, klvSet(100)).toArray(byte[][]::new)));
    for (byte[] d : sent) {
      send(d);
      Thread.sleep(5); // in order on loopback; a pause so the receive loop keeps pace
    }
    waitUntil(() -> stream.chunks().size() >= sent.size());
    assertThat(stream.chunks()).hasSize(sent.size());
    for (int i = 0; i < sent.size(); i++) {
      assertThat(stream.chunks().get(i).bytes().toArray()).as("datagram " + i + " unchanged").isEqualTo(sent.get(i));
    }
    assertThat(stream.startPoints()).as("only the datagram with a random access video start").containsExactly(1);
    assertThat(stream.header().toArray()).as("the latest PAT and PMT").isEqualTo(Ts.datagram(pat(), pmt()));

    FakeStreams.FakeViewer late = stream.join();
    assertThat(late.bytes().toArray()).as("a viewer that joins starts at the last keyframe, header first")
        .isEqualTo(Ts.datagram(pat(), pmt(), sent.get(1), sent.get(2), sent.get(3)));
  }

  @Test
  void criterion3and4_theKlvSetMakesTheCameraAndItsFieldOfView() throws Exception {
    send(Ts.datagram(pat(), pmt(), frame(0, true)));
    waitUntil(() -> !ctx.streams().openStreams().isEmpty());
    send(Ts.datagram(Ts.klvPes(KLV, 0, klvSet(100)).toArray(byte[][]::new)));
    waitUntil(() -> ctx.connectionTask("fmv-link-1").counter("KLV sets read") == 1);
    ctx.advance(Duration.ofSeconds(1));
    MapObject camera = objects("fmv.camera").getFirst();
    var at = (dev.emcc.sdk.model.Geometry.Point) camera.content().geometry();
    assertThat(at.coordinates().longitude()).isEqualTo(LON, org.assertj.core.data.Offset.offset(1e-6));
    assertThat(at.coordinates().latitude()).isEqualTo(LAT, org.assertj.core.data.Offset.offset(1e-6));
    assertThat(camera.content().properties().name()).isEqualTo("MQ-9");
    assertThat(objects("fmv.field-of-view")).hasSize(1);
  }

  @Test
  void criterion13_mpeg2DatagramsGoToTheConversionAndNeitherDatagramsNorHeaderToTheStream() throws Exception {
    byte[] pmt = Ts.pmt(0, 1, 480, new Es(0x02, VIDEO), new Es(0x06, KLV, Ts.klva()));
    send(Ts.datagram(pat(), pmt, Ts.videoStart(VIDEO, 0, true, Ts.mpeg2Header(1280, 720))));
    waitUntil(() -> !ctx.streams().openStreams().isEmpty() && !ctx.conversions().conversions().isEmpty());
    var conversion = ctx.conversions().conversions().getFirst();
    Thread.sleep(150); // the task looks at its inbox every 20 ms
    List<byte[]> sent = List.of(Ts.datagram(Ts.videoMiddle(VIDEO, 1, false, new byte[100])), Ts.datagram(Ts.videoStart(VIDEO, 2, true, Ts.mpeg2Header(1280, 720))));
    for (byte[] d : sent) {
      send(d);
      Thread.sleep(5);
    }
    waitUntil(() -> conversion.input().size() >= sent.size());
    for (int i = 0; i < sent.size(); i++) {
      assertThat(conversion.input().get(i).toArray()).as("datagram " + i + " unchanged").isEqualTo(sent.get(i));
    }
    assertThat(ctx.streams().stream("fmv-link-1").header().size()).as("the plugin sets no header on a conversion's target").isZero();
  }

  @Test
  void criterion3_synchronousKlvOfType0x15IsRead() throws Exception {
    send(Ts.datagram(pat(), Ts.pmt(0, 1, 480, new Es(0x1B, VIDEO), new Es(0x15, KLV)), frame(0, true)));
    waitUntil(() -> !ctx.streams().openStreams().isEmpty());
    send(Ts.datagram(Ts.klvPes(KLV, 0, klvSet(100)).toArray(byte[][]::new)));
    waitUntil(() -> ctx.connectionTask("fmv-link-1").counter("KLV sets read") == 1);
    ctx.advance(Duration.ofSeconds(1));
    assertThat(objects("fmv.camera")).hasSize(1);
  }

  @Test
  void criterion1_aDatagramThatIsNotWholePacketsIsDroppedAndCounted() throws Exception {
    send(new byte[100]);
    send(new byte[188]); // a whole packet without its sync byte
    waitUntil(() -> ctx.connectionTask("fmv-link-1").counter("not transport stream") == 2);
    assertThat(ctx.connectionTask("fmv-link-1").counter("datagrams")).isZero();
  }

  @Test
  void criterion3_aWrongChecksumDropsTheSetAndCountsIt() throws Exception {
    send(Ts.datagram(pat(), pmt(), frame(0, true)));
    waitUntil(() -> !ctx.streams().openStreams().isEmpty());
    send(Ts.datagram(Ts.klvPes(KLV, 0, Klv.set(false, Klv.u(5, 100, 2))).toArray(byte[][]::new)));
    waitUntil(() -> ctx.connectionTask("fmv-link-1").counter("checksum") == 1);
    ctx.advance(Duration.ofSeconds(1));
    assertThat(objects("fmv.camera")).isEmpty();
  }

  @Test
  void theStatusAndThePanelsListFollowTheStream() throws Exception {
    send(Ts.datagram(pat(), pmt(), frame(0, true)));
    waitUntil(() -> ctx.effectiveStatus().detail().contains("Receiving H.264"));
    waitUntil(() -> {
      var call = ctx.call("/streams");
      ctx.runUntilIdle();
      return call.reply().body().toUtf8().contains("\"width\":1280");
    });
    var call = ctx.call("/streams");
    ctx.runUntilIdle();
    assertThat(call.reply().body().toUtf8()).contains("\"format\":\"H.264\"").contains("\"height\":720").contains("\"stream\":\"fmv-link-1\"");
  }

  @Test
  void aViewerThatLeavesMidStreamWhileSetsKeepArrivingLeavesTheRowLive() throws Exception {
    // The owner's M8 RC1 report (2026-11-16): after a window closed, the row turned Stale. The cause was the
    // recording (its sets are 39 s apart), not the viewer: a viewer leaving must not touch the reading or the sets.
    send(Ts.datagram(pat(), pmt(), frame(0, true)));
    waitUntil(() -> !ctx.streams().openStreams().isEmpty());
    FakeStreams.FakeStream stream = ctx.streams().stream("fmv-link-1");
    Thread.sleep(150); // the task looks at its inbox every 20 ms
    FakeStreams.FakeViewer viewer = stream.join();
    int videoCc = 1;
    int klvCc = 0;
    for (int second = 1; second <= 15; second++) {
      int chunks = stream.chunks().size();
      send(Ts.datagram(frame(videoCc++ & 0x0F, second % 3 == 0)));
      Thread.sleep(5);
      List<byte[]> set = Ts.klvPes(KLV, klvCc, klvSet(100 + second));
      klvCc = (klvCc + set.size()) & 0x0F;
      send(Ts.datagram(set.toArray(byte[][]::new)));
      int sets = second;
      waitUntil(() -> ctx.connectionTask("fmv-link-1").counter("KLV sets read") == sets && stream.chunks().size() == chunks + 2);
      ctx.advance(Duration.ofSeconds(1));
      if (second == 5) {
        assertThat(viewer.started()).as("it watched from a keyframe").isTrue();
        viewer.leave(); // the browser closes the window mid-stream
      }
      var call = ctx.call("/streams");
      ctx.runUntilIdle();
      assertThat(call.reply().body().toUtf8()).as("second " + second).contains("\"state\":\"live\"");
    }
    assertThat(stream.viewers()).as("the viewer is gone").isZero();
    assertThat(stream.isClosed()).as("the stream stays open for the next viewer").isFalse();
    assertThat(ctx.connectionTask("fmv-link-1").counter("continuity gap")).isZero();
    FakeStreams.FakeViewer next = stream.join();
    assertThat(next.bytes().size()).as("a new viewer starts at the last keyframe").isPositive();
  }

  @SuppressWarnings("unused")
  private static Bytes unused() {
    return Bytes.empty();
  }
}
