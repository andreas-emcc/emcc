package dev.emcc.plugins.template.transport;

import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.connection.ConnectionSpec;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.ListenAddress;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * One run of a TCP server link: binds to its listening address, loopback unless an admin sets
 * another, and serves each client that connects (the design pattern's accept loop):
 * <ul>
 *   <li>a child task, {@code accept}, accepts; for each client it starts a reader ({@code in}: a
 *       consumer), or a writer and a reader ({@code out}: a provider, and {@code both});
 *   <li>this task forwards every frame the worker posts to every client's writer. A client that
 *       connects gets what is sent from then on; a worker that must give it the current picture does
 *       so on {@link TransportMsg.Up}.
 * </ul>
 * Each client's writer has its own inbox that keeps the latest frame per key, so a slow client holds
 * up no other. A client that sends and receives takes two tasks of the plugin's cap of 100 ({@code
 * Connections.MAX_TASKS}); at the cap a new client is closed and counted ({@code clients refused}).
 */
final class TcpServerLinkTask implements ConnectionTask<LinkInbox> {

  /** The inbox of one client's writer; the latest frame per key. */
  static final int CLIENT_INBOX = 10_000;

  private final Link link;
  private final WorkerRef<TransportMsg> worker;
  private final int maxFrameBytes;

  TcpServerLinkTask(Link link, WorkerRef<TransportMsg> worker, int maxFrameBytes) {
    this.link = link;
    this.worker = worker;
    this.maxFrameBytes = maxFrameBytes;
  }

  @Override
  public void run(TaskContext<LinkInbox> task) throws IOException {
    UUID run = UUID.randomUUID();
    ListenAddress at = Objects.requireNonNull(link.listen());
    ServerSocket server = task.closeOnStop(new ServerSocket());
    try {
      server.bind(new InetSocketAddress(InetAddress.getByName(at.address()), at.port()));
      task.listening(server.getLocalSocketAddress());
      task.detail("mode", link.where());
      task.send(worker, new TransportMsg.Listening(link.name(), run, String.valueOf(server.getLocalSocketAddress())));
      ConnectionRef<LinkInbox> self = task.self();
      task.startChild(ConnectionSpec.of("accept", LinkInbox.class), () -> new Acceptor(server, self, run, link, worker, maxFrameBytes));
      forward(task, run);
    } catch (IOException e) {
      if (!task.stopping()) {
        throw e;
      }
    }
  }

  /** Forwards each frame to every client's writer, until the task is stopped or the acceptor ends. */
  private void forward(TaskContext<LinkInbox> task, UUID run) throws IOException {
    List<ConnectionRef<LinkInbox>> writers = new ArrayList<>();
    for (LinkInbox item; (item = task.take()) != null; ) {
      switch (item) {
        case LinkInbox.Send send -> {
          writers.removeIf(w -> w.post(send) == SendResult.CLOSED); // a client that has gone
          if (writers.isEmpty()) {
            task.count("skipped: no client", 1);
          }
        }
        case LinkInbox.ClientUp up -> {
          writers.add(up.writer());
          task.send(worker, new TransportMsg.Up(link.name(), up.run(), up.peer()));
        }
        case LinkInbox.Closed closed -> {
          if (closed.run().equals(run)) {
            throw new IOException(closed.reason());
          }
        }
      }
    }
  }

  /** Accepts clients and starts their tasks; tells the server's task when the server socket fails. */
  private static final class Acceptor implements ConnectionTask<LinkInbox> {
    private final ServerSocket server;
    private final ConnectionRef<LinkInbox> parent;
    private final UUID run;
    private final Link link;
    private final WorkerRef<TransportMsg> worker;
    private final int max;

    Acceptor(ServerSocket server, ConnectionRef<LinkInbox> parent, UUID run, Link link, WorkerRef<TransportMsg> worker, int max) {
      this.server = server;
      this.parent = parent;
      this.run = run;
      this.link = link;
      this.worker = worker;
      this.max = max;
    }

    @Override
    public void run(TaskContext<LinkInbox> task) {
      String reason = "the server socket was closed";
      int clients = 0;
      try {
        while (!task.stopping()) {
          Socket client = server.accept();
          try {
            start(task, client, "client-" + (++clients)); // the plugin numbers its children
          } catch (IllegalStateException | IOException atTheCapOrFailed) {
            client.close(); // one client's trouble does not end the server
            task.count("clients refused", 1);
          }
        }
      } catch (IOException e) {
        reason = Reason.of(e);
      } finally {
        if (!task.stopping()) {
          parent.post(new LinkInbox.Closed(run, reason));
        }
      }
    }

    private void start(TaskContext<LinkInbox> task, Socket client, String name) throws IOException {
      UUID clientRun = UUID.randomUUID();
      client.setTcpNoDelay(true);
      // An idle time only for a client that sends us something; a provider's client may never send.
      client.setSoTimeout(link.direction().receives() ? (int) Math.min(Integer.MAX_VALUE, link.idle().toMillis()) : 0);
      if (!link.direction().sends()) {
        task.startChild(ConnectionSpec.of(name, LinkInbox.class), () -> new ClientReader(client, null, clientRun, link, worker, max));
        return;
      }
      ConnectionRef<LinkInbox> writer = task.startChild(ConnectionSpec.of(name, LinkInbox.class).inbox(CLIENT_INBOX, Overflow.coalesceByKey()),
          () -> new ClientWriter(client, clientRun, link.name(), worker));
      try {
        task.startChild(ConnectionSpec.of(name + "-reader", LinkInbox.class), () -> new ClientReader(client, writer, clientRun, link, worker, max));
      } catch (IllegalStateException atTheCap) {
        writer.stop();
        throw atTheCap;
      }
      parent.post(new LinkInbox.ClientUp(writer, clientRun, String.valueOf(client.getRemoteSocketAddress())));
    }
  }

  /** Writes what the server's task forwards to one client, until the client goes or the task is stopped. */
  private static final class ClientWriter implements ConnectionTask<LinkInbox> {
    private final Socket socket;
    private final UUID run;
    private final String link;
    private final WorkerRef<TransportMsg> worker;

    ClientWriter(Socket socket, UUID run, String link, WorkerRef<TransportMsg> worker) {
      this.socket = socket;
      this.run = run;
      this.link = link;
      this.worker = worker;
    }

    @Override
    public void run(TaskContext<LinkInbox> task) throws IOException {
      task.closeOnStop(socket);
      task.peer(socket.getRemoteSocketAddress());
      String reason = "stopped"; // the server's task announces the client (ClientUp)
      try (socket) {
        OutputStream out = socket.getOutputStream();
        for (LinkInbox item; (item = task.take()) != null; ) {
          switch (item) {
            case LinkInbox.Send send -> {
              out.write((send.frame() + "\n").getBytes(StandardCharsets.UTF_8)); // YOUR PROTOCOL: the frame's bytes
              out.flush();
              task.count("frames out", 1);
            }
            case LinkInbox.Closed closed -> {
              reason = closed.reason(); // the reader saw the client go
              return;
            }
            case LinkInbox.ClientUp up -> { } // only the server's task gets these
          }
        }
      } catch (IOException e) {
        reason = Reason.of(e); // a client that goes is no failure of the link
      } finally {
        task.send(worker, new TransportMsg.Down(link, run, reason));
      }
    }
  }

  /**
   * Reads one client: frames what it sends for {@code in} and {@code both}, throws it away for {@code
   * out}. With a writer, it tells the writer when the client goes; without one, it reports the client
   * to the worker itself.
   */
  private static final class ClientReader implements ConnectionTask<LinkInbox> {
    private final Socket socket;
    private final @Nullable ConnectionRef<LinkInbox> writer;
    private final UUID run;
    private final Link link;
    private final WorkerRef<TransportMsg> worker;
    private final int max;

    ClientReader(Socket socket, @Nullable ConnectionRef<LinkInbox> writer, UUID run, Link link, WorkerRef<TransportMsg> worker, int max) {
      this.socket = socket;
      this.writer = writer;
      this.run = run;
      this.link = link;
      this.worker = worker;
      this.max = max;
    }

    @Override
    public void run(TaskContext<LinkInbox> task) throws IOException {
      task.closeOnStop(socket);
      task.peer(socket.getRemoteSocketAddress());
      if (writer == null) {
        task.send(worker, new TransportMsg.Up(link.name(), run, String.valueOf(socket.getRemoteSocketAddress())));
      }
      String reason = "the client closed the connection";
      try {
        InputStream in = socket.getInputStream();
        if (link.direction().receives()) {
          new LineFramer(max).read(task, in, new Inbound(link.name(), run, worker, task));
        } else {
          byte[] chunk = new byte[8192];
          for (int n; !task.stopping() && (n = in.read(chunk)) >= 0; ) {
            task.count("bytes ignored", n);
          }
        }
      } catch (IOException e) {
        reason = Reason.of(e);
      } finally {
        if (writer != null) {
          if (!task.stopping()) {
            writer.post(new LinkInbox.Closed(run, reason));
          }
        } else {
          socket.close();
          task.send(worker, new TransportMsg.Down(link.name(), run, reason));
        }
      }
    }
  }
}
