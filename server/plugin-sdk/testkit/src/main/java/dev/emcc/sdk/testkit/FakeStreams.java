package dev.emcc.sdk.testkit;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.stream.StreamRef;
import dev.emcc.sdk.stream.StreamSpec;
import dev.emcc.sdk.stream.Streams;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.SendResult;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.8.0 (CR-0044 E1): the test kit's streams, as ECore keeps them. Each stream records its
 * header, chunks, start points and label; {@link FakeStream#join()} is a viewer that gets what ECore
 * would send it: the header and the chunks since the last start point, then the live chunks, or,
 * before any start point, nothing until the next one.
 *
 * <pre>{@code
 * FakeStreams.FakeStream video = ctx.stream("link-1");
 * assertThat(video.startPoints()).containsExactly(0, 12);
 * FakeStreams.FakeViewer viewer = video.join();
 * assertThat(viewer.bytes()).startsWith(pat);
 * }</pre>
 *
 * <p>Thread-safe: connection tasks write from their own threads. The fake does not measure {@link
 * Streams#MAX_RATE}, has no viewer queues and so loses nothing for a slow viewer, and serves no
 * HTTP: the stream endpoint is ECore's. It keeps every chunk written, for the test to read, so a
 * long soak test grows with what it writes.
 */
public final class FakeStreams implements Streams {

  private final FakePluginContext ctx;
  private final int max;
  private final Map<String, FakeStream> open = new LinkedHashMap<>();
  private final List<FakeStream> all = new ArrayList<>();

  FakeStreams(FakePluginContext ctx, int max) {
    this.ctx = ctx;
    this.max = max;
  }

  @Override
  public synchronized FakeStream open(StreamSpec spec) {
    Objects.requireNonNull(spec, "spec");
    if (open.containsKey(spec.name())) {
      throw new IllegalStateException("a stream named " + spec.name() + " is open");
    }
    if (open.size() >= max) {
      throw new IllegalStateException("the plugin has " + max + " streams open (Streams.MAX_OPEN)");
    }
    var stream = new FakeStream(this, spec, new HandleId(ctx.nextId("stream-" + spec.name())));
    open.put(spec.name(), stream);
    all.add(stream);
    return stream;
  }

  /** The latest stream opened with {@code name}, open or closed. */
  public synchronized FakeStream stream(String name) {
    for (int i = all.size() - 1; i >= 0; i--) {
      if (all.get(i).name().equals(name)) {
        return all.get(i);
      }
    }
    throw new IllegalArgumentException("no stream named " + name + " was opened");
  }

  /** Every stream opened, in order. */
  public synchronized List<FakeStream> streams() {
    return List.copyOf(all);
  }

  /** The streams open now. */
  public synchronized List<FakeStream> openStreams() {
    return List.copyOf(open.values());
  }

  /** Closes every open stream, as ECore does when the plugin stops. */
  public void closeAll() {
    for (FakeStream s : openStreams()) {
      s.close();
    }
  }

  private synchronized void closed(FakeStream stream) {
    open.remove(stream.name(), stream);
  }

  /** A chunk as the plugin (or a conversion) wrote it. */
  public record Chunk(Bytes bytes, boolean startPoint) {}

  /** An open or closed stream of the test kit. Equal by id. */
  public static final class FakeStream implements StreamRef {
    private final FakeStreams owner;
    private final StreamSpec spec;
    private final HandleId id;
    private final List<Chunk> chunks = new ArrayList<>();
    private final List<FakeViewer> viewers = new ArrayList<>();
    private Bytes header = Bytes.empty();
    private SecurityLabel label;
    private int lastStart = -1;
    private boolean closed;
    private int dropped;
    private FakeConversions.@Nullable FakeConversion conversion;

    FakeStream(FakeStreams owner, StreamSpec spec, HandleId id) {
      this.owner = owner;
      this.spec = spec;
      this.id = id;
      this.label = spec.label();
    }

    @Override
    public HandleId id() {
      return id;
    }

    @Override
    public String name() {
      return spec.name();
    }

    FakeStreams owner() {
      return owner;
    }

    /** The spec it was opened with. */
    public StreamSpec spec() {
      return spec;
    }

    @Override
    public SendResult write(Bytes chunk, boolean startPoint) {
      check(chunk);
      synchronized (this) {
        if (closed) {
          return SendResult.CLOSED;
        }
        if (conversion != null && conversion.running()) {
          dropped++;
          return SendResult.DROPPED;
        }
        add(chunk, startPoint);
        return SendResult.ACCEPTED;
      }
    }

    /** A conversion's output, which takes the place of the plugin's writes while it runs. */
    synchronized void writeFromConversion(Bytes chunk, boolean startPoint) {
      if (!closed) {
        add(chunk, startPoint);
      }
    }

    private void add(Bytes chunk, boolean startPoint) {
      chunks.add(new Chunk(chunk, startPoint));
      if (startPoint) {
        lastStart = chunks.size() - 1;
      }
      for (FakeViewer v : viewers) {
        v.offer(chunk, startPoint, header);
      }
    }

    @Override
    public synchronized void header(Bytes header) {
      Objects.requireNonNull(header, "header");
      if (header.size() > MAX_HEADER) {
        throw new IllegalArgumentException("a stream's header is at most " + MAX_HEADER + " bytes: " + header.size());
      }
      if (!closed) {
        this.header = header;
      }
    }

    @Override
    public synchronized void label(SecurityLabel label) {
      Objects.requireNonNull(label, "label");
      if (!closed) {
        this.label = label;
      }
    }

    @Override
    public synchronized int viewers() {
      if (closed) {
        return 0;
      }
      return (int) viewers.stream().filter(v -> !v.ended).count();
    }

    @Override
    public void close() {
      FakeConversions.@Nullable FakeConversion c;
      synchronized (this) {
        if (closed) {
          return;
        }
        closed = true;
        viewers.forEach(v -> v.ended = true);
        c = conversion;
      }
      owner.closed(this);
      if (c != null) {
        c.targetClosed();
      }
    }

    /** A viewer that joins now, as a browser opening the stream's URL. */
    public synchronized FakeViewer join() {
      var v = new FakeViewer();
      if (closed) {
        v.ended = true;
      } else if (lastStart >= 0) {
        v.start(header);
        for (int i = lastStart; i < chunks.size(); i++) {
          v.received.add(chunks.get(i).bytes());
        }
      }
      viewers.add(v);
      return v;
    }

    /** Every chunk written, in order. */
    public synchronized List<Chunk> chunks() {
      return List.copyOf(chunks);
    }

    /** The indexes in {@link #chunks()} of the start points. */
    public synchronized List<Integer> startPoints() {
      var at = new ArrayList<Integer>();
      for (int i = 0; i < chunks.size(); i++) {
        if (chunks.get(i).startPoint()) {
          at.add(i);
        }
      }
      return at;
    }

    /** The plugin's writes dropped because a conversion wrote to it. */
    public synchronized int dropped() {
      return dropped;
    }

    public synchronized Bytes header() {
      return header;
    }

    public synchronized SecurityLabel label() {
      return label;
    }

    public synchronized boolean isClosed() {
      return closed;
    }

    synchronized void conversion(FakeConversions.@Nullable FakeConversion conversion) {
      this.conversion = conversion;
    }

    synchronized FakeConversions.@Nullable FakeConversion conversion() {
      return conversion;
    }

    @Override
    public boolean equals(@Nullable Object other) {
      return other instanceof FakeStream s && s.id.equals(id);
    }

    @Override
    public int hashCode() {
      return id.hashCode();
    }

    @Override
    public String toString() {
      return "FakeStream[" + spec.name() + "]";
    }
  }

  /** A viewer of a {@link FakeStream}: what ECore would have sent it. */
  public static final class FakeViewer {
    // Written under its stream's lock, read by the test: safe to read at once.
    private final List<Bytes> received = new java.util.concurrent.CopyOnWriteArrayList<>();
    private volatile boolean started;
    private volatile boolean ended;

    private void start(Bytes header) {
      started = true;
      if (!header.isEmpty()) {
        received.add(header);
      }
    }

    private void offer(Bytes chunk, boolean startPoint, Bytes header) {
      if (ended) {
        return;
      }
      if (!started && startPoint) {
        start(header);
      }
      if (started) {
        received.add(chunk);
      }
    }

    /** Whether it has started, at a start point. */
    public boolean started() {
      return started;
    }

    /** Leaves, as a browser closing the window; {@code viewers()} drops. */
    public void leave() {
      ended = true;
    }

    /** Whether its response has ended (it left, or the stream closed). */
    public boolean ended() {
      return ended;
    }

    /** What it received, in order: the header (if any), then the chunks. */
    public List<Bytes> received() {
      return List.copyOf(received);
    }

    /** {@link #received()} as one byte string. */
    public Bytes bytes() {
      var out = new ByteArrayOutputStream();
      for (Bytes b : received) {
        out.writeBytes(b.toArray());
      }
      return Bytes.of(out.toByteArray());
    }
  }

  static void check(Bytes chunk) {
    Objects.requireNonNull(chunk, "chunk");
    if (chunk.isEmpty() || chunk.size() > MAX_CHUNK) {
      throw new IllegalArgumentException("a chunk is 1.." + MAX_CHUNK + " bytes: " + chunk.size());
    }
  }
}
