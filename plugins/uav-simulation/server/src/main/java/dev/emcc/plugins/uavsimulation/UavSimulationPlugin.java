package dev.emcc.plugins.uavsimulation;

import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.store.ObjectQuery;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Clock;
import java.time.Duration;
import org.jspecify.annotations.Nullable;

/**
 * The entry class ({@code server.entryClass} in {@code plugin.json}): a simulated camera on a
 * simulated track (ADR-0059, brief {@code docs/plugins/briefs/uav-simulation.md}).
 *
 * <p>One worker, {@code cameras}, owns the cameras. It follows the Simulation workspace through one
 * store subscription, and runs one timer per running camera. The plugin creates no thread of its own
 * (rule C1). It watches the output channels and sends each running camera's poses to the one the
 * camera chose, as {@code fmv.camera-pose} items (brief section 4 and function 9).
 */
public final class UavSimulationPlugin implements Plugin {

  /** Store updates and document answers are always delivered; this bounds ticks and requests. */
  static final int MAILBOX = 10_000;

  /** The worker answers from what it holds, so an answer comes at once unless it is busy. */
  static final Duration ENDPOINT_TIMEOUT = Duration.ofSeconds(5);

  /** A camera's settings are well under 2 KB. */
  static final int BODY = 16 * 1024;

  private final Clock clock;
  private @Nullable PluginContext context;
  private @Nullable WorkerRef<CameraMsg> worker;
  private @Nullable Cancellable subscription;
  private @Nullable Cancellable outputs;

  /** ECore creates the plugin with this constructor; ECore's clock is the JVM's UTC clock (B6). */
  public UavSimulationPlugin() {
    this(Clock.systemUTC());
  }

  UavSimulationPlugin(Clock clock) {
    this.clock = clock;
  }

  @Override
  public void init(PluginContext context) {
    this.context = context;
    WorkerRef<CameraMsg> cameras = context.workers().spawn(
        WorkerSpec.of("cameras", CameraMsg.class, () -> new CameraWorker(context, clock)).mailbox(MAILBOX, Overflow.dropNewest()));
    this.worker = cameras;
    // Brief function 13: every endpoint names its permission, which ECore checks (overview 4.4).
    context.endpoints().register(Endpoint.get("/cameras").requires(CameraWorker.VIEW).timeout(ENDPOINT_TIMEOUT), cameras, CameraMsg.Get::new);
    context.endpoints().register(post("/cameras", CameraWorker.EDIT), cameras, CameraMsg.Create::new);
    context.endpoints().register(post("/cameras/{id}", CameraWorker.EDIT), cameras, CameraMsg.Change::new);
    context.endpoints().register(post("/cameras/{id}/remove", CameraWorker.EDIT), cameras, CameraMsg.Remove::new);
    context.endpoints().register(post("/cameras/{id}/start", CameraWorker.RUN), cameras, CameraMsg.Start::new);
    context.endpoints().register(post("/cameras/{id}/stop", CameraWorker.RUN), cameras, CameraMsg.Stop::new);
    context.status().set(PluginState.OK, "starting");
  }

  private static Endpoint post(String path, String permission) {
    return Endpoint.post(path).requires(permission).timeout(ENDPOINT_TIMEOUT).maxBody(BODY);
  }

  @Override
  public void start() {
    if (context != null && worker != null) {
      subscription = context.store().subscribe(ObjectQuery.all().inWorkspaces(SimulationCopy.WORKSPACE), worker, CameraMsg.Updated::new);
      outputs = context.channels().watch(worker, CameraMsg.Outputs::new);
    }
  }

  @Override
  public void stop() {
    // ECore stops the worker and the plugin's timers, and cancels its watches; the subscription is ours.
    if (subscription != null) {
      subscription.cancel();
    }
    if (outputs != null) {
      outputs.cancel();
    }
  }
}
