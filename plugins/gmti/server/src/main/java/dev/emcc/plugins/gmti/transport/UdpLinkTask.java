package dev.emcc.plugins.gmti.transport;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.ListenAddress;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.net.SocketAddress;
import java.net.SocketException;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * One run of a UDP link (the template's, from {@code cot}'s {@code DatagramLinkTask}): one packet per
 * datagram (reference 5).
 * <ul>
 *   <li>{@code in} binds to its listening address, loopback unless an admin sets another, and
 *       receives; a datagram whose length is not its {@code P2} is dropped and counted ({@code size
 *       mismatch}). With a {@code multicastGroup} it joins the group on its {@code
 *       multicastInterface} (A3; the ESA's playback sends on loopback, joined on {@code 127.0.0.1}).
 *   <li>{@code out} sends each packet of each dwell the worker posts, from any port, to its host and
 *       port; a multicast group as host goes out of {@code multicastInterface} when one is named.
 * </ul>
 */
final class UdpLinkTask implements ConnectionTask<LinkInbox> {

  /** The most bytes one UDP datagram carries (65 535 less the IP and UDP headers). */
  static final int MAX_PAYLOAD = 65_507;

  private final Link link;
  private final WorkerRef<TransportMsg> worker;

  UdpLinkTask(Link link, WorkerRef<TransportMsg> worker) {
    this.link = link;
    this.worker = worker;
  }

  @Override
  public void run(TaskContext<LinkInbox> task) throws IOException {
    UUID run = UUID.randomUUID();
    String reason = "stopped";
    try {
      if (link.direction().receives()) {
        DatagramSocket socket = link.multicastGroup() != null ? openGroup(task) : openUnicast(task);
        task.listening(socket.getLocalSocketAddress());
        task.detail("mode", link.where());
        task.send(worker, new TransportMsg.Up(link.name(), run, link.where()));
        receive(task, socket, new Inbound(link.name(), run, worker, task));
      } else {
        SocketAddress target = target();
        DatagramSocket socket = openSender(task, ((InetSocketAddress) target).getAddress());
        task.detail("mode", link.where());
        task.send(worker, new TransportMsg.Up(link.name(), run, target.toString()));
        write(task, socket, target, run, new Outbound(link.name(), worker, task));
      }
    } catch (IOException e) {
      reason = Reason.of(e);
      if (!(e instanceof SocketException) || !task.stopping()) {
        throw e;
      }
    } finally {
      task.send(worker, new TransportMsg.Down(link.name(), run, reason)); // dropped once stopping: the worker stopped it itself
    }
  }

  /** Where an out link sends; resolved once, at the start of the run. */
  private SocketAddress target() throws IOException {
    var peer = new InetSocketAddress(Objects.requireNonNull(link.host()), link.port());
    if (peer.isUnresolved()) {
      throw new IOException("cannot find the host " + link.host());
    }
    return peer;
  }

  /** Sends each packet of each dwell as its own datagram, until the task is stopped. */
  private static void write(TaskContext<LinkInbox> task, DatagramSocket socket, SocketAddress target, UUID run, Outbound outbound) throws IOException {
    for (LinkInbox item; (item = task.take()) != null; ) {
      switch (item) {
        case LinkInbox.Send send -> {
          for (Bytes packet : send.packets()) {
            byte[] bytes = packet.toArray();
            if (bytes.length > MAX_PAYLOAD) {
              task.count("dropped: larger than a datagram", 1); // the worker splits dwells so that this does not happen
              continue;
            }
            socket.send(new DatagramPacket(bytes, bytes.length, target));
          }
          outbound.sent(send);
        }
        case LinkInbox.Closed closed -> {
          if (closed.run().equals(run)) {
            throw new IOException(closed.reason());
          }
        }
        case LinkInbox.ClientUp up -> { } // only a TCP server gets these
      }
    }
  }

  /** Receives datagrams until the task is stopped; each is one packet. */
  private static void receive(TaskContext<LinkInbox> task, DatagramSocket socket, Inbound inbound) throws IOException {
    byte[] buffer = new byte[MAX_PAYLOAD];
    while (!task.stopping()) {
      var packet = new DatagramPacket(buffer, buffer.length);
      socket.receive(packet);
      inbound.datagram(buffer, packet.getLength());
    }
  }

  private DatagramSocket openUnicast(TaskContext<LinkInbox> task) throws IOException {
    ListenAddress at = Objects.requireNonNull(link.listen());
    var socket = task.closeOnStop(new DatagramSocket(null));
    socket.bind(new InetSocketAddress(InetAddress.getByName(at.address()), at.port()));
    return socket;
  }

  /**
   * Joins the group on the named interface. It binds to the group's address where the platform allows
   * it (only the group's datagrams arrive), else, on Windows, to the listening address (loopback unless
   * an admin sets another): never to every address on its own.
   */
  private DatagramSocket openGroup(TaskContext<LinkInbox> task) throws IOException {
    ListenAddress at = Objects.requireNonNull(link.listen());
    InetAddress group = InetAddress.getByName(Objects.requireNonNull(link.multicastGroup()));
    NetworkInterface network = networkInterface(link.multicastInterface(), at.address());
    var socket = task.closeOnStop(new MulticastSocket(null));
    socket.setReuseAddress(true);
    try {
      socket.bind(new InetSocketAddress(group, at.port()));
    } catch (SocketException e) {
      socket.bind(new InetSocketAddress(InetAddress.getByName(at.address()), at.port())); // Windows cannot bind to a group address
    }
    if (network != null) {
      socket.setNetworkInterface(network);
    }
    socket.joinGroup(new InetSocketAddress(group, at.port()), network);
    return socket;
  }

  private DatagramSocket openSender(TaskContext<LinkInbox> task, InetAddress to) throws IOException {
    if (!to.isMulticastAddress()) {
      return task.closeOnStop(new DatagramSocket()); // any port
    }
    var socket = task.closeOnStop(new MulticastSocket(null));
    socket.bind(new InetSocketAddress(0));
    NetworkInterface network = networkInterface(link.multicastInterface(), null);
    if (network != null) {
      socket.setNetworkInterface(network);
    }
    return socket;
  }

  /**
   * The interface an administrator named, by its name, display name or one of its addresses; without
   * a name, the interface of {@code fallbackAddress} when it has one, else the system's choice ({@code null}).
   */
  private static @Nullable NetworkInterface networkInterface(@Nullable String name, @Nullable String fallbackAddress) throws IOException {
    if (name == null) {
      if (fallbackAddress == null) {
        return null;
      }
      InetAddress a = InetAddress.getByName(fallbackAddress);
      return a.isAnyLocalAddress() ? null : NetworkInterface.getByInetAddress(a);
    }
    NetworkInterface byName = NetworkInterface.getByName(name);
    if (byName != null) {
      return byName;
    }
    if (name.matches("[0-9.]+|[0-9a-fA-F:]+")) {
      NetworkInterface byAddress = NetworkInterface.getByInetAddress(InetAddress.getByName(name));
      if (byAddress != null) {
        return byAddress;
      }
    }
    var all = NetworkInterface.networkInterfaces().toList();
    for (NetworkInterface candidate : all) {
      if (candidate.getDisplayName().equalsIgnoreCase(name)) {
        return candidate;
      }
    }
    throw new IOException("no network interface named '" + name + "'");
  }
}
