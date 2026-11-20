package dev.emcc.plugins.gmti.transport;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.gmti.format.Decoder;
import dev.emcc.plugins.gmti.format.Dwell;
import dev.emcc.plugins.gmti.format.Encoder;
import dev.emcc.plugins.gmti.format.Mission;
import dev.emcc.plugins.gmti.format.PacketHeader;
import dev.emcc.plugins.gmti.format.TargetReport;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.testkit.FakeConnections.FakeTask;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.FakeTaskContext;
import dev.emcc.sdk.testkit.TestJson;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.DataInputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The transport (work package 2; brief section 4; criteria 8 and 12) against real sockets on
 * loopback: UDP (unicast and multicast), a TCP client and a TCP server, each {@code in} and {@code
 * out}. The packets are written for the test with the encoder; no recorded frame is used.
 */
class TransportTest {

  private static final InetAddress LOOPBACK = InetAddress.getLoopbackAddress();
  private static final PacketHeader HEADER = new PacketHeader("41", "XN", 5, "XN", 0, 129, "SENSOR1", 1, 7);

  private FakePluginContext ctx;
  private WorkerRef<TransportMsg> links;
  private final List<AutoCloseable> peers = new ArrayList<>();

  @BeforeEach
  void startLikeAPlugin() {
    ctx = FakePluginContext.builder("gmti").build();
    links = LinkWorker.spawn(ctx, ctx::clock);
    ctx.subscribeSettings(links, TransportMsg.SettingsChanged::new);
  }

  @AfterEach
  void closeEverything() throws Exception {
    ctx.connections().stopAll();
    for (AutoCloseable peer : peers) {
      peer.close();
    }
  }

  /** A packet with a mission and a dwell of {@code reports} reports. */
  static byte[] packet(int reports) {
    var dwell = Dwell.of(0, 0, 1_000, 55.08, 19.7, 8_500, 55.16, 19.59, 200.0, 90);
    for (int i = 0; i < reports; i++) {
      dwell.report(TargetReport.at(55.0 + i * 1e-3, 19.9).index(i).build());
    }
    return Encoder.packet(HEADER, List.of(Mission.on(LocalDate.of(2026, 1, 12), 255, "", ""), dwell.build()));
  }

  // ---------------------------------------------------------------- UDP

  @Test
  void udpIn_takesOnePacketPerDatagram() throws Exception {
    int port = freeUdpPort();
    useLinks("{\"name\":\"feed\",\"mode\":\"udp\",\"listen\":{\"port\":" + port + "}}");
    awaitStatus("feed [in udp on 127.0.0.1:" + port + "]: up");
    var peer = peer(new DatagramSocket(0, LOOPBACK));
    send(peer, packet(3), port);
    send(peer, packet(0), port);
    awaitStatus("up, 2 packets, 2 dwells, 3 reports");
    waitUntil(() -> task("feed").counter("packets in") == 2, "the counter");
  }

  @Test
  void criterion12_aDatagramWhoseLengthIsNotItsPacketSizeIsDropped() throws Exception {
    int port = freeUdpPort();
    useLinks("{\"name\":\"feed\",\"mode\":\"udp\",\"listen\":{\"port\":" + port + "}}");
    awaitStatus("]: up");
    var peer = peer(new DatagramSocket(0, LOOPBACK));
    byte[] longer = Arrays.copyOf(packet(1), packet(1).length + 4);
    send(peer, longer, port);
    byte[] two = new byte[packet(1).length * 2];
    System.arraycopy(packet(1), 0, two, 0, packet(1).length);
    System.arraycopy(packet(1), 0, two, packet(1).length, packet(1).length);
    send(peer, two, port);
    byte[] badSegment = packet(1);
    ByteBuffer.wrap(badSegment).putInt(32 + 5 + 39 + 1, 9_999); // the dwell's S2 past the packet's end
    send(peer, badSegment, port);
    send(peer, packet(2), port);
    awaitStatus("up, 1 packets, 1 dwells, 2 reports");
    waitUntil(() -> task("feed").counter("dropped: size mismatch") == 2, "two size mismatches");
    waitUntil(() -> task("feed").counter("dropped: malformed") == 1, "one malformed");
    assertThat(task("feed").restarts()).as("UDP goes on").isZero();
  }

  @Test
  void criterion12_aMulticastLinkReceivesWhatIsSentToTheGroupOnLoopback() throws Exception {
    int port = freeUdpPort();
    String group = "239.255.46.1";
    useLinks("{\"name\":\"feed\",\"mode\":\"udp\",\"listen\":{\"port\":" + port + "},\"multicastGroup\":\"" + group
        + "\",\"multicastInterface\":\"127.0.0.1\"}");
    awaitStatus("feed [in udp on " + group + ":" + port + "]: up");
    var sender = peer(new MulticastSocket(new InetSocketAddress(LOOPBACK, 0)));
    sender.setNetworkInterface(NetworkInterface.getByInetAddress(LOOPBACK));
    sender.setTimeToLive(0); // never leaves this computer, as the ESA's playback
    byte[] p = packet(4);
    long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
    while (!ctx.effectiveStatus().detail().contains("4 reports") && System.nanoTime() < deadline) {
      sender.send(new DatagramPacket(p, p.length, InetAddress.getByName(group), port)); // until the join has taken
      ctx.runUntilIdle();
      Thread.sleep(50);
    }
    awaitStatus("4 reports");
  }

  @Test
  void udpOut_sendsEachPacketOfADwellAsItsOwnDatagram() throws Exception {
    var peer = peer(new DatagramSocket(0, LOOPBACK));
    useLinks("{\"name\":\"feed\",\"mode\":\"udp\",\"direction\":\"out\",\"host\":\"127.0.0.1\",\"port\":" + peer.getLocalPort() + "}");
    awaitStatus("feed [out udp to 127.0.0.1:" + peer.getLocalPort() + "]: up");
    outgoing("sensor-1", packet(2), packet(3));
    assertThat(receive(peer)).isEqualTo(packet(2));
    assertThat(receive(peer)).isEqualTo(packet(3));
    awaitStatus("up, 1 dwells sent a minute, 0 dropped");
  }

  // ---------------------------------------------------------------- TCP client

  @Test
  void tcpClientIn_framesTheStreamByThePacketSize() throws Exception {
    var server = peer(new ServerSocket(0, 5, LOOPBACK));
    useLinks(tcpClient("in", server.getLocalPort()));
    Socket conn = accept(server);
    byte[] a = packet(3);
    byte[] b = packet(1);
    byte[] both = new byte[a.length + b.length];
    System.arraycopy(a, 0, both, 0, a.length);
    System.arraycopy(b, 0, both, a.length, b.length);
    OutputStream out = conn.getOutputStream();
    out.write(both, 0, 7); // a packet split across writes
    out.flush();
    Thread.sleep(50);
    out.write(both, 7, both.length - 7);
    out.flush();
    awaitStatus("feed [in tcp-client to 127.0.0.1:" + server.getLocalPort() + "]: up, 2 packets, 2 dwells, 4 reports");
  }

  @Test
  void criterion8_aMalformedPacketOverTcpIsDroppedAndTheTaskReconnects() throws Exception {
    var server = peer(new ServerSocket(0, 5, LOOPBACK));
    useLinks(tcpClient("in", server.getLocalPort()));
    Socket conn = accept(server);
    byte[] bad = packet(1);
    ByteBuffer.wrap(bad).putInt(32 + 5 + 39 + 1, 9_999);
    write(conn, packet(1));
    write(conn, bad);
    awaitStatus("down: a malformed packet");
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    assertThat(task("feed").counter("dropped: malformed")).isEqualTo(1);
    task("feed").awaitIdle();
    ctx.advance(Duration.ofSeconds(1)); // the first back-off
    write(accept(server), packet(2));
    awaitStatus("up, 2 packets, 2 dwells, 3 reports");
    assertThat(task("feed").restarts()).isEqualTo(1);
  }

  @Test
  void aPacketOver65535BytesIsTooLongAndTheTaskReconnects() throws Exception {
    var server = peer(new ServerSocket(0, 5, LOOPBACK));
    useLinks(tcpClient("in", server.getLocalPort()));
    Socket conn = accept(server);
    byte[] huge = Arrays.copyOf(packet(0), 40);
    ByteBuffer.wrap(huge).putInt(2, 70_000);
    write(conn, huge);
    awaitStatus("down: a packet of 70000 bytes");
    assertThat(task("feed").counter("dropped: too long")).isEqualTo(1);
    task("feed").awaitIdle();
    ctx.advance(Duration.ofSeconds(1));
    write(accept(server), packet(1));
    awaitStatus("up, 1 packets");
  }

  @Test
  void tcpClientOut_writesEachDwellsPacketsBackToBack() throws Exception {
    var server = peer(new ServerSocket(0, 5, LOOPBACK));
    useLinks(tcpClient("out", server.getLocalPort()));
    var in = new DataInputStream(accept(server).getInputStream());
    awaitStatus("]: up");
    outgoing("sensor-1", packet(2), packet(0));
    assertThat(readPacket(in)).isEqualTo(packet(2));
    assertThat(readPacket(in)).isEqualTo(packet(0));
    awaitStatus("up, 1 dwells sent");
  }

  // ---------------------------------------------------------------- TCP server

  @Test
  void tcpServerIn_takesWhatEachClientSends() throws Exception {
    int port = freeTcpPort();
    useLinks(tcpServer("in", port));
    awaitStatus("feed [in tcp-server on 127.0.0.1:" + port + "]: listening, 0 clients");
    write(connect(port), packet(1));
    write(connect(port), packet(2));
    awaitStatus("2 packets, 2 dwells, 3 reports");
  }

  @Test
  void tcpServerOut_givesEveryDwellToEveryClient() throws Exception {
    int port = freeTcpPort();
    useLinks(tcpServer("out", port));
    awaitStatus("listening");
    var one = new DataInputStream(connect(port).getInputStream());
    var two = new DataInputStream(connect(port).getInputStream());
    awaitStatus("listening, 2 clients");
    outgoing("sensor-1", packet(5));
    assertThat(readPacket(one)).isEqualTo(packet(5));
    assertThat(readPacket(two)).isEqualTo(packet(5));
  }

  // ---------------------------------------------------------------- the worker

  @Test
  void aLinkWhoseConnectionChangesStartsAgainAndABadOneIsReported() throws Exception {
    int port = freeUdpPort();
    useLinks("{\"name\":\"feed\",\"mode\":\"udp\",\"listen\":{\"port\":" + port + "}}");
    awaitStatus("]: up");
    int other = freeUdpPort();
    useLinks("{\"name\":\"feed\",\"mode\":\"udp\",\"listen\":{\"port\":" + other + "}}", "{\"name\":\"Bad Name\"}",
        "{\"name\":\"grp\",\"mode\":\"udp\",\"listen\":{\"port\":46001},\"multicastGroup\":\"10.0.0.1\"}");
    awaitStatus("feed [in udp on 127.0.0.1:" + other + "]: up");
    assertThat(ctx.effectiveStatus().detail()).contains("a link needs a name").contains("10.0.0.1 is not a multicast group");
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    useLinks();
    awaitStatus("no links");
  }

  @Test
  void theFramerTakesAFileOfPacketsBackToBack() throws Exception {
    // A recording is packets back to back, as a TCP stream carries them (reference 5).
    byte[] a = packet(2);
    byte[] b = packet(0);
    var file = new java.io.ByteArrayOutputStream();
    file.write(a);
    file.write(b);
    var got = new ArrayList<byte[]>();
    PacketFramer.read(FakeTaskContext.<LinkInbox>of("file"), new java.io.ByteArrayInputStream(file.toByteArray()), got::add);
    assertThat(got).hasSize(2);
    assertThat(got.get(0)).isEqualTo(a);
    assertThat(Decoder.decode(got.get(1)).packet()).isNotNull();
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

  /** A dwell for the link "feed"; the worker handles it at once. */
  private void outgoing(String key, byte[]... packets) {
    links.send(new TransportMsg.Outgoing("feed", key, Arrays.stream(packets).map(Bytes::of).toList()));
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

  private static void write(Socket socket, byte[] bytes) throws Exception {
    OutputStream out = socket.getOutputStream();
    out.write(bytes);
    out.flush();
  }

  private static byte[] readPacket(DataInputStream in) throws Exception {
    byte[] head = new byte[6];
    in.readFully(head);
    int size = (int) Decoder.packetSize(head, 0);
    byte[] packet = Arrays.copyOf(head, size);
    in.readFully(packet, 6, size - 6);
    return packet;
  }

  private static void send(DatagramSocket from, byte[] bytes, int port) throws Exception {
    from.send(new DatagramPacket(bytes, bytes.length, LOOPBACK, port));
  }

  private static byte[] receive(DatagramSocket socket) throws Exception {
    socket.setSoTimeout(10_000);
    var packet = new DatagramPacket(new byte[65_507], 65_507);
    socket.receive(packet);
    return Arrays.copyOf(packet.getData(), packet.getLength());
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
