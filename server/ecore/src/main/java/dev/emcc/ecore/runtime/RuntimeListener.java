package dev.emcc.ecore.runtime;

import java.time.Duration;
import java.util.List;
import java.util.function.Consumer;
import org.slf4j.LoggerFactory;

/**
 * Receives the runtime's health events, e.g. to set a plugin's status to {@code DEGRADED}
 * (plugin host, T-015) or to count them in metrics. The runtime logs every event itself.
 *
 * <p>Called on runtime threads (the watchdog, a worker): implementations must return quickly and
 * must not block.
 */
public interface RuntimeListener {

  RuntimeListener NONE = new RuntimeListener() {};

  /** Passes every event to each of {@code listeners}, in order; one that throws does not stop the others. */
  static RuntimeListener all(List<RuntimeListener> listeners) {
    List<RuntimeListener> copy = List.copyOf(listeners);
    return new RuntimeListener() {
      @Override
      public void workerHung(WorkerInfo worker, Duration elapsed, boolean restarting, HungCall call) {
        each(l -> l.workerHung(worker, elapsed, restarting, call));
      }

      @Override
      public void workerRestarted(WorkerInfo worker, long restarts) {
        each(l -> l.workerRestarted(worker, restarts));
      }

      @Override
      public void workerRecovered(WorkerInfo worker, Duration elapsed, HungCall call) {
        each(l -> l.workerRecovered(worker, elapsed, call));
      }

      @Override
      public void handlerFailed(WorkerInfo worker, Throwable error) {
        each(l -> l.handlerFailed(worker, error));
      }

      @Override
      public void workerFailed(WorkerInfo worker, Throwable error) {
        each(l -> l.workerFailed(worker, error));
      }

      @Override
      public void capReached(String owner, OwnerLimits.Cap cap, int limit, long refusedSoFar) {
        each(l -> l.capReached(owner, cap, limit, refusedSoFar));
      }

      private void each(Consumer<RuntimeListener> event) {
        for (RuntimeListener l : copy) {
          try {
            event.accept(l);
          } catch (RuntimeException e) {
            LoggerFactory.getLogger(RuntimeListener.class).warn("A runtime listener failed", e);
          }
        }
      }
    };
  }

  /**
   * A handler call exceeded its budget. {@code restarting} tells whether the worker is restarted;
   * {@code call} what it was handling and how much of its time the JVM spent in garbage collection.
   */
  default void workerHung(WorkerInfo worker, Duration elapsed, boolean restarting, HungCall call) {}

  /** A hung worker was restarted: its fresh handler exists (called on the new worker thread). */
  default void workerRestarted(WorkerInfo worker, long restarts) {}

  /** A hung call returned after all (the worker was not restarted); {@code call} as for {@link #workerHung}. */
  default void workerRecovered(WorkerInfo worker, Duration elapsed, HungCall call) {}

  /** A handler call threw. The worker continues with the next message. */
  default void handlerFailed(WorkerInfo worker, Throwable error) {}

  /** A restart failed because the handler factory threw. The worker is closed. */
  default void workerFailed(WorkerInfo worker, Throwable error) {}

  /**
   * An owner's cap refused an ask or a timer (CR-0005). Reported, like the log entry, at most once
   * a minute per owner, whichever cap refused; {@code refusedSoFar} counts every refusal of that cap.
   */
  default void capReached(String owner, OwnerLimits.Cap cap, int limit, long refusedSoFar) {}
}
