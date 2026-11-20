package dev.emcc.plugins.fmv;

import dev.emcc.plugins.fmv.out.OutputMsg;
import dev.emcc.plugins.fmv.out.OutputWorker;
import dev.emcc.plugins.fmv.transport.LinkWorker;
import dev.emcc.plugins.fmv.transport.TransportMsg;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Clock;
import java.time.Instant;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * The entry class ({@code server.entryClass} in {@code plugin.json}): FMV in, STANAG 4609 over UDP
 * (brief {@code docs/plugins/briefs/fmv.md}; ADR-0057), and from M9 a simulated camera's video out
 * (section 10; ADR-0058, ADR-0059). ECore creates it with the public no-argument constructor and
 * calls {@code init}, {@code start} and {@code stop}, each under a 5 s budget. All work happens in
 * the input links' worker, the output links' worker, and their tasks.
 */
public final class FmvPlugin implements Plugin {

  private final Supplier<Instant> now;
  private @Nullable PluginContext context;
  private @Nullable WorkerRef<TransportMsg> links;
  private @Nullable WorkerRef<OutputMsg> outputs;
  private @Nullable Cancellable settings;
  private @Nullable Cancellable outputSettings;

  /** As ECore creates it: the system's clock (UTC). */
  public FmvPlugin() {
    this(Clock.systemUTC()::instant);
  }

  /** With a clock of the test's own. */
  FmvPlugin(Supplier<Instant> now) {
    this.now = now;
  }

  @Override
  public void init(PluginContext context) {
    this.context = context;
    links = LinkWorker.spawn(context, now);
    outputs = OutputWorker.spawn(context, now, links);
    // The panel's list: every logged-in user may read it; watching needs the permission, which the stream endpoint checks (F7).
    context.endpoints().register(Endpoint.get("/streams"), links, LinkWorker::streams);
  }

  @Override
  public void start() {
    if (context != null && links != null && outputs != null) {
      settings = context.subscribeSettings(links, TransportMsg.SettingsChanged::new);
      outputSettings = context.subscribeSettings(outputs, OutputMsg.SettingsChanged::new);
      links.send(new TransportMsg.SettingsChanged(context.settings()));
      outputs.send(new OutputMsg.SettingsChanged(context.settings()));
    }
  }

  /** The links' worker, for tests. */
  @Nullable WorkerRef<TransportMsg> links() {
    return links;
  }

  /** The output links' worker, for tests. */
  @Nullable WorkerRef<OutputMsg> outputs() {
    return outputs;
  }

  @Override
  public void stop() {
    if (settings != null) {
      settings.cancel(); // ECore stops the tasks, the streams and the workers
    }
    if (outputSettings != null) {
      outputSettings.cancel();
    }
  }
}
