package dev.emcc.sdk.listener;

import java.time.Instant;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * What happened to a listener's connection, reported to the worker given to {@link
 * Listeners#start(ListenerSpec, java.util.function.Supplier, dev.emcc.sdk.worker.WorkerRef,
 * java.util.function.Function)}. Always delivered, in order.
 *
 * <pre>{@code
 * switch (event) {
 *   case ListenerEvent.Connected c -> status.connected(c.listener(), c.at());
 *   case ListenerEvent.Disconnected d -> status.lost(d.listener(), d.reason(), d.retryAt());
 * }
 * }</pre>
 *
 * @deprecated from SDK 1.2.0: use a connection task ({@code dev.emcc.sdk.connection}), in which the
 *     plugin opens its own sockets of any kind (ADR-0036). Kept in SDK 1.x for existing code, removed
 *     in the next major version.
 */
@Deprecated(since = "1.2.0")
public sealed interface ListenerEvent permits ListenerEvent.Connected, ListenerEvent.Disconnected {

  /** The listener's name. */
  String listener();

  /** A connection was made, and the loop is running. */
  record Connected(String listener, Instant at) implements ListenerEvent {
    public Connected {
      Objects.requireNonNull(listener, "listener");
      Objects.requireNonNull(at, "at");
    }
  }

  /**
   * A connection attempt failed, or a connection ended.
   *
   * @param reason why, e.g. "connection refused", "idle for 5 minutes", the loop's exception
   * @param retryAt when ECore connects again, or {@code null} if it does not (no back-off, or stopped)
   */
  record Disconnected(String listener, Instant at, String reason, @Nullable Instant retryAt) implements ListenerEvent {
    public Disconnected {
      Objects.requireNonNull(listener, "listener");
      Objects.requireNonNull(at, "at");
      Objects.requireNonNull(reason, "reason");
    }
  }
}
