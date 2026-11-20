package dev.emcc.plugins.ais.transport;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.ListenAddress;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketException;
import java.util.Objects;
import java.util.UUID;

/**
 * One run of a UDP link (from {@code cot}'s {@code DatagramLinkTask}, input only): binds to its
 * listening address, loopback unless an admin sets another, and receives. A datagram holds one or
 * more lines; its end ends its last line too. Multicast is not offered.
 */
final class UdpLinkTask implements ConnectionTask<Message> {

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
  public void run(TaskContext<Message> task) throws IOException {
    UUID run = UUID.randomUUID();
    String reason = "stopped";
    try {
      DatagramSocket socket = open(task);
      task.listening(socket.getLocalSocketAddress());
      task.detail("mode", link.where());
      task.send(worker, new TransportMsg.Up(link.name(), run, String.valueOf(socket.getLocalSocketAddress())));
      receive(task, socket, new Inbound(link.name(), run, worker, task), maxFrameBytes);
    } catch (IOException e) {
      reason = Reason.of(e);
      if (!(e instanceof SocketException) || !task.stopping()) {
        throw e;
      }
    } finally {
      task.send(worker, new TransportMsg.Down(link.name(), run, reason)); // dropped once stopping: the worker stopped it itself
    }
  }

  /** Receives datagrams until the task is stopped; each one's end also ends its last line. */
  private static void receive(TaskContext<Message> task, DatagramSocket socket, Inbound inbound, int max) throws IOException {
    byte[] buffer = new byte[MAX_PAYLOAD];
    var framer = new LineFramer(max);
    while (!task.stopping()) {
      var packet = new DatagramPacket(buffer, buffer.length);
      socket.receive(packet);
      framer.feed(buffer, 0, packet.getLength(), inbound);
      framer.end(inbound);
    }
  }

  private DatagramSocket open(TaskContext<Message> task) throws IOException {
    ListenAddress at = Objects.requireNonNull(link.listen());
    var socket = task.closeOnStop(new DatagramSocket(null));
    socket.bind(new InetSocketAddress(InetAddress.getByName(at.address()), at.port()));
    return socket;
  }
}
