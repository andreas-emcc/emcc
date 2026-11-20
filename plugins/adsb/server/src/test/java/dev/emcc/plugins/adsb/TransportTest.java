package dev.emcc.plugins.adsb;

import static dev.emcc.plugins.adsb.Sbs1Test.msg;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.testkit.FakeConnections.FakeTask;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.TestJson;
import dev.emcc.sdk.DataType;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The TCP client link against a real socket on loopback, through the plugin as it runs: lines are
 * read, framed and parsed in the task, and written to the store by the worker. Covers the
 * acceptance criteria 11 and 14 (the reconnect, and the counters of each drop reason).
 */
class TransportTest {

  private static final InetAddress LOOPBACK = InetAddress.getLoopbackAddress();
  private static final String LINK = "dump1090-north";
  private static final String POSITION = msg(3, "4CA2D6", "", "35000", "", "", "55.6181", "12.6561", "", "", "0", "0");

  private FakePluginContext ctx;
  private final List<AutoCloseable> peers = new ArrayList<>();

  @BeforeEach
  void startLikeAPlugin() {
    ctx = FakePluginContext.builder("adsb")
        .declaredFields(Manifest.declaredFields())
        .fieldSets(Manifest.fieldSets())
        .dataTypes(new DataType("adsb.aircraft", "ADS-B aircraft", null, "adsb", new DataType.Defaults(60L, true, 300L))
            .withFieldSets("adsb.aircraft"))
        .build();
    AdsbPlugin plugin = new AdsbPlugin(ctx::clock);
    plugin.init(ctx);
    plugin.start();
  }

  @AfterEach
  void closeEverything() throws Exception {
    ctx.connections().stopAll();
    for (AutoCloseable peer : peers) {
      peer.close();
    }
  }

  @Test
  void criterion11_linesSplitAcrossReadsGiveWholeRecords() throws Exception {
    var server = peer(new ServerSocket(0, 5, LOOPBACK));
    useLinks(link(server.getLocalPort(), 60));
    Socket conn = accept(server);
    String half = POSITION.substring(0, 40);
    write(conn, half);
    awaitStatus("up");
    write(conn, POSITION.substring(40) + "\r\n");
    waitUntil(() -> ctx.store().objects().size() == 1, "the aircraft");
    assertThat(ctx.store().objects().get(0).content().geometry()).isNotNull();
    assertThat(task().counter("frames in")).isEqualTo(1L);
  }

  @Test
  void criterion11_aConnectionEndedByThePeerIsConnectedAgainAfterTheBackOff() throws Exception {
    var server = peer(new ServerSocket(0, 5, LOOPBACK));
    useLinks(link(server.getLocalPort(), 60));
    accept(server).close();
    awaitStatus("down: the peer closed the connection");
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    task().awaitIdle();
    ctx.advance(Duration.ofSeconds(1)); // the first back-off
    write(accept(server), POSITION + "\n");
    waitUntil(() -> ctx.store().objects().size() == 1, "the aircraft after the reconnect");
  }

  @Test
  void criterion11_aQuietDecoderIsConnectedAgainAfterTheIdleTime() throws Exception {
    var server = peer(new ServerSocket(0, 5, LOOPBACK));
    useLinks(link(server.getLocalPort(), 1));
    accept(server);
    awaitStatus("down: nothing received for the idle time");
  }

  @Test
  void criterion14_eachDropReasonAndEachIgnoredKindIsCounted() throws Exception {
    var server = peer(new ServerSocket(0, 5, LOOPBACK));
    useLinks(link(server.getLocalPort(), 60));
    Socket conn = accept(server);
    awaitStatus("up");
    String tooLong = "MSG," + "1".repeat(253); // 257 bytes with the comma
    write(conn, String.join("\n",
        tooLong,
        "MSG,3,1,1,4CA2D6,1",                                        // malformed: too few fields
        POSITION.replace("4CA2D6", "~4CA2D6"),                       // not icao
        POSITION.replace("55.6181", "95"),                           // value out of range
        msg(7, "4CA2D6", "", "", "", "", "", "", "", "", "", ""),    // ignored: MSG,7
        "SEL,1,1,1,4CA2D6,1,2026/10/28,11:00:00.000",                // ignored: SEL
        POSITION) + "\n");
    waitUntil(() -> task().counter("frames in") == 6, "the six frames");
    assertThat(task().counter("dropped: too long")).isEqualTo(1L);
    assertThat(task().counter("dropped: malformed")).isEqualTo(1L);
    assertThat(task().counter("dropped: not icao")).isEqualTo(1L);
    assertThat(task().counter("value out of range")).isEqualTo(1L);
    assertThat(task().counter("ignored: MSG,7")).isEqualTo(1L);
    assertThat(task().counter("ignored: SEL")).isEqualTo(1L);
    waitUntil(() -> ctx.store().objects().size() == 1, "the one good aircraft");
  }

  // ---------------------------------------------------------------- helpers

  private void useLinks(String... entries) {
    ctx.changeSettings((JsonObject) TestJson.parse("{\"links\":[" + String.join(",", entries) + "]}"));
    ctx.runUntilIdle();
  }

  private static String link(int port, int idleSeconds) {
    return "{\"name\":\"" + LINK + "\",\"host\":\"127.0.0.1\",\"port\":" + port + ",\"idleSeconds\":" + idleSeconds + "}";
  }

  private FakeTask<?> task() {
    return ctx.connectionTask(LINK);
  }

  /** Runs the workers until the plugin's status holds {@code text}; tasks run on their own threads meanwhile. */
  private void awaitStatus(String text) {
    waitUntil(() -> ctx.effectiveStatus().detail().contains(text), "a status with \"" + text + "\"");
  }

  private void waitUntil(BooleanSupplier condition, String what) {
    long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
    while (true) {
      ctx.runUntilIdle();
      if (condition.getAsBoolean()) {
        return;
      }
      if (System.nanoTime() > deadline) {
        throw new AssertionError("waited 15 s for " + what + "; status: " + ctx.effectiveStatus().detail());
      }
      Thread.onSpinWait();
      Thread.yield();
    }
  }

  private <T extends AutoCloseable> T peer(T socket) {
    peers.add(socket);
    return socket;
  }

  private Socket accept(ServerSocket server) throws Exception {
    server.setSoTimeout(10_000);
    Socket conn = peer(server.accept());
    conn.setSoTimeout(10_000);
    return conn;
  }

  private static void write(Socket socket, String text) throws Exception {
    OutputStream out = socket.getOutputStream();
    out.write(text.getBytes(StandardCharsets.UTF_8));
    out.flush();
  }
}
