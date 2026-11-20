package dev.emcc.plugins.template.transport;

import dev.emcc.sdk.PluginContext;
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
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerContext;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
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
 * receives what the tasks parsed, and posts what to send into a link's task inbox. A handler handles
 * one message at a time, so its fields need no locks; it never blocks.
 *
 * <p>Wire it in the plugin (the playbook, work package 2):
 * <pre>{@code
 * // init:  links = LinkWorker.spawn(context);
 * // start: settings = context.subscribeSettings(links, TransportMsg.SettingsChanged::new);
 * //        links.send(new TransportMsg.SettingsChanged(context.settings()));
 * // stop:  settings.cancel();   (ECore stops the tasks and the worker)
 * }</pre>
 */
public final class LinkWorker implements Handler<TransportMsg> {

  /** The worker's mailbox. Settings and task events are always delivered; frames are dropped when it is full, and counted. */
  public static final int MAILBOX = 10_000;

  /** The inbox of a link's task: the latest frame per key. */
  static final int INBOX = 10_000;

  /** The most bytes of one frame (YOUR PROTOCOL: an AIS sentence has at most 82, an SBS-1 line about 200). */
  static final int MAX_FRAME_BYTES = 4_096;

  /** A run that ends is started again after 1 s, then up to 60 s. */
  static final Backoff RESTART = Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60));

  private final PluginContext context;
  /** The links by name, in the order of the settings. */
  private final Map<String, Running> links = new LinkedHashMap<>();
  private final List<String> problems = new ArrayList<>();
  private @Nullable WorkerRef<TransportMsg> self;

  /** One link and its task. */
  private static final class Running {
    final Link link;
    @Nullable ConnectionRef<LinkInbox> task;
    /** The runs that have their socket now, with their peer; for a TCP server, one per client. */
    final Map<UUID, String> up = new LinkedHashMap<>();
    @Nullable String lastError;
    /** A TCP server's run has bound its port. */
    boolean listening;
    long received;

    Running(Link link) {
      this.link = link;
    }
  }

  LinkWorker(PluginContext context) {
    this.context = context;
  }

  /** Spawns the worker; then subscribe it to the settings, as the class comment shows. */
  public static WorkerRef<TransportMsg> spawn(PluginContext context) {
    return context.workers().spawn(WorkerSpec.of("links", TransportMsg.class, () -> new LinkWorker(context)).mailbox(MAILBOX, Overflow.dropNewest()));
  }

  @Override
  public void handle(TransportMsg message, WorkerContext<TransportMsg> ctx) {
    self = ctx.self();
    switch (message) {
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
          // A provider whose peer must get the current picture sends it here, to this link.
        }
      }
      case TransportMsg.Down m -> {
        Running r = links.get(m.link());
        if (r != null && r.up.remove(m.run()) != null && r.link.mode() != Link.Mode.TCP_SERVER) {
          r.lastError = m.reason(); // a TCP server's client that goes is no problem of the link
        }
      }
      case TransportMsg.Received m -> {
        Running r = links.get(m.link());
        if (r != null) {
          r.received++;
          // YOUR PROTOCOL: map what was received to objects here (the playbook, work package 1), with
          // the link's name as their data source. From SDK 1.4.0 the SDK's ObjectWriter writes them
          // (the playbook, work package 3): it makes the link's target layer and keeps one change
          // request in flight per object, e.g.
          //   writer.write(m.link(), mmsi, (stored, layerId) -> Mapper.content(stored, layerId, report));
          // with the writer created in this worker and its replies passed back to writer.handle(...).
          ctx.log().debug("{} received: {}", m.link(), m.frame());
        }
      }
      case TransportMsg.Outgoing m -> {
        Running r = links.get(m.link());
        if (r == null || r.task == null || !r.link.direction().sends()) {
          return;
        }
        if (r.up.isEmpty()) {
          r.task.count("skipped: not connected", 1);
        } else if (r.task.post(new LinkInbox.Send(m.key(), m.frame())) != SendResult.ACCEPTED) {
          r.task.count("skipped: inbox closed", 1);
        }
      }
    }
    refreshStatus();
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
      if (!r.link.equals(wanted.get(r.link.name()))) {
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
  }

  private void start(Running r) {
    Link link = r.link;
    WorkerRef<TransportMsg> worker = Objects.requireNonNull(self);
    Supplier<ConnectionTask<LinkInbox>> factory = switch (link.mode()) {
      case UDP -> () -> new UdpLinkTask(link, worker, MAX_FRAME_BYTES);
      case TCP_CLIENT -> () -> new TcpClientLinkTask(link, worker, MAX_FRAME_BYTES);
      case TCP_SERVER -> () -> new TcpServerLinkTask(link, worker, MAX_FRAME_BYTES);
    };
    ConnectionSpec<LinkInbox> spec = ConnectionSpec.of(link.name(), LinkInbox.class).inbox(INBOX, Overflow.coalesceByKey()).restart(Restart.always(RESTART));
    try {
      r.task = context.connections().start(spec, factory, worker, TransportMsg.LinkEvent::new);
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

  /** One line per link in the plugin's status (the playbook, work package 4). */
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
      parts.add(r.link.name() + " [" + r.link.where() + "]: " + state + ", " + r.received + " received");
    }
    String detail = parts.isEmpty() ? "no links" : String.join("; ", parts);
    if (detail.length() > PluginStatus.MAX_DETAIL) {
      detail = detail.substring(0, PluginStatus.MAX_DETAIL - 3) + "...";
    }
    context.status().set(degraded ? PluginState.DEGRADED : PluginState.OK, detail);
  }
}
