package dev.emcc.ecore.store;

import static dev.emcc.ecore.store.Fixtures.DRAW;
import static dev.emcc.ecore.store.Fixtures.EDITOR;
import static dev.emcc.ecore.store.Fixtures.LAYERS;
import static dev.emcc.ecore.store.Fixtures.create;
import static dev.emcc.ecore.store.Fixtures.delete;
import static dev.emcc.ecore.store.Fixtures.layer;
import static dev.emcc.ecore.store.Fixtures.symbol;
import static dev.emcc.ecore.store.Fixtures.update;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * The object store's workspaces (ADR-0039, data model 1.2.0 R1 and R2; T-080): the rules of a
 * layer's {@code workspace}, the edit permission per workspace, the reads filtered by workspace, and
 * the workspace of each published change.
 */
class WorkspacesStoreTest {

  private static final Instant NOW = Instant.parse("2026-10-27T10:00:00.123Z");
  private static final String SIMULATION = "simulator.simulation";
  private static final String VIEW_SIM = "plugin.simulator.view";
  private static final String EDIT_SIM = "plugin.simulator.edit";
  private static final Workspaces DECLARED = Workspaces.of(List.of(new Workspaces.Declared(SIMULATION, VIEW_SIM, EDIT_SIM)));

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final PictureState state = new PictureState();
  private final ObjectStore store = store(DECLARED);
  private final UUID view = UUID.randomUUID();
  private final UUID sim = UUID.randomUUID();
  private final UUID otherSim = UUID.randomUUID();

  @AfterEach
  void close() {
    runtime.close();
  }

  private ObjectStore store(Workspaces workspaces) {
    return new ObjectStore(state, runtime, Clock.fixed(NOW, ZoneOffset.UTC), DataTypes.of(Set.of()), new DeclaredFields(), workspaces,
        new StoreCounts());
  }

  private ChangeEvent applied(ChangeRequest request) {
    return applied(request, Requester.NO_USER);
  }

  private ChangeEvent applied(ChangeRequest request, Requester requester) {
    ChangeOutcome outcome = store.apply(request, requester);
    assertThat(outcome).as(request.operation() + " " + request.entityType()).isInstanceOf(ChangeOutcome.Applied.class);
    return ((ChangeOutcome.Applied) outcome).event();
  }

  private ChangeRejection rejected(ChangeRequest request, Requester requester) {
    long before = state.sequenceNo();
    ChangeOutcome outcome = store.apply(request, requester);
    assertThat(outcome).as(request.operation() + " " + request.entityType()).isInstanceOf(ChangeOutcome.Rejected.class);
    assertThat(state.sequenceNo()).as("nothing changed").isEqualTo(before);
    return ((ChangeOutcome.Rejected) outcome).rejection();
  }

  /** View's layer, two of Simulation's, and an object in View's and in Simulation's. */
  private void picture(UUID inView, UUID inSim) {
    applied(create(view, layer("Units"), LAYERS));
    applied(create(sim, layer("Exercise").inWorkspace(SIMULATION), LAYERS));
    applied(create(otherSim, layer("Targets").inWorkspace(SIMULATION), LAYERS));
    applied(create(inView, symbol(view, 15.6, 60.1), DRAW));
    applied(create(inSim, symbol(sim, 16.2, 59.4), DRAW));
  }

  // ---- A layer's workspace (R2) and an object's (R1) ----------------------------------------------

  @Test
  void aLayerKeepsTheWorkspaceItWasMadeInAndAnUpdateWithoutOneKeepsItThere() {
    applied(create(sim, layer("Exercise").inWorkspace(SIMULATION), LAYERS));

    Layer renamed = (Layer) applied(update(sim, 1, layer("Exercise 2"), LAYERS)).state();

    assertThat(renamed.content().workspace()).as("the ACA's C1: absent keeps the stored one").isEqualTo(SIMULATION);
    assertThat(state.layer(sim).content().workspace()).isEqualTo(SIMULATION);
    assertThat(((Layer) applied(update(sim, 2, layer("Exercise 3").inWorkspace(SIMULATION), LAYERS)).state()).content().workspace())
        .as("the same one named").isEqualTo(SIMULATION);
  }

  @Test
  void aLayerNeverMovesToAnotherWorkspaceNotEvenByNamingView() {
    applied(create(view, layer("Units"), LAYERS));
    applied(create(sim, layer("Exercise").inWorkspace(SIMULATION), LAYERS));

    ChangeRejection toView = rejected(update(sim, 1, layer("Exercise").inWorkspace("core.view"), LAYERS), Requester.NO_USER);
    ChangeRejection toSim = rejected(update(view, 1, layer("Units").inWorkspace(SIMULATION), LAYERS), Requester.NO_USER);

    assertThat(toView.code()).isEqualTo(ChangeRejection.Code.VALIDATION_FAILED);
    assertThat(toView.details()).singleElement().satisfies(d -> {
      assertThat(d.path()).isEqualTo("/data/workspace");
      assertThat(d.problem()).isEqualTo("a layer stays in its workspace: simulator.simulation, not core.view (ADR-0039, data model R2)");
    });
    assertThat(toSim.details()).singleElement().satisfies(d -> assertThat(d.path()).isEqualTo("/data/workspace"));
    assertThat(state.layer(sim).content().workspace()).isEqualTo(SIMULATION);
    assertThat(state.layer(view).content().workspace()).isNull();
  }

  @Test
  void aLayerInAWorkspaceNoLoadedPluginDeclaresIsRefused() {
    ChangeRejection rejection = rejected(create(sim, layer("Old").inWorkspace("replay.replay"), LAYERS), Requester.NO_USER);

    assertThat(rejection.code()).isEqualTo(ChangeRejection.Code.VALIDATION_FAILED);
    assertThat(rejection.message()).isEqualTo("no loaded plugin declares the workspace replay.replay (ADR-0039)");
  }

  @Test
  void anObjectMovesBetweenLayersOfItsWorkspaceButNeverToAnothersLayer() {
    UUID inView = UUID.randomUUID();
    UUID inSim = UUID.randomUUID();
    picture(inView, inSim);

    applied(update(inSim, 1, symbol(otherSim, 16.2, 59.4), DRAW));
    ChangeRejection out = rejected(update(inSim, 2, symbol(view, 16.2, 59.4), DRAW), Requester.NO_USER);
    ChangeRejection in = rejected(update(inView, 1, symbol(sim, 15.6, 60.1), DRAW), Requester.NO_USER);

    assertThat(out.code()).isEqualTo(ChangeRejection.Code.VALIDATION_FAILED);
    assertThat(out.details()).singleElement().satisfies(d -> {
      assertThat(d.path()).isEqualTo("/data/layerId");
      assertThat(d.problem()).isEqualTo("an object stays in its workspace: simulator.simulation, not core.view (ADR-0039, data model R1)");
    });
    assertThat(in.details()).singleElement().satisfies(d -> assertThat(d.path()).isEqualTo("/data/layerId"));
    assertThat(state.object(inSim).content().layerId()).isEqualTo(otherSim);
  }

  // ---- The edit permission per workspace (point 7) -------------------------------------------------

  @Test
  void aChangeInADeclaredWorkspaceNeedsItsEditPermissionInsteadOfViews() {
    UUID inView = UUID.randomUUID();
    UUID inSim = UUID.randomUUID();
    picture(inView, inSim);
    Requester watcher = Requester.user("u-watch", Set.of(VIEW_SIM, "objects.edit", "layers.edit"));
    Requester simulator = Requester.user("u-sim", Set.of(VIEW_SIM, EDIT_SIM));

    ChangeRejection notHere = rejected(create(UUID.randomUUID(), symbol(sim, 16, 59), EDITOR), watcher);
    assertThat(notHere.code()).isEqualTo(ChangeRejection.Code.PERMISSION_DENIED);
    assertThat(notHere.message()).isEqualTo("changing an object in the workspace simulator.simulation needs the permission plugin.simulator.edit");
    assertThat(rejected(update(inSim, 1, symbol(sim, 16, 59), EDITOR), watcher).code()).isEqualTo(ChangeRejection.Code.PERMISSION_DENIED);
    assertThat(rejected(delete(inSim, EntityType.OBJECT, EDITOR), watcher).code()).isEqualTo(ChangeRejection.Code.PERMISSION_DENIED);
    assertThat(rejected(create(UUID.randomUUID(), layer("Mine").inWorkspace(SIMULATION), EDITOR), watcher).message())
        .isEqualTo("changing a layer in the workspace simulator.simulation needs the permission plugin.simulator.edit");
    assertThat(rejected(update(sim, 1, layer("Renamed"), EDITOR), watcher).code())
        .as("the stored layer's workspace, though the update names none").isEqualTo(ChangeRejection.Code.PERMISSION_DENIED);

    ChangeRejection notThere = rejected(create(UUID.randomUUID(), symbol(view, 15, 60), EDITOR), simulator);
    assertThat(notThere.message()).isEqualTo("changing an object needs the permission objects.edit");
    assertThat(rejected(create(UUID.randomUUID(), layer("Units 2"), EDITOR), simulator).message())
        .isEqualTo("changing a layer needs the permission layers.edit");

    applied(create(UUID.randomUUID(), symbol(sim, 16, 59), EDITOR), simulator);
    applied(update(inSim, 1, symbol(sim, 16.5, 59.5), EDITOR), simulator);
    applied(create(UUID.randomUUID(), layer("Mine").inWorkspace(SIMULATION), EDITOR), simulator);
    applied(update(otherSim, 1, layer("Targets 2"), EDITOR), simulator);
    applied(delete(inSim, EntityType.OBJECT, EDITOR), simulator);
    applied(create(UUID.randomUUID(), symbol(view, 15, 60), EDITOR), Requester.user("u-edit", Set.of("objects.edit")));
    applied(create(UUID.randomUUID(), symbol(sim, 16, 59), EDITOR), Requester.withAllPermissions("local"));
  }

  @Test
  void forAUserWhatIsInAWorkspaceItMayNotSeeDoesNotExistNotEvenWithItsEditPermission() {
    UUID inView = UUID.randomUUID();
    UUID inSim = UUID.randomUUID();
    picture(inView, inSim);
    Requester editor = Requester.user("u-edit", Set.of("objects.edit", "layers.edit"));
    Requester editOnly = Requester.user("u-blind", Set.of(EDIT_SIM, "objects.edit"));

    // Owner, 2026-10-27 (the conformance review's findings 1 to 3): the answers of a missing one, before the permission.
    for (Requester user : List.of(editor, editOnly)) {
      assertThat(rejected(update(inSim, 1, symbol(sim, 16, 59), EDITOR), user).message()).isEqualTo("no object with id " + inSim);
      assertThat(rejected(delete(inSim, EntityType.OBJECT, EDITOR), user).code()).isEqualTo(ChangeRejection.Code.ENTITY_NOT_FOUND);
      assertThat(rejected(update(sim, 1, layer("Renamed"), EDITOR), user).message()).isEqualTo("no layer with id " + sim);
      ChangeRejection into = rejected(create(UUID.randomUUID(), symbol(sim, 16, 59), EDITOR), user);
      assertThat(into.code()).isEqualTo(ChangeRejection.Code.LAYER_NOT_FOUND);
      assertThat(into.message()).isEqualTo("no layer with id " + sim);
      ChangeRejection moved = rejected(update(inView, 1, symbol(sim, 15.6, 60.1), EDITOR), user);
      assertThat(moved.code()).as("finding 2: no word of the other workspace").isEqualTo(ChangeRejection.Code.LAYER_NOT_FOUND);
      assertThat(moved.message()).doesNotContain(SIMULATION);
    }
    ChangeRejection layer = rejected(create(UUID.randomUUID(), layer("Mine").inWorkspace(SIMULATION), EDITOR), editor);
    assertThat(layer.code()).as("finding 3: as one nobody declares, after View's permission").isEqualTo(ChangeRejection.Code.VALIDATION_FAILED);
    assertThat(layer.message()).isEqualTo("no loaded plugin declares the workspace simulator.simulation (ADR-0039)");
    assertThat(rejected(create(UUID.randomUUID(), layer("Old").inWorkspace("replay.replay"), EDITOR), editor).message())
        .isEqualTo("no loaded plugin declares the workspace replay.replay (ADR-0039)");
    assertThat(rejected(create(UUID.randomUUID(), layer("Mine").inWorkspace(SIMULATION), EDITOR), Requester.user("u", Set.of())).message())
        .as("View's permission first").isEqualTo("changing a layer needs the permission layers.edit");
  }

  @Test
  void aWorkspaceNoLoadedPluginDeclaresAnyMoreKeepsItsLayersButNoUserChangesThem() {
    ObjectStore before = store(Workspaces.of(List.of(new Workspaces.Declared("old.space", "plugin.old.view", "plugin.old.edit"))));
    UUID orphan = UUID.randomUUID();
    UUID inOrphan = UUID.randomUUID();
    assertThat(before.apply(create(orphan, layer("Old").inWorkspace("old.space"), LAYERS), Requester.NO_USER))
        .isInstanceOf(ChangeOutcome.Applied.class);
    assertThat(before.apply(create(inOrphan, symbol(orphan, 15, 60), DRAW), Requester.NO_USER)).isInstanceOf(ChangeOutcome.Applied.class);
    Requester all = Requester.withAllPermissions("local");

    ChangeRejection refused = rejected(update(inOrphan, 1, symbol(orphan, 15.5, 60.5), EDITOR), all);

    assertThat(refused.code()).as("nobody sees it, so for every user it does not exist").isEqualTo(ChangeRejection.Code.ENTITY_NOT_FOUND);
    assertThat(rejected(delete(orphan, EntityType.LAYER, EDITOR), all).code()).isEqualTo(ChangeRejection.Code.ENTITY_NOT_FOUND);
    applied(update(inOrphan, 1, symbol(orphan, 15.5, 60.5), DRAW)); // a plugin's server part is trusted (ADR-0003)
    applied(update(orphan, 1, layer("Old 2"), LAYERS));
    assertThat(rejected(update(orphan, 2, layer("Old 3").inWorkspace("old.space"), LAYERS), Requester.NO_USER).message())
        .as("finding 4: naming it is refused, as FakeStore does; leaving it out keeps it").isEqualTo("no loaded plugin declares the workspace old.space (ADR-0039)");
    assertThat(state.layer(orphan).content().workspace()).isEqualTo("old.space");
    assertThat(store.area(null, true, Set.of(Workspaces.VIEW, SIMULATION)).layers()).as("nobody sees it").isEmpty();
  }

  // ---- Reads by workspace --------------------------------------------------------------------------

  @Test
  void eachReadReturnsOnlyTheWorkspacesItNamesAndEveryOneWithoutAFilter() {
    UUID inView = UUID.randomUUID();
    UUID inSim = UUID.randomUUID();
    picture(inView, inSim);
    Set<String> onlyView = Set.of(Workspaces.VIEW);

    AreaSnapshot viewOnly = store.area(null, true, onlyView);
    assertThat(viewOnly.layers()).extracting(Layer::id).containsExactly(view);
    assertThat(viewOnly.objects()).extracting(MapObject::id).containsExactly(inView);
    assertThat(viewOnly.objectCounts()).containsOnlyKeys(view);
    AreaSnapshot counts = store.area(null, false, Set.of(SIMULATION));
    assertThat(counts.layers()).extracting(Layer::id).containsExactlyInAnyOrder(sim, otherSim);
    assertThat(counts.objectCounts()).containsOnlyKeys(sim, otherSim).containsEntry(sim, 1);
    AreaSnapshot all = store.area(null, true, null);
    assertThat(all.layers()).hasSize(3);
    assertThat(all.objects()).hasSize(2);

    FoundObjects found = store.objects(List.of(inSim, inView), onlyView);
    assertThat(found.found()).extracting(MapObject::id).containsExactly(inView);
    assertThat(found.missing()).as("as if it did not exist").containsExactly(inSim);
    assertThat(store.objects(List.of(inSim, inView), null).found()).hasSize(2);

    assertThat(store.layerPage(sim, 0, 10, onlyView)).as("as if it did not exist").isInstanceOf(LayerPage.NoLayer.class);
    assertThat(store.layerPage(sim, 0, 10, Set.of(SIMULATION))).isInstanceOf(LayerPage.Page.class);
    assertThat(store.layerPage(sim, 0, 10, null)).isInstanceOf(LayerPage.Page.class);
  }

  @Test
  void findWithWorkspacesReturnsTheirLayersAndObjectsOnly() throws InterruptedException {
    UUID inView = UUID.randomUUID();
    UUID inSim = UUID.randomUUID();
    picture(inView, inSim);
    LinkedBlockingQueue<PictureSnapshot> answers = new LinkedBlockingQueue<>();
    WorkerHandle<StoreMsg> worker = runtime.owner("core-store").spawn(WorkerOptions.<StoreMsg>of("store", () -> store));
    dev.emcc.ecore.runtime.ReplyHandle<PictureSnapshot> reply = new dev.emcc.ecore.runtime.ReplyHandle<>() {
      @Override
      public String id() {
        return "find";
      }

      @Override
      public void reply(PictureSnapshot value) {
        answers.add(value);
      }

      @Override
      public void fail(String reason) {
        throw new AssertionError(reason);
      }
    };

    worker.send(new StoreMsg.Find(null, o -> true, 10, Set.of(SIMULATION), reply));
    worker.send(new StoreMsg.Find(null, o -> true, 10, null, reply));

    PictureSnapshot sims = answers.poll(10, TimeUnit.SECONDS);
    assertThat(sims.objects()).extracting(MapObject::id).containsExactly(inSim);
    assertThat(sims.layers()).extracting(Layer::id).containsExactlyInAnyOrder(sim, otherSim);
    assertThat(answers.poll(10, TimeUnit.SECONDS).objects()).hasSize(2);
  }

  @Test
  void eachPublishedChangeCarriesItsWorkspace() throws InterruptedException {
    LinkedBlockingQueue<StoreChange> published = new LinkedBlockingQueue<>();
    WorkerHandle<StoreChange> listener =
        runtime.owner("core-test").spawn(WorkerOptions.<StoreChange>of("listener", () -> (c, ctx) -> published.add(c)));
    runtime.owner("core-test").subscribe(ObjectStore.CHANGES, listener, c -> c);
    UUID inView = UUID.randomUUID();
    UUID inSim = UUID.randomUUID();
    picture(inView, inSim);
    applied(delete(inSim, EntityType.OBJECT, DRAW));
    applied(delete(otherSim, EntityType.LAYER, LAYERS));

    List<String> workspaces = new java.util.ArrayList<>();
    for (int i = 0; i < 7; i++) {
      StoreChange c = published.poll(10, TimeUnit.SECONDS);
      assertThat(c).isNotNull();
      workspaces.add(c.workspace());
    }

    assertThat(workspaces).containsExactly(
        "core.view", SIMULATION, SIMULATION, "core.view", SIMULATION, SIMULATION, SIMULATION);
  }

  // ---- The holder ----------------------------------------------------------------------------------

  @Test
  void theHolderIsFixedOnceAndTellsWhoSeesAndChangesWhat() {
    Workspaces workspaces = new Workspaces();
    Requester.User simulator = Requester.user("u-sim", Set.of(VIEW_SIM));
    Requester.User editor = Requester.user("u-editor", Set.of("objects.edit"));

    assertThat(workspaces.visibleTo(simulator)).as("View only until fixed").containsExactly(Workspaces.VIEW);
    workspaces.fix(List.of(new Workspaces.Declared(SIMULATION, VIEW_SIM, EDIT_SIM)));
    assertThatThrownBy(() -> workspaces.fix(List.of())).isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> new Workspaces().fix(List.of(new Workspaces.Declared(SIMULATION, VIEW_SIM, EDIT_SIM),
        new Workspaces.Declared(SIMULATION, VIEW_SIM, EDIT_SIM)))).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Workspaces.Declared("core.view", VIEW_SIM, EDIT_SIM)).isInstanceOf(IllegalArgumentException.class);

    assertThat(workspaces.visibleTo(simulator)).containsExactlyInAnyOrder(Workspaces.VIEW, SIMULATION);
    assertThat(workspaces.visibleTo(editor)).containsExactly(Workspaces.VIEW);
    assertThat(workspaces.visibleTo(Requester.withAllPermissions("local"))).containsExactlyInAnyOrder(Workspaces.VIEW, SIMULATION);
    assertThat(workspaces.maySee(Requester.NO_USER, "old.space")).as("a server part sees everything").isTrue();
    assertThat(workspaces.maySee(Requester.withAllPermissions("local"), "old.space")).as("nobody sees an undeclared one").isFalse();
    assertThat(workspaces.editPermission(Workspaces.VIEW, EntityType.LAYER)).isEqualTo("layers.edit");
    assertThat(workspaces.editPermission(SIMULATION, EntityType.OBJECT)).isEqualTo(EDIT_SIM);
    assertThat(workspaces.editPermission("old.space", EntityType.OBJECT)).isNull();
    assertThat(workspaces.mayChangeSomewhere(Requester.user("u", Set.of(EDIT_SIM)), EntityType.OBJECT)).isTrue();
    assertThat(workspaces.mayChangeSomewhere(Requester.user("u", Set.of(VIEW_SIM)), EntityType.OBJECT)).isFalse();
  }
}
