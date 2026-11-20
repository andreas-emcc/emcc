package dev.emcc.plugins.terrain;

import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.folder.LocalFolder;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.jspecify.annotations.Nullable;

/**
 * The entry class ({@code server.entryClass} in {@code plugin.json}): the terrain tools' server part
 * (ADR-0049, T-142).
 *
 * <ul>
 *   <li>{@code range}: {@code POST /range}, range and bearing by the SDK's geodesy;
 *   <li>{@code heights}: owns the index of DTED cells, the cache and who is computing; {@code POST
 *       /viewshed}, {@code POST /heightmap} (M7, T-166) and {@code GET /status};
 *   <li>{@code viewshed-1}, {@code viewshed-2}: compute workers that run the line of sight and the height map.
 * </ul>
 *
 * Every endpoint needs {@value #PERMISSION}. No request names a path or a file: the folder comes from
 * the settings only (ADR-0030).
 */
public final class TerrainPlugin implements Plugin {

  /** The permission both tools and every endpoint need (A2). */
  static final String PERMISSION = "plugin.terrain.use";

  /** The id of the folder in the manifest's {@code folders}. */
  static final String FOLDER = "heights";

  /** How many viewsheds may be computed at once, on ECore's bounded pool of compute threads. */
  private static final int COMPUTE_WORKERS = 2;

  /** The longest ECore waits for an answer: the SDK's limit, a little over the longest {@code timeoutSeconds} setting (55). */
  private static final Duration VIEWSHED_TIMEOUT = Duration.ofSeconds(60);

  private @Nullable WorkerRef<HeightsMsg> heights;

  @Override
  public void init(PluginContext context) {
    List<WorkerRef<ComputeMsg>> computers = new ArrayList<>();
    for (int i = 1; i <= COMPUTE_WORKERS; i++) {
      computers.add(context.workers().spawn(
          WorkerSpec.of("viewshed-" + i, ComputeMsg.class, ViewshedWorker::new)
              .compute(true)
              .budget(Duration.ofSeconds(60))
              .mailbox(10, Overflow.dropNewest())));
    }
    LocalFolder folder = folderOrNull(context);
    WorkerRef<HeightsMsg> worker = context.workers().spawn(
        WorkerSpec.of("heights", HeightsMsg.class, () -> new Heights(context, folder, computers)).mailbox(1_000, Overflow.dropNewest()));
    WorkerRef<RangeMsg> range = context.workers().spawn(
        WorkerSpec.of("range", RangeMsg.class, RangeWorker::new).mailbox(100, Overflow.dropNewest()));
    heights = worker;

    context.endpoints().register(Endpoint.post("/range").requires(PERMISSION).maxBody(4_096), range, RangeMsg.Range::new);
    context.endpoints().register(Endpoint.post("/viewshed").requires(PERMISSION).maxBody(4_096).timeout(VIEWSHED_TIMEOUT), worker, HeightsMsg.Viewshed::new);
    context.endpoints().register(Endpoint.post("/heightmap").requires(PERMISSION).maxBody(4_096).timeout(VIEWSHED_TIMEOUT), worker, HeightsMsg.HeightMap::new);
    context.endpoints().register(Endpoint.get("/status").requires(PERMISSION), worker, HeightsMsg.Status::new);
    context.subscribeSettings(worker, HeightsMsg.SettingsChanged::new);
  }

  @Override
  public void start() {
    WorkerRef<HeightsMsg> worker = heights;
    if (worker != null) {
      worker.send(new HeightsMsg.Begin());
    }
  }

  @Override
  public void stop() {
    // Nothing to stop: ECore stops the workers and the timers.
  }

  /** The folder, or {@code null} while ECore does not provide local folders (SDK 1.4.0 part 6): the plugin then reports it and serves range and bearing. */
  private static @Nullable LocalFolder folderOrNull(PluginContext context) {
    try {
      return context.folders().folder(FOLDER);
    } catch (UnsupportedOperationException e) {
      context.log().warn("ECore does not provide local folders yet: viewsheds are unavailable");
      return null;
    }
  }
}
