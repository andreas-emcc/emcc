package dev.emcc.plugins.adsb;

import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * The entry class ({@code server.entryClass} in {@code plugin.json}). ECore creates it with the
 * public no-argument constructor and calls {@code init}, {@code start} and {@code stop}, each under a
 * 5 s budget. The work happens in the {@link LinkWorker}.
 */
public final class AdsbPlugin implements Plugin {

  private final Supplier<Instant> now;
  private @Nullable PluginContext context;
  private @Nullable WorkerRef<AdsbMsg> links;
  private final List<Cancellable> subscriptions = new ArrayList<>();

  public AdsbPlugin() {
    this(Clock.systemUTC()::instant);
  }

  /** As the no-argument constructor, with the time a test gives. */
  AdsbPlugin(Supplier<Instant> now) {
    this.now = now;
  }

  @Override
  public void init(PluginContext context) {
    this.context = context;
    links = LinkWorker.spawn(context, now);
  }

  @Override
  public void start() {
    PluginContext ctx = context;
    WorkerRef<AdsbMsg> worker = links;
    if (ctx == null || worker == null) {
      return;
    }
    subscriptions.add(ctx.subscribeSettings(worker, AdsbMsg.SettingsChanged::new));
    worker.send(new AdsbMsg.SettingsChanged(ctx.settings()));
    subscriptions.add(ctx.timers().every(Duration.ofMinutes(1), worker, new AdsbMsg.Sweep()));
    ctx.status().set(PluginState.OK, "no links");
  }

  @Override
  public void stop() {
    for (Cancellable subscription : subscriptions) {
      subscription.cancel();
    }
    subscriptions.clear();
  }

  /** The worker that owns the links; the tests send it lines without a socket. */
  WorkerRef<AdsbMsg> links() {
    return Objects.requireNonNull(links, "init not called");
  }
}
