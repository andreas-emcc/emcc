package dev.emcc.ecore.runtime;

/** What a full mailbox does with a new message (overview 4.2). */
public enum Overflow {

  /** Evicts the oldest queued message to make room. */
  DROP_OLDEST,

  /** Refuses the new message ({@link SendOutcome#DROPPED}). */
  DROP_NEWEST,

  /**
   * Keeps only the latest message per key: a message with a non-null key replaces a queued message
   * with an equal key <b>in place</b>, keeping its position. Messages without a key are never
   * coalesced. If nothing is replaced and the mailbox is full, the oldest message is evicted.
   */
  COALESCE_BY_KEY,

  /**
   * Makes the sender wait for room, at most the worker's send timeout. A send from a worker thread
   * never waits: it gets {@link SendOutcome#DROPPED} instead, so that two workers can never stall
   * on each other's full mailboxes (rule C5). Topic deliveries and timers never wait either. Not
   * offered to plugins in SDK v0; meant for the edge and for listeners.
   */
  BLOCK_SENDER
}
