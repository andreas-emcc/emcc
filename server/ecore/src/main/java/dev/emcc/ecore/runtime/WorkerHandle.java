package dev.emcc.ecore.runtime;

/**
 * A reference to a worker: the only way to send it messages.
 *
 * @param <M> the messages the worker accepts
 */
public sealed interface WorkerHandle<M> permits WorkerCell {

  /** Unique in the runtime: {@code <owner>/<name>}. */
  String id();

  /** The owner: {@code core} or a plugin id. */
  String owner();

  String name();

  /**
   * Puts {@code message} into the worker's mailbox. Returns at once, except for a {@link
   * Overflow#BLOCK_SENDER} mailbox sent to from outside a worker, which waits at most the send
   * timeout. Every drop is counted.
   */
  SendOutcome send(M message);
}
