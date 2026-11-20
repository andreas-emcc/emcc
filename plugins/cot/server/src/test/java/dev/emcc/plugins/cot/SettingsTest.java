package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.cot.codec.Samples;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.testkit.TestJson;
import java.time.Duration;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** The plugin's reaction to its settings: links come and go without a restart, bad ones are reported, and stored streams are not read. */
class SettingsTest {

  @AfterEach
  void closeRigs() {
    Rig.closeAll();
  }

  @Test
  void settingsChangesOpenAndCloseLinksWithoutARestart() {
    var rig = new Rig();
    assertThat(rig.status()).isEqualTo("no link configured");

    TcpPeer north = rig.addPeer("tak-north");
    rig.ctx.changeSettings(rig.withLinks(Rig.tcp("tak-north", north.port())));
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.connections().names()).containsExactly("tak-north");
    rig.awaitUp("tak-north");
    rig.feed("tak-north", Samples.at("n1", 0, 59.0, 18.0));

    TcpPeer south = rig.addPeer("tak-south");
    rig.ctx.changeSettings(rig.withLinks(Rig.tcp("tak-north", north.port()), Rig.tcp("tak-south", south.port())));
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.connections().names()).containsExactly("tak-north", "tak-south");
    rig.awaitUp("tak-south");
    assertThat(north.accepted()).as("an unchanged link keeps its connection").isEqualTo(1);

    rig.ctx.changeSettings(rig.withLinks(Rig.tcp("tak-south", south.port())));
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.connections().names()).containsExactly("tak-south");
    assertThat(rig.objects()).as("objects of a removed link stay").hasSize(1);
    TcpPeer.waitUntil(() -> north.conn().closedByPlugin(), "the removed link's connection to be closed");

    rig.ctx.changeSettings(rig.withLinks());
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.connections().names()).isEmpty();
    assertThat(rig.status()).isEqualTo("no link configured");
  }

  /** SDK 1.8.0 part F (T-204): ECore gives each link a stable id when it loads the settings and at every change; the plugin reads none of it. */
  @Test
  void aLinkThatGetsAnIdFromECoreIsTheSameLinkAndKeepsItsConnection() {
    var rig = new Rig();
    TcpPeer north = rig.addPeer("tak-north");
    rig.ctx.changeSettings(rig.withLinks(Rig.tcp("tak-north", north.port())));
    rig.ctx.runUntilIdle();
    rig.awaitUp("tak-north");
    assertThat(north.accepted()).isEqualTo(1);

    String link = Rig.tcp("tak-north", north.port());
    String withId = link.substring(0, link.lastIndexOf('}')) + ",\"id\":\"0195c0a0-7b3e-7c1d-8f2a-5b6c7d8e9f10\"}";
    rig.ctx.changeSettings(rig.withLinks(withId));
    rig.ctx.runUntilIdle();
    rig.advance(Duration.ofSeconds(2));
    assertThat(rig.ctx.connections().names()).containsExactly("tak-north");
    assertThat(rig.part("tak-north")).as("not a problem").doesNotContain("problem");
    assertThat(north.accepted()).as("the id changes nothing: the link is not restarted").isEqualTo(1);
  }

  @Test
  void aChangedPortOrALinkThatIsSwitchedOffClosesTheConnection() {
    var rig = new Rig("tak-north");
    TcpPeer first = rig.peer("tak-north");
    TcpPeer second = rig.addPeer("tak-north-2");

    rig.ctx.changeSettings(rig.withLinks(Rig.tcp("tak-north", second.port())));
    rig.ctx.runUntilIdle();
    second.conn();
    TcpPeer.waitUntil(() -> first.conn().closedByPlugin(), "the old connection to be closed");
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return rig.part("tak-north").startsWith("tak-north: connected since") && rig.part("tak-north").contains("127.0.0.1:" + second.port() + "]");
    }, "the link to be up on the new port");

    rig.ctx.changeSettings(rig.withLinks(Rig.tcp("tak-north", second.port()).replace("\"direction\"", "\"enabled\":false,\"direction\"")));
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.connections().names()).isEmpty();
    assertThat(rig.status()).contains("tak-north: disabled");
    assertThat(rig.ctx.effectiveStatus().state()).as("a link that is switched off is not a fault").isEqualTo(PluginState.OK);
  }

  @Test
  void aChangedTargetLayerOrLabelNeedsNoReconnect() {
    var rig = new Rig("tak-north");
    TcpPeer peer = rig.peer("tak-north");
    String relabelled = Rig.tcp("tak-north", peer.port()).replace("\"direction\"", "\"targetLayer\":{\"name\":\"Elsewhere\"},\"direction\"");
    rig.ctx.changeSettings(rig.withLinks(relabelled));
    rig.ctx.runUntilIdle();
    assertThat(peer.accepted()).isEqualTo(1);
    assertThat(peer.conn().closedByPlugin()).isFalse();
  }

  @Test
  void aBadLinkIsReportedAndTheGoodOnesWork() {
    var rig = new Rig("tak-north");
    TcpPeer peer = rig.peer("tak-north");
    rig.ctx.changeSettings(rig.withLinks(Rig.tcp("tak-north", peer.port()),
        "{\"name\":\"manual\",\"direction\":\"in\",\"host\":\"x.example.local\",\"port\":1}",
        "{\"name\":\"Bad Name\",\"direction\":\"in\",\"host\":\"x.example.local\",\"port\":1}"));
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.connections().names()).containsExactly("tak-north");
    assertThat(rig.ctx.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    assertThat(rig.status()).contains("'manual' is reserved").contains("lowercase words");
  }

  @Test
  void twoLinksWithTheSameNameAreRefused() {
    var rig = new Rig("tak-north");
    TcpPeer peer = rig.peer("tak-north");
    rig.ctx.changeSettings(rig.withLinks(Rig.tcp("tak-north", peer.port()), Rig.tcp("tak-north", peer.port())));
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.connections().names()).containsExactly("tak-north");
    assertThat(rig.status()).contains("used twice");
  }

  @Test
  void eventsThatWaitForALayerAreDroppedWhenTheirLinkGoesAndTheUidWorksAgainLater() {
    var rig = new Rig("tak-north");
    TcpPeer peer = rig.peer("tak-north");
    rig.ctx.store().rejectNext(dev.emcc.sdk.model.ChangeRejection.Code.INTERNAL_ERROR, "busy"); // the layer cannot be made
    rig.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0));
    assertThat(rig.objects()).as("the event waits for its layer").isEmpty();

    rig.ctx.changeSettings(rig.withLinks()); // the link goes
    rig.ctx.runUntilIdle();
    rig.advance(Duration.ofSeconds(30));
    assertThat(rig.objects()).as("nothing was made for the link that went").isEmpty();

    rig.ctx.changeSettings(rig.withLinks(Rig.tcp("tak-north", peer.port())));
    rig.ctx.runUntilIdle();
    rig.awaitUp("tak-north");
    rig.feed("tak-north", Samples.at("u1", 10, 59.1, 18.1));
    assertThat(rig.object("u1").content().dataSource()).isEqualTo("tak-north");
    assertThat(rig.ctx.handlerErrors()).isEmpty();
  }

  @Test
  void aLinkThatIsSwitchedOffMakesNoLayerAndKeepsNoEventsWaiting() {
    var rig = new Rig("tak-north");
    TcpPeer peer = rig.peer("tak-north");
    rig.ctx.store().rejectNext(dev.emcc.sdk.model.ChangeRejection.Code.INTERNAL_ERROR, "busy");
    rig.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0));
    rig.ctx.changeSettings(rig.withLinks(Rig.tcp("tak-north", peer.port()).replace("\"direction\"", "\"enabled\":false,\"direction\"")));
    rig.ctx.runUntilIdle();
    long before = rig.requests(dev.emcc.sdk.model.Operation.CREATE);
    rig.advance(Duration.ofSeconds(30));
    assertThat(rig.requests(dev.emcc.sdk.model.Operation.CREATE)).as("no new try for a layer").isEqualTo(before);
    assertThat(rig.objects()).isEmpty();
  }

  @Test
  void theStoredStreamsAndTheProblemsComeFirstSoALongStatusDoesNotCutThemOff() {
    var rig = new Rig("link-a", "link-b", "link-c", "link-d");
    rig.ctx.changeSettings(rig.ctx.settings().with("streams", JsonArray.of(TestJson.parse("{\"name\":\"old-north\",\"host\":\"h\",\"port\":1}"))));
    rig.ctx.runUntilIdle();
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.status().length()).isLessThanOrEqualTo(512);
    assertThat(rig.status()).startsWith("1 stored streams (old-north) are no longer read: enter them as links");
    assertThat(rig.status()).contains("link-a: connected since");
  }

  // ---------------------------------------------------------------- criterion 23

  @Test
  void criterion23_aMulticastLinkWithoutAnInterfaceStaysStoppedAndSaysSo() {
    var rig = new Rig();
    rig.ctx.changeSettings(rig.withLinks(
        "{\"name\":\"mesh\",\"direction\":\"in\",\"transport\":\"multicast\",\"address\":\"239.2.3.1\",\"port\":6969}"));
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.connections().names()).as("not started").isEmpty();
    assertThat(rig.part("mesh")).startsWith("mesh: stopped (").contains("an admin names one").contains("[in multicast 239.2.3.1:6969");
    assertThat(rig.ctx.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
  }

  // ---------------------------------------------------------------- criterion 24

  @Test
  void criterion24_storedStreamsOfEarlierVersionsAreNotReadAndTheStatusSaysSo() {
    var rig = new Rig();
    var stored = JsonArray.of(
        TestJson.parse("{\"name\":\"tak-north\",\"host\":\"127.0.0.1\",\"port\":1}"),
        TestJson.parse("{\"name\":\"tak-south\",\"host\":\"127.0.0.1\",\"port\":2,\"transport\":\"tls\"}"));
    rig.ctx.changeSettings(rig.ctx.settings().with("streams", stored));
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.connections().names()).as("nothing is started from them").isEmpty();
    assertThat(rig.ctx.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    assertThat(rig.status()).contains("no link configured").contains("2 stored streams (tak-north, tak-south) are no longer read: enter them as links");
    assertThat(rig.warnings()).hasSize(1);
    assertThat(rig.ctx.handlerErrors()).isEmpty();

    // entering one of them as a link works, and the note stays until the stored entries are gone
    TcpPeer peer = rig.addPeer("tak-north");
    rig.ctx.changeSettings(rig.ctx.settings().with("links", JsonArray.of(TestJson.parse(Rig.tcp("tak-north", peer.port())))));
    rig.ctx.runUntilIdle();
    rig.awaitUp("tak-north");
    assertThat(rig.status()).contains("2 stored streams");
  }

  @Test
  void aStoredStreamIsNotReadEvenIfALinkHasTheSameName() {
    var rig = new Rig("tak-north");
    TcpPeer other = rig.addPeer("old");
    var stored = JsonArray.of(TestJson.parse("{\"name\":\"tak-north\",\"host\":\"127.0.0.1\",\"port\":" + other.port() + "}"));
    rig.ctx.changeSettings(rig.ctx.settings().with("streams", stored));
    rig.ctx.runUntilIdle();
    assertThat(other.accepted()).as("the stored stream is not connected").isZero();
    rig.advance(Duration.ofSeconds(2));
    assertThat(other.accepted()).isZero();
  }
}
