package dev.emcc.plugins.template;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.TestJson;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.function.BooleanSupplier;
import javax.net.ssl.SSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * The link example end to end (M9, D3): the plugin as the host runs it, its {@code links} setting,
 * a real peer on loopback, and the link's state in the plugin's status. The transport's six modes are
 * {@code TransportTest}'s.
 */
class LinkEndToEndTest {

  private FakePluginContext context;
  private Plugin plugin;
  private ServerSocket peer;

  private void start(String links, FakePluginContext.Builder builder) throws Exception {
    JsonObject settings = (JsonObject) TestJson.parse("{\"greeting\":\"Hello\",\"links\":[" + links + "]}");
    context = builder.settings(settings).build();
    plugin = (Plugin) Class.forName(Manifest.entryClass()).getConstructor().newInstance();
    plugin.init(context);
    plugin.start();
  }

  @AfterEach
  void stopEverything() throws Exception {
    if (plugin != null) {
      plugin.stop();
      context.connections().stopAll();
    }
    if (peer != null) {
      peer.close();
    }
  }

  @Test
  void aLinkFromTheSettingsReceivesFromItsPeerAndShowsInTheStatus() throws Exception {
    peer = new ServerSocket(0, 1, InetAddress.getLoopbackAddress());
    peer.setSoTimeout(10_000); // never wait for ever
    start("{\"name\":\"feed\",\"host\":\"127.0.0.1\",\"port\":" + peer.getLocalPort() + "}", FakePluginContext.builder(Manifest.id()));
    // The worker runs in the fake context's loop: wait until the link is up (the connection waits in the backlog), then accept it.
    awaitStatus("feed [in tcp-client to 127.0.0.1:" + peer.getLocalPort() + "]: up");
    try (Socket accepted = peer.accept()) {
      OutputStream out = accepted.getOutputStream();
      out.write("first\nsecond\n".getBytes(StandardCharsets.UTF_8));
      out.flush();
      awaitStatus("up, 2 received");
      assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.OK);
    }
  }

  @Test
  void withoutLinksTheStatusSaysSo() throws Exception {
    start("", FakePluginContext.builder(Manifest.id()));
    awaitStatus("no links");
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.OK);
  }

  @Test
  void aTlsLinkUsesThePickedCredentialOrTheLinksName() throws Exception {
    peer = new ServerSocket(0, 1, InetAddress.getLoopbackAddress());
    peer.setSoTimeout(10_000); // never wait for ever
    int port = peer.getLocalPort();
    // Only "tak-ca" is configured. The link named "tak-north" without a pick asks for "tak-north" and fails before connecting.
    start("{\"name\":\"tak-north\",\"host\":\"127.0.0.1\",\"port\":" + port + ",\"tls\":true}",
        FakePluginContext.builder(Manifest.id()).tlsCredentials("tak-ca", SSLContext.getDefault()));
    awaitStatus("no TLS credential named tak-north");
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    plugin.stop();
    context.connections().stopAll();

    // Picking "tak-ca" gets past the credential: the link connects (the plain peer then fails the handshake).
    start("{\"name\":\"tak-north\",\"host\":\"127.0.0.1\",\"port\":" + port + ",\"tls\":true,\"tlsCredential\":\"tak-ca\"}",
        FakePluginContext.builder(Manifest.id()).tlsCredentials("tak-ca", SSLContext.getDefault()));
    awaitStatus("tak-north [in tcp-client with TLS to 127.0.0.1:" + port + "]");
    try (Socket accepted = peer.accept()) {
      assertThat(accepted.isConnected()).isTrue(); // past the credential: it connected
    }
    awaitStatus("tak-north [in tcp-client with TLS to 127.0.0.1:" + port + "]: down");
    assertThat(context.effectiveStatus().detail()).doesNotContain("no TLS credential");
  }

  private void awaitStatus(String text) {
    waitUntil(() -> context.effectiveStatus().detail().contains(text), "a status with \"" + text + "\"");
  }

  private void waitUntil(BooleanSupplier condition, String what) {
    long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
    while (true) {
      context.runUntilIdle();
      if (condition.getAsBoolean()) {
        return;
      }
      if (System.nanoTime() > deadline) {
        throw new AssertionError("waited 10 s for " + what + "; status: " + context.effectiveStatus().detail());
      }
      Thread.onSpinWait();
      Thread.yield();
    }
  }
}
