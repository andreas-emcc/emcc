package dev.emcc.plugins.gmti.transport;

/**
 * How many of something happened in the last minute, from a total that only grows, sampled once a
 * second ({@code ais}'s pattern; the playbook, work package 4). Not thread-safe: the worker uses it.
 */
final class Rate {

  private static final int SECONDS = 60;

  private final long[] samples = new long[SECONDS + 1];
  private int next;

  /** Takes the total as it is now; once a second. */
  void sample(long total) {
    samples[next] = total;
    next = (next + 1) % samples.length;
  }

  /** The total now less the total 60 samples ago (less nothing in the first minute, as the total started at 0). */
  long perMinute(long total) {
    return Math.max(0, total - samples[next]);
  }
}
