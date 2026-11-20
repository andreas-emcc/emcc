package dev.emcc.sdk.listener;

import dev.emcc.sdk.worker.HandleId;

/**
 * A started listener. An immutable value; implementations (by ECore and the test kit) must be
 * equal by {@link #id()}, so that it can be passed in messages.
 *
 * <pre>{@code
 * north.stop();   // e.g. after the stream was removed from the settings
 * }</pre>
 *
 * @deprecated from SDK 1.2.0: use a connection task ({@code dev.emcc.sdk.connection}), in which the
 *     plugin opens its own sockets of any kind (ADR-0036). Kept in SDK 1.x for existing code, removed
 *     in the next major version.
 */
@Deprecated(since = "1.2.0")
public interface ListenerRef {

  HandleId id();

  /** The listener's name from its {@link ListenerSpec}. */
  String name();

  /**
   * Stops the listener: closes its connection, so a blocked read ends, and fences its context. No
   * reconnect follows. Calling it again has no effect. The name can then be used again.
   */
  void stop();
}
