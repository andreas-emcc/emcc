package dev.emcc.ecore;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.monitor.MonitorSnapshot;
import dev.emcc.ecore.persistence.FileStore;
import dev.emcc.ecore.persistence.ReadOnlyDirectory;
import dev.emcc.ecore.plugin.PluginEndpoints;
import dev.emcc.ecore.plugin.PluginFolders;
import dev.emcc.ecore.plugin.testplugin.TestPlugin;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.Topic;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.store.ChangeOutcome;
import dev.emcc.ecore.store.PictureSnapshot;
import dev.emcc.ecore.store.Requester;
import dev.emcc.ecore.store.StoreMsg;
import dev.emcc.sdk.PluginStatus;
import dev.emcc.sdk.User;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.FieldValue;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.StandardWatchEventKinds;
import java.nio.file.WatchKey;
import java.nio.file.WatchService;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.ObjectMapper;

/** ECore with the object store and the file store, end to end, including restarts. */
class ECoreStoreTest {

  private static final Duration WAIT = Duration.ofSeconds(10);
  private static final SecurityLabel RESTRICTED = SecurityLabel.of("NATO", "RESTRICTED");
  private static final Actor DRAW = Actor.plugin("draw-symbols");

  @TempDir Path data;

  private ECore start() {
    ECore core = new ECore(ECoreConfig.defaults().dataDirectory(data).defaultLabel(RESTRICTED).compactEvery(50));
    core.start();
    return core;
  }

  private static ChangeOutcome apply(ECore core, ChangeRequest request) {
    FutureReply<ChangeOutcome> reply = new FutureReply<>();
    core.objectStore().send(new StoreMsg.Apply(request, Requester.NO_USER, reply));
    ChangeOutcome outcome = reply.await(WAIT);
    assertThat(outcome).as("an answer within " + WAIT).isNotNull();
    return outcome;
  }

  private static PictureSnapshot snapshot(ECore core) {
    FutureReply<PictureSnapshot> reply = new FutureReply<>();
    core.objectStore().send(new StoreMsg.GetSnapshot(reply));
    PictureSnapshot snapshot = reply.await(WAIT);
    assertThat(snapshot).isNotNull();
    return snapshot;
  }

  private static ChangeRequest createSymbol(UUID layerId, double lon, double lat) {
    MapObjectContent content = new MapObjectContent(MapObjectContent.SYMBOL, MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, layerId, new Geometry.Point(Position.of(lon, lat)),
        new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null), null, null, RESTRICTED, Extensions.empty());
    return ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), content, DRAW);
  }

  @Test
  void anEmptyStoreGetsTheDrawingLayerOnceWithTheConfiguredLabel() {
    try (ECore core = start()) {
      PictureSnapshot picture = snapshot(core);
      assertThat(picture.layers()).hasSize(1);
      Layer layer = picture.layers().getFirst();
      assertThat(layer.content().name()).as("owner, 2026-10-30, BT and BX").isEqualTo("Drawing");
      assertThat(layer.content().label()).isEqualTo(RESTRICTED);
      assertThat(layer.meta().created().by()).isEqualTo(ECore.CORE);
      assertThat(picture.sequenceNo()).isEqualTo(1);
    }
    try (ECore again = start()) {
      assertThat(snapshot(again).layers()).as("not seeded a second time").hasSize(1);
    }
  }

  @Test
  void changesSurviveARestartAndSequenceNumbersContinue() {
    UUID objectId;
    try (ECore core = start()) {
      UUID layerId = snapshot(core).layers().getFirst().id();
      ChangeRequest request = createSymbol(layerId, 15.654321, 60.123456);
      objectId = request.entityId();
      assertThat(apply(core, request)).isInstanceOf(ChangeOutcome.Applied.class);
    }

    try (ECore core = start()) {
      PictureSnapshot picture = snapshot(core);
      assertThat(picture.sequenceNo()).isEqualTo(2);
      assertThat(picture.objects()).singleElement().satisfies(o -> {
        assertThat(o.id()).isEqualTo(objectId);
        assertThat(((Geometry.Point) o.content().geometry()).coordinates()).isEqualTo(Position.of(15.654321, 60.123456));
      });
      ChangeEvent next = ((ChangeOutcome.Applied) apply(core, createSymbol(picture.layers().getFirst().id(), 16.1, 59.9))).event();
      assertThat(next.sequenceNo()).isEqualTo(3);
    }
  }

  @Test
  void aLayersLockSurvivesARestartFromTheJournalAndFromASnapshotAndStillRefusesAUser() {
    UUID layerId;
    try (ECore core = start()) {
      Layer drawing = snapshot(core).layers().getFirst();
      layerId = drawing.id();
      LayerContent lockedContent = drawing.content().withLocked(true);
      assertThat(apply(core, ChangeRequest.update(UUID.randomUUID(), layerId, drawing.version(), lockedContent, Actor.plugin("layer-panel"))))
          .isInstanceOf(ChangeOutcome.Applied.class);
    }
    try (ECore core = start()) {
      assertThat(snapshot(core).layers().getFirst().content().locked()).as("from the journal").isTrue();
      for (int i = 0; i < 60; i++) { // a compaction at compactEvery = 50: a server part's changes pass the lock
        assertThat(apply(core, createSymbol(layerId, 15 + i * 0.01, 60))).isInstanceOf(ChangeOutcome.Applied.class);
      }
    }
    try (ECore core = start()) {
      assertThat(snapshot(core).layers().getFirst().content().locked()).as("from the snapshot").isTrue();
      FutureReply<ChangeOutcome> reply = new FutureReply<>();
      core.objectStore().send(new StoreMsg.Apply(createSymbol(layerId, 16, 60), Requester.withAllPermissions("local"), reply));
      assertThat(reply.await(WAIT)).isInstanceOfSatisfying(ChangeOutcome.Rejected.class,
          r -> assertThat(r.rejection().code()).isEqualTo(ChangeRejection.Code.LAYER_LOCKED));
    }
  }

  @Test
  void aCleanStopLosesNothingEvenRightAfterABurstOfChanges() {
    int changes = 500; // ten compactions at compactEvery = 50, plus a journal tail
    try (ECore core = start()) {
      UUID layerId = snapshot(core).layers().getFirst().id();
      for (int i = 0; i < changes; i++) {
        apply(core, createSymbol(layerId, 10 + i * 0.01, 55 + i * 0.001));
      }
    } // stop right away

    try (ECore core = start()) {
      PictureSnapshot picture = snapshot(core);
      assertThat(picture.objects()).hasSize(changes);
      assertThat(picture.sequenceNo()).isEqualTo(changes + 1L);
    }
  }

  @Test
  void concurrentRequestersEachGetOneAnswerAndSequenceNumbersHaveNoGaps() throws InterruptedException {
    int threads = 8;
    int perThread = 100;
    Set<Long> sequenceNumbers = ConcurrentHashMap.newKeySet();
    List<Throwable> failures = new java.util.concurrent.CopyOnWriteArrayList<>();
    try (ECore core = start()) {
      UUID layerId = snapshot(core).layers().getFirst().id();
      CountDownLatch go = new CountDownLatch(1);
      List<Thread> requesters = new ArrayList<>();
      for (int t = 0; t < threads; t++) {
        int thread = t;
        requesters.add(Thread.ofVirtual().start(() -> {
          try {
            go.await();
            for (int i = 0; i < perThread; i++) {
              ChangeOutcome outcome = apply(core, createSymbol(layerId, 10 + thread, 50 + i * 0.01));
              assertThat(sequenceNumbers.add(((ChangeOutcome.Applied) outcome).event().sequenceNo())).isTrue();
            }
          } catch (Throwable e) {
            failures.add(e);
          }
        }));
      }
      go.countDown();
      for (Thread t : requesters) {
        assertThat(t.join(WAIT)).isTrue();
      }
      assertThat(failures).isEmpty();
      long total = (long) threads * perThread;
      assertThat(sequenceNumbers).hasSize((int) total);
      assertThat(sequenceNumbers.stream().mapToLong(Long::longValue).min().orElseThrow()).isEqualTo(2);
      assertThat(sequenceNumbers.stream().mapToLong(Long::longValue).max().orElseThrow()).isEqualTo(total + 1);
    }
    try (ECore core = start()) {
      assertThat(snapshot(core).objects()).hasSize(threads * perThread);
    }
  }

  @Test
  void aHalfWrittenJournalLineDoesNotStopTheStartNorSwallowTheNextChange() throws IOException {
    try (ECore core = start()) {
      apply(core, createSymbol(snapshot(core).layers().getFirst().id(), 15.6, 60.1));
    }
    Files.writeString(data.resolve(FileStore.JOURNAL), "{\"sequenceNo\": 3, \"requestId\": \"0192", StandardOpenOption.APPEND);

    try (ECore core = start()) {
      PictureSnapshot picture = snapshot(core);
      assertThat(picture.objects()).hasSize(1);
      apply(core, createSymbol(picture.layers().getFirst().id(), 16.2, 59.8)); // written after the cut-off fragment
    }

    try (ECore core = start()) {
      PictureSnapshot picture = snapshot(core);
      assertThat(picture.objects()).hasSize(2);
      assertThat(picture.sequenceNo()).isEqualTo(3);
    }
  }

  @Test
  void aDataDirectoryThatCannotBeWrittenStopsTheStart() throws IOException {
    try (ECore core = start()) {
      snapshot(core);
    }

    try (var _ = new ReadOnlyDirectory(data)) {
      ECore core = new ECore(ECoreConfig.defaults().dataDirectory(data).defaultLabel(RESTRICTED));
      assertThatThrownBy(core::start).isInstanceOf(IllegalStateException.class).hasMessageContaining("is not writable");
      assertThat(core.state()).isEqualTo(ECore.State.STOPPED);
    }
  }

  // ---- Updates that are not saved (ADR-0041) ---------------------------------------------------

  private static ChangeOutcome applyNotSaved(ECore core, ChangeRequest request) {
    FutureReply<ChangeOutcome> reply = new FutureReply<>();
    core.objectStore().send(new StoreMsg.Apply(request, Requester.NO_USER, true, reply));
    ChangeOutcome outcome = reply.await(WAIT);
    assertThat(outcome).as("an answer within " + WAIT).isNotNull();
    return outcome;
  }

  /** {@code object} moved to {@code lon}, {@code lat}: an update of nothing but its geometry. */
  private static ChangeRequest move(MapObject object, double lon, double lat) {
    MapObjectContent c = object.content();
    MapObjectContent moved = new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(),
        new Geometry.Point(Position.of(lon, lat, 500.0)), c.symbol(), c.style(), c.properties(), c.label(), c.extensions());
    return ChangeRequest.update(UUID.randomUUID(), object.id(), object.version(), moved, DRAW);
  }

  private static MapObject object(ECore core, UUID id) {
    return snapshot(core).objects().stream().filter(o -> o.id().equals(id)).findFirst().orElseThrow();
  }

  private static Position position(MapObject object) {
    return ((Geometry.Point) object.content().geometry()).coordinates();
  }

  @Test
  void movesNotSavedAreLostAtARestartButEverySavedChangeAroundThemLoads() {
    UUID kept;
    UUID deleted;
    long lastSaved;
    try (ECore core = start()) {
      UUID layerId = snapshot(core).layers().getFirst().id();
      kept = ((ChangeOutcome.Applied) apply(core, createSymbol(layerId, 15.1, 60.2))).event().entityId();
      deleted = ((ChangeOutcome.Applied) apply(core, createSymbol(layerId, 16.1, 59.2))).event().entityId();
      for (int i = 1; i <= 5; i++) { // the run: both move, nothing written
        assertThat(applyNotSaved(core, move(object(core, kept), 15.1 + i * 0.01, 60.2))).isInstanceOf(ChangeOutcome.Applied.class);
        assertThat(applyNotSaved(core, move(object(core, deleted), 16.1, 59.2 + i * 0.01))).isInstanceOf(ChangeOutcome.Applied.class);
      }
      apply(core, move(object(core, kept), 15.5, 60.5)); // the pause: saved
      apply(core, ChangeRequest.delete(UUID.randomUUID(), EntityType.OBJECT, deleted, null, DRAW)); // a user deletes a moved track
      lastSaved = snapshot(core).sequenceNo();
      applyNotSaved(core, move(object(core, kept), 15.7, 60.7)); // running again; then a clean stop
      assertThat(snapshot(core).sequenceNo()).isEqualTo(lastSaved + 1);
    }

    try (ECore core = start()) {
      PictureSnapshot picture = snapshot(core);
      assertThat(picture.sequenceNo()).as("back to the last saved change").isEqualTo(lastSaved);
      assertThat(picture.objects()).singleElement().satisfies(o -> {
        assertThat(o.id()).isEqualTo(kept);
        assertThat(position(o)).isEqualTo(Position.of(15.5, 60.5, 500.0));
        assertThat(o.version()).isEqualTo(7); // created, five moves, the save
      });
      assertThat(apply(core, move(object(core, kept), 15.8, 60.8))).as("the next change continues").isInstanceOf(ChangeOutcome.Applied.class);
    }

    try (ECore core = start()) {
      assertThat(position(object(core, kept))).isEqualTo(Position.of(15.8, 60.8, 500.0));
    }
  }

  @Test
  void aCompactionDuringARunKeepsTheMovesItHolds() throws IOException {
    UUID track;
    try (ECore core = start(); WatchService snapshots = data.getFileSystem().newWatchService()) {
      UUID layerId = snapshot(core).layers().getFirst().id();
      track = ((ChangeOutcome.Applied) apply(core, createSymbol(layerId, 15.1, 60.2))).event().entityId();
      applyNotSaved(core, move(object(core, track), 15.3, 60.3));
      data.register(snapshots, StandardWatchEventKinds.ENTRY_CREATE, StandardWatchEventKinds.ENTRY_MODIFY);
      for (int i = 0; i < 60; i++) { // others' saved changes: a compaction (compactEvery = 50) while the track has moved
        apply(core, createSymbol(layerId, 10 + i * 0.01, 55 + i * 0.001));
      }
      // Persistence writes behind the store: it asks for the compaction's snapshot only once it has
      // handled the 50th change, and a stop drops a compaction still on its way. So wait until it is written.
      awaitSnapshotWritten(snapshots);
      applyNotSaved(core, move(object(core, track), 15.4, 60.4)); // after the compaction: lost at the restart
    }

    try (ECore core = start()) {
      assertThat(position(object(core, track))).as("the snapshot's position, not the last saved one")
          .isEqualTo(Position.of(15.3, 60.3, 500.0));
      assertThat(snapshot(core).objects()).hasSize(61);
    }
  }

  /**
   * Waits, at most {@link #WAIT}, until a snapshot lands in the data directory. It watches the
   * directory and never opens the file: on Windows, replacing a file another handle has open fails,
   * so a test that read it would itself make the compaction fail.
   */
  private static void awaitSnapshotWritten(WatchService snapshots) {
    long deadline = System.nanoTime() + WAIT.toNanos();
    while (true) {
      long left = deadline - System.nanoTime();
      assertThat(left).as("a snapshot written within " + WAIT).isPositive();
      WatchKey key;
      try {
        key = snapshots.poll(left, TimeUnit.NANOSECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new AssertionError("interrupted while waiting for the snapshot", e);
      }
      if (key == null) {
        continue; // the deadline check above fails
      }
      boolean written = key.pollEvents().stream().anyMatch(e -> FileStore.SNAPSHOT.equals(String.valueOf(e.context())));
      key.reset();
      if (written) {
        return;
      }
    }
  }

  @TempDir Path plugins;

  @Test
  void theStoreChecksAndAppliesTheFieldsTheLoadedPluginsDeclare() {
    new PluginFolders(plugins).install("tracks", """
        {"id": "tracks", "name": "Tracks", "version": "0.1.0", "sdkVersion": "^1.2.0", "kind": "general",
         "server": {"entryClass": "%s"},
         "fields": [{"name": "callsign", "type": "text", "label": "Callsign", "maxLength": 8, "editableByOthers": true}],
         "settings": {"type": "object", "properties": {"mode": {"type": "string", "default": "ok"}}}}
        """.formatted(PluginFolders.ENTRY_CLASS), true);
    try (ECore core = new ECore(ECoreConfig.defaults().dataDirectory(data).defaultLabel(RESTRICTED).pluginsDirectory(plugins))) {
      core.start();
      UUID layerId = snapshot(core).layers().getFirst().id();
      ChangeRequest create = createSymbol(layerId, 15.1, 60.2);
      UUID id = create.entityId();

      ChangeOutcome named = apply(core, new ChangeRequest(create.requestId(), create.entityType(), create.operation(), id, null,
          create.data(), null, create.source(), List.of(new FieldValue("tracks", "callsign", JsonString.of("ALPHA-1")))));
      ChangeOutcome tooLong = apply(core, new ChangeRequest(UUID.randomUUID(), create.entityType(), Operation.UPDATE, id, 1L,
          create.data(), null, create.source(), List.of(new FieldValue("tracks", "callsign", JsonString.of("ALPHA-100")))));

      assertThat(named).isInstanceOf(ChangeOutcome.Applied.class);
      assertThat(object(core, id).content().extensions().get("tracks")).isEqualTo(JsonObject.of(Map.of("callsign", JsonString.of("ALPHA-1"))));
      assertThat(tooLong).isInstanceOfSatisfying(ChangeOutcome.Rejected.class,
          r -> assertThat(r.rejection().message()).isEqualTo("Callsign is too long"));
    }
  }

  @Test
  void viewWithoutLayersGetsTheDrawingLayerAlsoWhenAnotherWorkspaceHasLayersWhichKeepTheirWorkspaceWithoutTheirPlugin() {
    new PluginFolders(plugins).install("tracks", """
        {"id": "tracks", "name": "Tracks", "version": "0.1.0", "sdkVersion": "^1.2.0", "kind": "general",
         "server": {"entryClass": "%s"},
         "permissions": ["plugin.tracks.view", "plugin.tracks.edit"],
         "workspaces": [{"id": "tracks.exercise", "name": "Exercise", "viewPermission": "plugin.tracks.view",
                         "editPermission": "plugin.tracks.edit"}],
         "settings": {"type": "object", "properties": {"mode": {"type": "string", "default": "ok"}}}}
        """.formatted(PluginFolders.ENTRY_CLASS), true);
    UUID exercise = UUID.randomUUID();
    try (ECore core = new ECore(ECoreConfig.defaults().dataDirectory(data).defaultLabel(RESTRICTED).pluginsDirectory(plugins))) {
      core.start();
      Layer seeded = snapshot(core).layers().getFirst();
      assertThat(apply(core, ChangeRequest.create(UUID.randomUUID(), exercise,
          new LayerContent("Exercise", 0, true, RESTRICTED, Extensions.empty(), "tracks.exercise"), DRAW))).isInstanceOf(ChangeOutcome.Applied.class);
      assertThat(apply(core, ChangeRequest.delete(UUID.randomUUID(), EntityType.LAYER, seeded.id(), null, DRAW)))
          .isInstanceOf(ChangeOutcome.Applied.class);
    }

    try (ECore core = new ECore(ECoreConfig.defaults().dataDirectory(data).defaultLabel(RESTRICTED).pluginsDirectory(plugins))) {
      core.start();
      List<Layer> layers = snapshot(core).layers();
      assertThat(layers).extracting(l -> l.content().name()).as("owner, 2026-10-27 (E)").containsExactlyInAnyOrder("Exercise", ECore.SEEDED_LAYER);
      assertThat(layers).filteredOn(l -> l.id().equals(exercise)).singleElement()
          .satisfies(l -> assertThat(l.content().workspace()).isEqualTo("tracks.exercise"));
      assertThat(layers).filteredOn(l -> l.content().name().equals(ECore.SEEDED_LAYER)).singleElement()
          .satisfies(l -> assertThat(l.content().workspace()).as("in View").isNull());
    }

    try (ECore core = start()) { // without the plugin: its workspace is no longer declared
      List<Layer> layers = snapshot(core).layers();
      assertThat(layers).as("kept, and View is not seeded again").hasSize(2);
      assertThat(layers).filteredOn(l -> l.id().equals(exercise)).singleElement()
          .satisfies(l -> assertThat(l.content().workspace()).isEqualTo("tracks.exercise"));
    }
  }

  @Test
  void aPluginsMovesNotSavedAreAppliedCountedAndLostAtARestartAndAnEditIsRefused() {
    new PluginFolders(plugins).install("sim", PluginFolders.manifest("sim", "^1.2.0", PluginFolders.ENTRY_CLASS, "move", List.of(), false),
        true);
    UUID track;
    try (ECore core = new ECore(ECoreConfig.defaults().dataDirectory(data).defaultLabel(RESTRICTED).pluginsDirectory(plugins))) {
      core.start();
      Probe<String> events = new Probe<>();
      WorkerHandle<PluginStatus> recorder = core.runtime().owner("core-test").spawn(
          WorkerOptions.<PluginStatus>of("recorder", () -> (status, ctx) -> events.add(status.detail())));
      core.runtime().owner("core-test").subscribe(Topic.of("sim.events", PluginStatus.class), recorder, s -> s);
      Probe<HttpReply> reply = new Probe<>();
      core.plugins().endpoints().dispatch(new PluginEndpoints.Request("sim", "GET", "/move", Map.of(), Headers.empty(),
          User.noLoginUser()), reply::add);
      assertThat(reply.next().status()).isEqualTo(202);

      String created = events.next();
      assertThat(created).startsWith("track ");
      track = UUID.fromString(created.split(" ")[1]);
      assertThat(events.next(TestPlugin.MOVES)).containsExactly("moved 2 sim", "moved 3 sim", "moved 4 sim");
      assertThat(events.next()).as("more than a move, not saved").startsWith("edit VALIDATION_FAILED: an update that is not saved may change only");

      assertThat(position(object(core, track))).as("applied").isEqualTo(Position.of(15.1 + TestPlugin.MOVES * 0.01, 60.2));
      MonitorSnapshot.Plugin sim = core.monitor().snapshot().plugins().stream().filter(p -> p.id().equals("sim")).findFirst().orElseThrow();
      assertThat(sim.notSavedUpdates()).as("counted for the plugin").isEqualTo(TestPlugin.MOVES);
      assertThat(new ObjectMapper().valueToTree(sim).get("notSavedUpdates").asLong()).as("api.ts MonitorPlugin")
          .isEqualTo(TestPlugin.MOVES);
    }

    try (ECore core = start()) { // without the plugin
      MapObject back = object(core, track);
      assertThat(position(back)).as("where its create left it").isEqualTo(Position.of(15.1, 60.2));
      assertThat(back.version()).isEqualTo(1);
    }
  }
}
