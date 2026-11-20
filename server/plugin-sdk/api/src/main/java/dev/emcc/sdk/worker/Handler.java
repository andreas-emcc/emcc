package dev.emcc.sdk.worker;

import dev.emcc.sdk.Message;

/**
 * Handles a worker's messages, one at a time (rule C2). The handler object holds the worker's
 * state; only its worker touches it, so it needs no locks.
 *
 * <p>A call must return within the worker's budget (default 5 s). Blocking I/O never belongs in a
 * handler (rule C6): use {@link dev.emcc.sdk.http.OutboundHttp} or ask another worker.
 *
 * <pre>{@code
 * final class Counter implements Handler<CounterMsg> {
 *   private long count;
 *
 *   public void handle(CounterMsg message, WorkerContext<CounterMsg> ctx) {
 *     switch (message) {
 *       case CounterMsg.Add add -> count += add.amount();
 *       case CounterMsg.Get get -> get.replyTo().reply(new CounterMsg.Value(count));
 *       case CounterMsg.Value v -> ctx.log().warn("unexpected {}", v);
 *     }
 *   }
 * }
 * }</pre>
 *
 * @param <M> the worker's message type, usually a sealed interface
 */
@FunctionalInterface
public interface Handler<M extends Message> {

  void handle(M message, WorkerContext<M> context);
}
