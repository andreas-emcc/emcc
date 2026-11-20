package dev.emcc.ecore.runtime;

/** What happened to a sent message. */
public enum SendOutcome {

  /** In the mailbox, possibly replacing a queued message with the same key or after evicting the oldest. */
  ACCEPTED,

  /** Not queued: the mailbox was full and the policy dropped this message. */
  DROPPED,

  /** Not queued: the worker is stopped. */
  CLOSED
}
