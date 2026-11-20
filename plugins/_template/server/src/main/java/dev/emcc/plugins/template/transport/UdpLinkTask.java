package dev.emcc.plugins.template.transport;

import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.connection.ConnectionSpec;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.ListenAddress;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketAddress;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import java.util.UUID;

/**
 * One run of a UDP link (from {@code cot}'s {@code DatagramLinkTask}). An {@code in} link binds to
 * its listening address, loopback unless an admin sets another, and receives; an {@code out} link
 * sends what the worker posts, from any port, to its host and port; a {@code both} link does both on
 * one socket, the writer in this task and the reader in a child. A datagram may hold several lines.
 * Multicast: see {@code cot}, which joins a group on an interface an admin names.
 */
final class UdpLinkTask implements ConnectionTask<LinkInbox> {

  /** The most bytes one UDP datagram carries (65 535 less the IP and UDP headers). */
  static final int MAX_PAYLOAD = 65_507;

  private final Link link;
  private final WorkerRef<TransportMsg> worker;
  private final int maxFrameBytes;

  UdpLinkTask(Link link, WorkerRef<TransportMsg> worker, int maxFrameBytes) {
    this.link = link;
    this.worker = worker;
    this.maxFrameBytes = maxFrameBytes;
  }

  @Override
  public void run(TaskContext<LinkInbox> task) throws IOException {
    UUID run = UUID.randomUUID();
    String reason = "stopped";
    try {
      DatagramSocket socket = open(task);
      SocketAddress target = link.direction().sends() ? target() : null;
      if (link.direction().receives()) {
        task.listening(socket.getLocalSocketAddress());
      }
      task.detail("mode", link.where());
      task.send(worker, new TransportMsg.Up(link.name(), run, target != null ? target.toString() : String.valueOf(socket.getLocalSocketAddress())));
      if (target == null) {
        receive(task, socket, new Inbound(link.name(), run, worker, task), maxFrameBytes);
        return;
      }
      if (link.direction().receives()) {
        ConnectionRef<LinkInbox> self = task.self();
        task.startChild(ConnectionSpec.of("reader", LinkInbox.class), () -> new Reader(socket, self, run, link.name(), worker, maxFrameBytes));
      }
      write(task, socket, target, run);
    } catch (IOException e) {
      reason = Reason.of(e);
      if (!(e instanceof SocketException) || !task.stopping()) {
        throw e;
      }
    } finally {
      task.send(worker, new TransportMsg.Down(link.name(), run, reason)); // dropped once stopping: the worker stopped it itself
    }
  }

  /** Where an out or both link sends; resolved once, at the start of the run. */
  private SocketAddress target() throws IOException {
    var peer = new InetSocketAddress(Objects.requireNonNull(link.host()), link.port());
    if (peer.isUnresolved()) {
      throw new IOException("cannot find the host " + link.host());
    }
    return peer;
  }

  /** Sends what the worker posts, one datagram per frame, until the task is stopped or the reader says the socket is gone. */
  private void write(TaskContext<LinkInbox> task, DatagramSocket socket, SocketAddress target, UUID run) throws IOException {
    for (LinkInbox item; (item = task.take()) != null; ) {
      switch (item) {
        case LinkInbox.Send send -> {
          byte[] bytes = (send.frame() + "\n").getBytes(StandardCharsets.UTF_8); // YOUR PROTOCOL: the frame's bytes
          if (bytes.length > MAX_PAYLOAD) {
            task.count("dropped: larger than a datagram", 1);
            continue;
          }
          socket.send(new DatagramPacket(bytes, bytes.length, target));
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

  /** Receives datagrams until the task is stopped; each one's end also ends its last line. */
  private static void receive(TaskContext<LinkInbox> task, DatagramSocket socket, Inbound inbound, int max) throws IOException {
    byte[] buffer = new byte[MAX_PAYLOAD];
    var framer = new LineFramer(max);
    while (!task.stopping()) {
      var packet = new DatagramPacket(buffer, buffer.length);
      socket.receive(packet);
      framer.feed(buffer, 0, packet.getLength(), inbound);
      framer.end(inbound);
    }
  }

  private DatagramSocket open(TaskContext<LinkInbox> task) throws IOException {
    if (!link.direction().receives()) {
      return task.closeOnStop(new DatagramSocket()); // an out link: any port
    }
    ListenAddress at = Objects.requireNonNull(link.listen());
    var socket = task.closeOnStop(new DatagramSocket(null));
    socket.bind(new InetSocketAddress(InetAddress.getByName(at.address()), at.port()));
    return socket;
  }

  /** The reader of a {@code both} link: receives on the socket the writer sends from, and tells the writer when it fails. */
  private static final class Reader implements ConnectionTask<LinkInbox> {
    private final DatagramSocket socket;
    private final ConnectionRef<LinkInbox> writer;
    private final UUID run;
    private final String link;
    private final WorkerRef<TransportMsg> worker;
    private final int max;

    Reader(DatagramSocket socket, ConnectionRef<LinkInbox> writer, UUID run, String link, WorkerRef<TransportMsg> worker, int max) {
      this.socket = socket;
      this.writer = writer;
      this.run = run;
      this.link = link;
      this.worker = worker;
      this.max = max;
    }

    @Override
    public void run(TaskContext<LinkInbox> task) {
      String reason = "the socket was closed";
      try {
        receive(task, socket, new Inbound(link, run, worker, task), max);
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
