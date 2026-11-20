package dev.emcc.sdk.connection;

import java.time.Duration;
import java.util.Objects;

/**
 * SDK 1.2.0: the delays between restarts of a connection task: {@code initial}, then doubling up
 * to {@code max}. A run that lasted at least {@code max} starts again from {@code initial}. It
 * behaves as the deprecated listener's {@code dev.emcc.sdk.listener.Backoff}.
 *
 * <pre>{@code
 * Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60))   // 1 s, 2 s, 4 s, … 60 s, 60 s
 * }</pre>
 *
 * @param initial the first delay, 100 ms to 1 hour
 * @param max the longest delay, from {@code initial} to 1 hour
 */
public record Backoff(Duration initial, Duration max) {

  public Backoff {
    Objects.requireNonNull(initial, "initial");
    Objects.requireNonNull(max, "max");
    if (initial.compareTo(Duration.ofMillis(100)) < 0 || initial.compareTo(Duration.ofHours(1)) > 0) {
      throw new IllegalArgumentException("initial delay must be 100 ms..1 h: " + initial);
    }
    if (max.compareTo(initial) < 0 || max.compareTo(Duration.ofHours(1)) > 0) {
      throw new IllegalArgumentException("max delay must be initial..1 h: " + max);
    }
  }

  public static Backoff exponential(Duration initial, Duration max) {
    return new Backoff(initial, max);
  }

  /** The delay after {@code failures} consecutive runs that ended early (0 gives {@code initial}). */
  public Duration delay(int failures) {
    if (failures < 0) {
      throw new IllegalArgumentException("failures must be >= 0");
    }
    Duration d = initial;
    for (int i = 0; i < failures && d.compareTo(max) < 0; i++) {
      d = d.multipliedBy(2);
    }
    return d.compareTo(max) > 0 ? max : d;
  }
}
