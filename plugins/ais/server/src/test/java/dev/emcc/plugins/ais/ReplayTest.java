package dev.emcc.plugins.ais;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.ais.codec.Ais;
import dev.emcc.sdk.model.MapObject;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * A replay of a feed written for the test (the recordings stay out of the repository): about sixty sentences
 * of a harbour through a real UDP link, the whole plugin and the fake object store, with the objects and the
 * counters it must end with.
 */
class ReplayTest {

  private static final InetAddress LOOPBACK = InetAddress.getLoopbackAddress();

  private Rig rig;

  @AfterEach
  void stop() {
    if (rig != null) {
      rig.plugin.stop();
      rig.ctx.connections().stopAll();
    }
  }

  /** The feed: in the order a receiver would hear it. */
  private static List<String> feed() {
    var lines = new ArrayList<String>();
    // ten class A ships, each at three positions, moving north-east from 18.0 E, 59.0 N; ships 5 and 6 sail from the same row
    for (int step = 0; step < 3; step++) {
      for (int ship = 1; ship <= 10; ship++) {
        lines.add(Ais.classA(1 + ship % 3, 265_000_000L + ship, 0, 100 + ship, 18.0 + ship * 0.01 + step * 0.001, 59.0 + ship * 0.02 + step * 0.002, 900, 90).sentence());
      }
    }
    // five class B ships, two positions each
    for (int step = 0; step < 2; step++) {
      for (int ship = 1; ship <= 5; ship++) {
        lines.add(Ais.classB(230_000_000L + ship, 30, 24.9 + ship * 0.01 + step * 0.001, 60.1 + ship * 0.01, 1800, 511).sentence());
      }
    }
    // three voyage reports in two sentences each, and two static data reports
    for (int ship = 1; ship <= 3; ship++) {
      lines.addAll(Ais.voyage(265_000_000L + ship, 9_000_000 + ship, "CS" + ship, "SHIP " + ship, 70 + ship, 100, 20, 10, 12, 85, "STOCKHOLM").fragments(2, String.valueOf(ship)));
    }
    lines.add(Ais.partA(230_000_001L, "SEA BREEZE").sentence());
    lines.add(Ais.partB(230_000_001L, 36, "OH1234", 8, 4, 2, 2).sentence());
    // what is ignored or refused
    lines.add(Ais.other(4, 2_650_000, 168).sentence());
    lines.add(Ais.other(4, 2_650_001, 168).sentence());
    lines.add(Ais.classA(1, 265_000_001L, 0, 0, 18.0, 59.0, 0, 0).sentence().replaceFirst(",A,.", ",A,5")); // a wrong checksum
    lines.add(Ais.classA(1, 265_000_002L, 0, 0, 18.0, 59.0, 0, 0).sentence() + ",1700000000"); // a trailing tag
    lines.add(Ais.classA(1, 265_000_003L, 0, 0, 18.0, 59.0, 0, 0).sentence().replaceFirst("\\*..$", "")); // no checksum
    lines.add(Ais.classARaw(265_000_004L, 181 * 600_000L, 20 * 600_000L, 0, 0, 0).sentence()); // no position
    return lines;
  }

  private void waitUntil(BooleanSupplier condition, String what) {
    long deadline = System.nanoTime() + Duration.ofSeconds(20).toNanos();
    while (true) {
      rig.ctx.runUntilIdle();
      if (condition.getAsBoolean()) {
        return;
      }
      if (System.nanoTime() > deadline) {
        throw new AssertionError("waited 20 s for " + what + "; status: " + rig.ctx.pluginStatus().detail());
      }
      Thread.onSpinWait();
      Thread.yield();
    }
  }

  @Test
  void criterion15_aReplayOfAHarbourGivesTheExpectedShipsAndCounters() throws Exception {
    int port;
    try (var s = new DatagramSocket(0, LOOPBACK)) {
      port = s.getLocalPort();
    }
    rig = new Rig("{\"name\":\"harbour\",\"mode\":\"udp\",\"listen\":{\"port\":" + port + "},\"standardIdentity\":\"neutral\"}");
    waitUntil(() -> rig.ctx.pluginStatus().detail().contains("listening"), "the link to listen");

    List<String> lines = feed();
    try (var peer = new DatagramSocket(0, LOOPBACK)) {
      for (int i = 0; i < lines.size(); i += 4) { // four sentences to a datagram
        byte[] bytes = String.join("\r\n", lines.subList(i, Math.min(lines.size(), i + 4))).getBytes(StandardCharsets.UTF_8);
        peer.send(new DatagramPacket(bytes, bytes.length, LOOPBACK, port));
      }
    }
    var task = rig.ctx.connectionTask("harbour");
    waitUntil(() -> task.counter("frames in") == lines.size() && rig.ships().size() == 15 && rig.ctx.outstandingAsks() == 0, "the whole feed");

    // fifteen ships; the last position of each wins
    assertThat(rig.ships()).hasSize(15);
    MapObject last = rig.ship(265_000_010);
    assertThat(Rig.at(last).longitude()).isCloseTo(18.0 + 10 * 0.01 + 2 * 0.001, within(1e-5));
    assertThat(Rig.at(last).latitude()).isCloseTo(59.0 + 10 * 0.02 + 2 * 0.002, within(1e-5));
    assertThat(last.content().dataSource()).isEqualTo("harbour");
    assertThat(last.content().symbol().sidc()).isEqualTo("10043000001400000000");
    assertThat(rig.ship(265_000_001).content().properties().name()).isEqualTo("SHIP 1");
    assertThat(rig.ship(265_000_003).content().symbol().sidc()).isEqualTo("10043000001401000000"); // type 73: merchant
    assertThat(rig.ship(230_000_001).content().properties().name()).isEqualTo("SEA BREEZE");
    assertThat(rig.ship(230_000_005).content().properties().name()).isEqualTo("230000005");

    // the counters: what the task read, and why it did not use the rest
    assertThat(task.counter("frames in")).isEqualTo(lines.size());
    assertThat(task.counter("dropped: checksum")).isEqualTo(1);
    assertThat(task.counter("dropped: malformed")).isEqualTo(1);
    assertThat(task.counter("dropped: no checksum")).isEqualTo(1);
    assertThat(task.counter("no position")).isEqualTo(1);
    assertThat(task.counter("ignored: type 4")).isEqualTo(2);
    assertThat(task.counter("messages")).isEqualTo(30 + 10 + 3 + 2);
    assertThat(task.counters().keySet()).noneMatch(k -> k.equals("dropped: fragment lost") || k.equals("dropped: too long") || k.equals("dropped: too short"));
    assertThat(task.counter("ships created")).isEqualTo(15);
  }
}
