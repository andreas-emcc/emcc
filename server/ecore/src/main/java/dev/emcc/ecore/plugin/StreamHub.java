package dev.emcc.ecore.plugin;

import dev.emcc.ecore.runtime.Cancellable;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.User;
import dev.emcc.sdk.stream.StreamRef;
import dev.emcc.sdk.stream.StreamSpec;
import dev.emcc.sdk.stream.Streams;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.SendResult;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.LockSupport;
import java.util.function.LongSupplier;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Every plugin's streams to its web part (SDK 1.8.0, CR-0044 E1; ADR-0057 point 5): one hub, shared
 * by the plugins, which the edge serves under {@code GET /api/plugins/{pluginId}/stream/{name}}.
 *
 * <p><b>Writing.</b> A plugin's {@link StreamRef#write} never blocks: under the stream's own lock it
 * keeps the start buffer (the chunks since the last start point, at most {@link
 * StreamLimits#startBufferBytes}) and adds the chunk to each viewer's queue. A viewer whose queue
 * would pass {@link StreamLimits#viewerQueueBytes} loses it and resumes at the next start point,
 * header first; each loss is counted. So a slow viewer never slows the plugin or the others.
 *
 * <p><b>Viewers.</b> Each viewer has one virtual thread of ECore's (owner, 2026-11-14, T-208) that
 * takes from its queue and writes to the browser through a {@link StreamSink}, blocking while the
 * browser takes the bytes. A viewer whose write has taken nothing for {@link Streams#VIEWER_STALL}
 * while data waits is closed ({@link #checkStalls}, every {@link #STALL_CHECK}).
 *
 * <p><b>Locks</b> (rule C4): a member's lock and a stream's lock are leaf locks: nothing else is
 * locked or called while one is held, other than the JDK's lock-free queues and {@link
 * LockSupport#unpark}. Closing takes them one after the other, never one inside the other.
 */
public final class StreamHub {

  private static final Logger LOG = LoggerFactory.getLogger(StreamHub.class);

  /** How often the stalled viewers are looked for. */
  static final Duration STALL_CHECK = Duration.ofSeconds(5);

  /** How long a viewer's thread waits for data before it looks whether it has ended. */
  private static final long IDLE_NANOS = TimeUnit.SECONDS.toNanos(1);

  private static final long WINDOW_NANOS = TimeUnit.SECONDS.toNanos(1);

  /** What a viewer's join gets. */
  public sealed interface Join {
    /** In: start the viewer with {@link Viewer#start}, or give it up with {@link Viewer#cancel}. */
    record Joined(Viewer viewer) implements Join {}

    /** {@code 404}: no such plugin, or no open stream of that name. */
    record NotFound() implements Join {}

    /** {@code 403}: the user lacks the stream's permission. */
    record Forbidden() implements Join {}

    /** {@code 503}: past a viewer limit. */
    record Busy(String why) implements Join {}
  }

  /** One stream as the monitor shows it. */
  public record StreamStatus(String plugin, String name, String mediaType, int viewers, long bytesIn, long bytesOut,
      long dropped, long losses, long startBufferBytes) {}

  private final @Nullable WorkerRuntime runtime;
  private final StreamLimits limits;
  private final LongSupplier nanos;
  private final Map<String, Member> members = new ConcurrentHashMap<>();
  private final AtomicInteger viewers = new AtomicInteger();
  private final AtomicLong ids = new AtomicLong();
  private final @Nullable Cancellable stallCheck;

  /** The hub of a running ECore: viewers' threads from the runtime, its stall check on the runtime's scheduler. */
  public StreamHub(WorkerRuntime runtime, StreamLimits limits) {
    this(Objects.requireNonNull(runtime, "runtime"), limits, System::nanoTime, true);
  }

  /** For tests: a clock of its own; without a runtime, {@link Viewer#start} runs nothing and the test drives {@link Viewer#runLoop}. */
  StreamHub(@Nullable WorkerRuntime runtime, StreamLimits limits, LongSupplier nanos, boolean checkStalls) {
    this.runtime = runtime;
    this.limits = Objects.requireNonNull(limits, "limits");
    this.nanos = Objects.requireNonNull(nanos, "nanos");
    this.stallCheck = runtime != null && checkStalls ? scheduleStallCheck(runtime) : null;
  }

  private @Nullable Cancellable scheduleStallCheck(WorkerRuntime on) {
    AtomicReference<@Nullable Cancellable> next = new AtomicReference<>();
    Runnable[] tick = new Runnable[1];
    tick[0] = () -> {
      try {
        checkStalls();
      } catch (RuntimeException e) {
        LOG.warn("Streams: the stall check failed", e);
      }
      next.set(on.schedule(STALL_CHECK, tick[0]));
    };
    next.set(on.schedule(STALL_CHECK, tick[0]));
    return () -> {
      Cancellable c = next.get();
      if (c != null) {
        c.cancel();
      }
    };
  }

  public StreamLimits limits() {
    return limits;
  }

  /** The plugin's streams, for its {@code streams()}; released when it stops ({@link #release}). */
  Member member(String pluginId) {
    Member member = new Member(pluginId);
    members.put(pluginId, member);
    return member;
  }

  /** When the plugin stops: its streams closed (their viewers' responses end), and it opens no more. */
  void release(Member member) {
    List<Stream> open;
    synchronized (member) {
      member.released = true;
      open = List.copyOf(member.streams.values());
    }
    open.forEach(s -> s.close("the plugin stopped"));
    members.remove(member.pluginId, member);
  }

  /** At ECore's stop: the stall check ends; every stream is closed. */
  public void close() {
    if (stallCheck != null) {
      stallCheck.cancel();
    }
    List.copyOf(members.values()).forEach(this::release);
  }

  /**
   * A viewer asks for a stream. The permission is checked here, at every viewer's start; when access
   * by label comes (ADR-0020), so is the clearance for the stream's label (ADR-0057 point 4).
   */
  public Join join(String pluginId, String name, User user) {
    Member member = members.get(pluginId);
    Stream stream = member == null ? null : member.streams.get(name);
    if (stream == null) {
      return new Join.NotFound();
    }
    if (!user.has(stream.permission)) {
      return new Join.Forbidden();
    }
    // ADR-0057 point 4: the viewer's clearance for stream.label() is checked here when access by label comes (ADR-0020).
    return stream.join(user.id());
  }

  /**
   * Ends every viewer's response now, the streams staying open: before the web server's graceful
   * shutdown, which would otherwise wait for these endless responses.
   */
  public void endViewers(String why) {
    for (Member member : members.values()) {
      for (Stream s : member.streams.values()) {
        s.viewersNow().forEach(v -> v.end(why));
      }
    }
  }

  /** Every open stream, by plugin, then by name, for the monitor. */
  public List<StreamStatus> stats() {
    List<StreamStatus> all = new ArrayList<>();
    for (Member member : members.values()) {
      for (Stream s : member.streams.values()) {
        all.add(new StreamStatus(member.pluginId, s.name, s.mediaType, s.viewerCount.get(), s.bytesIn.get(), s.bytesOut.get(),
            s.dropped.get(), s.losses.get(), s.bufferBytes));
      }
    }
    all.sort(Comparator.comparing(StreamStatus::plugin).thenComparing(StreamStatus::name));
    return all;
  }

  /** The viewers now, of every stream. */
  public int viewers() {
    return viewers.get();
  }

  /** Closes every viewer whose write has taken nothing for {@link Streams#VIEWER_STALL} (CR-0044 E1). */
  void checkStalls() {
    long now = nanos.getAsLong();
    long stall = Streams.VIEWER_STALL.toNanos();
    for (Member member : members.values()) {
      for (Stream s : member.streams.values()) {
        for (Viewer v : s.viewersNow()) {
          long since = v.writingSince;
          if (since != 0 && now - since >= stall) {
            v.close("it took nothing for " + Streams.VIEWER_STALL.toSeconds() + " s");
            v.abort();
          }
        }
      }
    }
  }

  /** One plugin's streams. Its lock guards {@link #released} and the opening of a name. */
  final class Member {
    final String pluginId;
    final Map<String, Stream> streams = new ConcurrentHashMap<>();
    boolean released; // guarded by this

    Member(String pluginId) {
      this.pluginId = pluginId;
    }

    StreamRef open(StreamSpec spec) {
      Objects.requireNonNull(spec, "spec");
      Stream stream;
      synchronized (this) {
        if (released) {
          throw new IllegalStateException("plugin " + pluginId + " has stopped");
        }
        if (streams.containsKey(spec.name())) {
          throw new IllegalStateException("a stream named " + spec.name() + " is open");
        }
        if (streams.size() >= Streams.MAX_OPEN) {
          throw new IllegalStateException("plugin " + pluginId + " has " + Streams.MAX_OPEN + " streams open, the most");
        }
        stream = new Stream(this, spec);
        streams.put(spec.name(), stream);
      }
      LOG.info("Stream {}/{} opened ({})", pluginId, spec.name(), spec.mediaType()); // never under the lock
      return stream;
    }
  }

  /** One open stream: the plugin's {@link StreamRef}. Its lock guards the fields marked so. */
  final class Stream implements StreamRef {
    private final HandleId id;
    private final Member member;
    private final String name;
    private final String mediaType;
    private final String permission;
    private volatile SecurityLabel label;
    private final Object lock = new Object();
    // guarded by lock:
    private byte[] header = new byte[0];
    private final ArrayDeque<byte[]> buffer = new ArrayDeque<>();
    /** Whether the buffer begins at a start point (else it waits for the next one). */
    private boolean bufferFromStart;
    private final List<Viewer> viewerList = new ArrayList<>();
    private boolean closed;
    /** SDK 1.8.0 (CR-0044 E2, T-211): the conversion that feeds it, whose output it takes instead of the plugin's writes. */
    private @Nullable Object feeder;
    /** What its feeder does when it closes. */
    private @Nullable Runnable onClose;
    private long windowStart;
    private long windowBytes;
    // read without the lock, by the monitor:
    private volatile long bufferBytes;
    final AtomicInteger viewerCount = new AtomicInteger();
    final AtomicLong bytesIn = new AtomicLong();
    final AtomicLong bytesOut = new AtomicLong();
    final AtomicLong dropped = new AtomicLong();
    final AtomicLong losses = new AtomicLong();

    Stream(Member member, StreamSpec spec) {
      this.id = new HandleId("stream-" + member.pluginId + "-" + spec.name() + "-" + ids.incrementAndGet());
      this.member = member;
      this.name = spec.name();
      this.mediaType = spec.mediaType();
      this.permission = spec.permission();
      this.label = spec.label();
      this.windowStart = nanos.getAsLong();
    }

    @Override
    public HandleId id() {
      return id;
    }

    @Override
    public String name() {
      return name;
    }

    String mediaType() {
      return mediaType;
    }

    String pluginId() {
      return member.pluginId;
    }

    /** The stream's label now, for the clearance check when access by label comes. */
    SecurityLabel label() {
      return label;
    }

    @Override
    public SendResult write(Bytes chunk, boolean startPoint) {
      Objects.requireNonNull(chunk, "chunk");
      if (chunk.isEmpty() || chunk.size() > Streams.MAX_CHUNK) {
        throw new IllegalArgumentException("a chunk is 1 B to " + Streams.MAX_CHUNK + " B: " + chunk.size());
      }
      if (WorkerRuntime.onFencedThread()) {
        return SendResult.DROPPED; // a worker the watchdog restarted: whatever its old thread writes is dropped
      }
      return put(chunk.toArray(), startPoint, null);
    }

    /**
     * T-211: claims the stream for {@code conversion}: from now on only its {@link #feed} reaches the
     * viewers, and the plugin's writes are dropped. {@code onClose} runs (never under the lock) when
     * the stream closes. False if it is closed or another conversion feeds it.
     */
    boolean claim(Object conversion, Runnable onClose) {
      synchronized (lock) {
        if (closed || feeder != null) {
          return false;
        }
        feeder = conversion;
        this.onClose = onClose;
        return true;
      }
    }

    /** T-211: the conversion ended: the plugin's writes reach the viewers again. */
    void unclaim(Object conversion) {
      synchronized (lock) {
        if (feeder == conversion) {
          feeder = null;
          onClose = null;
        }
      }
    }

    /** T-211: a chunk of the conversion's output, which ECore cut at a start point or not. */
    SendResult feed(Object conversion, byte[] data, boolean startPoint) {
      return put(data, startPoint, conversion);
    }

    /** T-211: the header ECore read from the conversion's output (its PAT and PMT). */
    void feedHeader(Object conversion, byte[] newHeader) {
      synchronized (lock) {
        if (!closed && feeder == conversion && newHeader.length <= Streams.MAX_HEADER) {
          header = newHeader;
        }
      }
    }

    /** A write: the plugin's ({@code by} null) or its conversion's. */
    private SendResult put(byte[] data, boolean startPoint, @Nullable Object by) {
      synchronized (lock) {
        if (closed) {
          return SendResult.CLOSED;
        }
        if (feeder != by) { // the plugin's own write to a stream a conversion feeds, or a conversion that no longer does
          dropped.incrementAndGet();
          return SendResult.DROPPED;
        }
        long now = nanos.getAsLong();
        if (now - windowStart >= WINDOW_NANOS) {
          windowStart = now;
          windowBytes = 0;
        }
        if ((windowBytes + data.length) * 8 > Streams.MAX_RATE) {
          dropped.incrementAndGet();
          return SendResult.DROPPED;
        }
        windowBytes += data.length;
        bytesIn.addAndGet(data.length);
        keep(data, startPoint);
        for (Viewer v : viewerList) {
          v.offer(data, startPoint, header);
        }
      }
      return SendResult.ACCEPTED;
    }

    /** The start buffer (guarded by lock). */
    private void keep(byte[] data, boolean startPoint) {
      if (startPoint) {
        buffer.clear();
        bufferBytes = 0;
        bufferFromStart = true;
      }
      if (!bufferFromStart) {
        return;
      }
      if (bufferBytes + data.length > limits.startBufferBytes()) {
        buffer.clear(); // past its bound: empty until the next start point
        bufferBytes = 0;
        bufferFromStart = false;
        return;
      }
      buffer.add(data);
      bufferBytes += data.length;
    }

    @Override
    public void header(Bytes newHeader) {
      Objects.requireNonNull(newHeader, "header");
      if (newHeader.size() > Streams.MAX_HEADER) {
        throw new IllegalArgumentException("a header is at most " + Streams.MAX_HEADER + " B: " + newHeader.size());
      }
      byte[] data = newHeader.toArray();
      synchronized (lock) {
        if (!closed && feeder == null) { // a conversion's output sets its own (T-211)
          header = data;
        }
      }
    }

    @Override
    public void label(SecurityLabel newLabel) {
      Objects.requireNonNull(newLabel, "label");
      synchronized (lock) {
        if (!closed) {
          label = newLabel;
        }
      }
    }

    @Override
    public int viewers() {
      return viewerCount.get();
    }

    @Override
    public void close() {
      close("the plugin closed it");
    }

    void close(String why) {
      List<Viewer> ending;
      Runnable fed;
      synchronized (lock) {
        if (closed) {
          return;
        }
        closed = true;
        buffer.clear();
        bufferBytes = 0;
        ending = List.copyOf(viewerList);
        fed = onClose;
        feeder = null;
        onClose = null;
      }
      member.streams.remove(name, this);
      ending.forEach(v -> v.close(why));
      if (fed != null) {
        fed.run(); // its conversion stops (T-211)
      }
      LOG.info("Stream {}/{} closed: {}", member.pluginId, name, why);
    }

    List<Viewer> viewersNow() {
      synchronized (lock) {
        return List.copyOf(viewerList);
      }
    }

    Join join(String userId) {
      synchronized (lock) {
        if (closed) {
          return new Join.NotFound();
        }
        if (viewerList.size() >= limits.viewersPerStream()) {
          return new Join.Busy("stream " + name + " has " + limits.viewersPerStream() + " viewers, the most");
        }
        int all = viewers.incrementAndGet();
        if (all > limits.viewers()) {
          viewers.decrementAndGet();
          return new Join.Busy("the server has " + limits.viewers() + " stream viewers, the most");
        }
        Viewer viewer = new Viewer(this, userId);
        if (bufferFromStart && !buffer.isEmpty()) {
          long burst = viewer.enqueue(header);
          for (byte[] c : buffer) {
            burst += viewer.enqueue(c);
          }
          viewer.limit = limits.viewerQueueBytes() + burst; // the start may be bigger than a queue; never a loss at once
        } else {
          viewer.waiting = true; // until the next start point
        }
        viewerList.add(viewer);
        viewerCount.set(viewerList.size());
        return new Join.Joined(viewer);
      }
    }

    void leave(Viewer viewer) {
      boolean removed;
      synchronized (lock) {
        removed = viewerList.remove(viewer);
        viewerCount.set(viewerList.size());
      }
      if (removed) {
        viewers.decrementAndGet();
      }
    }

    @Override
    public boolean equals(@Nullable Object other) {
      return other instanceof StreamRef ref && ref.id().equals(id);
    }

    @Override
    public int hashCode() {
      return id.hashCode();
    }

    @Override
    public String toString() {
      return "StreamRef[" + member.pluginId + "/" + name + "]";
    }
  }

  /** One viewer of a stream: its queue, filled by the plugin's writes, emptied by its own thread. */
  public final class Viewer {
    private final Stream stream;
    private final String userId;
    private final long number = ids.incrementAndGet();
    private final ConcurrentLinkedQueue<byte[]> queue = new ConcurrentLinkedQueue<>();
    private final AtomicLong queued = new AtomicLong();
    private final AtomicReference<@Nullable String> ended = new AtomicReference<>();
    // guarded by the stream's lock:
    boolean waiting;
    long limit = limits.viewerQueueBytes();
    volatile long lossCount;
    // its thread's:
    private volatile @Nullable Thread thread;
    private volatile @Nullable StreamSink sink;
    /** When its write began, while one blocks; 0 otherwise. */
    volatile long writingSince;

    Viewer(Stream stream, String userId) {
      this.stream = stream;
      this.userId = userId;
    }

    public String mediaType() {
      return stream.mediaType;
    }

    /** Adds to the queue; the bytes added. */
    long enqueue(byte[] data) {
      if (data.length == 0) {
        return 0;
      }
      queue.add(data);
      queued.addAndGet(data.length);
      return data.length;
    }

    /** A chunk of the stream (under the stream's lock). */
    void offer(byte[] data, boolean startPoint, byte[] header) {
      if (ended.get() != null) {
        return;
      }
      if (waiting) {
        if (!startPoint) {
          return;
        }
        waiting = false;
        enqueue(header);
      } else if (queued.get() + data.length > limit) {
        drop(); // too slow: resumes at a start point, header first, never with a cut picture
        lossCount++;
        stream.losses.incrementAndGet();
        limit = limits.viewerQueueBytes();
        if (!startPoint) {
          waiting = true;
          return;
        }
        enqueue(header);
      }
      enqueue(data);
      Thread t = thread;
      if (t != null) {
        LockSupport.unpark(t);
      }
    }

    private void drop() {
      for (byte[] c = queue.poll(); c != null; c = queue.poll()) {
        queued.addAndGet(-c.length);
      }
    }

    /** Starts its thread, which writes to {@code to} until the viewer ends. */
    public void start(StreamSink to) {
      sink = Objects.requireNonNull(to, "to");
      LOG.info("Stream {}/{}: viewer {} started, user {}", stream.pluginId(), stream.name, number, userId);
      if (runtime != null) {
        thread = runtime.startLoop("stream-viewer-" + stream.pluginId() + "-" + stream.name + "-" + number, null, this::runLoop);
      }
    }

    /** Gives up a joined viewer that was never started, e.g. when its response failed. */
    public void cancel() {
      close("its response could not start");
      stream.leave(this);
    }

    /** Ends it from outside, e.g. when the login session ends: the reason kept, its response ended at once. */
    public void end(String why) {
      close(why);
      abort();
    }

    /** Ends the viewer; its thread ends its response. The first reason is kept. */
    void close(String why) {
      if (ended.compareAndSet(null, why)) {
        Thread t = thread;
        if (t != null) {
          LockSupport.unpark(t);
        }
      }
    }

    void abort() {
      StreamSink s = sink;
      if (s != null) {
        s.abort();
      }
      Thread t = thread;
      if (t != null) {
        t.interrupt();
      }
    }

    /** Its thread: writes what is queued, flushes when the queue is empty, until it ends. */
    void runLoop() {
      StreamSink to = Objects.requireNonNull(sink, "sink");
      if (thread == null) {
        thread = Thread.currentThread(); // a test drives it on its own thread
      }
      boolean unflushed = false;
      try {
        while (ended.get() == null) {
          byte[] c = queue.poll();
          if (c == null) {
            if (unflushed) {
              to.flush();
              unflushed = false;
              continue;
            }
            LockSupport.parkNanos(this, IDLE_NANOS);
            continue;
          }
          queued.addAndGet(-c.length);
          writingSince = Math.max(1, nanos.getAsLong());
          to.write(c);
          writingSince = 0;
          stream.bytesOut.addAndGet(c.length);
          unflushed = true;
        }
      } catch (Exception e) {
        close("the browser went away (" + e.getClass().getSimpleName() + ")"); // unless it had ended already: the first reason stays
      } finally {
        writingSince = 0;
        stream.leave(this);
        to.end();
        LOG.info("Stream {}/{}: viewer {} ended, user {}: {} ({} losses)", stream.pluginId(), stream.name, number, userId,
            ended.get(), lossCount);
      }
    }

    /** Why it ended; null while it runs. */
    @Nullable String endReason() {
      return ended.get();
    }

    long queuedBytes() {
      return queued.get();
    }

    /** The chunks waiting, oldest first, for tests. */
    List<byte[]> queuedNow() {
      return List.copyOf(queue);
    }
  }
}
