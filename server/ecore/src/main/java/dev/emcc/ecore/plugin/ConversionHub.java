package dev.emcc.ecore.plugin;

import dev.emcc.ecore.runtime.Cancellable;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.stream.ConversionEvent;
import dev.emcc.sdk.stream.ConversionEvent.Failure;
import dev.emcc.sdk.stream.ConversionRef;
import dev.emcc.sdk.stream.ConversionSpec;
import dev.emcc.sdk.stream.Conversions;
import dev.emcc.sdk.stream.EncodedPicture;
import dev.emcc.sdk.stream.EncoderRef;
import dev.emcc.sdk.stream.EncoderSpec;
import dev.emcc.sdk.stream.RawPicture;
import dev.emcc.sdk.compute.ComputeRef;
import dev.emcc.sdk.stream.StreamRef;
import dev.emcc.sdk.stream.Streams;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
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
import java.util.function.Function;
import java.util.function.LongSupplier;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * ECore's conversion service (SDK 1.8.0 part E, CR-0044 E2, ADR-0057 point 8, CR-0045; T-211): one
 * for all plugins. Each conversion runs the shipped ffmpeg as a process of its own, ECore's, with
 * fixed arguments and pipes only (the plugin never starts a program): the plugin's input goes to its
 * standard input, and its output, read as untrusted bytes ({@link TsOutput}), goes straight into the
 * target stream with the header and the start points ECore finds in it.
 *
 * <ul>
 *   <li><b>Slots:</b> {@link ConversionLimits#max()} run at once; the others wait, first come first
 *       served across the plugins, and their input is dropped meanwhile.
 *   <li><b>Threads:</b> per running conversion three virtual threads of the runtime: one writes the
 *       queued input to the process, one reads its output, one drains its error output (its last
 *       200 printable characters are a failure's detail). No worker ever waits for the process.
 *   <li><b>Locks</b> (rule C4): the slots' lock is a leaf: it holds only its counter and queue. A
 *       conversion's lock is held while its state changes and its event is queued, so its events
 *       stay in order; queuing takes the target's mailbox lock, the runtime's own leaf, and runs no
 *       plugin code ({@code deliverAlways} takes a supplier). A member's lock may take a stream's
 *       ({@code claim}), the one allowed order: the stream's lock is a leaf and never takes a hub's
 *       lock. No other lock is taken while one is held.
 *   <li><b>Timers:</b> once a second on the runtime's scheduler: no output {@link
 *       Conversions#START_TIMEOUT} after the first input, or none for {@link
 *       Conversions#STALL_TIMEOUT} while input came, fails it; a stop kills the process {@link
 *       Conversions#STOP_GRACE} after closing its input.
 * </ul>
 *
 * <p><b>Encoders</b> (SDK 1.9.0, CR-0050 point 1, ADR-0059 point 7; M9 C10): the same service, slots, timers and
 * process rules, with raw I420 pictures in ({@link EncoderRef#write}, at most {@link EncoderRef#MAX_WAITING} waiting)
 * and the H.264 access units ({@link AccessUnits}) back into the plugin's compute task, each as an {@link
 * EncodedPicture} with the time of its picture, tagged BT.709 limited range ({@link #encoderCommand}).
 */
public final class ConversionHub {

  private static final Logger LOG = LoggerFactory.getLogger(ConversionHub.class);

  /** How often the timers are checked. */
  static final Duration CHECK = Duration.ofSeconds(1);
  /** How many ended conversions a plugin's monitor keeps. */
  static final int RECENT = 10;
  private static final int DETAIL = 200;
  private static final long WINDOW_NANOS = TimeUnit.SECONDS.toNanos(1);

  /** Starts the converter's process (tests: a fake one). */
  @FunctionalInterface
  interface Launcher {
    /** Starts {@code command} in {@code folder}, the process's own empty working folder, with an empty environment. */
    Process start(List<String> command, Path folder) throws IOException;
  }

  /** The converter's largest single memory block and most input streams (SRA's M9-S3; owner, fixed, 2026-11-17). */
  static final long MAX_ALLOC = 64L * 1024 * 1024;
  static final int MAX_STREAMS = 16;

  /**
   * A conversion as the monitor shows it. {@code cpuMillis} is -1 where the platform does not say.
   *
   * @param stream the target stream's name, or the encoder's (SDK 1.9.0)
   * @param kind {@code conversion} (MPEG-2 into a stream) or {@code encoder} (raw pictures into a compute task)
   * @param dropped input refused: chunks, or pictures
   * @param lostOutputs SDK 1.9.0: encoded pictures the compute task's inbox did not take; 0 for a conversion
   */
  public record ConversionStatus(String plugin, String stream, String kind, String state, long bytesIn, long bytesOut, long dropped,
      long lostOutputs, long cpuMillis, String detail) {}

  private enum State { WAITING, RUNNING, STOPPING, STOPPED, FAILED }

  private final WorkerRuntime runtime;
  private final ConversionLimits limits;
  private final Launcher launcher;
  private final Clock clock;
  private final LongSupplier nanos;
  private final Map<String, Member> members = new ConcurrentHashMap<>();
  private final Object slots = new Object();
  private int running; // guarded by slots
  private final Deque<Conversion<?>> waiting = new ArrayDeque<>(); // guarded by slots
  private final AtomicLong ids = new AtomicLong();
  private final @Nullable Cancellable timer;
  /** What the start check found wrong with the converter, or {@code null} (M9 C5). */
  private final @Nullable String unavailable;
  /** SDK 1.9.0: what it found wrong for encoders, or {@code null} (the MCA's B4). */
  private final @Nullable String encoderUnavailable;

  public ConversionHub(WorkerRuntime runtime, ConversionLimits limits) {
    this(runtime, limits, ConversionHub::launch, ConverterCheck::run, Clock.systemUTC(), System::nanoTime, true);
  }

  ConversionHub(WorkerRuntime runtime, ConversionLimits limits, Launcher launcher, Clock clock, LongSupplier nanos,
      boolean checkTimers) {
    this(runtime, limits, launcher, null, clock, nanos, checkTimers);
  }

  /** @param checker runs the start check's commands; {@code null}: no check (tests of the rest) */
  ConversionHub(WorkerRuntime runtime, ConversionLimits limits, Launcher launcher, ConverterCheck.@Nullable Runner checker,
      Clock clock, LongSupplier nanos, boolean checkTimers) {
    this.runtime = Objects.requireNonNull(runtime, "runtime");
    this.limits = Objects.requireNonNull(limits, "limits");
    this.launcher = Objects.requireNonNull(launcher, "launcher");
    this.clock = Objects.requireNonNull(clock, "clock");
    this.nanos = Objects.requireNonNull(nanos, "nanos");
    ConverterCheck.@Nullable Result checked = checker == null ? null : checkConverter(checker);
    this.unavailable = checked == null ? null : checked.problem();
    this.encoderUnavailable = checked == null ? null : checked.encoderProblem();
    this.timer = checkTimers ? scheduleChecks(runtime) : null;
  }

  /** The start check (M9 C5): logs the converter and its version, or why conversions or encoders will be unavailable. */
  private ConverterCheck.@Nullable Result checkConverter(ConverterCheck.Runner checker) {
    if (!Files.isRegularFile(limits.ffmpeg())) {
      LOG.warn("No converter at {}: every conversion fails as unavailable (emc2.conversions.ffmpeg)", limits.ffmpeg().toAbsolutePath());
      return null; // the start's own check says so, as before
    }
    ConverterCheck.Result r = ConverterCheck.check(limits.ffmpeg(), checker);
    if (r.problem() != null) {
      LOG.warn("Conversions unavailable: {}", r.problem());
    } else {
      LOG.info("Converter {}: {}", limits.ffmpeg().toAbsolutePath(), r.version());
    }
    if (r.encoderProblem() != null && !r.encoderProblem().equals(r.problem())) {
      LOG.warn("Encoders unavailable: {}", r.encoderProblem());
    }
    return r;
  }

  /**
   * The real launch: an empty environment (SRA's M9-S3; h264_mf needs none, measured) and the process's own folder.
   */
  static Process launch(List<String> command, Path folder) throws IOException {
    ProcessBuilder pb = new ProcessBuilder(command).directory(folder.toFile());
    pb.environment().clear();
    return pb.start();
  }

  private Cancellable scheduleChecks(WorkerRuntime on) {
    AtomicReference<@Nullable Cancellable> next = new AtomicReference<>();
    Runnable[] tick = new Runnable[1];
    tick[0] = () -> {
      try {
        checkTimers();
      } catch (RuntimeException e) {
        LOG.warn("Conversions: the timer check failed", e);
      }
      next.set(on.schedule(CHECK, tick[0]));
    };
    next.set(on.schedule(CHECK, tick[0]));
    return () -> {
      Cancellable c = next.get();
      if (c != null) {
        c.cancel();
      }
    };
  }

  public ConversionLimits limits() {
    return limits;
  }

  /**
   * The command for a spec: the converter, then fixed arguments, pipes only (owner C2; Windows one thread, Linux nice).
   * {@code h264_mf} is Windows' own H.264 encoder (CR-0045, owner VN A: Windows x64 only); the Linux release (M9)
   * chooses its encoder again, and until then a conversion there fails as {@code EXITED} with ffmpeg's words.
   */
  List<String> command(ConversionSpec spec) {
    List<String> command = new ArrayList<>();
    if (!ConversionLimits.windows()) {
      command.addAll(List.of("/usr/bin/nice", "-n", "10")); // by its full path: the environment is empty
    }
    command.add(limits.ffmpeg().toAbsolutePath().toString());
    // A live input: probed briefly (else the first output comes after about 9 s, near START_TIMEOUT), and the muxer
    // does not hold the video back for a sparse KLV stream (else up to 10 s); both found on S9's sample (T-211)
    command.addAll(List.of("-hide_banner", "-loglevel", "error",
        // no single block above 64 MiB and at most 16 input streams, whatever the input claims (SRA's M9-S3)
        "-max_alloc", Long.toString(MAX_ALLOC),
        "-copyts", "-threads", "1",
        "-probesize", "500000", "-analyzeduration", "1000000", "-max_streams", Integer.toString(MAX_STREAMS),
        // the decoder trusts the picture size the input claims: a larger one ends the process, not takes gigabytes (SRA, M8)
        "-max_pixels", Long.toString(limits.maxPixels()),
        "-f", "mpegts", "-i", "pipe:0",
        "-map", "0:v:0", "-map", "0:d?",
        "-c:v", "h264_mf", "-b:v", Long.toString(spec.bitrate()),
        "-force_key_frames", "expr:gte(t,n_forced*" + spec.keyframeSeconds() + ")", "-bf", "0", "-threads", "1",
        "-c:d", "copy", "-an", "-muxdelay", "0", "-max_interleave_delta", "500000", "-flush_packets", "1",
        "-f", "mpegts", "pipe:1"));
    return List.copyOf(command);
  }

  /**
   * SDK 1.9.0 (CR-0050 point 1; M9 C10): an encoder's command: raw I420 pictures of the spec's size and rate in, one
   * H.264 Annex B elementary stream out, pipes only. {@code h264_mf} as for conversions, without B-frames, its GOP from
   * the keyframe interval. Tagged <b>BT.709, limited range</b> (the MCA's order, PCA-fmv's finding) twice: the encoder's
   * colour options, and the {@code h264_metadata} filter writing the same into the SPS's VUI whatever the encoder writes,
   * which also puts an access unit delimiter before every picture ({@link AccessUnits} splits on them; owner, C10).
   */
  List<String> encoderCommand(EncoderSpec spec) {
    List<String> command = new ArrayList<>();
    if (!ConversionLimits.windows()) {
      command.addAll(List.of("/usr/bin/nice", "-n", "10"));
    }
    command.add(limits.ffmpeg().toAbsolutePath().toString());
    command.addAll(List.of("-hide_banner", "-loglevel", "error",
        "-max_alloc", Long.toString(MAX_ALLOC), "-threads", "1",
        "-f", "rawvideo", "-pix_fmt", "yuv420p", "-video_size", spec.width() + "x" + spec.height(),
        "-framerate", Integer.toString(spec.frameRate()),
        // tagged on the input too: untagged, ffmpeg puts a scaler in (YUV to RGB to YUV for every picture; the MCA's B4)
        "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-i", "pipe:0",
        // one output picture per input picture, never duplicated or dropped: each unit takes its picture's time in order
        "-an", "-fps_mode", "passthrough", "-c:v", "h264_mf", "-b:v", Long.toString(spec.bitrate()),
        "-force_key_frames", "expr:gte(t,n_forced*" + spec.keyframeSeconds() + ")", "-bf", "0", "-threads", "1",
        "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        // h264_mf ignores the colour options in its SPS: only this writes the VUI; it writes one AUD per picture itself
        // (aud=insert gave two, every second unit empty; the MCA's B4)
        "-bsf:v", "h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1",
        "-flush_packets", "1", "-f", "h264", "pipe:1"));
    return List.copyOf(command);
  }

  /** What a conversion does with its process: MPEG-2 into a stream (1.8.0), or raw pictures into H.264 (1.9.0). */
  private abstract static class Job {
    /** Its key among its plugin's conversions (the running ones, the retry minute, the restart time). */
    abstract String key();

    /** Its name in its events and the Monitor. */
    abstract String name();

    abstract String kind();

    /** Takes {@code n} bytes of the process's output, untrusted. */
    abstract void output(byte[] data, int n) throws IOException;

    /** The process's output has ended. */
    void outputEnded() {}

    /** A picture was written to the process (encoders). */
    void written(Instant time) {}

    long lost() {
      return 0;
    }
  }

  /** MPEG-2 in, MPEG-TS with H.264 into the plugin's stream (1.8.0). */
  private final class StreamJob extends Job {
    final ConversionSpec spec;
    final StreamHub.Stream stream;
    private @Nullable TsOutput ts;

    StreamJob(ConversionSpec spec, StreamHub.Stream stream) {
      this.spec = spec;
      this.stream = stream;
    }

    @Override
    String key() {
      return stream.name();
    }

    @Override
    String name() {
      return stream.name();
    }

    @Override
    String kind() {
      return "conversion";
    }

    void attach(Conversion<?> owner) {
      ts = new TsOutput(new TsOutput.Sink() {
        @Override
        public void header(byte[] header) {
          stream.feedHeader(owner, header);
        }

        @Override
        public void chunk(byte[] data, boolean startPoint) {
          stream.feed(owner, data, startPoint);
        }
      });
    }

    @Override
    void output(byte[] data, int n) {
      Objects.requireNonNull(ts).accept(data, n);
    }
  }

  /** Raw I420 pictures in, H.264 access units back into the plugin's compute task (1.9.0). */
  private final class EncoderJob<I extends dev.emcc.sdk.Message> extends Job {
    final EncoderSpec spec;
    private final ComputeRef<I> output;
    private final Function<EncodedPicture, ? extends I> toItem;
    private final AccessUnits units = new AccessUnits(this::unit);
    /**
     * The times of the pictures written, in order; each access unit takes the next (no B-frames). Bounded in practice:
     * the pictures waiting (at most {@link EncoderRef#MAX_WAITING}) and those inside the encoder.
     */
    private final ConcurrentLinkedQueue<Instant> times = new ConcurrentLinkedQueue<>();
    private volatile @Nullable Instant lastTime;
    private long sequence; // the reader thread's only
    private final AtomicLong lost = new AtomicLong();
    private @Nullable Conversion<?> owner;

    EncoderJob(EncoderSpec spec, ComputeRef<I> output, Function<EncodedPicture, ? extends I> toItem) {
      this.spec = spec;
      this.output = output;
      this.toItem = toItem;
    }

    @Override
    String key() {
      return "encoder:" + spec.name();
    }

    @Override
    String name() {
      return spec.name();
    }

    @Override
    String kind() {
      return "encoder";
    }

    @Override
    void output(byte[] data, int n) throws IOException {
      units.accept(data, n);
    }

    @Override
    void outputEnded() {
      units.finish();
    }

    @Override
    void written(Instant time) {
      times.add(time);
    }

    @Override
    long lost() {
      return lost.get();
    }

    /** One access unit, to the task's inbox; never blocks. The plugin's mapper runs here, guarded. */
    private void unit(byte[] unit, boolean keyframe) {
      Instant time = times.poll();
      if (time == null) {
        time = lastTime != null ? lastTime : clock.instant();
      }
      lastTime = time;
      EncodedPicture picture = new EncodedPicture(sequence++, time, keyframe, Bytes.of(unit));
      SendResult result;
      try {
        result = output.post(Objects.requireNonNull(toItem.apply(picture), "the encoder's item"));
      } catch (RuntimeException | StackOverflowError e) { // the plugin's mapper: never ends ECore's reader
        lost.incrementAndGet();
        LOG.warn("Encoder {}/{}: the plugin's item for an encoded picture failed: {}", owner == null ? "?" : owner.member.pluginId,
            spec.name(), printable(String.valueOf(e)));
        return;
      }
      if (result != SendResult.ACCEPTED) {
        lost.incrementAndGet();
      }
      if (result == SendResult.CLOSED && owner != null) {
        owner.stop("output task ended", false);
      }
    }
  }

  /** A plugin's part of the service, made when it starts. */
  Member member(String pluginId) {
    return members.computeIfAbsent(pluginId, Member::new);
  }

  /** When the plugin stops: its conversions stop. */
  void release(Member member) {
    List<Conversion<?>> active;
    synchronized (member) {
      member.released = true;
      active = List.copyOf(member.active.values());
    }
    member.launchedAt.clear(); // its restart times go with it
    active.forEach(c -> c.stop("plugin stopped", false));
  }

  /** At ECore's stop: every conversion ends at once (no grace: the processes are killed). */
  public void close() {
    if (timer != null) {
      timer.cancel();
    }
    for (Member m : members.values()) {
      List<Conversion<?>> active;
      synchronized (m) {
        m.released = true;
        active = List.copyOf(m.active.values());
      }
      active.forEach(c -> {
        c.stop("plugin stopped", true);
        c.killNow(); // also one that was stopping already: no scheduled kill runs after the runtime closes
      });
    }
  }

  /** Every plugin's conversions, running and recently ended, for the monitor. Waits for nothing. */
  public List<ConversionStatus> stats(String pluginId) {
    Member m = members.get(pluginId);
    if (m == null) {
      return List.of();
    }
    List<Conversion<?>> listed = new ArrayList<>();
    synchronized (m) { // copied under the member's lock; each one asked outside it (no lock under another)
      listed.addAll(m.active.values());
      listed.addAll(m.recent);
    }
    return listed.stream().map(Conversion::status).toList();
  }

  /** The timers: START and STALLED (normally once a second; tests call it). */
  void checkTimers() {
    try {
      startDue();
    } catch (RuntimeException e) { // the timers below run all the same
      LOG.warn("Conversions: starting a waiting one failed", e);
    }
    long now = nanos.getAsLong();
    for (Member m : members.values()) {
      List<Conversion<?>> active;
      synchronized (m) {
        active = List.copyOf(m.active.values());
      }
      for (Conversion<?> c : active) {
        c.checkTimers(now);
      }
    }
  }

  /** A slot freed: the first waiting conversion that may launch, if any, runs. */
  private void slotFreed() {
    Conversion<?> next;
    long now = nanos.getAsLong();
    synchronized (slots) {
      next = firstDue(now);
      if (next == null) {
        running--;
      }
    }
    if (next != null) {
      next.run();
    }
  }

  /** The timer's part: free slots go to waiting conversions whose restart time is over. */
  private void startDue() {
    long now = nanos.getAsLong();
    while (true) {
      Conversion<?> next;
      synchronized (slots) {
        if (running >= limits.max()) {
          return;
        }
        next = firstDue(now);
        if (next == null) {
          return;
        }
        running++;
      }
      next.run();
    }
  }

  /** Under the slots' lock: removes and gives the first waiting one that may launch now (first come, first served). */
  private @Nullable Conversion<?> firstDue(long now) {
    for (var it = waiting.iterator(); it.hasNext(); ) {
      Conversion<?> c = it.next();
      if (!c.member.tooSoon(c.job.key(), now)) { // a ConcurrentHashMap read: no lock under this one
        it.remove();
        return c;
      }
    }
    return null;
  }

  /** A plugin's part: its conversions and when each target last failed (the retry minute). */
  final class Member implements Conversions {
    final String pluginId;
    final Map<String, Conversion<?>> active = new ConcurrentHashMap<>();
    final Deque<Conversion<?>> recent = new ArrayDeque<>(); // guarded by this
    final Map<String, Instant> failedAt = new ConcurrentHashMap<>();
    /** When a converter was last launched for each target stream (nanos), for the restart time (M9 C5). */
    final Map<String, Long> launchedAt = new ConcurrentHashMap<>();
    boolean released; // guarded by this

    Member(String pluginId) {
      this.pluginId = pluginId;
    }

    @Override
    public <M extends dev.emcc.sdk.Message> ConversionRef start(ConversionSpec spec, dev.emcc.sdk.worker.WorkerRef<M> events,
        Function<ConversionEvent, ? extends M> toMessage) {
      Objects.requireNonNull(events, "events");
      return start(spec, PluginWorkers.handleOf(events), toMessage);
    }

    /** As {@link #start(ConversionSpec, dev.emcc.sdk.worker.WorkerRef, Function)}, with ECore's handle of the worker (tests). */
    <M> ConversionRef start(ConversionSpec spec, WorkerHandle<M> target, Function<ConversionEvent, ? extends M> toMessage) {
      Objects.requireNonNull(spec, "spec");
      Objects.requireNonNull(target, "target");
      Objects.requireNonNull(toMessage, "toMessage");
      if (!(spec.target() instanceof StreamHub.Stream stream) || !stream.pluginId().equals(pluginId)) {
        throw new IllegalArgumentException("a conversion's target is one of this plugin's own streams");
      }
      StreamJob job = new StreamJob(spec, stream);
      Conversion<M> c = new Conversion<>(this, job, target, toMessage);
      job.attach(c);
      begin(c, "stream " + stream.name() + " is already the target of a conversion", "the last conversion into " + stream.name(), () -> {
        if (!stream.claim(c, () -> c.stop("stream closed", false))) {
          throw new IllegalStateException("stream " + stream.name() + " is closed");
        }
      });
      return c;
    }

    /**
     * SDK 1.9.0 (CR-0050 point 1; M9 C10): an encoder of raw I420 pictures, its H.264 into the plugin's own compute
     * task. One conversion slot, shared with MPEG-2 conversions.
     */
    @Override
    public <I extends dev.emcc.sdk.Message, M extends dev.emcc.sdk.Message> EncoderRef encode(EncoderSpec spec, ComputeRef<I> output,
        Function<EncodedPicture, ? extends I> toItem, dev.emcc.sdk.worker.WorkerRef<M> events,
        Function<ConversionEvent, ? extends M> toMessage) {
      Objects.requireNonNull(events, "events");
      return encode(spec, output, toItem, PluginWorkers.handleOf(events), toMessage);
    }

    /** As {@link #encode(EncoderSpec, ComputeRef, Function, dev.emcc.sdk.worker.WorkerRef, Function)}, with ECore's handle (tests). */
    <I extends dev.emcc.sdk.Message, M> EncoderRef encode(EncoderSpec spec, ComputeRef<I> output, Function<EncodedPicture, ? extends I> toItem,
        WorkerHandle<M> target, Function<ConversionEvent, ? extends M> toMessage) {
      Objects.requireNonNull(spec, "spec");
      Objects.requireNonNull(output, "output");
      Objects.requireNonNull(toItem, "toItem");
      Objects.requireNonNull(target, "target");
      Objects.requireNonNull(toMessage, "toMessage");
      if (!pluginId.equals(PluginComputes.pluginOf(output))) {
        throw new IllegalArgumentException("an encoder's output is one of this plugin's own compute tasks");
      }
      EncoderJob<I> job = new EncoderJob<>(spec, output, toItem);
      Conversion<M> c = new Conversion<>(this, job, target, toMessage);
      job.owner = c;
      begin(c, "encoder " + spec.name() + " runs already", "the last encoder " + spec.name(), () -> { });
      return c;
    }

    /** Registers {@code c} and starts it, or lets it wait for a slot, or fails it as unavailable. */
    private void begin(Conversion<?> c, String duplicate, String lastOne, Runnable claim) {
      String key = c.job.key();
      boolean converter = Files.isRegularFile(limits.ffmpeg()); // once, and not under the lock (review R6)
      synchronized (this) {
        if (released) {
          throw new IllegalStateException("plugin " + pluginId + " has stopped");
        }
        if (active.containsKey(key)) {
          throw new IllegalStateException(duplicate);
        }
        Instant failed = failedAt.get(key);
        if (failed != null && clock.instant().isBefore(failed.plus(Conversions.RETRY_AFTER))) {
          throw new IllegalStateException(lastOne + " failed at " + failed
              + "; start it again after " + Conversions.RETRY_AFTER.toSeconds() + " s");
        }
        if (converter) {
          claim.run();
        }
        active.put(key, c);
      }
      if (!converter) {
        c.fail(Failure.UNAVAILABLE, "no converter: " + limits.ffmpeg() + " is not there"); // its only event (owner, T-211)
        return;
      }
      String problem = c.job instanceof EncoderJob<?> ? encoderUnavailable : unavailable;
      if (problem != null) {
        c.fail(Failure.UNAVAILABLE, problem); // the start check's finding (M9 C5)
        return;
      }
      boolean soon = tooSoon(key, nanos.getAsLong());
      boolean slot;
      synchronized (slots) {
        slot = !soon && running < limits.max();
        if (slot) {
          running++;
        } else {
          waiting.addLast(c);
        }
      }
      if (slot) {
        c.run();
      } else {
        c.waitForSlot();
      }
    }

    /** Whether a launch for {@code stream} now would come within the restart time of the last one. */
    boolean tooSoon(String stream, long now) {
      Long last = launchedAt.get(stream);
      return last != null && now - last < TimeUnit.SECONDS.toNanos(limits.restartSeconds());
    }

    /** A conversion ended: it leaves the active ones and joins the recent ones. */
    void ended(Conversion<?> c, boolean failed) {
      synchronized (this) {
        active.remove(c.job.key(), c);
        recent.addFirst(c);
        while (recent.size() > RECENT) {
          recent.removeLast();
        }
      }
      if (failed) {
        failedAt.put(c.job.key(), clock.instant());
      }
    }
  }

  /**
   * One conversion: the plugin's {@link ConversionRef}, or for an encoder its {@link EncoderRef} (SDK 1.9.0). Its lock
   * guards its state and orders its events.
   */
  final class Conversion<M> implements ConversionRef, EncoderRef {
    private final HandleId id;
    final Member member;
    final Job job;
    private final WorkerHandle<M> target;
    private final Function<ConversionEvent, ? extends M> toMessage;
    private final Object lock = new Object();
    // guarded by lock:
    private State state = State.WAITING;
    private @Nullable Process process;
    private @Nullable Path folder;
    private boolean slot;
    private @Nullable String stopReason;
    private @Nullable Failure failure;
    private String failDetail = "";
    // without the lock:
    private volatile State shownState = State.WAITING;
    /** Queued input: a chunk, or (encoders) a picture with its time. */
    private record Input(byte @Nullable [] chunk, @Nullable Bytes picture, @Nullable Instant time) {}

    private final ConcurrentLinkedQueue<Input> input = new ConcurrentLinkedQueue<>();
    /** Encoders: pictures queued or being written. */
    private final AtomicInteger waitingPictures = new AtomicInteger();
    private final AtomicLong queued = new AtomicLong();
    private volatile @Nullable Thread writer;
    private final AtomicLong bytesIn = new AtomicLong();
    private final AtomicLong bytesOut = new AtomicLong();
    private final AtomicLong dropped = new AtomicLong();
    private volatile long firstInput;
    private volatile long lastInput;
    private volatile long lastOutput;
    private volatile long cpuMillis = -1;
    private final StringBuilder errorTail = new StringBuilder(); // guarded by itself
    private long windowStart; // guarded by input queue's writes: one connection task writes
    private long windowBytes;

    Conversion(Member member, Job job, WorkerHandle<M> target, Function<ConversionEvent, ? extends M> toMessage) {
      this.id = new HandleId(job.kind() + "-" + member.pluginId + "-" + job.name() + "-" + ids.incrementAndGet());
      this.member = member;
      this.job = job;
      this.target = target;
      this.toMessage = toMessage;
      this.windowStart = nanos.getAsLong();
    }

    @Override
    public HandleId id() {
      return id;
    }

    @Override
    public StreamRef target() {
      if (!(job instanceof StreamJob s)) {
        throw new UnsupportedOperationException("an encoder has no target stream");
      }
      return s.stream;
    }

    @Override
    public String name() {
      return job.name();
    }

    /** SDK 1.9.0 (CR-0050 point 1.3): one I420 picture; never blocks. */
    @Override
    public SendResult write(RawPicture picture) {
      Objects.requireNonNull(picture, "picture");
      if (!(job instanceof EncoderJob<?> e)) {
        throw new UnsupportedOperationException("a conversion takes chunks, not pictures");
      }
      if (picture.data().size() != e.spec.pictureBytes()) {
        throw new IllegalArgumentException("a picture is " + e.spec.width() + "x" + e.spec.height() + " I420: " + e.spec.pictureBytes()
            + " bytes, not " + picture.data().size());
      }
      State now = shownState;
      if (now == State.STOPPED || now == State.FAILED || now == State.STOPPING) {
        return SendResult.CLOSED;
      }
      if (now == State.WAITING || WorkerRuntime.onFencedThread() || PluginComputes.onFencedComputeThread()) {
        dropped.incrementAndGet();
        return SendResult.DROPPED;
      }
      if (waitingPictures.incrementAndGet() > EncoderRef.MAX_WAITING) { // a late frame is dropped, not queued
        waitingPictures.decrementAndGet();
        dropped.incrementAndGet();
        return SendResult.DROPPED;
      }
      long t = nanos.getAsLong();
      input.add(new Input(null, picture.data(), picture.time()));
      queued.addAndGet(picture.data().size());
      if (firstInput == 0) {
        firstInput = t;
      }
      lastInput = t;
      Thread w = writer;
      if (w != null) {
        LockSupport.unpark(w);
      }
      return SendResult.ACCEPTED;
    }

    @Override
    public boolean equals(@Nullable Object other) {
      return other instanceof ConversionRef r && r.id().equals(id);
    }

    @Override
    public int hashCode() {
      return id.hashCode();
    }

    @Override
    public String toString() {
      return id.value();
    }

    @Override
    public SendResult write(Bytes chunk) {
      Objects.requireNonNull(chunk, "chunk");
      if (!(job instanceof StreamJob)) {
        throw new UnsupportedOperationException("an encoder takes pictures, not chunks");
      }
      if (chunk.isEmpty() || chunk.size() > Streams.MAX_CHUNK) {
        throw new IllegalArgumentException("a chunk is 1 B to " + Streams.MAX_CHUNK + " B: " + chunk.size());
      }
      State now = shownState;
      if (now == State.STOPPED || now == State.FAILED || now == State.STOPPING) {
        return SendResult.CLOSED;
      }
      if (now == State.WAITING || WorkerRuntime.onFencedThread()) {
        dropped.incrementAndGet();
        return SendResult.DROPPED;
      }
      long t = nanos.getAsLong();
      synchronized (input) { // the rate window: a few arithmetic steps, never more
        if (t - windowStart >= WINDOW_NANOS) {
          windowStart = t;
          windowBytes = 0;
        }
        if ((windowBytes + chunk.size()) * 8 > Streams.MAX_RATE || queued.get() + chunk.size() > limits.inputQueueBytes()) {
          dropped.incrementAndGet();
          return SendResult.DROPPED;
        }
        windowBytes += chunk.size();
      }
      input.add(new Input(chunk.toArray(), null, null));
      queued.addAndGet(chunk.size());
      if (firstInput == 0) {
        firstInput = t;
      }
      lastInput = t;
      Thread w = writer;
      if (w != null) {
        LockSupport.unpark(w);
      }
      return SendResult.ACCEPTED;
    }

    @Override
    public void stop() {
      stop("stopped", false);
    }

    /** Queues the event to the plugin's worker; called with the lock held, so the events keep their order. */
    private void emit(ConversionEvent event) {
      runtime.deliverAlways(target, () -> toMessage.apply(event));
    }

    void waitForSlot() {
      synchronized (lock) {
        if (state == State.WAITING) {
          emit(new ConversionEvent.Waiting(job.name(), clock.instant()));
        }
      }
      LOG.info("Conversion {}/{} waits for a slot ({} run) or its restart time ({} s)", member.pluginId, job.name(), limits.max(),
          limits.restartSeconds());
    }

    /** It has a slot: the process starts, with its three threads. */
    void run() {
      boolean stoppedWhileWaiting;
      synchronized (lock) {
        slot = true;
        stoppedWhileWaiting = state != State.WAITING;
        if (!stoppedWhileWaiting) {
          state = State.RUNNING;
          shownState = State.RUNNING;
          emit(new ConversionEvent.Running(job.name(), clock.instant()));
        }
      }
      if (stoppedWhileWaiting) {
        release(); // outside its lock: the next one's run() takes its own (review R2)
        return;
      }
      Process p;
      Path own;
      member.launchedAt.put(job.key(), nanos.getAsLong()); // a launch, even one that fails, counts (M9 C5)
      try {
        own = Files.createTempDirectory("emcc-conversion-"); // its own empty working folder (SRA's M9-S3)
      } catch (IOException | RuntimeException e) {
        fail(Failure.UNAVAILABLE, "no working folder for the converter: " + printable(String.valueOf(e.getMessage())));
        return;
      }
      try {
        p = launcher.start(job instanceof EncoderJob<?> e ? encoderCommand(e.spec) : command(((StreamJob) job).spec), own);
      } catch (IOException | RuntimeException e) {
        removeFolder(own);
        fail(Failure.UNAVAILABLE, "the converter did not start: " + printable(String.valueOf(e.getMessage())));
        return;
      }
      boolean endedMeanwhile;
      synchronized (lock) {
        process = p;
        folder = own;
        endedMeanwhile = state != State.RUNNING; // stopped or failed while it started
      }
      if (endedMeanwhile) { // outside the lock: it waits for the process (review R1)
        kill(p);
        finishAfterExit(p);
        return;
      }
      LOG.info("Conversion {}/{} runs (process {})", member.pluginId, job.name(), p.pid());
      String name = "ecore-" + job.kind() + "-" + member.pluginId + "/" + job.name();
      try {
        start(name + "-in", () -> writeInput(p));
        start(name + "-out", () -> readOutput(p));
        start(name + "-err", () -> drainErrors(p));
      } catch (RuntimeException e) { // no thread to be had: the process goes, the conversion fails (review R4)
        fail(Failure.EXITED, "no thread for the converter: " + printable(String.valueOf(e.getMessage())));
        kill(p);
        finishAfterExit(p);
      }
    }

    /** Kills the process and closes its pipes. */
    private void kill(Process p) {
      p.destroyForcibly();
      for (java.io.Closeable pipe : List.<java.io.Closeable>of(p.getOutputStream(), p.getInputStream(), p.getErrorStream())) {
        try {
          pipe.close();
        } catch (IOException e) {
          // gone already
        }
      }
    }

    /** At ECore's stop: kills its process now, whatever its state (review R5). */
    void killNow() {
      Process p;
      @Nullable Path own;
      synchronized (lock) {
        p = process;
        own = folder;
      }
      if (p != null && p.isAlive()) {
        p.destroyForcibly();
      }
      if (own != null && p != null) {
        try {
          p.onExit().get(Conversions.STOP_GRACE.toMillis(), TimeUnit.MILLISECONDS);
        } catch (Exception e) {
          // it goes later; its folder may stay in the temp folder
        }
        removeFolder(own);
      }
    }

    private void removeFolder(Path own) {
      if (!ConverterCheck.delete(own)) {
        LOG.warn("Conversion {}/{}: its working folder {} could not be removed", member.pluginId, job.name(), own);
      }
    }

    private void start(String name, Runnable body) {
      runtime.startLoop(name, null, body); // the runtime's virtual threads: ECore makes none of its own (ArchitectureTest)
    }

    /** The writer: the queued input to the process, until it stops or the process goes. */
    private void writeInput(Process p) {
      writer = Thread.currentThread();
      try (OutputStream out = p.getOutputStream()) {
        while (true) {
          Input next = input.poll();
          if (next == null) {
            if (shownState != State.RUNNING) {
              return; // the stop closes the process's input (the try's close)
            }
            LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(200));
            continue;
          }
          Bytes picture = next.picture();
          int size = picture != null ? picture.size() : Objects.requireNonNull(next.chunk()).length;
          queued.addAndGet(-size);
          try {
            if (shownState != State.RUNNING) {
              continue; // stopping: the rest is not converted
            }
            if (picture != null) {
              try (InputStream in = picture.asInputStream()) {
                in.transferTo(out); // the picture's one copy is the plugin's Bytes (CR-0048 PQ4 A)
              }
              out.flush();
              job.written(Objects.requireNonNull(next.time()));
            } else {
              out.write(Objects.requireNonNull(next.chunk()));
              out.flush();
            }
            bytesIn.addAndGet(size);
          } finally {
            if (picture != null) {
              waitingPictures.decrementAndGet();
            }
          }
        }
      } catch (IOException e) {
        // the process has gone: the reader sees its end
      } finally {
        input.clear();
        queued.set(0);
        waitingPictures.set(0);
      }
    }

    /** The reader: the output, as untrusted bytes, into the stream; at its end, the conversion's. */
    private void readOutput(Process p) {
      byte[] buffer = new byte[Streams.MAX_CHUNK];
      boolean whole = false;
      try (InputStream in = p.getInputStream()) {
        for (int n; (n = in.read(buffer)) >= 0; ) {
          if (n > 0) {
            lastOutput = nanos.getAsLong();
            bytesOut.addAndGet(n);
            try {
              job.output(buffer, n);
            } catch (IOException e) { // the output is broken (an encoder's access unit too large): it fails
              fail(Failure.EXITED, printable(String.valueOf(e.getMessage())));
              p.destroyForcibly();
              break;
            }
          }
        }
        whole = true;
      } catch (IOException e) {
        // killed: its end follows
      } catch (RuntimeException e) {
        LOG.warn("Conversion {}/{}: reading its output failed", member.pluginId, job.name(), e);
        p.destroyForcibly();
      } finally {
        try {
          if (whole) {
            job.outputEnded(); // an encoder's last access unit
          }
        } finally {
          finishAfterExit(p); // always: else nothing would end the conversion (review)
        }
      }
    }

    /** The error output: drained, its last characters kept (untrusted, never logged as they are). */
    private void drainErrors(Process p) {
      byte[] buffer = new byte[4096];
      try (InputStream err = p.getErrorStream()) {
        for (int n; (n = err.read(buffer)) >= 0; ) {
          String text = printable(new String(buffer, 0, n, java.nio.charset.StandardCharsets.UTF_8));
          synchronized (errorTail) {
            errorTail.append(text);
            if (errorTail.length() > DETAIL) {
              errorTail.delete(0, errorTail.length() - DETAIL);
            }
          }
        }
      } catch (IOException e) {
        // the process has gone
      }
    }

    /** After the output ended: the process's end (killed after the grace if it lingers), then the conversion's. */
    private void finishAfterExit(Process p) {
      int code;
      try {
        if (!p.waitFor(Conversions.STOP_GRACE.toMillis(), TimeUnit.MILLISECONDS)) {
          p.destroyForcibly();
          p.waitFor(Conversions.STOP_GRACE.toMillis(), TimeUnit.MILLISECONDS);
        }
        code = p.isAlive() ? -1 : p.exitValue();
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        p.destroyForcibly();
        code = -1;
      }
      cpu(p);
      @Nullable Path own;
      synchronized (lock) {
        own = folder;
      }
      if (own != null) {
        removeFolder(own);
      }
      String tail;
      synchronized (errorTail) {
        tail = errorTail.toString().strip();
      }
      end(Failure.EXITED, "exit code " + code + (tail.isEmpty() ? "" : "; " + tail));
    }

    private void cpu(Process p) {
      try {
        p.toHandle().info().totalCpuDuration().ifPresent(d -> cpuMillis = d.toMillis());
      } catch (RuntimeException e) {
        // the platform does not say
      }
    }

    /**
     * Its end: Stopped when it was stopped, else Failed (the given failure unless one was set before).
     * Frees its slot and the stream; the last event.
     */
    private void end(Failure ifUnplanned, String detail) {
      boolean failed;
      synchronized (lock) {
        if (state == State.STOPPED || state == State.FAILED) {
          return;
        }
        if (stopReason != null && failure == null) {
          state = State.STOPPED;
          emit(new ConversionEvent.Stopped(job.name(), clock.instant(), stopReason));
        } else {
          Failure f = failure != null ? failure : ifUnplanned;
          String d = failure != null ? failDetail : detail;
          failure = f;
          failDetail = d;
          state = State.FAILED;
          emit(new ConversionEvent.Failed(job.name(), clock.instant(), f, d));
        }
        shownState = state;
        failed = state == State.FAILED;
      }
      if (job instanceof StreamJob s) {
        s.stream.unclaim(this);
      }
      member.ended(this, failed);
      LOG.info("Conversion {}/{} {}", member.pluginId, job.name(), failed ? "failed: " + failure : "stopped: " + stopReason);
      release();
    }

    /** Frees its slot, once. */
    private void release() {
      boolean had;
      synchronized (lock) {
        had = slot;
        slot = false;
      }
      if (had) {
        slotFreed();
      }
    }

    /**
     * Stops it: a waiting one at once; a running one by closing its process's input, killed after
     * the grace (at once when {@code now}). Calling it again has no effect.
     */
    void stop(String reason, boolean now) {
      Process p;
      boolean wasWaiting;
      synchronized (lock) {
        if (state != State.WAITING && state != State.RUNNING) {
          return;
        }
        wasWaiting = state == State.WAITING;
        stopReason = reason;
        state = State.STOPPING;
        shownState = State.STOPPING;
        p = process;
      }
      if (wasWaiting) {
        synchronized (slots) {
          waiting.remove(this);
        }
        end(Failure.EXITED, "");
        return;
      }
      Thread w = writer;
      if (w != null) {
        LockSupport.unpark(w); // it closes the process's input
      }
      if (p == null) {
        return; // still starting: run() ends it
      }
      if (now) {
        p.destroyForcibly();
      } else {
        runtime.schedule(Conversions.STOP_GRACE, p::destroyForcibly);
      }
    }

    /** Fails it: the process is killed, and its end reports this failure. */
    void fail(Failure why, String detail) {
      Process p;
      synchronized (lock) {
        if (state == State.STOPPED || state == State.FAILED || failure != null) {
          return;
        }
        failure = why;
        failDetail = detail;
        boolean started = process != null;
        p = process;
        if (!started && state != State.WAITING) {
          state = State.STOPPING; // a start that failed, or no converter at all
        }
        if (p != null || state == State.STOPPING) {
          shownState = State.STOPPING; // under the lock: never after end() set its last state; writes get CLOSED at once
        }
      }
      if (p != null) {
        p.destroyForcibly();
      } else {
        end(why, detail);
      }
    }

    void checkTimers(long now) {
      if (shownState != State.RUNNING) {
        return;
      }
      long first = firstInput;
      long out = lastOutput;
      long in = lastInput;
      if (first != 0 && out == 0 && now - first > Conversions.START_TIMEOUT.toNanos()) {
        fail(Failure.START, "no output " + Conversions.START_TIMEOUT.toSeconds() + " s after its first input");
      } else if (out != 0 && in > out && now - out > Conversions.STALL_TIMEOUT.toNanos()) {
        fail(Failure.STALLED, "no output for " + Conversions.STALL_TIMEOUT.toSeconds() + " s while input came");
      }
    }

    ConversionStatus status() {
      Process p;
      String detail;
      synchronized (lock) {
        p = process;
        detail = failure != null ? failure + ": " + failDetail : stopReason != null ? stopReason : "";
      }
      if (p != null && p.isAlive()) {
        cpu(p);
      }
      return new ConversionStatus(member.pluginId, job.name(), job.kind(), shownState.name(), bytesIn.get(), bytesOut.get(), dropped.get(),
          job.lost(), cpuMillis, detail);
    }
  }

  /** Untrusted text as one line of printable characters. */
  static String printable(String text) {
    StringBuilder out = new StringBuilder(text.length());
    text.codePoints().forEach(c -> out.appendCodePoint(c == '\n' || c == '\r' || c == '\t' ? ' ' : Character.isISOControl(c) ? '?' : c));
    return out.toString();
  }
}
