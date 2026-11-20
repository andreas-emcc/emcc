package dev.emcc.plugins.gmti.transport;

import dev.emcc.plugins.gmti.format.Dwell;
import dev.emcc.plugins.gmti.format.FreeText;
import dev.emcc.plugins.gmti.format.Packet;
import dev.emcc.plugins.gmti.format.PacketHeader;
import dev.emcc.plugins.gmti.format.Segment;
import dev.emcc.plugins.gmti.in.Colours;
import dev.emcc.plugins.gmti.in.Fades;
import dev.emcc.plugins.gmti.in.LabelRule;
import dev.emcc.plugins.gmti.in.Mapper;
import dev.emcc.plugins.gmti.in.Receiver;
import dev.emcc.plugins.gmti.out.Sender;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.ClassificationLimit;
import dev.emcc.sdk.Classifications;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.PluginStatus;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.channel.ChannelKind;
import dev.emcc.sdk.channel.ChannelRef;
import dev.emcc.sdk.channel.ChannelSpec;
import dev.emcc.sdk.channel.SensorType;
import dev.emcc.sdk.connection.Backoff;
import dev.emcc.sdk.connection.ConnectionEvent;
import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.connection.ConnectionSpec;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.Restart;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.ObjectWriter;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerContext;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * The worker that owns the links (brief sections 4 and 5): it reads the {@code links} setting,
 * starts one connection task per link, and
 * <ul>
 *   <li>for an {@code in} link, keeps its {@link Receiver} and writes what it makes through the SDK's
 *       {@link ObjectWriter}: the platform, its dwell area and the detections, into the link's layer;
 *   <li>for an {@code out} link, offers an output channel that takes sensor reports only, and posts
 *       each dwell it gets, as the {@link Sender}'s packets, into the link's task inbox.
 * </ul>
 * A change of a link's connection restarts its task; a change of its other settings (layer, label,
 * symbol, cap, time, classification, ...) applies at once (work package 3). A handler handles one
 * message at a time, so its fields need no locks; it never blocks.
 */
public final class LinkWorker implements Handler<TransportMsg> {

  /** The worker's mailbox. Settings, task events and store answers are always delivered; packets are dropped when it is full, and counted. */
  public static final int MAILBOX = 10_000;

  /** The inbox of a link's task: the latest dwell per sensor. */
  static final int INBOX = 10_000;

  /** A run that ends is started again after 1 s, then up to 60 s. */
  static final Backoff RESTART = Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60));

  private static final Duration TICK = Duration.ofSeconds(1);
  private static final Duration STORE_TIMEOUT = Duration.ofSeconds(10);
  private static final Duration WARN_EVERY = Duration.ofMinutes(1);

  /** The counters that are also warned of, once a minute per link and reason; the others are counted only. */
  private static final Set<String> WARNED = Set.of(
      "dropped: no mission", "skipped: over cap", "label not mapped", "above layer label", "detections above highest", "beyond reach");

  private final PluginContext context;
  private final Supplier<Instant> now;
  /** The links by name, in the order of the settings. */
  private final Map<String, Running> links = new LinkedHashMap<>();
  private final List<String> problems = new ArrayList<>();
  /** The outlines' colours, the same for every link (T-181, T-185): a change applies from each shape's next write. */
  private Colours colours = Colours.DEFAULTS;
  private @Nullable WorkerRef<TransportMsg> self;
  private @Nullable ObjectWriter writer;
  private @Nullable Cancellable ticker;

  /** One link: its settings, its task, and what it did. */
  private static final class Running {
    final Link link;
    LinkSettings settings;
    @Nullable ConnectionRef<LinkInbox> task;
    /** The runs that have their socket now, with their peer; for a TCP server, one per client. */
    final Map<UUID, String> up = new LinkedHashMap<>();
    @Nullable String lastError;
    boolean listening;
    // in
    @Nullable Receiver receiver;
    final Set<String> platforms = new HashSet<>();
    long packets;
    long dwells;
    long reports;
    long detections;
    long areas;
    // out
    @Nullable Sender sender;
    @Nullable ChannelRef channel;
    final Map<String, Long> serials = new HashMap<>();
    long sent;
    long dropped;
    // per minute (work package 4)
    final Rate packetRate = new Rate();
    final Rate dwellRate = new Rate();
    final Rate reportRate = new Rate();
    final Rate sentRate = new Rate();
    /** When each reason was last warned of (ADR-0037 point 7: at most once a minute per link and reason). */
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

  /** Spawns the worker; then subscribe it to the settings, as {@code GmtiPlugin} does. */
  public static WorkerRef<TransportMsg> spawn(PluginContext context, Supplier<Instant> now) {
    return context.workers().spawn(
        WorkerSpec.of("links", TransportMsg.class, () -> new LinkWorker(context, now)).mailbox(MAILBOX, Overflow.dropNewest()));
  }

  @Override
  public void handle(TransportMsg message, WorkerContext<TransportMsg> ctx) {
    self = ctx.self();
    if (writer == null) {
      // Made with the worker, so that a restarted worker subscribes again and finds its objects.
      writer = ObjectWriter.create(context, ctx.self(), Mapper.NAMESPACE, TransportMsg.Writer::new);
      writer.start();
      ticker = context.timers().every(TICK, ctx.self(), new TransportMsg.Tick());
    }
    switch (message) {
      case TransportMsg.Writer m -> {
        writer.handle(m.reply());
        return; // many a second: the status follows at the next tick
      }
      case TransportMsg.SettingsChanged m -> apply(m.settings());
      case TransportMsg.LinkEvent m -> onEvent(m.event());
      case TransportMsg.Listening m -> {
        Running r = links.get(m.link());
        if (r != null) {
          r.listening = true;
          r.lastError = null;
        }
      }
      case TransportMsg.Up m -> {
        Running r = links.get(m.link());
        if (r != null) {
          r.up.put(m.run(), m.peer());
          r.lastError = null;
        }
      }
      case TransportMsg.Down m -> {
        Running r = links.get(m.link());
        if (r != null && r.up.remove(m.run()) != null && r.link.mode() != Link.Mode.TCP_SERVER) {
          r.lastError = m.reason(); // a TCP server's client that goes is no problem of the link
        }
      }
      case TransportMsg.Received m -> onPacket(m);
      case TransportMsg.FromChannel m -> onChannelItem(m);
      case TransportMsg.Outgoing m -> {
        Running r = links.get(m.link());
        if (r != null) {
          post(r, m.key(), m.packets());
        }
      }
      case TransportMsg.Sent m -> {
        Running r = links.get(m.link());
        if (r != null) {
          r.sent++;
          r.dropped += m.dropped();
        }
      }
      case TransportMsg.Removed m -> {
        Running r = links.get(m.link());
        if (r != null && m.outcome() instanceof ChangeOutcome.Rejected rejected) {
          tally(r, "rejected: " + m.what() + " removal " + rejected.rejection().code().name().toLowerCase(java.util.Locale.ROOT), 1);
        }
      }
      case TransportMsg.Tick m -> onTick();
    }
    refreshStatus();
  }

  // ------------------------------------------------------------------- settings

  /** Starts, stops and restarts tasks so that they match the settings; only a changed connection restarts. */
  private void apply(JsonObject settings) {
    record Wanted(Link link, LinkSettings settings) {}
    Map<String, Wanted> wanted = new LinkedHashMap<>();
    problems.clear();
    try {
      colours = Colours.from(settings);
    } catch (IllegalArgumentException e) {
      colours = Colours.DEFAULTS; // a value the schema refuses, should one get through: the defaults, and the problem named
      problems.add(e.getMessage());
    }
    problems.addAll(Fades.problems(settings)); // T-192: the map view draws the fades; a fade that ends before it starts is named
    JsonValue value = settings.get("links");
    if (value instanceof JsonArray array) {
      for (JsonValue entry : array.values()) {
        JsonObject o = entry instanceof JsonObject j ? j : JsonObject.empty();
        try {
          Link link = Link.from(o);
          var w = new Wanted(link, LinkSettings.from(o, link.name()));
          if (wanted.putIfAbsent(link.name(), w) != null) {
            problems.add("link " + link.name() + " is named twice");
          }
        } catch (IllegalArgumentException e) {
          problems.add(e.getMessage());
        }
      }
    }
    for (var it = links.values().iterator(); it.hasNext(); ) {
      Running r = it.next();
      Wanted w = wanted.get(r.link.name());
      if (w == null || !r.link.equals(w.link())) {
        stop(r);
        it.remove();
      } else {
        r.settings = w.settings(); // the same connection: the rest applies at once
        if (r.receiver != null) {
          r.receiver.settings(w.settings().maxReportsPerDwell(), w.settings().time(), w.settings().coverage(), new Sink(r));
        }
        if (r.sender != null) {
          r.sender.settings(senderSettings(r));
        }
      }
    }
    for (Wanted w : wanted.values()) {
      if (!links.containsKey(w.link().name())) {
        Running r = new Running(w.link(), w.settings());
        // Made with the link, not its task: a link switched off keeps its state, and tests feed it packets.
        if (w.link().direction().receives()) {
          r.receiver = new Receiver(w.settings().maxReportsPerDwell(), w.settings().time(), w.settings().coverage());
        } else {
          r.sender = new Sender(senderSettings(r), context.classifications(), now.get());
        }
        links.put(w.link().name(), r);
        if (w.link().enabled()) {
          start(r);
        }
      }
    }
    Objects.requireNonNull(writer).targets(targets());
  }

  /** The writer's targets: one per {@code in} link, with its layer and label, and its counts to the link's task. */
  private List<ObjectWriter.Target> targets() {
    var targets = new ArrayList<ObjectWriter.Target>();
    for (Running r : links.values()) {
      if (r.link.direction().receives()) {
        targets.add(new ObjectWriter.Target(r.link.name(), r.settings.targetLayer(), r.settings.label(), (name, delta) -> tally(r, name, delta)));
      }
    }
    return targets;
  }

  private void start(Running r) {
    Link link = r.link;
    WorkerRef<TransportMsg> worker = Objects.requireNonNull(self);
    Supplier<ConnectionTask<LinkInbox>> factory = switch (link.mode()) {
      case UDP -> () -> new UdpLinkTask(link, worker);
      case TCP_CLIENT -> () -> new TcpClientLinkTask(link, worker);
      case TCP_SERVER -> () -> new TcpServerLinkTask(link, worker);
    };
    ConnectionSpec<LinkInbox> spec = ConnectionSpec.of(link.name(), LinkInbox.class).inbox(INBOX, Overflow.coalesceByKey()).restart(Restart.always(RESTART));
    try {
      r.task = context.connections().start(spec, factory, worker, TransportMsg.LinkEvent::new);
    } catch (IllegalArgumentException | IllegalStateException e) {
      r.lastError = "cannot start: " + e.getMessage();
      return;
    }
    if (link.direction().sends()) {
      var channel = ChannelSpec.of(link.name(), link.name() + " (GMTI)", Mapper.NAMESPACE).kinds(Set.of(ChannelKind.SENSOR_REPORTS))
          .sensorTypes(Set.of(SensorType.GROUND_RADAR)) // T-169: a sender offers gmti its ground radars only
          .fieldSet(Mapper.FIELD_SET)
          .maxAreaDepth(Sender.MAX_AREA_DEPTH_METRES); // CR-0035: what D26 holds, so the simulator warns about what is left out
      try {
        r.channel = context.channels().offer(channel, worker, item -> new TransportMsg.FromChannel(link.name(), item));
      } catch (IllegalArgumentException | IllegalStateException e) {
        r.lastError = "cannot offer its channel: " + e.getMessage();
      }
    }
  }

  private void stop(Running r) {
    if (r.task != null) {
      r.task.stop();
    }
    if (r.channel != null) {
      r.channel.withdraw();
    }
  }

  private Sender.Settings senderSettings(Running r) {
    LinkSettings s = r.settings;
    SecurityLabel label = s.label() != null ? s.label() : context.defaultLabel();
    ClassificationLimit highest = s.highestClassification() != null ? s.highestClassification() : policysHighest(label);
    int maxPacket = r.link.mode() == Link.Mode.UDP ? UdpLinkTask.MAX_PAYLOAD : dev.emcc.plugins.gmti.format.Decoder.MAX_PACKET;
    return new Sender.Settings(s.nationality(), s.exercise(), s.maxReportsPerSegment(), maxPacket, label, highest, s.classificationNames(),
        s.oneSegmentPerPacket());
  }

  /** The highest classification of the label's policy (brief section 5's default), else the label's own. */
  private ClassificationLimit policysHighest(SecurityLabel label) {
    List<String> order = context.classifications().order(label.policyIdentifier().name());
    return order.isEmpty() ? ClassificationLimit.of(label) : new ClassificationLimit(label.policyIdentifier().name(), order.getLast());
  }

  // ------------------------------------------------------------------- in

  private void onPacket(TransportMsg.Received m) {
    Running r = links.get(m.link());
    if (r == null || r.receiver == null) {
      return;
    }
    Packet p = m.packet();
    r.packets++;
    for (Segment s : p.segments()) {
      if (s instanceof Dwell d) {
        r.dwells++;
        r.reports += d.reports().size();
      }
    }
    LabelRule.Result label = labelRule(r).label(p.header().classification());
    if (!label.mapped()) {
      tally(r, "label not mapped", 1);
    }
    SecurityLabel layer = r.settings.label() != null ? r.settings.label() : context.defaultLabel();
    if (context.classifications().compare(label.label(), ClassificationLimit.of(layer)) == Classifications.Comparison.HIGHER) {
      tally(r, "above layer label", 1); // written with its own label (brief section 3)
    }
    r.receiver.packet(p, now.get(), new Sink(r));
  }

  private LabelRule labelRule(Running r) {
    SecurityLabel link = r.settings.label() != null ? r.settings.label() : context.defaultLabel();
    return new LabelRule(r.settings.mapClassification(), link, r.settings.classificationNames());
  }

  /** What one link's receiver makes, written through the writer. */
  private final class Sink implements Receiver.Sink {
    private final Running r;

    Sink(Running r) {
      this.r = r;
    }

    private Mapper.Placement placement(UUID layerId, PacketHeader header) {
      return new Mapper.Placement(r.link.name(), layerId, labelRule(r).label(header.classification()).label(), r.settings.platformIdentity(),
          r.settings.platformSymbol(), colours);
    }

    @Override
    public void platform(Receiver.PlatformFix fix) {
      String link = r.link.name();
      if (r.platforms.add(fix.platformId())) {
        tally(r, "platforms", 1);
      }
      Objects.requireNonNull(writer).write(link, Mapper.platformId(link, fix.platformId()),
          (stored, layerId) -> Mapper.platform(placement(layerId, fix.header()), fix, stored));
    }

    @Override
    public void area(Receiver.AreaFix fix) {
      String link = r.link.name();
      r.areas++;
      tally(r, "areas written", 1);
      // M8, T-195: each dwell its own area, written once and forgotten (no list, no cap): its fade and its data type's expiry
      // remove it. A dwell received again finds its area and writes nothing.
      Objects.requireNonNull(writer).write(link, Mapper.areaId(link, fix),
          (stored, layerId) -> stored != null ? null : Mapper.area(placement(layerId, fix.header()), fix, null));
    }

    @Override
    public void coverage(Receiver.CoverageFix fix) {
      String link = r.link.name();
      String id = Mapper.coverageId(link, fix.platformId());
      if (fix.coverage() == null) {
        MapObject stored = Objects.requireNonNull(writer).object(id);
        if (stored != null) {
          context.store().submit(Change.deleteObject(stored), STORE_TIMEOUT, Objects.requireNonNull(self), o -> new TransportMsg.Removed(link, "coverage", o));
        }
        return;
      }
      tally(r, "coverages written", 1);
      Objects.requireNonNull(writer).write(link, id, (stored, layerId) -> Mapper.coverage(placement(layerId, fix.header()), fix, stored));
    }

    @Override
    public void detection(Receiver.DetectionFix fix) {
      String link = r.link.name();
      r.detections++;
      tally(r, "detections written", 1);
      // Paired with its platform, written just before in the same dwell: the writer gives the id it will
      // create it with (SDK 1.4.0 part 4), so the link's first dwell pairs too (ADR-0051 point 8).
      UUID platform = Objects.requireNonNull(writer).objectId(Mapper.platformId(link, fix.platformId()));
      if (platform == null) {
        tally(r, "detections not paired", 1);
      }
      // Never updated: a report received again finds its object and writes nothing (brief section 3).
      writer.write(link, Mapper.detectionId(link, fix),
          (stored, layerId) -> stored != null ? null : Mapper.detection(placement(layerId, fix.header()), fix, platform));
    }

    @Override
    public void count(String name, long delta) {
      LinkWorker.this.tally(r, name, delta);
    }

    @Override
    public void freeText(String platformId, FreeText text) {
      context.log().debug("{}: a free text from {} ({} characters)", r.link.name(), platformId, text.text().length());
    }

    @Override
    public void version(String version) {
      context.log().info("{}: packets of version {} are read as Edition A, by their existence masks", r.link.name(), version);
    }
  }

  // ------------------------------------------------------------------- out

  private void onChannelItem(TransportMsg.FromChannel m) {
    Running r = links.get(m.link());
    if (r == null || r.sender == null) {
      return;
    }
    if (!(m.item() instanceof ChannelItem.SensorReport dwell)) {
      tally(r, "skipped: not a sensor report", 1); // the channel takes sensor reports only: the SDK does not send others
      return;
    }
    SensorType type = dwell.sensor() == null ? null : dwell.sensor().type();
    if (type != null && type != SensorType.GROUND_RADAR) {
      tally(r, "not a ground radar", 1); // T-169: STANAG 4607 is a ground radar's; a report without a type goes as in M5
      return;
    }
    if (r.up.isEmpty()) {
      tally(r, "skipped: not connected", 1);
      return;
    }
    Sender.Result result = r.sender.dwell(dwell);
    if (result.aboveHighest() > 0) {
      tally(r, "detections above highest", result.aboveHighest());
    }
    if (!result.labelMapped()) {
      tally(r, "label not mapped", 1);
    }
    for (String field : result.notHeld()) {
      tally(r, "not held: " + field, 1); // once per dwell and field (R3; D26 from JS)
    }
    if (result.beyondReach() > 0) {
      tally(r, "beyond reach", result.beyondReach());
    }
    if (result.missionCut()) {
      tally(r, "mission cut", 1); // once per sensor while the link runs (CR-0034)
    }
    post(r, inboxKey(dwell), result.packets().stream().map(Bytes::of).toList());
  }

  /**
   * The key the link's inbox keeps the latest packets by: the sensor, and for a report with a
   * sequence the sensor and dwell number, so that a revisit's dwells do not replace each other
   * (CR-0040), as the channel's inbox keeps them ({@code ChannelItem.coalesceKey}).
   */
  static String inboxKey(ChannelItem.SensorReport report) {
    return report.sequence() == null ? report.sensorId().toString() : report.sensorId() + "/" + report.sequence().dwell();
  }

  private void post(Running r, String key, List<Bytes> packets) {
    if (r.task == null || !r.link.direction().sends()) {
      return;
    }
    if (r.up.isEmpty()) {
      r.task.count("skipped: not connected", 1);
    } else if (r.task.post(new LinkInbox.Send(key, r.serials.merge(key, 1L, Long::sum), packets)) != SendResult.ACCEPTED) {
      r.task.count("skipped: inbox closed", 1);
    }
  }

  // ------------------------------------------------------------------- the rest

  private void onTick() {
    Instant t = now.get();
    for (Running r : links.values()) {
      if (r.receiver != null) {
        r.receiver.tick(t, new Sink(r));
      }
      r.packetRate.sample(r.packets);
      r.dwellRate.sample(r.dwells);
      r.reportRate.sample(r.reports);
      r.sentRate.sample(r.sent);
    }
  }

  private void tally(Running r, String name, long delta) {
    if (r.task != null) {
      r.task.count(name, delta);
    }
    if (WARNED.contains(name) || name.startsWith("rejected: ") || name.startsWith("not held: ")) {
      Instant t = now.get();
      Instant last = r.warned.get(name);
      if (last == null || !t.isBefore(last.plus(WARN_EVERY))) {
        r.warned.put(name, t);
        context.log().warn("{}: {} ({}); more are counted, not logged, for a minute", r.link.name(), name, delta);
      }
    }
  }

  private void onEvent(ConnectionEvent event) {
    Running r = links.get(event.task());
    if (r == null || r.task == null) {
      return; // a link that was removed: its end is our own doing
    }
    switch (event) {
      case ConnectionEvent.Running e -> r.lastError = null;
      case ConnectionEvent.Restarting e -> {
        r.up.clear(); // its children ended with it
        r.listening = false;
        r.lastError = e.reason();
      }
      case ConnectionEvent.Failed e -> {
        r.up.clear();
        r.listening = false;
        r.lastError = e.reason();
        r.task = null; // ECore does not try again; a change of the settings starts it
      }
      case ConnectionEvent.Stopped e -> {
        r.up.clear();
        r.listening = false;
      }
    }
  }

  /** One part per link in the plugin's status (the playbook, work package 4). */
  private void refreshStatus() {
    List<String> parts = new ArrayList<>(problems);
    boolean degraded = !problems.isEmpty();
    for (Running r : links.values()) {
      String state;
      if (!r.link.enabled()) {
        state = "switched off";
      } else if (r.task == null || (r.lastError != null && r.up.isEmpty() && !r.listening)) {
        state = "down: " + (r.lastError == null ? "not started" : r.lastError);
        degraded = true;
      } else if (r.link.mode() == Link.Mode.TCP_SERVER) {
        state = !r.listening ? "starting" : "listening, " + r.up.size() + (r.up.size() == 1 ? " client" : " clients");
      } else {
        state = r.up.isEmpty() ? "connecting" : "up";
      }
      String what = r.link.direction().receives()
          ? r.packetRate.perMinute(r.packets) + " packets, " + r.dwellRate.perMinute(r.dwells) + " dwells, " + r.reportRate.perMinute(r.reports)
              + " reports a minute, " + r.platforms.size() + " platforms"
          : r.sentRate.perMinute(r.sent) + " dwells sent a minute, " + r.dropped + " dropped";
      parts.add(r.link.name() + " [" + r.link.where() + "]: " + state + ", " + what);
    }
    String detail = parts.isEmpty() ? "no links" : String.join("; ", parts);
    if (detail.length() > PluginStatus.MAX_DETAIL) {
      detail = detail.substring(0, PluginStatus.MAX_DETAIL - 3) + "...";
    }
    context.status().set(degraded ? PluginState.DEGRADED : PluginState.OK, detail);
  }
}
