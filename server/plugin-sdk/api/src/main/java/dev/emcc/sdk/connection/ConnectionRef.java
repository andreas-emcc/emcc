package dev.emcc.sdk.connection;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.SendResult;

/**
 * SDK 1.2.0: a started connection task (ADR-0036). An immutable handle; implementations (by ECore
 * and the test kit) are equal by {@link #id()}, so that it can travel in messages, as {@code
 * WorkerRef} does.
 *
 * <pre>{@code
 * if (out.post(new Outgoing(uid, bytes)) == SendResult.DROPPED) { out.count("dropped", 1); }
 * out.count("skipped: no CoT type", 1);   // a worker counts what it did not hand over
 * out.stop();                             // e.g. after the link was removed from the settings
 * }</pre>
 *
 * @param <I> the type of the task's inbox items
 */
public interface ConnectionRef<I extends Message> {

  HandleId id();

  /** The task's name: its spec's name, and for a child task its parent's name, a slash and its own. */
  String name();

  /**
   * Puts {@code item} into the task's inbox and returns at once; the inbox's overflow policy
   * applies ({@link ConnectionSpec}). Never blocks (rule C5). {@link SendResult#CLOSED} once the
   * task is stopped. Items posted while ECore restarts the task wait for the new run.
   */
  SendResult post(I item);

  /** Adds {@code delta} to the plugin's own counter {@code name} for this task, from a worker; never blocks. For what a worker skips or drops (ADR-0037 point 7). */
  void count(String name, long delta);

  /** Sets a detail of this task for the monitor view, from a worker; never blocks. */
  void detail(String key, String value);

  /**
   * Stops the task: ECore closes the resources it registered, so a blocked read ends, {@link
   * TaskContext#take} returns {@code null}, and the context is fenced. Its children stop too. No
   * restart follows. Calling it again has no effect. The name can then be used again.
   */
  void stop();
}
