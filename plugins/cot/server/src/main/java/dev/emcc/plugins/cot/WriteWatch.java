package dev.emcc.plugins.cot;

import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * Which write of a link's task the worker has seen in progress, and since which tick, so that a write that does not finish (a peer
 * that stays connected but stops reading) is noticed (owner, 2026-10-28, Z1 and AE1). One per link; the worker asks it only for a link
 * that sends (AF1, AG1): an {@code in} link writes the presence event too, but its reader keeps receiving, and a restart would interrupt
 * a working input. Owned by the {@code applier} worker, like everything else.
 */
final class WriteWatch {

  private @Nullable UUID run;
  private long count;
  private long since;

  /**
   * Takes in what the task said: it is in the write after {@code count} events of the run {@code run} ({@code writing}), or it is not.
   * The first sight of one write is noted at {@code tick}; the next ones leave that as it is.
   */
  void observe(UUID run, long count, boolean writing, long tick) {
    if (!writing) {
      this.run = null;
    } else if (!run.equals(this.run) || count != this.count) {
      this.run = run;
      this.count = count;
      this.since = tick;
    }
  }

  /**
   * Whether one write (one event) has not finished for {@code limit} ticks (a tick is a second), and so the peer has stopped reading.
   * The state is cleared then, so that the next run of the task starts clean.
   */
  boolean stalled(long tick, long limit) {
    if (run == null || tick - since < limit) {
      return false;
    }
    run = null;
    return true;
  }

  /** The connection is gone or starts again: no write of the old one is in progress. */
  void clear() {
    run = null;
  }
}
