package dev.emcc.plugins.fmv.out;

import dev.emcc.plugins.fmv.out.imagery.ImageryReader;
import dev.emcc.plugins.fmv.out.imagery.ImagerySet;
import dev.emcc.plugins.fmv.out.render.GroundFallback;
import dev.emcc.plugins.fmv.out.render.Renderer;
import dev.emcc.plugins.fmv.out.terrain.CellKey;
import dev.emcc.plugins.fmv.out.terrain.Terrain;
import dev.emcc.plugins.fmv.out.terrain.TerrainReader;
import dev.emcc.plugins.fmv.out.wms.WmsCache;
import dev.emcc.plugins.fmv.out.wms.WmsGrid;
import dev.emcc.plugins.fmv.out.wms.WmsSettings;
import dev.emcc.plugins.fmv.out.wms.WmsView;
import dev.emcc.plugins.fmv.transport.Rate;
import dev.emcc.plugins.fmv.transport.TransportMsg;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.ClassificationLimit;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.channel.ChannelInfo;
import dev.emcc.sdk.channel.ChannelRef;
import dev.emcc.sdk.channel.ChannelSpec;
import dev.emcc.sdk.channel.ChannelState;
import dev.emcc.sdk.channel.DeclaredItem;
import dev.emcc.sdk.compute.ComputeEvent;
import dev.emcc.sdk.compute.ComputeRef;
import dev.emcc.sdk.compute.ComputeSpec;
import dev.emcc.sdk.connection.Backoff;
import dev.emcc.sdk.connection.ConnectionEvent;
import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.connection.ConnectionSpec;
import dev.emcc.sdk.connection.Restart;
import dev.emcc.sdk.document.DocumentResult;
import dev.emcc.sdk.http.HttpResult;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.stream.ConversionEvent;
import dev.emcc.sdk.stream.Conversions;
import dev.emcc.sdk.stream.EncoderRef;
import dev.emcc.sdk.stream.EncoderSpec;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.WorkerContext;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * The worker of the output links (brief sections 10.2 to 10.7; B1: one worker for them all). For
 * each enabled output link it offers a channel that takes {@code fmv.camera-pose}; for each pose it
 * checks the release limit and the link's one camera (O2), starts the link's pipeline on the first
 * one (a compute task that renders and muxes, ECore's encoder, a connection task that sends),
 * reads the terrain and imagery round the camera through the declared folders, and stops it all
 * 2 s after the camera's last pose. With the WMS (F2) it also wants the WMS tiles round where
 * each camera looks, from {@code fmv}'s tile cache or the admin's server ({@link WmsCache}).
 * Its status lines go to the links' worker, which owns the
 * plugin's status. A handler handles one message at a time; it never blocks.
 */
public final class OutputWorker implements Handler<OutputMsg> {

  /** The worker's mailbox: poses coalesce in the channel's inbox, so a few a link at most wait here. */
  public static final int MAILBOX = 10_000;

  /** A link frees its camera this long after the camera's last pose (O2). */
  static final Duration HOLD = Duration.ofSeconds(2);

  /** A refused compute task is tried again this long after the refusal, while poses arrive (section 10.3 point 9). */
  static final Duration RETRY = Duration.ofSeconds(10);

  /** The tick: holds, retries, readers and the status. */
  static final Duration TICK = Duration.ofMillis(500);

  /** The compute task's inbox (section 10.3 point 9). */
  static final int TASK_INBOX = 1_000;

  /** The sender's inbox, in pictures; its {@link Pacer} holds 2 s of bytes at {@code maxRate}. */
  static final int SEND_INBOX = 512;

  /** A failed compute task or sender is started again after 1 s, then up to 1 min. */
  static final Backoff BACKOFF = Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60));

  private static final Duration FOLDER_TIMEOUT = Duration.ofSeconds(30);

  /** The most luma pixels a link's WMS tiles take: a quarter of the link's cap (Q4), about 1 000 tiles of 256 pixels. */
  static final long WMS_CAP_PIXELS = 64_000_000L;

  /** The WMS cache's answers as this worker's messages. */
  private static final WmsCache.Wrap<OutputMsg> WRAP = new WmsCache.Wrap<>() {
    @Override
    public OutputMsg document(WmsCache.Op op, String key, DocumentResult result) {
      return new OutputMsg.WmsDocument(op, key, result);
    }

    @Override
    public OutputMsg fetched(String key, HttpResult result) {
      return new OutputMsg.WmsFetched(key, result);
    }
  };

  private final PluginContext context;
  private final Supplier<Instant> now;
  private final WorkerRef<TransportMsg> links;
  private final Map<String, Out> outs = new LinkedHashMap<>();
  private final List<String> problems = new ArrayList<>();
  private @Nullable WorkerRef<OutputMsg> self;
  private @Nullable Cancellable ticker;
  private @Nullable WmsCache<OutputMsg> wms;
  /** The imagery and terrain folder settings last applied; a change restarts the pipelines. */
  private @Nullable String folders;
  /** No height data: the view's centre is on flat ground at 0 m (owner, 2026-11-17). Never filled. */
  private final Terrain flat = new Terrain();
  private long ticks;

  /** One output link: its settings, its channel, its pipeline and what it counted. */
  static final class Out {
    OutLink link;
    @Nullable ChannelRef channel;
    @Nullable UUID holder;
    Instant lastPose = Instant.EPOCH;
    @Nullable ComputeRef<TaskItem> task;
    @Nullable ConnectionRef<SendItem> sender;
    /** The frame the pipeline runs for: size, rate and the link's bit rate and keyframe interval. */
    @Nullable EncoderSpec frame;
    /** The running encoder; {@code null} until it starts again after a failure ({@code encoderFailedAt}). */
    @Nullable EncoderRef encoder;
    /** Counts the encoders started; ECore's events of an older one are ignored. */
    int generation;
    boolean encoderWaiting;
    @Nullable Instant encoderFailedAt;
    /** ECore has no converter (UNAVAILABLE): nothing starts until the settings change (owner, 2026-11-17). */
    boolean noEncoder;
    @Nullable TerrainReader<OutputMsg> terrain;
    @Nullable ImageryReader<OutputMsg> imagery;
    /** Counts the readers made; a folder's answer to an older generation is dropped. */
    int readers;
    /** The times the folders were read again after a pause (F1). */
    long rereads;
    @Nullable WmsView wmsView;
    boolean restarting;
    @Nullable Instant refusedAt;
    @Nullable String refusal;
    @Nullable String failure;
    @Nullable String sendError;
    String state = "Waiting for a pose";
    boolean cannotRender;
    final Map<String, String> imageryRefused = new LinkedHashMap<>();
    long poses;
    long otherCamera;
    long aboveLimit;
    long badPoses;
    long unmapped;
    long terrainFailed;
    long imageryFailed;
    long wmsFetched;
    long wmsFromCache;
    long wmsFailed;
    OutputMsg.@Nullable Rendered rendered;
    OutputMsg.@Nullable Sent sent;
    final Rate poseRate = new Rate();
    final Rate renderedRate = new Rate();
    final Rate sentRate = new Rate();

    Out(OutLink link) {
      this.link = link;
    }
  }

  OutputWorker(PluginContext context, Supplier<Instant> now, WorkerRef<TransportMsg> links) {
    this.context = context;
    this.now = now;
    this.links = links;
  }

  /** Spawns the worker; then subscribe it to the settings, as {@code FmvPlugin} does. */
  public static WorkerRef<OutputMsg> spawn(PluginContext context, Supplier<Instant> now, WorkerRef<TransportMsg> links) {
    return context.workers().spawn(WorkerSpec.of("outputs", OutputMsg.class, () -> new OutputWorker(context, now, links))
        .mailbox(MAILBOX, Overflow.dropNewest()));
  }

  @Override
  public void handle(OutputMsg message, WorkerContext<OutputMsg> ctx) {
    self = ctx.self();
    if (ticker == null) {
      ticker = context.timers().every(TICK, ctx.self(), new OutputMsg.Tick());
    }
    if (wms == null) {
      wms = new WmsCache<>(context.documents(), context.http(), ctx.self(), WRAP, now, context.log());
    }
    switch (message) {
      case OutputMsg.SettingsChanged m -> {
        apply(m.settings());
        publish();
      }
      case OutputMsg.Declared m -> onPose(m.link(), m.item());
      case OutputMsg.Ignored m -> { }
      case OutputMsg.Compute m -> onCompute(m.link(), m.event());
      case OutputMsg.Sender m -> onSender(m.link(), m.event());
      case OutputMsg.Encoder m -> onEncoder(m.link(), m.generation(), m.event());
      case OutputMsg.Folder m -> onFolder(m);
      case OutputMsg.Rendered m -> {
        Out out = outs.get(m.link());
        if (out != null) {
          out.rendered = m;
        }
      }
      case OutputMsg.Sent m -> {
        Out out = outs.get(m.link());
        if (out != null) {
          out.sent = m;
        }
      }
      case OutputMsg.WmsDocument m -> wmsOutcomes(cache().onDocument(m.op(), m.key(), m.result()));
      case OutputMsg.WmsFetched m -> wmsOutcomes(cache().onFetched(m.key(), m.result()));
      case OutputMsg.Tick m -> {
        onTick();
        publish();
      }
    }
  }

  // ------------------------------------------------------------------- settings

  private void apply(JsonObject settings) {
    Map<String, OutLink> wanted = new LinkedHashMap<>();
    problems.clear();
    if (settings.get("links") instanceof JsonArray array) {
      for (JsonValue entry : array.values()) {
        if (entry instanceof JsonObject o && OutLink.isOut(o)) {
          try {
            OutLink link = OutLink.from(o);
            if (wanted.putIfAbsent(link.id(), link) != null) {
              problems.add("link " + link.name() + " is identified twice");
            }
          } catch (IllegalArgumentException e) {
            problems.add(e.getMessage());
          }
        }
      }
    }
    for (var it = outs.entrySet().iterator(); it.hasNext(); ) {
      Out out = it.next().getValue();
      if (!wanted.containsKey(out.link.id())) {
        stopPipeline(out);
        withdraw(out);
        it.remove();
      }
    }
    for (OutLink link : wanted.values()) {
      Out out = outs.get(link.id());
      boolean renamed = false;
      if (out == null) {
        out = new Out(link);
        outs.put(link.id(), out);
      }
      if (!out.link.equals(link)) {
        out.noEncoder = false; // a change of the link's own settings tries the encoder again (owner, 2026-11-17)
        renamed = !out.link.name().equals(link.name());
        boolean other = !link.withLookOf(out.link).equals(out.link);
        out.link = link;
        if (other) {
          stopPipeline(out); // the next pose starts it with the new settings
          out.refusedAt = null;
        } else {
          post(out, new TaskItem.Look(link)); // the name or the look: from the next frame, the stream goes on (owner, M9.2)
        }
      }
      if (!link.enabled()) {
        stopPipeline(out);
        withdraw(out);
        out.state = "Disabled";
      } else {
        if (out.channel == null || renamed) {
          offer(out); // a rename keeps the channel's id (the link's), with its new name
        }
        if ("Disabled".equals(out.state)) {
          out.state = "Waiting for a pose";
        }
      }
    }
    String folders = String.valueOf(settings.get("imageryFolder")) + "\n" + settings.get("terrainFolder");
    if (this.folders != null && !this.folders.equals(folders)) {
      for (Out out : outs.values()) {
        stopPipeline(out); // a changed folder setting restarts the pipelines (O10): the next pose reads the new folders
      }
    }
    this.folders = folders;
    WmsCache<OutputMsg> c = cache();
    WmsSettings w = WmsSettings.from(settings);
    boolean changed = !w.equals(c.settings());
    c.apply(w); // a change forgets the wants: each view plans again, on the new grid
    if (changed) {
      for (Out out : outs.values()) {
        if (out.wmsView != null) {
          out.wmsView = new WmsView(c.grid());
          post(out, new TaskItem.UseWms(c.grid().crs()));
        }
      }
    }
  }

  private WmsCache<OutputMsg> cache() {
    return Objects.requireNonNull(wms);
  }

  private void offer(Out out) {
    withdraw(out);
    String id = out.link.id();
    try {
      ChannelSpec spec = ChannelSpec.of(out.link.channelLink(), out.link.name(), "stanag-4609").declaredKinds(Set.of(PoseJson.KIND)).kinds(Set.of());
      out.channel = context.channels().offer(spec, Objects.requireNonNull(self), item -> new OutputMsg.Ignored(), item -> new OutputMsg.Declared(id, item));
    } catch (UnsupportedOperationException e) {
      problems.add("output links wait for declared channel kinds in ECore (SDK 1.9.0, C8)");
    } catch (IllegalArgumentException | IllegalStateException e) {
      problems.add("link " + out.link.name() + ": its channel cannot be offered: " + e.getMessage());
    }
  }

  private void withdraw(Out out) {
    if (out.channel != null) {
      out.channel.withdraw();
      out.channel = null;
    }
  }

  // ------------------------------------------------------------------- poses

  private void onPose(String linkId, DeclaredItem item) {
    Out out = outs.get(linkId);
    if (out == null || !out.link.enabled() || !PoseJson.KIND.equals(item.kind())) {
      return;
    }
    out.poses++;
    Instant t = now.get();
    if (out.holder != null && !out.holder.equals(item.id()) && Duration.between(out.lastPose, t).compareTo(HOLD) < 0) {
      out.otherCamera++; // one camera per link (section 10.2 point 6)
      return;
    }
    Pose pose;
    boolean overlay;
    try {
      pose = PoseJson.read(item.payload());
      overlay = PoseJson.overlay(item.payload());
    } catch (IllegalArgumentException e) {
      out.badPoses++;
      context.log().warn("{}: a pose is refused: {}", out.link.name(), e.getMessage());
      return;
    }
    // a camera stopped and started again within the hold: the pipeline ran on, so the folders are read again (F1)
    ComputeRef<TaskItem> taskBefore = out.task;
    boolean resumed = taskBefore != null && Duration.between(out.lastPose, t).compareTo(pause(pose)) > 0;
    out.holder = item.id();
    out.lastPose = t;
    ClassificationLimit limit = limit(out.link);
    if (!context.classifications().within(item.label(), limit)) {
      out.aboveLimit++;
      stopPipeline(out);
      say(out, "Above release limit", true);
      return;
    }
    if (out.link.destination() == null) {
      say(out, "No destination", true);
      return;
    }
    if (out.noEncoder) {
      say(out, "No encoder installed", true); // owner, Q3, and 2026-11-17: nothing starts until the settings change
      return;
    }
    EncoderSpec running = out.frame;
    if (out.task != null && running != null && (running.width() != pose.width() || running.height() != pose.height() || running.frameRate() != pose.rate())) {
      stopPipeline(out); // a new frame size or rate restarts the encoder (O10)
    }
    if (out.task == null) {
      Instant refused = out.refusedAt;
      if (refused != null && Duration.between(refused, t).compareTo(RETRY) < 0) {
        say(out, "No render thread (" + out.refusal + ")", true);
        return;
      }
      start(out, pose);
      if (out.task == null) {
        return;
      }
    }
    if (resumed && out.task == taskBefore) {
      reread(out); // a pipeline started anew just now has fresh readers already
    }
    aim(out, pose);
    aimWms(out, pose);
    OutLink.Classification c = out.link.classification(item.label(), limit);
    if (c.unmapped()) {
      out.unmapped++;
    }
    String platform = pose.platform().name() != null ? pose.platform().name() : out.link.name();
    Objects.requireNonNull(out.task).post(new TaskItem.Frame(pose, c.value(), Objects.requireNonNull(platform), overlay));
    if (out.encoderWaiting) {
      say(out, "Waiting for a conversion slot", true); // ECore drops the pictures until Running (section 10.4)
    } else if (out.encoder == null) {
      say(out, "Encoder failed, started again after " + Conversions.RETRY_AFTER.toSeconds() + " s", true);
    } else {
      say(out, "Rendering " + platform + " " + pose.width() + "×" + pose.height() + " " + pose.rate() + (out.link.degraded() != null ? ", degraded" : "")
          + (overlay ? ", overlay" : ""), false); // the overlay last, as the brief's 10.7 point 22 writes it
    }
  }

  /**
   * The gap in a camera's poses that counts as a stop and a new start (F1; owner, M9.2): more than two
   * frame periods, and at least half a second, so that a late pose or two is no pause.
   */
  static Duration pause(Pose pose) {
    return Duration.ofMillis(Math.max(500, 2000L / pose.rate()));
  }

  /** The link's release limit; absent, the classification of the server's default label (ADR-0037 point 8). */
  private ClassificationLimit limit(OutLink link) {
    return link.highest() != null ? Objects.requireNonNull(link.highest()) : ClassificationLimit.of(context.defaultLabel());
  }

  private void say(Out out, String state, boolean cannotRender) {
    out.state = state;
    out.cannotRender = cannotRender;
    ChannelRef channel = out.channel;
    if (channel != null) { // for the senders, e.g. uav-simulation's panel (part U, CR-0050 point 2); the same state again changes nothing
      String detail = state.length() > ChannelInfo.MAX_STATE_DETAIL ? state.substring(0, ChannelInfo.MAX_STATE_DETAIL - 1) + "…" : state;
      channel.state(cannotRender ? ChannelState.NOT_SENDING : ChannelState.READY, cannotRender ? detail.replaceAll("\\p{Cntrl}", " ") : "");
    }
  }

  // ------------------------------------------------------------------- the pipeline

  /** Starts the link's compute task, sender and encoder for a pose's frame, and its readers. */
  private void start(Out out, Pose pose) {
    OutLink link = out.link;
    String id = link.id();
    WorkerRef<OutputMsg> worker = Objects.requireNonNull(self);
    OutLink.Destination destination = Objects.requireNonNull(link.destination());
    EncoderSpec frame;
    try {
      frame = EncoderSpec.of(link.renderTask(), pose.width(), pose.height(), pose.rate())
          .bitrate(Math.round(link.bitrateMbps() * 1_000_000)).keyframeSeconds(link.keyframeSeconds());
    } catch (IllegalArgumentException e) {
      say(out, "Cannot start: " + e.getMessage(), true);
      return;
    }
    ComputeRef<TaskItem> task;
    try {
      task = context.compute().start(
          ComputeSpec.of(link.renderTask(), TaskItem.class).inbox(TASK_INBOX, Overflow.coalesceByKey()).restart(Restart.onFailure(BACKOFF)),
          () -> new RenderTask(id, worker, now), worker, e -> new OutputMsg.Compute(id, e));
    } catch (UnsupportedOperationException | IllegalArgumentException | IllegalStateException e) {
      out.refusedAt = now.get();
      out.refusal = e.getMessage();
      say(out, "No render thread (" + e.getMessage() + ")", true);
      return;
    }
    out.task = task;
    out.frame = frame;
    out.refusedAt = null;
    out.failure = null;
    out.sendError = null;
    try {
      out.sender = context.connections().start(ConnectionSpec.of(link.sendTask(), SendItem.class).inbox(SEND_INBOX, Overflow.dropOldest()).restart(Restart.always(BACKOFF)),
          () -> new UdpSendTask(id, destination, link.maxRateMbps(), worker), worker, e -> new OutputMsg.Sender(id, e));
    } catch (RuntimeException e) {
      out.failure = "cannot start: " + e.getMessage();
      stopPipeline(out);
      say(out, "Cannot start: " + e.getMessage(), true);
      return;
    }
    setup(out);
    startEncoder(out);
  }

  /**
   * Starts the link's encoder on ECore's conversion service (part U, section 10.4): the task's frame,
   * its access units into the task's inbox, its events to this worker; then posts it to the task.
   * A start ECore refuses counts as a failure, tried again after {@link Conversions#RETRY_AFTER};
   * without the service in this ECore, there is no encoder.
   */
  private void startEncoder(Out out) {
    ComputeRef<TaskItem> task = out.task;
    EncoderSpec frame = out.frame;
    if (task == null || frame == null) {
      return;
    }
    String id = out.link.id();
    int generation = ++out.generation;
    EncoderSpec spec = new EncoderSpec(out.link.encoderName(generation), frame.width(), frame.height(), frame.frameRate(), frame.bitrate(), frame.keyframeSeconds());
    out.encoderFailedAt = null;
    out.encoderWaiting = false;
    try {
      out.encoder = context.conversions().encode(spec, task, p -> TaskItem.Encoded.of(generation, p), Objects.requireNonNull(self),
          e -> new OutputMsg.Encoder(id, generation, e));
    } catch (UnsupportedOperationException e) {
      noEncoder(out, "this ECore has no encoder (SDK 1.9.0 part U)");
      return;
    } catch (IllegalArgumentException | IllegalStateException e) {
      encoderFailed(out, "cannot start the encoder: " + e.getMessage());
      return;
    }
    task.post(new TaskItem.UseEncoder(out.encoder));
  }

  /** ECore has no converter: the pipeline stops, and nothing starts until the settings change (owner, 2026-11-17). */
  private void noEncoder(Out out, String detail) {
    stopPipeline(out);
    out.noEncoder = true;
    out.failure = detail;
    say(out, "No encoder installed", true);
  }

  /** The encoder ended without the worker stopping it: none until {@link Conversions#RETRY_AFTER} has passed; the task and sender go on. */
  private void encoderFailed(Out out, String detail) {
    out.encoder = null;
    out.encoderWaiting = false;
    out.encoderFailedAt = now.get();
    out.failure = detail;
    post(out, new TaskItem.UseEncoder(null));
  }

  /** The setup and fresh readers: after a start, and after ECore restarted the task (its state starts clean). */
  private void setup(Out out) {
    ComputeRef<TaskItem> task = out.task;
    if (task == null || out.sender == null || out.frame == null) {
      return;
    }
    task.post(new TaskItem.Setup(out.frame, out.sender, out.link));
    task.post(new TaskItem.UseEncoder(out.encoder));
    readers(out);
  }

  /**
   * The camera came back after a pause while the pipeline ran on (F1; the UDA's finding 2, owner ACW
   * A; owner, M9.2: read the folders again): the task drops the terrain and imagery it holds, and
   * fresh readers read the folders as at a start. The encoder and the stream go on.
   */
  private void reread(Out out) {
    TerrainReader<OutputMsg> terrain = out.terrain;
    if (terrain != null) {
      for (CellKey key : terrain.wanted()) {
        post(out, new TaskItem.DropCell(key));
      }
    }
    post(out, new TaskItem.UseSet(null));
    out.rereads++;
    readers(out);
  }

  /** Fresh terrain and imagery readers, of a new generation, and a fresh WMS view. */
  private void readers(Out out) {
    ComputeRef<TaskItem> task = out.task;
    if (task == null) {
      return;
    }
    String id = out.link.id();
    int generation = ++out.readers;
    out.terrain = new TerrainReader<>(context.folders().folder("terrain"), Objects.requireNonNull(self), r -> new OutputMsg.Folder(id, "terrain", r, generation),
        FOLDER_TIMEOUT);
    out.imagery = new ImageryReader<>(context.folders().folder("imagery"), Objects.requireNonNull(self), r -> new OutputMsg.Folder(id, "imagery", r, generation),
        FOLDER_TIMEOUT, out.link.imagerySet());
    out.imageryRefused.clear();
    WmsCache<OutputMsg> c = cache();
    WmsView old = out.wmsView;
    if (old != null) {
      for (WmsGrid.Tile t : old.clear()) {
        c.unwant(id, t.key());
      }
    }
    out.wmsView = new WmsView(c.grid());
    task.post(new TaskItem.UseWms(c.grid().crs()));
  }

  private void stopPipeline(Out out) {
    if (out.task != null) {
      out.task.stop();
      out.task = null;
    }
    if (out.sender != null) {
      out.sender.stop();
      out.sender = null;
    }
    if (out.encoder != null) {
      out.encoder.stop(); // frees the conversion slot; its Stopped event is of an old generation once another starts
      out.encoder = null;
    }
    out.frame = null;
    out.encoderWaiting = false;
    out.encoderFailedAt = null;
    out.terrain = null;
    out.imagery = null;
    WmsView view = out.wmsView;
    if (view != null && wms != null) {
      for (WmsGrid.Tile t : view.clear()) {
        wms.unwant(out.link.id(), t.key());
      }
    }
    out.wmsView = null;
    out.restarting = false;
  }

  /** Aims the readers at the camera when it has moved far enough (O6). */
  private void aim(Out out, Pose pose) {
    double lon = pose.platform().lon();
    double lat = pose.platform().lat();
    TerrainReader<OutputMsg> terrain = out.terrain;
    if (terrain != null && terrain.shouldAim(lon, lat)) {
      for (CellKey key : terrain.aim(lon, lat)) {
        post(out, new TaskItem.DropCell(key));
      }
    }
    ImageryReader<OutputMsg> imagery = out.imagery;
    if (imagery != null && imagery.shouldAim(lon, lat)) {
      imageryOutcomes(out, imagery.aim(lon, lat));
    }
  }

  /**
   * Plans the link's WMS tiles round where its camera looks (owner, 2026-11-17: 2 km, again after
   * 500 m), once the imagery folder's sets are known, so that a tile the set covers is not fetched.
   * The WMS tiles take what the set's tiles leave of the link's pixels (Q4), at most {@link #WMS_CAP_PIXELS}.
   */
  private void aimWms(Out out, Pose pose) {
    WmsCache<OutputMsg> c = wms;
    WmsView view = out.wmsView;
    if (c == null || view == null || !c.active()) {
      return;
    }
    ImageryReader<OutputMsg> imagery = out.imagery;
    if (imagery != null && !imagery.ready()) {
      return;
    }
    double[] at = viewCentre(pose, flat);
    if (!view.shouldAim(at[0], at[1])) {
      return;
    }
    long left = ImageryReader.CAP_PIXELS - (imagery == null ? 0 : imagery.plannedPixels());
    WmsView.Plan plan = view.aim(at[0], at[1], imagery == null ? null : imagery.chosen(), Math.max(0, Math.min(WMS_CAP_PIXELS, left)));
    String id = out.link.id();
    for (WmsGrid.Tile t : plan.drop()) {
      c.unwant(id, t.key());
      post(out, new TaskItem.DropWmsTile(t.key(), t.spec()));
    }
    for (WmsGrid.Tile t : plan.add()) {
      wmsOutcomes(c.want(id, t));
    }
  }

  /**
   * Where the camera looks: the line of sight on flat ground at 0 m; where it meets none within the
   * folder's round ({@link ImageryReader#RADIUS_METRES}), the point {@link WmsView#RADIUS_METRES} ahead
   * along the line of sight's bearing (owner, 2026-11-17). Longitude, latitude.
   */
  static double[] viewCentre(Pose pose, Terrain flat) {
    Pose.Platform p = pose.platform();
    Renderer.FrameCentre c = Renderer.centre(pose, flat, GroundFallback.SEA_LEVEL);
    if (c != null && metres(p.lon(), p.lat(), c.lon(), c.lat()) <= ImageryReader.RADIUS_METRES) {
      return new double[] {c.lon(), c.lat()};
    }
    double bearing = Math.toRadians(p.heading() + pose.pointing().azimuth());
    double north = WmsView.RADIUS_METRES * Math.cos(bearing);
    double east = WmsView.RADIUS_METRES * Math.sin(bearing);
    return new double[] {p.lon() + Math.toDegrees(east / (6_371_009 * Math.max(0.01, Math.cos(Math.toRadians(p.lat()))))),
        p.lat() + Math.toDegrees(north / 6_371_009)};
  }

  private static double metres(double lon1, double lat1, double lon2, double lat2) {
    double x = Math.toRadians(lon2 - lon1) * Math.cos(Math.toRadians((lat1 + lat2) / 2));
    double y = Math.toRadians(lat2 - lat1);
    return Math.hypot(x, y) * 6_371_009;
  }

  private void wmsOutcomes(List<WmsCache.Outcome> outcomes) {
    for (WmsCache.Outcome o : outcomes) {
      switch (o) {
        case WmsCache.Outcome.Deliver d -> {
          for (String link : d.links()) {
            Out out = outs.get(link);
            WmsView view = out == null ? null : out.wmsView;
            if (out != null && view != null && view.wants(d.tile().key())) {
              post(out, new TaskItem.WmsTile(d.tile().key(), d.tile().spec(), d.image()));
              if (d.fromCache()) {
                out.wmsFromCache++;
              } else {
                out.wmsFetched++;
              }
            }
          }
        }
        case WmsCache.Outcome.Failed f -> {
          for (String link : f.links()) {
            Out out = outs.get(link);
            if (out != null) {
              out.wmsFailed++;
            }
          }
        }
      }
    }
  }

  private void onFolder(OutputMsg.Folder m) {
    Out out = outs.get(m.link());
    if (out == null || m.readers() != out.readers) {
      return; // readers since replaced asked: what they read may be the old files (F1)
    }
    if (m.folder().equals("terrain")) {
      TerrainReader<OutputMsg> terrain = out.terrain;
      if (terrain == null) {
        return;
      }
      for (TerrainReader.Outcome o : terrain.onResult(m.result())) {
        switch (o) {
          case TerrainReader.Outcome.Loaded l -> post(out, new TaskItem.Cell(l.key(), l.data()));
          case TerrainReader.Outcome.Missing x -> { } // flat at 0 m there (O5)
          case TerrainReader.Outcome.Failed f -> {
            out.terrainFailed++;
            context.log().warn("{}: terrain {}: {} {}", out.link.name(), f.path(), f.reason(), f.message());
          }
        }
      }
    } else {
      ImageryReader<OutputMsg> imagery = out.imagery;
      if (imagery != null) {
        imageryOutcomes(out, imagery.onResult(m.result()));
      }
    }
  }

  private void imageryOutcomes(Out out, List<ImageryReader.Outcome> outcomes) {
    for (ImageryReader.Outcome o : outcomes) {
      switch (o) {
        case ImageryReader.Outcome.UseSet u -> post(out, new TaskItem.UseSet(u.set()));
        case ImageryReader.Outcome.Tile t -> post(out, new TaskItem.Tile(t.set().folder(), t.spec(), t.data()));
        case ImageryReader.Outcome.DropTile d -> post(out, new TaskItem.DropTile(d.set().folder(), d.spec()));
        case ImageryReader.Outcome.Refused r -> {
          if (out.imageryRefused.put(r.folder(), r.reason()) == null) {
            context.log().warn("{}: the imagery set {} is refused: {}", out.link.name(), r.folder(), r.reason());
          }
        }
        case ImageryReader.Outcome.Failed f -> {
          out.imageryFailed++;
          context.log().warn("{}: imagery {}: {}", out.link.name(), f.path(), f.reason());
        }
      }
    }
  }

  private void post(Out out, TaskItem item) {
    if (out.task != null) {
      out.task.post(item);
    }
  }

  // ------------------------------------------------------------------- ECore's news

  private void onCompute(String linkId, ComputeEvent event) {
    Out out = outs.get(linkId);
    if (out == null) {
      return;
    }
    switch (event) {
      case ComputeEvent.Running e -> {
        if (out.restarting && out.task != null) {
          out.restarting = false;
          setup(out); // a restarted task starts clean: the setup, the cells and the tiles again (section 10.3 point 12)
        }
      }
      case ComputeEvent.Restarting e -> {
        out.restarting = true;
        out.failure = e.reason();
      }
      case ComputeEvent.Refused e -> {
        stopPipeline(out);
        out.refusedAt = now.get();
        out.refusal = e.refusal().name();
        say(out, "No render thread (" + e.refusal().name() + ")", true);
      }
      case ComputeEvent.Stopped e -> {
        if (e.reason() != null) { // ECore stopped it (the admin lowered the threads); the plugin's own stops have none
          stopPipeline(out);
          out.refusedAt = now.get();
          out.refusal = e.reason();
          say(out, "No render thread (" + e.reason() + ")", true);
        }
      }
      case ComputeEvent.Failed e -> {
        stopPipeline(out);
        out.failure = e.reason();
        say(out, "Render failed: " + e.reason(), true);
      }
      case ComputeEvent.Hung e -> out.failure = "the render task hung";
    }
  }

  private void onSender(String linkId, ConnectionEvent event) {
    Out out = outs.get(linkId);
    if (out == null) {
      return;
    }
    switch (event) {
      case ConnectionEvent.Running e -> out.sendError = null;
      case ConnectionEvent.Restarting e -> out.sendError = e.reason();
      case ConnectionEvent.Failed e -> out.sendError = e.reason();
      case ConnectionEvent.Stopped e -> { }
    }
  }

  /** ECore's news of the link's current encoder (section 10.4); an older encoder's is of no interest. */
  private void onEncoder(String linkId, int generation, ConversionEvent event) {
    Out out = outs.get(linkId);
    if (out == null || generation != out.generation || out.encoder == null) {
      return;
    }
    switch (event) {
      case ConversionEvent.Waiting e -> {
        out.encoderWaiting = true;
        say(out, "Waiting for a conversion slot", true);
      }
      case ConversionEvent.Running e -> {
        out.encoderWaiting = false;
        out.failure = null;
      }
      case ConversionEvent.Failed e when e.failure() == ConversionEvent.Failure.UNAVAILABLE -> noEncoder(out, e.detail());
      case ConversionEvent.Failed e -> {
        encoderFailed(out, "encoder " + e.failure().name().toLowerCase(java.util.Locale.ROOT) + (e.detail().isEmpty() ? "" : ": " + e.detail()));
        say(out, "Encoder failed, started again after " + Conversions.RETRY_AFTER.toSeconds() + " s", true);
      }
      case ConversionEvent.Stopped e -> {
        encoderFailed(out, "encoder stopped: " + e.reason()); // not by this worker: ECore's, e.g. its conversion service stopping
        say(out, "Encoder failed, started again after " + Conversions.RETRY_AFTER.toSeconds() + " s", true);
      }
    }
  }

  // ------------------------------------------------------------------- the tick and the status

  private void onTick() {
    Instant t = now.get();
    if (wms != null) {
      wms.tick();
    }
    boolean second = ++ticks % 2 == 0;
    for (Out out : outs.values()) {
      if ((out.task != null || out.cannotRender || out.holder != null) && Duration.between(out.lastPose, t).compareTo(HOLD) >= 0) {
        stopPipeline(out); // the camera's poses stopped: the thread and the conversion slot are free (O2)
        out.holder = null;
        if (out.link.enabled() && !out.noEncoder) {
          say(out, out.link.destination() == null ? "No destination" : "Waiting for a pose", false);
        }
      }
      Instant failed = out.encoderFailedAt;
      if (out.task != null && out.encoder == null && failed != null && Duration.between(failed, t).compareTo(Conversions.RETRY_AFTER) >= 0) {
        startEncoder(out); // a failed encoder is started again after ECore's RETRY_AFTER (section 10.4)
      }
      if (out.terrain != null) {
        out.terrain.pump();
      }
      if (out.imagery != null) {
        out.imagery.pump();
      }
      if (second) {
        out.poseRate.sample(out.poses);
        out.renderedRate.sample(out.rendered != null ? out.rendered.rendered() : 0);
        out.sentRate.sample(out.sent != null ? out.sent.datagrams() : 0);
      }
    }
  }

  /** The output links' lines, to the links' worker, which puts them in the plugin's status (section 10.7). */
  private void publish() {
    List<String> lines = new ArrayList<>(problems);
    boolean degraded = !problems.isEmpty();
    for (Out out : outs.values()) {
      OutLink.Destination d = out.link.destination();
      String state = out.link.enabled() && d == null && !out.cannotRender ? "No destination" : out.state;
      StringBuilder b = new StringBuilder(out.link.name()).append(" [out, ").append(d == null ? "no destination" : d.where()).append("]: ").append(state);
      if (out.failure != null) {
        b.append(" (").append(out.failure).append(')');
      }
      if (out.sendError != null) {
        b.append(", send: ").append(out.sendError);
      }
      b.append(", ").append(out.poseRate.perMinute(out.poses)).append(" poses/min");
      long rendered = out.rendered != null ? out.rendered.rendered() : 0;
      b.append(", ").append(out.renderedRate.perMinute(rendered)).append(" frames/min");
      long sent = out.sent != null ? out.sent.datagrams() : 0;
      b.append(", ").append(out.sentRate.perMinute(sent)).append(" datagrams/min");
      appendNonZero(b, "other camera", out.otherCamera);
      appendNonZero(b, "above release limit", out.aboveLimit);
      appendNonZero(b, "bad pose", out.badPoses);
      appendNonZero(b, "unmapped classification", out.unmapped);
      if (out.rendered != null) {
        appendNonZero(b, "late", out.rendered.late());
        appendNonZero(b, "encoder dropped", out.rendered.encoderDropped());
        appendNonZero(b, "no imagery", out.rendered.noImagery());
        appendNonZero(b, "bit error events", out.rendered.bitErrorEvents());
        appendNonZero(b, "bit error blocks", out.rendered.bitErrorBlocks());
      }
      if (out.sent != null) {
        appendNonZero(b, "send dropped", out.sent.dropped());
      }
      if (out.imagery != null) {
        appendNonZero(b, "imagery over cap", out.imagery.overCap());
      }
      appendNonZero(b, "wms fetched", out.wmsFetched);
      appendNonZero(b, "wms from cache", out.wmsFromCache);
      appendNonZero(b, "wms failed", out.wmsFailed);
      if (out.wmsView != null) {
        appendNonZero(b, "wms over cap", out.wmsView.overCap());
      }
      appendNonZero(b, "folders read again", out.rereads);
      appendNonZero(b, "terrain failed", out.terrainFailed);
      appendNonZero(b, "imagery failed", out.imageryFailed);
      ImagerySet set = out.imagery != null ? out.imagery.chosen() : null;
      if (set != null) {
        b.append(", imagery ").append(set.name()).append(" (").append(set.source()).append(", ").append(set.licence()).append(')');
      }
      for (var r : out.imageryRefused.entrySet()) {
        b.append(", imagery set ").append(r.getKey()).append(" refused: ").append(r.getValue());
      }
      lines.add(b.toString());
      degraded |= out.link.enabled() && out.cannotRender && Duration.between(out.lastPose, now.get()).compareTo(HOLD) < 0;
    }
    String wmsLine = wmsLine();
    if (wmsLine != null) {
      lines.add(wmsLine);
    }
    links.send(new TransportMsg.OutputStatus(lines, degraded));
  }

  /** The WMS and its cache in the Monitor (section 10.7 point 24): what it fetches from, the tiles kept, the source and licence. */
  private @Nullable String wmsLine() {
    WmsCache<OutputMsg> c = wms;
    if (c == null || !c.settings().enabled() && c.kept() == 0) {
      return null;
    }
    WmsSettings s = c.settings();
    String why = s.whyNotFetching();
    StringBuilder b = new StringBuilder("WMS imagery: ").append(why == null ? "fetching from " + s.host() : "not fetching (" + why + ")");
    b.append(", ").append(c.kept()).append(" tiles kept (").append(String.format(java.util.Locale.ROOT, "%.1f", c.keptBytes() / 1_048_576.0)).append(" MB)");
    if (s.source() != null) {
      b.append(", source ").append(s.source());
    }
    if (s.licence() != null) {
      b.append(", licence ").append(s.licence());
    }
    appendNonZero(b, "fetched", c.fetchedTotal());
    appendNonZero(b, "from cache", c.fromCacheTotal());
    appendNonZero(b, "failed", c.failedTotal());
    appendNonZero(b, "not kept", c.keepFailedTotal());
    appendNonZero(b, "waiting", c.queued());
    if (c.lastFailure() != null) {
      b.append(", last failure: ").append(c.lastFailure());
    }
    return b.toString();
  }

  private static void appendNonZero(StringBuilder b, String name, long n) {
    if (n > 0) {
      b.append(", ").append(name).append(' ').append(n);
    }
  }

  /** The output links' state for tests: a link's line in the status. */
  @Nullable String state(String linkId) {
    Out out = outs.get(linkId);
    return out == null ? null : out.state;
  }
}
