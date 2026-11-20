package dev.emcc.plugins.gmti;

import dev.emcc.plugins.gmti.transport.LinkWorker;
import dev.emcc.plugins.gmti.transport.TransportMsg;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Clock;
import java.time.Instant;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * The entry class of {@code gmti} ({@code server.entryClass} in {@code plugin.json}): GMTI as STANAG
 * 4607 in and out (brief {@code docs/plugins/briefs/gmti.md}; ADR-0048). ECore creates it with the
 * public no-argument constructor and calls {@code init}, {@code start} and {@code stop}, each under a
 * 5 s budget. All work happens in the links' worker and its connection tasks.
 */
public final class GmtiPlugin implements Plugin {

  private final Supplier<Instant> now;
  private @Nullable PluginContext context;
  private @Nullable WorkerRef<TransportMsg> links;
  private @Nullable Cancellable settings;

  /** As ECore creates it: the system's clock (UTC). */
  public GmtiPlugin() {
    this(Clock.systemUTC()::instant);
  }

  /** With a clock of the test's own (the test kit's virtual time). */
  GmtiPlugin(Supplier<Instant> now) {
    this.now = now;
  }

  @Override
  public void init(PluginContext context) {
    this.context = context;
    links = LinkWorker.spawn(context, now);
  }

  @Override
  public void start() {
    if (context != null && links != null) {
      settings = context.subscribeSettings(links, TransportMsg.SettingsChanged::new);
      links.send(new TransportMsg.SettingsChanged(context.settings()));
    }
  }

  /** The links' worker, for tests. */
  @Nullable WorkerRef<TransportMsg> links() {
    return links;
  }

  @Override
  public void stop() {
    if (settings != null) {
      settings.cancel(); // ECore stops the tasks and the worker
    }
  }
}
