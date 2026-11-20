package dev.emcc.ecore.persistence;

import dev.emcc.ecore.store.PictureSnapshot;
import dev.emcc.sdk.model.ChangeEvent;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Keeps the picture in memory only: for tests and for ECore without a data directory. Used by one
 * thread at a time, like every {@link PictureStore}.
 */
public final class MemoryStore implements PictureStore {

  private PictureSnapshot snapshot = PictureSnapshot.empty();
  private final List<JournalEntry> journal = new ArrayList<>();

  @Override
  public Stored load() {
    return JournalEntry.stored(snapshot, journal);
  }

  @Override
  public void append(ChangeEvent event) {
    journal.add(new JournalEntry.Event(event));
  }

  @Override
  public void appendNotSaved(long from, long to) {
    journal.add(new JournalEntry.NotSaved(from, to));
  }

  @Override
  public void appendNotSavedVersion(UUID id, long version, long before) {
    journal.add(new JournalEntry.NotSavedVersion(id, version, before));
  }

  @Override
  public void flush() {}

  @Override
  public void replaceWith(PictureSnapshot newSnapshot) {
    snapshot = newSnapshot;
    journal.clear();
  }

  @Override
  public void close() {}
}
