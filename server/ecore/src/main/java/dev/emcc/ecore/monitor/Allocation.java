package dev.emcc.ecore.monitor;

import java.lang.management.ManagementFactory;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;
import jdk.jfr.consumer.RecordedClassLoader;
import jdk.jfr.consumer.RecordedEvent;
import jdk.jfr.consumer.RecordedFrame;
import jdk.jfr.consumer.RecordedStackTrace;
import jdk.jfr.consumer.RecordingStream;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The JVM's allocation for the monitor view (T-148; spike S5, {@code spikes/s5/README.md}; owner,
 * 2026-11-05: the total and ECore's share, no per-plugin numbers).
 *
 * <ul>
 *   <li><b>The total</b> comes from the JDK's own counter of every thread's allocated bytes: exact,
 *       virtual threads included (they allocate through their carriers).
 *   <li><b>ECore's share</b> comes from JFR's allocation samples ({@code jdk.ObjectAllocationSample},
 *       150 a second, the default profile's), read in this process: a sample with no frame of a
 *       plugin's class loader ({@code plugin-<id>}) on its stack is ECore's. It is approximate:
 *       a sample's weight is what its thread allocated since its previous sample, and ECore's
 *       workers share carrier threads with the plugins' (S5). The view takes the share from the two
 *       sampled counters and applies it to the exact total.
 * </ul>
 *
 * <p>Counters are totals since the start, like the rest of the snapshot. JFR's stream runs on a
 * thread of its own (the JDK's) and only adds to two atomic counters; any thread reads them.
 */
public final class Allocation implements AutoCloseable {

  private static final Logger LOG = LoggerFactory.getLogger(Allocation.class);

  static final String EVENT = "jdk.ObjectAllocationSample";
  /** The default profile's throttle; S5: at most ~0.3 % of one core. */
  static final String THROTTLE = "150/s";
  /** A plugin's class loader is named so ({@code PluginClassLoader}). */
  static final String PLUGIN_LOADER = "plugin-";

  /**
   * One reading.
   *
   * @param totalBytes every thread's allocated bytes since the JVM started, or -1 where the JDK does
   *     not count them
   * @param sampling whether JFR samples (else the two below stay 0)
   * @param sampledBytes the weight of every sample since sampling started
   * @param ecoreBytes the weight of the samples with no plugin frame
   */
  public record Reading(long totalBytes, boolean sampling, long sampledBytes, long ecoreBytes) {}

  private final AtomicLong sampled = new AtomicLong();
  private final AtomicLong ecore = new AtomicLong();
  private final @Nullable RecordingStream stream;

  private Allocation(@Nullable RecordingStream stream) {
    this.stream = stream;
  }

  /** The total only, no JFR ({@code emc2.monitor.allocation=false}, and ECore's tests). */
  public static Allocation totalOnly() {
    return new Allocation(null);
  }

  /** The total, and ECore's share from JFR; the total only if JFR cannot be started here. */
  public static Allocation sampling() {
    RecordingStream stream;
    try {
      stream = new RecordingStream();
    } catch (RuntimeException | Error e) { // e.g. a JVM without JFR, or JFR switched off
      LOG.warn("JFR could not be started; the monitor shows the JVM's total allocation without ECore's share: {}", e.toString());
      return totalOnly();
    }
    Allocation allocation = new Allocation(stream);
    stream.enable(EVENT).with("throttle", THROTTLE).withStackTrace();
    stream.setMaxAge(Duration.ofSeconds(30)); // the disk repository keeps no more than this
    stream.onEvent(EVENT, allocation::accept);
    stream.startAsync();
    return allocation;
  }

  public Reading read() {
    return new Reading(totalBytes(), stream != null, sampled.get(), ecore.get());
  }

  private void accept(RecordedEvent event) {
    add(event.getLong("weight"), hasPluginFrame(event.getStackTrace()));
  }

  void add(long weight, boolean plugin) {
    sampled.addAndGet(weight);
    if (!plugin) {
      ecore.addAndGet(weight);
    }
  }

  /** Whether a frame of a plugin's class loader is anywhere on the stack (S5's "any"; "own" gave the same bytes). */
  static boolean hasPluginFrame(@Nullable RecordedStackTrace stack) {
    if (stack == null) {
      return false;
    }
    for (RecordedFrame frame : stack.getFrames()) {
      if (frame.isJavaFrame() && isPluginLoader(frame.getMethod().getType().getClassLoader())) {
        return true;
      }
    }
    return false;
  }

  static boolean isPluginLoader(@Nullable RecordedClassLoader loader) {
    String name = loader == null ? null : loader.getName();
    return name != null && name.startsWith(PLUGIN_LOADER);
  }

  private static long totalBytes() {
    if (ManagementFactory.getThreadMXBean() instanceof com.sun.management.ThreadMXBean threads
        && threads.isThreadAllocatedMemorySupported() && threads.isThreadAllocatedMemoryEnabled()) {
      return threads.getTotalThreadAllocatedBytes();
    }
    return -1;
  }

  @Override
  public void close() {
    if (stream != null) {
      stream.close();
    }
  }
}
