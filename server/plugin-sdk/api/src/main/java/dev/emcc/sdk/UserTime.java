package dev.emcc.sdk;

import java.time.Instant;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.4.0 (ADR-0045, CR-0030 part 4, CR-0032): the time a browser session's user has picked in
 * the top bar's time control. It has two independent parts (CR-0032):
 * <ul>
 *   <li><b>the set time</b> {@link #time()}: {@code null} for now (the default), or a time;
 *   <li><b>the interval</b> {@link #interval()}: {@code null} when there is none (the default), or a
 *       start and an end, the start not after the end.
 * </ul>
 * Neither part limits the other: the set time may lie outside the interval. Each plugin reads the
 * part it needs, e.g. a weather plugin the set time, a track plugin the interval. Times are UTC.
 * Only temporal plugins ({@code dev.emcc.sdk.capability.Temporal}) react to it; for every other
 * plugin it is always {@link #NOW}. An interval's end that follows the clock is not part of 1.4.0.
 *
 * <pre>{@code
 * UserTime t = request.userTime();
 * Instant weatherAt = t.time() == null ? clock.now() : t.time();   // the set time alone is now
 * UserTime.Interval tracks = t.interval();                         // null: no interval
 * }</pre>
 *
 * @param time the set time, {@code null} for now
 * @param interval the interval, {@code null} for none
 */
public record UserTime(@Nullable Instant time, @Nullable Interval interval) {

  /** Now with no interval, the default: each page load starts with it (ADR-0045 point 2). */
  public static final UserTime NOW = new UserTime(null, null);

  /** {@link #NOW}. */
  public static UserTime now() {
    return NOW;
  }

  /** The set time {@code time}, with no interval. */
  public static UserTime at(Instant time) {
    return new UserTime(Objects.requireNonNull(time, "time"), null);
  }

  /** This value's set time with the interval from {@code from} to {@code to}; {@code from} is not after {@code to}. */
  public UserTime withInterval(Instant from, Instant to) {
    return new UserTime(time, new Interval(from, to));
  }

  /** This value's set time with no interval. */
  public UserTime withoutInterval() {
    return interval == null ? this : new UserTime(time, null);
  }

  /**
   * Whether the whole value is at its defaults: the set time at now <b>and</b> no interval (the
   * ACA's R2 on CR-0032). The set time alone is now when {@code time() == null}, whatever the
   * interval. A session that ends is delivered this value (owner, Q10).
   */
  public boolean isNow() {
    return time == null && interval == null;
  }

  /** An interval, {@code from} not after {@code to} (ECore checks it, ADR-0045 point 4). */
  public record Interval(Instant from, Instant to) {
    public Interval {
      Objects.requireNonNull(from, "from");
      Objects.requireNonNull(to, "to");
      if (from.isAfter(to)) {
        throw new IllegalArgumentException("an interval's start is not after its end: " + from + " > " + to);
      }
    }

    /** Whether {@code t} lies in the interval, both ends included. */
    public boolean contains(Instant t) {
      return !t.isBefore(from) && !t.isAfter(to);
    }
  }
}
