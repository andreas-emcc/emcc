package dev.emcc.ecore.runtime;

import java.time.Duration;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * Configuration of the worker runtime. Immutable; the methods return a changed copy.
 *
 * @param clock monotonic time for budgets
 * @param scheduler runs timers, ask timeouts and watchdog checks; {@code null} means the runtime
 *     creates its own (one platform thread) and closes it with the runtime
 * @param watchdogInterval how often the watchdog checks running handler calls
 * @param restartLimit how many restarts a worker may have within {@code restartWindow}; after that
 *     a hung worker is not restarted again
 * @param restartWindow the window for {@code restartLimit}
 * @param listener receives health events
 * @param computeThreads the size of the pool of platform threads for compute workers' handler calls
 *     (rule C7)
 * @param gcTime the JVM's garbage collection time, which the watchdog samples for hang reports
 */
public record RuntimeConfig(
    RuntimeClock clock,
    @Nullable Scheduler scheduler,
    Duration watchdogInterval,
    int restartLimit,
    Duration restartWindow,
    RuntimeListener listener,
    int computeThreads,
    GcTime gcTime) {

  public RuntimeConfig {
    Objects.requireNonNull(clock, "clock");
    Objects.requireNonNull(watchdogInterval, "watchdogInterval");
    Objects.requireNonNull(restartWindow, "restartWindow");
    Objects.requireNonNull(listener, "listener");
    Objects.requireNonNull(gcTime, "gcTime");
    if (watchdogInterval.compareTo(Duration.ofMillis(1)) < 0) {
      throw new IllegalArgumentException("watchdog interval must be at least 1 ms: " + watchdogInterval);
    }
    if (restartLimit < 0) {
      throw new IllegalArgumentException("restart limit must not be negative: " + restartLimit);
    }
    if (restartWindow.isNegative() || restartWindow.isZero()) {
      throw new IllegalArgumentException("restart window must be positive: " + restartWindow);
    }
    if (computeThreads < 1) {
      throw new IllegalArgumentException("there must be at least one compute thread: " + computeThreads);
    }
  }

  /** With the JVM's own garbage collection time. */
  public RuntimeConfig(RuntimeClock clock, @Nullable Scheduler scheduler, Duration watchdogInterval, int restartLimit,
      Duration restartWindow, RuntimeListener listener, int computeThreads) {
    this(clock, scheduler, watchdogInterval, restartLimit, restartWindow, listener, computeThreads, GcTime.jvm());
  }

  /**
   * System clock, own scheduler, watchdog every 100 ms, at most 3 restarts within 10 minutes (as in
   * the SDK v0 design), no listener, one compute thread per processor.
   */
  public static RuntimeConfig defaults() {
    return new RuntimeConfig(
        RuntimeClock.system(), null, Duration.ofMillis(100), 3, Duration.ofMinutes(10), RuntimeListener.NONE,
        Runtime.getRuntime().availableProcessors(), GcTime.jvm());
  }

  /** Uses {@code time} as both clock and scheduler, e.g. a manual time source in tests. */
  public <T extends RuntimeClock & Scheduler> RuntimeConfig time(T time) {
    return new RuntimeConfig(time, time, watchdogInterval, restartLimit, restartWindow, listener, computeThreads, gcTime);
  }

  public RuntimeConfig watchdogInterval(Duration interval) {
    return new RuntimeConfig(clock, scheduler, interval, restartLimit, restartWindow, listener, computeThreads, gcTime);
  }

  public RuntimeConfig restarts(int limit, Duration window) {
    return new RuntimeConfig(clock, scheduler, watchdogInterval, limit, window, listener, computeThreads, gcTime);
  }

  public RuntimeConfig listener(RuntimeListener newListener) {
    return new RuntimeConfig(clock, scheduler, watchdogInterval, restartLimit, restartWindow, newListener, computeThreads, gcTime);
  }

  /** Uses {@code gc} for the garbage collection time in hang reports, e.g. a counter in tests. */
  public RuntimeConfig gcTime(GcTime gc) {
    return new RuntimeConfig(clock, scheduler, watchdogInterval, restartLimit, restartWindow, listener, computeThreads, gc);
  }

  public RuntimeConfig computeThreads(int threads) {
    return new RuntimeConfig(clock, scheduler, watchdogInterval, restartLimit, restartWindow, listener, threads, gcTime);
  }
}
