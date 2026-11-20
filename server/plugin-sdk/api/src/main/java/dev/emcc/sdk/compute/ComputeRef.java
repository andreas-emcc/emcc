package dev.emcc.sdk.compute;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.SendResult;

/**
 * SDK 1.9.0 (CR-0048 point 5): a handle on a compute task, held by the plugin's workers. A value:
 * it may travel in messages, e.g. to the plugin's connection tasks.
 *
 * @param <I> the type of the task's inbox items
 */
public interface ComputeRef<I extends Message> {

  /** The task's id. */
  HandleId id();

  /** The task's name, as in its spec. */
  String name();

  /**
   * Puts {@code item} into the task's inbox and returns at once: the inbox's overflow policy
   * applies, and it never blocks (rule C5). {@link SendResult#CLOSED} once the task has stopped, or
   * when its start was refused.
   */
  SendResult post(I item);

  /** Asks the task to stop: its {@code take} gives {@code null}. Returns at once; does nothing when it has stopped. */
  void stop();
}
