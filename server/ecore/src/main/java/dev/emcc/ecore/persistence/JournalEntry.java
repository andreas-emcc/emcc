package dev.emcc.ecore.persistence;

import dev.emcc.ecore.store.PictureSnapshot;
import dev.emcc.ecore.store.PictureState;
import dev.emcc.sdk.model.ChangeEvent;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * One entry of a journal as a {@link PictureStore} reads it back: a change event, or a declaration
 * about updates that were not saved (ADR-0041). The declarations keep the journal a strict chain
 * where they are absent: loading accepts a gap in the sequence numbers, or a jump in an object's
 * version, only where one declares it.
 */
sealed interface JournalEntry {

  /** A change event. */
  record Event(ChangeEvent event) implements JournalEntry {
    public Event {
      Objects.requireNonNull(event, "event");
    }
  }

  /** The updates with the sequence numbers {@code from} to {@code to} were not saved. */
  record NotSaved(long from, long to) implements JournalEntry {
    public NotSaved {
      if (from < 1 || to < from) {
        throw new IllegalArgumentException("not a run of sequence numbers: " + from + " to " + to);
      }
    }
  }

  /**
   * Object {@code id} reached {@code version} through updates that were not saved; written just
   * before the saved event {@code before} that updates or deletes it, and skipped or applied with it.
   */
  record NotSavedVersion(UUID id, long version, long before) implements JournalEntry {
    public NotSavedVersion {
      Objects.requireNonNull(id, "id");
    }
  }

  /**
   * What was stored, from a snapshot and the journal entries after it. Without declarations the
   * journal's events are handed on as they are, for the start-up code to apply. With them, they are
   * applied here, and the result is handed on as the snapshot with an empty journal: the start-up
   * code then holds the same picture, and only change events reach it. ({@link FileStore#load} then
   * writes that snapshot.)
   */
  static PictureStore.Stored stored(PictureSnapshot snapshot, List<JournalEntry> entries) {
    List<ChangeEvent> events = new ArrayList<>();
    for (JournalEntry entry : entries) {
      if (!(entry instanceof Event event)) {
        PictureState picture = PictureState.of(snapshot);
        apply(picture, entries);
        return new PictureStore.Stored(picture.snapshot(), List.of());
      }
      events.add(event.event());
    }
    return new PictureStore.Stored(snapshot, events);
  }

  /** Applies {@code entries} in order to {@code picture}, as strictly as change events, except where they declare. */
  static void apply(PictureState picture, List<JournalEntry> entries) {
    for (JournalEntry entry : entries) {
      switch (entry) {
        case Event e -> picture.apply(e.event());
        case NotSaved n -> picture.skipNotSaved(n.from(), n.to());
        case NotSavedVersion v -> picture.declareNotSavedVersion(v.id(), v.version());
      }
    }
  }
}
