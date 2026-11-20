package dev.emcc.plugins.ais.transport;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.ais.AisPlugin;
import dev.emcc.plugins.ais.codec.Ais;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.testkit.FakeConnections.FakeTask;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.TestJson;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
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
 * The two modes against real sockets on this computer (loopback), through the worker, as a plugin runs
 * them: UDP and a TCP client, both receiving. Frames are AIVDM sentences written for the tests.
 */
class TransportTest {

  private static final InetAddress LOOPBACK = InetAddress.getLoopbackAddress();

  private static final String ONE = Ais.classA(1, 265_123_456, 0, 100, 18.0723, 59.3311, 2705, 90).sentence();
  private static final String TWO = Ais.classB(230_111_222, 55, 24.9384, 60.1699, 1800, 511).sentence();

  private FakePluginContext ctx;
  private AisPlugin plugin;
  private final List<AutoCloseable> peers = new ArrayList<>();

  @BeforeEach
  void startLikeAPlugin() {
    ctx = FakePluginContext.builder("ais").build();
    plugin = new AisPlugin();
    plugin.init(ctx);
    plugin.start();
    ctx.runUntilIdle();
  }

  @AfterEach
  void closeEverything() throws Exception {
    plugin.stop();
    ctx.connections().stopAll();
    for (AutoCloseable peer : peers) {
      peer.close();
    }
  }

  // ---------------------------------------------------------------- UDP

  @Test
  void criterion12_aDatagramWithTwoSentencesGivesTwoRecords() throws Exception {
    int port = freeUdpPort();
    useLinks("{\"name\":\"feed\",\"mode\":\"udp\",\"listen\":{\"port\":" + port + "}}");
    awaitStatus("feed [in udp on 127.0.0.1:" + port + "]: listening");
    var peer = peer(new DatagramSocket(0, LOOPBACK));
    datagram(peer, ONE + "\r\n" + TWO, port); // the last line has no line end: the datagram's end is one
    awaitStatus("feed [in udp on 127.0.0.1:" + port + "]: listening, 2 msg/min");
    waitUntil(() -> task("feed").counter("frames in") == 2, "the counter"); // counted just after the message to the worker
    assertThat(task("feed").counter("messages")).isEqualTo(2);
  }

  @Test
  void udp_aLinkListensOnLoopbackByDefault() {
    int port = freeUdpPortUnchecked();
    useLinks("{\"name\":\"feed\",\"mode\":\"udp\",\"listen\":{\"port\":" + port + "}}");
    waitUntil(() -> task("feed").listening() != null, "the task to listen");
    assertThat(task("feed").listening().toString()).contains("127.0.0.1");
  }

  // ---------------------------------------------------------------- TCP client

  @Test
  void tcpClient_readsLinesAndCountsWhatItRefuses() throws Exception {
    var server = peer(new ServerSocket(0, 5, LOOPBACK));
    useLinks(tcpClient(server.getLocalPort(), 300));
    Socket conn = accept(server);
    String bad = ONE.replaceFirst(",A,.", ",A,5");
    write(conn, ONE + "\n" + bad + "\r\n" + TWO + "\n");
    awaitStatus("feed [in tcp-client to 127.0.0.1:" + server.getLocalPort() + "]: up, 2 msg/min");
    waitUntil(() -> task("feed").counter("frames in") == 3, "the counter");
    assertThat(task("feed").counter("dropped: checksum")).isEqualTo(1);
  }

  @Test
  void tcpClient_aLineOf513BytesIsDroppedAndTheNextOneIsRead() throws Exception {
    var server = peer(new ServerSocket(0, 5, LOOPBACK));
    useLinks(tcpClient(server.getLocalPort(), 300));
    Socket conn = accept(server);
    write(conn, "!" + "A".repeat(512) + "\n" + ONE + "\n");
    awaitStatus("up, 1 msg/min");
    assertThat(task("feed").counter("dropped: too long")).isEqualTo(1);
    write(conn, "!" + "A".repeat(511) + "\n"); // 512 bytes: within the limit, so it is read, and it is not a sentence
    waitUntil(() -> task("feed").counter("dropped: no checksum") == 1, "the 512-byte line to be read");
    assertThat(task("feed").counter("dropped: too long")).isEqualTo(1);
  }

  @Test
  void criterion12_aTcpLinkReconnectsAfterIdleSecondsWithoutData() throws Exception {
    var server = peer(new ServerSocket(0, 5, LOOPBACK));
    useLinks(tcpClient(server.getLocalPort(), 1));
    accept(server); // the first connection: silent
    awaitStatus("down: nothing received for the idle time"); // after one idle second
    task("feed").awaitIdle();
    ctx.advance(Duration.ofSeconds(1)); // the first back-off
    write(accept(server), ONE + "\n");
    awaitStatus("up, 1 msg/min");
    assertThat(task("feed").restarts()).isEqualTo(1);
  }

  @Test
  void tcpClient_connectsAgainWhenThePeerClosesTheConnection() throws Exception {
    var server = peer(new ServerSocket(0, 5, LOOPBACK));
    useLinks(tcpClient(server.getLocalPort(), 300));
    accept(server).close();
    awaitStatus("down: the peer closed the connection");
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    task("feed").awaitIdle();
    ctx.advance(Duration.ofSeconds(1));
    write(accept(server), TWO + "\n");
    awaitStatus("up, 1 msg/min");
  }

  // ---------------------------------------------------------------- settings

  @Test
  void aLinkWhoseSettingsChangeStartsAgainWithThem() throws Exception {
    int before = freeUdpPort();
    useLinks("{\"name\":\"feed\",\"mode\":\"udp\",\"listen\":{\"port\":" + before + "}}");
    awaitStatus("on 127.0.0.1:" + before + "]: listening");
    int after = freeUdpPort();
    useLinks("{\"name\":\"feed\",\"mode\":\"udp\",\"listen\":{\"port\":" + after + "}}");
    awaitStatus("on 127.0.0.1:" + after + "]: listening");
    datagram(peer(new DatagramSocket(0, LOOPBACK)), ONE, after);
    awaitStatus("listening, 1 msg/min");
  }

  @Test
  void removingALinkStopsItsTaskAndABadOneIsReported() throws Exception {
    int port = freeUdpPort();
    useLinks("{\"name\":\"feed\",\"mode\":\"udp\",\"listen\":{\"port\":" + port + "}}");
    awaitStatus("listening");
    useLinks("{\"name\":\"bad\",\"mode\":\"tcp-client\"}");
    awaitStatus("link bad: needs a host");
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    waitUntil(() -> task("feed").state() == FakeTask.State.STOPPED, "the task to end"); // its thread ends after the stop
    peer(new DatagramSocket(port, LOOPBACK)); // the port is free again
  }

  // ---------------------------------------------------------------- helpers

  private void useLinks(String... entries) {
    ctx.changeSettings((JsonObject) TestJson.parse("{\"links\":[" + String.join(",", entries) + "]}"));
    ctx.runUntilIdle();
  }

  private static String tcpClient(int port, int idleSeconds) {
    return "{\"name\":\"feed\",\"mode\":\"tcp-client\",\"direction\":\"in\",\"host\":\"127.0.0.1\",\"port\":" + port + ",\"idleSeconds\":" + idleSeconds + "}";
  }

  private FakeTask<?> task(String name) {
    return ctx.connectionTask(name);
  }

  /** Runs the workers until the plugin's status holds {@code text}; tasks run on their own threads meanwhile. */
  private void awaitStatus(String text) {
    waitUntil(() -> ctx.effectiveStatus().detail().contains(text), "a status with \"" + text + "\"");
  }

  private void waitUntil(BooleanSupplier condition, String what) {
    long deadline = System.nanoTime() + Duration.ofSeconds(20).toNanos();
    while (true) {
      ctx.runUntilIdle();
      if (condition.getAsBoolean()) {
        return;
      }
      if (System.nanoTime() > deadline) {
        throw new AssertionError("waited 20 s for " + what + "; status: " + ctx.effectiveStatus().detail());
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
    server.setSoTimeout(20_000);
    Socket conn = peer(server.accept());
    conn.setSoTimeout(10_000);
    return conn;
  }

  private static void write(Socket socket, String text) throws Exception {
    OutputStream out = socket.getOutputStream();
    out.write(text.getBytes(StandardCharsets.UTF_8));
    out.flush();
  }

  private static void datagram(DatagramSocket from, String text, int port) throws Exception {
    byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
    from.send(new DatagramPacket(bytes, bytes.length, LOOPBACK, port));
  }

  private static int freeUdpPort() throws Exception {
    try (var socket = new DatagramSocket(0, LOOPBACK)) {
      return socket.getLocalPort();
    }
  }

  private static int freeUdpPortUnchecked() {
    try {
      return freeUdpPort();
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }
}
