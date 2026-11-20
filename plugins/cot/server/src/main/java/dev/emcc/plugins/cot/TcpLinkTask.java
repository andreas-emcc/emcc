package dev.emcc.plugins.cot;

import dev.emcc.plugins.cot.Config.Globals;
import dev.emcc.plugins.cot.Config.LinkConfig;
import dev.emcc.plugins.cot.codec.CotXml;
import dev.emcc.plugins.cot.stream.EventFramer;
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
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import org.jspecify.annotations.Nullable;

/**
 * One run of a TCP or TLS link: a client of a TAK Server's CoT streaming input (brief function 12).
 * It connects to the host and port of its link's settings, sends the presence event if that is
 * switched on, and then
 * <ul>
 *   <li>for an {@code in} link reads the stream, cuts it into events and hands them to {@link InputPipe};
 *   <li>for an {@code out} or {@code both} link writes the events the worker posts to its inbox, one
 *       connection for both directions, while a child task, the reader, reads what the peer sends
 *       (an {@code out} link throws it away: a TAK Server sends every client what the others send,
 *       and a client that never reads would stall it).
 * </ul>
 * It is the only place the plugin opens a socket for these links (rule C6). When the connection ends,
 * ECore restarts the task with the back-off.
 *
 * <p>TLS uses the credential that local server configuration names as the link picked, else like the link
 * ({@code task.tls(name)}; brief function 33); the peer's certificate must name the host.
 */
final class TcpLinkTask implements ConnectionTask<LinkInbox> {

  private static final int CONNECT_TIMEOUT_MILLIS = 10_000;

  private final LinkConfig link;
  private final Globals globals;
  private final WorkerRef<ApplierMsg> applier;
  private final Clock clock;
  private final @Nullable Opener opener;
  private final UUID generation;

  /** Opens the connection in place of the task's own code; for a test that needs a socket whose writes block. */
  @FunctionalInterface
  interface Opener {
    Socket open(TaskContext<LinkInbox> task) throws IOException;
  }

  TcpLinkTask(LinkConfig link, Globals globals, WorkerRef<ApplierMsg> applier, Clock clock) {
    this(link, globals, applier, clock, null);
  }

  TcpLinkTask(LinkConfig link, Globals globals, WorkerRef<ApplierMsg> applier, Clock clock, @Nullable Opener opener) {
    this(link, globals, applier, clock, opener, new UUID(0, 0));
  }

  /** @param generation the worker's id of the task it started for the link, which the task's messages carry (see {@code ApplierMsg.Connected}) */
  TcpLinkTask(LinkConfig link, Globals globals, WorkerRef<ApplierMsg> applier, Clock clock, @Nullable Opener opener, UUID generation) {
    this.generation = generation;
    this.link = link;
    this.globals = globals;
    this.applier = applier;
    this.clock = clock;
    this.opener = opener;
  }

  @Override
  public void run(TaskContext<LinkInbox> task) throws IOException {
    var pipe = new InputPipe(link.name(), applier, task, clock, generation);
    try {
      Socket socket = opener != null ? opener.open(task) : open(task);
      task.peer(socket.getRemoteSocketAddress());
      task.detail("transport", link.transport().json());
      pipe.connected();
      if (globals.sendPresence() && link.direction().receives()) {
        OutputStream out = socket.getOutputStream();
        // a write that blocks is seen by the worker, which closes the connection of a link that sends: also this one (AE1; not an in link, AF1)
        task.send(applier, new ApplierMsg.Written(link.name(), pipe.run(), 0, 0, true));
        out.write(CotXml.presence(globals.presenceCallsign(), Instant.now(clock)).getBytes(StandardCharsets.UTF_8));
        out.flush();
        task.send(applier, new ApplierMsg.Written(link.name(), pipe.run(), 0, 0, false));
      }
      if (link.direction().sends()) {
        ConnectionRef<LinkInbox> self = task.self();
        task.startChild(ConnectionSpec.of("reader", LinkInbox.class), () -> new Reader(socket, self, pipe.run(), link, globals, applier, clock, generation));
        write(task, socket, pipe);
      } else {
        read(task, socket, new EventFramer(globals.maxEventBytes()), pipe);
        if (!task.stopping()) {
          throw new IOException("the peer closed the connection");
        }
      }
    } catch (IOException e) {
      if (task.stopping()) {
        return; // stopped: the socket was closed under the read or the write
      }
      throw e;
    } finally {
      pipe.finish();
    }
  }

  /** Writes what the worker posts, until the task is stopped or the reader says the connection is over. */
  private void write(TaskContext<LinkInbox> task, Socket socket, InputPipe pipe) throws IOException {
    OutputStream out = socket.getOutputStream();
    long written = 0;
    long expired = 0;
    for (LinkInbox item; (item = task.take()) != null; ) {
      switch (item) {
        case LinkInbox.Send send -> {
          if (send.isNothing()) {
            continue;
          }
          if (send.expires() != null && !Instant.now(clock).isBefore(send.expires())) {
            expired++; // it expired while it waited for the connection
            task.count("skipped: expired", 1);
            task.send(applier, new ApplierMsg.Written(link.name(), pipe.run(), written, expired));
            continue;
          }
          task.send(applier, new ApplierMsg.Written(link.name(), pipe.run(), written, expired, true)); // a write that blocks is seen by the worker
          out.write(send.xml().getBytes(StandardCharsets.UTF_8));
          out.flush();
          written++;
          task.count("events out", 1);
          task.send(applier, new ApplierMsg.Written(link.name(), pipe.run(), written, expired));
        }
        case LinkInbox.Closed closed -> {
          if (closed.run().equals(pipe.run())) {
            throw new IOException(closed.reason());
          } // else: the end of a run that is over
        }
      }
    }
  }

  /** Reads and frames until the peer closes, the link is idle, or the task is stopped. */
  private static void read(TaskContext<LinkInbox> task, Socket socket, EventFramer framer, EventFramer.Sink sink) throws IOException {
    InputStream in = socket.getInputStream();
    byte[] chunk = new byte[8192];
    int n;
    try {
      while (!task.stopping() && (n = in.read(chunk)) >= 0) {
        framer.feed(chunk, 0, n, sink);
      }
    } catch (SocketTimeoutException e) {
      if (!task.stopping()) {
        throw new IOException("idle for " + (socket.getSoTimeout() / 1000) + " s", e);
      }
    }
  }

  /**
   * The TLS credential of that name (brief function 33). ECore refuses a name it lacks with an {@code IllegalArgumentException}, and an expired or
   * unreadable credential with an {@code IllegalStateException} that names the date; either fails the start, and the link's status says which
   * credential and why, never a path.
   */
  static SSLSocketFactory credential(TaskContext<?> task, String name) throws IOException {
    try {
      return task.tls(name);
    } catch (IllegalArgumentException e) {
      throw new IOException("the TLS credential '" + Text.clean(name) + "' is missing", e);
    } catch (IllegalStateException e) {
      String why = String.valueOf(e.getMessage());
      throw new IOException(why.contains(name) ? why : "the TLS credential '" + Text.clean(name) + "' cannot be used: " + why, e);
    }
  }

  /** Connects to the peer, with TLS if the link says so. */
  private Socket open(TaskContext<LinkInbox> task) throws IOException {
    String host = Objects.requireNonNull(link.host());
    var peer = new InetSocketAddress(host, link.port());
    // Without usable credentials the link fails here, before any connection to the host is opened.
    SSLSocketFactory factory = link.transport() == Config.Transport.TLS ? credential(task, Objects.requireNonNull(link.tlsCredential())) : null;
    Socket plain = task.closeOnStop(new Socket());
    plain.connect(peer, CONNECT_TIMEOUT_MILLIS);
    Socket socket = plain;
    if (factory != null) {
      plain.setSoTimeout(CONNECT_TIMEOUT_MILLIS); // a peer that accepts and then says nothing must not hold the handshake for ever
      SSLSocket tls = (SSLSocket) factory.createSocket(plain, host, link.port(), true);
      task.closeOnStop(tls);
      tls.startHandshake();
      socket = tls;
    }
    socket.setTcpNoDelay(true);
    socket.setKeepAlive(true);
    // An idle time only for a link that receives: an out link may be silent for as long as it has nothing to send.
    socket.setSoTimeout(link.direction().receives() ? (int) Math.min(Integer.MAX_VALUE, globals.idle().toMillis()) : 0);
    return socket;
  }

  /**
   * The reader of an {@code out} or {@code both} link: reads what the peer sends on the connection
   * the writer holds. It parses it for {@code both} and throws it away for {@code out}. When it ends
   * it tells the writer, which ends the run.
   */
  private static final class Reader implements ConnectionTask<LinkInbox> {
    private final Socket socket;
    private final ConnectionRef<LinkInbox> writer;
    private final UUID writerRun;
    private final LinkConfig link;
    private final Globals globals;
    private final WorkerRef<ApplierMsg> applier;
    private final Clock clock;
    private final UUID generation;

    Reader(Socket socket, ConnectionRef<LinkInbox> writer, UUID writerRun, LinkConfig link, Globals globals, WorkerRef<ApplierMsg> applier, Clock clock,
        UUID generation) {
      this.generation = generation;
      this.socket = socket;
      this.writer = writer;
      this.writerRun = writerRun;
      this.link = link;
      this.globals = globals;
      this.applier = applier;
      this.clock = clock;
    }

    @Override
    public void run(TaskContext<LinkInbox> task) {
      InputPipe pipe = link.direction().receives() ? new InputPipe(link.name(), applier, task, clock, generation) : null;
      String reason = "the peer closed the connection";
      try {
        if (pipe != null) {
          read(task, socket, new EventFramer(globals.maxEventBytes()), pipe);
        } else {
          InputStream in = socket.getInputStream();
          byte[] chunk = new byte[8192];
          int n;
          while (!task.stopping() && (n = in.read(chunk)) >= 0) {
            task.count("bytes ignored", n);
          }
        }
      } catch (IOException e) {
        reason = e.getMessage() == null ? e.toString() : e.getMessage();
      } finally {
        if (pipe != null) {
          pipe.finish();
        }
        if (!task.stopping()) {
          writer.post(new LinkInbox.Closed(writerRun, reason));
        }
      }
    }
  }
}
