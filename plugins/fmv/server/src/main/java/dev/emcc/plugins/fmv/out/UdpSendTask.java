package dev.emcc.plugins.fmv.out;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.time.Duration;
import org.jspecify.annotations.Nullable;

/**
 * An output link's sender (brief section 10.6 point 21; ADR-0036, ADR-0058 point 2): UDP to the
 * destination an admin set, unicast or to a multicast group from the named interface with its TTL,
 * paced at {@code maxRate} by a {@link Pacer}. It waits with {@code poll(timeout)} until the next
 * datagram's time and never sleeps; the socket is opened here, in the task (rule C6), and the host
 * is looked up here too.
 */
final class UdpSendTask implements ConnectionTask<SendItem> {

  /** The socket's send buffer, asked for before the first send: a keyframe is about 100 KB. */
  static final int SEND_BUFFER = 4 * 1024 * 1024;

  private static final long REPORT_NANOS = 1_000_000_000L;

  private final String link;
  private final OutLink.Destination destination;
  private final double maxBitsPerSecond;
  private final WorkerRef<OutputMsg> worker;

  UdpSendTask(String link, OutLink.Destination destination, double maxRateMbps, WorkerRef<OutputMsg> worker) {
    this.link = link;
    this.destination = destination;
    this.maxBitsPerSecond = maxRateMbps * 1e6;
    this.worker = worker;
  }

  @Override
  public void run(TaskContext<SendItem> task) throws IOException {
    InetAddress to = InetAddress.getByName(destination.host());
    var target = new InetSocketAddress(to, destination.port());
    DatagramSocket socket = open(task, to);
    socket.setSendBufferSize(SEND_BUFFER);
    task.peer(target);
    task.detail("destination", destination.where());
    task.detail("send buffer", socket.getSendBufferSize() + " bytes");
    Pacer pacer = new Pacer(maxBitsPerSecond);
    long datagrams = 0;
    long bytes = 0;
    long lastReport = System.nanoTime();
    try {
      while (!task.stopping()) {
        long now = System.nanoTime();
        for (Bytes d; (d = pacer.take(now)) != null; now = System.nanoTime()) {
          byte[] b = d.toArray();
          socket.send(new DatagramPacket(b, b.length, target));
          datagrams++;
          bytes += b.length;
          task.count("datagrams sent", 1);
        }
        long wait = pacer.waitNanos(now);
        SendItem item = task.poll(wait < 0 ? Duration.ofSeconds(1) : Duration.ofNanos(Math.max(1_000_000L, wait)));
        if (item instanceof SendItem.Datagrams g) {
          g.datagrams().forEach(pacer::offer);
        }
        if (now - lastReport >= REPORT_NANOS) {
          lastReport = now;
          task.send(worker, new OutputMsg.Sent(link, datagrams, bytes, pacer.dropped()));
        }
      }
    } catch (SocketException e) {
      if (!task.stopping()) {
        throw e;
      }
    } finally {
      task.send(worker, new OutputMsg.Sent(link, datagrams, bytes, pacer.dropped()));
    }
  }

  private DatagramSocket open(TaskContext<SendItem> task, InetAddress to) throws IOException {
    if (!destination.multicast()) {
      return task.closeOnStop(new DatagramSocket()); // any local port
    }
    var socket = task.closeOnStop(new MulticastSocket(null));
    socket.bind(new InetSocketAddress(0));
    NetworkInterface network = networkInterface(destination.networkInterface());
    if (network != null) {
      socket.setNetworkInterface(network);
    }
    socket.setTimeToLive(destination.ttl());
    return socket;
  }

  /** The interface an admin named, by its name, an address or its display name. */
  private static @Nullable NetworkInterface networkInterface(@Nullable String name) throws IOException {
    if (name == null) {
      return null;
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
    for (NetworkInterface candidate : NetworkInterface.networkInterfaces().toList()) {
      if (candidate.getDisplayName().equalsIgnoreCase(name)) {
        return candidate;
      }
    }
    throw new IOException("no network interface named '" + name + "'");
  }
}
