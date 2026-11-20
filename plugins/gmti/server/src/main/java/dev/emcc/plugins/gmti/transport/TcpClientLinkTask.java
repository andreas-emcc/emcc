package dev.emcc.plugins.gmti.transport;

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
import java.util.Objects;
import java.util.UUID;

/**
 * One run of a TCP client link (the template's, from {@code cot}'s {@code TcpLinkTask}): connects to
 * its host and port, then
 * <ul>
 *   <li>{@code in}: reads the stream of packets ({@link PacketFramer}) and hands each on; a malformed
 *       packet ends the run, and ECore connects again with its back-off (pitfall 18);
 *   <li>{@code out}: writes each dwell the worker posts, while a child task, the reader, throws away
 *       what the peer sends, so that a closed connection is seen.
 * </ul>
 */
final class TcpClientLinkTask implements ConnectionTask<LinkInbox> {

  private static final int CONNECT_TIMEOUT_MILLIS = 10_000;

  private final Link link;
  private final WorkerRef<TransportMsg> worker;

  TcpClientLinkTask(Link link, WorkerRef<TransportMsg> worker) {
    this.link = link;
    this.worker = worker;
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
        task.startChild(ConnectionSpec.of("reader", LinkInbox.class), () -> new Reader(socket, self, run));
        write(task, socket, run, new Outbound(link.name(), worker, task));
      } else {
        PacketFramer.read(task, socket.getInputStream(), new Inbound(link.name(), run, worker, task));
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

  /** Writes each dwell the worker posts, until the task is stopped or the reader says the connection is over. */
  private static void write(TaskContext<LinkInbox> task, Socket socket, UUID run, Outbound outbound) throws IOException {
    OutputStream out = socket.getOutputStream();
    for (LinkInbox item; (item = task.take()) != null; ) {
      switch (item) {
        case LinkInbox.Send send -> outbound.write(out, send);
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
    var peer = new InetSocketAddress(Objects.requireNonNull(link.host()), link.port());
    Socket socket = task.closeOnStop(new Socket()); // before connect, so that a stop ends a connect that blocks
    socket.connect(peer, CONNECT_TIMEOUT_MILLIS);
    socket.setTcpNoDelay(true);
    socket.setKeepAlive(true);
    // An idle time only for a link that receives: an out link may be silent while the simulation is paused.
    socket.setSoTimeout(link.direction().receives() ? (int) Math.min(Integer.MAX_VALUE, link.idle().toMillis()) : 0);
    return socket;
  }

  /** The reader of an {@code out} link: throws away what the peer sends; when it ends it tells the writer, which ends the run. */
  private static final class Reader implements ConnectionTask<LinkInbox> {
    private final Socket socket;
    private final ConnectionRef<LinkInbox> writer;
    private final UUID run;

    Reader(Socket socket, ConnectionRef<LinkInbox> writer, UUID run) {
      this.socket = socket;
      this.writer = writer;
      this.run = run;
    }

    @Override
    public void run(TaskContext<LinkInbox> task) {
      String reason = "the peer closed the connection";
      try {
        InputStream in = socket.getInputStream();
        byte[] chunk = new byte[8192];
        for (int n; !task.stopping() && (n = in.read(chunk)) >= 0; ) {
          task.count("bytes ignored", n);
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
