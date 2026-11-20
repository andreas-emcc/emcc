package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.connection.ConnectionSpec;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * Connection tasks run on platform threads (ADR-0036 as amended by CR-0027): on Windows a virtual
 * thread blocked writing a socket may never wake while another virtual thread blocks reading it
 * (JDK-8334574), which is what cot's out links do. The thread's kind is checked on every OS; the
 * stall itself happens only on Windows, so elsewhere the regression test passes either way.
 */
class PlatformTaskThreadsTest {

  /** About the size of one CoT event. */
  private static final byte[] EVENT = ("<event version=\"2.0\" uid=\"track-1\" type=\"a-f-G\" how=\"m-g\">"
      + "x".repeat(400) + "</event>").getBytes(StandardCharsets.UTF_8);
  private static final int LINKS = 12;
  private static final long RUN_MILLIS = 10_000;
  private static final long STALLED_MILLIS = 3_000;

  record Nothing() implements Message {}

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final URLClassLoader loader = new URLClassLoader("plugin-cot", new URL[0], getClass().getClassLoader());
  private final TaskEngine engine = new TaskEngine("cot", loader, runtime, 3 * LINKS, Clock.systemUTC(), TaskEngine.Watch.NONE);
  private final PluginConnections connections = new PluginConnections("cot", runtime, engine, ListenerConfig.DEFAULT);
  private final List<AutoCloseable> peers = new ArrayList<>();

  @AfterEach
  void close() throws Exception {
    engine.stopAll();
    for (AutoCloseable peer : peers) {
      peer.close();
    }
    runtime.close();
    loader.close();
  }

  private static String describe(Thread t) {
    return (t.isVirtual() ? "virtual" : "platform") + (t.isDaemon() ? " daemon " : " ") + t.getName()
        + " with " + (t.getContextClassLoader() == null ? null : t.getContextClassLoader().getName());
  }

  @Test
  void aRunAndTheClosingAtItsStopRunOnPlatformDaemonThreadsWithThePluginsClassLoader() throws Exception {
    LinkedBlockingQueue<String> seen = new LinkedBlockingQueue<>();
    CountDownLatch registered = new CountDownLatch(1);
    ConnectionRef<Nothing> ref = connections.start(ConnectionSpec.of("tak-out", Nothing.class), () -> task -> {
      seen.add("run on " + describe(Thread.currentThread()));
      CountDownLatch closed = new CountDownLatch(1); // like a socket: only its close ends the wait
      task.closeOnStop(() -> {
        seen.add("closed on " + describe(Thread.currentThread()));
        closed.countDown();
      });
      registered.countDown(); // a stop before this would close it at once, on this thread
      closed.await();
    });
    assertThat(seen.poll(10, TimeUnit.SECONDS)).isEqualTo("run on platform daemon ecore-task-cot/tak-out with plugin-cot");
    assertThat(registered.await(10, TimeUnit.SECONDS)).isTrue();

    ref.stop();

    assertThat(seen.poll(10, TimeUnit.SECONDS)).isEqualTo("closed on platform daemon ecore-task-stop-cot/tak-out with plugin-cot");
  }

  @Test
  void aStopEndsARunBlockedInASocketWriteAndOneBlockedInARead() throws Exception {
    ServerSocket server = server();
    List<Socket> accepted = new ArrayList<>(); // the peer accepts and never reads or writes
    CountDownLatch ended = new CountDownLatch(2);
    AtomicLong written = new AtomicLong();
    ConnectionRef<Nothing> writer = connections.start(ConnectionSpec.of("writer", Nothing.class), () -> task -> {
      try {
        Socket socket = task.closeOnStop(new Socket(server.getInetAddress(), server.getLocalPort()));
        OutputStream out = socket.getOutputStream();
        byte[] chunk = new byte[64 * 1024];
        while (true) {
          out.write(chunk); // blocks once the peer's buffers are full
          written.addAndGet(chunk.length);
        }
      } finally {
        ended.countDown();
      }
    });
    ConnectionRef<Nothing> reader = connections.start(ConnectionSpec.of("reader", Nothing.class), () -> task -> {
      try {
        Socket socket = task.closeOnStop(new Socket(server.getInetAddress(), server.getLocalPort()));
        socket.getInputStream().read(); // blocks: the peer sends nothing
      } finally {
        ended.countDown();
      }
    });
    accepted.add(server.accept());
    accepted.add(server.accept());
    peers.addAll(accepted);
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    int still = 0;
    for (long before = -1; still < 2; ) { // until it has written, and then not moved for two intervals: blocked
      assertThat(System.nanoTime()).as("the write blocks within 10 s").isLessThan(deadline);
      Thread.sleep(300);
      long now = written.get();
      still = now > 0 && now == before ? still + 1 : 0;
      before = now;
    }

    writer.stop();
    reader.stop();

    assertThat(ended.await(10, TimeUnit.SECONDS)).as("both runs end at their stop").isTrue();
  }

  /**
   * The ITA's finding 1i, as cot's out link does it: a task writes events while its child reads the
   * same socket, and the peer reads in bursts, so that writes block now and then. With virtual
   * threads on Windows most such links stop for good within seconds.
   */
  @Test
  void aTaskWhoseChildReadsTheSocketItWritesKeepsWriting() throws Exception {
    ServerSocket server = server();
    List<AtomicLong> written = new ArrayList<>();
    List<AtomicLong> read = new ArrayList<>();
    for (int i = 0; i < LINKS; i++) {
      AtomicLong w = new AtomicLong();
      AtomicLong r = new AtomicLong();
      written.add(w);
      read.add(r);
      connections.start(ConnectionSpec.of("link-" + i, Nothing.class), () -> task -> {
        Socket socket = task.closeOnStop(new Socket(server.getInetAddress(), server.getLocalPort()));
        socket.setTcpNoDelay(true);
        task.startChild(ConnectionSpec.of("reader", Nothing.class), () -> child -> {
          InputStream in = socket.getInputStream();
          byte[] chunk = new byte[8192];
          while (!child.stopping() && in.read(chunk) >= 0) {
            // thrown away, as cot's out link does
          }
        });
        OutputStream out = socket.getOutputStream();
        while (!task.stopping()) {
          out.write(EVENT);
          out.flush();
          w.incrementAndGet();
        }
      });
      Socket peer = server.accept();
      peers.add(peer);
      Thread.ofPlatform().daemon().name("peer-" + i).start(() -> readInBursts(peer, r));
    }

    long[] last = new long[LINKS];
    long[] since = new long[LINKS];
    long start = System.currentTimeMillis();
    Arrays.fill(since, start);
    List<String> stalled = new ArrayList<>();
    while (System.currentTimeMillis() - start < RUN_MILLIS && stalled.isEmpty()) {
      Thread.sleep(250);
      long now = System.currentTimeMillis();
      for (int i = 0; i < LINKS; i++) {
        long w = written.get(i).get();
        if (w != last[i]) {
          last[i] = w;
          since[i] = now;
        } else if (now - since[i] > STALLED_MILLIS) {
          stalled.add("link-" + i + " after " + w + " events, the peer has read " + read.get(i).get() + " of "
              + w * EVENT.length + " bytes");
        }
      }
    }

    assertThat(stalled).as("links whose writer stopped for " + STALLED_MILLIS + " ms").isEmpty();
  }

  /** The peer, like the TAK test double: reads in bursts with short pauses, and now and then sends a byte back. */
  private static void readInBursts(Socket peer, AtomicLong read) {
    try {
      InputStream in = peer.getInputStream();
      OutputStream out = peer.getOutputStream();
      byte[] chunk = new byte[64 * 1024];
      long burst = System.nanoTime();
      for (int n; (n = in.read(chunk)) >= 0; ) {
        read.addAndGet(n);
        if (System.nanoTime() - burst > 20_000_000L) {
          Thread.sleep(ThreadLocalRandom.current().nextInt(30));
          out.write('\n');
          burst = System.nanoTime();
        }
      }
    } catch (IOException | InterruptedException e) {
      // the test is over
    }
  }

  private ServerSocket server() throws IOException {
    ServerSocket server = new ServerSocket(0, 2 * LINKS, InetAddress.getLoopbackAddress());
    server.setSoTimeout(10_000); // a task that never connects fails the test instead of hanging it
    peers.add(server);
    return server;
  }
}
