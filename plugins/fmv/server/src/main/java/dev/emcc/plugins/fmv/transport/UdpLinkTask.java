package dev.emcc.plugins.fmv.transport;

import dev.emcc.plugins.fmv.klv.St0601;
import dev.emcc.plugins.fmv.ts.Program;
import dev.emcc.plugins.fmv.ts.TsReader;
import dev.emcc.plugins.fmv.ts.VideoFormat;
import dev.emcc.plugins.fmv.ts.VideoSize;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.ListenAddress;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.stream.ConversionRef;
import dev.emcc.sdk.stream.StreamRef;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * One run of an FMV link (brief section 4): it receives UDP, unicast on its listening address
 * (loopback unless an admin names another) or multicast on the group and interface an admin names,
 * and for each datagram that is a whole number of 188-byte packets:
 * <ol>
 *   <li>reads it with a {@link TsReader}: the program, the header, the KLV and the picture's size;
 *   <li>decodes each KLV set (ST 0601 and its checksum) and tells the worker;
 *   <li>passes the datagram on unchanged: H.264 and H.265 to the {@code StreamRef}, MPEG-2 to the
 *       {@code ConversionRef} (the worker opens them and hands them over in {@link LinkInbox}).
 * </ol>
 * Any other datagram is dropped whole and counted. A new video type closes what it wrote to until
 * the worker has opened the new stream. The socket is opened here, in the task (rule C6).
 */
final class UdpLinkTask implements ConnectionTask<LinkInbox> {

  /** The most bytes one UDP datagram carries (65 535 less the IP and UDP headers). */
  static final int MAX_PAYLOAD = 65_507;

  /** How long a receive waits before the task looks at its inbox and the clock. */
  private static final int POLL_MILLIS = 100;

  /**
   * The socket's receive buffer, asked for before it binds. A system's default is small (Windows: 64 KB, about
   * 50 datagrams, 0.1 s of a 4 Mbit/s video), and a sender that stalls for half a second and then catches up
   * in a burst (the ESA's replay does) overflows it: the continuity counters then break. 4 MiB holds several
   * seconds. The system may grant less (Linux: {@code net.core.rmem_max}); the task's detail says what it got.
   */
  static final int RECEIVE_BUFFER = 4 * 1024 * 1024;

  private static final long TRAFFIC_NANOS = 1_000_000_000L;
  private static final long INBOX_NANOS = 20_000_000L;

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
      DatagramSocket socket = open(task);
      task.listening(socket.getLocalSocketAddress());
      task.detail("mode", link.where());
      task.detail("receive buffer", socket.getReceiveBufferSize() + " bytes");
      task.send(worker, new TransportMsg.Up(link.key(), run, link.where()));
      new Reading(task, socket, run).loop();
    } catch (IOException e) {
      reason = Reason.of(e);
      if (!(e instanceof SocketException) || !task.stopping()) {
        throw e;
      }
    } finally {
      task.send(worker, new TransportMsg.Down(link.key(), run, reason)); // dropped once stopping: the worker stopped it itself
    }
  }

  /** What one run does with what it receives. Its fields are the task's own: nothing else touches them. */
  private final class Reading implements TsReader.Sink {
    private final TaskContext<LinkInbox> task;
    private final DatagramSocket socket;
    private final UUID run;
    private final TsReader reader = new TsReader();
    private final byte[] buffer = new byte[MAX_PAYLOAD];
    private @Nullable StreamRef stream;
    private @Nullable ConversionRef conversion;
    private @Nullable Program program;
    private Bytes header = Bytes.empty();
    private long datagrams;
    private long bytes;
    private long lastTraffic = System.nanoTime();
    private long lastInbox;

    Reading(TaskContext<LinkInbox> task, DatagramSocket socket, UUID run) {
      this.task = task;
      this.socket = socket;
      this.run = run;
    }

    void loop() throws IOException {
      socket.setSoTimeout(POLL_MILLIS);
      while (!task.stopping()) {
        inbox();
        var packet = new DatagramPacket(buffer, buffer.length);
        try {
          socket.receive(packet);
        } catch (SocketTimeoutException e) {
          traffic();
          continue;
        }
        datagram(packet.getLength());
        traffic();
      }
    }

    /** Looks at the inbox at most every 20 ms: a poll waits at least a millisecond, which a busy stream cannot spare each datagram. */
    private void inbox() {
      long now = System.nanoTime();
      if (now - lastInbox < INBOX_NANOS) {
        return;
      }
      lastInbox = now;
      for (LinkInbox item; (item = task.poll(Duration.ofMillis(1))) != null; ) {
        switch (item) {
          case LinkInbox.Stream m -> {
            if (m.run().equals(run)) {
              stream = m.stream();
              if (header.size() > 0 && writesStream()) {
                m.stream().header(header);
              }
            }
          }
          case LinkInbox.Conversion m -> {
            if (m.run().equals(run)) {
              conversion = m.conversion();
            }
          }
          case LinkInbox.Detach m -> {
            if (m.run().equals(run)) {
              stream = null;
              conversion = null;
            }
          }
        }
      }
    }

    /**
     * Whether this task writes the stream itself: H.264 and H.265 only. The stream of an MPEG-2 video is a
     * conversion's target, and ECore sets its header and start points from the converted output
     * (CR-0044 E2): the plugin writes nothing to it, not even a header with the video type of the input.
     */
    private boolean writesStream() {
      Program p = program;
      return p != null && (p.video().kind() == VideoFormat.Kind.H264 || p.video().kind() == VideoFormat.Kind.H265);
    }

    private void traffic() {
      long now = System.nanoTime();
      if (now - lastTraffic >= TRAFFIC_NANOS) {
        lastTraffic = now;
        task.send(worker, new TransportMsg.Traffic(link.key(), run, datagrams, bytes, reader.noVideo()));
      }
    }

    private void datagram(int length) {
      if (!TsReader.isTransportStream(buffer, 0, length)) {
        task.count("not transport stream", 1);
        return;
      }
      datagrams++;
      bytes += length;
      task.count("datagrams", 1);
      task.count("bytes", length);
      boolean startPoint = reader.feed(buffer, 0, length, this);
      Program chosen = program;
      if (chosen == null) {
        return;
      }
      switch (chosen.video().kind()) {
        case H264, H265 -> {
          var s = stream;
          if (s == null) {
            task.count("stream not open", 1);
            return;
          }
          SendResult result = s.write(Bytes.of(Arrays.copyOf(buffer, length)), startPoint);
          if (result == SendResult.DROPPED) {
            task.count("stream dropped", 1);
          } else if (result == SendResult.CLOSED) {
            stream = null;
            task.count("stream closed", 1);
          }
        }
        case MPEG2 -> {
          var c = conversion;
          if (c == null) {
            task.count("conversion input dropped", 1);
            return;
          }
          if (c.write(Bytes.of(Arrays.copyOf(buffer, length))) != SendResult.ACCEPTED) {
            task.count("conversion input dropped", 1);
          }
        }
        case OTHER -> { } // listed and mapped, not played (ADR-0057 point 7)
      }
    }

    // ------------------------------------------------------------ TsReader.Sink

    @Override
    public void program(Program p) {
      Program before = program;
      if (before == null || !before.sameVideoAs(p)) {
        stream = null; // the worker opens it again for the new video
        conversion = null;
      }
      program = p;
      task.send(worker, new TransportMsg.Chosen(link.key(), run, p.programNumber(), p.videoPid(), p.video().streamType(), p.klvPid()));
    }

    @Override
    public void header(byte[] packets) {
      header = Bytes.of(packets);
      var s = stream;
      if (s != null && writesStream()) {
        s.header(header);
      }
    }

    @Override
    public void klv(byte[] payload) {
      for (St0601.Result r : St0601.read(payload)) {
        if (r.dropped() != null) {
          task.count(r.dropped(), 1);
          continue;
        }
        task.count("KLV sets read", 1);
        if (r.outOfRange() > 0) {
          task.count("value out of range", r.outOfRange());
        }
        if (task.send(worker, new TransportMsg.Telemetry(link.key(), run, Objects.requireNonNull(r.metadata()), Instant.now())) == SendResult.DROPPED) {
          task.count("dropped: worker busy", 1);
        }
      }
    }

    @Override
    public void dropped(String reason) {
      task.count(reason, 1);
    }

    @Override
    public void size(VideoSize size) {
      task.send(worker, new TransportMsg.Size(link.key(), run, size.width(), size.height()));
    }
  }

  // ---------------------------------------------------------------- the socket

  private DatagramSocket open(TaskContext<LinkInbox> task) throws IOException {
    ListenAddress at = link.listen();
    if (link.mode() == Link.Mode.MULTICAST) {
      return openGroup(task, at);
    }
    var socket = task.closeOnStop(new DatagramSocket(null));
    socket.setReceiveBufferSize(RECEIVE_BUFFER);
    socket.bind(new InetSocketAddress(InetAddress.getByName(at.address()), at.port()));
    return socket;
  }

  /**
   * Joins the group on the interface an admin named ({@code ListenAddress.multicast} refuses a link
   * without one). It binds to the group's address where the platform allows it, so that only the
   * group's datagrams arrive; Windows cannot, and binds to the port alone: the socket still gets only
   * what the joined group, and unicast to that port, carries.
   */
  private DatagramSocket openGroup(TaskContext<LinkInbox> task, ListenAddress at) throws IOException {
    InetAddress group = InetAddress.getByName(at.address());
    NetworkInterface network = networkInterface(Objects.requireNonNull(at.networkInterface()));
    var socket = task.closeOnStop(new MulticastSocket(null));
    socket.setReuseAddress(true);
    socket.setReceiveBufferSize(RECEIVE_BUFFER);
    try {
      socket.bind(new InetSocketAddress(group, at.port()));
    } catch (SocketException e) {
      socket.bind(new InetSocketAddress(at.port())); // Windows cannot bind to a group address
    }
    socket.setNetworkInterface(network);
    socket.joinGroup(new InetSocketAddress(group, at.port()), network);
    return socket;
  }

  /** The interface an administrator named, by its name, display name or one of its addresses. */
  private static NetworkInterface networkInterface(String name) throws IOException {
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
