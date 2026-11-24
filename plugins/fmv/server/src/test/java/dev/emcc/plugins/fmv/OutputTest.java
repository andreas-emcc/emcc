package dev.emcc.plugins.fmv;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.fmv.klv.St0601;
import dev.emcc.plugins.fmv.ts.Program;
import dev.emcc.plugins.fmv.ts.TsMuxer;
import dev.emcc.plugins.fmv.ts.TsReader;
import dev.emcc.plugins.fmv.ts.VideoSize;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelInfo;
import dev.emcc.sdk.channel.ChannelState;
import dev.emcc.sdk.channel.DeclaredItem;
import dev.emcc.sdk.compute.ComputeEvent;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.stream.ConversionEvent;
import dev.emcc.sdk.stream.Conversions;
import dev.emcc.sdk.stream.EncoderRef;
import dev.emcc.sdk.stream.EncoderSpec;
import dev.emcc.sdk.testkit.FakeComputes;
import dev.emcc.sdk.testkit.FakeConversions;
import dev.emcc.sdk.testkit.FakeConversions.FakeEncoder;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.TestJson;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.locks.LockSupport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The output link (brief section 10; criteria 23 to 28, the encoder of section 10.4, and the
 * pipeline end to end). Poses come through the test kit's channels, the compute task and the
 * sender really run, and ECore's encoder is the test kit's ({@link FakeEncoder}, part U): the test
 * makes it give an access unit for each picture the task wrote.
 */
class OutputTest {

  static final String LINK = "0193a1f2-7c4e-7d10-9a3b-000000000001";
  static final String OTHER_LINK = "0193a1f2-7c4e-7d10-9a3b-000000000002";
  static final UUID CAMERA = UUID.fromString("0193a1f2-7c4e-7d10-9a3b-2f6e8c1d4b57");
  static final UUID SECOND_CAMERA = UUID.fromString("0193a1f2-7c4e-7d10-9a3b-2f6e8c1d4b58");
  static final SecurityLabel UNCLASSIFIED = SecurityLabel.of("NATO", "UNCLASSIFIED");

  @TempDir Path terrain;
  @TempDir Path imagery;

  FakePluginContext ctx;
  FmvPlugin plugin;
  long sequence;

  void start(int computeThreads) {
    ctx = Manifest.context().compute(computeThreads).folder("terrain", terrain).folder("imagery", imagery).build();
    JsonObject kind = (JsonObject) ((JsonArray) Manifest.read().get("channelKinds")).get(0);
    ctx.channels().declare("fmv.camera-pose", kind.getObject("payload"));
    plugin = new FmvPlugin(ctx::clock);
    plugin.init(ctx);
    plugin.start();
    ctx.runUntilIdle();
  }

  /** The encoders the link started, in order (a new name each: {@code out-<id>-<generation>}). */
  List<FakeEncoder> encoders(String link) {
    return ctx.conversions().encoders().stream().filter(e -> e.name().startsWith("out-" + link + "-")).toList();
  }

  /** The link's latest encoder. */
  FakeEncoder encoder(String link) {
    return encoders(link).getLast();
  }

  /** Every picture the link's encoders accepted. */
  int pictures(String link) {
    return encoders(link).stream().mapToInt(e -> e.pictures().size()).sum();
  }

  /** The encoder gives an access unit (a delimiter and a slice, a keyframe every 25th) for each picture waiting. */
  void encode(FakeEncoder e) {
    while (e.waiting() > 0) {
      boolean key = sequence++ % 25 == 0;
      byte[] au = new byte[key ? 4000 : 600];
      au[2] = 1;
      au[3] = 0x09;
      au[4] = (byte) 0xF0;
      au[7] = 1;
      au[8] = (byte) (key ? 0x65 : 0x41);
      e.emit(key, Bytes.of(au));
    }
  }

  /** The link's channel as its senders see it. */
  ChannelInfo channel(String link) {
    return ctx.channels().offered().stream().filter(c -> c.id().equals(new ChannelId("fmv", "out-" + link))).findFirst().orElseThrow();
  }

  @AfterEach
  void stop() {
    if (ctx != null) {
      ctx.compute().stopAll();
      ctx.connections().stopAll();
      assertThat(ctx.handlerErrors()).isEmpty();
    }
  }

  void useLinks(String... entries) {
    ctx.changeSettings((JsonObject) TestJson.parse("{\"links\":[" + String.join(",", entries) + "]}"));
    ctx.runUntilIdle();
  }

  static String out(String id, String name, String more) {
    return "{\"id\":\"" + id + "\",\"name\":\"" + name + "\",\"direction\":\"out\"" + more + "}";
  }

  static String to(int port) {
    return ",\"mode\":\"udp\",\"address\":\"127.0.0.1\",\"port\":" + port;
  }

  /** A pose of a camera at the frame time {@code time}, 640 × 360 at 25 frames a second, looking 30° down. */
  static DeclaredItem pose(UUID camera, SecurityLabel label, Instant time) {
    String json = String.format(Locale.ROOT, """
        {"camera":"%s","time":"%s","platform":{"position":[17.3,62.4,1000],"heading":45,"pitch":0,"roll":0,"name":"Hawk 1"},
         "pointing":{"azimuth":90,"depression":30,"roll":0},"fieldOfView":{"horizontal":20,"vertical":11.4},
         "frame":{"width":640,"height":360,"rate":25},"mission":"RECCE NORTH"}""", camera, time);
    return new DeclaredItem("fmv.camera-pose", camera, label, (JsonObject) TestJson.parse(json));
  }

  void send(String link, UUID camera, SecurityLabel label) {
    ctx.channels().deliver(new ChannelId("fmv", "out-" + link), pose(camera, label, ctx.clock()));
    ctx.runUntilIdle();
  }

  /** The plugin's status after the output worker's next tick, which publishes its lines. */
  String status() {
    ctx.advance(Duration.ofMillis(500));
    ctx.runUntilIdle();
    return ctx.pluginStatus().detail();
  }

  static int freePort() {
    try (var s = new DatagramSocket(0, InetAddress.getLoopbackAddress())) {
      return s.getLocalPort();
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  @Test
  void criterion23TheChannelTakesTheDeclaredPoseOnlyAndARenameKeepsItsId() {
    start(8);
    useLinks(out(LINK, "UAV North", ""));
    ChannelInfo offered = ctx.channels().offered().getFirst();
    assertThat(offered.id()).isEqualTo(new ChannelId("fmv", "out-" + LINK));
    assertThat(offered.name()).isEqualTo("UAV North");
    assertThat(offered.declaredKinds()).containsExactly("fmv.camera-pose");
    assertThat(offered.kinds()).isEmpty();
    assertThat(offered.takesDeclared("fmv.camera-pose")).isTrue();

    useLinks(out(LINK, "UAV North 2", ""));
    assertThat(ctx.channels().offered()).singleElement().satisfies(c -> {
      assertThat(c.id()).isEqualTo(new ChannelId("fmv", "out-" + LINK));
      assertThat(c.name()).isEqualTo("UAV North 2");
    });

    useLinks(out(LINK, "UAV North 2", ",\"enabled\":false"));
    assertThat(ctx.channels().offered()).isEmpty();
    assertThat(status()).contains("UAV North 2 [out, no destination]: Disabled");

    useLinks();
    assertThat(ctx.channels().offered()).isEmpty();
  }

  @Test
  void anInputLinkOffersNoChannelAndTheInputWorkerLeavesOutputLinksAlone() {
    start(8);
    useLinks(out(LINK, "UAV North", ""), "{\"name\":\"In 1\",\"port\":9,\"enabled\":false}");
    assertThat(ctx.channels().offered()).extracting(ChannelInfo::name).containsExactly("UAV North");
    assertThat(status()).contains("In 1 [").contains("UAV North [out, no destination]").doesNotContain("is named or identified twice");
  }

  @Test
  void criterion24ANewOutputLinkSendsNothingAndRendersOnceItHasADestination() {
    start(8);
    useLinks(out(LINK, "UAV North", ""));
    send(LINK, CAMERA, UNCLASSIFIED);
    assertThat(ctx.compute().names()).isEmpty();
    assertThat(ctx.conversions().encoders()).isEmpty();
    assertThat(status()).contains("UAV North [out, no destination]: No destination");
    assertThat(channel(LINK).state()).isEqualTo(ChannelState.NOT_SENDING); // part U: the senders see it (section 10.2 point 7)
    assertThat(channel(LINK).stateDetail()).isEqualTo("No destination");

    useLinks(out(LINK, "UAV North", to(freePort())));
    send(LINK, CAMERA, UNCLASSIFIED);
    String task = "render-" + LINK;
    assertThat(ctx.compute().names()).containsExactly(task);
    ctx.computeTask(task).awaitIdle();
    FakeEncoder e = encoder(LINK);
    assertThat(e.spec()).isEqualTo(new EncoderSpec("out-" + LINK + "-1", 640, 360, 25, 4_000_000, 1)); // the link's defaults (section 10.2 point 4)
    assertThat(e.pictures()).singleElement().satisfies(p -> assertThat(p.data().size()).isEqualTo(640 * 360 * 3 / 2)); // one I420 picture (CR-0050 point 1.4)
    assertThat(ctx.computeTask(task).counter("rendered")).isEqualTo(1);
    assertThat(status()).contains("Rendering Hawk 1 640×360 25");
    assertThat(channel(LINK).state()).isEqualTo(ChannelState.READY);
    assertThat(channel(LINK).stateDetail()).isEmpty();
  }

  @Test
  void section10point4WithoutAConverterTheLinkStopsUntilItsSettingsChange() {
    start(8);
    int port = freePort();
    useLinks(out(LINK, "UAV North", to(port)));
    send(LINK, CAMERA, UNCLASSIFIED);
    encoder(LINK).fail(ConversionEvent.Failure.UNAVAILABLE, "no converter");
    ctx.runUntilIdle();
    assertThat(ctx.compute().names()).isEmpty(); // the thread is free (owner, Q3)
    assertThat(ctx.connections().names()).isEmpty();
    assertThat(status()).contains("UAV North [out, udp 127.0.0.1:").contains("No encoder installed (no converter)");
    assertThat(ctx.pluginStatus().state().name()).isEqualTo("DEGRADED");
    assertThat(channel(LINK).state()).isEqualTo(ChannelState.NOT_SENDING);
    assertThat(channel(LINK).stateDetail()).isEqualTo("No encoder installed");

    for (int i = 0; i < 130; i++) { // poses for more than RETRY_AFTER: nothing starts again (owner, 2026-11-17)
      ctx.advance(Duration.ofMillis(500));
      send(LINK, CAMERA, UNCLASSIFIED);
    }
    assertThat(encoders(LINK)).hasSize(1);
    assertThat(ctx.compute().names()).isEmpty();
    assertThat(status()).contains("No encoder installed");

    String same = out(LINK, "UAV North", to(port));
    ctx.changeSettings((JsonObject) TestJson.parse("{\"links\":[" + same + "],\"wms\":{\"enabled\":false}}")); // another setting: still nothing
    ctx.runUntilIdle();
    send(LINK, CAMERA, UNCLASSIFIED);
    assertThat(encoders(LINK)).hasSize(1);
    assertThat(status()).contains("No encoder installed");

    useLinks(out(LINK, "UAV North", to(freePort()))); // a change of the link's own settings tries it again
    send(LINK, CAMERA, UNCLASSIFIED);
    assertThat(encoders(LINK)).hasSize(2);
    assertThat(encoder(LINK).name()).isEqualTo("out-" + LINK + "-2");
    ctx.computeTask("render-" + LINK).awaitIdle();
    assertThat(status()).contains("Rendering Hawk 1");
  }

  @Test
  void section10point4WaitingForASlotDropsThePicturesAndTellsTheSenders() {
    start(8);
    ctx.conversions().holdNew(true);
    useLinks(out(LINK, "UAV North", to(freePort())));
    send(LINK, CAMERA, UNCLASSIFIED);
    String task = "render-" + LINK;
    ctx.computeTask(task).awaitIdle();
    assertThat(ctx.computeTask(task).counter("encoder dropped")).isEqualTo(1);
    assertThat(status()).contains("Waiting for a conversion slot");
    assertThat(channel(LINK).state()).isEqualTo(ChannelState.NOT_SENDING);
    assertThat(channel(LINK).stateDetail()).isEqualTo("Waiting for a conversion slot");
    ctx.advance(Duration.ofMillis(40));
    send(LINK, CAMERA, UNCLASSIFIED); // still waiting: the next pose says so too
    ctx.computeTask(task).awaitIdle();
    assertThat(status()).contains("Waiting for a conversion slot").doesNotContain("Rendering");
    assertThat(channel(LINK).state()).isEqualTo(ChannelState.NOT_SENDING);

    encoder(LINK).run(); // a slot freed
    ctx.runUntilIdle();
    ctx.advance(Duration.ofMillis(40));
    send(LINK, CAMERA, UNCLASSIFIED);
    ctx.computeTask(task).awaitIdle();
    assertThat(encoder(LINK).pictures()).hasSize(1);
    assertThat(status()).contains("Rendering Hawk 1");
    assertThat(channel(LINK).state()).isEqualTo(ChannelState.READY);
  }

  @Test
  void section10point4AFailedEncoderIsStartedAgainAfterRetryAfterWhileTheTaskGoesOn() {
    start(8);
    useLinks(out(LINK, "UAV North", to(freePort())));
    send(LINK, CAMERA, UNCLASSIFIED);
    String task = "render-" + LINK;
    ctx.computeTask(task).awaitIdle();
    encoder(LINK).fail(ConversionEvent.Failure.STALLED, "");
    Instant failed = ctx.clock();
    ctx.runUntilIdle();
    ctx.advance(Duration.ofMillis(40));
    send(LINK, CAMERA, UNCLASSIFIED);
    ctx.computeTask(task).awaitIdle();
    assertThat(ctx.computeTask(task).counter("no encoder")).isEqualTo(1); // nothing rendered meanwhile
    assertThat(status()).contains("Encoder failed, started again after 60 s (encoder stalled)");
    assertThat(channel(LINK).state()).isEqualTo(ChannelState.NOT_SENDING);

    while (encoders(LINK).size() < 2 && Duration.between(failed, ctx.clock()).toSeconds() < 70) {
      ctx.advance(Duration.ofMillis(500));
      send(LINK, CAMERA, UNCLASSIFIED);
    }
    assertThat(encoders(LINK)).hasSize(2);
    assertThat(Duration.between(failed, ctx.clock())).isBetween(Conversions.RETRY_AFTER, Conversions.RETRY_AFTER.plusSeconds(1));
    assertThat(ctx.computeTask(task).restarts()).isZero(); // the same task, its transport stream going on
    ctx.advance(Duration.ofMillis(40));
    send(LINK, CAMERA, UNCLASSIFIED);
    ctx.computeTask(task).awaitIdle();
    var t = ctx.computeTask(task);
    assertThat(encoder(LINK).pictures()).as("rendered %d, late %d, no encoder %d, dropped %d, encoder %s", t.counter("rendered"), t.counter("late"),
        t.counter("no encoder"), t.counter("encoder dropped"), encoder(LINK)).isNotEmpty();
    assertThat(status()).contains("Rendering Hawk 1");
  }

  @Test
  void o10AChangedFolderSettingRestartsThePipelineSoTheNextPoseReadsTheNewFolder() {
    start(8);
    String link = out(LINK, "UAV North", to(freePort()));
    useLinks(link);
    send(LINK, CAMERA, UNCLASSIFIED);
    assertThat(ctx.compute().names()).containsExactly("render-" + LINK);
    ctx.changeSettings((JsonObject) TestJson.parse("{\"links\":[" + link + "],\"imageryFolder\":\"%emcc%/settings/other-imagery\"}"));
    ctx.runUntilIdle();
    assertThat(ctx.compute().names()).isEmpty(); // found live on 18106: the old set stayed until the camera stopped
    assertThat(encoder(LINK).state()).isEqualTo(FakeConversions.FakeConversion.State.STOPPED);
    ctx.advance(Duration.ofMillis(40));
    send(LINK, CAMERA, UNCLASSIFIED);
    assertThat(ctx.compute().names()).containsExactly("render-" + LINK);
    assertThat(encoders(LINK)).hasSize(2);
  }

  @Test
  void o10ANewFrameSizeStartsAnEncoderOfThatSize() {
    start(8);
    useLinks(out(LINK, "UAV North", to(freePort())));
    send(LINK, CAMERA, UNCLASSIFIED);
    for (int i = 0; i < 2; i++) {
      String json = String.format(Locale.ROOT, """
          {"camera":"%s","time":"%s","platform":{"position":[17.3,62.4,1000],"heading":45,"pitch":0,"roll":0,"name":"Hawk 1"},
           "pointing":{"azimuth":90,"depression":30,"roll":0},"fieldOfView":{"horizontal":20,"vertical":11.4},
           "frame":{"width":1280,"height":720,"rate":25}}""", CAMERA, ctx.clock());
      ctx.channels().deliver(new ChannelId("fmv", "out-" + LINK), new DeclaredItem("fmv.camera-pose", CAMERA, UNCLASSIFIED, (JsonObject) TestJson.parse(json)));
      ctx.runUntilIdle();
      ctx.computeTask("render-" + LINK).awaitIdle();
      ctx.advance(Duration.ofMillis(40));
    }
    assertThat(encoders(LINK)).hasSize(2);
    assertThat(encoders(LINK).getFirst().state()).isEqualTo(FakeConversions.FakeConversion.State.STOPPED);
    assertThat(encoder(LINK).spec().width()).isEqualTo(1280);
    assertThat(encoder(LINK).spec().height()).isEqualTo(720);
    // the old encoder's Stopped came after the new one started: it changes nothing for the new one
    assertThat(encoder(LINK).pictures()).isNotEmpty();
    assertThat(status()).contains("Rendering Hawk 1 1280×720 25");
  }

  @Test
  void criterion25OneCameraALinkAndTheSecondTakesItTwoSecondsAfterTheFirstStops() {
    start(8);
    useLinks(out(LINK, "UAV North", to(freePort())));
    String task = "render-" + LINK;
    send(LINK, CAMERA, UNCLASSIFIED);
    send(LINK, SECOND_CAMERA, UNCLASSIFIED);
    ctx.computeTask(task).awaitIdle();
    assertThat(pictures(LINK)).isEqualTo(1);
    assertThat(status()).contains("other camera 1");

    ctx.advance(Duration.ofMillis(2100)); // the first camera's last pose is 2 s old: the link is free (O2), its task and encoder stopped
    ctx.runUntilIdle();
    assertThat(encoder(LINK).state()).isEqualTo(FakeConversions.FakeConversion.State.STOPPED); // its conversion slot is free
    send(LINK, SECOND_CAMERA, UNCLASSIFIED);
    ctx.computeTask(task).awaitIdle();
    assertThat(pictures(LINK)).isEqualTo(2);
    assertThat(status()).contains("other camera 1").contains("Rendering");
  }

  @Test
  void criterion26TheReleaseLimitStopsASecretPoseAndLetsAnUnclassifiedOneThrough() {
    start(8);
    useLinks(out(LINK, "UAV North", to(freePort()) + ",\"highestClassification\":{\"policy\":\"NATO\",\"classification\":\"RESTRICTED\"}"));
    send(LINK, CAMERA, SecurityLabel.of("NATO", "SECRET"));
    assertThat(ctx.compute().names()).isEmpty();
    assertThat(status()).contains("Above release limit").contains("above release limit 1");

    send(LINK, CAMERA, UNCLASSIFIED);
    ctx.computeTask("render-" + LINK).awaitIdle();
    assertThat(pictures(LINK)).isEqualTo(1);
  }

  @Test
  void withoutAHighestClassificationTheLimitIsTheServersDefaultLabelAdr0037Point8() {
    start(8);
    assertThat(ctx.defaultLabel().classification()).isEqualTo("UNCLASSIFIED");
    useLinks(out(LINK, "UAV North", to(freePort())));
    send(LINK, CAMERA, SecurityLabel.of("NATO", "RESTRICTED"));
    assertThat(ctx.compute().names()).isEmpty();
    assertThat(status()).contains("Above release limit");
  }

  @Test
  void criterion27OneThreadSecondLinkRefusedThenStartsWithinTenSecondsOfTheFirstFreeingIt() {
    start(1);
    useLinks(out(LINK, "UAV North", to(freePort())), out(OTHER_LINK, "UAV South", to(freePort())));
    send(LINK, CAMERA, UNCLASSIFIED);
    send(OTHER_LINK, SECOND_CAMERA, UNCLASSIFIED);
    assertThat(ctx.compute().refused(ComputeEvent.Refusal.PLUGIN_LIMIT)).isEqualTo(1);
    assertThat(status()).contains("UAV South [out, udp").contains("No render thread (PLUGIN_LIMIT)");

    // the first camera stops; 2 s later its link frees the thread and the encoder
    for (int i = 0; i < 6; i++) {
      ctx.advance(Duration.ofMillis(500));
      ctx.runUntilIdle();
      send(OTHER_LINK, SECOND_CAMERA, UNCLASSIFIED); // the second camera's poses keep coming
    }
    assertThat(encoder(LINK).state()).isEqualTo(FakeConversions.FakeConversion.State.STOPPED); // 2 s without poses stops the encoder too
    Instant freed = ctx.clock();
    for (int i = 0; i < 40 && !ctx.compute().names().contains("render-" + OTHER_LINK); i++) {
      ctx.advance(Duration.ofMillis(500));
      ctx.runUntilIdle();
      send(OTHER_LINK, SECOND_CAMERA, UNCLASSIFIED);
    }
    assertThat(ctx.compute().names()).contains("render-" + OTHER_LINK);
    assertThat(Duration.between(freed, ctx.clock())).isLessThanOrEqualTo(Duration.ofSeconds(10));
    ctx.computeTask("render-" + OTHER_LINK).awaitIdle();
    assertThat(status()).contains("UAV South [out, udp").contains("Rendering");
  }

  @Test
  void criterion28APoseOlderThanAFramePeriodIsSkippedAndCounted() {
    start(8);
    useLinks(out(LINK, "UAV North", to(freePort())));
    send(LINK, CAMERA, UNCLASSIFIED); // starts the pipeline
    String task = "render-" + LINK;
    ctx.computeTask(task).awaitIdle();
    ctx.channels().deliver(new ChannelId("fmv", "out-" + LINK), pose(CAMERA, UNCLASSIFIED, ctx.clock().minusMillis(200)));
    ctx.runUntilIdle();
    ctx.computeTask(task).awaitIdle();
    assertThat(ctx.computeTask(task).counter("late")).isEqualTo(1);
    assertThat(pictures(LINK)).isEqualTo(1);
  }

  @Test
  void aFullEncoderDropsThePictureAndCountsIt() {
    start(8);
    useLinks(out(LINK, "UAV North", to(freePort())));
    String task = "render-" + LINK;
    for (int i = 0; i < 3; i++) { // the encoder gives nothing back: two pictures wait (MAX_WAITING), the third is dropped
      send(LINK, CAMERA, UNCLASSIFIED);
      ctx.computeTask(task).awaitIdle();
      ctx.advance(Duration.ofMillis(40));
    }
    assertThat(encoder(LINK).waiting()).isEqualTo(EncoderRef.MAX_WAITING);
    assertThat(ctx.computeTask(task).counter("encoder dropped")).isEqualTo(1);
  }

  @Test
  void endToEndAPoseLeavesAsStanag4609OverUdpWithItsSt0601() throws Exception {
    start(8);
    try (var receiver = new DatagramSocket(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0))) {
      receiver.setSoTimeout(5000);
      useLinks(out(LINK, "UAV North", to(receiver.getLocalPort())));
      String task = "render-" + LINK;
      for (int i = 0; i < 3; i++) {
        send(LINK, CAMERA, UNCLASSIFIED);
        ctx.computeTask(task).awaitIdle();
        encode(encoder(LINK)); // ECore's access unit back into the task's inbox
        ctx.computeTask(task).awaitIdle();
        ctx.advance(Duration.ofMillis(40));
      }
      assertThat(ctx.computeTask(task).counter("encoded")).isEqualTo(3);
      assertThat(ctx.computeTask(task).counter("muxed")).isEqualTo(3);

      List<byte[]> klv = new ArrayList<>();
      List<Program> programs = new ArrayList<>();
      TsReader reader = new TsReader();
      TsReader.Sink sink = new TsReader.Sink() {
        @Override public void program(Program program) {
          programs.add(program);
        }

        @Override public void header(byte[] packets) {}

        @Override public void klv(byte[] payload) {
          klv.add(payload);
        }

        @Override public void dropped(String reason) {
          throw new AssertionError("dropped: " + reason);
        }

        @Override public void size(VideoSize size) {}
      };
      byte[] buffer = new byte[65_536];
      int datagrams = 0;
      while (klv.size() < 3) {
        var p = new DatagramPacket(buffer, buffer.length);
        try {
          receiver.receive(p);
        } catch (SocketTimeoutException e) {
          throw new AssertionError("got " + datagrams + " datagrams and " + klv.size() + " KLV sets", e);
        }
        assertThat(p.getLength()).isEqualTo(TsMuxer.DATAGRAM);
        reader.feed(buffer, 0, p.getLength(), sink);
        datagrams++;
      }
      assertThat(programs.getLast().videoPid()).isEqualTo(TsMuxer.VIDEO_PID);
      var set = St0601.read(klv.getFirst()).getFirst();
      assertThat(set.dropped()).isNull();
      var m = set.metadata();
      assertThat(m.relativeElevation()).isCloseTo(-30, org.assertj.core.api.Assertions.within(0.01)); // tag 19 = −depression (section 10.1 point 2)
      assertThat(m.heading()).isCloseTo(45, org.assertj.core.api.Assertions.within(0.01));
      assertThat(m.platformDesignation()).isEqualTo("Hawk 1");
      assertThat(m.missionId()).isEqualTo("RECCE NORTH");
      assertThat(m.security().classification()).isEqualTo(1);
      assertThat(m.security().country()).isEqualTo("//NATO");
      assertThat(m.hasFrameCenter()).isTrue();
    }
  }

  @Test
  void ImageryAndTerrainAreReadOnlyThroughTheDeclaredFolders() {
    start(8);
    useLinks(out(LINK, "UAV North", to(freePort())));
    send(LINK, CAMERA, UNCLASSIFIED);
    ctx.computeTask("render-" + LINK).awaitIdle();
    ctx.runUntilIdle();
    assertThat(ctx.folders().calls()).isNotEmpty().allSatisfy(c -> assertThat(c.folder()).isIn("terrain", "imagery"));
    assertThat(ctx.folders().calls()).anySatisfy(c -> assertThat(c.path()).isEqualTo("e017"));
    assertThat(ctx.computeTask("render-" + LINK).counter("no imagery")).isEqualTo(1); // an empty imagery folder: grey, counted
  }

  /** {@link #pose} with more members at its end, e.g. {@code ,"overlay":true}. */
  static DeclaredItem poseWith(UUID camera, Instant time, String more) {
    String json = String.format(Locale.ROOT, """
        {"camera":"%s","time":"%s","platform":{"position":[17.3,62.4,1000],"heading":45,"pitch":0,"roll":0,"name":"Hawk 1"},
         "pointing":{"azimuth":90,"depression":30,"roll":0},"fieldOfView":{"horizontal":20,"vertical":11.4},
         "frame":{"width":640,"height":360,"rate":25}%s}""", camera, time, more);
    return new DeclaredItem("fmv.camera-pose", camera, UNCLASSIFIED, (JsonObject) TestJson.parse(json));
  }

  @Test
  void cr0055APoseWithOrWithoutOverlayIsTakenAndRenderedAndOneOfAnotherTypeIsRefused() {
    start(8);
    useLinks(out(LINK, "UAV North", to(freePort())));
    ChannelId channel = new ChannelId("fmv", "out-" + LINK);
    String task = "render-" + LINK;
    int sent = 0;
    for (String overlay : List.of("", ",\"overlay\":true", ",\"overlay\":false")) {
      // the kit's send checks the payload against the manifest's schema, as ECore does at send (CR-0048 point 4.4)
      assertThat(ctx.channels().send(channel, poseWith(CAMERA, ctx.clock(), overlay))).as("overlay%s", overlay).isEqualTo(dev.emcc.sdk.worker.SendResult.ACCEPTED);
      ctx.runUntilIdle();
      ctx.computeTask(task).awaitIdle();
      encode(encoder(LINK));
      ctx.computeTask(task).awaitIdle();
      ctx.advance(Duration.ofMillis(40));
      sent++;
    }
    assertThat(pictures(LINK)).isEqualTo(sent);
    assertThat(status()).doesNotContain("bad pose");
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> ctx.channels().send(channel, poseWith(CAMERA, ctx.clock(), ",\"overlay\":\"yes\"")))
        .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("does not match its schema");
  }

  @Test
  void f4TheDegradedCameraIsALookChangeTheStreamAndEncoderGoOnAndTheNextFrameIsDegraded() {
    start(8);
    int port = freePort();
    useLinks(out(LINK, "UAV North", to(port)));
    String task = "render-" + LINK;
    send(LINK, CAMERA, UNCLASSIFIED);
    ctx.computeTask(task).awaitIdle();
    encode(encoder(LINK));
    ctx.computeTask(task).awaitIdle();
    assertThat(status()).contains("Rendering Hawk 1 640×360 25").doesNotContain("degraded");

    useLinks(out(LINK, "UAV North", to(port) + ",\"degraded\":{\"enabled\":true,\"haze\":80,\"noise\":40}"));
    assertThat(encoders(LINK)).hasSize(1); // owner, M9.2: a look change restarts nothing
    assertThat(encoder(LINK).state()).isEqualTo(FakeConversions.FakeConversion.State.RUNNING);
    ctx.advance(Duration.ofMillis(40));
    send(LINK, CAMERA, UNCLASSIFIED);
    ctx.computeTask(task).awaitIdle();
    assertThat(ctx.computeTask(task).restarts()).isZero();
    List<byte[]> pictures = encoder(LINK).pictures().stream().map(p -> p.data().toArray()).toList();
    assertThat(pictures).hasSize(2);
    assertThat(pictures.get(1)).isNotEqualTo(pictures.get(0));
    // the grey ground (no imagery) moved towards the haze's grey, and the noise made it uneven
    int centre = 180 * 640 + 320;
    assertThat(pictures.get(1)[centre] & 0xFF).isGreaterThan(pictures.get(0)[centre] & 0xFF);
    assertThat(status()).contains("Rendering Hawk 1 640×360 25, degraded");

    // off again: today's picture, byte for byte
    encode(encoder(LINK));
    ctx.computeTask(task).awaitIdle();
    useLinks(out(LINK, "UAV North", to(port) + ",\"degraded\":{\"enabled\":false,\"haze\":80,\"noise\":40}"));
    ctx.advance(Duration.ofMillis(40));
    send(LINK, CAMERA, UNCLASSIFIED);
    ctx.computeTask(task).awaitIdle();
    assertThat(encoders(LINK)).hasSize(1);
    assertThat(encoder(LINK).pictures().getLast().data().toArray()).isEqualTo(pictures.get(0));
  }

  @Test
  void f5BitErrorsAreALookChangeAndTheirEventsAndBlocksAreCountedInTheStatus() {
    start(8);
    int port = freePort();
    useLinks(out(LINK, "UAV North", to(port)));
    String task = "render-" + LINK;
    send(LINK, CAMERA, UNCLASSIFIED);
    useLinks(out(LINK, "UAV North", to(port) + ",\"bitErrors\":{\"enabled\":true,\"every\":2,\"jitter\":0,\"blocks\":2,\"seed\":9}"));
    assertThat(encoders(LINK)).hasSize(1); // a look change: nothing restarts
    assertThat(encoder(LINK).state()).isEqualTo(FakeConversions.FakeConversion.State.RUNNING);
    for (int i = 0; i < 60; i++) { // 2.4 s of pictures
      ctx.computeTask(task).awaitIdle();
      encode(encoder(LINK));
      ctx.computeTask(task).awaitIdle();
      ctx.advance(Duration.ofMillis(40));
      send(LINK, CAMERA, UNCLASSIFIED);
    }
    ctx.computeTask(task).awaitIdle();
    assertThat(ctx.computeTask(task).restarts()).isZero();
    assertThat(ctx.computeTask(task).counter("bit error events")).isEqualTo(1);
    long blocks = ctx.computeTask(task).counter("bit error blocks");
    assertThat(blocks).isBetween(2L, 2L * (640 / 16 + 1)); // two runs of 2 to a row and one blocks
    // the task reports its totals once a second of real time (System.nanoTime), not of the test's clock
    // (a pose each round, so that the link's 2 s hold does not stop the task first)
    String status = status();
    for (long until = System.nanoTime() + 5_000_000_000L; !status.contains("bit error") && System.nanoTime() < until; status = status()) {
      send(LINK, CAMERA, UNCLASSIFIED);
      ctx.computeTask(task).awaitIdle();
      LockSupport.parkNanos(50_000_000L);
    }
    // the poses of the wait render on, and the test's clock moves: more events may come by now
    var counted = java.util.regex.Pattern.compile("bit error events (\\d+), bit error blocks (\\d+)").matcher(status);
    assertThat(counted.find()).as(status).isTrue();
    assertThat(Long.parseLong(counted.group(1))).isPositive();
    assertThat(Long.parseLong(counted.group(2))).isGreaterThanOrEqualTo(blocks);
  }

  @Test
  void f5BitErrorsWithAJitterNotBelowTheirIntervalAreRefused() {
    start(8);
    useLinks(out(LINK, "UAV North", to(freePort()) + ",\"bitErrors\":{\"enabled\":true,\"every\":5,\"jitter\":5}"));
    assertThat(status()).contains("link UAV North: the bit errors' jitter is less than their interval");
  }

  /**
   * An EPSG:4326 imagery set in the imagery folder: {@code n} × {@code n} tiles of 0.01° round the
   * test poses' camera (17.3 E, 62.4 N), each the same JPEG of {@code pixels} × {@code pixels} noise.
   */
  void imagerySet(String folder, String name, int n, int pixels) throws Exception {
    java.awt.image.BufferedImage im = new java.awt.image.BufferedImage(pixels, pixels, java.awt.image.BufferedImage.TYPE_INT_RGB);
    java.util.Random r = new java.util.Random(1);
    for (int y = 0; y < pixels; y++) {
      for (int x = 0; x < pixels; x++) {
        im.setRGB(x, y, r.nextInt(0x1000000));
      }
    }
    var jpeg = new java.io.ByteArrayOutputStream();
    javax.imageio.ImageIO.write(im, "jpeg", jpeg);
    Path dir = java.nio.file.Files.createDirectories(imagery.resolve(folder));
    List<String> tiles = new ArrayList<>();
    for (int i = 0; i < n; i++) {
      for (int j = 0; j < n; j++) {
        String file = "t" + i + "_" + j + ".jpg";
        java.nio.file.Files.write(dir.resolve(file), jpeg.toByteArray());
        double lon = 17.3 + (i - n / 2.0) * 0.01;
        double lat = 62.4 + (j - n / 2.0) * 0.01;
        tiles.add(String.format(Locale.ROOT, "{\"file\":\"%s\",\"min\":[%.4f,%.4f],\"max\":[%.4f,%.4f],\"width\":%d,\"height\":%d}", file, lon, lat, lon + 0.01,
            lat + 0.01, pixels, pixels));
      }
    }
    java.nio.file.Files.writeString(dir.resolve("imagery.json"),
        "{\"name\":\"" + name + "\",\"source\":\"emcc tests\",\"licence\":\"CC0-1.0\",\"crs\":\"EPSG:4326\",\"tiles\":[" + String.join(",", tiles) + "]}");
  }

  /** The times the imagery folder's sets were listed. */
  long imageryListings() {
    return ctx.folders().calls().stream().filter(c -> c.folder().equals("imagery") && c.path().isEmpty() && c.operation().contains("list")).count();
  }

  @Test
  void f1ACameraStartedAgainWithinTheHoldReadsTheFoldersAgainAndTheStreamGoesOn() throws Exception {
    start(8);
    useLinks(out(LINK, "UAV North", to(freePort())));
    String task = "render-" + LINK;
    send(LINK, CAMERA, UNCLASSIFIED);
    ctx.computeTask(task).awaitIdle();
    ctx.runUntilIdle();
    assertThat(imageryListings()).isEqualTo(1);

    // a few frames, then the camera stops; a set is copied in; it starts again 1 s later, inside the 2 s hold
    ctx.advance(Duration.ofMillis(40));
    send(LINK, CAMERA, UNCLASSIFIED);
    assertThat(imageryListings()).as("a pose 40 ms on is no pause").isEqualTo(1);
    imagerySet("sundsvall", "Sundsvall", 2, 64);
    ctx.advance(Duration.ofMillis(1000));
    ctx.runUntilIdle();
    assertThat(ctx.compute().names()).as("still inside the hold").containsExactly(task);
    send(LINK, CAMERA, UNCLASSIFIED);
    ctx.runUntilIdle();
    ctx.computeTask(task).awaitIdle();
    ctx.runUntilIdle();
    assertThat(imageryListings()).as("the folders read again").isEqualTo(2);
    assertThat(encoders(LINK)).as("the encoder and stream go on").hasSize(1);
    assertThat(ctx.computeTask(task).restarts()).isZero();
    send(LINK, CAMERA, UNCLASSIFIED);
    assertThat(status()).contains("imagery Sundsvall (emcc tests, CC0-1.0)").contains("folders read again 1");
  }

  @Test
  void f1FramesGoOnReachingTheEncoderWhileALargeSetIsDecoded() throws Exception {
    imagerySet("large", "Large", 4, 2048); // 16 tiles of 4 M pixels: seconds of decoding
    start(8);
    useLinks(out(LINK, "UAV North", to(freePort())));
    String task = "render-" + LINK;
    send(LINK, CAMERA, UNCLASSIFIED); // starts the pipeline; the readers post the set and its tiles
    for (int i = 0; i < 20; i++) {
      ctx.runUntilIdle();
      encode(encoder(LINK));
      ctx.advance(Duration.ofMillis(40));
      send(LINK, CAMERA, UNCLASSIFIED);
      LockSupport.parkNanos(20_000_000L);
    }
    // the poses go on until every tile is decoded (the task's queue is not its inbox: awaitIdle does not wait for it)
    for (long until = System.nanoTime() + 30_000_000_000L; ctx.computeTask(task).counter("tiles decoded") < 16 && System.nanoTime() < until; ) {
      ctx.runUntilIdle();
      encode(encoder(LINK));
      ctx.advance(Duration.ofMillis(40));
      send(LINK, CAMERA, UNCLASSIFIED);
      LockSupport.parkNanos(20_000_000L);
    }
    // with the tiles decoded in the inbox's order, no frame came while they waited (owner ACS A: START after 10 s)
    assertThat(ctx.computeTask(task).counter("frames while loading")).isPositive();
    assertThat(ctx.computeTask(task).counter("tiles decoded")).isEqualTo(16);
    assertThat(pictures(LINK)).isGreaterThan(2);
  }

  @Test
  void f4ADegradedCameraOutsideItsRangeIsRefusedWithAProblem() {
    start(8);
    useLinks(out(LINK, "UAV North", to(freePort()) + ",\"degraded\":{\"enabled\":true,\"haze\":150}"));
    assertThat(status()).contains("link UAV North: haze is 0.0 to 100.0");
    assertThat(ctx.channels().offered()).isEmpty();
  }

  @Test
  void f6TheOverlayIsDrawnForAPoseThatAsksAndTheStatusSaysSo() {
    start(8);
    useLinks(out(LINK, "UAV North", to(freePort())));
    ChannelId channel = new ChannelId("fmv", "out-" + LINK);
    String task = "render-" + LINK;
    List<String> statuses = new ArrayList<>();
    for (String overlay : List.of("", ",\"overlay\":false", ",\"overlay\":true")) {
      ctx.channels().send(channel, poseWith(CAMERA, ctx.clock(), overlay));
      ctx.runUntilIdle();
      ctx.computeTask(task).awaitIdle();
      encode(encoder(LINK));
      ctx.computeTask(task).awaitIdle();
      statuses.add(status()); // its 500 ms are no pause (a pause is more than 500 ms, OutputWorker.pause)
    }
    List<byte[]> pictures = encoder(LINK).pictures().stream().map(p -> p.data().toArray()).toList();
    assertThat(pictures).hasSize(3);
    assertThat(pictures.get(1)).as("overlay false: today's frame, byte for byte").isEqualTo(pictures.get(0));
    assertThat(pictures.get(2)).as("overlay true: drawn").isNotEqualTo(pictures.get(0));
    assertThat(statuses.get(0)).contains("Rendering Hawk 1 640×360 25,").doesNotContain("overlay");
    assertThat(statuses.get(1)).doesNotContain("overlay");
    assertThat(statuses.get(2)).contains("Rendering Hawk 1 640×360 25, overlay,");
    assertThat(ctx.computeTask(task).counter("overlays")).isEqualTo(1);
  }

  @Test
  void aChangedSettingStopsThePipelineAndTheNextPoseStartsItAgain() {
    start(8);
    int port = freePort();
    useLinks(out(LINK, "UAV North", to(port)));
    send(LINK, CAMERA, UNCLASSIFIED);
    assertThat(encoders(LINK)).hasSize(1);
    useLinks(out(LINK, "UAV North", to(port) + ",\"bitrate\":6"));
    assertThat(encoder(LINK).state()).isEqualTo(FakeConversions.FakeConversion.State.STOPPED);
    send(LINK, CAMERA, UNCLASSIFIED);
    assertThat(encoders(LINK)).hasSize(2);
    assertThat(encoder(LINK).spec().bitrate()).isEqualTo(6_000_000);
    assertThat(encoder(LINK).state()).isEqualTo(FakeConversions.FakeConversion.State.RUNNING);
    assertThat(ctx.compute().task("render-" + LINK).state()).isEqualTo(FakeComputes.FakeCompute.State.RUNNING);
  }
}
