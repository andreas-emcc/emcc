package dev.emcc.plugins.ais.transport;

import dev.emcc.plugins.ais.Ships;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginLog;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.PluginStatus;
import dev.emcc.sdk.connection.Backoff;
import dev.emcc.sdk.connection.ConnectionEvent;
import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.connection.ConnectionSpec;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.Restart;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.store.ObjectWriter;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.WorkerContext;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * The worker that owns the links: it reads the {@code links} setting, starts one connection task per
 * link, stops it when the link goes or changes, and reports each link in the plugin's status. It
 * receives what the tasks decoded. A handler handles one message at a time, so its fields need no
 * locks; it never blocks.
 *
 * <p>Wire it in the plugin:
 * <pre>{@code
 * // init:  links = LinkWorker.spawn(context);
 * // start: settings = context.subscribeSettings(links, TransportMsg.SettingsChanged::new);
 * //        links.send(new TransportMsg.SettingsChanged(context.settings()));
 * // stop:  settings.cancel();   (ECore stops the tasks and the worker)
 * }</pre>
 */
public final class LinkWorker implements Handler<TransportMsg> {

  /** The worker's mailbox. Settings and task events are always delivered; messages are dropped when it is full, and counted. */
  public static final int MAILBOX = 10_000;

  /** The most bytes of one line: NMEA 0183 allows 82 characters, and a tag block in front adds more (brief section 4). */
  static final int MAX_FRAME_BYTES = 512;

  private static final long WARN_EVERY_TICKS = 60;

  /** A run that ends is started again after 1 s, then up to 60 s. */
  static final Backoff RESTART = Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60));

  private final PluginContext context;
  private final Ships ships;
  /** The links by name, in the order of the settings. */
  private final Map<String, Running> links = new LinkedHashMap<>();
  private final List<String> problems = new ArrayList<>();
  private @Nullable WorkerRef<TransportMsg> self;
  private @Nullable PluginLog log;
  private long tick;

  /** One link and its task. */
  private static final class Running {
    Link link;
    @Nullable ConnectionRef<Message> task;
    /** The run that has its socket now. */
    @Nullable UUID up;
    @Nullable String lastError;
    long received;
    final Rate messages = new Rate();
    final Rate shipsWritten = new Rate();
    /** When a warning was last logged, by its reason (ticks): at most one a minute per link and reason (ADR-0037 point 7). */
    final Map<String, Long> warned = new java.util.HashMap<>();

    Running(Link link) {
      this.link = link;
    }
  }

  LinkWorker(PluginContext context, Clock clock) {
    this.context = context;
    this.ships = new Ships(context, clock);
  }

  /** Spawns the worker; then subscribe it to the settings, as the class comment shows. */
  public static WorkerRef<TransportMsg> spawn(PluginContext context, Clock clock) {
    return context.workers().spawn(WorkerSpec.of("links", TransportMsg.class, () -> new LinkWorker(context, clock)).mailbox(MAILBOX, Overflow.dropNewest()));
  }

  @Override
  public void handle(TransportMsg message, WorkerContext<TransportMsg> ctx) {
    self = ctx.self();
    log = ctx.log();
    ships.bind(ctx.self());
    switch (message) {
      case TransportMsg.SettingsChanged m -> apply(m.settings());
      case TransportMsg.LinkEvent m -> onEvent(m.event());
      case TransportMsg.Up m -> {
        Running r = links.get(m.link());
        if (r != null) {
          r.up = m.run();
          r.lastError = null;
        }
      }
      case TransportMsg.Down m -> {
        Running r = links.get(m.link());
        if (r != null && m.run().equals(r.up)) {
          r.up = null;
          r.lastError = m.reason();
          warn(r, "link {} is down: {}", r.link.name(), m.reason());
        }
      }
      case TransportMsg.ReceivedPosition m -> {
        received(m.link());
        ships.position(m.link(), m.message());
      }
      case TransportMsg.ReceivedStatic m -> {
        received(m.link());
        ships.statics(m.link(), m.message());
      }
      case TransportMsg.Tick m -> {
        tick++;
        ships.tick();
        for (Running r : links.values()) {
          ObjectWriter.Stats s = ships.stats(r.link.name());
          r.messages.sample(r.received);
          r.shipsWritten.sample(s.created() + s.updated());
        }
      }
      case TransportMsg.Writer m -> ships.onWriter(m.reply());
      case TransportMsg.Stop m -> ships.stop();
    }
    refreshStatus();
  }

  private void received(String link) {
    Running r = links.get(link);
    if (r != null) {
      r.received++;
    }
  }

  /** Starts, stops and restarts tasks so that they match the settings; a link whose settings changed starts again. */
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
      if (next != null && r.link.sameConnection(next)) {
        r.link = next; // another layer, label or identity: the ships written next follow it, the connection stays
      } else {
        if (r.task != null) {
          r.task.stop();
        }
        it.remove();
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
    ships.links(new ArrayList<>(wanted.values()), name -> (counter, delta) -> {
      Running r = links.get(name);
      if (r != null && r.task != null) {
        r.task.count(counter, delta);
      }
    });
  }

  private void start(Running r) {
    Link link = r.link;
    WorkerRef<TransportMsg> worker = Objects.requireNonNull(self);
    Supplier<ConnectionTask<Message>> factory = switch (link.mode()) {
      case UDP -> () -> new UdpLinkTask(link, worker, MAX_FRAME_BYTES);
      case TCP_CLIENT -> () -> new TcpClientLinkTask(link, worker, MAX_FRAME_BYTES);
    };
    ConnectionSpec<Message> spec = ConnectionSpec.of(link.name(), Message.class).restart(Restart.always(RESTART));
    try {
      r.task = context.connections().start(spec, factory, worker, TransportMsg.LinkEvent::new);
    } catch (IllegalArgumentException | IllegalStateException e) {
      r.lastError = "cannot start: " + e.getMessage();
      warn(r, "link {} cannot start: {}", link.name(), e.getMessage());
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
        r.up = null;
        r.lastError = e.reason();
        warn(r, "link {} is down: {}", r.link.name(), e.reason());
      }
      case ConnectionEvent.Failed e -> {
        r.up = null;
        r.lastError = e.reason();
        r.task = null; // ECore does not try again; a change of the settings starts it
        warn(r, "link {} failed and is not started again until its settings change: {}", r.link.name(), e.reason());
      }
      case ConnectionEvent.Stopped e -> r.up = null;
    }
  }

  /** Logs a warning at most once a minute per link and reason. Text from the network is cleaned first (design pattern, section 9). */
  private void warn(Running r, String message, String link, @Nullable String why) {
    PluginLog out = log;
    String reason = why == null ? "" : why;
    Long last = r.warned.get(reason);
    if (out == null || (last != null && tick - last < WARN_EVERY_TICKS)) {
      return;
    }
    r.warned.put(reason, tick);
    if (r.warned.size() > 16) {
      r.warned.values().removeIf(t -> tick - t >= WARN_EVERY_TICKS);
    }
    out.warn(message, link, LinkStatus.clean(reason));
  }

  /** One part per link in the plugin's status (brief section 6). */
  private void refreshStatus() {
    List<String> parts = new ArrayList<>(problems);
    boolean degraded = !problems.isEmpty();
    for (Running r : links.values()) {
      LinkStatus.State state;
      if (!r.link.enabled()) {
        state = LinkStatus.State.SWITCHED_OFF;
      } else if (r.task == null || (r.lastError != null && r.up == null)) {
        state = LinkStatus.State.DOWN;
      } else if (r.up == null) {
        state = LinkStatus.State.STARTING;
      } else {
        state = LinkStatus.State.UP;
      }
      ObjectWriter.Stats s = ships.stats(r.link.name());
      var status = new LinkStatus(
          r.link.name(), r.link.where(), r.link.mode() == Link.Mode.UDP, state, r.lastError, r.messages.perMinute(r.received),
          r.shipsWritten.perMinute(s.created() + s.updated()), s.layerName());
      parts.add(status.text());
      degraded |= !status.healthy();
    }
    String detail = parts.isEmpty() ? "no links" : String.join("; ", parts);
    if (detail.length() > PluginStatus.MAX_DETAIL) {
      detail = detail.substring(0, PluginStatus.MAX_DETAIL - 3) + "...";
    }
    context.status().set(degraded ? PluginState.DEGRADED : PluginState.OK, detail);
  }
}
