package dev.emcc.plugins.gmti;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.gmti.format.Decoder;
import dev.emcc.plugins.gmti.format.Dwell;
import dev.emcc.plugins.gmti.format.Encoder;
import dev.emcc.plugins.gmti.format.Mission;
import dev.emcc.plugins.gmti.format.Packet;
import dev.emcc.plugins.gmti.format.PacketHeader;
import dev.emcc.plugins.gmti.format.Segment;
import dev.emcc.plugins.gmti.format.Skipped;
import dev.emcc.plugins.gmti.format.TargetReport;
import dev.emcc.plugins.gmti.transport.TransportMsg;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.testkit.FakeConnections.FakeTask;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.LogEntry;
import dev.emcc.sdk.testkit.TestJson;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The status and the counters (work package 4; brief section 6; criterion 14): each link state, each
 * counter, the rates per minute and the warnings. Counters need a running task, so the links here
 * are UDP receivers on loopback that the test feeds packets as their task would.
 */
class StatusTest {

  static final LocalDate DAY = LocalDate.of(2026, 1, 12);
  static final Position SENSOR = Position.of(19.7, 55.08);

  FakePluginContext ctx;
  GmtiPlugin plugin;

  @BeforeEach
  void start() {
    ctx = Manifest.context().build();
    plugin = new GmtiPlugin(ctx::clock);
    plugin.init(ctx);
    plugin.start();
    ctx.runUntilIdle();
  }

  @AfterEach
  void stop() {
    ctx.connections().stopAll();
  }

  void useLinks(String... entries) {
    ctx.changeSettings((JsonObject) TestJson.parse("{\"links\":[" + String.join(",", entries) + "]}"));
    ctx.runUntilIdle();
  }

  /** A UDP receiver on a free loopback port: its task runs, so its counters count. */
  String udpIn(String name, String more) throws Exception {
    int port;
    try (var s = new DatagramSocket(0, InetAddress.getLoopbackAddress())) {
      port = s.getLocalPort();
    }
    return "{\"name\":\"" + name + "\",\"mode\":\"udp\",\"listen\":{\"port\":" + port + "}" + more + "}";
  }

  static PacketHeader header(int classification, long mission) {
    return new PacketHeader("30", "US", classification, "XN", 0, 1, "PLATFORM01", mission, 7);
  }

  static Packet packet(PacketHeader h, boolean withMission, int reports, Segment... more) {
    Position centre = Geodesy.direct(SENSOR, 90, 30_000);
    var d = Dwell.of(0, 0, 1_000 + reports, SENSOR.latitude(), SENSOR.longitude(), 8_500, centre.latitude(), centre.longitude(), 5, 7.5);
    for (int i = 0; i < reports; i++) {
      d.report(TargetReport.at(55.0 + i * 1e-4, 19.9).index(i).build());
    }
    var segments = new ArrayList<Segment>(List.of(more));
    if (withMission) {
      segments.add(Mission.on(DAY, 7, "", ""));
    }
    segments.add(d.build());
    return Decoder.decode(Encoder.packet(h, segments)).packet();
  }

  void receive(String link, Packet p) {
    plugin.links().send(new TransportMsg.Received(link, UUID.randomUUID(), p));
    ctx.runUntilIdle();
  }

  FakeTask<?> task(String name) {
    return ctx.connectionTask(name);
  }

  String status() {
    return ctx.effectiveStatus().detail();
  }

  void await(BooleanSupplier condition) {
    long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
    while (!condition.getAsBoolean()) {
      ctx.runUntilIdle();
      if (System.nanoTime() > deadline) {
        throw new AssertionError("waited 15 s; status: " + status());
      }
      Thread.yield();
    }
  }

  // ---------------------------------------------------------------- states

  @Test
  void criterion14_eachLinkState() throws Exception {
    int closed;
    try (var probe = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
      closed = probe.getLocalPort();
    }
    int listen;
    try (var probe = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
      listen = probe.getLocalPort();
    }
    useLinks(udpIn("up", ""), "{\"name\":\"off\",\"host\":\"127.0.0.1\",\"port\":9,\"enabled\":false}",
        "{\"name\":\"refused\",\"host\":\"127.0.0.1\",\"port\":" + closed + "}",
        "{\"name\":\"server\",\"mode\":\"tcp-server\",\"listen\":{\"port\":" + listen + "}}",
        "{\"name\":\"bad\",\"mode\":\"tcp-client\"}");
    // Each link's own state, not only its name: a link is "connecting" until its task is up.
    await(() -> part("up").contains("]: up, ") && part("refused").startsWith("refused [in tcp-client to 127.0.0.1:" + closed + "]: down: ")
        && part("server").contains("]: listening, 0 clients"));
    assertThat(status()).contains("off [in tcp-client to 127.0.0.1:9]: switched off");
    assertThat(status()).contains("link bad: needs a host");
    assertThat(part("up")).startsWith("up [in udp on 127.0.0.1:").endsWith("]: up, 0 packets, 0 dwells, 0 reports a minute, 0 platforms");
    assertThat(ctx.effectiveStatus().state()).as("a link down and a bad one").isEqualTo(PluginState.DEGRADED);

    useLinks(udpIn("up", "")); // a new port: the link restarts
    await(() -> part("up").contains("]: up, "));
    assertThat(status()).as("the other links are gone").isEqualTo(part("up"));
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.OK);
  }

  /** The part of the status for link {@code name} ("name [where]: state, counts"), or "" while it has none. */
  String part(String name) {
    return Arrays.stream(status().split("; ")).filter(p -> p.startsWith(name + " [")).findFirst().orElse("");
  }

  @Test
  void criterion14_aClientLinkIsConnectingUntilItsPeerAnswers() {
    // TEST-NET-1 is never routed: the connect waits (up to 10 s) and the link says so meanwhile.
    useLinks("{\"name\":\"far\",\"host\":\"192.0.2.1\",\"port\":4607}");
    assertThat(status()).satisfiesAnyOf(
        s -> assertThat(s).contains("far [in tcp-client to 192.0.2.1:4607]: connecting"),
        s -> assertThat(s).contains("far [in tcp-client to 192.0.2.1:4607]: down: ")); // a network that refuses at once
  }

  // ---------------------------------------------------------------- counters

  @Test
  void criterion14_theInCounters() throws Exception {
    useLinks(udpIn("feed", ",\"maxReportsPerDwell\":2,\"label\":{\"policy\":\"NATO\",\"classification\":\"RESTRICTED\"}"));
    await(() -> status().contains("]: up"));
    receive("feed", packet(header(5, 1), false, 1)); // no mission yet
    ctx.advance(Duration.ofSeconds(11));
    ctx.runUntilIdle();
    receive("feed", packet(header(5, 1), true, 3, new Skipped(128, 25))); // the cap of 2
    receive("feed", packet(header(2, 1), true, 0)); // above the layer's label
    receive("feed", packet(header(0, 1), true, 0)); // no such classification
    FakeTask<?> t = task("feed");
    assertThat(t.counter("dropped: no mission")).isEqualTo(1);
    assertThat(t.counter("skipped: segment 128")).isEqualTo(1);
    assertThat(t.counter("skipped: over cap")).isEqualTo(1);
    assertThat(t.counter("above layer label")).isEqualTo(1);
    assertThat(t.counter("label not mapped")).isEqualTo(1);
    assertThat(t.counter("detections written")).isEqualTo(2);
    assertThat(t.counter("areas written")).isEqualTo(3);
    assertThat(t.counter("platforms")).isEqualTo(1);
    assertThat(status()).contains("1 platforms");
  }

  @Test
  void criterion14_theOutCounters() throws Exception {
    int port;
    try (var probe = new DatagramSocket(0, InetAddress.getLoopbackAddress())) {
      port = probe.getLocalPort();
    }
    useLinks("{\"name\":\"sim-out\",\"mode\":\"udp\",\"direction\":\"out\",\"host\":\"127.0.0.1\",\"port\":" + port
        + ",\"highestClassification\":{\"policy\":\"NATO\",\"classification\":\"RESTRICTED\"}}");
    await(() -> status().contains("sim-out [out udp to 127.0.0.1:" + port + "]: up"));
    ChannelId channel = ctx.channels().offered().getFirst().id();
    var area = new Geometry.Circle(SENSOR, 2_000_000);
    var secret = LinksTest.detection(Geodesy.direct(SENSOR, 90, 5_000), SecurityLabel.of("NATO", "SECRET"));
    var far = LinksTest.detection(Geodesy.direct(SENSOR, 90, 1_000_000), SecurityLabel.of("NATO", "UNCLASSIFIED"));
    var sensor = new ChannelItem.Sensor("Spaning 1", "ATO-2611-BRAVO", Duration.ofSeconds(7_000), 700.0, 50.0, 1.5, 0.9, null, null);
    ctx.channels().deliver(channel,
        new ChannelItem.SensorReport(UUID.randomUUID(), SENSOR, Instant.parse("2026-11-07T10:00:00Z"), area, List.of(secret, far), sensor));
    ctx.runUntilIdle();
    await(() -> status().contains("1 dwells sent a minute"));
    assertThat(task("sim-out").counter("detections above highest")).isEqualTo(1);
    assertThat(task("sim-out").counter("not held: D26")).as("a circle of 2 000 km").isEqualTo(1);
    assertThat(task("sim-out").counter("beyond reach")).as("the detection at 1 000 km").isEqualTo(1);
    assertThat(task("sim-out").counter("not held: J15")).as("criterion 18: a revisit of 7 000 s").isEqualTo(1);
    assertThat(task("sim-out").counter("not held: J21")).as("700 m").isEqualTo(1);
    assertThat(task("sim-out").counter("not held: D32.12")).isEqualTo(1);
    assertThat(task("sim-out").counter("not held: J22")).as("a circle's centre is halfway out (CR-0035): J22 has a range").isZero();
    assertThat(task("sim-out").counter("mission cut")).as("criterion 20: 14 characters").isEqualTo(1);
    assertThat(task("sim-out").counter("dwells out")).isEqualTo(1);
  }

  @Test
  void criterion14_theRatesAreForTheLastMinute() throws Exception {
    useLinks(udpIn("feed", ""));
    await(() -> status().contains("]: up"));
    receive("feed", packet(header(5, 1), true, 4));
    receive("feed", packet(header(5, 1), true, 2));
    assertThat(status()).contains("up, 2 packets, 2 dwells, 6 reports a minute");
    ctx.advance(Duration.ofSeconds(30));
    ctx.runUntilIdle();
    receive("feed", packet(header(5, 1), true, 1));
    assertThat(status()).contains("up, 3 packets, 3 dwells, 7 reports a minute");
    ctx.advance(Duration.ofSeconds(31));
    ctx.runUntilIdle();
    assertThat(status()).as("the first two are a minute old").contains("up, 1 packets, 1 dwells, 1 reports a minute");
    ctx.advance(Duration.ofSeconds(60));
    ctx.runUntilIdle();
    assertThat(status()).contains("up, 0 packets, 0 dwells, 0 reports a minute, 1 platforms");
  }

  @Test
  void aWarningAtMostOnceAMinutePerLinkAndReason() throws Exception {
    useLinks(udpIn("feed", ",\"maxReportsPerDwell\":1"));
    await(() -> status().contains("]: up"));
    for (int i = 0; i < 5; i++) {
      receive("feed", packet(header(5, 1), true, 3 + i));
    }
    assertThat(warnings("skipped: over cap")).hasSize(1);
    ctx.advance(Duration.ofSeconds(61));
    ctx.runUntilIdle();
    receive("feed", packet(header(5, 1), true, 9));
    assertThat(warnings("skipped: over cap")).hasSize(2);
  }

  List<LogEntry> warnings(String text) {
    return ctx.logEntries().stream().filter(e -> e.level() == LogEntry.Level.WARN && e.message().contains(text)).toList();
  }
}
