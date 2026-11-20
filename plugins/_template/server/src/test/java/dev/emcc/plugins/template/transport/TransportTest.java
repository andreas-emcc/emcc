package dev.emcc.plugins.template.transport;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.testkit.FakeConnections.FakeTask;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.TestJson;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.BufferedReader;
import java.io.InputStreamReader;
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
 * The six modes against real sockets on this computer (loopback), through the worker, as a plugin
 * runs them: UDP, a TCP client and a TCP server, each receiving, sending, and both on one socket.
 */
class TransportTest {

  private static final InetAddress LOOPBACK = InetAddress.getLoopbackAddress();

  private FakePluginContext ctx;
  private WorkerRef<TransportMsg> links;
  private final List<AutoCloseable> peers = new ArrayList<>();

  @BeforeEach
  void startLikeAPlugin() {
    ctx = FakePluginContext.builder("template").build();
    links = LinkWorker.spawn(ctx);
    ctx.subscribeSettings(links, TransportMsg.SettingsChanged::new);
  }

  @AfterEach
  void closeEverything() throws Exception {
    ctx.connections().stopAll();
    for (AutoCloseable peer : peers) {
      peer.close();
    }
  }

  // ---------------------------------------------------------------- UDP

  @Test
  void udpIn_receivesEachLineOfADatagram() throws Exception {
    int port = freeUdpPort();
    useLinks("{\"name\":\"feed\",\"mode\":\"udp\",\"listen\":{\"port\":" + port + "}}");
    awaitStatus("feed [in udp on 127.0.0.1:" + port + "]: up");
    var peer = peer(new DatagramSocket(0, LOOPBACK));
    datagram(peer, "first\r\nsecond", port);
    awaitStatus("feed [in udp on 127.0.0.1:" + port + "]: up, 2 received");
    waitUntil(() -> task("feed").counter("frames in") == 2, "the counter"); // counted just after the message to the worker
  }

  @Test
  void udpOut_sendsOneDatagramPerFrameToItsPeer() throws Exception {
    var peer = peer(new DatagramSocket(0, LOOPBACK));
    useLinks("{\"name\":\"feed\",\"mode\":\"udp\",\"direction\":\"out\",\"host\":\"127.0.0.1\",\"port\":" + peer.getLocalPort() + "}");
    awaitStatus("feed [out udp to 127.0.0.1:" + peer.getLocalPort() + "]: up");
    outgoing("hello");
    assertThat(receive(peer).text()).isEqualTo("hello\n");
  }

  @Test
  void udpBoth_sendsFromThePortItReceivesOn() throws Exception {
    var peer = peer(new DatagramSocket(0, LOOPBACK));
    int port = freeUdpPort();
    useLinks("{\"name\":\"feed\",\"mode\":\"udp\",\"direction\":\"both\",\"host\":\"127.0.0.1\",\"port\":" + peer.getLocalPort() + ",\"listen\":{\"port\":" + port + "}}");
    awaitStatus("]: up");
    outgoing("ping");
    Datagram got = receive(peer);
    assertThat(got.text()).isEqualTo("ping\n");
    assertThat(got.fromPort()).as("one socket for both ways").isEqualTo(port);
    datagram(peer, "pong", port);
    awaitStatus("up, 1 received");
  }

  // ---------------------------------------------------------------- TCP client

  @Test
  void tcpClientIn_consumesWhatThePeerSends() throws Exception {
    var server = peer(new ServerSocket(0, 5, LOOPBACK));
    useLinks(tcpClient("in", server.getLocalPort()));
    Socket conn = accept(server);
    write(conn, "a\nb\n");
    awaitStatus("feed [in tcp-client to 127.0.0.1:" + server.getLocalPort() + "]: up, 2 received");
  }

  @Test
  void tcpClientOut_providesWhatTheWorkerSends() throws Exception {
    var server = peer(new ServerSocket(0, 5, LOOPBACK));
    useLinks(tcpClient("out", server.getLocalPort()));
    BufferedReader in = reader(accept(server));
    awaitStatus("]: up");
    outgoing("hello");
    assertThat(in.readLine()).isEqualTo("hello");
  }

  @Test
  void tcpClientBoth_sendsAndReceivesOnOneConnection() throws Exception {
    var server = peer(new ServerSocket(0, 5, LOOPBACK));
    useLinks(tcpClient("both", server.getLocalPort()));
    Socket conn = accept(server);
    awaitStatus("]: up");
    outgoing("ping");
    assertThat(reader(conn).readLine()).isEqualTo("ping");
    write(conn, "pong\n");
    awaitStatus("up, 1 received");
  }

  @Test
  void tcpClientConnectsAgainAfterThePeerClosesWithTheBackOff() throws Exception {
    var server = peer(new ServerSocket(0, 5, LOOPBACK));
    useLinks(tcpClient("in", server.getLocalPort()));
    accept(server).close();
    awaitStatus("feed [in tcp-client to 127.0.0.1:" + server.getLocalPort() + "]: down: the peer closed the connection");
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    task("feed").awaitIdle();
    ctx.advance(Duration.ofSeconds(1)); // the first back-off
    write(accept(server), "again\n");
    awaitStatus("up, 1 received");
    assertThat(task("feed").restarts()).isEqualTo(1);
  }

  // ---------------------------------------------------------------- TCP server

  @Test
  void tcpServerIn_consumesWhatEachClientSends() throws Exception {
    int port = freeTcpPort();
    useLinks(tcpServer("in", port));
    awaitStatus("feed [in tcp-server on 127.0.0.1:" + port + "]: listening, 0 clients");
    write(connect(port), "a\n");
    write(connect(port), "b\nc\n");
    awaitStatus("listening, 2 clients, 3 received");
  }

  @Test
  void tcpServerOut_providesEveryFrameToEveryClient() throws Exception {
    int port = freeTcpPort();
    useLinks(tcpServer("out", port));
    awaitStatus("listening, 0 clients");
    BufferedReader first = reader(connect(port));
    BufferedReader second = reader(connect(port));
    awaitStatus("listening, 2 clients");
    outgoing("hello");
    assertThat(first.readLine()).isEqualTo("hello");
    assertThat(second.readLine()).isEqualTo("hello");
  }

  @Test
  void tcpServerBoth_sendsAndReceivesOnEachClientsConnection() throws Exception {
    int port = freeTcpPort();
    useLinks(tcpServer("both", port));
    awaitStatus("listening, 0 clients");
    Socket client = connect(port);
    awaitStatus("listening, 1 client");
    outgoing("ping");
    assertThat(reader(client).readLine()).isEqualTo("ping");
    write(client, "pong\n");
    awaitStatus("1 client, 1 received");
    client.close();
    awaitStatus("listening, 0 clients, 1 received"); // a client that goes is no problem of the link
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.OK);
  }

  // ---------------------------------------------------------------- settings

  @Test
  void aLinkWhoseSettingsChangeStartsAgainWithThem() throws Exception {
    int before = freeTcpPort();
    useLinks(tcpServer("in", before));
    awaitStatus("on 127.0.0.1:" + before + "]: listening");
    int after = freeTcpPort();
    useLinks(tcpServer("in", after));
    awaitStatus("on 127.0.0.1:" + after + "]: listening");
    write(connect(after), "a\n");
    awaitStatus("1 client, 1 received");
  }

  @Test
  void removingALinkStopsItsTaskAndABadOneIsReported() throws Exception {
    int port = freeTcpPort();
    useLinks(tcpServer("in", port));
    awaitStatus("listening");
    useLinks("{\"name\":\"bad\",\"mode\":\"tcp-client\"}");
    awaitStatus("link bad: needs a host");
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    waitUntil(() -> task("feed").state() == FakeTask.State.STOPPED, "the task to end"); // its thread ends after the stop
    peer(new ServerSocket(port, 5, LOOPBACK)); // the port is free again
  }

  // ---------------------------------------------------------------- helpers

  private void useLinks(String... entries) {
    ctx.changeSettings((JsonObject) TestJson.parse("{\"links\":[" + String.join(",", entries) + "]}"));
    ctx.runUntilIdle();
  }

  private static String tcpClient(String direction, int port) {
    return "{\"name\":\"feed\",\"mode\":\"tcp-client\",\"direction\":\"" + direction + "\",\"host\":\"127.0.0.1\",\"port\":" + port + "}";
  }

  private static String tcpServer(String direction, int port) {
    return "{\"name\":\"feed\",\"mode\":\"tcp-server\",\"direction\":\"" + direction + "\",\"listen\":{\"port\":" + port + "}}";
  }

  /** What the worker sends on the link "feed"; the worker handles it at once. */
  private void outgoing(String frame) {
    links.send(new TransportMsg.Outgoing("feed", "track-1", frame));
    ctx.runUntilIdle();
  }

  private FakeTask<?> task(String name) {
    return ctx.connectionTask(name);
  }

  /** Runs the workers until the plugin's status holds {@code text}; tasks run on their own threads meanwhile. */
  private void awaitStatus(String text) {
    waitUntil(() -> ctx.effectiveStatus().detail().contains(text), "a status with \"" + text + "\"");
  }

  private void waitUntil(BooleanSupplier condition, String what) {
    long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
    while (true) {
      ctx.runUntilIdle();
      if (condition.getAsBoolean()) {
        return;
      }
      if (System.nanoTime() > deadline) {
        throw new AssertionError("waited 10 s for " + what + "; status: " + ctx.effectiveStatus().detail());
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

  private Socket connect(int port) throws Exception {
    Socket socket = peer(new Socket(LOOPBACK, port));
    socket.setSoTimeout(10_000);
    return socket;
  }

  private static void write(Socket socket, String text) throws Exception {
    OutputStream out = socket.getOutputStream();
    out.write(text.getBytes(StandardCharsets.UTF_8));
    out.flush();
  }

  private static BufferedReader reader(Socket socket) throws Exception {
    return new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
  }

  private static void datagram(DatagramSocket from, String text, int port) throws Exception {
    byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
    from.send(new DatagramPacket(bytes, bytes.length, LOOPBACK, port));
  }

  private record Datagram(String text, int fromPort) {}

  private static Datagram receive(DatagramSocket socket) throws Exception {
    socket.setSoTimeout(10_000);
    var packet = new DatagramPacket(new byte[2048], 2048);
    socket.receive(packet);
    return new Datagram(new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8), packet.getPort());
  }

  private static int freeUdpPort() throws Exception {
    try (var socket = new DatagramSocket(0, LOOPBACK)) {
      return socket.getLocalPort();
    }
  }

  private static int freeTcpPort() throws Exception {
    try (var socket = new ServerSocket(0, 1, LOOPBACK)) {
      return socket.getLocalPort();
    }
  }
}
