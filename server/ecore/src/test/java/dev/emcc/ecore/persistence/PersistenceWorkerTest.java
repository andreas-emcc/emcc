package dev.emcc.ecore.persistence;

import static dev.emcc.ecore.persistence.Events.layerCreated;
import static dev.emcc.ecore.persistence.Events.objectCreated;
import static dev.emcc.ecore.persistence.Events.objectDeleted;
import static dev.emcc.ecore.persistence.Events.objectUpdated;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.runtime.MessageHandler;
import dev.emcc.ecore.runtime.ReplyHandle;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.ecore.store.PictureSnapshot;
import dev.emcc.ecore.store.PictureState;
import dev.emcc.ecore.store.StoreMsg;
import dev.emcc.sdk.model.ChangeEvent;
import java.io.FileInputStream;
import java.io.UncheckedIOException;
import java.nio.file.AccessDeniedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;

class PersistenceWorkerTest {

  /** Records what the worker asks of the store. */
  private static class RecordingStore implements PictureStore {
    final LinkedBlockingQueue<String> calls = new LinkedBlockingQueue<>();

    @Override
    public Stored load() {
      return new Stored(PictureSnapshot.empty(), List.of());
    }

    @Override
    public void append(ChangeEvent event) {
      calls.add("append " + event.sequenceNo());
    }

    @Override
    public void appendNotSaved(long from, long to) {
      calls.add("not saved " + from + "-" + to);
    }

    @Override
    public void appendNotSavedVersion(UUID id, long version, long before) {
      calls.add("version " + id + " " + version + " before " + before);
    }

    @Override
    public void flush() {
      calls.add("flush");
    }

    @Override
    public void replaceWith(PictureSnapshot snapshot) {
      calls.add("snapshot " + snapshot.sequenceNo());
    }

    @Override
    public void close() {}

    String next() throws InterruptedException {
      String call = calls.poll(10, TimeUnit.SECONDS);
      assertThat(call).as("a call within 10 s").isNotNull();
      return call;
    }

    /** The next call that is not a flush (flush ticks and drains flush). */
    String nextWrite() throws InterruptedException {
      for (String call = next(); ; call = next()) {
        if (!call.equals("flush")) {
          return call;
        }
      }
    }

    /** No write within a moment: only flushes. */
    void noWrite() throws InterruptedException {
      for (String call; (call = calls.poll(300, TimeUnit.MILLISECONDS)) != null; ) {
        assertThat(call).as("nothing written").isEqualTo("flush");
      }
    }
  }

  /** A store whose snapshot cannot be written the first times, as on Windows while another program has the file open. */
  private static final class LockedStore extends RecordingStore {
    private int failures;

    LockedStore(int failures) {
      this.failures = failures;
    }

    @Override
    public void replaceWith(PictureSnapshot snapshot) {
      if (failures-- > 0) {
        calls.add("snapshot " + snapshot.sequenceNo() + " failed");
        throw new UncheckedIOException("cannot write snapshot.json", new AccessDeniedException("snapshot.json"));
      }
      super.replaceWith(snapshot);
    }
  }

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final RecordingStore files = new RecordingStore();
  /** Stands in for the object store: answers a snapshot request with the picture of the events so far. */
  private final SharedPicture picture = new SharedPicture();

  /**
   * The picture of the events so far, shared by the test's thread (which applies them) and the fake
   * store's worker (which snapshots it). {@link PictureState} is not thread-safe (the real store's
   * worker owns it alone), so a snapshot taken while an event was being applied could fail inside the
   * fake store, which then never answered: the worker's ask waits 30 s, longer than the test's 10 s
   * (a flaky run, MCA 2026-11-12). Test code only: ECore never shares a picture like this.
   */
  private static final class SharedPicture {
    private final PictureState state = new PictureState();

    synchronized void apply(ChangeEvent event) {
      state.apply(event);
    }

    synchronized PictureSnapshot snapshot() {
      return state.snapshot();
    }
  }

  @AfterEach
  void close() {
    runtime.close();
  }

  private WorkerHandle<PersistMsg> worker(int compactEvery) {
    return worker(files, get -> get.replyTo().reply(picture.snapshot()), compactEvery);
  }

  private WorkerHandle<PersistMsg> worker(PictureStore to, Consumer<StoreMsg.GetSnapshot> fakeStore, int compactEvery) {
    MessageHandler<StoreMsg> handler = (msg, ctx) -> {
      if (msg instanceof StoreMsg.GetSnapshot get) {
        fakeStore.accept(get);
      }
    };
    WorkerHandle<StoreMsg> store = runtime.owner("core-store").spawn(WorkerOptions.of("object-store", () -> handler));
    return runtime.owner("core-persistence").spawn(
        WorkerOptions.<PersistMsg>of("persistence", () -> new PersistenceWorker(to, store, 0, 0, compactEvery)));
  }

  private static void ticks(WorkerHandle<PersistMsg> worker, int count) {
    for (int i = 0; i < count; i++) {
      worker.send(PersistMsg.Flush.TICK);
    }
  }

  private static long drain(WorkerHandle<PersistMsg> worker) throws Exception {
    CompletableFuture<Long> last = new CompletableFuture<>();
    worker.send(new PersistMsg.Drain(new ReplyHandle<Long>() {
      @Override
      public String id() {
        return "test";
      }

      @Override
      public void reply(Long value) {
        last.complete(value);
      }

      @Override
      public void fail(String reason) {
        last.completeExceptionally(new IllegalStateException(reason));
      }
    }));
    return last.get(10, TimeUnit.SECONDS);
  }

  /** Applies the event to the stand-in picture first, as the object store does before publishing. */
  private void publish(WorkerHandle<PersistMsg> worker, ChangeEvent event) {
    picture.apply(event);
    worker.send(new PersistMsg.Changed(event));
  }

  /** As {@link #publish}, for an update that is not saved (ADR-0041). */
  private void publishNotSaved(WorkerHandle<PersistMsg> worker, ChangeEvent event) {
    picture.apply(event);
    worker.send(new PersistMsg.Changed(event, true));
  }

  @Test
  void updatesNotSavedAreDeclaredBeforeTheNextSavedEventNeverOnePerMove() throws Exception {
    WorkerHandle<PersistMsg> worker = worker(1_000);
    UUID a = UUID.randomUUID();
    UUID b = UUID.randomUUID();
    publish(worker, layerCreated(1));
    publish(worker, objectCreated(2, a));
    publish(worker, objectCreated(3, b));
    publishNotSaved(worker, objectUpdated(4, a, 2)); // a: version 2
    publishNotSaved(worker, objectUpdated(5, b, 2));
    publishNotSaved(worker, objectUpdated(6, a, 3)); // a: version 3
    publish(worker, layerCreated(7)); // saved, and touches neither
    publish(worker, objectUpdated(8, a, 4)); // a's save: declares the version it reached first
    publishNotSaved(worker, objectUpdated(9, a, 5));
    publish(worker, objectDeleted(10, b, 2)); // b's delete after its move
    publish(worker, objectDeleted(11, a, 5));

    assertThat(drain(worker)).isEqualTo(11);
    List<String> calls = new ArrayList<>();
    for (int i = 0; i < 13; i++) {
      calls.add(files.next());
    }
    assertThat(calls).as("no line for the moves themselves").containsExactly("append 1", "append 2", "append 3",
        "not saved 4-6", "append 7",
        "version " + a + " 3 before 8", "append 8",
        "not saved 9-9", "version " + b + " 2 before 10", "append 10",
        "version " + a + " 5 before 11", "append 11", "flush");
  }

  @Test
  void aDrainCountsUpdatesNotSavedAsAccountedFor() throws Exception {
    WorkerHandle<PersistMsg> worker = worker(1_000);
    UUID a = UUID.randomUUID();
    publish(worker, layerCreated(1));
    publish(worker, objectCreated(2, a));
    publishNotSaved(worker, objectUpdated(3, a, 2));
    publishNotSaved(worker, objectUpdated(4, a, 3));

    assertThat(drain(worker)).as("no change event is reported lost").isEqualTo(4);
    assertThat(List.of(files.next(), files.next(), files.next())).containsExactly("append 1", "append 2", "flush");
  }

  @Test
  void aSnapshotHoldsTheMovesSoNothingBeforeItIsDeclaredAfterIt() throws Exception {
    WorkerHandle<PersistMsg> worker = worker(3);
    UUID a = UUID.randomUUID();
    publish(worker, layerCreated(1));
    publish(worker, objectCreated(2, a));
    publishNotSaved(worker, objectUpdated(3, a, 2));
    publish(worker, layerCreated(4)); // the third saved event: compaction
    assertThat(List.of(files.next(), files.next(), files.next(), files.next(), files.next()))
        .containsExactly("append 1", "append 2", "not saved 3-3", "append 4", "snapshot 4");
    publishNotSaved(worker, objectUpdated(5, a, 3));
    publish(worker, objectUpdated(6, a, 4));

    assertThat(List.of(files.next(), files.next(), files.next())).containsExactly("not saved 5-5", "version " + a + " 3 before 6", "append 6");
    publishNotSaved(worker, objectUpdated(7, a, 5));
    // The snapshot after a lost event holds the moves too.
    picture.apply(layerCreated(8)); // dropped
    publish(worker, layerCreated(9));
    assertThat(files.next()).isEqualTo("snapshot 9");
    publish(worker, objectUpdated(10, a, 6));
    assertThat(files.next()).as("version 6 is in the snapshot").isEqualTo("append 10");
  }

  @Test
  void eventsAreAppendedInOrderAndCompactedIntoASnapshot() throws InterruptedException {
    WorkerHandle<PersistMsg> worker = worker(3);

    for (int i = 1; i <= 4; i++) {
      publish(worker, layerCreated(i));
    }

    List<String> calls = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      calls.add(files.next());
    }
    // The snapshot is taken after event 3 at the earliest; event 4 may arrive before or after it.
    assertThat(calls).startsWith("append 1", "append 2", "append 3").contains("append 4");
    assertThat(calls.stream().filter(c -> c.startsWith("snapshot")).toList()).hasSize(1);
  }

  @Test
  void aGapIsRepairedWithASnapshotInsteadOfLosingEvents() throws InterruptedException {
    WorkerHandle<PersistMsg> worker = worker(1_000);
    publish(worker, layerCreated(1));
    assertThat(files.next()).isEqualTo("append 1");

    picture.apply(layerCreated(2)); // event 2 never reaches the worker (dropped)
    publish(worker, layerCreated(3));

    assertThat(files.next()).isEqualTo("snapshot 3"); // contains event 2
    publish(worker, layerCreated(4));
    assertThat(files.next()).isEqualTo("append 4"); // in sync again
  }

  @Test
  void drainFlushesAndAnswersWithTheLastSequenceNumber() throws Exception {
    WorkerHandle<PersistMsg> worker = worker(1_000);
    publish(worker, layerCreated(1));
    publish(worker, layerCreated(2));

    assertThat(drain(worker)).isEqualTo(2);
    assertThat(List.of(files.next(), files.next(), files.next())).containsExactly("append 1", "append 2", "flush");
  }

  @Test
  void aFailedSnapshotDuringAResyncIsRequestedAgainAndDrainReportsOnlyWhatIsStored() throws Exception {
    CountDownLatch failedOnce = new CountDownLatch(1);
    WorkerHandle<PersistMsg> worker = worker(files, get -> {
      if (failedOnce.getCount() > 0) {
        get.replyTo().fail("busy");
        failedOnce.countDown();
      } else {
        get.replyTo().reply(picture.snapshot());
      }
    }, 1_000);
    publish(worker, layerCreated(1));
    assertThat(files.next()).isEqualTo("append 1");
    picture.apply(layerCreated(2)); // dropped
    publish(worker, layerCreated(3)); // reveals the gap; the snapshot request fails
    assertThat(failedOnce.await(10, TimeUnit.SECONDS)).isTrue();

    assertThat(drain(worker)).as("event 3 is not stored yet").isEqualTo(1);
    assertThat(files.next()).isEqualTo("flush");

    worker.send(PersistMsg.Flush.TICK);
    assertThat(List.of(files.next(), files.next())).containsExactly("flush", "snapshot 3");
    assertThat(drain(worker)).isEqualTo(3);
  }

  @Test
  void changesThatArriveWhileACompactionIsPendingAreKept(@TempDir Path dir) throws Exception {
    LinkedBlockingQueue<ReplyHandle<PictureSnapshot>> requests = new LinkedBlockingQueue<>();
    FileStore fileStore = new FileStore(dir, new ModelJson());
    fileStore.load(); // as ECore does before anything is appended
    WorkerHandle<PersistMsg> worker = worker(fileStore, get -> requests.add(get.replyTo()), 2);
    List<ChangeEvent> events = new ArrayList<>();
    for (int i = 1; i <= 5; i++) {
      events.add(layerCreated(i));
    }

    publish(worker, events.get(0));
    publish(worker, events.get(1)); // compaction due: the store is asked for a snapshot
    ReplyHandle<PictureSnapshot> request = requests.poll(10, TimeUnit.SECONDS);
    assertThat(request).isNotNull();
    publish(worker, events.get(2)); // written to the journal while the snapshot is on its way
    publish(worker, events.get(3));
    request.reply(picture.snapshot()); // at sequence 4, as the real store would answer
    publish(worker, events.get(4));
    assertThat(drain(worker)).isEqualTo(5);
    runtime.close();
    fileStore.close();

    PictureStore.Stored stored = new FileStore(dir, new ModelJson()).load();
    assertThat(stored.snapshot().sequenceNo()).isEqualTo(4);
    assertThat(stored.journal()).containsExactly(events.get(4));
  }

  @Test
  void aSnapshotOlderThanTheJournalIsNotWritten(@TempDir Path dir) throws Exception {
    LinkedBlockingQueue<ReplyHandle<PictureSnapshot>> requests = new LinkedBlockingQueue<>();
    FileStore fileStore = new FileStore(dir, new ModelJson());
    fileStore.load(); // as ECore does before anything is appended
    WorkerHandle<PersistMsg> worker = worker(fileStore, get -> requests.add(get.replyTo()), 2);
    List<ChangeEvent> events = List.of(layerCreated(1), layerCreated(2), layerCreated(3));

    publish(worker, events.get(0));
    publish(worker, events.get(1));
    PictureSnapshot atTwo = picture.snapshot();
    ReplyHandle<PictureSnapshot> request = requests.poll(10, TimeUnit.SECONDS);
    assertThat(request).isNotNull();
    publish(worker, events.get(2));
    request.reply(atTwo); // replacing the journal with it would lose event 3
    assertThat(drain(worker)).isEqualTo(3);
    runtime.close();
    fileStore.close();

    PictureStore.Stored stored = new FileStore(dir, new ModelJson()).load();
    assertThat(stored.snapshot().sequenceNo()).isZero();
    assertThat(stored.journal()).containsExactlyElementsOf(events);
  }

  @Test
  void aSnapshotThatCannotBeWrittenIsAskedForAgainAfterAGrowingPauseAndNothingIsLost() throws Exception {
    LockedStore locked = new LockedStore(2);
    AtomicInteger asked = new AtomicInteger();
    WorkerHandle<PersistMsg> worker = worker(locked, get -> {
      asked.incrementAndGet();
      get.replyTo().reply(picture.snapshot());
    }, 2);
    publish(worker, layerCreated(1));
    publish(worker, layerCreated(2)); // compaction due
    assertThat(List.of(locked.nextWrite(), locked.nextWrite(), locked.nextWrite())).containsExactly("append 1", "append 2", "snapshot 2 failed");

    publish(worker, layerCreated(3)); // during the pause: journaled, and no snapshot asked for
    publish(worker, layerCreated(4));
    assertThat(List.of(locked.nextWrite(), locked.nextWrite())).containsExactly("append 3", "append 4");
    ticks(worker, PersistenceWorker.FIRST_RETRY_TICKS - 1);
    drain(worker);
    locked.noWrite();
    assertThat(asked).hasValue(1);

    worker.send(PersistMsg.Flush.TICK); // the pause is over: a fresh snapshot, with every change so far
    assertThat(locked.nextWrite()).isEqualTo("snapshot 4 failed");
    ticks(worker, 2 * PersistenceWorker.FIRST_RETRY_TICKS - 1); // the pause has doubled
    drain(worker);
    locked.noWrite();
    assertThat(asked).hasValue(2);

    worker.send(PersistMsg.Flush.TICK);
    assertThat(locked.nextWrite()).isEqualTo("snapshot 4");
    publish(worker, layerCreated(5));
    assertThat(locked.nextWrite()).as("journaled after the snapshot, as usual").isEqualTo("append 5");
    assertThat(drain(worker)).isEqualTo(5);
    assertThat(asked).hasValue(3);
  }

  @Test
  void aResyncWhoseSnapshotCannotBeWrittenWaitsForAPauseThatDoesNotGrow() throws Exception {
    LockedStore locked = new LockedStore(2);
    AtomicInteger asked = new AtomicInteger();
    WorkerHandle<PersistMsg> worker = worker(locked, get -> {
      asked.incrementAndGet();
      get.replyTo().reply(picture.snapshot());
    }, 1_000);
    publish(worker, layerCreated(1));
    assertThat(locked.nextWrite()).isEqualTo("append 1");
    picture.apply(layerCreated(2)); // dropped
    publish(worker, layerCreated(3)); // the gap: a resync, whose snapshot cannot be written
    assertThat(locked.nextWrite()).isEqualTo("snapshot 3 failed");

    publish(worker, layerCreated(4)); // a resync asks at every change and tick, but not during the pause
    ticks(worker, PersistenceWorker.FIRST_RETRY_TICKS - 1);
    assertThat(drain(worker)).as("nothing stored after event 1 yet").isEqualTo(1);
    locked.noWrite();
    assertThat(asked).hasValue(1);

    worker.send(PersistMsg.Flush.TICK);
    assertThat(locked.nextWrite()).isEqualTo("snapshot 4 failed");
    // Its changes are in no file yet: the pause stays as short as the first.
    ticks(worker, PersistenceWorker.FIRST_RETRY_TICKS - 1);
    assertThat(drain(worker)).isEqualTo(1);
    locked.noWrite();
    assertThat(asked).hasValue(2);

    worker.send(PersistMsg.Flush.TICK);
    assertThat(locked.nextWrite()).isEqualTo("snapshot 4");
    assertThat(drain(worker)).isEqualTo(4);
  }

  @Test
  @EnabledOnOs(OS.WINDOWS) // elsewhere a file another program has open can be replaced
  void aSnapshotFileAnotherProgramHasOpenIsWrittenOnceItIsReleased(@TempDir Path dir) throws Exception {
    FileStore fileStore = new FileStore(dir, new ModelJson());
    fileStore.load(); // writes the first snapshot.json, as ECore does at start
    WorkerHandle<PersistMsg> worker = worker(fileStore, get -> get.replyTo().reply(picture.snapshot()), 2);
    Path temporary = dir.resolve(FileStore.SNAPSHOT + ".tmp");
    List<ChangeEvent> events = List.of(layerCreated(1), layerCreated(2), layerCreated(3));

    try (FileInputStream held = new FileInputStream(dir.resolve(FileStore.SNAPSHOT).toFile())) { // a virus scanner, say
      publish(worker, events.get(0));
      publish(worker, events.get(1)); // compaction due: its file cannot replace the open one
      awaitTrue("the written snapshot left beside the open one", () -> Files.exists(temporary));
      publish(worker, events.get(2)); // still journaled
      assertThat(drain(worker)).isEqualTo(3);
    }
    ticks(worker, PersistenceWorker.FIRST_RETRY_TICKS);
    awaitTrue("the snapshot written once the file is released", () -> !Files.exists(temporary));
    assertThat(drain(worker)).isEqualTo(3);
    runtime.close();
    fileStore.close();

    PictureStore.Stored stored = new FileStore(dir, new ModelJson()).load();
    assertThat(stored.snapshot().sequenceNo()).isEqualTo(3);
    assertThat(stored.journal()).isEmpty();
  }

  private static void awaitTrue(String what, BooleanSupplier condition) throws InterruptedException {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (!condition.getAsBoolean()) {
      assertThat(System.nanoTime()).as(what + " within 10 s").isLessThan(deadline);
      Thread.sleep(10);
    }
  }
}
