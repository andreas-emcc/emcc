package dev.emcc.sdk.compute;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginLog;
import dev.emcc.sdk.folder.LocalFolders;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Duration;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.9.0 (CR-0048 point 5; ADR-0064 point 3): what a compute task may do besides its own CPU
 * work. It is not a {@code WorkerContext} nor a {@code PluginContext}: a task cannot ask, submit
 * changes, set timers, use channels or make HTTP calls. It sends to a worker that can.
 *
 * <p>When the task is stopped, it ends, or the plugin stops, the context is <b>fenced</b>: what it
 * sends or posts afterwards, through any SDK call, is dropped ({@link SendResult#CLOSED}).
 *
 * <pre>{@code
 * for (Pose p; (p = task.take()) != null; ) {
 *   if (task.stopping()) break;
 *   task.send(linkWorker, new LinkMsg.Rendered(render(p)));
 *   task.count("rendered", 1);
 * }
 * }</pre>
 *
 * @param <I> the type of the task's inbox items
 */
public interface ComputeContext<I extends Message> {

  /**
   * The next item workers posted ({@link ComputeRef#post}), waiting for one as long as it takes.
   * Returns {@code null} when the task is to stop: the task should then return. Waiting here holds
   * no lock (rule C4). With the declared folders, the only waits a compute task may do.
   */
  @Nullable I take();

  /** As {@link #take}, waiting at most {@code timeout} (1 ms to 1 hour); {@code null} also when none came by then. */
  @Nullable I poll(Duration timeout);

  /** Whether the task is to stop. A task checks it at least once per item, and in any long computation. */
  boolean stopping();

  /**
   * Puts {@code message} into the worker's mailbox and returns at once; the worker's overflow
   * policy applies. Never blocks. Only to its own plugin's workers. A task posts to its plugin's
   * connection tasks with {@code ConnectionRef.post}, as a worker does.
   */
  <M extends Message> SendResult send(WorkerRef<M> target, M message);

  /** Adds {@code delta} to the counter {@code name}, shown per task in the Monitor, e.g. {@code rendered}, {@code late}. */
  void count(String name, long delta);

  /** Sets a detail shown per task in the Monitor, e.g. the frame size; at most 32 keys. */
  void detail(String key, String value);

  /** Its plugin's declared folders (ADR-0049), read-only; reading them is the one other wait a task may do. */
  LocalFolders folders();

  /** The plugin's log. */
  PluginLog log();

  /** This task's own handle. */
  ComputeRef<I> self();
}
