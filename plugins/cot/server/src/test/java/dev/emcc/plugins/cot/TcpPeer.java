package dev.emcc.plugins.cot;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BooleanSupplier;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocket;
import org.jspecify.annotations.Nullable;

/**
 * A TAK Server for the tests: a TCP server on loopback that accepts the plugin's connections, sends
 * what a test tells it to, and records what the plugin writes. It stands where the ITA's TAK test
 * double stands in the real-server checks; the test kit's fake tasks open real sockets, so the
 * plugin's task talks to this over loopback.
 */
final class TcpPeer implements AutoCloseable {

  /** One connection the plugin made. */
  static final class Conn {
    private final Socket socket;
    private final ByteArrayOutputStream received = new ByteArrayOutputStream();
    private volatile boolean closedByPeer;
    private static final byte[] END = "</event>".getBytes(StandardCharsets.UTF_8);
    private volatile int eventCount;
    private volatile boolean paused;

    Conn(Socket socket) {
      this.socket = socket;
      Thread reader = new Thread(this::read, "test-peer-reader");
      reader.setDaemon(true);
      reader.start();
    }

    private void read() {
      try (InputStream in = socket.getInputStream()) {
        byte[] chunk = new byte[4096];
        int n;
        int matched = 0; // how much of "</event>" ends the bytes read so far; "<" occurs only at its start
        int events = 0;
        while (true) {
          while (paused) {
            Thread.sleep(2); // a peer that stays connected and takes nothing: the plugin's writes fill the buffers and block
          }
          if ((n = in.read(chunk)) < 0) {
            break;
          }
          synchronized (received) {
            received.write(chunk, 0, n);
          }
          for (int i = 0; i < n; i++) {
            byte b = chunk[i];
            matched = b == END[matched] ? matched + 1 : (b == END[0] ? 1 : 0);
            if (matched == END.length) {
              events++;
              matched = 0;
            }
          }
          eventCount = events;
        }
      } catch (IOException e) {
        // closed
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
      closedByPeer = true;
    }

    /** Sends text to the plugin. */
    void send(String text) {
      try {
        OutputStream out = socket.getOutputStream();
        out.write(text.getBytes(StandardCharsets.UTF_8));
        out.flush();
      } catch (IOException e) {
        throw new IllegalStateException("the test peer could not send: " + e, e);
      }
    }

    /** What the plugin has written so far. */
    String received() {
      synchronized (received) {
        return received.toString(StandardCharsets.UTF_8);
      }
    }

    /** How many events ("&lt;/event&gt;") the plugin has written so far; counted as they arrive, so it is cheap for a large run. */
    int eventCount() {
      return eventCount;
    }

    /** Stops reading, as a TAK Server that hangs does: the connection stays open and the plugin's writes block once the buffers are full. */
    void pauseReading() {
      paused = true;
    }

    /** Whether the plugin closed its end. */
    boolean closedByPlugin() {
      return closedByPeer;
    }

    /** Closes this end, as a TAK Server that goes away does. */
    void close() {
      try {
        socket.close();
      } catch (IOException e) {
        // already closed
      }
    }
  }

  private volatile ServerSocket server;
  private final int port;
  private final List<Conn> connections = new CopyOnWriteArrayList<>();

  TcpPeer() {
    this(null, false);
  }

  /** A TAK Server with TLS: it presents the certificate of {@code tls}, and asks for a client certificate if {@code clientAuth}. */
  TcpPeer(@Nullable SSLContext tls, boolean clientAuth) {
    try {
      if (tls == null) {
        server = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
      } else {
        SSLServerSocket secure = (SSLServerSocket) tls.getServerSocketFactory().createServerSocket(0, 50, InetAddress.getLoopbackAddress());
        secure.setNeedClientAuth(clientAuth);
        server = secure;
      }
    } catch (IOException e) {
      throw new IllegalStateException(e);
    }
    port = server.getLocalPort();
    startAcceptor();
  }

  private void startAcceptor() {
    ServerSocket listening = server;
    Thread acceptor = new Thread(() -> acceptLoop(listening), "test-peer-acceptor");
    acceptor.setDaemon(true);
    acceptor.start();
  }

  /** Accepts until this server socket is closed. A failed accept (a connection reset before it was taken, say) does not end the loop. */
  private void acceptLoop(ServerSocket listening) {
    while (!listening.isClosed()) {
      try {
        connections.add(new Conn(listening.accept()));
      } catch (IOException e) {
        if (listening.isClosed()) {
          return;
        }
        try {
          Thread.sleep(1);
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt();
          return;
        }
      }
    }
  }

  int port() {
    return port;
  }

  /** How many connections the plugin has made. */
  int accepted() {
    return connections.size();
  }

  /** The newest connection; waits for the first one. */
  Conn conn() {
    waitUntil(() -> !connections.isEmpty(), "a connection from the plugin");
    return connections.getLast();
  }

  /**
   * The plugin's current connection: the newest one, once it is open and every earlier one is seen closed. After a link was removed and
   * added again, {@link #conn()} may still be the old connection (closed by the plugin) while the new one has not been accepted yet;
   * sending on it fails with "Socket is closed". This waits for the new one.
   */
  Conn liveConn() {
    waitUntil(() -> {
      if (connections.isEmpty() || connections.getLast().closedByPlugin()) {
        return false;
      }
      for (int i = 0; i < connections.size() - 1; i++) {
        if (!connections.get(i).closedByPlugin()) {
          return false;
        }
      }
      return true;
    }, "the plugin's current connection");
    return connections.getLast();
  }

  /** Waits for the plugin to make connection number {@code count}. */
  Conn awaitConnection(int count) {
    waitUntil(() -> connections.size() >= count, "connection " + count + " from the plugin");
    return connections.get(count - 1);
  }

  /** Stops listening: the plugin's next attempts are refused. */
  void stopListening() {
    try {
      server.close();
    } catch (IOException e) {
      // already closed
    }
  }

  /** Listens again on the same port after {@link #stopListening()}, as a TAK Server that comes back (a peer without TLS). */
  void resumeListening() {
    try {
      var again = new ServerSocket();
      again.setReuseAddress(true);
      again.bind(new java.net.InetSocketAddress(InetAddress.getLoopbackAddress(), port), 50);
      server = again;
    } catch (IOException e) {
      throw new IllegalStateException(e);
    }
    startAcceptor();
  }

  @Override
  public void close() {
    stopListening();
    connections.forEach(Conn::close);
  }

  static void waitUntil(BooleanSupplier condition, String what) {
    waitUntil(condition, what, 10);
  }

  /** As {@link #waitUntil(BooleanSupplier, String)}, for something that takes longer on a busy machine, such as a load test. */
  static void waitUntil(BooleanSupplier condition, String what, int seconds) {
    long end = System.nanoTime() + seconds * 1_000_000_000L;
    while (!condition.getAsBoolean()) {
      if (System.nanoTime() > end) {
        throw new AssertionError("timed out waiting for " + what);
      }
      try {
        Thread.sleep(2);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new AssertionError("interrupted while waiting for " + what);
      }
    }
  }
}
