package dev.emcc.plugins.fmv.transport;

/**
 * How many of something happened in the last minute, from a total sampled once a second ({@code
 * ais}'s pattern; the playbook, work package 4). Not thread-safe: the worker uses it.
 *
 * <p>The total may start again from 0 (a restarted task counts afresh): a total below the last one
 * counts as all new, so the rate goes on with the new run's count instead of showing 0 until the
 * old run's samples have gone out of the minute.
 */
public final class Rate {

  private static final int SECONDS = 60;

  /** The running sum of all increases, once a second; the oldest is the one at {@link #next}. */
  private final long[] samples = new long[SECONDS + 1];
  private int next;
  private long last;
  private long sum;

  /** Takes the total as it is now; once a second. */
  public void sample(long total) {
    sum += increase(total);
    last = total;
    samples[next] = sum;
    next = (next + 1) % samples.length;
  }

  /** How much happened in the last minute, up to {@code total} (less nothing before the first minute is over). */
  public long perMinute(long total) {
    return Math.max(0, sum + increase(total) - samples[next]);
  }

  private long increase(long total) {
    return total >= last ? total - last : total;
  }
}
