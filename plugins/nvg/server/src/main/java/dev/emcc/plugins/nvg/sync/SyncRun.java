package dev.emcc.plugins.nvg.sync;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.Store;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * Sends a plan's change requests from the worker that owns this run, at most {@link #WINDOW} at a
 * time (well under the plugin's cap of outstanding asks), and counts their outcomes. Not
 * thread-safe: one worker calls it from its handler only (rule C2).
 */
public final class SyncRun {

  /** Change requests in flight at most. */
  public static final int WINDOW = 500;

  /** How long the store has for one change request. */
  public static final Duration TIMEOUT = Duration.ofSeconds(30);

  /**
   * One change request's outcome, for the owning worker's message.
   *
   * @param run the run
   * @param index the change's place in the plan
   * @param outcome the store's answer
   */
  public record Outcome(UUID run, int index, ChangeOutcome outcome) {
    public Outcome {
      Objects.requireNonNull(run, "run");
      Objects.requireNonNull(outcome, "outcome");
    }
  }

  /**
   * What a run did.
   *
   * @param created objects created
   * @param updated objects updated
   * @param deleted objects deleted
   * @param failed changes the store did not apply, by counter ({@code rejected: <code>}, {@code outcome unknown})
   * @param problem the first rejection's message, for the status, or {@code null}
   */
  public record Result(long created, long updated, long deleted, Map<String, Long> failed, @Nullable String problem) {
    public Result {
      failed = Map.copyOf(failed);
    }
  }

  private final UUID id;
  private final List<Change> changes;
  private int next;
  private int inFlight;
  private long created;
  private long updated;
  private long deleted;
  private final Map<String, Long> failed = new LinkedHashMap<>();
  private @Nullable String problem;

  public SyncRun(UUID id, List<Change> changes) {
    this.id = id;
    this.changes = List.copyOf(changes);
  }

  public UUID id() {
    return id;
  }

  /** Sends changes until {@link #WINDOW} are in flight or none is left. */
  public <M extends Message> void pump(Store store, WorkerRef<M> self, Function<Outcome, ? extends M> wrap) {
    while (inFlight < WINDOW && next < changes.size()) {
      int index = next++;
      inFlight++;
      store.submit(changes.get(index), TIMEOUT, self, outcome -> wrap.apply(new Outcome(id, index, outcome)));
    }
  }

  /** Counts an outcome of this run. */
  public void handle(Outcome outcome) {
    if (!outcome.run().equals(id) || outcome.index() < 0 || outcome.index() >= changes.size()) {
      return;
    }
    inFlight--;
    Operation op = changes.get(outcome.index()).operation();
    switch (outcome.outcome()) {
      case ChangeOutcome.Applied a -> {
        switch (op) {
          case CREATE -> created++;
          case UPDATE -> updated++;
          case DELETE -> deleted++;
        }
      }
      case ChangeOutcome.Rejected r -> {
        failed.merge("rejected: " + r.rejection().code().name(), 1L, Long::sum);
        if (problem == null) {
          problem = r.rejection().code().name() + ": " + r.rejection().message();
        }
      }
      case ChangeOutcome.Unknown u -> failed.merge("outcome unknown", 1L, Long::sum);
    }
  }

  /** Whether every change was sent and answered. */
  public boolean done() {
    return next >= changes.size() && inFlight == 0;
  }

  public Result result() {
    return new Result(created, updated, deleted, failed, problem);
  }

  /** How many changes the run has. */
  public int size() {
    return changes.size();
  }
}
