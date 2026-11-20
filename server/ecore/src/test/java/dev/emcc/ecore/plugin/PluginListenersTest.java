package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.listener.Backoff;
import dev.emcc.sdk.listener.Listener;
import dev.emcc.sdk.listener.ListenerEvent;
import dev.emcc.sdk.listener.ListenerRef;
import dev.emcc.sdk.listener.ListenerSpec;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLSocket;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Plugins' listeners against real sockets on this computer (SDK v1, "Listeners"). */
class PluginListenersTest {

  sealed interface Msg extends Message {
    record Event(ListenerEvent event) implements Msg {}

    record Line(String text) implements Msg {}
  }

  @TempDir Path keys;

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final PluginWorkers workers = new PluginWorkers("cot", runtime.owner("cot"), getClass().getClassLoader());
  private final Probe<String> seen = new Probe<>();
  private final WorkerRef<Msg> worker = workers.spawn(WorkerSpec.of("streams", Msg.class, () -> (message, ctx) -> seen.add(switch (message) {
    case Msg.Event e -> switch (e.event()) {
      case ListenerEvent.Connected c -> "connected " + c.listener();
      case ListenerEvent.Disconnected d -> "disconnected " + d.listener() + ": " + d.reason() + (d.retryAt() == null ? "" : " (retry)");
    };
    case Msg.Line l -> "line " + l.text();
  })));
  private final ServerSocket server = serverSocket();
  private final AtomicReference<JsonObject> settings = new AtomicReference<>(servers(server.getLocalPort()));
  private PluginListeners listeners = listeners(ListenerConfig.DEFAULT);
  private final AtomicInteger loops = new AtomicInteger();

  @AfterEach
  void close() throws IOException {
    listeners.stopAll();
    server.close();
    runtime.close();
  }

  private static ServerSocket serverSocket() {
    try {
      ServerSocket s = new ServerSocket(0, 10, InetAddress.getLoopbackAddress());
      s.setSoTimeout((int) Probe.WAIT.toMillis());
      return s;
    } catch (IOException e) {
      throw new java.io.UncheckedIOException(e);
    }
  }

  private static JsonObject servers(int... ports) {
    List<JsonObject> list = new java.util.ArrayList<>();
    for (int port : ports) {
      list.add(JsonObject.of(Map.of("host", JsonString.of("127.0.0.1"), "port", JsonNumber.of(port))));
    }
    return JsonObject.of(Map.of("servers", new JsonArray(List.copyOf(list))));
  }

  private PluginListeners listeners(ListenerConfig config) {
    return new PluginListeners("cot", getClass().getClassLoader(), runtime, config, settings::get, List.of("/servers"), Clock.systemUTC());
  }

  /** A loop that sends what it reads, line by line, and greets the peer first. */
  private Listener lines() {
    loops.incrementAndGet();
    return (connection, ctx) -> {
      connection.write(Bytes.utf8("hello from " + loops.get() + "\n"));
      BufferedReader in = new BufferedReader(new InputStreamReader(connection.input(), StandardCharsets.UTF_8));
      for (String line; (line = in.readLine()) != null; ) {
        ctx.send(worker, new Msg.Line(line));
      }
    };
  }

  private ListenerRef start(ListenerSpec spec) {
    return listeners.start(spec, this::lines, worker, Msg.Event::new);
  }

  private static String readLine(Socket peer) throws IOException {
    return new BufferedReader(new InputStreamReader(peer.getInputStream(), StandardCharsets.UTF_8)).readLine();
  }

  @Test
  void ecoreConnectsTheLoopReadsAndWritesAndSendsToWorkers() throws IOException {
    start(ListenerSpec.tcp("tak-north", "127.0.0.1", server.getLocalPort()));

    try (Socket peer = server.accept()) {
      assertThat(seen.next()).isEqualTo("connected tak-north");
      assertThat(readLine(peer)).isEqualTo("hello from 1");
      peer.getOutputStream().write("a\nb\n".getBytes(StandardCharsets.UTF_8));
      peer.getOutputStream().flush();
      assertThat(seen.next(2)).containsExactly("line a", "line b");
      assertThat(listeners.stats()).singleElement().satisfies(s -> {
        assertThat(s.connected()).isTrue();
        assertThat(s.bytesRead()).isEqualTo(4);
        assertThat(s.bytesWritten()).isEqualTo("hello from 1\n".length());
      });
    }
    assertThat(seen.next()).isEqualTo("disconnected tak-north: the loop returned");
    assertThat(listeners.stats()).as("without reconnect it ends").isEmpty();
  }

  @Test
  void onlyEndpointsTheSettingsNameAndAtMostTheCap() {
    assertThatThrownBy(() -> start(ListenerSpec.tcp("other", "127.0.0.1", server.getLocalPort() + 1)))
        .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("network.endpoints");
    assertThatThrownBy(() -> start(ListenerSpec.tls("secure", "127.0.0.1", server.getLocalPort(), "nobody")))
        .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("emc2.listeners.credentials.nobody.trust-store");

    listeners = listeners(new ListenerConfig(1, Map.of()));
    start(ListenerSpec.tcp("first", "127.0.0.1", server.getLocalPort()));
    assertThatThrownBy(() -> start(ListenerSpec.tcp("second", "127.0.0.1", server.getLocalPort())))
        .isInstanceOf(IllegalStateException.class).hasMessageContaining("1 listeners");
  }

  @Test
  void whenThePeerClosesItReconnectsWithAFreshListener() throws IOException {
    start(ListenerSpec.tcp("tak-north", "127.0.0.1", server.getLocalPort())
        .reconnect(Backoff.exponential(Duration.ofMillis(100), Duration.ofSeconds(1))));

    try (Socket peer = server.accept()) {
      assertThat(readLine(peer)).isEqualTo("hello from 1");
    }
    try (Socket peer = server.accept()) {
      assertThat(readLine(peer)).as("a fresh listener").isEqualTo("hello from 2");
      assertThat(seen.next(3)).containsExactly("connected tak-north", "disconnected tak-north: the loop returned (retry)",
          "connected tak-north");
      assertThat(listeners.stats()).singleElement().satisfies(s -> assertThat(s.reconnects()).isEqualTo(1));
    }
  }

  @Test
  void noDataForTheIdleTimeoutEndsTheLoop() throws IOException {
    start(ListenerSpec.tcp("tak-north", "127.0.0.1", server.getLocalPort()).idleTimeout(Duration.ofSeconds(1)));

    try (Socket peer = server.accept()) {
      assertThat(seen.next()).isEqualTo("connected tak-north");
      assertThat(seen.next()).isEqualTo("disconnected tak-north: no data for 1000 ms");
    }
    start(ListenerSpec.tcp("tak-north", "127.0.0.1", server.getLocalPort())); // the name is free again
  }

  @Test
  void stoppingEndsABlockedReadAndFencesTheLoop() throws IOException {
    Probe<String> afterwards = new Probe<>();
    ListenerRef ref = listeners.start(ListenerSpec.tcp("tak-north", "127.0.0.1", server.getLocalPort()), () -> (connection, ctx) -> {
      try (InputStream in = connection.input()) {
        in.read(); // blocks until stopped
      } catch (IOException e) {
        afterwards.add("read ended; stopping " + ctx.stopping() + "; a send is " + ctx.send(worker, new Msg.Line("late")));
        throw e;
      }
    }, worker, Msg.Event::new);
    try (Socket peer = server.accept()) {
      assertThat(seen.next()).isEqualTo("connected tak-north");

      ref.stop();

      assertThat(afterwards.next()).isEqualTo("read ended; stopping true; a send is CLOSED");
      assertThat(seen.next()).isEqualTo("disconnected tak-north: stopped");
      assertThat(peer.getInputStream().read()).as("the connection is closed").isEqualTo(-1);
    }
    assertThat(seen.drain()).isEmpty();
  }

  @Test
  void aReconnectToAnEndpointTheSettingsNoLongerNameIsRefused() throws IOException {
    start(ListenerSpec.tcp("tak-north", "127.0.0.1", server.getLocalPort())
        .reconnect(Backoff.exponential(Duration.ofMillis(100), Duration.ofSeconds(1))));
    try (Socket peer = server.accept()) {
      assertThat(readLine(peer)).isEqualTo("hello from 1");
      settings.set(servers()); // a settings change took the endpoint away; the live connection stays
    }

    assertThat(seen.next(3)).containsExactly("connected tak-north", "disconnected tak-north: the loop returned (retry)",
        "disconnected tak-north: the endpoint 127.0.0.1:" + server.getLocalPort() + " is no longer in the plugin's settings");
    assertThat(listeners.stats()).isEmpty();
  }

  @Test
  void aWriteIsAtMost64KiB() throws IOException {
    Probe<String> outcome = new Probe<>();
    listeners.start(ListenerSpec.tcp("tak-north", "127.0.0.1", server.getLocalPort()), () -> (connection, ctx) -> {
      try {
        connection.write(Bytes.of(new byte[64 * 1024 + 1]));
      } catch (IllegalArgumentException e) {
        outcome.add(e.getMessage());
      }
    });
    try (Socket peer = server.accept()) {
      assertThat(outcome.next()).isEqualTo("a write is at most 65536 bytes, not 65537");
    }
  }

  @Test
  void aWriteThatCannotCompleteWithinTheIdleTimeoutEndsTheLoop() throws IOException {
    listeners.start(ListenerSpec.tcp("tak-north", "127.0.0.1", server.getLocalPort()).idleTimeout(Duration.ofSeconds(1)),
        () -> (connection, ctx) -> {
          while (true) {
            connection.write(Bytes.of(new byte[64 * 1024])); // the peer never reads: the buffers fill up
          }
        }, worker, Msg.Event::new);

    try (Socket peer = server.accept()) {
      assertThat(seen.next()).isEqualTo("connected tak-north");
      assertThat(seen.next()).isEqualTo("disconnected tak-north: a write did not complete within 1000 ms");
    }
  }

  // ---- TLS -------------------------------------------------------------------------------------

  @Test
  void aTlsConnectionUsesTheNamedCredentialsAndChecksTheHostName() throws Exception {
    keytool("-genkeypair", "-alias", "server", "-keyalg", "RSA", "-keysize", "2048", "-dname", "CN=tak-north",
        "-ext", "SAN=ip:127.0.0.1", "-validity", "2", "-storetype", "PKCS12", "-keystore", "server.p12", "-storepass", "secret1");
    keytool("-exportcert", "-rfc", "-alias", "server", "-keystore", "server.p12", "-storepass", "secret1", "-file", "server.crt");
    keytool("-importcert", "-noprompt", "-alias", "server", "-file", "server.crt", "-storetype", "PKCS12", "-keystore", "trust.p12",
        "-storepass", "secret2");
    KeyStore serverKeys = KeyStore.getInstance("PKCS12");
    try (InputStream in = Files.newInputStream(keys.resolve("server.p12"))) {
      serverKeys.load(in, "secret1".toCharArray());
    }
    KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    kmf.init(serverKeys, "secret1".toCharArray());
    SSLContext serverContext = SSLContext.getInstance("TLS");
    serverContext.init(kmf.getKeyManagers(), null, null);
    try (SSLServerSocket tlsServer = (SSLServerSocket) serverContext.getServerSocketFactory()
        .createServerSocket(0, 10, InetAddress.getLoopbackAddress())) {
      tlsServer.setSoTimeout((int) Probe.WAIT.toMillis());
      int port = tlsServer.getLocalPort();
      settings.set(JsonObject.of(Map.of("servers", new JsonArray(List.of(
          JsonObject.of(Map.of("host", JsonString.of("127.0.0.1"), "port", JsonNumber.of(port))),
          JsonObject.of(Map.of("host", JsonString.of("localhost"), "port", JsonNumber.of(port))))))));
      listeners = listeners(new ListenerConfig(10, Map.of("tak-north",
          new TlsCredentials(null, null, keys.resolve("trust.p12"), "secret2"))));

      start(ListenerSpec.tls("secure", "127.0.0.1", port, "tak-north"));
      try (SSLSocket peer = (SSLSocket) tlsServer.accept()) {
        peer.startHandshake();
        assertThat(readLine(peer)).isEqualTo("hello from 1");
        assertThat(seen.next()).isEqualTo("connected secure");
      }
      assertThat(seen.next()).isEqualTo("disconnected secure: the loop returned");

      start(ListenerSpec.tls("wrong-name", "localhost", port, "tak-north")); // the certificate names 127.0.0.1 only
      try (SSLSocket peer = (SSLSocket) tlsServer.accept()) {
        try {
          peer.startHandshake();
        } catch (IOException e) {
          // the client gives up
        }
      }
      assertThat(seen.next()).startsWith("disconnected wrong-name: could not connect: javax.net.ssl.SSLHandshakeException");
    }
  }

  @Test
  void credentialsNeverShowTheirPasswords() {
    assertThat(new TlsCredentials(keys.resolve("client.p12"), "k3y-pass", keys.resolve("trust.p12"), "tru5t-pass").toString())
        .doesNotContain("k3y-pass").doesNotContain("tru5t-pass");
  }

  private void keytool(String... args) throws IOException, InterruptedException {
    String exe = Path.of(System.getProperty("java.home"), "bin", "keytool").toString();
    List<String> command = new java.util.ArrayList<>(List.of(exe));
    command.addAll(List.of(args));
    Process p = new ProcessBuilder(command).directory(keys.toFile()).redirectErrorStream(true).start();
    String output = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    assertThat(p.waitFor()).as(output).isZero();
  }
}
