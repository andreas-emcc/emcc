package dev.emcc.ecore.persistence;

import static dev.emcc.ecore.persistence.Events.layerCreated;
import static dev.emcc.ecore.persistence.Events.objectCreated;
import static dev.emcc.ecore.persistence.Events.objectDeleted;
import static dev.emcc.ecore.persistence.Events.objectUpdated;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.store.PictureSnapshot;
import dev.emcc.ecore.store.PictureState;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.Layer;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class FileStoreTest {

  private static final ModelJson JSON = new ModelJson();

  @TempDir Path dir;

  private FileStore store() {
    return new FileStore(dir, JSON);
  }

  /** A store as ECore uses it: loaded before anything is appended. */
  private FileStore loaded() {
    FileStore store = store();
    store.load();
    return store;
  }

  @Test
  void anEmptyDirectoryHoldsAnEmptyPicture() {
    PictureStore.Stored stored = store().load();

    assertThat(stored.snapshot()).isEqualTo(PictureSnapshot.empty());
    assertThat(stored.journal()).isEmpty();
  }

  @Test
  void journalEventsSurviveARestart() {
    List<ChangeEvent> events = List.of(layerCreated(1), layerCreated(2), layerCreated(3));
    try (FileStore store = loaded()) {
      events.forEach(store::append);
    }

    assertThat(store().load().journal()).isEqualTo(events);
  }

  @Test
  void theJournalUsesLfOnEveryPlatform() throws IOException {
    try (FileStore store = loaded()) {
      store.append(layerCreated(1));
    }

    String text = Files.readString(dir.resolve(FileStore.JOURNAL));
    assertThat(text).endsWith("\n").doesNotContain("\r");
  }

  @Test
  void aSnapshotReplacesTheJournal() {
    PictureState state = new PictureState();
    try (FileStore store = store()) {
      for (int i = 1; i <= 3; i++) {
        ChangeEvent event = layerCreated(i);
        state.apply(event);
        store.append(event);
      }
      store.replaceWith(state.snapshot());
    }

    PictureStore.Stored stored = store().load();
    assertThat(stored.snapshot()).isEqualTo(state.snapshot());
    assertThat(stored.journal()).isEmpty();
  }

  @Test
  void journalEventsAlreadyInTheSnapshotAreSkipped() throws IOException {
    // As after a crash between writing the snapshot and emptying the journal.
    PictureState state = new PictureState();
    List<ChangeEvent> events = List.of(layerCreated(1), layerCreated(2), layerCreated(3));
    try (FileStore store = store()) {
      state.apply(events.get(0));
      state.apply(events.get(1));
      store.replaceWith(state.snapshot());
    }
    Files.write(dir.resolve(FileStore.JOURNAL), events.stream().map(JSON::write).toList(), StandardCharsets.UTF_8);

    PictureStore.Stored stored = store().load();

    assertThat(stored.snapshot().sequenceNo()).isEqualTo(2);
    assertThat(stored.journal()).containsExactly(events.get(2));
  }

  @Test
  void aHalfWrittenLastLineIsCutOff() throws IOException {
    try (FileStore store = loaded()) {
      store.append(layerCreated(1));
    }
    String complete = Files.readString(dir.resolve(FileStore.JOURNAL));
    appendHalfOf(layerCreated(2));

    try (FileStore store = store()) {
      assertThat(store.load().journal()).hasSize(1);
    }
    assertThat(Files.readString(dir.resolve(FileStore.JOURNAL))).isEqualTo(complete);
  }

  @Test
  void aChangeWrittenAfterARestartOverAHalfWrittenLineSurvivesTheNextRestart() throws IOException {
    ChangeEvent first = layerCreated(1);
    ChangeEvent second = layerCreated(2);
    try (FileStore store = loaded()) {
      store.append(first);
    }
    appendHalfOf(layerCreated(2)); // the crash

    try (FileStore store = store()) {
      assertThat(store.load().journal()).containsExactly(first);
      store.append(second);
    }

    assertThat(store().load().journal()).containsExactly(first, second);
  }

  @Test
  void aCompleteLastLineWithoutItsLfIsKeptAndTheNextChangeSurvives() throws IOException {
    ChangeEvent first = layerCreated(1);
    ChangeEvent second = layerCreated(2);
    ChangeEvent third = layerCreated(3);
    try (FileStore store = loaded()) {
      store.append(first);
    }
    Files.writeString(dir.resolve(FileStore.JOURNAL), JSON.write(second), StandardOpenOption.APPEND); // no LF

    try (FileStore store = store()) {
      assertThat(store.load().journal()).containsExactly(first, second);
      store.append(third);
    }

    assertThat(store().load().journal()).containsExactly(first, second, third);
    assertThat(Files.readString(dir.resolve(FileStore.JOURNAL))).endsWith("\n").doesNotContain("}{");
  }

  @Test
  void aDamagedLastLineWithItsLfStopsTheLoad() throws IOException {
    // The store writes the LF after the line: a damaged line before an LF was not cut short by a crash.
    Files.write(dir.resolve(FileStore.JOURNAL), List.of(JSON.write(layerCreated(1)), "{\"not\": \"an event\"}"),
        StandardCharsets.UTF_8);

    assertThatThrownBy(() -> store().load()).isInstanceOf(IllegalStateException.class).hasMessageContaining("line 2");
  }

  @Test
  void changesAppendedAfterACompactionLandAfterTheNewSnapshot() {
    PictureState state = new PictureState();
    List<ChangeEvent> events = List.of(layerCreated(1), layerCreated(2), layerCreated(3), layerCreated(4));
    try (FileStore store = store()) {
      store.load();
      for (ChangeEvent event : events) {
        state.apply(event);
        store.append(event);
        if (event.sequenceNo() == 2) {
          store.replaceWith(state.snapshot());
        }
      }
    }

    PictureStore.Stored stored = store().load();
    assertThat(stored.snapshot().sequenceNo()).isEqualTo(2);
    assertThat(stored.journal()).containsExactly(events.get(2), events.get(3));
  }

  @Test
  void aDataDirectoryThatCannotBeWrittenFailsTheLoad() throws IOException {
    try (FileStore store = loaded()) {
      store.append(layerCreated(1));
    }

    try (var _ = new ReadOnlyDirectory(dir)) {
      assertThatThrownBy(() -> store().load()).isInstanceOf(IllegalStateException.class)
          .hasMessageContaining("is not writable");
    }
  }

  @Test
  void aDamagedLineInTheMiddleStopsTheLoad() throws IOException {
    Files.write(dir.resolve(FileStore.JOURNAL),
        List.of(JSON.write(layerCreated(1)), "{\"not\": \"an event\"}", JSON.write(layerCreated(2))), StandardCharsets.UTF_8);

    assertThatThrownBy(() -> store().load()).isInstanceOf(IllegalStateException.class).hasMessageContaining("line 2");
  }

  @Test
  void aGapInTheJournalStopsTheLoad() throws IOException {
    Files.write(dir.resolve(FileStore.JOURNAL), List.of(JSON.write(layerCreated(1)), JSON.write(layerCreated(3))),
        StandardCharsets.UTF_8);

    assertThatThrownBy(() -> store().load()).isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("expected change event 2");
  }

  @Test
  void anEmptyJournalFileHoldsNoEvents() throws IOException {
    Files.write(dir.resolve(FileStore.JOURNAL), new byte[0]);

    try (FileStore store = store()) {
      assertThat(store.load().journal()).isEmpty();
      store.append(layerCreated(1));
    }

    assertThat(store().load().journal()).hasSize(1);
  }

  @Test
  void multiByteCharactersSurviveARestartAndALineCutInsideOneIsCutOff() throws IOException {
    ChangeEvent first = layerCreated(1, "Ålänning 北極 ✓");
    ChangeEvent second = layerCreated(2, "Över 北 ✓");
    try (FileStore store = loaded()) {
      store.append(first);
    }
    // The crash: the second line cut in the middle of 北's three bytes.
    String text = JSON.write(second);
    byte[] line = text.getBytes(StandardCharsets.UTF_8);
    int inside = text.substring(0, text.indexOf('北')).getBytes(StandardCharsets.UTF_8).length + 1;
    Files.write(dir.resolve(FileStore.JOURNAL), Arrays.copyOf(line, inside), StandardOpenOption.APPEND);

    try (FileStore store = store()) {
      assertThat(store.load().journal()).containsExactly(first);
      store.append(second);
    }

    assertThat(store().load().journal()).containsExactly(first, second);
  }

  @Test
  void aJournalWithCrLfLineEndsIsRead() throws IOException {
    // As after editing the file on Windows; the store itself writes LF only.
    List<ChangeEvent> events = List.of(layerCreated(1), layerCreated(2));
    loaded().close(); // a data folder with its snapshot: a journal alone would be M0 data, migrated
    Files.writeString(dir.resolve(FileStore.JOURNAL), JSON.write(events.get(0)) + "\r\n" + JSON.write(events.get(1)) + "\r\n");

    assertThat(store().load().journal()).isEqualTo(events);
  }

  @Test
  void aCompleteLastLineWithoutItsLfThatLeavesAGapStopsTheLoad() throws IOException {
    // Kept as a complete event, it is checked like any other: not cut off as half-written.
    loaded().close();
    Files.writeString(dir.resolve(FileStore.JOURNAL), JSON.write(layerCreated(1)) + "\n" + JSON.write(layerCreated(3)));

    assertThatThrownBy(() -> store().load()).isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("expected change event 2");
  }

  // ---- Updates that are not saved (ADR-0041): declared in the journal, and loaded with it -----

  private final java.util.UUID a = java.util.UUID.fromString("0199b2c4-0000-7000-8000-00000000000a");
  private final java.util.UUID b = java.util.UUID.fromString("0199b2c4-0000-7000-8000-00000000000b");

  /**
   * A run: two objects made and saved, moved without being saved (4 to 6), a saved before 7, b
   * deleted at 8 after its move, a moved again (9, 10), and a saved layer at 11.
   */
  private void writeARun(PictureStore store) {
    store.append(layerCreated(1));
    store.append(objectCreated(2, a));
    store.append(objectCreated(3, b));
    store.appendNotSaved(4, 6); // a to version 2 and 3, b to 2
    store.appendNotSavedVersion(a, 3, 7);
    store.append(objectUpdated(7, a, 4));
    store.appendNotSavedVersion(b, 2, 8);
    store.append(objectDeleted(8, b, 2));
    store.appendNotSaved(9, 10); // a to 5 and 6
    store.append(layerCreated(11));
  }

  @Test
  void aJournalWithDeclaredUpdatesNotSavedLoadsAsTheLastSavedChangesLeftIt() {
    try (FileStore store = loaded()) {
      writeARun(store);
    }

    PictureStore.Stored stored = store().load();

    assertThat(stored.journal()).as("applied while loading").isEmpty();
    PictureSnapshot picture = stored.snapshot();
    assertThat(picture.sequenceNo()).isEqualTo(11);
    assertThat(picture.layers()).hasSize(2);
    assertThat(picture.objects()).containsExactly(Events.object(a, 4)); // the moves after its save are lost
    // The next saved change of a continues from the stored version, as any other.
    PictureState state = PictureState.of(picture);
    state.apply(objectUpdated(12, a, 5));
    assertThat(state.object(a)).isEqualTo(Events.object(a, 5));
  }

  @Test
  void theMemoryStoreLoadsDeclarationsTheSameWay() {
    MemoryStore memory = new MemoryStore();
    writeARun(memory);

    assertThat(memory.load().snapshot().objects()).containsExactly(Events.object(a, 4));
    assertThat(memory.load().snapshot().sequenceNo()).isEqualTo(11);
  }

  @Test
  void aJournalWithoutDeclarationsIsHandedOnAsEvents() {
    List<ChangeEvent> events = List.of(layerCreated(1), objectCreated(2, a), objectUpdated(3, a, 2));
    try (FileStore store = loaded()) {
      events.forEach(store::append);
    }

    assertThat(store().load().journal()).isEqualTo(events);
  }

  @Test
  void aGapOrAVersionThatNoLineDeclaresStillStopsTheLoad() throws IOException {
    loaded().close(); // a snapshot first: a journal without one is M0's, and is migrated
    // Event 5 after a declared run 2 to 3: 4 is missing.
    Files.write(dir.resolve(FileStore.JOURNAL), List.of(JSON.write(objectCreated(1, a)), "{\"notSaved\":{\"from\":2,\"to\":3}}",
        JSON.write(objectUpdated(5, a, 4))), StandardCharsets.UTF_8);
    assertThatThrownBy(() -> store().load()).isInstanceOf(IllegalStateException.class).hasMessageContaining("expected change event 4");

    // A run that does not start at the next number.
    Files.write(dir.resolve(FileStore.JOURNAL), List.of(JSON.write(objectCreated(1, a)), "{\"notSaved\":{\"from\":3,\"to\":4}}"),
        StandardCharsets.UTF_8);
    assertThatThrownBy(() -> store().load()).isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("expected change event 2, found a declaration at 3");

    // A run declared, but the save of a moved object without the version it reached.
    Files.write(dir.resolve(FileStore.JOURNAL), List.of(JSON.write(objectCreated(1, a)), "{\"notSaved\":{\"from\":2,\"to\":3}}",
        JSON.write(objectUpdated(4, a, 4))), StandardCharsets.UTF_8);
    assertThatThrownBy(() -> store().load()).isInstanceOf(IllegalStateException.class).hasMessageContaining("expects version 3");

    // A version declared for an event that does not come next.
    Files.write(dir.resolve(FileStore.JOURNAL), List.of(JSON.write(objectCreated(1, a)),
        "{\"notSavedVersion\":{\"id\":\"" + a + "\",\"version\":3,\"before\":3}}", JSON.write(objectUpdated(2, a, 2))),
        StandardCharsets.UTF_8);
    assertThatThrownBy(() -> store().load()).isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("expected change event 2, found a declaration at 3");
  }

  @Test
  void declarationsAlreadyInTheSnapshotAreSkippedWithTheirEvents() throws IOException {
    // As after a crash between writing the snapshot at 7 and emptying the journal: the journal holds
    // lines up to 7 only, and the snapshot (the store's picture) holds b's move, which no line saved.
    try (FileStore store = loaded()) {
      store.append(layerCreated(1));
      store.append(objectCreated(2, a));
      store.append(objectCreated(3, b));
      store.appendNotSaved(4, 6); // a to version 2 and 3, b to 2
      store.appendNotSavedVersion(a, 3, 7);
      store.append(objectUpdated(7, a, 4));
    }
    List<String> journal = Files.readAllLines(dir.resolve(FileStore.JOURNAL), StandardCharsets.UTF_8);
    PictureState state = new PictureState();
    state.apply(layerCreated(1));
    state.apply(objectCreated(2, a));
    state.apply(objectCreated(3, b));
    state.apply(objectUpdated(4, a, 2));
    state.apply(objectUpdated(5, b, 2));
    state.apply(objectUpdated(6, a, 3));
    state.apply(objectUpdated(7, a, 4));
    try (FileStore store = store()) {
      store.replaceWith(state.snapshot());
    }
    Files.write(dir.resolve(FileStore.JOURNAL), journal, StandardCharsets.UTF_8);

    PictureStore.Stored stored = store().load();

    assertThat(stored.journal()).isEmpty();
    assertThat(stored.snapshot()).isEqualTo(state.snapshot());
  }

  @Test
  void aDeclarationOfTheVersionAnObjectHasChangesNothingAndAnEarlierOneIsRefused() {
    // No writer produces it (a declaration names only moves after the latest snapshot); it is consistent,
    // and the next event is checked as strictly as any other.
    PictureState state = new PictureState();
    state.apply(objectCreated(1, a));
    state.apply(objectUpdated(2, a, 2));

    state.declareNotSavedVersion(a, 2);

    assertThat(state.object(a)).isEqualTo(Events.object(a, 2));
    assertThatThrownBy(() -> state.declareNotSavedVersion(a, 1)).isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("the state has version 2");
    state.apply(objectUpdated(3, a, 3));
    assertThatThrownBy(() -> state.apply(objectUpdated(4, a, 5))).as("still strict after it").isInstanceOf(IllegalStateException.class);
  }

  @Test
  void aLoadThatAppliedDeclarationsWritesThemIntoANewSnapshotSoTheyAreNotReplayedAgain() throws IOException {
    try (FileStore store = loaded()) {
      writeARun(store);
    }

    PictureSnapshot first = store().load().snapshot();

    assertThat(Files.size(dir.resolve(FileStore.JOURNAL))).as("an empty journal: the compaction count starts from 0, rightly").isZero();
    PictureStore.Stored again = store().load();
    assertThat(again.snapshot()).isEqualTo(first);
    assertThat(again.journal()).isEmpty();
    ChangeEvent next = objectUpdated(12, a, 5);
    try (FileStore store = loaded()) {
      store.append(next); // the next saved change continues from it
    }
    assertThat(store().load().journal()).containsExactly(next);
  }

  @Test
  void aJournalWithoutDeclarationsKeepsItsLinesAtLoad() throws IOException {
    try (FileStore store = loaded()) {
      store.append(layerCreated(1));
    }
    String journal = Files.readString(dir.resolve(FileStore.JOURNAL));

    store().load();

    assertThat(Files.readString(dir.resolve(FileStore.JOURNAL))).isEqualTo(journal);
  }

  @Test
  void aHalfWrittenDeclarationAsTheLastLineIsCutOff() throws IOException {
    ChangeEvent created = objectCreated(1, a);
    try (FileStore store = loaded()) {
      store.append(created);
    }
    String line = "{\"notSaved\":{\"from\":2,\"to\":3}}";
    Files.writeString(dir.resolve(FileStore.JOURNAL), line.substring(0, 15), StandardOpenOption.APPEND);

    PictureStore.Stored stored = store().load();

    assertThat(stored.journal()).containsExactly(created);
    assertThat(stored.snapshot().sequenceNo()).as("as if the run had not been declared").isZero();
    ChangeEvent saved = objectUpdated(2, a, 2);
    try (FileStore store = loaded()) {
      store.append(saved); // the store issues 2 again, saved
    }
    assertThat(store().load().journal()).containsExactly(created, saved);
  }

  @Test
  void aCompleteDeclaredRunAsTheLastLineWithoutItsLfIsKeptAndTheNextNumberFollowsIt() throws IOException {
    try (FileStore store = loaded()) {
      store.append(objectCreated(1, a));
    }
    Files.writeString(dir.resolve(FileStore.JOURNAL), "{\"notSaved\":{\"from\":2,\"to\":3}}", StandardOpenOption.APPEND); // no LF

    PictureSnapshot picture = store().load().snapshot();

    assertThat(picture.sequenceNo()).as("its event never came: the run's last number").isEqualTo(3);
    assertThat(picture.objects()).containsExactly(Events.object(a, 1));
    ChangeEvent saved = objectUpdated(4, a, 2);
    try (FileStore store = loaded()) {
      store.append(saved); // a's moves were lost with the run: it continues from version 1
    }
    PictureStore.Stored stored = store().load();
    assertThat(stored.snapshot().sequenceNo()).isEqualTo(3);
    assertThat(stored.journal()).containsExactly(saved);
  }

  @Test
  void aTrailingVersionDeclarationWithoutItsEventLeavesTheObjectAtThatVersion() {
    try (FileStore store = loaded()) {
      store.append(objectCreated(1, a));
      store.appendNotSaved(2, 3); // a to version 2 and 3
      store.appendNotSavedVersion(a, 3, 4); // the crash: its event 4 was not written
    }

    PictureSnapshot picture = store().load().snapshot();

    assertThat(picture.sequenceNo()).isEqualTo(3);
    assertThat(picture.objects()).singleElement().satisfies(o -> {
      assertThat(o.version()).isEqualTo(3);
      assertThat(o.content()).as("the content its last saved change left").isEqualTo(Events.object(a, 1).content());
    });
    ChangeEvent saved = objectUpdated(4, a, 4);
    try (FileStore store = loaded()) {
      store.append(saved); // the save issued again after the restart
    }
    assertThat(store().load().journal()).containsExactly(saved);
  }

  @Test
  void aDeclaredRunThatStraddlesTheSnapshotIsTakenFromTheSnapshotOn() throws IOException {
    // Defensive: the worker clears a run at a snapshot, so no run straddles one. If one did, the
    // numbers the snapshot holds are skipped and the rest stays declared.
    PictureState state = new PictureState();
    state.apply(objectCreated(1, a));
    state.apply(objectUpdated(2, a, 2));
    try (FileStore store = loaded()) {
      store.replaceWith(state.snapshot());
    }
    Files.write(dir.resolve(FileStore.JOURNAL), List.of("{\"notSaved\":{\"from\":2,\"to\":3}}",
        "{\"notSavedVersion\":{\"id\":\"" + a + "\",\"version\":3,\"before\":4}}", JSON.write(objectUpdated(4, a, 4))),
        StandardCharsets.UTF_8);

    PictureSnapshot picture = store().load().snapshot();

    assertThat(picture.sequenceNo()).isEqualTo(4);
    assertThat(picture.objects()).containsExactly(Events.object(a, 4));
  }

  @Test
  void aRunThatEndsBeforeItStartsIsADamagedLineEvenWhereTheSnapshotHoldsIt() throws IOException {
    loaded().close();
    Files.write(dir.resolve(FileStore.JOURNAL), List.of(JSON.write(objectCreated(1, a)), "{\"notSaved\":{\"from\":3,\"to\":2}}"),
        StandardCharsets.UTF_8);

    assertThatThrownBy(() -> store().load()).isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("line 2 is damaged").hasMessageContaining("from <= to");
  }

  @Test
  void aDamagedDeclarationStopsTheLoad() throws IOException {
    loaded().close();
    Files.write(dir.resolve(FileStore.JOURNAL), List.of(JSON.write(objectCreated(1, a)), "{\"notSaved\":{\"from\":\"two\",\"to\":3}}",
        JSON.write(objectUpdated(4, a, 2))), StandardCharsets.UTF_8);

    assertThatThrownBy(() -> store().load()).isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("line 2 is damaged");
  }

  private void appendHalfOf(ChangeEvent event) throws IOException {
    String line = JSON.write(event);
    Files.writeString(dir.resolve(FileStore.JOURNAL), line.substring(0, line.length() / 2), StandardOpenOption.APPEND);
  }

  @Test
  void extensionNumbersSurviveTheSnapshotExactly() {
    PictureState state = new PictureState();
    state.apply(layerCreated(1));
    try (FileStore store = store()) {
      store.replaceWith(state.snapshot());
    }

    Layer layer = store().load().snapshot().layers().getFirst();

    assertThat(layer.content().extensions().get("layer-panel").getNumber("n").bigDecimalValue())
        .isEqualByComparingTo(Events.EXACT);
  }

  @Test
  void aSnapshotThatIsNotAPictureStopsTheLoad() throws IOException {
    Files.writeString(dir.resolve(FileStore.SNAPSHOT), "{\"sequenceNo\": 3}");

    assertThatThrownBy(() -> store().load()).isInstanceOf(IllegalStateException.class).hasMessageContaining("emc2-picture/1");
  }
}
