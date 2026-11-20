package dev.emcc.sdk.worker;

/**
 * What happened to a sent message.
 *
 * <pre>{@code
 * if (ref.send(message) != SendResult.ACCEPTED) { ... }
 * }</pre>
 */
public enum SendResult {
  /** In the mailbox (possibly replacing a queued message with the same key, or after evicting the oldest). */
  ACCEPTED,
  /** Not queued: the mailbox was full and the policy dropped this message. */
  DROPPED,
  /** Not queued: the worker is stopped. */
  CLOSED
}
