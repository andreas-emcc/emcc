package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Position;
import dev.emcc.plugins.cot.codec.Samples;
import java.io.IOException;
import java.nio.file.Path;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * M9 K1, brief function 33 and acceptance criterion 47: a TLS link picks its credential by name ({@code links[].tlsCredential}); empty uses the
 * link's name. Each test runs a real TLS handshake against a peer on this computer. The credentials of the test kit are named, like ECore's.
 */
class TlsCredentialTest {

  @TempDir
  Path folder;

  @AfterEach
  void closeRigs() {
    Rig.closeAll();
  }

  private static String tlsLink(String name, int port, String transport, String extra) {
    String link = Rig.tcp(name, port).replace("\"transport\":\"tcp\"", "\"transport\":\"" + transport + "\"");
    return extra.isEmpty() ? link : link.substring(0, link.length() - 1) + "," + extra + "}";
  }

  private static void waitConnected(Rig rig, String link) {
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return rig.part(link).startsWith(link + ": connected since");
    }, "link " + link + " to be connected (status: " + rig.status() + ")");
  }

  @Test
  void anEmptyCredentialUsesTheCredentialNamedLikeTheLink() throws Exception {
    TestTls tls = TestTls.create(folder);
    try (var peer = new TcpPeer(tls.server, true)) {
      var rig = new Rig(false, b -> b.tlsCredentials("tak-north", tls.client));
      rig.addLink("tak-north", peer, "tls", "\"tlsCredential\":\"\"");
      peer.liveConn().send(Samples.at("t1", 0, 59.3507, 18.1012));
      rig.settle("tak-north", 1);
      assertThat(((Geometry.Point) rig.object("t1").content().geometry()).coordinates()).isEqualTo(Position.of(18.1012, 59.3507));
    }
  }

  @Test
  void aPickedCredentialIsTheOnlyOneUsed_alsoAfterTheLinkIsRenamed() throws Exception {
    TestTls tls = TestTls.create(folder);
    try (var peer = new TcpPeer(tls.server, true)) {
      // only "tak-ca" exists: a link that fell back to its own name would fail
      var rig = new Rig(false, b -> b.tlsCredentials("tak-ca", tls.client));
      rig.addLink("tak-north", peer, "tls", "\"tlsCredential\":\"tak-ca\"");
      assertThat(peer.accepted()).isEqualTo(1);

      rig.ctx.changeSettings(rig.withLinks(tlsLink("tak-south", peer.port(), "tls", "\"tlsCredential\":\"tak-ca\"")));
      waitConnected(rig, "tak-south");
      assertThat(rig.status()).doesNotContain("tak-north");
    }
  }

  @Test
  void aPickedNameTheServerLacksFailsTheLinkBeforeItConnects_andTheStatusNamesTheCredentialAndNoPath() throws Exception {
    TestTls tls = TestTls.create(folder);
    try (var peer = new TcpPeer(tls.server, true)) {
      // the credential named like the link exists, but the link picks another
      var rig = new Rig(false, b -> b.tlsCredentials("tak-north", tls.client));
      rig.ctx.changeSettings(rig.withLinks(tlsLink("tak-north", peer.port(), "tls", "\"tlsCredential\":\"tak-ca\"")));
      TcpPeer.waitUntil(() -> {
        rig.ctx.runUntilIdle();
        return rig.status().contains("the TLS credential 'tak-ca' is missing");
      }, "the link to say which credential is missing (status: " + rig.status() + ")");
      assertThat(rig.status()).doesNotContain("/").doesNotContain("\\").doesNotContain("tak-north: connected");
      assertThat(peer.accepted()).as("no connection is opened before the credential is known").isZero();
    }
  }

  @Test
  void aTcpLinkIgnoresAStoredCredential_andAChangeOfItRestartsNothing() throws Exception {
    var rig = new Rig();
    TcpPeer peer = rig.addPeer("tak-north");
    rig.ctx.changeSettings(rig.withLinks(tlsLink("tak-north", peer.port(), "tcp", "\"tlsCredential\":\"nothing-here\"")));
    waitConnected(rig, "tak-north");
    assertThat(peer.accepted()).isEqualTo(1);
    rig.ctx.changeSettings(rig.withLinks(tlsLink("tak-north", peer.port(), "tcp", "\"tlsCredential\":\"another\"")));
    rig.ctx.runUntilIdle();
    rig.advance(java.time.Duration.ofSeconds(2));
    assertThat(peer.accepted()).as("not restarted").isEqualTo(1);
    assertThat(rig.status()).doesNotContain("credential");
  }

  @Test
  void aChangedCredentialRestartsATlsLinkWithTheNewOne() throws Exception {
    TestTls tls = TestTls.create(folder);
    try (var peer = new TcpPeer(tls.server, true)) {
      var rig = new Rig(false, b -> b.tlsCredentials("ca-a", tls.client).tlsCredentials("ca-b", tls.client));
      rig.addLink("tak-north", peer, "tls", "\"tlsCredential\":\"ca-a\"");
      assertThat(peer.accepted()).isEqualTo(1);
      rig.ctx.changeSettings(rig.withLinks(tlsLink("tak-north", peer.port(), "tls", "\"tlsCredential\":\"ca-b\"")));
      TcpPeer.waitUntil(() -> {
        rig.ctx.runUntilIdle();
        return peer.accepted() == 2;
      }, "the link to connect again with the new credential");
      waitConnected(rig, "tak-north");
    }
  }

  /** Criterion 47: the kit's fakes refuse a credential as ECore does; the link's own task fails its start and the status says why. */
  private void aRefusedCredentialFailsTheLinkBeforeItConnects(java.util.function.Consumer<dev.emcc.sdk.testkit.FakePluginContext.Builder> refuse, String reason) throws Exception {
    TestTls tls = TestTls.create(folder);
    try (var peer = new TcpPeer(tls.server, true)) {
      var rig = new Rig(false, refuse);
      rig.ctx.changeSettings(rig.withLinks(tlsLink("tak-north", peer.port(), "tls", "\"tlsCredential\":\"tak-ca\"")));
      TcpPeer.waitUntil(() -> {
        rig.ctx.runUntilIdle();
        return rig.status().contains(reason);
      }, "the link to say why its credential fails (status: " + rig.status() + ")");
      assertThat(rig.status()).contains("tak-ca").doesNotContain("/").doesNotContain("\\").doesNotContain("tak-north: connected");
      assertThat(peer.accepted()).as("no connection is opened with a refused credential").isZero();
    }
  }

  @Test
  void anExpiredCredentialFailsTheLinkBeforeItConnects_andTheStatusNamesItAndTheDate() throws Exception {
    aRefusedCredentialFailsTheLinkBeforeItConnects(b -> b.expiredTlsCredentials("tak-ca", java.time.LocalDate.of(2026, 3, 1)), "expired on 2026-03-01");
  }

  @Test
  void anUnreadableCredentialFailsTheLinkBeforeItConnects_andTheStatusNamesItAndTheReason() throws Exception {
    aRefusedCredentialFailsTheLinkBeforeItConnects(b -> b.unreadableTlsCredentials("tak-ca", "wrong password"), "wrong password");
  }

  @Test
  void theThreeRefusalsOfTheTaskAreSaidApart() {
    var expired = dev.emcc.sdk.testkit.FakeTaskContext.<LinkInbox>of("t")
        .expiredTlsCredentials("tak-ca", java.time.LocalDate.of(2026, 3, 1));
    assertThatThrownBy(() -> TcpLinkTask.credential(expired, "tak-ca")).isInstanceOf(IOException.class)
        .hasMessage("the TLS credential tak-ca: its certificate expired on 2026-03-01");
    var unreadable = dev.emcc.sdk.testkit.FakeTaskContext.<LinkInbox>of("t")
        .unreadableTlsCredentials("tak-ca", "wrong password");
    assertThatThrownBy(() -> TcpLinkTask.credential(unreadable, "tak-ca")).isInstanceOf(IOException.class)
        .hasMessage("the TLS credential tak-ca cannot be read: wrong password");
    var missing = dev.emcc.sdk.testkit.FakeTaskContext.<LinkInbox>of("t");
    assertThatThrownBy(() -> TcpLinkTask.credential(missing, "tak-ca")).isInstanceOf(IOException.class)
        .hasMessage("the TLS credential 'tak-ca' is missing");
  }
}
