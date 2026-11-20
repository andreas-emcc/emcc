package dev.emcc.plugins.ais.transport;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.ais.transport.LinkStatus.State;
import org.junit.jupiter.api.Test;

/** What a link says about itself, for each state. */
class LinkStatusTest {

  private static LinkStatus tcp(State state, String error) {
    return new LinkStatus("harbour", "in tcp-client to ais.example:5631", false, state, error, 120, 45, "Harbour");
  }

  private static LinkStatus udp(State state, String error) {
    return new LinkStatus("radio", "in udp on 127.0.0.1:10110", true, state, error, 3, 2, null);
  }

  @Test
  void criterion14_aTcpLinkIsConnectingThenUp() {
    assertThat(tcp(State.STARTING, null).text()).isEqualTo("harbour [in tcp-client to ais.example:5631]: connecting, 120 msg/min, 45 ships/min, layer 'Harbour'");
    assertThat(tcp(State.UP, null).text()).isEqualTo("harbour [in tcp-client to ais.example:5631]: up, 120 msg/min, 45 ships/min, layer 'Harbour'");
    assertThat(tcp(State.UP, null).healthy()).isTrue();
    assertThat(tcp(State.STARTING, null).healthy()).isFalse();
  }

  @Test
  void criterion14_aUdpLinkIsStartingThenListening() {
    assertThat(udp(State.STARTING, null).text()).isEqualTo("radio [in udp on 127.0.0.1:10110]: starting, 3 msg/min, 2 ships/min");
    assertThat(udp(State.UP, null).text()).isEqualTo("radio [in udp on 127.0.0.1:10110]: listening, 3 msg/min, 2 ships/min");
  }

  @Test
  void criterion14_aLinkThatIsDownSaysWhy() {
    LinkStatus down = tcp(State.DOWN, "Connection refused");
    assertThat(down.text()).startsWith("harbour [in tcp-client to ais.example:5631]: down: Connection refused, ");
    assertThat(down.healthy()).isFalse();
    assertThat(tcp(State.DOWN, null).text()).contains("down: not started");
  }

  @Test
  void aReasonIsCleanedAndCutShort() {
    String text = tcp(State.DOWN, "bad\nline and " + "x".repeat(200)).text();
    assertThat(text).doesNotContain("\n").doesNotContain(" ");
    assertThat(text).contains("bad line and ").contains("...");
    assertThat(text.length()).isLessThan(250);
  }

  @Test
  void criterion14_aLinkSwitchedOffIsNoProblem() {
    LinkStatus off = tcp(State.SWITCHED_OFF, null);
    assertThat(off.text()).isEqualTo("harbour [in tcp-client to ais.example:5631]: switched off");
    assertThat(off.healthy()).isTrue();
  }

  @Test
  void theRateIsWhatHappenedInTheLastMinute() {
    var rate = new Rate();
    assertThat(rate.perMinute(5)).isEqualTo(5); // the first minute counts everything
    long total = 0;
    for (int second = 1; second <= 60; second++) {
      total += 2;
      rate.sample(total);
    }
    assertThat(rate.perMinute(total)).isEqualTo(120);
    for (int second = 1; second <= 30; second++) { // 30 quiet seconds
      rate.sample(total);
    }
    assertThat(rate.perMinute(total)).isEqualTo(60);
    for (int second = 1; second <= 30; second++) {
      rate.sample(total);
    }
    assertThat(rate.perMinute(total)).isZero();
  }
}
