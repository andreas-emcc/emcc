package dev.emcc.plugins.adsb.transport;

import dev.emcc.plugins.adsb.AdsbMsg;
import dev.emcc.plugins.adsb.Link;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.UUID;

/**
 * One run of a TCP client link (the template's transport, input only): connects to the decoder's
 * host and port, reads the SBS-1 lines and hands them on through {@link Inbound}. When the
 * connection ends, or nothing has come for the link's idle time, the run ends, and ECore starts the
 * next one with its back-off. The host and port come from the settings only (ADR-0030).
 */
public final class TcpClientLinkTask implements ConnectionTask<Message> {

  private static final int CONNECT_TIMEOUT_MILLIS = 10_000;

  private final Link link;
  private final WorkerRef<AdsbMsg> worker;
  private final int maxFrameBytes;

  public TcpClientLinkTask(Link link, WorkerRef<AdsbMsg> worker, int maxFrameBytes) {
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
      task.send(worker, new AdsbMsg.Up(link.name(), run, String.valueOf(socket.getRemoteSocketAddress())));
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
      task.send(worker, new AdsbMsg.Down(link.name(), run, reason));
    }
  }

  private Socket open(TaskContext<Message> task) throws IOException {
    var peer = new InetSocketAddress(link.host(), link.port());
    Socket socket = task.closeOnStop(new Socket());
    socket.connect(peer, CONNECT_TIMEOUT_MILLIS);
    socket.setTcpNoDelay(true);
    socket.setKeepAlive(true);
    // A decoder that sends nothing for the idle time is taken as gone; zero means never.
    socket.setSoTimeout((int) Math.min(Integer.MAX_VALUE, link.idle().toMillis()));
    return socket;
  }
}
