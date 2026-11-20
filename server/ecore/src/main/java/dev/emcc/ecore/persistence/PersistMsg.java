package dev.emcc.ecore.persistence;

import dev.emcc.ecore.runtime.Answer;
import dev.emcc.ecore.runtime.ReplyHandle;
import dev.emcc.ecore.store.PictureSnapshot;
import dev.emcc.sdk.model.ChangeEvent;

/** Messages of the persistence worker. */
public sealed interface PersistMsg {

  /**
   * A change event from {@code objects.changed}; {@code notSaved} for an update that is not
   * written to the journal (ADR-0041).
   */
  record Changed(ChangeEvent event, boolean notSaved) implements PersistMsg {

    /** A change that is saved. */
    public Changed(ChangeEvent event) {
      this(event, false);
    }
  }

  /** Timer tick: make the journal durable. */
  enum Flush implements PersistMsg {
    TICK
  }

  /** The object store's answer to a snapshot request (compaction or recovery after a gap). */
  record Snapshotted(Answer<PictureSnapshot> answer) implements PersistMsg {}

  /**
   * Flushes everything received so far and answers with the last sequence number accounted for:
   * stored, or an update that was not saved (ADR-0041). Sent at shutdown, after the object store
   * has stopped, so nothing is lost on a clean stop.
   */
  record Drain(ReplyHandle<Long> replyTo) implements PersistMsg {}
}
