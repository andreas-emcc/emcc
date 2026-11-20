package dev.emcc.plugins.adsb;

import dev.emcc.plugins.adsb.transport.TcpClientLinkTask;
import dev.emcc.sdk.LayerChoice;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.PluginStatus;
import dev.emcc.sdk.connection.Backoff;
import dev.emcc.sdk.connection.ConnectionEvent;
import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.connection.ConnectionSpec;
import dev.emcc.sdk.connection.Restart;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.store.ObjectWriter;
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
import java.util.UUID;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * The worker that owns the links and the aircraft: it reads the {@code links} setting, runs one
 * connection task per link, keeps each link's aircraft (the state across lines, {@link AircraftTable}),
 * and hands the aircraft that have a position to the SDK's {@link ObjectWriter}, which writes them into
 * the object store: the target layer, one change request in flight per aircraft with the latest state
 * winning, and the objects found again by their identity after a restart (SDK 1.4.0, T-147). A handler
 * handles one message at a time, so its fields need no locks; it never blocks.
 *
 * <p>A line that changes nothing for an aircraft sends nothing: the state last written for it is kept
 * here, and forgotten with the aircraft.
 */
public final class LinkWorker implements Handler<AdsbMsg> {

  /** The worker's mailbox. Settings, writer answers and task events are always delivered; lines are dropped when it is full, and counted. */
  public static final int MAILBOX = 10_000;

  /** The most bytes of one SBS-1 line; a full line is about 120. Longer lines are dropped. */
  static final int MAX_FRAME_BYTES = 256;

  /** A run that ends is started again after 1 s, then up to 60 s. */
  static final Backoff RESTART = Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60));

  private final PluginContext context;
  private final Supplier<Instant> now;
  /** The links by name, in the order of the settings. */
  private final Map<String, Running> links = new LinkedHashMap<>();
  private final List<String> problems = new ArrayList<>();
  /** The state last written for each aircraft, to send nothing that changes nothing. */
  private final Map<String, Signature> sent = new LinkedHashMap<>();
  private @Nullable WorkerRef<AdsbMsg> self;
  private @Nullable ObjectWriter writer;

  /** What an object is written as: the aircraft's state and the link's settings that shape it. */
  private record Signature(Aircraft aircraft, Identity identity, @Nullable SecurityLabel label, @Nullable LayerChoice target) {}

  /** One link and its task. */
  private static final class Running {
    /** The link as the settings give it now: a change of its layer, label or identity does not reconnect. */
    Link link;
    final AircraftTable table = new AircraftTable();
    @Nullable ConnectionRef<Message> task;
    /** The runs that have their socket now, with their peer. */
    final Map<UUID, String> up = new LinkedHashMap<>();
    @Nullable String lastError;
    long received;
    long updated;
    long minuteReceived;
    long minuteUpdated;
    long lastMinuteReceived;
    long lastMinuteUpdated;

    Running(Link link) {
      this.link = link;
    }
  }

  LinkWorker(PluginContext context, Supplier<Instant> now) {
    this.context = context;
    this.now = now;
  }

  /** Spawns the worker; then subscribe it, as {@link AdsbPlugin} does. */
  static WorkerRef<AdsbMsg> spawn(PluginContext context, Supplier<Instant> now) {
    return context.workers().spawn(WorkerSpec.of("links", AdsbMsg.class, () -> new LinkWorker(context, now)).mailbox(MAILBOX, Overflow.dropNewest()));
  }

  @Override
  public void handle(AdsbMsg message, WorkerContext<AdsbMsg> ctx) {
    self = ctx.self();
    if (writer == null) {
      // Made with the worker, so that a restarted worker subscribes again and gets the objects back.
      writer = ObjectWriter.create(context, ctx.self(), AircraftMapper.EXTERNAL_SYSTEM, AdsbMsg.Writer::new);
      writer.fieldSet("adsb.aircraft"); // SDK 1.5.0 (brief section 10, item 1): every aircraft carries the set from its create
      writer.start();
    }
    switch (message) {
      case AdsbMsg.SettingsChanged m -> apply(m.settings());
      case AdsbMsg.LinkEvent m -> onEvent(m.event());
      case AdsbMsg.Up m -> {
        Running r = links.get(m.link());
        if (r != null) {
          r.up.put(m.run(), m.peer());
          r.lastError = null;
        }
      }
      case AdsbMsg.Down m -> {
        Running r = links.get(m.link());
        if (r != null && r.up.remove(m.run()) != null) {
          r.lastError = m.reason();
        }
      }
      case AdsbMsg.Received m -> onReceived(m);
      case AdsbMsg.Sweep m -> onSweep();
      case AdsbMsg.Writer m -> writer.handle(m.reply());
    }
    refreshStatus();
  }

  /**
   * Starts, stops and restarts tasks so that they match the settings. A link whose connection fields
   * (name, host, port, idle time, enabled) are unchanged keeps its task: its layer, label and identity
   * follow in the writer's targets, without a reconnect.
   */
  private void apply(JsonObject settings) {
    Map<String, Link> wanted = new LinkedHashMap<>();
    problems.clear();
    JsonValue value = settings.get("links");
    if (value instanceof JsonArray array) {
      for (JsonValue entry : array.values()) {
        try {
          Link link = Link.from(entry instanceof JsonObject o ? o : JsonObject.empty());
          if (wanted.putIfAbsent(link.name(), link) != null) {
            problems.add("link " + link.name() + " is named twice");
          }
        } catch (IllegalArgumentException e) {
          problems.add(e.getMessage());
        }
      }
    }
    for (var it = links.values().iterator(); it.hasNext(); ) {
      Running r = it.next();
      Link next = wanted.get(r.link.name());
      if (next == null || !r.link.sameConnection(next)) {
        if (r.task != null) {
          r.task.stop();
        }
        it.remove();
      } else {
        r.link = next;
      }
    }
    for (Link link : wanted.values()) {
      if (!links.containsKey(link.name())) {
        Running r = new Running(link);
        links.put(link.name(), r);
        if (link.enabled()) {
          start(r);
        }
      }
    }
    writer.targets(targets());
  }

  /** The writer's targets: one per link, with the link's layer and label, and its counts to the link's task. */
  private List<ObjectWriter.Target> targets() {
    List<ObjectWriter.Target> targets = new ArrayList<>();
    for (Running r : links.values()) {
      targets.add(new ObjectWriter.Target(r.link.name(), r.link.target(), r.link.label(), (name, delta) -> writerCount(r, name, delta)));
    }
    return targets;
  }

  private void start(Running r) {
    Link link = r.link;
    WorkerRef<AdsbMsg> worker = Objects.requireNonNull(self);
    ConnectionSpec<Message> spec = ConnectionSpec.of(link.name(), Message.class).restart(Restart.always(RESTART));
    try {
      r.task = context.connections().start(spec, () -> new TcpClientLinkTask(link, worker, MAX_FRAME_BYTES), worker, AdsbMsg.LinkEvent::new);
    } catch (IllegalArgumentException | IllegalStateException e) {
      r.lastError = "cannot start: " + e.getMessage();
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
        r.up.clear(); // its runs ended with it
        r.lastError = e.reason();
      }
      case ConnectionEvent.Failed e -> {
        r.up.clear();
        r.lastError = e.reason();
        r.task = null; // ECore does not try again; a change of the settings starts it
      }
      case ConnectionEvent.Stopped e -> r.up.clear();
    }
  }

  /** One SBS-1 message: the aircraft's state, and a write if it has a position and something changed. */
  private void onReceived(AdsbMsg.Received m) {
    Running r = links.get(m.link());
    if (r == null) {
      return;
    }
    Instant at = now.get();
    Sbs1.Message message = m.message();
    r.received++;
    r.minuteReceived++;
    if (message.noPosition()) {
      count(r, "no position", 1);
    }
    AircraftTable.Update update = r.table.update(message, at);
    if (!update.evicted().isEmpty()) {
      count(r, "aircraft forgotten", update.evicted().size());
      update.evicted().forEach(this::forgetSent);
    }
    if (update.created() && !update.aircraft().hasPosition()) {
      count(r, "aircraft waiting", 1);
    }
    if (update.aircraft().hasPosition()) {
      write(r, update.aircraft(), at);
    }
  }

  /** Hands an aircraft's object to the writer, unless the state last written is the same. */
  private void write(Running r, Aircraft aircraft, Instant observed) {
    Link link = r.link;
    String icao = aircraft.icao24();
    var signature = new Signature(aircraft, link.identity(), link.label(), link.target());
    if (signature.equals(sent.get(icao))) {
      return; // a line that changes nothing sends nothing
    }
    SecurityLabel label = link.label() != null ? link.label() : context.defaultLabel();
    Objects.requireNonNull(writer).write(link.name(), icao, (stored, layerId) -> {
      sent.put(icao, signature);
      // An object keeps the data source it was created with (model rule 14); the layer is the writer's.
      String dataSource = stored != null ? stored.content().dataSource() : link.name();
      return AircraftMapper.content(aircraft, layerId, dataSource, label, link.identity(), observed);
    });
  }

  /** Every minute: forgets the aircraft that have gone quiet, and rolls the counts of the last minute. */
  private void onSweep() {
    Instant at = now.get();
    for (Running r : links.values()) {
      List<String> forgotten = r.table.forget(at);
      if (!forgotten.isEmpty()) {
        count(r, "aircraft forgotten", forgotten.size());
        forgotten.forEach(this::forgetSent);
      }
      r.lastMinuteReceived = r.minuteReceived;
      r.lastMinuteUpdated = r.minuteUpdated;
      r.minuteReceived = 0;
      r.minuteUpdated = 0;
    }
  }

  /** Forgets the state last written for an aircraft that no link holds any more, so the memory does not grow over a long run. */
  private void forgetSent(String icao) {
    if (links.values().stream().noneMatch(o -> o.table.get(icao) != null)) {
      sent.remove(icao);
    }
  }

  /** The writer's counts: its "objects" are this plugin's aircraft; the names of the status stay as they were. */
  private static void writerCount(Running r, String name, long delta) {
    if (name.equals("objects created") || name.equals("objects updated")) {
      r.updated += delta;
      r.minuteUpdated += delta;
      count(r, name.replace("objects", "aircraft"), delta);
    } else {
      count(r, name, delta);
    }
  }

  private static void count(Running r, String name, long delta) {
    if (r.task != null) {
      r.task.count(name, delta);
    }
  }

  /** One line per link in the plugin's status, as the playbook's work package 4 says. */
  private void refreshStatus() {
    List<String> parts = new ArrayList<>(problems);
    boolean degraded = !problems.isEmpty();
    for (Running r : links.values()) {
      String state;
      if (!r.link.enabled()) {
        state = "switched off";
      } else if (r.task == null || (r.lastError != null && r.up.isEmpty())) {
        state = "down: " + (r.lastError == null ? "not started" : r.lastError);
        degraded = true;
      } else {
        state = r.up.isEmpty() ? "connecting" : "up";
      }
      parts.add(r.link.name() + " [in " + r.link.where() + "]: " + state
          + ", " + r.lastMinuteReceived + " lines a minute, " + r.table.size() + " aircraft, "
          + r.lastMinuteUpdated + " updated a minute, layer \"" + layerStatus(r.link) + "\"");
    }
    String detail = parts.isEmpty() ? "no links" : String.join("; ", parts);
    if (detail.length() > PluginStatus.MAX_DETAIL) {
      detail = detail.substring(0, PluginStatus.MAX_DETAIL - 3) + "...";
    }
    context.status().set(degraded ? PluginState.DEGRADED : PluginState.OK, detail);
  }

  /** The layer the writer uses for the link, and whether it is made yet. */
  private String layerStatus(Link link) {
    ObjectWriter.Stats stats = Objects.requireNonNull(writer).stats(link.name());
    return stats.layerName() != null ? stats.layerName() : link.layerName() + " (made with the first aircraft)";
  }
}
