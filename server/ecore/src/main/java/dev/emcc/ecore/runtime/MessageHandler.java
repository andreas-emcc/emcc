package dev.emcc.ecore.runtime;

/**
 * Handles a worker's messages, one at a time (rule C2). The handler object holds the worker's
 * state; only its worker touches it, so it needs no locks. A call must return within the worker's
 * budget.
 *
 * @param <M> the worker's message type
 */
@FunctionalInterface
public interface MessageHandler<M> {

  void handle(M message, HandlerContext<M> context);
}
