package dev.emcc.plugins.ais;

import dev.emcc.plugins.ais.transport.LinkWorker;
import dev.emcc.plugins.ais.transport.TransportMsg;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Clock;
import java.time.Duration;
import org.jspecify.annotations.Nullable;

/**
 * The entry class ({@code server.entryClass} in {@code plugin.json}): receives AIS as NMEA 0183
 * {@code !AIVDM} sentences and shows each ship on the map (T-096, brief {@code docs/plugins/briefs/ais.md}).
 * Input only. One worker, {@link LinkWorker}, follows the {@code links} setting; each link is a
 * connection task (a UDP receiver or a TCP client).
 */
public final class AisPlugin implements Plugin {

  private final Clock clock;
  private @Nullable PluginContext context;
  private @Nullable WorkerRef<TransportMsg> links;
  private @Nullable Cancellable settings;
  private @Nullable Cancellable tick;

  /** ECore creates the plugin with this constructor. */
  public AisPlugin() {
    this(Clock.systemUTC());
  }

  AisPlugin(Clock clock) {
    this.clock = clock;
  }

  @Override
  public void init(PluginContext context) {
    this.context = context;
    this.links = LinkWorker.spawn(context, clock);
    context.status().set(PluginState.OK, "starting");
  }

  @Override
  public void start() {
    PluginContext ctx = context;
    WorkerRef<TransportMsg> worker = links;
    if (ctx == null || worker == null) {
      return;
    }
    settings = ctx.subscribeSettings(worker, TransportMsg.SettingsChanged::new);
    tick = ctx.timers().every(Duration.ofSeconds(1), worker, new TransportMsg.Tick());
    worker.send(new TransportMsg.SettingsChanged(ctx.settings()));
  }

  @Override
  public void stop() {
    // ECore stops the connection tasks and the worker; the timer and the settings callback are ours, the writer's subscription is its own.
    if (links != null) {
      links.send(new TransportMsg.Stop());
    }
    for (Cancellable what : new Cancellable[] {tick, settings}) {
      if (what != null) {
        what.cancel();
      }
    }
  }
}
