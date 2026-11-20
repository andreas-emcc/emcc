package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.Permissions;
import dev.emcc.sdk.User;
import dev.emcc.sdk.Workspace;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.ObjectQuery;
import dev.emcc.sdk.store.StoreUpdate;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.util.ArrayList;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** SDK 1.2.0 (CR-0025 part 5): the fake store's workspace rules, R1 and R2. */
class FakeStoreWorkspacesTest {

  private static final Workspace SIM = new Workspace("simulator.simulation", "Simulation", "plugin.simulator.view", "plugin.simulator.edit", 100);
  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final Actor PANEL = Actor.plugin("layer-panel");

  private final FakePluginContext ctx = FakePluginContext.builder("layer-panel").workspaces(SIM).build();

  private Layer layer(String name, String workspace) {
    var outcome = ctx.store().applyAs(PANEL, Change.createLayer(UUID.randomUUID(), new LayerContent(name, 1, true, LABEL, Extensions.empty(), workspace)));
    return (Layer) ((ChangeOutcome.Applied) outcome).event().state();
  }

  private MapObject object(Layer layer) {
    // lon differs from lat, so a swapped order would show
    var content = new MapObjectContent("core.shape", MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, layer.id(),
        new Geometry.Point(Position.of(18.0723, 59.3311)), null, null, null, LABEL, Extensions.empty());
    var outcome = ctx.store().applyAs(PANEL, Change.createObject(UUID.randomUUID(), content));
    return (MapObject) ((ChangeOutcome.Applied) outcome).event().state();
  }

  private static ChangeRejection rejected(ChangeOutcome outcome) {
    return ((ChangeOutcome.Rejected) outcome).rejection();
  }

  @Test
  void viewIsKeptAsAbsentAndAWorkspaceIsSetOnCreate() {
    assertThat(ctx.workspaces()).extracting(Workspace::id).containsExactly(Workspace.VIEW, SIM.id());
    assertThat(layer("Own", Workspace.VIEW).content().workspace()).as("core.view kept as absent (R2)").isNull();
    assertThat(layer("Red", SIM.id()).content().workspace()).isEqualTo(SIM.id());
    var unknown = ctx.store().applyAs(PANEL, Change.createLayer(UUID.randomUUID(), new LayerContent("X", 1, true, LABEL, Extensions.empty(), "replay.replay")));
    assertThat(rejected(unknown).details().getFirst().path()).isEqualTo("/data/workspace");
  }

  @Test
  void anAbsentWorkspaceOnUpdateKeepsTheStoredOneAndAnotherIsRejected() {
    Layer red = layer("Red", SIM.id());
    var renamed = ctx.store().applyAs(PANEL, Change.updateLayer(red, new LayerContent("Red forces", 1, true, LABEL, Extensions.empty())));
    assertThat(((Layer) ((ChangeOutcome.Applied) renamed).event().state()).content().workspace()).as("a 1.1.0 rename keeps it").isEqualTo(SIM.id());
    Layer now = ctx.store().layers().stream().filter(l -> l.id().equals(red.id())).findFirst().orElseThrow();
    var moved = ctx.store().applyAs(PANEL, Change.updateLayer(now, now.content().inWorkspace(Workspace.VIEW)));
    assertThat(rejected(moved).code()).isEqualTo(ChangeRejection.Code.VALIDATION_FAILED);
    assertThat(rejected(moved).details().getFirst().path()).isEqualTo("/data/workspace");
    Layer own = layer("Own", null);
    var explicitView = ctx.store().applyAs(PANEL, Change.updateLayer(own, own.content().inWorkspace(Workspace.VIEW)));
    assertThat(explicitView).as("core.view equals the stored absent").isInstanceOf(ChangeOutcome.Applied.class);
  }

  @Test
  void aViewLayerCannotBeMovedIntoAWorkspaceEither() {
    Layer own = layer("Own", null);
    var moved = ctx.store().applyAs(PANEL, Change.updateLayer(own, own.content().inWorkspace(SIM.id())));
    assertThat(rejected(moved).details().getFirst().path()).isEqualTo("/data/workspace");
  }

  @Test
  void aUserWithoutPermissionIsRefusedFirstEvenForAnUnknownLayer() {
    User reader = User.of("u3", "Reader", Set.of());
    var content = new MapObjectContent("core.shape", MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, UUID.randomUUID(),
        new Geometry.Point(Position.of(18.0723, 59.3311)), null, null, null, LABEL, Extensions.empty());
    var outcome = ctx.store().applyAs(PANEL, reader, Change.createObject(UUID.randomUUID(), content));
    assertThat(rejected(outcome).code()).as("PERMISSION_DENIED before LAYER_NOT_FOUND (overview 4.4)").isEqualTo(ChangeRejection.Code.PERMISSION_DENIED);
    assertThat(rejected(outcome).message()).contains(Permissions.OBJECTS_EDIT);
  }

  @Test
  void aWorkspaceIdIsDeclaredOnce() {
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> FakePluginContext.builder("x").workspaces(SIM, SIM)).hasMessageContaining("twice");
  }

  @Test
  void anObjectStaysInItsWorkspace() {
    Layer own = layer("Own", null);
    Layer other = layer("Other", null);
    Layer red = layer("Red", SIM.id());
    MapObject o = object(own);
    var toRed = ctx.store().applyAs(PANEL, Change.updateObject(o, withLayer(o, red)));
    assertThat(rejected(toRed).details().getFirst().path()).isEqualTo("/data/layerId");
    assertThat(rejected(toRed).details().getFirst().problem()).contains("stays in its workspace");
    assertThat(ctx.store().applyAs(PANEL, Change.updateObject(o, withLayer(o, other)))).as("within View").isInstanceOf(ChangeOutcome.Applied.class);
  }

  private static MapObjectContent withLayer(MapObject o, Layer layer) {
    var c = o.content();
    return new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), layer.id(), c.geometry(), c.symbol(), c.style(), c.properties(), c.label(), c.extensions());
  }

  @Test
  void queriesAndSubscriptionsFilterByWorkspace() {
    Layer own = layer("Own", null);
    Layer red = layer("Red", SIM.id());
    MapObject inView = object(own);
    object(red);
    var updates = new ArrayList<StoreUpdate>();
    record Got(StoreUpdate update) implements Message {}
    WorkerRef<Message> w = ctx.workers().spawn(WorkerSpec.of("w", Message.class, () -> (m, c) -> {
      if (m instanceof Got g) {
        updates.add(g.update());
      }
    }));
    ctx.store().subscribe(ObjectQuery.all().inWorkspaces(Workspace.VIEW), w, Got::new);
    ctx.runUntilIdle();
    assertThat(updates.getFirst()).isInstanceOfSatisfying(StoreUpdate.Snapshot.class, s -> {
      assertThat(s.objects()).containsExactly(inView);
      assertThat(s.layers()).extracting(Layer::id).containsExactly(own.id());
    });
    layer("Red 2", SIM.id());
    object(red);
    ctx.runUntilIdle();
    assertThat(updates).as("nothing from Simulation").hasSize(1);
  }

  @Test
  void aUsersChangeNeedsTheWorkspacesEditPermission() {
    Layer own = layer("Own", null);
    Layer red = layer("Red", SIM.id());
    User viewEditor = User.of("u1", "View editor", Set.of(Permissions.OBJECTS_EDIT, Permissions.LAYERS_EDIT));
    User simEditor = User.of("u2", "Sim editor", Set.of("plugin.simulator.edit"));
    var content = new MapObjectContent("core.shape", MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, red.id(),
        new Geometry.Point(Position.of(18.0723, 59.3311)), null, null, null, LABEL, Extensions.empty());
    var denied = ctx.store().applyAs(PANEL, viewEditor, Change.createObject(UUID.randomUUID(), content));
    assertThat(rejected(denied).code()).isEqualTo(ChangeRejection.Code.PERMISSION_DENIED);
    assertThat(rejected(denied).message()).contains("plugin.simulator.edit");
    assertThat(ctx.store().applyAs(PANEL, simEditor, Change.createObject(UUID.randomUUID(), content))).isInstanceOf(ChangeOutcome.Applied.class);
    var renameOwn = ctx.store().applyAs(PANEL, simEditor, Change.updateLayer(own, new LayerContent("Mine", 1, true, LABEL, Extensions.empty())));
    assertThat(rejected(renameOwn).message()).as("View's layers need layers.edit").contains(Permissions.LAYERS_EDIT);
    assertThat(ctx.store().applyAs(PANEL, viewEditor, Change.updateLayer(own, new LayerContent("Mine", 1, true, LABEL, Extensions.empty()))))
        .isInstanceOf(ChangeOutcome.Applied.class);
    var newSimLayer = ctx.store().applyAs(PANEL, viewEditor, Change.createLayer(UUID.randomUUID(), new LayerContent("X", 1, true, LABEL, Extensions.empty(), SIM.id())));
    assertThat(rejected(newSimLayer).code()).as("creating a layer in a workspace needs its edit permission").isEqualTo(ChangeRejection.Code.PERMISSION_DENIED);
  }
}
