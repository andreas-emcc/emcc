package dev.emcc.plugins.cot;

import dev.emcc.plugins.cot.Config.Globals;
import dev.emcc.plugins.cot.Config.LinkConfig;
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
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.net.SocketAddress;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * One run of a UDP or multicast link (brief function 12): one datagram carries one CoT event. An
 * {@code in} link receives; an {@code out} link sends the events the worker posts to its inbox; a
 * {@code both} link does both on one socket, the writer in this task and the reader in a child. A UDP link binds to the address of its settings, which is loopback unless an
 * administrator sets another ({@link ListenAddress#from}). A multicast link joins its group on the
 * network interface an administrator names ({@link ListenAddress#multicast}); without one it is
 * not started at all. It is the only place the plugin opens a datagram socket (rule C6).
 */
final class DatagramLinkTask implements ConnectionTask<LinkInbox> {

  /** The largest UDP payload. */
  private static final int MAX_DATAGRAM = 65_535;

  /** The most bytes one UDP datagram carries (65 535 less the IP and UDP headers). */
  private static final int MAX_PAYLOAD = 65_507;

  private final LinkConfig link;
  private final Globals globals;
  private final WorkerRef<ApplierMsg> applier;
  private final Clock clock;
  private final UUID generation;

  DatagramLinkTask(LinkConfig link, Globals globals, WorkerRef<ApplierMsg> applier, Clock clock) {
    this(link, globals, applier, clock, new UUID(0, 0));
  }

  /** @param generation the worker's id of the task it started for the link, which the task's messages carry (see {@code ApplierMsg.Connected}) */
  DatagramLinkTask(LinkConfig link, Globals globals, WorkerRef<ApplierMsg> applier, Clock clock, UUID generation) {
    this.generation = generation;
    this.link = link;
    this.globals = globals;
    this.applier = applier;
    this.clock = clock;
  }

  @Override
  public void run(TaskContext<LinkInbox> task) throws IOException {
    var pipe = new InputPipe(link.name(), applier, task, clock, generation);
    try {
      DatagramSocket socket = open(task);
      if (link.direction().receives()) {
        task.listening(socket.getLocalSocketAddress());
      }
      task.detail("transport", link.transport().json());
      pipe.connected();
      if (link.direction().sends()) {
        SocketAddress target = target();
        if (link.direction().receives()) {
          ConnectionRef<LinkInbox> self = task.self();
          task.startChild(ConnectionSpec.of("reader", LinkInbox.class), () -> new Reader(socket, self, pipe.run(), link, globals, applier, clock, generation));
        }
        write(task, socket, target, pipe);
      } else {
        receive(task, socket, pipe, globals.maxEventBytes());
      }
    } catch (SocketException e) {
      if (!task.stopping()) {
        throw e;
      }
    } finally {
      pipe.finish();
    }
  }

  /** Where an out or both link sends: the group of a multicast link, the host and port of a UDP link. */
  private SocketAddress target() throws IOException {
    if (link.transport() == Config.Transport.MULTICAST) {
      ListenAddress at = Objects.requireNonNull(link.listen());
      var group = new InetSocketAddress(at.address(), at.port());
      if (group.isUnresolved()) {
        throw new IOException("cannot find the group " + Text.clean(at.address()));
      }
      return group;
    }
    var peer = new InetSocketAddress(Objects.requireNonNull(link.host()), link.port());
    if (peer.isUnresolved()) {
      throw new IOException("cannot find the host " + Text.clean(link.host())); // at the start, not at every send
    }
    return peer;
  }

  /** Sends what the worker posts, one datagram to an event, until the task is stopped or the reader says the socket is gone. */
  private void write(TaskContext<LinkInbox> task, DatagramSocket socket, SocketAddress target, InputPipe pipe) throws IOException {
    long written = 0;
    long expired = 0;
    for (LinkInbox item; (item = task.take()) != null; ) {
      switch (item) {
        case LinkInbox.Send send -> {
          if (send.isNothing()) {
            continue;
          }
          if (send.expires() != null && !Instant.now(clock).isBefore(send.expires())) {
            expired++; // it expired while it waited
            task.count("skipped: expired", 1);
            task.send(applier, new ApplierMsg.Written(link.name(), pipe.run(), written, expired));
            continue;
          }
          byte[] bytes = send.xml().getBytes(StandardCharsets.UTF_8);
          if (bytes.length > MAX_PAYLOAD) {
            task.count("dropped: larger than a datagram", 1);
            continue;
          }
          socket.send(new DatagramPacket(bytes, bytes.length, target));
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

  /** Reads datagrams, one event each, until the task is stopped. */
  private static void receive(TaskContext<LinkInbox> task, DatagramSocket socket, InputPipe pipe, int max) throws IOException {
    // One byte more than the limit tells a datagram that is too large from one that just fits.
    byte[] buffer = new byte[Math.min(max + 1, MAX_DATAGRAM)];
    while (!task.stopping()) {
      var packet = new DatagramPacket(buffer, buffer.length);
      socket.receive(packet);
      if (packet.getLength() > max) {
        pipe.tooLarge(packet.getLength());
      } else {
        pipe.event(buffer, packet.getLength());
      }
    }
  }

  private DatagramSocket open(TaskContext<LinkInbox> task) throws IOException {
    if (link.transport() == Config.Transport.MULTICAST) {
      return openMulticast(task, Objects.requireNonNull(link.listen()), link.direction().receives());
    }
    if (!link.direction().receives()) {
      return task.closeOnStop(new DatagramSocket()); // an out link: any port, to host and port
    }
    ListenAddress at = Objects.requireNonNull(link.listen());
    var socket = task.closeOnStop(new DatagramSocket(null));
    socket.bind(new InetSocketAddress(InetAddress.getByName(at.address()), at.port()));
    return socket;
  }

  private static DatagramSocket openMulticast(TaskContext<LinkInbox> task, ListenAddress at, boolean receives) throws IOException {
    NetworkInterface network = networkInterface(Objects.requireNonNull(at.networkInterface()));
    InetAddress group = InetAddress.getByName(at.address());
    if (!group.isMulticastAddress()) {
      throw new IOException(at.address() + " is not a multicast group");
    }
    var socket = task.closeOnStop(new MulticastSocket(null));
    if (!receives) {
      socket.bind(new InetSocketAddress(0)); // an out link only sends, from any port, on the interface the admin named
      socket.setNetworkInterface(network);
      return socket;
    }
    socket.setReuseAddress(true);
    try {
      socket.bind(new InetSocketAddress(group, at.port())); // only this group's datagrams, where the platform allows it
    } catch (SocketException e) {
      socket.bind(new InetSocketAddress(at.port())); // Windows cannot bind to a group address
    }
    socket.setNetworkInterface(network);
    socket.joinGroup(new InetSocketAddress(group, at.port()), network);
    return socket;
  }

  /** The reader of a {@code both} link: receives on the socket the writer sends from, and tells the writer if it fails. */
  private static final class Reader implements ConnectionTask<LinkInbox> {
    private final DatagramSocket socket;
    private final ConnectionRef<LinkInbox> writer;
    private final UUID writerRun;
    private final int max;
    private final WorkerRef<ApplierMsg> applier;
    private final Clock clock;
    private final LinkConfig link;
    private final UUID generation;

    Reader(DatagramSocket socket, ConnectionRef<LinkInbox> writer, UUID writerRun, LinkConfig link, Globals globals, WorkerRef<ApplierMsg> applier, Clock clock,
        UUID generation) {
      this.generation = generation;
      this.socket = socket;
      this.writer = writer;
      this.writerRun = writerRun;
      this.link = link;
      this.max = globals.maxEventBytes();
      this.applier = applier;
      this.clock = clock;
    }

    @Override
    public void run(TaskContext<LinkInbox> task) {
      var pipe = new InputPipe(link.name(), applier, task, clock, generation);
      String reason = "the socket was closed";
      try {
        receive(task, socket, pipe, max);
      } catch (IOException e) {
        reason = e.getMessage() == null ? e.toString() : e.getMessage();
      } finally {
        pipe.finish();
        if (!task.stopping()) {
          writer.post(new LinkInbox.Closed(writerRun, reason));
        }
      }
    }
  }

  /** The interface an administrator named, by its name or its display name. */
  private static NetworkInterface networkInterface(String name) throws IOException {
    NetworkInterface byName = NetworkInterface.getByName(name);
    if (byName != null) {
      return byName;
    }
    var all = NetworkInterface.networkInterfaces().toList();
    for (NetworkInterface candidate : all) {
      if (candidate.getDisplayName().equalsIgnoreCase(name)) {
        return candidate;
      }
    }
    var known = all.stream().map(NetworkInterface::getName).toList();
    throw new IOException("no network interface named '" + name + "' (some of the " + known.size() + " known: "
        + String.join(", ", known.subList(0, Math.min(6, known.size()))) + ")");
  }
}
