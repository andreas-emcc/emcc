package dev.emcc.sdk.compute;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Duration;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * SDK 1.9.0 (CR-0048 point 5; ADR-0064): the plugin's compute tasks, from {@code
 * PluginContext.compute()}. Called from the plugin's workers; nothing here blocks.
 *
 * <pre>{@code
 * ComputeRef<Pose> render = context.compute().start(
 *     ComputeSpec.of("camera-north", Pose.class).inbox(16, Overflow.coalesceByKey()),
 *     Renderer::new, linkWorker, LinkMsg.Compute::new);
 * // in a worker, never blocking:
 * render.post(pose);
 * }</pre>
 *
 * <p><b>The limits</b> (ADR-0064 point 4; owner YQ1 A): a task counts against its plugin's {@link
 * #allowed()} and against ECore's total cap from its start until it has stopped, its restarts'
 * back-off included. A start above either is refused: the ref is stopped, and the events target
 * gets {@link ComputeEvent.Refused}. Lowering {@link #allowed()} while tasks run stops the newest
 * first, each with {@link ComputeEvent.Stopped} and a reason.
 */
public interface Computes {

  /** How long ECore waits after a task's stop before it marks it {@link ComputeEvent.Hung}. */
  Duration STOP_GRACE = Duration.ofSeconds(5);

  /** The largest number of compute threads a manifest may declare. */
  int MAX_DECLARED = 64;

  /**
   * Starts a compute task on a compute thread of its own; ECore makes a new instance from {@code
   * factory} for each start and restart. Returns at once. A start ECore refuses gives a stopped ref,
   * whose {@code post} answers {@code CLOSED}.
   *
   * @throws IllegalArgumentException if a compute task of that name runs
   * @throws IllegalStateException once the plugin has stopped
   */
  <I extends Message> ComputeRef<I> start(ComputeSpec<I> spec, Supplier<? extends ComputeTask<I>> factory);

  /**
   * As {@link #start(ComputeSpec, Supplier)}, also sending each {@link ComputeEvent} of the task to
   * {@code events}, converted by {@code toMessage} (plugin code: pure, non-blocking, run in that
   * worker): its refusal included.
   */
  <I extends Message, M extends Message> ComputeRef<I> start(
      ComputeSpec<I> spec, Supplier<? extends ComputeTask<I>> factory, WorkerRef<M> events, Function<ComputeEvent, ? extends M> toMessage);

  /** The compute threads the plugin's manifest declares, 0 without a {@code compute} declaration. */
  int declared();

  /** The compute tasks the admin allows the plugin to run at once now, 0 to {@link #declared()}; it can change between calls. */
  int allowed();
}
