package dev.emcc.plugins.fmv.transport;

import dev.emcc.plugins.fmv.in.LabelRule;
import dev.emcc.plugins.fmv.in.Mapper;
import dev.emcc.plugins.fmv.klv.Metadata;
import dev.emcc.plugins.fmv.out.OutLink;
import dev.emcc.plugins.fmv.ts.VideoFormat;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.ClassificationLimit;
import dev.emcc.sdk.Classifications;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.PluginStatus;
import dev.emcc.sdk.connection.Backoff;
import dev.emcc.sdk.connection.ConnectionEvent;
import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.connection.ConnectionSpec;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.Restart;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.ObjectQuery;
import dev.emcc.sdk.store.ObjectWriter;
import dev.emcc.sdk.store.QueryResult;
import dev.emcc.sdk.stream.ConversionEvent;
import dev.emcc.sdk.stream.ConversionRef;
import dev.emcc.sdk.stream.ConversionSpec;
import dev.emcc.sdk.stream.StreamRef;
import dev.emcc.sdk.stream.StreamSpec;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.WorkerContext;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * The worker that owns the links (brief sections 4 to 6): it reads the {@code links} setting, starts
 * one connection task per link, and for each
 * <ul>
 *   <li>opens the stream when the task learns the video's format, and hands it (or, for MPEG-2, a
 *       conversion that writes to it) to the task, which writes the datagrams;
 *   <li>writes the camera and its field of view through the SDK's {@link ObjectWriter}, at most twice a
 *       second, the newest set winning, and nothing for a set that changes nothing;
 *   <li>keeps the status, the per-minute rates and the list {@code GET /streams} gives the panel.
 * </ul>
 * A change of a link's connection restarts its task; a change of its other settings applies at once.
 * A handler handles one message at a time, so its fields need no locks; it never blocks.
 */
public final class LinkWorker implements Handler<TransportMsg> {

  /** The worker's mailbox. Settings, task events and store answers are always delivered; sets are dropped when it is full, and counted. */
  public static final int MAILBOX = 10_000;

  /** The inbox of a link's task: three kinds of message, a few of each. */
  static final int INBOX = 64;

  /** A run that ends is started again after 1 s, then up to 60 s. */
  static final Backoff RESTART = Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60));

  /** The permission to watch (brief section 5). */
  public static final String WATCH = "plugin.fmv.view";

  /** The twice-a-second tick: it limits the writes to two a second per stream (ADR-0057 point 3). */
  static final Duration TICK = Duration.ofMillis(500);

  /** A failed conversion is started again after this long, while the link runs (brief section 4). */
  static final Duration CONVERSION_RETRY = Duration.ofMinutes(1);

  private static final Duration STORE_TIMEOUT = Duration.ofSeconds(10);
  private static final Duration WARN_EVERY = Duration.ofMinutes(1);
  private static final int RATE_WINDOW_SECONDS = 5;

  /** The counters that are also warned of, once a minute per link and reason; the others are counted only. */
  private static final Set<String> WARNED = Set.of("unmapped classification", "above layer label", "no field of view", "no camera position", "stream dropped");

  private final PluginContext context;
  private final Supplier<Instant> now;
  /** The links by key, in the order of the settings. */
  private final Map<String, Running> links = new LinkedHashMap<>();
  private final List<String> problems = new ArrayList<>();
  private @Nullable WorkerRef<TransportMsg> self;
  private @Nullable ObjectWriter writer;
  private @Nullable Cancellable ticker;
  private long ticks;
  /** The output links' lines, from their worker (brief section 10.7). */
  private TransportMsg.OutputStatus outputs = new TransportMsg.OutputStatus(List.of(), false);

  /** What the task chose: the program's video. */
  private record Video(int pid, VideoFormat format, int klvPid) {}

  /** The camera as last written, so that a set that changes nothing writes nothing. */
  private record Fingerprint(Metadata metadata, SecurityLabel label, @Nullable String format, LinkSettings settings) {}

  /** One link: its settings, its task, and what it did. */
  private static final class Running {
    Link link;
    LinkSettings settings;
    @Nullable ConnectionRef<LinkInbox> task;
    @Nullable UUID run;
    boolean up;
    @Nullable String lastError;
    // what the task learnt
    @Nullable Video video;
    int width;
    int height;
    boolean noVideo;
    Instant videoSince = Instant.EPOCH;
    // the stream and the conversion
    @Nullable StreamRef stream;
    @Nullable String streamError;
    @Nullable SecurityLabel streamLabel;
    @Nullable ConversionRef conversion;
    /** {@code null}, {@code waiting}, {@code running} or a failure's reason. */
    @Nullable String conversionState;
    boolean conversionFailed;
    /** The failure is that no converter is installed. */
    boolean converterMissing;
    Instant conversionFailedAt = Instant.EPOCH;
    // the sets
    TransportMsg.@Nullable Telemetry pending;
    /** The newest set, kept so that a rename or a changed setting can write it again. */
    TransportMsg.@Nullable Telemetry latest;
    @Nullable Fingerprint written;
    @Nullable Instant lastSet;
    @Nullable SecurityLabel lastLabel;
    /** The name of the camera, from its last set: the panel and the window show it. */
    @Nullable String title;
    long sets;
    // the traffic
    long datagrams;
    long bytes;
    final Deque<long[]> samples = new ArrayDeque<>(); // {seconds since start of the worker, bytes}
    /** The rates go on when the link moves to another connection, as its set count does. */
    Rate datagramRate = new Rate();
    Rate setRate = new Rate();
    final Map<String, Instant> warned = new HashMap<>();

    Running(Link link, LinkSettings settings) {
      this.link = link;
      this.settings = settings;
    }
  }

  LinkWorker(PluginContext context, Supplier<Instant> now) {
    this.context = context;
    this.now = now;
  }

  /** Spawns the worker; then subscribe it to the settings, as {@code FmvPlugin} does. */
  public static WorkerRef<TransportMsg> spawn(PluginContext context, Supplier<Instant> now) {
    return context.workers().spawn(WorkerSpec.of("links", TransportMsg.class, () -> new LinkWorker(context, now)).mailbox(MAILBOX, Overflow.dropNewest()));
  }

  /** The endpoint {@code GET /streams} puts its requests to this worker; the plugin registers it. */
  public static TransportMsg streams(EndpointRequest request) {
    return new TransportMsg.Streams(request);
  }

  @Override
  public void handle(TransportMsg message, WorkerContext<TransportMsg> ctx) {
    self = ctx.self();
    if (writer == null) {
      // Made with the worker, so that a restarted worker subscribes again and finds its objects.
      writer = ObjectWriter.create(context, ctx.self(), Mapper.NAMESPACE, TransportMsg.Writer::new);
      writer.fieldSet(Mapper.FIELD_SET);
      writer.start();
      ticker = context.timers().every(TICK, ctx.self(), new TransportMsg.Tick());
    }
    switch (message) {
      case TransportMsg.Writer m -> {
        writer.handle(m.reply());
        return;
      }
      case TransportMsg.SettingsChanged m -> apply(m.settings());
      case TransportMsg.LinkEvent m -> onEvent(m.event());
      case TransportMsg.Up m -> onUp(m);
      case TransportMsg.Down m -> onDown(m);
      case TransportMsg.Chosen m -> onChosen(m);
      case TransportMsg.Size m -> {
        Running r = current(m.link(), m.run());
        if (r != null) {
          r.width = m.width();
          r.height = m.height();
        }
      }
      case TransportMsg.Telemetry m -> {
        Running r = current(m.link(), m.run());
        if (r != null) {
          r.pending = m; // the newest set wins; the next tick writes it
          r.latest = m;
          r.lastSet = now.get();
          r.sets++;
        }
      }
      case TransportMsg.Traffic m -> {
        Running r = current(m.link(), m.run());
        if (r != null) {
          r.datagrams = m.datagrams();
          r.bytes = m.bytes();
          r.noVideo = m.noVideo();
          r.samples.addLast(new long[] {now.get().getEpochSecond(), m.bytes()});
          while (r.samples.size() > RATE_WINDOW_SECONDS + 1) {
            r.samples.removeFirst();
          }
        }
      }
      case TransportMsg.Conversion m -> onConversion(m);
      case TransportMsg.Removed m -> {
        Running r = links.get(m.link());
        if (r != null && m.outcome() instanceof ChangeOutcome.Rejected rejected) {
          tally(r, "rejected: removal " + rejected.rejection().code().name().toLowerCase(Locale.ROOT), 1);
        }
      }
      case TransportMsg.Found m -> {
        if (m.result() instanceof QueryResult.Found found) {
          for (MapObject o : found.objects()) {
            context.store().submit(Change.deleteObject(o), STORE_TIMEOUT, Objects.requireNonNull(self), outcome -> new TransportMsg.Removed(m.link(), "object", outcome));
          }
        }
      }
      case TransportMsg.Streams m -> answer(m.request());
      case TransportMsg.Tick m -> onTick();
      case TransportMsg.OutputStatus m -> outputs = m;
    }
    refreshStatus();
  }

  private @Nullable Running current(String link, UUID run) {
    Running r = links.get(link);
    return r != null && run.equals(r.run) ? r : null;
  }

  // ------------------------------------------------------------------- settings

  /** Starts, stops and restarts tasks so that they match the settings; only a changed connection restarts. */
  private void apply(JsonObject settings) {
    record Wanted(Link link, LinkSettings settings) {}
    Map<String, Wanted> wanted = new LinkedHashMap<>();
    problems.clear();
    boolean unreadable = false;
    JsonValue value = settings.get("links");
    if (value instanceof JsonArray array) {
      for (JsonValue entry : array.values()) {
        JsonObject o = entry instanceof JsonObject j ? j : JsonObject.empty();
        if (OutLink.isOut(o)) {
          continue; // an output link: the output worker's (brief section 10)
        }
        try {
          Link link = Link.from(o);
          var w = new Wanted(link, LinkSettings.from(o, link.name()));
          boolean sameName = wanted.values().stream().anyMatch(x -> x.link().dataSource().equals(link.dataSource()));
          if (sameName || wanted.putIfAbsent(link.key(), w) != null) {
            problems.add("link " + link.name() + " is named or identified twice");
          }
        } catch (IllegalArgumentException e) {
          problems.add(e.getMessage());
          unreadable = true;
        }
      }
    }
    Map<String, Running> carried = new HashMap<>(); // a link whose connection changes: what it learnt stays in the list
    for (var it = links.entrySet().iterator(); it.hasNext(); ) {
      Running r = it.next().getValue();
      Wanted w = wanted.get(r.link.key());
      if (w == null || !r.link.sameConnection(w.link())) {
        if (w != null) {
          carried.put(r.link.key(), r);
        }
        stop(r);
        if (w == null && !unreadable) {
          removeObjects(r); // removing a link deletes its camera and arc; stopping or disabling keeps them (F3)
        } // an entry that cannot be read stops its link and keeps the objects: it may only be a mistyped value
        it.remove();
      } else {
        boolean changed = !r.link.name().equals(w.link().name()) || !r.settings.equals(w.settings());
        r.link = w.link(); // the same connection: the rest applies at once, a rename too (the link's id is the same)
        r.settings = w.settings();
        if (changed) {
          r.written = null; // the objects are written again, with the new name, colour, symbol or label
          if (r.pending == null) {
            r.pending = r.latest;
          }
        }
      }
    }
    for (Wanted w : wanted.values()) {
      if (!links.containsKey(w.link().key())) {
        Running r = new Running(w.link(), w.settings());
        Running before = carried.get(w.link().key());
        if (before != null) {
          // The link goes on with another connection (or none: disabled). Its row stays in the list, as Stopped,
          // and its objects are written again with what the link is called and set to now.
          r.video = before.video;
          r.width = before.width;
          r.height = before.height;
          r.videoSince = before.videoSince;
          r.title = before.title;
          r.lastSet = before.lastSet;
          r.lastLabel = before.lastLabel;
          r.sets = before.sets;
          r.setRate = before.setRate; // else the carried count would show as a minute's sets
          r.datagramRate = before.datagramRate; // this run counts its datagrams from 0, which the rate takes as a restart
          r.latest = before.latest;
          r.pending = before.latest;
        }
        links.put(w.link().key(), r);
        if (w.link().enabled()) {
          start(r);
        }
      }
    }
    Objects.requireNonNull(writer).targets(targets());
  }

  /** The writer's targets: one per link, with its layer and label, and its counts to the link's task. */
  private List<ObjectWriter.Target> targets() {
    var targets = new ArrayList<ObjectWriter.Target>();
    for (Running r : links.values()) {
      targets.add(new ObjectWriter.Target(r.link.name(), r.settings.targetLayer(), r.settings.label(), (name, delta) -> tally(r, name, delta)));
    }
    return targets;
  }

  private void start(Running r) {
    Link link = r.link;
    WorkerRef<TransportMsg> worker = Objects.requireNonNull(self);
    java.util.function.Supplier<ConnectionTask<LinkInbox>> factory = () -> new UdpLinkTask(link, worker);
    ConnectionSpec<LinkInbox> spec = ConnectionSpec.of(link.key(), LinkInbox.class).inbox(INBOX, Overflow.dropNewest()).restart(Restart.always(RESTART));
    try {
      r.task = context.connections().start(spec, factory, worker, TransportMsg.LinkEvent::new);
      r.lastError = null;
    } catch (IllegalArgumentException | IllegalStateException e) {
      r.lastError = "cannot start: " + e.getMessage();
    }
  }

  private void stop(Running r) {
    closeStreams(r);
    if (r.task != null) {
      r.task.stop();
    }
  }

  /** Both objects of a removed link, found in the store by their external ids. */
  private void removeObjects(Running r) {
    WorkerRef<TransportMsg> worker = Objects.requireNonNull(self);
    for (String id : List.of(Mapper.cameraId(r.link.id()), Mapper.fovId(r.link.id()))) {
      context.store().query(ObjectQuery.byExternalRef(new ExternalRef(Mapper.NAMESPACE, id)), STORE_TIMEOUT, worker,
          result -> new TransportMsg.Found(r.link.key(), result));
    }
  }

  // ------------------------------------------------------------------- the task's news

  private void onEvent(ConnectionEvent event) {
    Running r = links.get(event.task());
    if (r == null || r.task == null) {
      return; // a link that was removed: its end is our own doing
    }
    switch (event) {
      case ConnectionEvent.Running e -> r.lastError = null;
      case ConnectionEvent.Restarting e -> {
        r.up = false;
        r.lastError = e.reason();
      }
      case ConnectionEvent.Failed e -> {
        r.up = false;
        r.lastError = e.reason();
        r.task = null; // ECore does not try again; a change of the settings starts it
      }
      case ConnectionEvent.Stopped e -> r.up = false;
    }
  }

  private void onUp(TransportMsg.Up m) {
    Running r = links.get(m.link());
    if (r == null) {
      return;
    }
    closeStreams(r); // an earlier run's
    r.run = m.run();
    r.up = true;
    r.lastError = null;
    r.video = null;
    r.noVideo = false;
    r.width = 0;
    r.height = 0;
    r.datagrams = 0;
    r.bytes = 0;
    r.samples.clear();
  }

  private void onDown(TransportMsg.Down m) {
    Running r = current(m.link(), m.run());
    if (r == null) {
      return;
    }
    r.up = false;
    r.lastError = m.reason();
    closeStreams(r);
  }

  private void onChosen(TransportMsg.Chosen m) {
    Running r = current(m.link(), m.run());
    if (r == null) {
      return;
    }
    var chosen = new Video(m.videoPid(), new VideoFormat(m.videoType()), m.klvPid());
    boolean sameVideo = r.video != null && r.video.pid() == chosen.pid() && r.video.format().equals(chosen.format());
    r.video = chosen;
    r.noVideo = false;
    if (sameVideo && (r.stream != null || chosen.format().kind() == VideoFormat.Kind.OTHER)) {
      return; // only the KLV's PID changed
    }
    closeStreams(r); // a new video type closes the stream and opens it again (brief section 4)
    r.width = 0;
    r.height = 0;
    r.videoSince = now.get();
    open(r);
  }

  /** Opens the stream of a playable video (and the conversion of an MPEG-2 one) and hands them to the task. */
  private void open(Running r) {
    Video v = Objects.requireNonNull(r.video);
    if (v.format().kind() == VideoFormat.Kind.OTHER) {
      return; // listed and mapped, not played
    }
    SecurityLabel label = r.lastLabel != null ? r.lastLabel : linkLabel(r);
    try {
      StreamRef stream = context.streams().open(new StreamSpec(r.link.streamName(), "video/mp2t", WATCH, label));
      r.stream = stream;
      r.streamLabel = label;
      r.streamError = null;
      post(r, new LinkInbox.Stream(Objects.requireNonNull(r.run), stream));
    } catch (UnsupportedOperationException | IllegalStateException | IllegalArgumentException e) {
      r.streamError = e.getMessage() == null ? e.toString() : e.getMessage();
      tally(r, "stream not opened", 1);
      return;
    }
    if (v.format().kind() == VideoFormat.Kind.MPEG2) {
      startConversion(r);
    }
  }

  private void startConversion(Running r) {
    StreamRef stream = r.stream;
    UUID run = r.run;
    if (stream == null || run == null) {
      return;
    }
    String link = r.link.key();
    try {
      ConversionRef c = context.conversions().start(ConversionSpec.mpeg2ToH264(stream), Objects.requireNonNull(self),
          event -> new TransportMsg.Conversion(link, run, event));
      r.conversion = c;
      r.conversionState = "waiting";
      r.conversionFailed = false;
      r.converterMissing = false;
      post(r, new LinkInbox.Conversion(run, c));
    } catch (UnsupportedOperationException | IllegalStateException | IllegalArgumentException e) {
      r.conversion = null;
      r.conversionFailed = true;
      r.converterMissing = e instanceof UnsupportedOperationException; // ECore has no conversion service yet
      r.conversionFailedAt = now.get();
      r.conversionState = e.getMessage() == null ? e.toString() : e.getMessage();
    }
  }

  private void onConversion(TransportMsg.Conversion m) {
    Running r = current(m.link(), m.run());
    if (r == null) {
      return;
    }
    switch (m.event()) {
      case ConversionEvent.Waiting e -> {
        r.conversionState = "waiting";
        r.conversionFailed = false;
      }
      case ConversionEvent.Running e -> {
        r.conversionState = "running";
        r.conversionFailed = false;
      }
      case ConversionEvent.Stopped e -> {
        r.conversionState = null;
        r.conversion = null;
      }
      case ConversionEvent.Failed e -> {
        r.conversionState = e.failure().name().toLowerCase(Locale.ROOT) + (e.detail().isBlank() ? "" : ": " + e.detail());
        r.converterMissing = e.failure() == ConversionEvent.Failure.UNAVAILABLE;
        r.conversionFailed = true;
        r.conversionFailedAt = now.get();
        r.conversion = null;
      }
    }
  }

  private void post(Running r, LinkInbox message) {
    if (r.task != null) {
      r.task.post(message);
    }
  }

  /** Closes the link's stream and conversion; the task stops writing to them. */
  private void closeStreams(Running r) {
    if (r.conversion != null) {
      r.conversion.stop();
    }
    if (r.stream != null) {
      r.stream.close();
    }
    if (r.run != null) {
      post(r, new LinkInbox.Detach(r.run));
    }
    r.conversion = null;
    r.conversionState = null;
    r.conversionFailed = false;
    r.stream = null;
    r.streamLabel = null;
  }

  // ------------------------------------------------------------------- the tick

  private void onTick() {
    ticks++;
    Instant t = now.get();
    boolean second = ticks % 2 == 0;
    for (Running r : links.values()) {
      flush(r);
      if (r.conversionFailed && r.stream != null && r.video != null && r.video.format().kind() == VideoFormat.Kind.MPEG2
          && r.up && !r.conversionFailedAt.plus(CONVERSION_RETRY).isAfter(t)) {
        startConversion(r); // once a minute while the link runs
      }
      if (second) {
        r.datagramRate.sample(r.datagrams);
        r.setRate.sample(r.sets);
      }
    }
  }

  /** Writes the newest set, if it changes anything: the camera first, so that the arc's relation names an object that exists. */
  private void flush(Running r) {
    TransportMsg.Telemetry t = r.pending;
    if (t == null) {
      return;
    }
    r.pending = null;
    Metadata m = t.metadata();
    LabelRule.Result label = labelRule(r).label(m.security() == null ? null : m.security().classification());
    if (!label.mapped()) {
      tally(r, "unmapped classification", 1);
    }
    SecurityLabel layerLabel = r.settings.label() != null ? r.settings.label() : context.defaultLabel();
    if (context.classifications().compare(label.label(), ClassificationLimit.of(layerLabel)) == Classifications.Comparison.HIGHER) {
      tally(r, "above layer label", 1); // written with its own label (brief section 3)
    }
    r.lastLabel = label.label();
    r.title = Mapper.name(new Mapper.Placement(r.link.dataSource(), r.link.name(), label.label(), r.settings.cameraIdentity(), r.settings.cameraSymbol(),
        r.settings.fovColour(), r.settings.time()), m);
    StreamRef stream = r.stream;
    if (stream != null && !label.label().equals(r.streamLabel)) {
      stream.label(label.label());
      r.streamLabel = label.label();
    }
    String format = formatLabel(r);
    Metadata comparable = r.settings.time() == Mapper.TimeSource.STREAM ? m : withoutTime(m);
    var fingerprint = new Fingerprint(comparable, label.label(), format, r.settings);
    if (fingerprint.equals(r.written)) {
      return; // a set that changes nothing writes nothing
    }
    r.written = fingerprint;
    ObjectWriter w = Objects.requireNonNull(writer);
    String cameraId = Mapper.cameraId(r.link.id());
    String fovId = Mapper.fovId(r.link.id());
    // An object's data source is fixed when it is made (model rule 14), so after a rename both keep the one
    // they have; only a new object takes the link's present name.
    MapObject existing = w.object(cameraId) != null ? w.object(cameraId) : w.object(fovId);
    String dataSource = existing != null ? existing.content().dataSource() : r.link.dataSource();
    var placement = new Mapper.Placement(dataSource, r.link.name(), label.label(), r.settings.cameraIdentity(), r.settings.cameraSymbol(), r.settings.fovColour(),
        r.settings.time());
    if (!m.hasSensorPosition()) {
      tally(r, "no camera position", 1);
    } else {
      w.write(r.link.name(), cameraId, (stored, layerId) -> Mapper.camera(placement, m, t.received(), format, stored, layerId));
    }
    if (Mapper.Arc.of(m) == null) {
      tally(r, "no field of view", 1);
      return; // it keeps its last state
    }
    UUID camera = w.objectId(cameraId);
    if (camera != null) {
      w.write(r.link.name(), fovId, (stored, layerId) -> Mapper.fieldOfView(placement, m, t.received(), camera, stored, layerId));
    }
  }

  private static Metadata withoutTime(Metadata m) {
    return new Metadata(null, m.missionId(), m.platformDesignation(), m.imageSourceSensor(), m.heading(), m.sensorLatitude(), m.sensorLongitude(),
        m.sensorAltitude(), m.horizontalFov(), m.verticalFov(), m.relativeAzimuth(), m.relativeElevation(), m.slantRange(), m.frameCenterLatitude(),
        m.frameCenterLongitude(), m.frameCenterElevation(), m.version(), m.security());
  }

  private SecurityLabel linkLabel(Running r) {
    return r.settings.label() != null ? r.settings.label() : context.defaultLabel();
  }

  private LabelRule labelRule(Running r) {
    return new LabelRule(r.settings.mapClassification(), linkLabel(r), r.settings.classificationNames());
  }

  // ------------------------------------------------------------------- the panel's list

  /** The format as the panel names it: {@code H.264}, {@code MPEG-2 → H.264}, the other format's name. */
  private static @Nullable String formatLabel(Running r) {
    Video v = r.video;
    if (v == null) {
      return null;
    }
    return v.format().kind() == VideoFormat.Kind.MPEG2 ? "MPEG-2 → H.264" : v.format().label();
  }

  private void answer(EndpointRequest request) {
    Instant t = now.get();
    var rows = new ArrayList<JsonValue>();
    for (Running r : links.values()) {
      if (r.video == null) {
        continue; // one row per link that has received a stream
      }
      var o = JsonObject.builder();
      o.put("link", JsonString.of(r.link.id()));
      o.put("name", JsonString.of(r.link.name()));
      o.put("title", JsonString.of(r.title != null ? r.title : r.link.name()));
      StreamRef stream = r.stream;
      if (stream != null) {
        o.put("stream", JsonString.of(r.link.streamName()));
      }
      o.put("format", JsonString.of(Objects.requireNonNull(formatLabel(r))));
      o.put("playable", dev.emcc.sdk.json.JsonBoolean.of(playable(r)));
      o.put("h265", dev.emcc.sdk.json.JsonBoolean.of(r.video.format().kind() == VideoFormat.Kind.H265));
      if (r.width > 0) {
        o.put("width", JsonNumber.of(r.width));
        o.put("height", JsonNumber.of(r.height));
      }
      o.put("bitRate", JsonNumber.of(bitRate(r)));
      if (r.lastSet != null) {
        o.put("lastSet", JsonString.of(r.lastSet.toString()));
      }
      o.put("state", JsonString.of(state(r, t)));
      String message = message(r);
      if (message != null) {
        o.put("message", JsonString.of(message));
      }
      SecurityLabel label = r.streamLabel != null ? r.streamLabel : r.lastLabel != null ? r.lastLabel : linkLabel(r);
      o.put("label", JsonString.of(label.classification()));
      rows.add(o.build());
    }
    request.response().respond(HttpReply.json(200, JsonArray.of(rows.toArray(JsonValue[]::new))));
  }

  /**
   * Whether the stream can be played: a format the browser plays (or ECore converts), its stream open and
   * no failed conversion (no converter among them). It is false exactly where a running link's row says
   * {@code not-playable}; a stopped link keeps its format's answer, and a waiting one is playable once its
   * conversion has a slot.
   */
  private static boolean playable(Running r) {
    Video v = Objects.requireNonNull(r.video);
    return v.format().kind() != VideoFormat.Kind.OTHER && !r.conversionFailed && r.streamError == null;
  }

  /** {@code live}, {@code stale}, {@code waiting}, {@code not-playable} or {@code stopped}. */
  private String state(Running r, Instant t) {
    if (!r.link.enabled() || !r.up) {
      return "stopped";
    }
    if (!playable(r)) {
      return "not-playable";
    }
    if ("waiting".equals(r.conversionState)) {
      return "waiting";
    }
    Instant since = r.lastSet != null ? r.lastSet : r.videoSince;
    return Duration.between(since, t).compareTo(Duration.ofSeconds(r.settings.staleSeconds())) > 0 ? "stale" : "live";
  }

  /** What the row says beside its state, or {@code null}. */
  private @Nullable String message(Running r) {
    Video v = Objects.requireNonNull(r.video);
    if (!r.link.enabled()) {
      return "The link is switched off";
    }
    if (v.format().kind() == VideoFormat.Kind.OTHER) {
      return "Not playable: " + v.format().label();
    }
    if (r.streamError != null) {
      return "Streams are not available: " + r.streamError;
    }
    if (r.conversionFailed) {
      return r.converterMissing ? "No converter installed" : "Conversion failed: " + r.conversionState;
    }
    if ("waiting".equals(r.conversionState)) {
      return "Waiting for a conversion slot";
    }
    return null;
  }

  /** Bits a second over the last 5 s of the task's totals. */
  private long bitRate(Running r) {
    if (r.samples.size() < 2) {
      return 0;
    }
    long[] first = r.samples.peekFirst();
    long[] last = r.samples.peekLast();
    long seconds = Math.max(1, last[0] - first[0]);
    return Math.max(0, (last[1] - first[1]) * 8 / seconds);
  }

  // ------------------------------------------------------------------- status

  private void tally(Running r, String name, long delta) {
    if (r.task != null) {
      r.task.count(name, delta);
    }
    if (WARNED.contains(name)) {
      Instant t = now.get();
      Instant last = r.warned.get(name);
      if (last == null || !last.plus(WARN_EVERY).isAfter(t)) {
        r.warned.put(name, t);
        context.log().warn("{}: {}", r.link.name(), name);
      }
    }
  }

  /** One line per link in the plugin's status (brief section 6). */
  private void refreshStatus() {
    List<String> parts = new ArrayList<>(problems);
    boolean degraded = !problems.isEmpty();
    for (Running r : links.values()) {
      String state;
      if (!r.link.enabled()) {
        state = "stopped";
      } else if (r.task == null || (!r.up && r.lastError != null)) {
        state = "down: " + (r.lastError == null ? "not started" : r.lastError);
        degraded = true;
      } else if (!r.up) {
        state = "starting";
      } else if (r.video == null) {
        state = r.noVideo ? "No video in the stream" : "Listening";
      } else if (r.video.format().kind() == VideoFormat.Kind.OTHER) {
        state = "Not playable: " + r.video.format().label();
      } else if (r.streamError != null) {
        state = "Streams are not available: " + r.streamError;
        degraded = true;
      } else if (r.conversionFailed) {
        state = r.converterMissing ? "No converter installed" : "Conversion failed: " + r.conversionState;
        degraded = true;
      } else if ("waiting".equals(r.conversionState)) {
        state = "Waiting for a conversion slot";
      } else {
        state = "Receiving " + formatLabel(r);
      }
      parts.add(r.link.name() + " [" + r.link.where() + "]: " + state + ", " + r.setRate.perMinute(r.sets) + " sets/min, "
          + r.datagramRate.perMinute(r.datagrams) + " datagrams/min");
    }
    parts.addAll(outputs.lines());
    degraded |= outputs.degraded();
    String detail = parts.isEmpty() ? "no links" : String.join("; ", parts);
    if (detail.length() > PluginStatus.MAX_DETAIL) {
      detail = detail.substring(0, PluginStatus.MAX_DETAIL - 3) + "...";
    }
    context.status().set(degraded ? PluginState.DEGRADED : PluginState.OK, detail);
  }
}
