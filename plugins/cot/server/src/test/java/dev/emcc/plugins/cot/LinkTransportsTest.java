package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import dev.emcc.plugins.cot.codec.Samples;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.Position;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Acceptance criterion 14 for the links that receive: TCP with TLS, UDP and multicast, each against a real socket on this computer. */
class LinkTransportsTest {

  @TempDir
  Path folder;

  @AfterEach
  void closeRigs() {
    Rig.closeAll();
  }

  private static Position position(MapObject object) {
    return ((Geometry.Point) object.content().geometry()).coordinates();
  }

  private static int freeUdpPort() throws Exception {
    try (var socket = new DatagramSocket(0, InetAddress.getLoopbackAddress())) {
      return socket.getLocalPort();
    }
  }

  private static void send(DatagramSocket from, String text, InetAddress to, int port) throws Exception {
    byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
    from.send(new DatagramPacket(bytes, bytes.length, to, port));
  }

  /** Waits until the link says it listens. */
  private static void awaitListening(Rig rig, String link) {
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return rig.part(link).startsWith(link + ": listening since");
    }, "link " + link + " to listen (status: " + rig.status() + ")");
  }

  private void addUdp(Rig rig, String name, int port, String extra) {
    String link = "{\"name\":\"" + name + "\",\"direction\":\"in\",\"transport\":\"udp\",\"port\":" + port + (extra.isEmpty() ? "" : "," + extra) + "}";
    rig.ctx.changeSettings(rig.withLinks(link));
    rig.ctx.runUntilIdle();
    awaitListening(rig, name);
  }

  // ---------------------------------------------------------------- UDP

  @Test
  void criterion14_udp_aDatagramIsOneEventAndAppearsInTheTargetLayer() throws Exception {
    var rig = new Rig();
    int port = freeUdpPort();
    addUdp(rig, "mesh", port, "\"targetLayer\":{\"name\":\"Mesh\"}");
    try (var sender = new DatagramSocket()) {
      send(sender, Samples.at("m1", 0, 59.3507, 18.1012), InetAddress.getLoopbackAddress(), port);
      rig.settle("mesh", 1);
    }
    MapObject object = rig.object("m1");
    assertThat(position(object)).isEqualTo(Position.of(18.1012, 59.3507));
    assertThat(object.content().dataSource()).isEqualTo("mesh");
    assertThat(rig.layerOf(object).content().name()).isEqualTo("Mesh");
    assertThat(object.content().symbol().sidc()).isEqualTo("SFGPUCI--------");
  }

  @Test
  void criterion23_aUdpLinkWithNoAddressListensOnLoopbackOnly() throws Exception {
    var rig = new Rig();
    int port = freeUdpPort();
    addUdp(rig, "mesh", port, "");
    InetSocketAddress at = (InetSocketAddress) rig.task("mesh").listening();
    assertThat(at.getAddress().isLoopbackAddress()).as("bound to " + at).isTrue();
    assertThat(at.getPort()).isEqualTo(port);
    assertThat(rig.part("mesh")).startsWith("mesh: listening since").contains("[in udp 127.0.0.1:" + port + "]");
  }

  @Test
  void aUdpLinkBindsToTheAddressAnAdminSets() throws Exception {
    var rig = new Rig();
    int port = freeUdpPort();
    String any = "\"address\":\"0.0.0.0\"";
    addUdp(rig, "mesh", port, any);
    InetSocketAddress at = (InetSocketAddress) rig.task("mesh").listening();
    assertThat(at.getAddress().isAnyLocalAddress()).as("bound to " + at).isTrue();
  }

  @Test
  void aDatagramLargerThanTheLimitIsDroppedAndCountedAndTheNextOneIsRead() throws Exception {
    var rig = new Rig();
    rig.ctx.changeSettings(rig.ctx.settings().with("maxEventBytes", dev.emcc.sdk.json.JsonNumber.of(1024)));
    int port = freeUdpPort();
    addUdp(rig, "mesh", port, "");
    String big = "<event uid=\"big\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"/><detail><remarks>" + "x".repeat(2000) + "</remarks></detail></event>";
    try (var sender = new DatagramSocket()) {
      send(sender, big, InetAddress.getLoopbackAddress(), port);
      send(sender, Samples.at("small", 0, 59.0, 18.0), InetAddress.getLoopbackAddress(), port);
      rig.settle("mesh", 2);
    }
    assertThat(rig.objects()).extracting(o -> o.meta().externalRef().id()).containsExactly("small");
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.status()).contains("too large 1");
    assertThat(rig.warnings()).hasSize(1);
  }

  @Test
  void aDatagramThatIsNotCotIsDroppedAndTheLinkGoesOn() throws Exception {
    var rig = new Rig();
    int port = freeUdpPort();
    addUdp(rig, "mesh", port, "");
    try (var sender = new DatagramSocket()) {
      send(sender, "not xml at all", InetAddress.getLoopbackAddress(), port);
      send(sender, Samples.at("ok", 0, 59.0, 18.0), InetAddress.getLoopbackAddress(), port);
      rig.settle("mesh", 2);
    }
    assertThat(rig.objects()).extracting(o -> o.meta().externalRef().id()).containsExactly("ok");
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.status()).contains("malformed 1");
  }

  @Test
  void aUdpLinkOnAPortThatIsInUseIsRetriedAndSaysWhy() throws Exception {
    var rig = new Rig();
    try (var taken = new DatagramSocket(0, InetAddress.getLoopbackAddress())) {
      int port = taken.getLocalPort();
      String link = "{\"name\":\"mesh\",\"direction\":\"in\",\"transport\":\"udp\",\"port\":" + port + "}";
      rig.ctx.changeSettings(rig.withLinks(link));
      TcpPeer.waitUntil(() -> {
        rig.ctx.runUntilIdle();
        return rig.status().contains("not connected");
      }, "the bind to fail (status: " + rig.status() + ")");
      assertThat(rig.part("mesh")).startsWith("mesh: not connected").contains("next try").contains("[in udp 127.0.0.1:");
    }
  }

  // ---------------------------------------------------------------- multicast

  /** An interface that is up and carries multicast, with an IPv4 address, or {@code null}. */
  private static NetworkInterface multicastInterface() throws Exception {
    List<NetworkInterface> all = NetworkInterface.networkInterfaces().toList();
    for (NetworkInterface ni : all) {
      if (ni.isUp() && ni.supportsMulticast() && !ni.isLoopback() && !ni.isVirtual()
          && ni.inetAddresses().anyMatch(a -> a instanceof java.net.Inet4Address && !a.isLinkLocalAddress())) {
        return ni;
      }
    }
    return null;
  }

  @Test
  void criterion14_multicast_aGroupJoinedOnANamedInterfaceDeliversEvents() throws Exception {
    NetworkInterface ni = multicastInterface();
    assumeTrue(ni != null, "this computer has no interface that carries multicast");
    var rig = new Rig();
    int port = freeUdpPort();
    String group = "239.2.3.1";
    String link = "{\"name\":\"mesh\",\"direction\":\"in\",\"transport\":\"multicast\",\"address\":\"" + group + "\",\"port\":" + port
        + ",\"interface\":\"" + ni.getName() + "\"}";
    rig.ctx.changeSettings(rig.withLinks(link));
    rig.ctx.runUntilIdle();
    awaitListening(rig, "mesh");
    try (var sender = new MulticastSocket()) {
      sender.setNetworkInterface(ni);
      send(sender, Samples.at("sa-1", 0, 59.3507, 18.1012), InetAddress.getByName(group), port);
      rig.settle("mesh", 1);
    }
    assertThat(position(rig.object("sa-1"))).isEqualTo(Position.of(18.1012, 59.3507));
    assertThat(rig.object("sa-1").content().dataSource()).isEqualTo("mesh");
  }

  @Test
  void aMulticastLinkOnAnInterfaceThatDoesNotExistSaysSo() {
    var rig = new Rig();
    String link = "{\"name\":\"mesh\",\"direction\":\"in\",\"transport\":\"multicast\",\"address\":\"239.2.3.1\",\"port\":6969,\"interface\":\"no-such-interface-9\"}";
    rig.ctx.changeSettings(rig.withLinks(link));
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return rig.status().contains("no network interface named 'no-such-interface-9'");
    }, "the link to say that the interface is missing (status: " + rig.status() + ")");
  }

  // ---------------------------------------------------------------- TLS

  @Test
  void criterion9_14_tlsWithAClientCertificate() throws Exception {
    TestTls tls = TestTls.create(folder);
    try (var peer = new TcpPeer(tls.server, true)) {
      var rig = new Rig(true, b -> b.tlsCredentials("tak-tls", tls.client));
      rig.addLink("tak-tls", peer, "tls", "");
      peer.liveConn().send(Samples.at("t1", 0, 59.3507, 18.1012));
      rig.settle("tak-tls", 1);
      assertThat(position(rig.object("t1"))).isEqualTo(Position.of(18.1012, 59.3507));
      assertThat(rig.part("tak-tls")).startsWith("tak-tls: connected since").contains("[in tls 127.0.0.1:" + peer.port() + "]");
      TcpPeer.waitUntil(() -> peer.conn().received().contains("t-x-c-t"), "the presence event over TLS");
    }
  }

  @Test
  void aTlsServerThatAsksForAClientCertificateRefusesAPluginWithoutOne() throws Exception {
    TestTls tls = TestTls.create(folder);
    try (var peer = new TcpPeer(tls.server, true)) {
      var rig = new Rig(false, b -> b.tlsCredentials("tak-tls", tls.clientWithoutCertificate));
      rig.ctx.changeSettings(rig.withLinks(Rig.tcp("tak-tls", peer.port()).replace("\"transport\":\"tcp\"", "\"transport\":\"tls\"")));
      TcpPeer.waitUntil(() -> {
        rig.ctx.runUntilIdle();
        return rig.status().contains("not connected");
      }, "the refused link to be seen (status: " + rig.status() + ")");
      assertThat(rig.objects()).isEmpty();
    }
  }

  @Test
  void aTlsLinkWithoutConfiguredCredentialsSaysSo() {
    var rig = new Rig();
    TcpPeer peer = rig.addPeer("tak-tls");
    rig.ctx.changeSettings(rig.withLinks(Rig.tcp("tak-tls", peer.port()).replace("\"transport\":\"tcp\"", "\"transport\":\"tls\"")));
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return rig.status().contains("the TLS credential 'tak-tls' is missing");
    }, "the link to say that its credentials are missing (status: " + rig.status() + ")");
    assertThat(peer.accepted()).as("no connection is opened to a host before the credentials are known").isZero();
  }
}
