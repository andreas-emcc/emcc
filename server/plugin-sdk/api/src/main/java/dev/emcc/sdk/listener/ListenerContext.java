package dev.emcc.sdk.listener;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginLog;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;

/**
 * What a listener's loop may do besides reading: send messages to workers, log, and see whether
 * it should stop. It is not a {@code WorkerContext}: a loop cannot ask, submit changes or set
 * timers. It sends to a worker that can.
 *
 * <p>When the listener is stopped, the plugin stops, or the connection ends, the context is
 * <b>fenced</b>: what the loop sends afterwards is dropped ({@link SendResult#CLOSED}). So send
 * through this context, not through {@link WorkerRef#send} directly.
 *
 * <pre>{@code
 * if (ctx.send(applier, event) == SendResult.DROPPED) { dropped++; }
 * }</pre>
 *
 * @deprecated from SDK 1.2.0: use a connection task ({@code dev.emcc.sdk.connection}), in which the
 *     plugin opens its own sockets of any kind (ADR-0036). Kept in SDK 1.x for existing code, removed
 *     in the next major version.
 */
@Deprecated(since = "1.2.0")
public interface ListenerContext {

  /** Puts {@code message} into the worker's mailbox and returns at once; the worker's overflow policy applies. Never blocks. */
  <M extends Message> SendResult send(WorkerRef<M> target, M message);

  /** The plugin's logger; entries are also tagged with the listener's name. */
  PluginLog log();

  /** True once the listener is being stopped; the loop should then return. */
  boolean stopping();

  /** This listener. */
  ListenerRef self();
}
