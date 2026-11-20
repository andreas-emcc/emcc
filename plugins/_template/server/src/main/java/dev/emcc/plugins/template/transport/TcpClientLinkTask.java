package dev.emcc.plugins.template.transport;

import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.connection.ConnectionSpec;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import java.util.UUID;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * One run of a TCP client link (from {@code cot}'s {@code TcpLinkTask}): connects to its host and
 * port, then
 * <ul>
 *   <li>{@code in} (consumer): reads, cuts the stream into frames and hands them on;
 *   <li>{@code out} (provider) and {@code both}: writes what the worker posts, while a child task, the
 *       reader, reads the same connection: it hands the frames on for {@code both} and throws them away
 *       for {@code out}, so that a peer that also sends never stalls, and a closed connection is seen.
 * </ul>
 * When the connection ends, the run ends, and ECore starts the next with its back-off. <b>TLS</b>
 * (ADR-0036 point 5, ADR-0062): with {@link Link#tls()} the socket factory comes from {@code
 * task.tls(link.credential())}: the credential the admin picked, or the link's name. The plugin never
 * sees a key or a password; an unknown name fails the run before any connection is opened.
 */
final class TcpClientLinkTask implements ConnectionTask<LinkInbox> {

  private static final int CONNECT_TIMEOUT_MILLIS = 10_000;

  private final Link link;
  private final WorkerRef<TransportMsg> worker;
  private final int maxFrameBytes;

  TcpClientLinkTask(Link link, WorkerRef<TransportMsg> worker, int maxFrameBytes) {
    this.link = link;
    this.worker = worker;
    this.maxFrameBytes = maxFrameBytes;
  }

  @Override
  public void run(TaskContext<LinkInbox> task) throws IOException {
    UUID run = UUID.randomUUID();
    String reason = "stopped";
    try {
      Socket socket = open(task);
      task.peer(socket.getRemoteSocketAddress());
      task.detail("mode", link.where());
      task.send(worker, new TransportMsg.Up(link.name(), run, String.valueOf(socket.getRemoteSocketAddress())));
      if (link.direction().sends()) {
        ConnectionRef<LinkInbox> self = task.self();
        task.startChild(ConnectionSpec.of("reader", LinkInbox.class), () -> new Reader(socket, self, run, link, worker, maxFrameBytes));
        write(task, socket, run);
      } else {
        new LineFramer(maxFrameBytes).read(task, socket.getInputStream(), new Inbound(link.name(), run, worker, task));
        if (!task.stopping()) {
          throw new IOException("the peer closed the connection");
        }
      }
    } catch (IOException e) {
      reason = Reason.of(e);
      if (!task.stopping()) {
        throw e;
      } // stopped: the socket was closed under the read or the write
    } finally {
      task.send(worker, new TransportMsg.Down(link.name(), run, reason));
    }
  }

  /** Writes what the worker posts, one line per frame, until the task is stopped or the reader says the connection is over. */
  private static void write(TaskContext<LinkInbox> task, Socket socket, UUID run) throws IOException {
    OutputStream out = socket.getOutputStream();
    for (LinkInbox item; (item = task.take()) != null; ) {
      switch (item) {
        case LinkInbox.Send send -> {
          out.write((send.frame() + "\n").getBytes(StandardCharsets.UTF_8)); // YOUR PROTOCOL: the frame's bytes
          out.flush();
          task.count("frames out", 1);
        }
        case LinkInbox.Closed closed -> {
          if (closed.run().equals(run)) {
            throw new IOException(closed.reason());
          } // else: the end of an earlier run
        }
        case LinkInbox.ClientUp up -> { } // only a TCP server gets these
      }
    }
  }

  private Socket open(TaskContext<LinkInbox> task) throws IOException {
    String host = Objects.requireNonNull(link.host());
    var peer = new InetSocketAddress(host, link.port());
    SSLSocketFactory tls;
    try {
      tls = link.tls() ? task.tls(link.credential()) : null; // before any connection: a missing credential opens none
    } catch (IllegalArgumentException e) {
      throw new IOException("no TLS credential named " + link.credential(), e);
    }
    Socket socket = task.closeOnStop(new Socket());
    socket.connect(peer, CONNECT_TIMEOUT_MILLIS);
    if (tls != null) {
      socket.setSoTimeout(CONNECT_TIMEOUT_MILLIS); // a peer that accepts and says nothing must not hold the handshake for ever
      SSLSocket secure = task.closeOnStop((SSLSocket) tls.createSocket(socket, host, link.port(), true));
      secure.startHandshake(); // ECore's factory checks that the peer's certificate names the host
      socket = secure;
    }
    socket.setTcpNoDelay(true);
    socket.setKeepAlive(true);
    // An idle time only for a link that receives: a provider may be silent for as long as it has nothing to send.
    socket.setSoTimeout(link.direction().receives() ? (int) Math.min(Integer.MAX_VALUE, link.idle().toMillis()) : 0);
    return socket;
  }

  /**
   * The reader of an {@code out} or {@code both} link: reads what the peer sends on the connection the
   * writer holds, frames it for {@code both} and throws it away for {@code out}. When it ends it tells
   * the writer, which ends the run.
   */
  private static final class Reader implements ConnectionTask<LinkInbox> {
    private final Socket socket;
    private final ConnectionRef<LinkInbox> writer;
    private final UUID run;
    private final Link link;
    private final WorkerRef<TransportMsg> worker;
    private final int max;

    Reader(Socket socket, ConnectionRef<LinkInbox> writer, UUID run, Link link, WorkerRef<TransportMsg> worker, int max) {
      this.socket = socket;
      this.writer = writer;
      this.run = run;
      this.link = link;
      this.worker = worker;
      this.max = max;
    }

    @Override
    public void run(TaskContext<LinkInbox> task) {
      String reason = "the peer closed the connection";
      try {
        if (link.direction().receives()) {
          new LineFramer(max).read(task, socket.getInputStream(), new Inbound(link.name(), run, worker, task));
        } else {
          InputStream in = socket.getInputStream();
          byte[] chunk = new byte[8192];
          for (int n; !task.stopping() && (n = in.read(chunk)) >= 0; ) {
            task.count("bytes ignored", n);
          }
        }
      } catch (IOException e) {
        reason = Reason.of(e);
      } finally {
        if (!task.stopping()) {
          writer.post(new LinkInbox.Closed(run, reason));
        }
      }
    }
  }
}
