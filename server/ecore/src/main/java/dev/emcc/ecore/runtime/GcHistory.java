package dev.emcc.ecore.runtime;

/**
 * The JVM's total garbage collection time, sampled by the watchdog on every tick (every 100 ms by
 * default), so that a hung call can say how much of its time the JVM spent in garbage collection:
 * a pause of the whole JVM, not slow work of the call. Sampling costs nothing per message. Keeps the
 * last {@link #SIZE} samples (about 100 s at the default interval).
 *
 * <p>Its lock is a leaf lock (rule C4): the GC source is read before it is taken, and nothing is
 * called while it is held. Reading the GC source never fails a tick or a report: a failure skips
 * the sample, or makes the GC time unknown.
 */
final class GcHistory {

  static final int SIZE = 1024;

  /**
   * GC time during a call: from the last sample at or before its start (so up to one tick more), to
   * now; {@link HungCall#GC_UNKNOWN} if it could not be read.
   */
  record Since(long millis, boolean fromStart) {}

  private final GcTime gc;
  private final long[] at = new long[SIZE];
  private final long[] total = new long[SIZE];
  private int count;
  private int next;

  GcHistory(GcTime gc) {
    this.gc = gc;
  }

  void sample(long nanos) {
    long millis;
    try {
      millis = gc.totalMillis();
    } catch (RuntimeException e) {
      return; // no sample this tick; the watchdog goes on
    }
    synchronized (this) {
      at[next] = nanos;
      total[next] = millis;
      next = (next + 1) % SIZE;
      count = Math.min(count + 1, SIZE);
    }
  }

  /**
   * The GC time since {@code startNanos}. {@code fromStart} is false if no sample is that old: then
   * the time counts from the oldest sample, so the call had at least that much.
   */
  Since since(long startNanos) {
    long now;
    try {
      now = gc.totalMillis();
    } catch (RuntimeException e) {
      return new Since(HungCall.GC_UNKNOWN, false);
    }
    return since(startNanos, now);
  }

  private synchronized Since since(long startNanos, long now) {
    if (count == 0) {
      return new Since(0, false);
    }
    int oldest = count < SIZE ? 0 : next;
    int best = -1;
    for (int i = 0; i < count; i++) {
      int slot = (oldest + i) % SIZE;
      if (at[slot] <= startNanos) {
        best = slot;
      }
    }
    if (best < 0) {
      return new Since(Math.max(0, now - total[oldest]), false);
    }
    return new Since(Math.max(0, now - total[best]), true);
  }
}
