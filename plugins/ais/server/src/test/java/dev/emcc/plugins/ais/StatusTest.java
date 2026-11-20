package dev.emcc.plugins.ais;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.ais.codec.Ais;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.testkit.LogEntry;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.time.Duration;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Work package 4: the status of the plugin and the warnings in its log. */
class StatusTest {

  private static final InetAddress LOOPBACK = InetAddress.getLoopbackAddress();

  private Rig rig;

  @AfterEach
  void stop() {
    if (rig != null) {
      rig.plugin.stop();
      rig.ctx.connections().stopAll();
    }
  }

  private static int freeUdpPort() throws Exception {
    try (var socket = new DatagramSocket(0, LOOPBACK)) {
      return socket.getLocalPort();
    }
  }

  private static String udp(String name, int port) {
    return "{\"name\":\"" + name + "\",\"mode\":\"udp\",\"listen\":{\"port\":" + port + "}}";
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
  void withoutLinksTheStatusSaysSoAndIsOk() {
    rig = new Rig();
    assertThat(rig.ctx.pluginStatus().detail()).isEqualTo("no links");
    assertThat(rig.ctx.pluginStatus().state()).isEqualTo(PluginState.OK);
  }

  @Test
  void criterion14_aLinkSwitchedOffIsOkAndABadOneDegradesAndComesFirst() {
    rig = new Rig(Rig.link("off", ""), "{\"name\":\"bad\",\"mode\":\"tcp-client\"}");
    String detail = rig.ctx.pluginStatus().detail();
    assertThat(detail).startsWith("link bad: needs a host; off [in tcp-client to 127.0.0.1:9]: switched off");
    assertThat(rig.ctx.pluginStatus().state()).isEqualTo(PluginState.DEGRADED);

    rig.useLinks(Rig.link("off", ""));
    assertThat(rig.ctx.pluginStatus().state()).isEqualTo(PluginState.OK);
  }

  @Test
  void criterion14_aLinkThatIsUpSaysWhatItDoesPerMinuteAndInWhichLayer() throws Exception {
    rig = new Rig(udp("radio", freeUdpPort()));
    waitUntil(() -> rig.ctx.pluginStatus().detail().contains("listening"), "the link to listen");
    assertThat(rig.ctx.pluginStatus().state()).isEqualTo(PluginState.OK);

    rig.receive("radio", Ais.classA(1, 1, 0, 0, 18.0, 59.0, 0, 0));
    rig.receive("radio", Ais.classA(1, 1, 0, 0, 18.1, 59.1, 0, 0));
    rig.receive("radio", Ais.classA(1, 2, 0, 0, 18.2, 59.2, 0, 0));
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.ctx.pluginStatus().detail()).contains("radio [in udp on 127.0.0.1:").contains("]: listening, 3 msg/min, 3 ships/min, layer 'radio'");

    rig.advance(Duration.ofSeconds(61)); // a minute on, and nothing came
    assertThat(rig.ctx.pluginStatus().detail()).contains("listening, 0 msg/min, 0 ships/min, layer 'radio'");
  }

  @Test
  void criterion14_aLinkThatCannotConnectIsDownWithTheReasonAndWarnsOncePerMinute() throws Exception {
    int closed;
    try (var s = new ServerSocket(0, 1, LOOPBACK)) {
      closed = s.getLocalPort();
    }
    rig = new Rig("{\"name\":\"harbour\",\"mode\":\"tcp-client\",\"host\":\"127.0.0.1\",\"port\":" + closed + "}");
    waitUntil(() -> rig.ctx.pluginStatus().detail().contains("harbour [in tcp-client to 127.0.0.1:" + closed + "]: down: "), "the link to be down");
    assertThat(rig.ctx.pluginStatus().state()).isEqualTo(PluginState.DEGRADED);

    // the link tries again with its back-off, and fails the same way: one warning for the reason, not one for each try
    for (int tries = 1; tries <= 3; tries++) {
      int before = tries;
      waitUntil(() -> rig.ctx.connectionTask("harbour").restarts() >= before, "the run to end");
      rig.ctx.connectionTask("harbour").awaitIdle();
      rig.advance(Duration.ofSeconds(1L << (tries - 1)));
    }
    waitUntil(() -> rig.ctx.connectionTask("harbour").restarts() >= 4, "the fourth run to end");
    assertThat(rig.ctx.logEntries().stream().filter(e -> e.level() == LogEntry.Level.WARN && e.message().contains("is down")).count()).isEqualTo(1);
  }

  @Test
  void criterion14_theLinkCountsItsShipsAndItsStaticData() throws Exception {
    rig = new Rig(udp("radio", freeUdpPort()));
    waitUntil(() -> rig.ctx.pluginStatus().detail().contains("listening"), "the link to listen");
    var task = rig.ctx.connectionTask("radio");

    rig.receive("radio", Ais.voyage(5, 9_074_729, "WDC1234", "FIVE", 70, 100, 20, 10, 12, 85, "STOCKHOLM")); // no position yet
    assertThat(task.counter("static data kept")).isEqualTo(1);
    assertThat(rig.ships()).isEmpty();

    rig.receive("radio", Ais.classA(1, 5, 0, 0, 18.0, 59.0, 0, 0));
    rig.receive("radio", Ais.classA(1, 5, 0, 0, 18.1, 59.1, 0, 0));
    rig.receive("radio", Ais.classA(1, 6, 0, 0, 18.2, 59.2, 0, 0));
    assertThat(task.counter("ships created")).isEqualTo(2);
    assertThat(task.counter("ships updated")).isEqualTo(1);
    assertThat(rig.ship(5).content().properties().name()).isEqualTo("FIVE");

    rig.advance(Duration.ofMinutes(61)); // an hour after their last message the link forgets the ships' static data
    assertThat(task.counter("static data forgotten")).isEqualTo(2);
  }
}
