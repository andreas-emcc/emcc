package dev.emcc.ecore.runtime;

import java.time.Duration;

/**
 * Runs short tasks after a delay: timer ticks, ask timeouts and watchdog checks. Tasks only hand
 * work to mailboxes; they never run plugin code. Injectable for deterministic tests.
 */
@FunctionalInterface
public interface Scheduler {

  /** Runs {@code task} once after {@code delay}. */
  Cancellable schedule(Duration delay, Runnable task);
}
