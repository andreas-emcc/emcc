package dev.emcc.plugins.template;

import dev.emcc.plugins.template.transport.LinkWorker;
import dev.emcc.plugins.template.transport.TransportMsg;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import org.jspecify.annotations.Nullable;

/**
 * The entry class ({@code server.entryClass} in {@code plugin.json}). ECore creates it with the
 * public no-argument constructor and calls {@code init}, {@code start} and {@code stop}, each under a
 * 5 s budget. All work happens in workers.
 *
 * <p>Two examples: the greeting (a worker behind an endpoint), and the links of the {@code links}
 * setting (the {@code transport} package: connection tasks a worker starts and stops as the settings
 * change, each link's state in the status). A plugin without links deletes the second.
 */
public final class TemplatePlugin implements Plugin {

  private @Nullable PluginContext context;
  private @Nullable WorkerRef<TransportMsg> links;
  private @Nullable Cancellable settings;

  @Override
  public void init(PluginContext context) {
    this.context = context;
    String greeting = context.settings().getString("greeting");
    WorkerRef<GreeterMsg> greeter = context.workers().spawn(
        WorkerSpec.of("greeter", GreeterMsg.class, () -> new Greeter(greeting)).mailbox(100, Overflow.dropNewest()));
    context.endpoints().register(Endpoint.get("/greeting"), greeter, GreeterMsg.Greet::new);
    links = LinkWorker.spawn(context);
  }

  @Override
  public void start() {
    if (context != null && links != null) {
      // The links follow the settings: the current ones now, then each change. The worker sets the status.
      settings = context.subscribeSettings(links, TransportMsg.SettingsChanged::new);
      links.send(new TransportMsg.SettingsChanged(context.settings()));
    }
  }

  @Override
  public void stop() {
    // ECore stops the workers and the links' tasks; cancel what the plugin subscribed to.
    if (settings != null) {
      settings.cancel();
    }
  }
}
