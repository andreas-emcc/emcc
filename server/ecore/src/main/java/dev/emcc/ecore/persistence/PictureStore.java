package dev.emcc.ecore.persistence;

import dev.emcc.ecore.store.PictureSnapshot;
import dev.emcc.sdk.model.ChangeEvent;
import java.util.List;
import java.util.UUID;

/**
 * Where the live picture is kept between runs: a snapshot plus a journal of the change events after
 * it. The journal is also what history (audit, timeline) will build on later (overview 4.4).
 * Updates that were not saved (ADR-0041) are not in it; it declares only that they happened, so
 * that it loads.
 *
 * <p>Used by one thread at a time: the start-up code, then the persistence worker, then the
 * shutdown code.
 */
public interface PictureStore extends AutoCloseable {

  /** What was stored: the last snapshot and the journal events after it, in sequence order. */
  record Stored(PictureSnapshot snapshot, List<ChangeEvent> journal) {
    public Stored {
      journal = List.copyOf(journal);
    }
  }

  /**
   * Reads what is stored. Called once, at start-up. When the journal declared updates that were not
   * saved (ADR-0041), they are applied here and the result has an empty journal; a file store then
   * also writes it as a new snapshot with an empty journal.
   */
  Stored load();

  /** Appends one change event to the journal (buffered; see {@link #flush()}). */
  void append(ChangeEvent event);

  /**
   * Appends the declaration that the updates with the sequence numbers {@code from} to {@code to}
   * were not saved (ADR-0041), just before the next saved event (buffered).
   */
  void appendNotSaved(long from, long to);

  /**
   * Appends the declaration that object {@code id} reached {@code version} through updates that
   * were not saved (ADR-0041), just before the saved event {@code before} that updates or deletes
   * it (buffered).
   */
  void appendNotSavedVersion(UUID id, long version, long before);

  /** Makes everything appended so far durable. */
  void flush();

  /** Replaces the stored picture with {@code snapshot} and empties the journal (compaction). */
  void replaceWith(PictureSnapshot snapshot);

  /** Flushes and releases files. */
  @Override
  void close();
}
