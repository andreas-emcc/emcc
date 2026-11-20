package dev.emcc.plugins.ais.transport;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Objects;
import java.util.UUID;

/**
 * One run of a TCP client link (from {@code cot}'s {@code TcpLinkTask}, input only): connects to its
 * host and port, reads, cuts the stream into lines and hands them on. When the connection ends, or
 * nothing comes for the link's idle time, the run ends, and ECore starts the next with its back-off.
 */
final class TcpClientLinkTask implements ConnectionTask<Message> {

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
  public void run(TaskContext<Message> task) throws IOException {
    UUID run = UUID.randomUUID();
    String reason = "stopped";
    try {
      Socket socket = open(task);
      task.peer(socket.getRemoteSocketAddress());
      task.detail("mode", link.where());
      task.send(worker, new TransportMsg.Up(link.name(), run, String.valueOf(socket.getRemoteSocketAddress())));
      new LineFramer(maxFrameBytes).read(task, socket.getInputStream(), new Inbound(link.name(), run, worker, task));
      if (!task.stopping()) {
        throw new IOException("the peer closed the connection");
      }
    } catch (IOException e) {
      reason = Reason.of(e);
      if (!task.stopping()) {
        throw e;
      } // stopped: the socket was closed under the read
    } finally {
      task.send(worker, new TransportMsg.Down(link.name(), run, reason));
    }
  }

  /** Connects; the socket is registered with the task first, so that a stop ends a blocked connect. */
  private Socket open(TaskContext<Message> task) throws IOException {
    var peer = new InetSocketAddress(Objects.requireNonNull(link.host()), link.port());
    Socket socket = task.closeOnStop(new Socket());
    socket.setTcpNoDelay(true);
    socket.setKeepAlive(true);
    socket.setSoTimeout((int) Math.min(Integer.MAX_VALUE, link.idle().toMillis()));
    socket.connect(peer, CONNECT_TIMEOUT_MILLIS);
    return socket;
  }
}
