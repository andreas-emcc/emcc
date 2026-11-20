package dev.emcc.plugins.template.transport;

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
    Link l = link("{\"name\":\"feed-north\",\"mode\":\"tcp-client\",\"direction\":\"in\",\"host\":\"radar.example\",\"port\":30003}");
    assertThat(l.host()).isEqualTo("radar.example");
    assertThat(l.port()).isEqualTo(30003);
    assertThat(l.listen()).isNull();
    assertThat(l.where()).isEqualTo("in tcp-client to radar.example:30003");
    assertThatThrownBy(() -> link("{\"name\":\"x\",\"mode\":\"tcp-client\",\"port\":30003}")).hasMessage("link x: needs a host");
  }

  @Test
  void aListeningLinkBindsToLoopbackUnlessAnAdminSetsAnAddress() {
    Link server = link("{\"name\":\"s\",\"mode\":\"tcp-server\",\"direction\":\"out\",\"listen\":{\"port\":4000}}");
    assertThat(server.listen().address()).isEqualTo("127.0.0.1");
    Link udp = link("{\"name\":\"u\",\"mode\":\"udp\",\"listen\":{\"address\":\"0.0.0.0\",\"port\":10110}}");
    assertThat(udp.listen().allInterfaces()).isTrue();
    assertThat(udp.host()).isNull();
    assertThatThrownBy(() -> link("{\"name\":\"u\",\"mode\":\"udp\"}")).hasMessage("link u: needs a listen port");
  }

  @Test
  void aUdpLinkThatSendsAndReceivesHasBothItsListenAddressAndItsPeer() {
    Link l = link("{\"name\":\"u\",\"mode\":\"udp\",\"direction\":\"both\",\"host\":\"127.0.0.1\",\"port\":5001,\"listen\":{\"port\":5000}}");
    assertThat(l.where()).isEqualTo("both udp on 127.0.0.1:5000 to 127.0.0.1:5001");
  }

  @Test
  void refusesABadNameModeOrPort() {
    assertThatThrownBy(() -> link("{\"name\":\"Feed 1\",\"host\":\"h\",\"port\":1}")).hasMessageStartingWith("a link needs a name");
    assertThatThrownBy(() -> link("{\"name\":\"f\",\"mode\":\"serial\"}")).hasMessage("link f: unknown mode serial");
    assertThatThrownBy(() -> link("{\"name\":\"f\",\"host\":\"h\",\"port\":70000}")).hasMessage("link f: needs a port from 1 to 65535");
  }

  @Test
  void defaultsToAnEnabledTcpClientThatReceivesWithAnIdleTime() {
    Link l = link("{\"name\":\"f\",\"host\":\"h\",\"port\":1}");
    assertThat(l.mode()).isEqualTo(Link.Mode.TCP_CLIENT);
    assertThat(l.direction()).isEqualTo(Link.Direction.IN);
    assertThat(l.idle()).hasSeconds(120);
    assertThat(l.enabled()).isTrue();
  }

  @Test
  void aTcpClientMayTalkTlsWithThePickedCredentialOrTheLinksName() {
    Link picked = link("{\"name\":\"tak-north\",\"host\":\"tak.example\",\"port\":8089,\"tls\":true,\"tlsCredential\":\"tak-ca\"}");
    assertThat(picked.tls()).isTrue();
    assertThat(picked.credential()).isEqualTo("tak-ca");
    assertThat(picked.where()).isEqualTo("in tcp-client with TLS to tak.example:8089");
    Link byName = link("{\"name\":\"tak-north\",\"host\":\"tak.example\",\"port\":8089,\"tls\":true,\"tlsCredential\":\"\"}");
    assertThat(byName.credential()).isEqualTo("tak-north"); // empty: the link's name (ADR-0062 point 3)
    // without tls, or in another mode, a stored credential is kept in the settings but not used
    Link plain = link("{\"name\":\"tak-north\",\"host\":\"tak.example\",\"port\":8087,\"tlsCredential\":\"tak-ca\"}");
    assertThat(plain.tls()).isFalse();
    assertThat(plain.tlsCredential()).isEmpty();
    Link udp = link("{\"name\":\"feed\",\"mode\":\"udp\",\"direction\":\"out\",\"host\":\"127.0.0.1\",\"port\":5000,\"tls\":true}");
    assertThat(udp.tls()).isFalse();
  }
}
