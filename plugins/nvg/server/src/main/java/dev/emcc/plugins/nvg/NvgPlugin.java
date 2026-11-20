package dev.emcc.plugins.nvg;

import dev.emcc.plugins.nvg.compute.ComputeMsg;
import dev.emcc.plugins.nvg.compute.ComputeWorker;
import dev.emcc.plugins.nvg.files.FilesMsg;
import dev.emcc.plugins.nvg.files.FilesWorker;
import dev.emcc.plugins.nvg.links.LinksMsg;
import dev.emcc.plugins.nvg.links.LinksWorker;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Permissions;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Duration;
import org.jspecify.annotations.Nullable;

/**
 * The entry class ({@code server.entryClass} in {@code plugin.json}): NVG 2.0.x in and out over
 * files and the NVG web service (ADR-0055). All work happens in workers:
 *
 * <ul>
 *   <li>{@code compute}: reads, plans and writes documents (rule C7);
 *   <li>{@code files}: the NVG panel's import and export;
 *   <li>{@code links}: the NVG web service links, consumers and providers.
 * </ul>
 */
public final class NvgPlugin implements Plugin {

  private @Nullable PluginContext context;
  private @Nullable WorkerRef<LinksMsg> links;
  private @Nullable Cancellable settings;

  @Override
  public void init(PluginContext context) {
    this.context = context;
    WorkerRef<ComputeMsg> compute = context.workers().spawn(
        WorkerSpec.of("compute", ComputeMsg.class, ComputeWorker::new).compute(true).mailbox(64, Overflow.dropNewest()));
    WorkerRef<FilesMsg> files = context.workers().spawn(
        WorkerSpec.of("files", FilesMsg.class, () -> new FilesWorker(context, compute)).mailbox(10_000, Overflow.dropNewest()));
    context.endpoints().register(
        Endpoint.post("/import").accepts("application/xml", "text/xml").maxBody(Endpoint.MAX_RAW_BODY).checksUserItself(),
        files, FilesMsg.Import::new);
    context.endpoints().register(Endpoint.get("/import/{job}"), files, FilesMsg.ImportState::new);
    context.endpoints().register(Endpoint.get("/export").timeout(Duration.ofSeconds(60)), files, FilesMsg.Export::new);

    WorkerRef<LinksMsg> links = context.workers().spawn(
        WorkerSpec.of("links", LinksMsg.class, () -> new LinksWorker(context, compute)).mailbox(10_000, Overflow.dropNewest()));
    this.links = links;
    // The provider: no authentication in M7 (owner, Q1 and Q8 C); a link that is off or unknown answers 404.
    context.endpoints().register(
        Endpoint.service("POST", "/nvg/{link}").accepts("text/xml", "application/soap+xml").maxBody(Endpoint.MAX_BODY).timeout(Duration.ofSeconds(60)),
        links, LinksMsg.Service::new);
    // The NVG panel's links section, for admins (NV1).
    context.endpoints().register(Endpoint.get("/links").requires(Permissions.SETTINGS_ADMIN), links, LinksMsg.ListLinks::new);
    context.endpoints().register(
        Endpoint.post("/links/{name}/capabilities").requires(Permissions.SETTINGS_ADMIN).maxBody(1024).timeout(Duration.ofSeconds(60)),
        links, LinksMsg.Capabilities::new);
  }

  @Override
  public void start() {
    if (context == null || links == null) {
      return;
    }
    context.status().set(PluginState.OK, "ready");
    links.send(new LinksMsg.Settings(context.settings()));
    settings = context.subscribeSettings(links, LinksMsg.Settings::new);
    context.documents().get(LinksWorker.LAYERS_DOC, links, LinksMsg.LayersLoaded::new);
  }

  @Override
  public void stop() {
    if (settings != null) {
      settings.cancel();
      settings = null;
    }
    // ECore stops the workers, their timers and subscriptions.
  }
}
