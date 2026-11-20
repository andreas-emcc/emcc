package dev.emcc.sdk.listener;

import java.time.Duration;
import java.util.Objects;

/**
 * The delays between reconnects: {@code initial}, then doubling up to {@code max}. A connection
 * that stayed up for at least {@code max} starts again from {@code initial}.
 *
 * <pre>{@code
 * Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60))   // 1 s, 2 s, 4 s, … 60 s, 60 s
 * backoff.delay(3)                                                      // 8 s: the delay before the 4th attempt
 * }</pre>
 *
 * @param initial the first delay, 100 ms to 1 hour
 * @param max the longest delay, from {@code initial} to 1 hour
 *
 * @deprecated from SDK 1.2.0: use a connection task ({@code dev.emcc.sdk.connection}), in which the
 *     plugin opens its own sockets of any kind (ADR-0036). Kept in SDK 1.x for existing code, removed
 *     in the next major version.
 */
@Deprecated(since = "1.2.0")
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

  /** The delay after {@code failures} consecutive failed or ended connections (0 gives {@code initial}). */
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
