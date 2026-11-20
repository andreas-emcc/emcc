package dev.emcc.ecore.store;

import static dev.emcc.ecore.store.Fixtures.DRAW;
import static dev.emcc.ecore.store.Fixtures.EDITOR;
import static dev.emcc.ecore.store.Fixtures.LABEL;
import static dev.emcc.ecore.store.Fixtures.LAYERS;
import static dev.emcc.ecore.store.Fixtures.create;
import static dev.emcc.ecore.store.Fixtures.delete;
import static dev.emcc.ecore.store.Fixtures.ext;
import static dev.emcc.ecore.store.Fixtures.layer;
import static dev.emcc.ecore.store.Fixtures.symbol;
import static dev.emcc.ecore.store.Fixtures.update;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The layer lock in the store (ADR-0042; CR-0028 part 2 with the ACA's R1, N2 and N3; T-098): a
 * user's change to a locked layer's content is refused with {@code LAYER_LOCKED}; a server part's
 * and ECore's pass; {@code false} is kept as absent, and an update without {@code locked} keeps it.
 */
class LayerLockTest {

  private static final Instant NOW = Instant.parse("2026-10-30T10:00:00.123Z");
  private static final Requester USER = Requester.user("u-alice", Set.of(Requester.OBJECTS_EDIT, Requester.LAYERS_EDIT));

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final PictureState state = new PictureState();
  private final ObjectStore store = new ObjectStore(state, runtime, Clock.fixed(NOW, ZoneOffset.UTC), DataTypes.of(Set.of()),
      new DeclaredFields(), Workspaces.of(List.of()), new StoreCounts());
  private final UUID locked = UUID.randomUUID();
  private final UUID open = UUID.randomUUID();
  private final UUID inLocked = UUID.randomUUID();
  private final UUID inOpen = UUID.randomUUID();

  @BeforeEach
  void picture() {
    applied(create(locked, layer("Reference").withLocked(true), LAYERS), USER);
    applied(create(open, layer("Drawing"), LAYERS), USER);
    applied(create(inLocked, symbol(locked, 15.6, 60.1), DRAW), Requester.NO_USER);
    applied(create(inOpen, symbol(open, 16.2, 59.4), DRAW), Requester.NO_USER);
  }

  @AfterEach
  void close() {
    runtime.close();
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
    assertThat(state.sequenceNo()).as("nothing changed, no event").isEqualTo(before);
    return ((ChangeOutcome.Rejected) outcome).rejection();
  }

  private void assertLocked(ChangeRejection rejection, String path) {
    assertThat(rejection.code()).isEqualTo(ChangeRejection.Code.LAYER_LOCKED);
    assertThat(rejection.message()).isEqualTo("the layer Reference is locked (ADR-0042)");
    assertThat(rejection.details()).singleElement().satisfies(d -> {
      assertThat(d.path()).as("N2").isEqualTo(path);
      assertThat(d.problem()).isEqualTo("layer " + locked + " is locked");
    });
  }

  private LayerContent stored(UUID id) {
    return state.layer(id).content();
  }

  // ---- A user's changes to the objects ------------------------------------------------------------

  @Test
  void aUserMayNotCreateUpdateOrDeleteAnObjectInALockedLayer() {
    assertLocked(rejected(create(UUID.randomUUID(), symbol(locked, 15.0, 60.0), EDITOR), USER), "/data/layerId");
    assertLocked(rejected(update(inLocked, 1, symbol(locked, 15.0, 60.0), EDITOR), USER), "/data/layerId");
    assertLocked(rejected(delete(inLocked, EntityType.OBJECT, EDITOR), USER), "");

    assertThat(state.object(inLocked).content().geometry()).isEqualTo(new Geometry.Point(Position.of(15.6, 60.1)));
  }

  @Test
  void aUserMayNotMoveAnObjectIntoOrOutOfALockedLayer() {
    assertLocked(rejected(update(inOpen, 1, symbol(locked, 16.2, 59.4), EDITOR), USER), "/data/layerId");
    assertLocked(rejected(update(inLocked, 1, symbol(open, 15.6, 60.1), EDITOR), USER), "");

    assertThat(state.object(inOpen).content().layerId()).isEqualTo(open);
    assertThat(state.object(inLocked).content().layerId()).isEqualTo(locked);
  }

  @Test
  void aUsersChangesToAnOpenLayerStillPass() {
    applied(update(inOpen, 1, symbol(open, 16.3, 59.5), EDITOR), USER);
    applied(create(UUID.randomUUID(), symbol(open, 16.0, 59.0), EDITOR), USER);
    applied(delete(inOpen, EntityType.OBJECT, EDITOR), USER);
  }

  // ---- A user's changes to the layer --------------------------------------------------------------

  @Test
  void aUserMayNotRenameRelabelHideOrDeleteALockedLayer() {
    LayerContent now = stored(locked);
    assertLocked(rejected(update(locked, 2, layer("Renamed"), LAYERS), USER), "");
    assertLocked(rejected(update(locked, 2, new LayerContent("Reference", 1.0, false, LABEL, Extensions.empty()), LAYERS), USER), "");
    assertLocked(rejected(update(locked, 2, new LayerContent("Reference", 1.0, true, SecurityLabel.of("NATO", "RESTRICTED"),
        Extensions.empty()), LAYERS), USER), "");
    assertLocked(rejected(update(locked, 2, new LayerContent("Reference", 1.0, true, LABEL, ext("layer-panel", "colour", "red")),
        LAYERS), USER), "");
    assertLocked(rejected(update(locked, 2, layer("Renamed").withLocked(true), LAYERS), USER), "");
    assertLocked(rejected(delete(locked, EntityType.LAYER, LAYERS), USER), "");

    assertThat(stored(locked)).isEqualTo(now);
  }

  @Test
  void aUserMayChangeTheDrawOrderAndUnlockAndThenEverythingPassesAgain() {
    Layer moved = (Layer) applied(update(locked, 2, new LayerContent("Reference", 7.5, true, LABEL, Extensions.empty()), LAYERS), USER)
        .state();
    assertThat(moved.content().drawOrder()).isEqualTo(7.5);
    assertThat(moved.content().locked()).as("the owner's CR: an update without locked keeps it").isTrue();

    applied(update(locked, 3, new LayerContent("Reference", 8.0, true, LABEL, Extensions.empty()).withLocked(true), LAYERS), USER);
    Layer unlocked = (Layer) applied(update(locked, 4, new LayerContent("Reference", 8.0, true, LABEL, Extensions.empty()).withLocked(false),
        LAYERS), USER).state();
    assertThat(unlocked.content().locked()).as("false is kept as absent").isNull();
    assertThat(stored(locked).locked()).isNull();

    applied(update(inLocked, 1, symbol(locked, 15.0, 60.0), EDITOR), USER);
    applied(update(locked, 5, layer("Renamed"), LAYERS), USER);
    assertThat(stored(locked).locked()).as("absent keeps it unlocked too").isNull();
  }

  @Test
  void aUserMayLockAnOpenLayerWhichThenRefusesTheirNextChange() {
    applied(update(open, 1, layer("Drawing").withLocked(true), LAYERS), USER);

    assertThat(stored(open).locked()).isTrue();
    assertThat(rejected(update(inOpen, 1, symbol(open, 16.3, 59.5), EDITOR), USER).code()).isEqualTo(ChangeRejection.Code.LAYER_LOCKED);
  }

  @Test
  void aLayerMayBeCreatedLockedAndFalseIsKeptAsAbsent() {
    assertThat(stored(locked).locked()).as("N3: a create is never refused for the lock").isTrue();

    UUID unlocked = UUID.randomUUID();
    Layer created = (Layer) applied(create(unlocked, layer("Plain").withLocked(false), LAYERS), USER).state();

    assertThat(created.content().locked()).isNull();
    assertThat(stored(unlocked).locked()).isNull();
  }

  // ---- Changes without a user (ADR-0042 point 5) --------------------------------------------------

  @Test
  void aServerPartsAndECoresChangesPassTheLock() {
    UUID created = UUID.randomUUID();
    applied(create(created, symbol(locked, 15.0, 60.0), DRAW), Requester.NO_USER);
    applied(update(inLocked, 1, symbol(locked, 15.1, 60.1), DRAW), Requester.NO_USER);
    applied(update(inOpen, 1, symbol(locked, 16.2, 59.4), DRAW), Requester.NO_USER);
    applied(delete(created, EntityType.OBJECT, DRAW), Requester.NO_USER);

    Layer renamed = (Layer) applied(update(locked, 2, layer("Renamed by a plugin"), LAYERS), Requester.NO_USER).state();

    assertThat(renamed.content().locked()).as("the 1.2.0 constructor's update keeps the lock (CR-0028 question 1)").isTrue();
    assertThat(stored(locked).locked()).isTrue();
  }

  @Test
  void anUpdateThatKeepsAnotherPluginsExtensionsKeepsTheLock() {
    Layer withExtension = (Layer) applied(update(locked, 2, new LayerContent("Reference", 1.0, true, LABEL,
        ext("layer-panel", "colour", "red")), LAYERS), Requester.NO_USER).state();
    assertThat(withExtension.content().locked()).isTrue();

    Layer byOther = (Layer) applied(update(locked, 3, new LayerContent("Reference", 2.0, true, LABEL, Extensions.empty()), DRAW), USER)
        .state();

    assertThat(byOther.content().extensions()).as("forwarded untouched").isEqualTo(ext("layer-panel", "colour", "red"));
    assertThat(byOther.content().locked()).isTrue();
  }

  // ---- The order (the ACA's R1) -------------------------------------------------------------------

  @Test
  void theLockComesAfterThePermissionAndTheMissingEntityOrLayerAndBeforeTheRuleChecksAndLayerNotEmpty() {
    Requester viewer = Requester.user("u-bob", Set.of());
    assertThat(rejected(update(inLocked, 1, symbol(locked, 15.0, 60.0), EDITOR), viewer).code())
        .isEqualTo(ChangeRejection.Code.PERMISSION_DENIED);
    assertThat(rejected(delete(UUID.randomUUID(), EntityType.OBJECT, EDITOR), USER).code())
        .isEqualTo(ChangeRejection.Code.ENTITY_NOT_FOUND);
    assertThat(rejected(update(inLocked, 1, symbol(UUID.randomUUID(), 15.0, 60.0), EDITOR), USER).code())
        .as("LAYER_NOT_FOUND first, then the lock of the layer it leaves").isEqualTo(ChangeRejection.Code.LAYER_NOT_FOUND);

    MapObjectContent unclosed = new MapObjectContent(MapObjectContent.SHAPE, MapObjectContent.GENERAL, MapObjectContent.MANUAL, null,
        locked, new Geometry.Polygon(List.of(List.of(Position.of(15, 60), Position.of(16, 60), Position.of(16, 61), Position.of(15, 61)))),
        null, null, null, LABEL, Extensions.empty());
    assertLocked(rejected(create(UUID.randomUUID(), unclosed, EDITOR), USER), "/data/layerId");
    assertLocked(rejected(update(locked, 2, layer("Moved").inWorkspace("nobody.declares-it"), LAYERS), USER), "");
    assertLocked(rejected(delete(locked, EntityType.LAYER, LAYERS), USER), "");
    assertThat(state.object(inLocked)).as("not empty, yet LAYER_LOCKED").isInstanceOf(MapObject.class);
  }
}
