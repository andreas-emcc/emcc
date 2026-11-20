package dev.emcc.ecore.plugin;

import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerRuntime;
import java.util.ArrayDeque;
import java.util.Objects;
import java.util.function.Function;

/**
 * Events for one plugin worker, from a listener or a connection task: always delivered, in order,
 * one at a time; when more than {@code maxPending} wait undelivered (a worker that hangs), only the
 * latest is kept. The mapper is plugin code and runs in the worker, when it takes the event.
 *
 * <p>Thread-safe: any thread adds. The queue's monitor is a leaf lock (rule C4): held only to
 * change the queue, never while the mapper or the runtime runs.
 */
final class EventQueue<E, M> {

  private final WorkerRuntime runtime;
  private final WorkerHandle<M> target;
  private final Function<? super E, ? extends M> toMessage;
  private final int maxPending;
  private final ArrayDeque<E> queue = new ArrayDeque<>(); // guarded by this
  private boolean waiting; // guarded by this: an event is on its way to the worker

  EventQueue(WorkerRuntime runtime, WorkerHandle<M> target, Function<? super E, ? extends M> toMessage, int maxPending) {
    this.runtime = runtime;
    this.target = target;
    this.toMessage = toMessage;
    this.maxPending = maxPending;
  }

  void add(E event) {
    Objects.requireNonNull(event, "event");
    boolean signal;
    synchronized (this) {
      if (queue.size() >= maxPending) {
        queue.clear(); // a worker that hangs: keep only the latest
      }
      queue.addLast(event);
      signal = !waiting;
      waiting = true;
    }
    if (signal) {
      deliver();
    }
  }

  private void deliver() {
    if (!runtime.deliverAlways(target, this::take)) {
      synchronized (this) {
        waiting = false;
        queue.clear(); // the worker has stopped
      }
    }
  }

  private M take() {
    E event;
    boolean more;
    synchronized (this) {
      event = Objects.requireNonNull(queue.pollFirst());
      more = !queue.isEmpty();
      waiting = more;
    }
    if (more) {
      deliver();
    }
    return toMessage.apply(event);
  }
}
