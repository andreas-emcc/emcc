package dev.emcc.sdk.testkit;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.compute.ComputeRef;
import dev.emcc.sdk.stream.ConversionEvent;
import dev.emcc.sdk.stream.ConversionRef;
import dev.emcc.sdk.stream.ConversionSpec;
import dev.emcc.sdk.stream.Conversions;
import dev.emcc.sdk.stream.EncodedPicture;
import dev.emcc.sdk.stream.EncoderRef;
import dev.emcc.sdk.stream.EncoderSpec;
import dev.emcc.sdk.stream.RawPicture;
import dev.emcc.sdk.stream.StreamRef;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.function.Consumer;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.8.0 (CR-0044 E2): the test kit's conversion service. It records every start, and runs no
 * program: a running conversion copies its input to its target stream unchanged, marking as a
 * start point each chunk that holds a transport stream packet with the random access indicator. It
 * reads no PAT or PMT, so the target's header stays as the plugin set it.
 *
 * <pre>{@code
 * ctx.conversions().holdNew(true);                 // no slot free: the next start is Waiting
 * // ... the plugin starts one ...
 * FakeConversions.FakeConversion c = ctx.conversions().conversion("link-1");
 * c.run();                                         // a slot freed: Running
 * c.fail(ConversionEvent.Failure.STALLED, "");    // Failed; a new start waits RETRY_AFTER
 * }</pre>
 *
 * <p><b>SDK 1.9.0 (CR-0050 point 1): encoders.</b> {@code encode} starts a {@link FakeEncoder}, which
 * runs no program either: it records the pictures written and lets at most {@link
 * EncoderRef#MAX_WAITING} wait, and the test makes it give an access unit for the oldest waiting
 * picture ({@link FakeEncoder#emit}), posted to the compute task's inbox through the plugin's {@code
 * toItem} at once. {@link #holdNew}, {@link FakeEncoder#run()} and {@link FakeEncoder#fail} work as
 * for conversions; {@link #stopEncoders()} stops them as ECore does when the plugin stops.
 *
 * <pre>{@code
 * FakeConversions.FakeEncoder e = ctx.conversions().encoder("uav-north");
 * ctx.computeTask("render").awaitIdle();           // the task wrote its pictures
 * e.emit(true, Bytes.of(new byte[] {0, 0, 0, 1, 9, 16}));   // an IDR for the oldest waiting picture
 * }</pre>
 *
 * <p>Events reach the worker at the next run, in order. A conversion's target must be a stream of
 * the same fake context. Thread-safe: connection tasks write from their own threads; with one
 * writer per conversion, as a plugin has (its link's task), the target gets the input in order. It
 * keeps all the input, for the test to read.
 */
public final class FakeConversions implements Conversions {

  private final FakePluginContext ctx;
  private final List<FakeConversion> all = new ArrayList<>();
  private final Map<String, Instant> failedAt = new HashMap<>();
  private final List<FakeEncoder> encoders = new ArrayList<>();
  private final Map<String, Instant> encoderFailedAt = new HashMap<>();
  private final Queue<Runnable> pending = new ConcurrentLinkedQueue<>();
  private boolean holdNew;

  FakeConversions(FakePluginContext ctx) {
    this.ctx = ctx;
  }

  @Override
  public synchronized <M extends Message> FakeConversion start(ConversionSpec spec, WorkerRef<M> events, Function<ConversionEvent, ? extends M> toMessage) {
    Objects.requireNonNull(spec, "spec");
    Objects.requireNonNull(events, "events");
    Objects.requireNonNull(toMessage, "toMessage");
    if (!(spec.target() instanceof FakeStreams.FakeStream target) || target.owner() != ctx.streams()) {
      throw new IllegalArgumentException("the target is not a stream of this fake context: " + spec.target());
    }
    if (target.isClosed()) {
      throw new IllegalStateException("the target stream is closed: " + target.name());
    }
    FakeConversion current = target.conversion();
    if (current != null && !current.ended()) {
      throw new IllegalStateException("the stream is already a conversion's target: " + target.name());
    }
    Instant failed = failedAt.get(target.name());
    Instant now = ctx.clock();
    if (failed != null && now.isBefore(failed.plus(RETRY_AFTER))) {
      throw new IllegalStateException("the stream's last conversion failed less than " + RETRY_AFTER + " ago: " + target.name());
    }
    Consumer<ConversionEvent> sink = event -> pending.add(() -> ctx.deliverAlways(events, () -> toMessage.apply(event)));
    var c = new FakeConversion(this, spec, target, new HandleId(ctx.nextId("conversion-" + target.name())), sink, holdNew);
    target.conversion(c);
    all.add(c);
    c.emit(holdNew ? new ConversionEvent.Waiting(target.name(), now) : new ConversionEvent.Running(target.name(), now));
    return c;
  }

  @Override
  public synchronized <I extends Message, M extends Message> FakeEncoder encode(EncoderSpec spec, ComputeRef<I> output,
      Function<EncodedPicture, ? extends I> toItem, WorkerRef<M> events, Function<ConversionEvent, ? extends M> toMessage) {
    Objects.requireNonNull(spec, "spec");
    Objects.requireNonNull(output, "output");
    Objects.requireNonNull(toItem, "toItem");
    Objects.requireNonNull(events, "events");
    Objects.requireNonNull(toMessage, "toMessage");
    if (!ctx.compute().owns(output)) {
      throw new IllegalArgumentException("the output is not a compute task of this plugin: " + output);
    }
    for (FakeEncoder e : encoders) {
      if (e.spec.name().equals(spec.name()) && !e.ended()) {
        throw new IllegalStateException("an encoder named " + spec.name() + " has not ended");
      }
    }
    Instant failed = encoderFailedAt.get(spec.name());
    Instant now = ctx.clock();
    if (failed != null && now.isBefore(failed.plus(RETRY_AFTER))) {
      throw new IllegalStateException("the last encoder named " + spec.name() + " failed less than " + RETRY_AFTER + " ago");
    }
    Consumer<ConversionEvent> sink = event -> pending.add(() -> ctx.deliverAlways(events, () -> toMessage.apply(event)));
    Function<EncodedPicture, SendResult> post = picture -> output.post(toItem.apply(picture));
    var e = new FakeEncoder(this, spec, new HandleId(ctx.nextId("encoder-" + spec.name())), sink, post, holdNew);
    encoders.add(e);
    e.emitEvent(holdNew ? new ConversionEvent.Waiting(spec.name(), now) : new ConversionEvent.Running(spec.name(), now));
    return e;
  }

  /** SDK 1.9.0: the latest encoder named {@code name}. */
  public synchronized FakeEncoder encoder(String name) {
    for (int i = encoders.size() - 1; i >= 0; i--) {
      if (encoders.get(i).spec.name().equals(name)) {
        return encoders.get(i);
      }
    }
    throw new IllegalArgumentException("no encoder named " + name + " was started");
  }

  /** SDK 1.9.0: every encoder started, in order. */
  public synchronized List<FakeEncoder> encoders() {
    return List.copyOf(encoders);
  }

  /** SDK 1.9.0: stops every encoder that has not ended, with the reason "plugin stopped", as ECore does when the plugin stops. */
  public void stopEncoders() {
    for (FakeEncoder e : encoders()) {
      e.end("plugin stopped");
    }
  }

  private synchronized void encoderFailed(String name, Instant at) {
    encoderFailedAt.put(name, at);
  }

  /** Whether the next starts find no free slot, and so begin {@code Waiting} until {@link FakeConversion#run()}. Default false. */
  public synchronized void holdNew(boolean hold) {
    this.holdNew = hold;
  }

  /** The latest conversion into the stream named {@code stream}. */
  public synchronized FakeConversion conversion(String stream) {
    for (int i = all.size() - 1; i >= 0; i--) {
      if (all.get(i).target.name().equals(stream)) {
        return all.get(i);
      }
    }
    throw new IllegalArgumentException("no conversion into " + stream + " was started");
  }

  /** Every conversion started, in order. */
  public synchronized List<FakeConversion> conversions() {
    return List.copyOf(all);
  }

  private synchronized void failed(String stream, Instant at) {
    failedAt.put(stream, at);
  }

  /** Delivers the events that wait; called by the fake context's run loop. */
  boolean step() {
    boolean any = false;
    for (Runnable r; (r = pending.poll()) != null; ) {
      r.run();
      any = true;
    }
    return any;
  }

  /** A conversion of the test kit. Equal by id. */
  public static final class FakeConversion implements ConversionRef {

    /** Where it is. */
    public enum State {
      WAITING,
      RUNNING,
      STOPPED,
      FAILED
    }

    private final FakeConversions owner;
    private final ConversionSpec spec;
    private final FakeStreams.FakeStream target;
    private final HandleId id;
    private final Consumer<ConversionEvent> events;
    private final List<Bytes> input = new ArrayList<>();
    private State state;
    private int dropped;

    FakeConversion(FakeConversions owner, ConversionSpec spec, FakeStreams.FakeStream target, HandleId id, Consumer<ConversionEvent> events, boolean waiting) {
      this.owner = owner;
      this.spec = spec;
      this.target = target;
      this.id = id;
      this.events = events;
      this.state = waiting ? State.WAITING : State.RUNNING;
    }

    @Override
    public HandleId id() {
      return id;
    }

    @Override
    public StreamRef target() {
      return target;
    }

    /** The spec it was started with. */
    public ConversionSpec spec() {
      return spec;
    }

    @Override
    public SendResult write(Bytes chunk) {
      FakeStreams.check(chunk);
      synchronized (this) {
        switch (state) {
          case STOPPED, FAILED -> {
            return SendResult.CLOSED;
          }
          case WAITING -> {
            dropped++;
            return SendResult.DROPPED;
          }
          case RUNNING -> input.add(chunk);
        }
      }
      target.writeFromConversion(chunk, hasRandomAccess(chunk));
      return SendResult.ACCEPTED;
    }

    @Override
    public void stop() {
      end(State.STOPPED, "stopped");
    }

    /** A slot freed: a {@code Waiting} conversion runs, with a {@code Running} event. */
    public void run() {
      synchronized (this) {
        if (state != State.WAITING) {
          throw new IllegalStateException("only a waiting conversion can start running: " + state);
        }
        state = State.RUNNING;
      }
      emit(new ConversionEvent.Running(target.name(), owner.ctx.clock()));
    }

    /** It fails, as ECore's would: a {@code Failed} event, and a new start for its target waits {@link Conversions#RETRY_AFTER}. */
    public void fail(ConversionEvent.Failure failure, String detail) {
      Objects.requireNonNull(failure, "failure");
      Objects.requireNonNull(detail, "detail");
      Instant at = owner.ctx.clock();
      synchronized (this) {
        if (ended()) {
          return;
        }
        state = State.FAILED;
      }
      owner.failed(target.name(), at);
      emit(new ConversionEvent.Failed(target.name(), at, failure, detail));
    }

    void targetClosed() {
      end(State.STOPPED, "stream closed");
    }

    private void end(State end, String reason) {
      synchronized (this) {
        if (ended()) {
          return;
        }
        state = end;
      }
      emit(new ConversionEvent.Stopped(target.name(), owner.ctx.clock(), reason));
    }

    void emit(ConversionEvent event) {
      events.accept(event);
    }

    synchronized boolean running() {
      return state == State.RUNNING;
    }

    synchronized boolean ended() {
      return state == State.STOPPED || state == State.FAILED;
    }

    public synchronized State state() {
      return state;
    }

    /** The input it took while running, in order. */
    public synchronized List<Bytes> input() {
      return List.copyOf(input);
    }

    /** The input dropped while it waited for a slot. */
    public synchronized int dropped() {
      return dropped;
    }

    @Override
    public boolean equals(@Nullable Object other) {
      return other instanceof FakeConversion c && c.id.equals(id);
    }

    @Override
    public int hashCode() {
      return id.hashCode();
    }

    @Override
    public String toString() {
      return "FakeConversion[" + target.name() + ", " + state() + "]";
    }
  }

  /**
   * SDK 1.9.0 (CR-0050 point 1): an encoder of the test kit. Equal by id. Thread-safe: a compute
   * task writes from its own thread while the test emits.
   */
  public static final class FakeEncoder implements EncoderRef {

    private final FakeConversions owner;
    private final EncoderSpec spec;
    private final HandleId id;
    private final Consumer<ConversionEvent> events;
    private final Function<EncodedPicture, SendResult> output;
    private final List<RawPicture> pictures = new ArrayList<>();
    private final ArrayDeque<RawPicture> waiting = new ArrayDeque<>();
    private final List<EncodedPicture> emitted = new ArrayList<>();
    private FakeConversion.State state;
    private int dropped;
    private long sequence;

    FakeEncoder(FakeConversions owner, EncoderSpec spec, HandleId id, Consumer<ConversionEvent> events, Function<EncodedPicture, SendResult> output,
        boolean waiting) {
      this.owner = owner;
      this.spec = spec;
      this.id = id;
      this.events = events;
      this.output = output;
      this.state = waiting ? FakeConversion.State.WAITING : FakeConversion.State.RUNNING;
    }

    @Override
    public HandleId id() {
      return id;
    }

    @Override
    public String name() {
      return spec.name();
    }

    /** The spec it was started with. */
    public EncoderSpec spec() {
      return spec;
    }

    @Override
    public synchronized SendResult write(RawPicture picture) {
      Objects.requireNonNull(picture, "picture");
      if (picture.data().size() != spec.pictureBytes()) {
        throw new IllegalArgumentException(
            "an I420 picture of " + spec.width() + "x" + spec.height() + " is " + spec.pictureBytes() + " bytes: " + picture.data().size());
      }
      switch (state) {
        case STOPPED, FAILED -> {
          return SendResult.CLOSED;
        }
        case WAITING -> {
          dropped++;
          return SendResult.DROPPED;
        }
        case RUNNING -> {
          if (waiting.size() >= MAX_WAITING) {
            dropped++;
            return SendResult.DROPPED;
          }
          pictures.add(picture);
          waiting.add(picture);
          return SendResult.ACCEPTED;
        }
      }
      throw new AssertionError(state);
    }

    @Override
    public void stop() {
      end("stopped");
    }

    /**
     * The process gave the access unit of the oldest waiting picture: an {@link EncodedPicture} with
     * the next sequence number and that picture's time is posted to the compute task's inbox, through
     * the plugin's {@code toItem}, at once.
     *
     * @return what the inbox's post gave, e.g. {@code DROPPED} by its overflow policy, or {@code CLOSED}
     * @throws IllegalStateException if it does not run, or no picture waits
     */
    public SendResult emit(boolean keyframe, Bytes accessUnit) {
      EncodedPicture picture;
      synchronized (this) {
        if (state != FakeConversion.State.RUNNING) {
          throw new IllegalStateException("only a running encoder gives access units: " + state);
        }
        RawPicture oldest = waiting.poll();
        if (oldest == null) {
          throw new IllegalStateException("no picture waits for the encoder " + spec.name());
        }
        picture = new EncodedPicture(sequence++, oldest.time(), keyframe, accessUnit);
        emitted.add(picture);
      }
      return output.apply(picture);
    }

    /** A slot freed: a {@code Waiting} encoder runs, with a {@code Running} event. */
    public void run() {
      synchronized (this) {
        if (state != FakeConversion.State.WAITING) {
          throw new IllegalStateException("only a waiting encoder can start running: " + state);
        }
        state = FakeConversion.State.RUNNING;
      }
      emitEvent(new ConversionEvent.Running(spec.name(), owner.ctx.clock()));
    }

    /** It fails, as ECore's would: a {@code Failed} event, and a new encoder of its name waits {@link Conversions#RETRY_AFTER}. */
    public void fail(ConversionEvent.Failure failure, String detail) {
      Objects.requireNonNull(failure, "failure");
      Objects.requireNonNull(detail, "detail");
      Instant at = owner.ctx.clock();
      synchronized (this) {
        if (ended()) {
          return;
        }
        state = FakeConversion.State.FAILED;
        waiting.clear();
      }
      owner.encoderFailed(spec.name(), at);
      emitEvent(new ConversionEvent.Failed(spec.name(), at, failure, detail));
    }

    void end(String reason) {
      synchronized (this) {
        if (ended()) {
          return;
        }
        state = FakeConversion.State.STOPPED;
        waiting.clear();
      }
      emitEvent(new ConversionEvent.Stopped(spec.name(), owner.ctx.clock(), reason));
    }

    void emitEvent(ConversionEvent event) {
      events.accept(event);
    }

    synchronized boolean ended() {
      return state == FakeConversion.State.STOPPED || state == FakeConversion.State.FAILED;
    }

    public synchronized FakeConversion.State state() {
      return state;
    }

    /** Every picture it accepted, in order. */
    public synchronized List<RawPicture> pictures() {
      return List.copyOf(pictures);
    }

    /** How many accepted pictures wait for their access unit, at most {@link #MAX_WAITING}. */
    public synchronized int waiting() {
      return waiting.size();
    }

    /** The pictures dropped: while it waited for a slot, or with {@link #MAX_WAITING} waiting. */
    public synchronized int dropped() {
      return dropped;
    }

    /** Every access unit it gave, in order. */
    public synchronized List<EncodedPicture> emitted() {
      return List.copyOf(emitted);
    }

    @Override
    public boolean equals(@Nullable Object other) {
      return other instanceof FakeEncoder e && e.id.equals(id);
    }

    @Override
    public int hashCode() {
      return id.hashCode();
    }

    @Override
    public String toString() {
      return "FakeEncoder[" + spec.name() + ", " + state() + "]";
    }
  }

  /** Whether {@code chunk} holds a 188-byte transport stream packet with the random access indicator. */
  static boolean hasRandomAccess(Bytes chunk) {
    for (int at = 0; at + 188 <= chunk.size(); at += 188) {
      if (chunk.get(at) != 0x47) {
        return false;
      }
      int control = (chunk.get(at + 3) >> 4) & 3;
      if ((control == 2 || control == 3) && (chunk.get(at + 4) & 0xFF) > 0 && (chunk.get(at + 5) & 0x40) != 0) {
        return true;
      }
    }
    return false;
  }
}
