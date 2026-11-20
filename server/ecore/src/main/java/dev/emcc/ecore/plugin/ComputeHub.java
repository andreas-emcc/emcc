package dev.emcc.ecore.plugin;

import java.util.concurrent.atomic.AtomicInteger;

/**
 * The server's cap on compute tasks (SDK 1.9.0, ADR-0064 point 4; owner YQ1 A): it counts every
 * plugin's compute tasks from their start until their thread has ended, their restarts' back-off
 * and a hung task included, and refuses a start above {@code emc2.compute.max-threads}. Declared
 * threads that are not running block nobody. Lock-free.
 */
public final class ComputeHub {

  private final int cap;
  private final AtomicInteger held = new AtomicInteger();

  /**
   * @param cap the most compute tasks of all plugins together, at least 1
   */
  ComputeHub(int cap) {
    if (cap < 1) {
      throw new IllegalArgumentException("emc2.compute.max-threads must be at least 1: " + cap);
    }
    this.cap = cap;
  }

  /** The default cap: the computer's cores minus one, at least one (ADR-0064 point 4). */
  public static int defaultCap() {
    return Math.max(1, Runtime.getRuntime().availableProcessors() - 1);
  }

  /** Takes a place for a starting task; false at the cap. */
  boolean take() {
    while (true) {
      int now = held.get();
      if (now >= cap) {
        return false;
      }
      if (held.compareAndSet(now, now + 1)) {
        return true;
      }
    }
  }

  /** Gives a place back: a task's thread has ended, or its start did not go through. */
  void give() {
    held.decrementAndGet();
  }

  public int cap() {
    return cap;
  }

  /** The places held now. */
  public int held() {
    return held.get();
  }
}
