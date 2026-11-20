package dev.emcc.ecore.live;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.live.LiveGatewayTest.Browser;
import dev.emcc.ecore.runtime.ManualTime;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.ReplyHandle;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.ecore.store.ChangeOutcome;
import dev.emcc.ecore.store.DataTypes;
import dev.emcc.ecore.store.DeclaredFields;
import dev.emcc.ecore.store.ObjectStore;
import dev.emcc.ecore.store.PictureState;
import dev.emcc.ecore.store.Requester;
import dev.emcc.ecore.store.StoreCounts;
import dev.emcc.ecore.store.StoreMsg;
import dev.emcc.ecore.store.Workspaces;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/**
 * The live picture's filter by workspace (ADR-0039 point 7; T-080; owner, 2026-10-27): a
 * subscription gets View without {@code workspaces}, {@code "*"} every workspace its user may see,
 * and otherwise those named that the user may see, others left out without a word; changes, counts
 * and queries follow; the session's first permission check is coarse, the object store's exact.
 */
class LiveWorkspacesTest {

  private static final ModelJson JSON = new ModelJson();
  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-27T12:00:00Z"), ZoneOffset.UTC);
  private static final String SIMULATION = "simulator.simulation";
  private static final String VIEW_SIM = "plugin.simulator.view";
  private static final String EDIT_SIM = "plugin.simulator.edit";
  private static final Workspaces DECLARED = Workspaces.of(List.of(new Workspaces.Declared(SIMULATION, VIEW_SIM, EDIT_SIM)));
  /** The store's, which also knows old.space, so a plugin can make a layer there that the live picture no longer knows. */
  private static final Workspaces BEFORE = Workspaces.of(List.of(new Workspaces.Declared(SIMULATION, VIEW_SIM, EDIT_SIM),
      new Workspaces.Declared("old.space", "plugin.old.view", "plugin.old.edit")));
  private static final Actor CLAIMED = new Actor("draw-symbols", "mallory", null);

  /** Sees Simulation, edits nothing. */
  private static final Requester.User WATCHER = Requester.user("u-watch", Set.of(VIEW_SIM));
  /** View's editor, who may not see Simulation. */
  private static final Requester.User EDITOR = Requester.user("u-edit", Set.of(Requester.OBJECTS_EDIT, Requester.LAYERS_EDIT));
  /** Simulation's editor only. */
  private static final Requester.User SIMULATOR = Requester.user("u-sim", Set.of(VIEW_SIM, EDIT_SIM));

  private final ManualTime time = new ManualTime();
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time));
  /** How many snapshots the sessions have asked the store for. */
  private final AtomicInteger snapshotsAsked = new AtomicInteger();
  private final WorkerHandle<StoreMsg> store = runtime.owner("core-store").spawn(WorkerOptions.<StoreMsg>of("object-store", () -> {
    ObjectStore real = new ObjectStore(new PictureState(), runtime, CLOCK, new DataTypes(), new DeclaredFields(), BEFORE, new StoreCounts());
    return (message, context) -> {
      if (message instanceof StoreMsg.GetArea) { // a snapshot; these tests move no area
        snapshotsAsked.incrementAndGet();
      }
      real.handle(message, context);
    };
  }));
  private final LiveGateway gateway = new LiveGateway(runtime, store, JSON, CLOCK, new LiveGateway.Limits(LiveGateway.BATCH_INTERVAL, 100,
      10, LiveGateway.INBOUND_BUDGET, WorkerOptions.MAX_BUDGET, LiveGateway.DEFAULT_MAX_BUDGET, LiveGateway.MAX_HELD), DECLARED);
  private final UUID view = UUID.randomUUID();
  private final UUID sim = UUID.randomUUID();
  private final UUID inView = UUID.randomUUID();
  private final UUID inSim = UUID.randomUUID();

  /** View's layer and Simulation's, each with an object, made by a plugin's server part. */
  @BeforeEach
  void picture() {
    applied(ChangeRequest.create(UUID.randomUUID(), view, layer("Units", null), Actor.plugin("cot")));
    applied(ChangeRequest.create(UUID.randomUUID(), sim, layer("Exercise", SIMULATION), Actor.plugin("simulator")));
    applied(ChangeRequest.create(UUID.randomUUID(), inView, symbol(view, 15.6, 60.1), Actor.plugin("cot")));
    applied(ChangeRequest.create(UUID.randomUUID(), inSim, symbol(sim, 15.7, 60.2), Actor.plugin("simulator")));
  }

  @AfterEach
  void close() {
    runtime.close();
  }

  private static LayerContent layer(String name, String workspace) {
    return new LayerContent(name, 0, true, LABEL, Extensions.empty(), workspace);
  }

  private static MapObjectContent symbol(UUID layerId, double lon, double lat) {
    return new MapObjectContent(MapObjectContent.SYMBOL, MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, layerId,
        new Geometry.Point(Position.of(lon, lat)), new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null), null, null,
        LABEL, Extensions.empty());
  }

  private void applied(ChangeRequest request) {
    Probe<ChangeOutcome> outcome = new Probe<>();
    store.send(new StoreMsg.Apply(request, Requester.NO_USER, new ReplyHandle<>() {
      @Override
      public String id() {
        return "test";
      }

      @Override
      public void reply(ChangeOutcome value) {
        outcome.add(value);
      }

      @Override
      public void fail(String reason) {
        throw new AssertionError(reason);
      }
    }));
    assertThat(outcome.next()).isInstanceOf(ChangeOutcome.Applied.class);
  }

  private LiveGateway.LiveSession open(Browser browser, Requester.User user) {
    LiveGateway.LiveSession session = gateway.open(user, browser);
    browser.next("welcome");
    return session;
  }

  /** Opens subscription {@code id} with {@code options} and returns its snapshot: its begin, then each object's id. */
  private static Snapshot subscribe(LiveGateway.LiveSession session, Browser browser, String id, String options) {
    session.receive("{\"type\":\"subscribe\",\"subscription\":\"" + id + "\"" + options + "}");
    JsonNode begin = browser.next("snapshot-begin");
    List<String> objects = new ArrayList<>();
    for (int i = 0; i < begin.get("objectCount").asInt(); ) {
      JsonNode part = browser.next("snapshot-objects");
      part.get("objects").forEach(o -> objects.add(o.get("id").asString()));
      i += part.get("objects").size();
    }
    browser.next("snapshot-end");
    return new Snapshot(begin, objects);
  }

  private record Snapshot(JsonNode begin, List<String> objects) {
    List<String> layers() {
      List<String> ids = new ArrayList<>();
      begin.get("layers").forEach(l -> ids.add(l.get("id").asString()));
      return ids;
    }
  }

  private void advance() {
    time.advanceSettled(LiveGateway.BATCH_INTERVAL, runtime);
  }

  // ---- Snapshots -----------------------------------------------------------------------------------

  @Test
  void withoutWorkspacesASubscriptionGetsViewOnlyWhateverTheUserMaySee() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser, WATCHER);

    Snapshot all = subscribe(session, browser, "all", "");

    assertThat(all.layers()).containsExactly(view.toString());
    assertThat(all.objects()).containsExactly(inView.toString());
  }

  @Test
  void aStarGivesEveryWorkspaceTheUserMaySee() {
    Browser watcher = new Browser();
    Browser editor = new Browser();

    Snapshot seen = subscribe(open(watcher, WATCHER), watcher, "all", ",\"workspaces\":[\"*\"]");
    Snapshot notSeen = subscribe(open(editor, EDITOR), editor, "all", ",\"workspaces\":[\"*\"]");

    assertThat(seen.layers()).containsExactlyInAnyOrder(view.toString(), sim.toString());
    assertThat(seen.objects()).containsExactlyInAnyOrder(inView.toString(), inSim.toString());
    assertThat(notSeen.layers()).containsExactly(view.toString());
    assertThat(notSeen.objects()).containsExactly(inView.toString());
  }

  @Test
  void aWorkspaceTheUserMayNotSeeOrThatNobodyDeclaresIsLeftOutWithoutAWord() {
    Browser editor = new Browser();
    LiveGateway.LiveSession session = open(editor, EDITOR);

    Snapshot named = subscribe(session, editor, "sim", ",\"workspaces\":[\"simulator.simulation\",\"replay.replay\"]");
    Snapshot counts = subscribe(session, editor, "counts", ",\"objects\":false,\"workspaces\":[\"replay.replay\",\"core.view\"]");

    assertThat(named.layers()).as("not an error: the browser cannot tell that it exists").isEmpty();
    assertThat(named.objects()).isEmpty();
    assertThat(counts.layers()).containsExactly(view.toString());
    assertThat(counts.begin().get("objectCounts").properties()).extracting(java.util.Map.Entry::getKey).containsExactly(view.toString());
  }

  @Test
  void anAreaSubscriptionGetsOnlyItsWorkspacesObjects() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser, WATCHER);
    String area = ",\"area\":{\"ring\":[[15,59.5],[16.5,59.5],[16.5,60.5],[15,60.5],[15,59.5]],\"inside\":[15.6,60.1]}";

    Snapshot inViewOnly = subscribe(session, browser, "map", area);
    browser.next("clusters");
    Snapshot inSimOnly = subscribe(session, browser, "sim-map", area + ",\"workspaces\":[\"simulator.simulation\"]");

    assertThat(inViewOnly.objects()).containsExactly(inView.toString());
    assertThat(inSimOnly.objects()).containsExactly(inSim.toString());
    assertThat(inSimOnly.layers()).containsExactly(sim.toString());
  }

  @Test
  void anAreaThatMovesOrChangesStaysInItsWorkspace() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser, WATCHER);
    UUID farInSim = UUID.randomUUID();
    applied(ChangeRequest.create(UUID.randomUUID(), farInSim, symbol(sim, 20.1, 62.1), Actor.plugin("simulator")));
    subscribe(session, browser, "map", ",\"area\":{\"ring\":[[15,59.5],[16.5,59.5],[16.5,60.5],[15,60.5],[15,59.5]],\"inside\":[15.6,60.1]}");
    browser.next("clusters");

    // A move to where only Simulation has an object: nothing enters, and View's object leaves.
    session.receive("{\"type\":\"area\",\"subscription\":\"map\",\"area\":{\"ring\":[[19.5,61.5],[20.5,61.5],[20.5,62.5],"
        + "[19.5,62.5],[19.5,61.5]],\"inside\":[20.1,62.1]}}");
    JsonNode moved = browser.next("area-objects");
    assertThat(moved.get("entered")).isEmpty();
    assertThat(moved.get("left")).singleElement().satisfies(id -> assertThat(id.asString()).isEqualTo(inView.toString()));

    // Simulation's object moves within the area, and a new one appears there: neither reaches View's subscription.
    applied(ChangeRequest.update(UUID.randomUUID(), farInSim, 1L, symbol(sim, 20.2, 62.0), Actor.plugin("simulator")));
    applied(ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), symbol(sim, 20.0, 62.2), Actor.plugin("simulator")));
    advance();
    JsonNode changes = browser.next("changes");
    assertThat(changes.get("events")).isEmpty();
    session.receive("{\"type\":\"marker\"}");
    assertThat(browser.next("error").get("message").asString()).as("no area-objects, no clusters").contains("marker");
  }

  @Test
  void aBadWorkspacesValueOpensNoSubscription() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser, WATCHER);

    session.receive("{\"type\":\"subscribe\",\"subscription\":\"bad\",\"workspaces\":\"*\"}");
    session.receive("{\"type\":\"subscribe\",\"subscription\":\"worse\",\"workspaces\":[1]}");

    assertThat(browser.next("error").get("message").asString())
        .isEqualTo("subscription bad not opened: workspaces is a list of at most 64 workspace ids or \"*\"");
    assertThat(browser.next("error").get("message").asString())
        .isEqualTo("subscription worse not opened: workspaces is a list of workspace ids or \"*\"");
    session.receive("{\"type\":\"subscribe\",\"subscription\":\"star\",\"workspaces\":[\"*\",1]}");
    assertThat(browser.next("error").get("message").asString()).as("the whole list is checked, also after a star")
        .isEqualTo("subscription star not opened: workspaces is a list of workspace ids or \"*\"");
    session.receive("{\"type\":\"subscribe\",\"subscription\":\"many\",\"workspaces\":["
        + "\"core.view\",".repeat(64) + "\"core.view\"]}");
    assertThat(browser.next("error").get("message").asString())
        .isEqualTo("subscription many not opened: workspaces is a list of at most 64 workspace ids or \"*\"");
  }

  @Test
  void aWorkspaceNoLoadedPluginDeclaresAnyMoreIsSeenByNobody() {
    UUID orphan = UUID.randomUUID();
    UUID inOrphan = UUID.randomUUID();
    applied(ChangeRequest.create(UUID.randomUUID(), orphan, layer("Old", "old.space"), Actor.plugin("old")));
    applied(ChangeRequest.create(UUID.randomUUID(), inOrphan, symbol(orphan, 15.6, 60.1), Actor.plugin("old")));
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser, Requester.withAllPermissions("local"));

    Snapshot all = subscribe(session, browser, "all", ",\"workspaces\":[\"*\",\"old.space\"]");
    session.receive("{\"type\":\"get-objects\",\"queryId\":\"q1\",\"ids\":[\"" + inOrphan + "\"]}");
    JsonNode found = browser.next("objects");
    session.receive("{\"type\":\"query-layer\",\"queryId\":\"q2\",\"layerId\":\"" + orphan + "\",\"page\":0,\"pageSize\":10}");
    JsonNode page = browser.next("query-failed");

    assertThat(all.layers()).containsExactlyInAnyOrder(view.toString(), sim.toString());
    assertThat(all.objects()).doesNotContain(inOrphan.toString());
    assertThat(found.get("missing")).singleElement().satisfies(id -> assertThat(id.asString()).isEqualTo(inOrphan.toString()));
    assertThat(page.get("problem").asString()).isEqualTo("no-layer");
  }

  /**
   * A switch subscribes again under the same id for other workspaces than its last snapshot's:
   * answered at once, also back and forth, not after the id's interval (PCA-object-list's finding;
   * owner, 2026-10-28). The same workspaces again still wait.
   */
  @Test
  void aSwitchUnderTheSameIdIsAnsweredAtOnceButTheSameWorkspacesAgainWaitTheInterval() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser, WATCHER);
    String inSimulation = ",\"workspaces\":[\"" + SIMULATION + "\"]";
    assertThat(subscribe(session, browser, "map", inSimulation).layers()).containsExactly(sim.toString());

    unsubscribe(session, "map");
    assertThat(subscribe(session, browser, "map", "").layers()).as("View, at once").containsExactly(view.toString());
    unsubscribe(session, "map");
    assertThat(subscribe(session, browser, "map", inSimulation).layers()).as("back, at once").containsExactly(sim.toString());

    unsubscribe(session, "map");
    session.receive("{\"type\":\"subscribe\",\"subscription\":\"map\"" + inSimulation + "}");
    assertThat(storeRoundTrip(session, browser)).as("no snapshot before the store's answer").isZero();
    time.advanceSettled(SessionWorker.MIN_SNAPSHOT_INTERVAL, runtime);
    assertThat(browser.next("snapshot-begin").get("layers").get(0).get("id").asString()).isEqualTo(sim.toString());
  }

  @Test
  void aLoopSwitchingOneIdBackAndForthIsHeldToTheSessionsCap() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser, WATCHER);
    String inSimulation = ",\"workspaces\":[\"" + SIMULATION + "\"]";

    for (int i = 0; i < 40; i++) {
      if (i > 0) {
        unsubscribe(session, "map");
      }
      session.receive("{\"type\":\"subscribe\",\"subscription\":\"map\"" + (i % 2 == 0 ? "" : inSimulation) + "}");
    }
    storeRoundTrip(session, browser);

    assertThat(snapshotsAsked.get()).isEqualTo(SessionWorker.MAX_SUBSCRIPTIONS);
    time.advanceSettled(SessionWorker.MIN_SNAPSHOT_INTERVAL, runtime);
    storeRoundTrip(session, browser);
    assertThat(snapshotsAsked.get()).as("the open one's, after the interval").isEqualTo(SessionWorker.MAX_SUBSCRIPTIONS + 1);
  }

  /** Snapshots held by the session's cap that come due together are held to it again (the review's remark 7). */
  @Test
  void snapshotsThatComeDueTogetherAreHeldToTheSessionsCapAgain() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser, WATCHER);
    Duration step = Duration.ofMillis(10);
    for (int i = 0; i < SessionWorker.MAX_SUBSCRIPTIONS; i++) { // the cap's slots, 10 ms apart
      subscribe(session, browser, "a" + i, "");
      time.advanceSettled(step, runtime);
    }
    for (int i = 0; i < SessionWorker.MAX_SUBSCRIPTIONS; i++) {
      unsubscribe(session, "a" + i);
    }
    for (int i = 0; i < SessionWorker.MAX_SUBSCRIPTIONS; i++) {
      session.receive("{\"type\":\"subscribe\",\"subscription\":\"b" + i + "\"}"); // each waits for the oldest slot
    }
    storeRoundTrip(session, browser);
    assertThat(snapshotsAsked.get()).isEqualTo(SessionWorker.MAX_SUBSCRIPTIONS);

    time.advanceSettled(SessionWorker.MIN_SNAPSHOT_INTERVAL.minus(step.multipliedBy(SessionWorker.MAX_SUBSCRIPTIONS)), runtime);
    storeRoundTrip(session, browser);

    assertThat(snapshotsAsked.get()).as("only the slot that has freed").isEqualTo(SessionWorker.MAX_SUBSCRIPTIONS + 1);
  }

  private static void unsubscribe(LiveGateway.LiveSession session, String id) {
    session.receive("{\"type\":\"unsubscribe\",\"subscription\":\"" + id + "\"}");
  }

  /**
   * A query through the store, which answers in order: what the session asked of it before has been
   * answered when this returns. Returns how many snapshots began before the answer.
   */
  private int storeRoundTrip(LiveGateway.LiveSession session, Browser browser) {
    session.receive("{\"type\":\"get-objects\",\"queryId\":\"round-trip\",\"ids\":[\"" + inView + "\"]}");
    int snapshots = 0;
    for (JsonNode message = browser.received.next(); !"objects".equals(message.get("type").asString()); message = browser.received.next()) {
      snapshots += "snapshot-begin".equals(message.get("type").asString()) ? 1 : 0;
    }
    return snapshots;
  }

  // ---- Changes and counts --------------------------------------------------------------------------

  @Test
  void aChangeGoesOnlyToSubscriptionsOfItsWorkspaceButEveryOneIsBroughtUpToIt() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser, WATCHER);
    subscribe(session, browser, "view", "");
    subscribe(session, browser, "sim", ",\"workspaces\":[\"simulator.simulation\"]");
    subscribe(session, browser, "counts", ",\"objects\":false,\"workspaces\":[\"*\"]");

    applied(ChangeRequest.update(UUID.randomUUID(), inSim, 1L, symbol(sim, 15.8, 60.3), Actor.plugin("simulator")));
    applied(ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), symbol(sim, 15.9, 60.4), Actor.plugin("simulator")));
    advance();

    JsonNode toView = browser.next("changes");
    assertThat(toView.get("subscription").asString()).isEqualTo("view");
    assertThat(toView.get("events")).as("Simulation's changes are not View's").isEmpty();
    assertThat(toView.get("sequenceNo").asLong()).as("judged up to the last change all the same").isEqualTo(6);
    JsonNode toSim = browser.next("changes");
    assertThat(toSim.get("subscription").asString()).isEqualTo("sim");
    assertThat(toSim.get("events")).hasSize(2);
    JsonNode toCounts = browser.next("changes");
    assertThat(toCounts.get("subscription").asString()).isEqualTo("counts");
    JsonNode counts = browser.next("counts");
    assertThat(counts.get("counts").get(sim.toString()).asInt()).isEqualTo(2);
    assertThat(counts.get("counts").get(view.toString()).asInt()).isEqualTo(1);
  }

  @Test
  void aCountsSubscriptionOfViewIsNotToldOfSimulationsObjects() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser, WATCHER);
    Snapshot counts = subscribe(session, browser, "counts", ",\"objects\":false");
    assertThat(counts.begin().get("objectCounts").properties()).extracting(java.util.Map.Entry::getKey).containsExactly(view.toString());

    applied(ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), symbol(sim, 15.9, 60.4), Actor.plugin("simulator")));
    applied(ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), layer("Exercise 2", SIMULATION), Actor.plugin("simulator")));
    advance();

    JsonNode changes = browser.next("changes");
    assertThat(changes.get("events")).as("not even Simulation's new layer").isEmpty();
    session.receive("{\"type\":\"marker\"}");
    assertThat(browser.next("error").get("message").asString()).as("no counts message: nothing it counts changed").contains("marker");
  }

  // ---- Queries -------------------------------------------------------------------------------------

  @Test
  void queriesAnswerOnlyWhatTheUserMaySeeAsIfTheRestDidNotExist() {
    Browser editor = new Browser();
    LiveGateway.LiveSession session = open(editor, EDITOR);
    Browser watcher = new Browser();
    LiveGateway.LiveSession other = open(watcher, WATCHER);

    session.receive("{\"type\":\"get-objects\",\"queryId\":\"q1\",\"ids\":[\"" + inSim + "\",\"" + inView + "\"]}");
    JsonNode found = editor.next("objects");
    session.receive("{\"type\":\"query-layer\",\"queryId\":\"q2\",\"layerId\":\"" + sim + "\",\"page\":0,\"pageSize\":10}");
    JsonNode noLayer = editor.next("query-failed");
    other.receive("{\"type\":\"query-layer\",\"queryId\":\"q3\",\"layerId\":\"" + sim + "\",\"page\":0,\"pageSize\":10}");
    JsonNode page = watcher.next("layer-page");

    assertThat(found.get("found")).singleElement().satisfies(o -> assertThat(o.get("id").asString()).isEqualTo(inView.toString()));
    assertThat(found.get("missing")).singleElement().satisfies(id -> assertThat(id.asString()).isEqualTo(inSim.toString()));
    assertThat(noLayer.get("problem").asString()).isEqualTo("no-layer");
    assertThat(page.get("total").asInt()).isEqualTo(1);
  }

  // ---- The session's first permission check --------------------------------------------------------

  private static JsonNode submit(LiveGateway.LiveSession session, Browser browser, ChangeRequest request) {
    session.receive("{\"type\":\"change-request\",\"request\":" + JSON.write(request) + "}");
    return browser.next("change-outcome");
  }

  @Test
  void aWorkspacesEditPermissionPassesTheSessionAndTheStoreDecidesExactly() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser, SIMULATOR);

    JsonNode inSimulation = submit(session, browser, ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), symbol(sim, 16, 60), CLAIMED));
    JsonNode inViewRefused = submit(session, browser, ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), symbol(view, 16, 60), CLAIMED));
    JsonNode layerInSim = submit(session, browser, ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), layer("Mine", SIMULATION), CLAIMED));
    JsonNode layerInView = submit(session, browser, ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), layer("Mine", null), CLAIMED));

    assertThat(inSimulation.get("outcome").asString()).isEqualTo("applied");
    assertThat(inViewRefused.at("/rejection/message").asString()).as("by the store").isEqualTo("changing an object needs the permission objects.edit");
    assertThat(layerInSim.get("outcome").asString()).isEqualTo("applied");
    assertThat(layerInView.at("/rejection/message").asString()).as("a layer create is checked exactly at once")
        .isEqualTo("changing a layer needs the permission layers.edit");
  }

  @Test
  void aUserWithNoPermissionThatCouldAllowTheChangeIsRefusedByTheSession() {
    Browser watcher = new Browser();
    LiveGateway.LiveSession session = open(watcher, WATCHER);
    Browser editor = new Browser();
    LiveGateway.LiveSession other = open(editor, EDITOR);

    JsonNode object = submit(session, watcher, ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), symbol(sim, 16, 60), CLAIMED));
    JsonNode simLayer = submit(session, watcher, ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), layer("Mine", SIMULATION), CLAIMED));
    JsonNode layer = submit(other, editor, ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), layer("Mine", SIMULATION), CLAIMED));
    JsonNode objectInSim = submit(other, editor, ChangeRequest.update(UUID.randomUUID(), inSim, 1L, symbol(sim, 16, 60), CLAIMED));

    assertThat(object.at("/rejection/code").asString()).isEqualTo("PERMISSION_DENIED");
    assertThat(object.at("/rejection/message").asString()).isEqualTo("changing an object needs the permission objects.edit");
    assertThat(simLayer.at("/rejection/message").asString()).as("it sees Simulation: checked exactly at once")
        .isEqualTo("changing a layer in the workspace simulator.simulation needs the permission plugin.simulator.edit");
    assertThat(layer.at("/rejection/code").asString()).as("it may not see Simulation: as one nobody declares").isEqualTo("VALIDATION_FAILED");
    assertThat(layer.at("/rejection/message").asString()).isEqualTo("no loaded plugin declares the workspace simulator.simulation (ADR-0039)");
    assertThat(objectInSim.at("/rejection/code").asString()).as("passes the session (objects.edit); for the store it does not exist")
        .isEqualTo("ENTITY_NOT_FOUND");
  }

  @Test
  void aLayerCreateWhoseWorkspaceIsNotAStringIsLeftToTheSchema() {
    Browser editor = new Browser();
    LiveGateway.LiveSession session = open(editor, EDITOR);
    UUID requestId = UUID.randomUUID();

    session.receive("{\"type\":\"change-request\",\"request\":{\"requestId\":\"" + requestId + "\",\"entityType\":\"layer\","
        + "\"operation\":\"create\",\"entityId\":\"" + UUID.randomUUID() + "\",\"data\":{\"name\":\"Mine\",\"drawOrder\":0,"
        + "\"visible\":true,\"label\":{\"policy\":\"NATO\",\"classification\":\"UNCLASSIFIED\"},\"workspace\":5},"
        + "\"source\":{\"plugin\":\"layer-panel\"}}}");
    JsonNode outcome = editor.next("change-outcome");

    assertThat(outcome.at("/rejection/code").asString()).isEqualTo("VALIDATION_FAILED");
  }
}
