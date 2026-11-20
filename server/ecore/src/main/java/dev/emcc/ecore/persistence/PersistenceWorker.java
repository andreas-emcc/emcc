package dev.emcc.ecore.persistence;

import dev.emcc.ecore.runtime.Answer;
import dev.emcc.ecore.runtime.HandlerContext;
import dev.emcc.ecore.runtime.MessageHandler;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.store.PictureSnapshot;
import dev.emcc.ecore.store.StoreMsg;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.EntityType;
import java.io.UncheckedIOException;
import java.time.Duration;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The persistence manager's worker (overview 4.8): stores every change event after it was applied
 * in memory (write-behind), and compacts the journal into a snapshot now and then.
 *
 * <p><b>No silent loss.</b> Change events arrive through the worker's mailbox. If one is dropped
 * (a full mailbox), the next event shows a gap in the sequence numbers; the worker then asks the
 * object store for a snapshot and writes it, which contains everything up to that point. Events
 * that arrive while it waits are already in that snapshot: the store publishes an event before it
 * answers a later snapshot request, and the mailbox keeps that order. If the store cannot make the
 * snapshot, the worker asks again at the next flush tick or change event.
 *
 * <p><b>Durability.</b> Appends are buffered and made durable on the flush tick (every 250 ms), at
 * drain and at compaction. A hard kill loses what was not yet flushed, plus whatever still waited in
 * this worker's mailbox.
 *
 * <p><b>Updates that are not saved</b> (ADR-0041) are received like every change event, so a lost
 * one is still a gap, but not appended. So that the journal still loads as a strict chain, the
 * worker declares them before the next saved event: the run of sequence numbers it skipped, and,
 * before a saved update or delete of an object moved that way, the version it had reached (its
 * {@code previousVersion}). It writes no line per move. A snapshot holds everything up to its
 * sequence number, moved positions included, so it ends both. They count toward no compaction.
 *
 * <p><b>A snapshot that cannot be written</b> (on Windows, while another process has the file open:
 * a virus scanner, a backup) leaves the old snapshot and the whole journal as they were, so nothing
 * is lost. The worker asks for a fresh snapshot again after a pause that grows from {@link
 * #FIRST_RETRY_TICKS} flush ticks to {@link #MAX_RETRY_TICKS}, and asks for none meanwhile. A fresh
 * one holds every change so far, so the journal is never cut short. During a resync the pause stays
 * at {@link #FIRST_RETRY_TICKS}: the changes since the gap are in no file until a snapshot is
 * written, so a restart meanwhile could lose them (logged as an error, as when the store cannot
 * make the snapshot).
 *
 * <p>File I/O happens in this worker's handler. It is ECore's own worker with a long budget, and
 * nothing waits for it; listeners for blocking I/O come with SDK v1 (rule C6).
 */
public final class PersistenceWorker implements MessageHandler<PersistMsg> {

  /** How long the object store may take to make a snapshot. */
  static final Duration SNAPSHOT_TIMEOUT = Duration.ofSeconds(30);
  /** How often ECore sends {@link PersistMsg.Flush}: the pauses below are counted in these ticks. */
  public static final Duration FLUSH_INTERVAL = Duration.ofMillis(250);
  /** Flush ticks (250 ms each) before the first new try after a snapshot could not be written: 1 s. */
  static final int FIRST_RETRY_TICKS = 4;
  /** The longest pause between tries: 1 min. */
  static final int MAX_RETRY_TICKS = 240;

  private static final Logger LOG = LoggerFactory.getLogger(PersistenceWorker.class);

  private final PictureStore store;
  private final WorkerHandle<StoreMsg> objectStore;
  private final int compactEvery;
  /** The last change event seen, stored or not (during a resync it is covered by the coming snapshot). */
  private long lastSequenceNo;
  /** The last change event written to the store, in the journal or a snapshot. */
  private long storedSequenceNo;
  /** The last change event that is written or declared as not saved, with all before it: what a drain answers. */
  private long accountedSequenceNo;
  /** The run of updates not saved since the last saved event, to declare before the next one; 0 for none. */
  private long notSavedFrom;
  private long notSavedTo;
  /** The objects updated without being saved since their last line in the journal or the last snapshot. */
  private final Set<UUID> moved = new HashSet<>();
  private int sinceSnapshot;
  private boolean snapshotRequested;
  private boolean resyncing;
  /** Flush ticks until a snapshot that could not be written is asked for again; 0 when none waits. */
  private int retryIn;
  /** The pause after the next failed write, in flush ticks. */
  private int nextPause = FIRST_RETRY_TICKS;
  /** Snapshots that could not be written since the last one that was. */
  private int failedWrites;

  /**
   * @param lastSequenceNo the sequence number of the loaded picture
   * @param journalLength how many events the journal already holds after the last snapshot
   * @param compactEvery after how many journal events a new snapshot is written
   */
  public PersistenceWorker(
      PictureStore store, WorkerHandle<StoreMsg> objectStore, long lastSequenceNo, int journalLength, int compactEvery) {
    this.store = store;
    this.objectStore = objectStore;
    this.lastSequenceNo = lastSequenceNo;
    this.storedSequenceNo = lastSequenceNo;
    this.accountedSequenceNo = lastSequenceNo;
    this.sinceSnapshot = journalLength;
    this.compactEvery = compactEvery;
  }

  @Override
  public void handle(PersistMsg message, HandlerContext<PersistMsg> context) {
    switch (message) {
      case PersistMsg.Changed changed -> changed(changed.event(), changed.notSaved(), context);
      case PersistMsg.Flush tick -> {
        store.flush();
        if (retryIn > 0 && --retryIn == 0) {
          requestSnapshot(context); // the pause after a snapshot that could not be written is over
        }
        if (resyncing) {
          requestSnapshot(context); // again, if the last request failed
        }
      }
      case PersistMsg.Snapshotted snapshotted -> snapshotted(snapshotted.answer(), context);
      case PersistMsg.Drain drain -> {
        store.flush();
        drain.replyTo().reply(accountedSequenceNo);
      }
    }
  }

  private void changed(ChangeEvent event, boolean notSaved, HandlerContext<PersistMsg> context) {
    long seq = event.sequenceNo();
    if (seq <= lastSequenceNo) {
      return; // already stored
    }
    if (resyncing) {
      lastSequenceNo = seq; // covered by the snapshot that is on its way
      requestSnapshot(context); // again, if the last request failed
      return;
    }
    if (seq != lastSequenceNo + 1) {
      LOG.warn("Change events {} to {} were not delivered to persistence; writing a full snapshot instead",
          lastSequenceNo + 1, seq - 1);
      resyncing = true;
      lastSequenceNo = seq;
      requestSnapshot(context);
      return;
    }
    lastSequenceNo = seq;
    if (notSaved) {
      if (notSavedFrom == 0) {
        notSavedFrom = seq;
      }
      notSavedTo = seq;
      moved.add(event.entityId());
      accountedSequenceNo = seq;
      return;
    }
    if (notSavedFrom != 0) {
      store.appendNotSaved(notSavedFrom, notSavedTo);
      notSavedFrom = 0;
    }
    Long previous = event.previousVersion();
    if (previous != null && event.entityType() == EntityType.OBJECT && moved.remove(event.entityId())) {
      store.appendNotSavedVersion(event.entityId(), previous, seq);
    }
    store.append(event);
    storedSequenceNo = seq;
    accountedSequenceNo = seq;
    if (++sinceSnapshot >= compactEvery) {
      requestSnapshot(context);
    }
  }

  private void requestSnapshot(HandlerContext<PersistMsg> context) {
    if (snapshotRequested || retryIn > 0) {
      return; // one is on its way, or a write failed and its pause is not over
    }
    snapshotRequested = true;
    context.<StoreMsg, PictureSnapshot>ask(
        objectStore, StoreMsg.GetSnapshot::new, SNAPSHOT_TIMEOUT, PersistMsg.Snapshotted::new);
  }

  private void snapshotted(Answer<PictureSnapshot> answer, HandlerContext<PersistMsg> context) {
    snapshotRequested = false;
    switch (answer) {
      case Answer.Ok<PictureSnapshot> ok -> {
        PictureSnapshot snapshot = ok.value();
        if (snapshot.sequenceNo() < storedSequenceNo) {
          // Cannot happen with the real store (see the class comment); replacing would lose events.
          LOG.warn("Snapshot at sequence {} is older than the journal (sequence {}); not compacting",
              snapshot.sequenceNo(), storedSequenceNo);
          return;
        }
        try {
          store.replaceWith(snapshot);
        } catch (UncheckedIOException e) {
          notWritten(snapshot, e);
          return;
        }
        if (failedWrites > 0) {
          LOG.info("Snapshot at sequence {} written after {} failed attempts", snapshot.sequenceNo(), failedWrites);
        }
        failedWrites = 0;
        nextPause = FIRST_RETRY_TICKS;
        storedSequenceNo = snapshot.sequenceNo();
        accountedSequenceNo = Math.max(accountedSequenceNo, storedSequenceNo);
        // Everything received so far is in it (see the class comment), unsaved moves included.
        notSavedFrom = 0;
        moved.clear();
        sinceSnapshot = 0;
        if (resyncing) {
          resyncing = false;
          lastSequenceNo = snapshot.sequenceNo();
          LOG.info("Persistence is in sync again at sequence {}", snapshot.sequenceNo());
        }
      }
      case Answer.Failed<PictureSnapshot> failed -> {
        if (resyncing) {
          LOG.error("No snapshot from the object store: {}; persistence is out of sync until one arrives "
              + "(asking again at the next flush tick); a restart now could lose changes", failed.reason());
        } else {
          LOG.warn("No snapshot from the object store for compaction: {}; asking again at the next change",
              failed.reason());
        }
      }
      case Answer.TimedOut<PictureSnapshot> timedOut -> {
        LOG.warn("The object store did not answer the snapshot request within {}; asking again", SNAPSHOT_TIMEOUT);
        requestSnapshot(context);
      }
    }
  }

  /**
   * A snapshot could not be written: the old snapshot and the journal stay as they were. A fresh
   * one is asked for after the pause, which doubles up to {@link #MAX_RETRY_TICKS}; during a resync
   * it stays at {@link #FIRST_RETRY_TICKS}. Reported the first time and then about once a minute
   * while it lasts: a warning, or an error during a resync, whose changes are in no file yet.
   */
  private void notWritten(PictureSnapshot snapshot, UncheckedIOException e) {
    failedWrites++;
    retryIn = resyncing ? FIRST_RETRY_TICKS : nextPause;
    long millis = retryIn * FLUSH_INTERVAL.toMillis();
    boolean report = failedWrites == 1
        || (resyncing ? failedWrites % (MAX_RETRY_TICKS / FIRST_RETRY_TICKS) == 0 : retryIn == MAX_RETRY_TICKS);
    if (!report) {
      LOG.debug("Snapshot at sequence {} could not be written again ({} in a row); trying again in {} ms",
          snapshot.sequenceNo(), failedWrites, millis);
    } else if (resyncing) {
      LOG.error("Snapshot at sequence {} could not be written ({}, {} in a row); persistence is out of sync until one is, "
          + "trying again in {} ms; a restart now could lose changes", snapshot.sequenceNo(), e.getCause(), failedWrites, millis);
    } else {
      LOG.warn("Snapshot at sequence {} could not be written ({}, {} in a row); the journal keeps every change, "
          + "trying again in {} ms", snapshot.sequenceNo(), e.getCause(), failedWrites, millis);
    }
    nextPause = Math.min(nextPause * 2, MAX_RETRY_TICKS);
  }
}
