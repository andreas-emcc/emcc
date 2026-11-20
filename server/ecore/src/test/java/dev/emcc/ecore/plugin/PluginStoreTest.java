package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.runtime.Owner;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.ecore.store.DataTypes;
import dev.emcc.ecore.store.ObjectStore;
import dev.emcc.ecore.store.PictureState;
import dev.emcc.ecore.store.StoreMsg;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.store.Area;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.ObjectQuery;
import dev.emcc.sdk.store.QueryResult;
import dev.emcc.sdk.store.Store;
import dev.emcc.sdk.store.StoreUpdate;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** A plugin's object access (SDK v1 {@code Store}) against the real object store. */
class PluginStoreTest {

  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final Duration TIMEOUT = Duration.ofSeconds(10);

  sealed interface Msg extends Message {
    record Outcome(ChangeOutcome outcome) implements Msg {}

    record Result(QueryResult result) implements Msg {}

    record Update(StoreUpdate update) implements Msg {}

    record Hold(CountDownLatch release) implements Msg {}
  }

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final Owner owner = runtime.owner("cot");
  private static final String SIMULATION = "simulator.simulation";
  private final WorkerHandle<StoreMsg> objectStore = runtime.owner("core-store").spawn(WorkerOptions.<StoreMsg>of(
      "object-store", () -> new ObjectStore(new PictureState(), runtime, Clock.systemUTC(), DataTypes.of(Set.of("cot.track")),
          new dev.emcc.ecore.store.DeclaredFields(), dev.emcc.ecore.store.Workspaces.of(List.of(new dev.emcc.ecore.store.Workspaces.Declared(
              SIMULATION, "plugin.simulator.view", "plugin.simulator.edit"))), new dev.emcc.ecore.store.StoreCounts()))
      .mailbox(10_000, dev.emcc.ecore.runtime.Overflow.DROP_NEWEST));
  private final StoreFeed feed = new StoreFeed(runtime, objectStore);
  private final Store store = new PluginStore("cot", owner, runtime, objectStore, feed);
  private final PluginWorkers workers = new PluginWorkers("cot", owner, getClass().getClassLoader());
  private final Probe<Msg> seen = new Probe<>();
  private final Probe<StoreUpdate> updates = new Probe<>();
  private final WorkerRef<Msg> self = workers.spawn(WorkerSpec.of("self", Msg.class, () -> (message, ctx) -> {
    if (message instanceof Msg.Hold hold) {
      try {
        hold.release().await(Probe.HOLD.toMillis(), TimeUnit.MILLISECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    } else if (message instanceof Msg.Update u) {
      updates.add(u.update());
    } else {
      seen.add(message);
    }
  }));
  private UUID layer;

  @BeforeEach
  void aLayer() {
    layer = UUID.randomUUID();
    applied(Change.createLayer(layer, new LayerContent("Tracks", 1, true, LABEL, Extensions.empty())));
  }

  @AfterEach
  void close() {
    runtime.close();
  }

  private static MapObjectContent track(UUID layerId, double lon, double lat, String dataSource) {
    return new MapObjectContent(MapObjectContent.SYMBOL, "cot.track", dataSource, null, layerId,
        new Geometry.Point(Position.of(lon, lat)), new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null), null, null,
        LABEL, Extensions.empty());
  }

  private ChangeOutcome submit(Change change) {
    store.submit(change, TIMEOUT, self, Msg.Outcome::new);
    return ((Msg.Outcome) seen.next()).outcome();
  }

  private ChangeEvent applied(Change change) {
    ChangeOutcome outcome = submit(change);
    assertThat(outcome).isInstanceOf(ChangeOutcome.Applied.class);
    return ((ChangeOutcome.Applied) outcome).event();
  }

  private QueryResult query(ObjectQuery query) {
    store.query(query, TIMEOUT, self, Msg.Result::new);
    return ((Msg.Result) seen.next()).result();
  }

  private StoreUpdate update() {
    return updates.next();
  }

  private static Area square(double lon, double lat, double half) {
    return Area.of(List.of(Position.of(lon - half, lat - half), Position.of(lon + half, lat - half), Position.of(lon + half, lat + half),
        Position.of(lon - half, lat + half), Position.of(lon - half, lat - half)), Position.of(lon, lat));
  }

  // ---- submit ----------------------------------------------------------------------------------

  @Test
  void aSubmittedChangeIsAppliedAsThePluginAndTheSystemItNames() {
    ChangeEvent event = applied(Change.createObject(UUID.randomUUID(), track(layer, 11.97, 57.71, "tak-north")).bySystem("tak-north"));

    assertThat(event.by().plugin()).isEqualTo("cot");
    assertThat(event.by().system()).isEqualTo("tak-north");
    assertThat(event.by().user()).as("a server part's change has no user").isNull();
    assertThat(owner.outstandingAsks()).isZero();
  }

  @Test
  void rejectionsAndTheExternalIdentityComeBackAsOutcomes() {
    ExternalRef uid = new ExternalRef("cot", "ANDROID-1");
    applied(Change.createObject(UUID.randomUUID(), track(layer, 11.97, 57.71, "tak-north")).withExternalRef(uid));

    ChangeOutcome again = submit(Change.createObject(UUID.randomUUID(), track(layer, 11.97, 57.71, "tak-north")).withExternalRef(uid));
    ChangeOutcome noLayer = submit(Change.createObject(UUID.randomUUID(), track(UUID.randomUUID(), 11.97, 57.71, "tak-north")));

    assertThat(again).isInstanceOfSatisfying(ChangeOutcome.Rejected.class,
        r -> assertThat(r.rejection().code()).isEqualTo(ChangeRejection.Code.EXTERNAL_REF_EXISTS));
    assertThat(noLayer).isInstanceOfSatisfying(ChangeOutcome.Rejected.class,
        r -> assertThat(r.rejection().code()).isEqualTo(ChangeRejection.Code.LAYER_NOT_FOUND));
  }

  // ---- query -----------------------------------------------------------------------------------

  @Test
  void aQuerySelectsByEveryCriterionWithAllLayers() {
    UUID other = UUID.randomUUID();
    applied(Change.createLayer(other, new LayerContent("Other", 2, true, LABEL, Extensions.empty())));
    UUID gothenburg = UUID.randomUUID();
    applied(Change.createObject(gothenburg, track(layer, 11.97, 57.71, "tak-north")).withExternalRef(new ExternalRef("cot", "A")));
    applied(Change.createObject(UUID.randomUUID(), track(layer, 18.07, 59.33, "tak-south")).withExternalRef(new ExternalRef("cot", "B")));
    applied(Change.createObject(UUID.randomUUID(), track(other, 12.0, 57.7, "manual")));

    assertThat(((QueryResult.Found) query(ObjectQuery.all())).objects()).hasSize(3);
    assertThat(((QueryResult.Found) query(ObjectQuery.all())).layers()).hasSize(2);
    assertThat(((QueryResult.Found) query(ObjectQuery.byDataSource("tak-north"))).objects()).extracting(MapObject::id)
        .containsExactly(gothenburg);
    assertThat(((QueryResult.Found) query(ObjectQuery.byExternalSystem("cot"))).objects()).hasSize(2);
    assertThat(((QueryResult.Found) query(ObjectQuery.byExternalRef(new ExternalRef("cot", "A")))).objects()).extracting(MapObject::id)
        .containsExactly(gothenburg);
    assertThat(((QueryResult.Found) query(ObjectQuery.all().inLayer(other))).objects()).hasSize(1);
    assertThat(((QueryResult.Found) query(ObjectQuery.all().within(square(12, 57.7, 0.5)))).objects()).hasSize(2);
    assertThat(((QueryResult.Found) query(ObjectQuery.all().within(square(12, 57.7, 0.5)).inLayer(layer))).objects())
        .extracting(MapObject::id).containsExactly(gothenburg);
    assertThat(query(ObjectQuery.all().limit(2))).isEqualTo(new QueryResult.Failed("more than 2 objects match"));
  }

  @Test
  void anAreaMarginReachesBeyondTheRing() {
    applied(Change.createObject(UUID.randomUUID(), track(layer, 13.0, 57.7, "manual"))); // about 30 km east of the square

    assertThat(((QueryResult.Found) query(ObjectQuery.all().within(square(12, 57.7, 0.5)))).objects()).isEmpty();
    assertThat(((QueryResult.Found) query(ObjectQuery.all().within(square(12, 57.7, 0.5).withMargin(new Area.Margin.Metres(40_000)))))
        .objects()).hasSize(1);
  }

  @Test
  void aQueryNamingWorkspacesGetsTheirLayersAndObjectsAndOneNamingNoneGetsEvery() {
    UUID sim = UUID.randomUUID();
    applied(Change.createLayer(sim, new LayerContent("Exercise", 2, true, LABEL, Extensions.empty(), SIMULATION)));
    UUID inView = UUID.randomUUID();
    UUID inSim = UUID.randomUUID();
    applied(Change.createObject(inView, track(layer, 11.97, 57.71, "manual")));
    applied(Change.createObject(inSim, track(sim, 12.0, 57.7, "manual")));

    QueryResult.Found view = (QueryResult.Found) query(ObjectQuery.all().inWorkspaces("core.view"));
    QueryResult.Found simulation = (QueryResult.Found) query(ObjectQuery.all().inWorkspaces(SIMULATION));
    QueryResult.Found every = (QueryResult.Found) query(ObjectQuery.all());

    assertThat(view.objects()).extracting(MapObject::id).containsExactly(inView);
    assertThat(view.layers()).extracting(Layer::id).containsExactly(layer);
    assertThat(simulation.objects()).extracting(MapObject::id).containsExactly(inSim);
    assertThat(simulation.layers()).extracting(Layer::id).containsExactly(sim);
    assertThat(every.objects()).as("empty means every workspace (N9)").hasSize(2);
    assertThat(every.layers()).hasSize(2);
  }

  // ---- subscribe -------------------------------------------------------------------------------

  @Test
  void aSubscriptionNamingAWorkspaceGetsOnlyItsLayersObjectsAndChanges() {
    UUID sim = UUID.randomUUID();
    applied(Change.createLayer(sim, new LayerContent("Exercise", 2, true, LABEL, Extensions.empty(), SIMULATION)));
    UUID inSim = UUID.randomUUID();
    applied(Change.createObject(inSim, track(sim, 12.0, 57.7, "manual")));
    applied(Change.createObject(UUID.randomUUID(), track(layer, 12.0, 57.7, "manual")));

    store.subscribe(ObjectQuery.all().inWorkspaces(SIMULATION), self, Msg.Update::new);

    StoreUpdate.Snapshot snapshot = (StoreUpdate.Snapshot) update();
    assertThat(snapshot.objects()).extracting(MapObject::id).containsExactly(inSim);
    assertThat(snapshot.layers()).extracting(Layer::id).containsExactly(sim);

    applied(Change.createObject(UUID.randomUUID(), track(layer, 12.1, 57.6, "manual"))); // View's
    applied(Change.updateLayer(snapshot.layers().getFirst(), new LayerContent("Exercise 2", 2, true, LABEL, Extensions.empty())));
    ChangeEvent mine = applied(Change.createObject(UUID.randomUUID(), track(sim, 12.2, 57.5, "manual")));
    ChangeEvent viewLayer = applied(Change.createLayer(UUID.randomUUID(), new LayerContent("Units", 3, true, LABEL, Extensions.empty())));
    ChangeEvent last = applied(Change.createObject(UUID.randomUUID(), track(sim, 12.3, 57.4, "manual")));

    List<Long> sequence = new ArrayList<>();
    while (!sequence.contains(last.sequenceNo())) {
      ((StoreUpdate.Changes) update()).events().forEach(e -> sequence.add(e.sequenceNo()));
    }
    assertThat(sequence).hasSize(3).contains(mine.sequenceNo()).doesNotContain(viewLayer.sequenceNo());
  }

  @Test
  void aSubscriptionGetsASnapshotThenTheChangesThatTouchAMatchingObjectBeforeOrAfter() {
    UUID inside = UUID.randomUUID();
    applied(Change.createObject(inside, track(layer, 12.0, 57.7, "tak-north")));
    applied(Change.createObject(UUID.randomUUID(), track(layer, 30.0, 60.0, "tak-north"))); // outside the area

    store.subscribe(ObjectQuery.all().within(square(12, 57.7, 0.5)), self, Msg.Update::new);

    StoreUpdate.Snapshot snapshot = (StoreUpdate.Snapshot) update();
    assertThat(snapshot.objects()).extracting(MapObject::id).containsExactly(inside);
    assertThat(snapshot.layers()).extracting(Layer::id).containsExactly(layer);

    UUID entering = UUID.randomUUID();
    ChangeEvent created = applied(Change.createObject(entering, track(layer, 12.1, 57.6, "tak-north")));
    applied(Change.createObject(UUID.randomUUID(), track(layer, 31.0, 61.0, "tak-north"))); // not for us
    MapObject current = (MapObject) created.state();
    ChangeEvent movedOut = applied(Change.updateObject(current, track(layer, 25.0, 60.0, "tak-north")));
    ChangeEvent laterOutside = applied(Change.updateObject((MapObject) movedOut.state(), track(layer, 26.0, 60.0, "tak-north")));
    ChangeEvent layerChanged = applied(Change.updateLayer(snapshot.layers().getFirst(), new LayerContent("Renamed", 1, true, LABEL,
        Extensions.empty())));

    List<Long> sequence = new ArrayList<>();
    while (!sequence.contains(layerChanged.sequenceNo())) {
      ((StoreUpdate.Changes) update()).events().forEach(e -> sequence.add(e.sequenceNo()));
    }
    assertThat(sequence).containsExactly(created.sequenceNo(), movedOut.sequenceNo(), layerChanged.sequenceNo());
    assertThat(sequence).doesNotContain(laterOutside.sequenceNo());
  }

  @Test
  void aSlowSubscriberGetsANewSnapshotInsteadOfAnEndlessBacklog() {
    store.subscribe(ObjectQuery.all(), self, Msg.Update::new);
    assertThat(update()).isInstanceOf(StoreUpdate.Snapshot.class);
    CountDownLatch release = new CountDownLatch(1);
    self.send(new Msg.Hold(release));

    Probe<ChangeOutcome> outcomes = new Probe<>();
    WorkerRef<Msg> submitter = workers.spawn(WorkerSpec.of("submitter", Msg.class, () -> (message, ctx) -> {
      if (message instanceof Msg.Outcome o) {
        outcomes.add(o.outcome());
      }
    }));
    // The feed routes each event to every subscription in one call: once this free one has the last
    // event, the held subscriber's queue has it too.
    Probe<Long> markerSeen = new Probe<>();
    WorkerRef<Msg> marker = workers.spawn(WorkerSpec.of("marker", Msg.class, () -> (message, ctx) -> {
      if (message instanceof Msg.Update u) {
        markerSeen.add(switch (u.update()) { // the marker itself may get a new snapshot when it falls behind
          case StoreUpdate.Changes c -> c.events().getLast().sequenceNo();
          case StoreUpdate.Snapshot snap -> snap.sequenceNo();
        });
      }
    }));
    store.subscribe(ObjectQuery.all(), marker, Msg.Update::new);
    int count = Store.MAX_PENDING_UPDATES + 500;
    for (int i = 0; i < count; i++) {
      store.submit(Change.createObject(UUID.randomUUID(), track(layer, 12.0, 57.7, "manual")), TIMEOUT, submitter, Msg.Outcome::new);
    }
    long last = outcomes.next(count).stream().mapToLong(o -> ((ChangeOutcome.Applied) o).event().sequenceNo()).max().orElseThrow();
    long routed = 0;
    while (routed < last) {
      routed = markerSeen.next(); // the feed has routed every change while the subscriber is held
    }
    release.countDown();

    // Replay what arrives as a plugin would: a snapshot replaces everything, changes add to it.
    java.util.Set<UUID> held = new java.util.HashSet<>();
    int received = 0;
    int snapshots = 0;
    while (held.size() < count) {
      StoreUpdate u = update();
      received++;
      switch (u) {
        case StoreUpdate.Snapshot snap -> {
          snapshots++;
          held.clear();
          snap.objects().forEach(o -> held.add(o.id()));
        }
        case StoreUpdate.Changes changes -> changes.events().forEach(e -> held.add(e.entityId()));
      }
    }
    assertThat(snapshots).as("the backlog was replaced by a new snapshot").isEqualTo(1);
    // Usually the new snapshot and one batch; when the snapshot comes back from the object store
    // after the subscriber is released, the old queue first, then the snapshot and the rest.
    assertThat(received).as("batches and the new snapshot, not an update per change").isLessThan(50);
  }

  @Test
  void afterCancelNoMoreChangesArrive() {
    Cancellable first = store.subscribe(ObjectQuery.all(), self, Msg.Update::new);
    assertThat(update()).isInstanceOf(StoreUpdate.Snapshot.class);
    first.cancel();
    store.subscribe(ObjectQuery.all(), self, Msg.Update::new); // same worker: its updates come after any of the first's
    assertThat(update()).isInstanceOf(StoreUpdate.Snapshot.class);

    ChangeEvent created = applied(Change.createObject(UUID.randomUUID(), track(layer, 12.0, 57.7, "manual")));

    assertThat(((StoreUpdate.Changes) update()).events()).extracting(ChangeEvent::sequenceNo).containsExactly(created.sequenceNo());
    assertThat(updates.drain()).isEmpty();
  }

  @Test
  void whenThePluginStopsItsSubscriptionsEnd() {
    store.subscribe(ObjectQuery.all(), self, Msg.Update::new);
    assertThat(update()).isInstanceOf(StoreUpdate.Snapshot.class);
    feed.closeAll("cot");
    Store other = new PluginStore("layer-panel", runtime.owner("layer-panel"), runtime, objectStore, feed);
    other.subscribe(ObjectQuery.all(), self, Msg.Update::new);
    assertThat(update()).isInstanceOf(StoreUpdate.Snapshot.class);

    ChangeEvent created = applied(Change.createObject(UUID.randomUUID(), track(layer, 12.0, 57.7, "manual")));

    assertThat(((StoreUpdate.Changes) update()).events()).extracting(ChangeEvent::sequenceNo).containsExactly(created.sequenceNo());
    assertThat(updates.drain()).isEmpty();
  }
}
