package dev.emcc.ecore.monitor;

/**
 * Allocates {@link #BYTES} in 4 KiB arrays over about 2 s. {@link AllocationTest} loads it through a class loader
 * named like a plugin's, so that JFR's samples of it carry a plugin frame. Uses the JDK only.
 */
public final class PluginAllocator implements Runnable {

  static final long BYTES = 200L * 1024 * 1024;

  /** Read by nobody; keeps the JIT from dropping the arrays. */
  public static volatile Object sink;

  @Override
  public void run() {
    allocate(BYTES);
  }

  /**
   * Allocates {@code bytes} in 100 steps 20 ms apart, as a steady allocator does: JFR weighs a
   * thread's bytes at its next sample, so what a short burst allocates after its last one is lost.
   */
  static void allocate(long bytes) {
    Object[] ring = new Object[64];
    long i = 0;
    for (int step = 0; step < 100; step++) {
      for (long done = 0; done < bytes / 100; done += 4096, i++) {
        ring[(int) (i % ring.length)] = new byte[4096];
      }
      try {
        Thread.sleep(20);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return;
      }
    }
    sink = ring;
  }
}
