package dev.emcc.ecore.plugin;

import java.time.Duration;
import java.util.function.IntFunction;

/**
 * How long a loop that ended waits before it runs again: a listener's reconnect, and a connection
 * task's restart (ADR-0036). The first wait is the back-off's first delay, then they grow with each
 * run that failed or ended within the back-off's longest delay, and start over after a run that
 * lasted at least that long. Never less than {@link #MIN}.
 *
 * <p>Not thread-safe: one loop uses it, between its runs.
 */
final class RetryDelay {

  /** The shortest wait, whatever the back-off says. */
  static final Duration MIN = Duration.ofMillis(100);

  private final Duration max;
  private final IntFunction<Duration> delay;
  /** Runs that failed or ended early since the last one that lasted at least {@code max}. */
  private int failures;

  /**
   * @param max the back-off's longest delay: a run that lasted this long starts the delays over
   * @param delay the back-off's delay before the run after {@code n} early ends (0 for the first)
   */
  RetryDelay(Duration max, IntFunction<Duration> delay) {
    this.max = max;
    this.delay = delay;
  }

  /** The wait after a run that lasted {@code ranFor}. */
  Duration after(Duration ranFor) {
    boolean lasted = ranFor.compareTo(max) >= 0;
    int count = lasted ? 0 : failures++;
    if (lasted) {
      failures = 1;
    }
    Duration wait = delay.apply(count);
    return wait.compareTo(MIN) < 0 ? MIN : wait;
  }
}
