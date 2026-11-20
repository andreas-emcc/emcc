package dev.emcc.sdk.worker;

import dev.emcc.sdk.Message;

/**
 * A reference to a worker: the only way to send it messages. An immutable value; implementations
 * (by ECore and the test kit) must be equal by {@link #id()}.
 *
 * <pre>{@code
 * switch (tiles.send(new TileMsg.Prefetch(key))) {
 *   case ACCEPTED -> {}
 *   case DROPPED -> log.debug("tile worker busy, prefetch skipped");
 *   case CLOSED -> log.warn("tile worker stopped");
 * }
 * }</pre>
 *
 * @param <M> the messages the worker accepts
 */
public interface WorkerRef<M extends Message> {

  HandleId id();

  /** The worker's name from its {@link WorkerSpec}. */
  String name();

  /**
   * Puts {@code message} into the worker's mailbox and returns at once. Never blocks. If the
   * mailbox is full, the worker's {@link Overflow} policy decides; every drop is counted.
   */
  SendResult send(M message);
}
