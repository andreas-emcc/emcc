package dev.emcc.plugins.gmti.transport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.testkit.TestJson;
import java.time.Duration;
import org.junit.jupiter.api.Test;

/** One entry of the {@code links} setting (brief section 5): the connection's fields. */
class LinkTest {

  private static Link link(String json) {
    return Link.from((JsonObject) TestJson.parse(json));
  }

  @Test
  void aTcpClientNeedsItsPeerAndListensNowhere() {
    Link l = link("{\"name\":\"vista\",\"mode\":\"tcp-client\",\"host\":\"127.0.0.1\",\"port\":8113}");
    assertThat(l.direction()).isEqualTo(Link.Direction.IN);
    assertThat(l.listen()).isNull();
    assertThat(l.where()).isEqualTo("in tcp-client to 127.0.0.1:8113");
    assertThatThrownBy(() -> link("{\"name\":\"vista\",\"mode\":\"tcp-client\",\"port\":8113}")).hasMessageContaining("needs a host");
  }

  @Test
  void aListeningLinkBindsToLoopbackUnlessAnAdminSetsAnAddress() {
    assertThat(link("{\"name\":\"in\",\"mode\":\"tcp-server\",\"listen\":{\"port\":4607}}").listen().address()).isEqualTo("127.0.0.1");
    assertThat(link("{\"name\":\"in\",\"mode\":\"udp\",\"listen\":{\"address\":\"0.0.0.0\",\"port\":46002}}").listen().address()).isEqualTo("0.0.0.0");
  }

  @Test
  void aUdpInLinkMayJoinAMulticastGroup() {
    Link l = link("{\"name\":\"vista-udp\",\"mode\":\"udp\",\"listen\":{\"port\":46001},\"multicastGroup\":\"239.255.46.1\",\"multicastInterface\":\"127.0.0.1\"}");
    assertThat(l.multicastGroup()).isEqualTo("239.255.46.1");
    assertThat(l.multicastInterface()).isEqualTo("127.0.0.1");
    assertThat(l.where()).isEqualTo("in udp on 239.255.46.1:46001");
    assertThatThrownBy(() -> link("{\"name\":\"x\",\"mode\":\"udp\",\"listen\":{\"port\":46001},\"multicastGroup\":\"10.1.2.3\"}"))
        .hasMessageContaining("not a multicast group");
    assertThatThrownBy(() -> link("{\"name\":\"x\",\"mode\":\"udp\",\"listen\":{\"port\":46001},\"multicastGroup\":\"example.org\"}"))
        .as("no name is looked up").hasMessageContaining("not a multicast group");
  }

  @Test
  void aUdpOutLinkSendsToItsHostAGroupIncluded() {
    Link l = link("{\"name\":\"out\",\"mode\":\"udp\",\"direction\":\"out\",\"host\":\"239.255.46.2\",\"port\":46002,\"multicastInterface\":\"127.0.0.1\"}");
    assertThat(l.listen()).isNull();
    assertThat(l.multicastGroup()).isNull();
    assertThat(l.where()).isEqualTo("out udp to 239.255.46.2:46002");
  }

  @Test
  void refusesABadNameModeDirectionOrPort() {
    assertThatThrownBy(() -> link("{\"name\":\"Vista\"}")).hasMessageContaining("lowercase");
    assertThatThrownBy(() -> link("{\"name\":\"v\",\"mode\":\"serial\"}")).hasMessageContaining("unknown mode serial");
    assertThatThrownBy(() -> link("{\"name\":\"v\",\"direction\":\"both\",\"host\":\"h\",\"port\":1}")).as("no both").hasMessageContaining("unknown direction both");
    assertThatThrownBy(() -> link("{\"name\":\"v\",\"host\":\"h\",\"port\":70000}")).hasMessageContaining("port from 1 to 65535");
  }

  @Test
  void defaultsToAnEnabledTcpClientThatReceivesWithAnIdleTime() {
    Link l = link("{\"name\":\"v\",\"host\":\"h\",\"port\":1}");
    assertThat(l.mode()).isEqualTo(Link.Mode.TCP_CLIENT);
    assertThat(l.enabled()).isTrue();
    assertThat(l.idle()).isEqualTo(Duration.ofSeconds(120));
  }
}
