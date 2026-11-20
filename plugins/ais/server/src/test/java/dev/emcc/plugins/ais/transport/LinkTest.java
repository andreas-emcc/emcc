package dev.emcc.plugins.ais.transport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.testkit.TestJson;
import org.junit.jupiter.api.Test;

/** Reading one entry of the {@code links} setting, for each mode. */
class LinkTest {

  private static Link link(String json) {
    return Link.from((JsonObject) TestJson.parse(json));
  }

  @Test
  void aTcpClientNeedsItsPeerAndListensNowhere() {
    Link l = link("{\"name\":\"feed-north\",\"mode\":\"tcp-client\",\"direction\":\"in\",\"host\":\"ais.example\",\"port\":5631}");
    assertThat(l.host()).isEqualTo("ais.example");
    assertThat(l.port()).isEqualTo(5631);
    assertThat(l.listen()).isNull();
    assertThat(l.where()).isEqualTo("in tcp-client to ais.example:5631");
    assertThatThrownBy(() -> link("{\"name\":\"x\",\"mode\":\"tcp-client\",\"port\":5631}")).hasMessage("link x: needs a host");
  }

  @Test
  void aUdpLinkBindsToLoopbackUnlessAnAdminSetsAnAddress() {
    Link udp = link("{\"name\":\"u\",\"mode\":\"udp\",\"listen\":{\"port\":10110}}");
    assertThat(udp.listen().address()).isEqualTo("127.0.0.1");
    assertThat(udp.host()).isNull();
    assertThat(udp.where()).isEqualTo("in udp on 127.0.0.1:10110");
    Link open = link("{\"name\":\"u\",\"mode\":\"udp\",\"listen\":{\"address\":\"0.0.0.0\",\"port\":10110}}");
    assertThat(open.listen().allInterfaces()).isTrue();
    assertThatThrownBy(() -> link("{\"name\":\"u\",\"mode\":\"udp\"}")).hasMessage("link u: needs a listen port");
  }

  @Test
  void onlyReceivingModesExist() {
    assertThatThrownBy(() -> link("{\"name\":\"f\",\"mode\":\"tcp-server\",\"listen\":{\"port\":1}}")).hasMessage("link f: unknown mode tcp-server");
    assertThatThrownBy(() -> link("{\"name\":\"f\",\"host\":\"h\",\"port\":1,\"direction\":\"out\"}")).hasMessage("link f: unknown direction out");
    assertThatThrownBy(() -> link("{\"name\":\"f\",\"host\":\"h\",\"port\":1,\"direction\":\"both\"}")).hasMessage("link f: unknown direction both");
  }

  @Test
  void refusesABadNameOrPort() {
    assertThatThrownBy(() -> link("{\"name\":\"Feed 1\",\"host\":\"h\",\"port\":1}")).hasMessageStartingWith("a link needs a name");
    assertThatThrownBy(() -> link("{\"name\":\"f\",\"mode\":\"serial\"}")).hasMessage("link f: unknown mode serial");
    assertThatThrownBy(() -> link("{\"name\":\"f\",\"host\":\"h\",\"port\":70000}")).hasMessage("link f: needs a port from 1 to 65535");
  }

  @Test
  void defaultsToAnEnabledTcpClientThatReceivesWithAnIdleTimeOfFiveMinutes() {
    Link l = link("{\"name\":\"f\",\"host\":\"h\",\"port\":1}");
    assertThat(l.mode()).isEqualTo(Link.Mode.TCP_CLIENT);
    assertThat(l.direction()).isEqualTo(Link.Direction.IN);
    assertThat(l.idle()).hasSeconds(300);
    assertThat(l.enabled()).isTrue();
    assertThat(link("{\"name\":\"f\",\"host\":\"h\",\"port\":1,\"idleSeconds\":0}").idle()).isZero();
  }
}
