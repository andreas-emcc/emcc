package dev.emcc.ecore.runtime;

/**
 * Monotonic time for budgets and timeouts. Injectable, so that tests of the watchdog and of timers
 * are deterministic.
 */
@FunctionalInterface
public interface RuntimeClock {

  /** Monotonic time in nanoseconds, like {@link System#nanoTime()}. */
  long nanoTime();

  static RuntimeClock system() {
    return System::nanoTime;
  }
}
