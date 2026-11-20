package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.connection.Backoff;
import dev.emcc.sdk.connection.ConnectionEvent;
import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.connection.ConnectionSpec;
import dev.emcc.sdk.connection.Restart;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.Coalescing;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** The SDK's Connections, TaskContext and ConnectionRef over ECore's task engine (SDK 1.2.0, ADR-0036). */
class PluginConnectionsTest {

  private static final Restart ON_FAILURE = Restart.onFailure(Backoff.exponential(Duration.ofMillis(100), Duration.ofSeconds(60)));

  /** What workers post: an update of a track, coalesced by its uid. */
  record Update(String uid, int n) implements Message, Coalescing {
    @Override
    public Object coalesceKey() {
      return uid;
    }
  }

  /** What a task hands its worker. */
  record Received(String what) implements Message {}

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final TaskEngine engine = new TaskEngine("cot", null, runtime, 4, Clock.systemUTC(), TaskEngine.Watch.NONE);
  private final PluginConnections connections = new PluginConnections("cot", runtime, engine, ListenerConfig.DEFAULT);
  private final PluginWorkers workers = new PluginWorkers("cot", runtime.owner("cot"), getClass().getClassLoader());
  private final LinkedBlockingQueue<Object> got = new LinkedBlockingQueue<>();

  @AfterEach
  void close() {
    engine.stopAll();
    runtime.close();
  }

  private <M extends Message> WorkerRef<M> recorder(String name, Class<M> type) {
    return workers.spawn(WorkerSpec.of(name, type, () -> (message, ctx) -> got.add(message)));
  }

  private Object next() throws InterruptedException {
    Object value = got.poll(10, TimeUnit.SECONDS);
    assertThat(value).as("within 10 s").isNotNull();
    return value;
  }

  record Event(ConnectionEvent event) implements Message {}

  @Test
  void postedItemsReachTheTaskAndACoalescingInboxKeepsTheLatestPerKey() throws Exception {
    CountDownLatch go = new CountDownLatch(1);
    WorkerRef<Received> worker = recorder("applier", Received.class);
    ConnectionRef<Update> out = connections.start(ConnectionSpec.of("tak-out", Update.class).inbox(10, Overflow.coalesceByKey()),
        () -> task -> {
          go.await(10, TimeUnit.SECONDS);
          for (Update u; (u = task.take()) != null; ) {
            task.count("sent", 1);
            task.send(worker, new Received(u.uid() + "=" + u.n()));
          }
        });

    assertThat(out.post(new Update("a", 1))).isEqualTo(SendResult.ACCEPTED);
    out.post(new Update("b", 1));
    out.post(new Update("a", 2)); // replaces a=1 in its place
    go.countDown();

    assertThat(List.of(next(), next())).containsExactly(new Received("a=2"), new Received("b=1"));
    assertThat(out.name()).isEqualTo("tak-out");
    assertThat(out.id().value()).startsWith("cot/task/tak-out#");
    out.stop();
    assertThat(out.post(new Update("c", 1))).isEqualTo(SendResult.CLOSED);
  }

  @Test
  void eventsReachTheWorkerInOrderAndARestartSaysWhyAndWhen() throws Exception {
    WorkerRef<Event> events = recorder("links", Event.class);
    AtomicInteger runs = new AtomicInteger();
    ConnectionRef<Update> ref = connections.start(ConnectionSpec.of("tak-north", Update.class).restart(ON_FAILURE), () -> task -> {
      if (runs.incrementAndGet() == 1) {
        throw new IOException("connection refused");
      }
      task.take();
    }, events, Event::new);

    assertThat(((Event) next()).event()).isInstanceOf(ConnectionEvent.Running.class);
    ConnectionEvent.Restarting restarting = (ConnectionEvent.Restarting) ((Event) next()).event();
    assertThat(restarting.task()).isEqualTo("tak-north");
    assertThat(restarting.reason()).contains("connection refused");
    assertThat(restarting.retryAt()).isAfterOrEqualTo(restarting.at().plusMillis(100));
    assertThat(((Event) next()).event()).isInstanceOf(ConnectionEvent.Running.class);

    ref.stop();
    assertThat(((Event) next()).event()).isInstanceOf(ConnectionEvent.Stopped.class);
  }

  @Test
  void aFactoryThatThrowsCountsAsARunThatThrew() throws Exception {
    WorkerRef<Event> events = recorder("links", Event.class);
    connections.start(ConnectionSpec.of("broken", Update.class), () -> {
      throw new IllegalStateException("no host in the settings");
    }, events, Event::new);

    assertThat(((Event) next()).event()).isInstanceOf(ConnectionEvent.Running.class);
    ConnectionEvent.Failed failed = (ConnectionEvent.Failed) ((Event) next()).event();
    assertThat(failed.reason()).contains("no host in the settings");
  }

  @Test
  void aStoppedTaskIsFencedItsSendsAreDroppedAndItsTakeAnswersNull() throws Exception {
    LinkedBlockingQueue<TaskContext<Update>> contexts = new LinkedBlockingQueue<>();
    CountDownLatch ended = new CountDownLatch(1);
    WorkerRef<Received> worker = recorder("applier", Received.class);
    ConnectionRef<Update> ref = connections.start(ConnectionSpec.of("t", Update.class), () -> task -> {
      contexts.add(task);
      assertThat(task.take()).isNull(); // until stopped
      ended.countDown();
    });
    TaskContext<Update> task = contexts.poll(10, TimeUnit.SECONDS);
    assertThat(task).isNotNull();
    assertThat(task.self()).isEqualTo(ref);
    assertThat(task.stopping()).isFalse();

    ref.stop();

    assertThat(ended.await(10, TimeUnit.SECONDS)).isTrue();
    assertThat(task.stopping()).isTrue();
    assertThat(task.send(worker, new Received("late"))).isEqualTo(SendResult.CLOSED);
    assertThat(got.poll(200, TimeUnit.MILLISECONDS)).isNull();
    assertThatThrownBy(() -> task.startChild(ConnectionSpec.of("child", Update.class), () -> t -> {}))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void childrenAreNamedAfterTheirParentUniqueAmongSiblingsAndStopWithIt() throws Exception {
    LinkedBlockingQueue<String> names = new LinkedBlockingQueue<>();
    CountDownLatch started = new CountDownLatch(1);
    ConnectionRef<Update> server = connections.start(ConnectionSpec.of("tak-in", Update.class), () -> task -> {
      ConnectionRef<Update> first = task.startChild(ConnectionSpec.of("client-1", Update.class), () -> TaskContext::take);
      names.add(first.name());
      try {
        task.startChild(ConnectionSpec.of("client-1", Update.class), () -> TaskContext::take);
      } catch (IllegalArgumentException e) {
        names.add("refused: " + e.getMessage());
      }
      started.countDown();
      task.take();
    });
    assertThat(started.await(10, TimeUnit.SECONDS)).isTrue();

    assertThat(names.poll()).isEqualTo("tak-in/client-1");
    assertThat(names.poll()).startsWith("refused: ").contains("running already");
    assertThat(engine.stats()).extracting(TaskEngine.Stats::name).containsExactly("tak-in", "tak-in/client-1");
    server.stop();
    long end = System.nanoTime() + Duration.ofSeconds(10).toNanos();
    while (!engine.stats().isEmpty()) {
      assertThat(System.nanoTime()).isLessThan(end);
      Thread.sleep(20);
    }
  }

  @Test
  void countsAndDetailsComeFromTheTaskAndFromTheHandle() throws Exception {
    CountDownLatch counted = new CountDownLatch(1);
    List<@Nullable Object> activity = new ArrayList<>();
    ConnectionRef<Update> ref = connections.start(ConnectionSpec.of("t", Update.class), () -> task -> {
      activity.add(task.lastActivity());
      task.count("received", 2);
      task.detail("protocol", "CoT 2.0");
      task.listening(new java.net.InetSocketAddress(java.net.InetAddress.getLoopbackAddress(), 4242));
      activity.add(task.lastActivity());
      counted.countDown();
      task.take();
    });
    assertThat(counted.await(10, TimeUnit.SECONDS)).isTrue();
    ref.count("skipped:no-cot-type", 1);
    ref.detail("protocol", "CoT 2.1");

    TaskEngine.Stats stats = engine.stats().getFirst();
    assertThat(stats.counters()).containsEntry("received", 2L).containsEntry("skipped:no-cot-type", 1L);
    assertThat(stats.details()).containsEntry("protocol", "CoT 2.1");
    assertThat(stats.listening()).as("ECore's text, without Java's slash").isIn("127.0.0.1:4242 (localhost)", "[::1]:4242 (localhost)");
    assertThat(activity.get(0)).isNull();
    assertThat(activity.get(1)).isNotNull();
  }

  @Test
  void pollKeepsToItsLimitsAndTlsNeedsConfiguredCredentials() throws Exception {
    LinkedBlockingQueue<Object> answers = new LinkedBlockingQueue<>();
    connections.start(ConnectionSpec.of("t", Update.class), () -> task -> {
      answers.add(String.valueOf(task.poll(Duration.ofMillis(20))));
      for (Runnable bad : List.<Runnable>of(() -> task.poll(Duration.ZERO), () -> task.poll(Duration.ofHours(2)),
          () -> task.tls("tak-north"), () -> task.sslContext("tak-north"))) {
        try {
          bad.run();
          answers.add("accepted");
        } catch (IllegalArgumentException e) {
          answers.add("refused");
        }
      }
    });

    assertThat(answers.poll(10, TimeUnit.SECONDS)).as("nothing came in time").isEqualTo("null");
    for (int i = 0; i < 4; i++) {
      assertThat(answers.poll(10, TimeUnit.SECONDS)).isEqualTo("refused");
    }
  }

  @Test
  void aChildBeyondTheCapIsRefusedInsideItsParent() throws Exception {
    for (int i = 1; i <= 3; i++) {
      connections.start(ConnectionSpec.of("t-" + i, Update.class), () -> TaskContext::take);
    }
    LinkedBlockingQueue<String> outcome = new LinkedBlockingQueue<>();
    connections.start(ConnectionSpec.of("server", Update.class), () -> task -> {
      try {
        task.startChild(ConnectionSpec.of("client-1", Update.class), () -> TaskContext::take);
        outcome.add("started");
      } catch (IllegalStateException e) { // a TCP server's accept loop closes the client and counts it
        outcome.add("refused: " + e.getMessage());
      }
      task.take();
    });

    assertThat(outcome.poll(10, TimeUnit.SECONDS)).startsWith("refused: ").contains("the most it may have");
  }

  @Test
  void tlsUsesTheNamedCredentialsChecksTheHostNameAndReadsThemOnce() throws Exception {
    keytool("-genkeypair", "-alias", "server", "-keyalg", "RSA", "-keysize", "2048", "-dname", "CN=tak-north",
        "-ext", "SAN=ip:127.0.0.1", "-validity", "2", "-storetype", "PKCS12", "-keystore", "server.p12", "-storepass", "test-only-1");
    keytool("-exportcert", "-rfc", "-alias", "server", "-keystore", "server.p12", "-storepass", "test-only-1", "-file", "server.crt");
    keytool("-importcert", "-noprompt", "-alias", "server", "-file", "server.crt", "-storetype", "PKCS12", "-keystore", "trust.p12",
        "-storepass", "test-only-2");
    java.security.KeyStore serverKeys = java.security.KeyStore.getInstance("PKCS12");
    try (java.io.InputStream in = java.nio.file.Files.newInputStream(keys.resolve("server.p12"))) {
      serverKeys.load(in, "test-only-1".toCharArray());
    }
    javax.net.ssl.KeyManagerFactory kmf = javax.net.ssl.KeyManagerFactory.getInstance(javax.net.ssl.KeyManagerFactory.getDefaultAlgorithm());
    kmf.init(serverKeys, "test-only-1".toCharArray());
    javax.net.ssl.SSLContext serverContext = javax.net.ssl.SSLContext.getInstance("TLS");
    serverContext.init(kmf.getKeyManagers(), null, null);
    PluginConnections withTls = new PluginConnections("cot", runtime, engine, new ListenerConfig(10, java.util.Map.of("tak-north",
        new TlsCredentials(null, null, keys.resolve("trust.p12"), "test-only-2"))));
    try (javax.net.ssl.SSLServerSocket server = (javax.net.ssl.SSLServerSocket) serverContext.getServerSocketFactory()
        .createServerSocket(0, 10, java.net.InetAddress.getLoopbackAddress())) {
      server.setSoTimeout(10_000);
      Thread peer = Thread.ofVirtual().start(() -> {
        for (int i = 0; i < 2; i++) {
          try (javax.net.ssl.SSLSocket accepted = (javax.net.ssl.SSLSocket) server.accept()) {
            accepted.startHandshake();
            accepted.getOutputStream().write('x');
          } catch (IOException e) {
            // the second client gives up: its host is not in the certificate
          }
        }
      });
      LinkedBlockingQueue<String> results = new LinkedBlockingQueue<>();
      withTls.start(ConnectionSpec.of("secure", Update.class), () -> task -> {
        for (String host : List.of("127.0.0.1", "localhost")) { // the certificate names 127.0.0.1 only
          try (java.net.Socket socket = task.closeOnStop(task.tls("tak-north").createSocket())) {
            socket.connect(new java.net.InetSocketAddress(host, server.getLocalPort()), 5_000);
            results.add(host + " read " + (char) socket.getInputStream().read());
          } catch (IOException e) {
            results.add(host + " refused: " + e.getClass().getSimpleName());
          }
        }
        results.add(task.sslContext("tak-north") == task.sslContext("tak-north") ? "read once" : "read twice");
        task.take();
      });

      assertThat(results.poll(20, TimeUnit.SECONDS)).isEqualTo("127.0.0.1 read x");
      assertThat(results.poll(20, TimeUnit.SECONDS)).isEqualTo("localhost refused: SSLHandshakeException");
      assertThat(results.poll(20, TimeUnit.SECONDS)).isEqualTo("read once");
      peer.join(10_000);
    }
  }

  @org.junit.jupiter.api.io.TempDir java.nio.file.Path keys;

  private void keytool(String... args) throws IOException, InterruptedException {
    String exe = java.nio.file.Path.of(System.getProperty("java.home"), "bin", "keytool").toString();
    List<String> command = new ArrayList<>(List.of(exe));
    command.addAll(List.of(args));
    Process p = new ProcessBuilder(command).directory(keys.toFile()).redirectErrorStream(true).start();
    String output = new String(p.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
    assertThat(p.waitFor()).as(output).isZero();
  }

  @Test
  void thePluginsCapCountsItsTasksAndTheirChildren() throws Exception {
    for (int i = 1; i <= 4; i++) {
      connections.start(ConnectionSpec.of("t-" + i, Update.class), () -> TaskContext::take);
    }

    assertThatThrownBy(() -> connections.start(ConnectionSpec.of("t-5", Update.class), () -> TaskContext::take))
        .isInstanceOf(IllegalStateException.class).hasMessageContaining("the most it may have");
    assertThatThrownBy(() -> connections.start(ConnectionSpec.of("t-1", Update.class), () -> TaskContext::take))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
