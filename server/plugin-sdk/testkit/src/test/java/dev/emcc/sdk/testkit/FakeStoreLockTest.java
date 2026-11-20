package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Permissions;
import dev.emcc.sdk.User;
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
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** SDK 1.3.0 (CR-0028 part 2, ADR-0042): the fake store's layer lock, as ECore keeps it. */
class FakeStoreLockTest {

  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final Actor PANEL = Actor.plugin("layer-panel");
  private static final User EDITOR = User.of("u1", "Editor", Set.of(Permissions.OBJECTS_EDIT, Permissions.LAYERS_EDIT));

  private final FakePluginContext ctx = FakePluginContext.builder("layer-panel").build();

  private Layer layer(String name, @org.jspecify.annotations.Nullable Boolean locked) {
    return (Layer) applied(ctx.store().applyAs(PANEL, Change.createLayer(UUID.randomUUID(), new LayerContent(name, 1, true, LABEL, Extensions.empty(), null, locked))));
  }

  private static MapObjectContent content(Layer layer, String dataType) {
    // lon differs from lat, so a swapped order would show
    return new MapObjectContent("core.shape", dataType, MapObjectContent.MANUAL, null, layer.id(),
        new Geometry.Point(Position.of(18.0723, 59.3311)), null, null, null, LABEL, Extensions.empty());
  }

  private MapObject object(Layer layer) {
    return (MapObject) applied(ctx.store().applyAs(PANEL, Change.createObject(UUID.randomUUID(), content(layer, MapObjectContent.GENERAL))));
  }

  private Layer stored(Layer layer) {
    return ctx.store().layers().stream().filter(l -> l.id().equals(layer.id())).findFirst().orElseThrow();
  }

  private static Object applied(ChangeOutcome outcome) {
    assertThat(outcome).isInstanceOf(ChangeOutcome.Applied.class);
    return java.util.Objects.requireNonNull(((ChangeOutcome.Applied) outcome).event().state());
  }

  private static ChangeRejection rejected(ChangeOutcome outcome) {
    assertThat(outcome).isInstanceOf(ChangeOutcome.Rejected.class);
    return ((ChangeOutcome.Rejected) outcome).rejection();
  }

  private static void assertLocked(ChangeOutcome outcome, Layer layer, String path) {
    ChangeRejection r = rejected(outcome);
    assertThat(r.code()).isEqualTo(ChangeRejection.Code.LAYER_LOCKED);
    assertThat(r.details()).singleElement().satisfies(d -> {
      assertThat(d.path()).isEqualTo(path);
      assertThat(d.problem()).isEqualTo("layer " + layer.id() + " is locked");
    });
  }

  @Test
  void falseIsKeptAsAbsentAndAnAbsentLockOnUpdateKeepsTheStoredValue() {
    assertThat(layer("Open", false).content().locked()).as("false kept as absent").isNull();
    Layer planned = layer("Planned", true);
    assertThat(planned.content().isLocked()).isTrue();
    var renamed = (Layer) applied(ctx.store().applyAs(PANEL, Change.updateLayer(planned, new LayerContent("Planned 2", 1, true, LABEL, Extensions.empty(), null))));
    assertThat(renamed.content().locked()).as("a 1.2.0 writer keeps the lock").isTrue();
    var unlocked = (Layer) applied(ctx.store().applyAs(PANEL, Change.updateLayer(renamed, renamed.content().withLocked(false))));
    assertThat(unlocked.content().locked()).as("false clears it, kept as absent").isNull();
    assertThat(unlocked.content().isLocked()).isFalse();
  }

  @Test
  void aUsersChangeToALockedLayersObjectsIsRefusedAndNamesTheLayer() {
    Layer open = layer("Open", null);
    Layer locked = layer("Planned", null);
    MapObject inLocked = object(locked);
    MapObject inOpen = object(open);
    applied(ctx.store().applyAs(PANEL, Change.updateLayer(locked, locked.content().withLocked(true))));
    long before = ctx.store().sequenceNo();

    assertLocked(ctx.store().applyAs(PANEL, EDITOR, Change.createObject(UUID.randomUUID(), content(locked, MapObjectContent.GENERAL))), locked, "/data/layerId");
    assertLocked(ctx.store().applyAs(PANEL, EDITOR, Change.updateObject(inLocked, inLocked.content())), locked, "/data/layerId");
    assertLocked(ctx.store().applyAs(PANEL, EDITOR, Change.updateObject(inOpen, content(locked, MapObjectContent.GENERAL))), locked, "/data/layerId");
    assertLocked(ctx.store().applyAs(PANEL, EDITOR, Change.updateObject(inLocked, content(open, MapObjectContent.GENERAL))), locked, "");
    assertLocked(ctx.store().applyAs(PANEL, EDITOR, Change.deleteObject(inLocked)), locked, "");

    assertThat(ctx.store().sequenceNo()).as("nothing changed, no event").isEqualTo(before);
    assertThat(ctx.store().objects()).containsExactlyInAnyOrder(inLocked, inOpen);
    assertThat(ctx.store().applyAs(PANEL, EDITOR, Change.updateObject(inOpen, inOpen.content()))).as("another layer").isInstanceOf(ChangeOutcome.Applied.class);
  }

  @Test
  void aLockedLayerTakesOnlyItsLockAndItsDrawOrderFromAUser() {
    Layer planned = layer("Planned", true);
    object(planned);
    var reordered = (Layer) applied(ctx.store().applyAs(PANEL, EDITOR, Change.updateLayer(planned, new LayerContent("Planned", 7.5, true, LABEL, Extensions.empty(), null))));
    assertThat(reordered.content().drawOrder()).isEqualTo(7.5);
    assertThat(reordered.content().isLocked()).as("an absent lock is kept").isTrue();
    assertLocked(ctx.store().applyAs(PANEL, EDITOR, Change.updateLayer(reordered, new LayerContent("Renamed", 7.5, true, LABEL, Extensions.empty(), null))), planned, "");
    assertLocked(ctx.store().applyAs(PANEL, EDITOR, Change.updateLayer(reordered, new LayerContent("Planned", 7.5, false, LABEL, Extensions.empty(), null))), planned, "");
    assertLocked(ctx.store().applyAs(PANEL, EDITOR, Change.updateLayer(reordered, reordered.content().withLocked(false).inWorkspace("x.y"))), planned, "");
    var renamedAndUnlocked = ctx.store().applyAs(PANEL, EDITOR, Change.updateLayer(reordered, new LayerContent("Renamed", 7.5, true, LABEL, Extensions.empty(), null, false)));
    assertLocked(renamedAndUnlocked, planned, "");
    var unlocked = (Layer) applied(ctx.store().applyAs(PANEL, EDITOR, Change.updateLayer(reordered, reordered.content().withLocked(false))));
    assertThat(applied(ctx.store().applyAs(PANEL, EDITOR, Change.updateLayer(unlocked, new LayerContent("Renamed", 7.5, true, LABEL, Extensions.empty(), null)))))
        .as("unlocked, a rename passes").isNotNull();
  }

  @Test
  void theLockComesAfterThePermissionAndTheNotFoundAnswersAndBeforeTheRules() {
    Layer planned = layer("Planned", true);
    object(planned);
    User reader = User.of("u2", "Reader", Set.of());
    assertThat(rejected(ctx.store().applyAs(PANEL, reader, Change.deleteLayer(planned))).code()).isEqualTo(ChangeRejection.Code.PERMISSION_DENIED);
    var badType = ctx.store().applyAs(PANEL, EDITOR, Change.createObject(UUID.randomUUID(), content(planned, "nobody.unknown")));
    assertLocked(badType, planned, "/data/layerId");
    assertLocked(ctx.store().applyAs(PANEL, EDITOR, Change.deleteLayer(planned)), planned, "");
    Layer gone = layer("Gone", null);
    assertThat(ctx.store().applyAs(PANEL, Change.deleteLayer(gone))).isInstanceOf(ChangeOutcome.Applied.class);
    var unknownLayer = ctx.store().applyAs(PANEL, EDITOR, Change.createObject(UUID.randomUUID(), content(gone, MapObjectContent.GENERAL)));
    assertThat(rejected(unknownLayer).code()).isEqualTo(ChangeRejection.Code.LAYER_NOT_FOUND);
  }

  @Test
  void aUserMayCreateALockedLayer() {
    var created = (Layer) applied(ctx.store().applyAs(PANEL, EDITOR, Change.createLayer(UUID.randomUUID(), new LayerContent("Planned", 1, true, LABEL, Extensions.empty(), null, true))));
    assertThat(created.content().isLocked()).as("no lock check on a create (N3)").isTrue();
  }

  @Test
  void serverPartsPassTheLock() {
    Layer planned = layer("Planned", true);
    MapObject o = object(planned);
    applied(ctx.store().applyAs(Actor.plugin("cot"), Change.updateObject(o, o.content())));
    applied(ctx.store().applyAs(PANEL, Change.updateLayer(planned, new LayerContent("Renamed by a server part", 1, true, LABEL, Extensions.empty(), null))));
    assertThat(ctx.store().applyAs(Actor.plugin("cot"), Change.deleteObject(java.util.Objects.requireNonNull(ctx.store().object(o.id()))))).isInstanceOf(ChangeOutcome.Applied.class);
    assertThat(stored(planned).content().isLocked()).isTrue();
  }
}
