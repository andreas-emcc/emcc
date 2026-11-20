package dev.emcc.sdk.compute;

import java.time.Instant;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.9.0 (CR-0048 point 5): what happens to a compute task, sent to the events target of {@link
 * Computes#start(ComputeSpec, java.util.function.Supplier, dev.emcc.sdk.worker.WorkerRef,
 * java.util.function.Function)}.
 */
public sealed interface ComputeEvent permits ComputeEvent.Running, ComputeEvent.Restarting, ComputeEvent.Stopped, ComputeEvent.Failed, ComputeEvent.Refused, ComputeEvent.Hung {

  /** The task's name. */
  String task();

  /** When it happened, on ECore's clock. */
  Instant at();

  /** Why ECore refused a start (owner YQ1 A: the cap counts running compute tasks). */
  enum Refusal {
    /** The plugin's manifest declares no {@code compute}. */
    NOT_DECLARED,
    /** The admin switched the plugin's compute threads off (allowed is 0). */
    SWITCHED_OFF,
    /** The plugin already runs {@link Computes#allowed()} compute tasks. */
    PLUGIN_LIMIT,
    /** All plugins together run ECore's cap of compute tasks ({@code emc2.compute.max-threads}). */
    TOTAL_CAP
  }

  /** The task runs (after its start, or a restart). */
  record Running(String task, Instant at) implements ComputeEvent {
    public Running {
      Objects.requireNonNull(task, "task");
      Objects.requireNonNull(at, "at");
    }
  }

  /** The task failed or ended and is restarted at {@code retryAt}, as its spec asks; it keeps its place under the limits. */
  record Restarting(String task, Instant at, String reason, Instant retryAt) implements ComputeEvent {
    public Restarting {
      Objects.requireNonNull(task, "task");
      Objects.requireNonNull(at, "at");
      Objects.requireNonNull(reason, "reason");
      Objects.requireNonNull(retryAt, "retryAt");
    }
  }

  /**
   * The task stopped. {@code reason} is {@code null} when the plugin stopped it or it ended by
   * itself, and says why otherwise, e.g. that the admin lowered the plugin's compute threads.
   */
  record Stopped(String task, Instant at, @Nullable String reason) implements ComputeEvent {
    public Stopped {
      Objects.requireNonNull(task, "task");
      Objects.requireNonNull(at, "at");
    }
  }

  /** The task failed and is not restarted. */
  record Failed(String task, Instant at, String reason) implements ComputeEvent {
    public Failed {
      Objects.requireNonNull(task, "task");
      Objects.requireNonNull(at, "at");
      Objects.requireNonNull(reason, "reason");
    }
  }

  /** ECore refused the start; the ref is stopped at once. ECore does not retry: the plugin may, e.g. on a timer. */
  record Refused(String task, Instant at, Refusal refusal) implements ComputeEvent {
    public Refused {
      Objects.requireNonNull(task, "task");
      Objects.requireNonNull(at, "at");
      Objects.requireNonNull(refusal, "refusal");
    }
  }

  /**
   * The task had not returned {@link Computes#STOP_GRACE} after its stop. Its plugin is DEGRADED;
   * its thread may stay until the server restarts. It no longer counts against the plugin's
   * {@link Computes#allowed()}, but still against ECore's total cap.
   */
  record Hung(String task, Instant at) implements ComputeEvent {
    public Hung {
      Objects.requireNonNull(task, "task");
      Objects.requireNonNull(at, "at");
    }
  }
}
