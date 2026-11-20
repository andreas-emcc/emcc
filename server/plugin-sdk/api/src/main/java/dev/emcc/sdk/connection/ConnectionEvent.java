package dev.emcc.sdk.connection;

import java.time.Instant;
import java.util.Objects;

/**
 * SDK 1.2.0: what happened to a connection task (ADR-0036 point 6), reported to the worker given to
 * {@link Connections#start(ConnectionSpec, java.util.function.Supplier, dev.emcc.sdk.worker.WorkerRef,
 * java.util.function.Function)}. Always delivered, in order. ECore shows the same in the monitor
 * view.
 *
 * <pre>{@code
 * switch (event) {
 *   case ConnectionEvent.Running r -> status.up(r.task());
 *   case ConnectionEvent.Restarting r -> status.retrying(r.task(), r.reason(), r.retryAt());
 *   case ConnectionEvent.Stopped s -> status.stopped(s.task());
 *   case ConnectionEvent.Failed f -> status.failed(f.task(), f.reason());
 * }
 * }</pre>
 */
public sealed interface ConnectionEvent permits ConnectionEvent.Running, ConnectionEvent.Restarting, ConnectionEvent.Stopped, ConnectionEvent.Failed {

  /** The task's name. */
  String task();

  /** When it happened. */
  Instant at();

  /** A run started. */
  record Running(String task, Instant at) implements ConnectionEvent {
    public Running {
      Objects.requireNonNull(task, "task");
      Objects.requireNonNull(at, "at");
    }
  }

  /**
   * A run ended, and a fresh one starts at {@code retryAt}.
   *
   * @param reason why the run ended: the exception, or "the task returned"
   */
  record Restarting(String task, Instant at, String reason, Instant retryAt) implements ConnectionEvent {
    public Restarting {
      Objects.requireNonNull(task, "task");
      Objects.requireNonNull(at, "at");
      Objects.requireNonNull(reason, "reason");
      Objects.requireNonNull(retryAt, "retryAt");
    }
  }

  /** The task ended for good without failing: it was stopped, or {@code run} returned without a restart. */
  record Stopped(String task, Instant at) implements ConnectionEvent {
    public Stopped {
      Objects.requireNonNull(task, "task");
      Objects.requireNonNull(at, "at");
    }
  }

  /** The task ended for good because {@code run} threw, without a restart. */
  record Failed(String task, Instant at, String reason) implements ConnectionEvent {
    public Failed {
      Objects.requireNonNull(task, "task");
      Objects.requireNonNull(at, "at");
      Objects.requireNonNull(reason, "reason");
    }
  }
}
