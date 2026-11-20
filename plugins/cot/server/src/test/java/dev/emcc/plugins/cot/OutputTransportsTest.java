package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import dev.emcc.plugins.cot.codec.CotEvent;
import dev.emcc.plugins.cot.codec.CotXml;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.store.Change;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Acceptance criterion 14 for the links that send: UDP, multicast and TLS, each against a real socket on this computer. */
class OutputTransportsTest {

  @TempDir
  Path folder;

  @AfterEach
  void closeRigs() {
    Rig.closeAll();
  }

  private static Layer layer(Rig rig, String name) {
    Layer layer = rig.ctx.store().seedLayer(name);
    rig.ctx.store().gap();
    rig.ctx.runUntilIdle();
    return layer;
  }

  private static void draw(Rig rig, Layer layer, String name, double lon, double lat) {
    var content = new MapObjectContent("core.symbol", "core.general", "manual", null, layer.id(), new Geometry.Point(Position.of(lon, lat)),
        new Symbol(SymbolStandard.APP_6B, "SFGPUCI--------", null), null, new ObjectProperties(name, null), rig.ctx.defaultLabel(), Extensions.empty());
    rig.ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.createObject(UUID.randomUUID(), content));
    rig.ctx.runUntilIdle();
  }

  private static String sources(Layer layer) {
    return "\"sourceLayers\":[{\"id\":\"" + layer.id() + "\",\"name\":\"" + layer.content().name() + "\"}]";
  }

  private static void awaitState(Rig rig, String link, String state) {
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return rig.part(link).startsWith(link + ": " + state);
    }, "link " + link + " to be '" + state + "' (status: " + rig.status() + ")");
  }

  private static CotEvent receive(DatagramSocket socket) throws Exception {
    socket.setSoTimeout(10_000);
    var packet = new DatagramPacket(new byte[65_535], 65_535);
    socket.receive(packet);
    return new CotXml().parse(new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8));
  }

  private static void send(DatagramSocket from, String text, InetAddress to, int port) throws Exception {
    byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
    from.send(new DatagramPacket(bytes, bytes.length, to, port));
  }

  // ---------------------------------------------------------------- UDP

  @Test
  void criterion14_udp_anOutLinkSendsOneDatagramToAnEvent() throws Exception {
    try (var peer = new DatagramSocket(0, InetAddress.getLoopbackAddress())) {
      var rig = new Rig();
      Layer layer = layer(rig, "Own forces");
      draw(rig, layer, "ALPHA", 11.9746, 57.7089);
      String link = "{\"name\":\"mesh-out\",\"direction\":\"out\",\"transport\":\"udp\",\"host\":\"127.0.0.1\",\"port\":" + peer.getLocalPort() + "," + sources(layer) + "}";
      rig.ctx.changeSettings(rig.withLinks(link));
      rig.ctx.runUntilIdle();
      awaitState(rig, "mesh-out", "sending since");
      CotEvent event = receive(peer);
      assertThat(event.callsign()).isEqualTo("ALPHA");
      assertThat(event.type()).isEqualTo("a-f-G-U-C-I");
      assertThat(event.lon()).isEqualTo(11.9746);
      assertThat(event.lat()).isEqualTo(57.7089);

      draw(rig, layer, "BRAVO", 12.5, 58.25);
      assertThat(receive(peer).callsign()).isEqualTo("BRAVO");
      assertThat(rig.part("mesh-out")).contains("[out udp to 127.0.0.1:" + peer.getLocalPort() + "]");
    }
  }

  @Test
  void criterion14_udp_aBothLinkReceivesAndSendsOnOneSocket() throws Exception {
    // the peer binds another loopback address, so that the link does not send to itself
    try (var peer = new DatagramSocket(null)) {
      InetAddress other = InetAddress.getByName("127.0.0.2");
      peer.bind(new InetSocketAddress(other, 0));
      int port = peer.getLocalPort();
      var rig = new Rig();
      Layer layer = layer(rig, "Own forces");
      draw(rig, layer, "ALPHA", 11.9746, 57.7089);
      String link = "{\"name\":\"mesh\",\"direction\":\"both\",\"transport\":\"udp\",\"host\":\"127.0.0.2\",\"port\":" + port + "," + sources(layer) + "}";
      // the link listens on loopback at the same port, and sends to 127.0.0.2:port
      rig.ctx.changeSettings(rig.withLinks(link));
      rig.ctx.runUntilIdle();
      awaitState(rig, "mesh", "listening since");
      assertThat(receive(peer).callsign()).isEqualTo("ALPHA");

      send(peer, rig.freshAtom("from-peer", 0, 59.5, 18.5), InetAddress.getLoopbackAddress(), port);
      TcpPeer.waitUntil(() -> {
        rig.ctx.runUntilIdle();
        return rig.objects().stream().anyMatch(o -> o.meta().externalRef() != null && o.meta().externalRef().id().equals("from-peer"));
      }, "the object from the peer");
      assertThat(rig.object("from-peer").content().dataSource()).isEqualTo("mesh");
      assertThat(rig.part("mesh")).contains("[both udp 127.0.0.1:" + port + " and to 127.0.0.2:" + port + "]");
    }
  }

  // ---------------------------------------------------------------- multicast

  private static NetworkInterface multicastInterface() throws Exception {
    for (NetworkInterface ni : NetworkInterface.networkInterfaces().toList()) {
      if (ni.isUp() && ni.supportsMulticast() && !ni.isLoopback() && !ni.isVirtual()
          && ni.inetAddresses().anyMatch(a -> a instanceof java.net.Inet4Address && !a.isLinkLocalAddress())) {
        return ni;
      }
    }
    return null;
  }

  @Test
  void criterion14_multicast_anOutLinkSendsToTheGroupOnTheNamedInterface() throws Exception {
    NetworkInterface ni = multicastInterface();
    assumeTrue(ni != null, "this computer has no interface that carries multicast");
    InetAddress group = InetAddress.getByName("239.2.3.7");
    int port;
    try (var probe = new DatagramSocket(0)) {
      port = probe.getLocalPort();
    }
    try (var receiver = new MulticastSocket(null)) {
      receiver.setReuseAddress(true);
      receiver.bind(new InetSocketAddress(port));
      receiver.setNetworkInterface(ni);
      receiver.joinGroup(new InetSocketAddress(group, port), ni);
      var rig = new Rig();
      Layer layer = layer(rig, "Own forces");
      draw(rig, layer, "ALPHA", 11.9746, 57.7089);
      String link = "{\"name\":\"mesh\",\"direction\":\"out\",\"transport\":\"multicast\",\"address\":\"239.2.3.7\",\"port\":" + port
          + ",\"interface\":\"" + ni.getName() + "\"," + sources(layer) + "}";
      rig.ctx.changeSettings(rig.withLinks(link));
      rig.ctx.runUntilIdle();
      awaitState(rig, "mesh", "sending since");
      CotEvent event = receive(receiver);
      assertThat(event.callsign()).isEqualTo("ALPHA");
      assertThat(event.lat()).isEqualTo(57.7089);
    }
  }

  // ---------------------------------------------------------------- TLS

  @Test
  void criterion14_tls_aBothLinkSendsAndReceivesOverTheOneTlsConnection() throws Exception {
    TestTls tls = TestTls.create(folder);
    try (var peer = new TcpPeer(tls.server, true)) {
      var rig = new Rig(false, b -> b.tlsCredentials("tak-tls", tls.client));
      Layer layer = layer(rig, "Own forces");
      draw(rig, layer, "ALPHA", 11.9746, 57.7089);
      String link = "{\"name\":\"tak-tls\",\"direction\":\"both\",\"transport\":\"tls\",\"host\":\"127.0.0.1\",\"port\":" + peer.port() + "," + sources(layer) + "}";
      rig.ctx.changeSettings(rig.withLinks(link));
      rig.ctx.runUntilIdle();
      TcpPeer.waitUntil(() -> {
        rig.ctx.runUntilIdle();
        return peer.accepted() > 0 && Rig.events(peer.conn().received()).size() >= 1;
      }, "the object over TLS (status: " + rig.status() + ")");
      assertThat(Rig.events(peer.conn().received()).getFirst().callsign()).isEqualTo("ALPHA");
      assertThat(peer.accepted()).isEqualTo(1);
    }
  }
}
