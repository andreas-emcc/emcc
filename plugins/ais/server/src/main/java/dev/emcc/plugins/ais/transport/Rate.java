package dev.emcc.plugins.ais.transport;

/**
 * How many of something happened in the last minute, from a total that only grows, sampled once a
 * second. Not thread-safe: the worker uses it.
 */
final class Rate {

  private static final int SECONDS = 60;

  private final long[] samples = new long[SECONDS + 1];
  private int next;

  /** Takes the total as it is now. */
  void sample(long total) {
    samples[next] = total;
    next = (next + 1) % samples.length;
  }

  /** The total now less the total 60 samples ago (less nothing, as the total started at 0, in the first minute). */
  long perMinute(long total) {
    return Math.max(0, total - samples[next]);
  }
}
