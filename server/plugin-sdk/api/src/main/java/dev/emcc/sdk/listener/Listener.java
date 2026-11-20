package dev.emcc.sdk.listener;

import java.io.IOException;

/**
 * A listener's loop: plugin code that ECore runs on a dedicated virtual thread, once per
 * connection (overview 4.2, rule C6). It is the only plugin code that may block, and only in
 * reads and writes of its {@link ListenerConnection}.
 *
 * <p>The loop owns its connection and its own local state; it shares nothing with workers. It
 * sends what it reads to workers through {@link ListenerContext#send}. It must not spend its time
 * computing: parse small pieces and pass the work on (CPU-heavy work to a compute worker, rule
 * C7). No watchdog budget applies to it. When it returns or throws, or the connection fails or
 * stays idle too long, ECore closes the connection and, with a {@link Backoff}, connects again
 * with a fresh listener from the factory.
 *
 * <pre>{@code
 * final class CotReader implements Listener {
 *   public void run(ListenerConnection connection, ListenerContext ctx) throws IOException {
 *     InputStream in = connection.input();
 *     for (Bytes event; (event = framer.next(in)) != null && !ctx.stopping(); ) {
 *       ctx.send(applier, CotEvent.parse(event));
 *     }
 *   }
 * }
 * }</pre>
 *
 * @deprecated from SDK 1.2.0: use a connection task ({@code dev.emcc.sdk.connection}), in which the
 *     plugin opens its own sockets of any kind (ADR-0036). Kept in SDK 1.x for existing code, removed
 *     in the next major version.
 */
@Deprecated(since = "1.2.0")
@FunctionalInterface
public interface Listener {

  /**
   * Reads from {@code connection} until it ends.
   *
   * @throws IOException when the connection fails, is closed or stays idle; ECore reports it as
   *     the reason in {@link ListenerEvent.Disconnected}
   */
  void run(ListenerConnection connection, ListenerContext context) throws IOException;
}
