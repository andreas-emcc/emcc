package dev.emcc.ecore.store;

import static dev.emcc.ecore.store.Fixtures.DRAW;
import static dev.emcc.ecore.store.Fixtures.EDITOR;
import static dev.emcc.ecore.store.Fixtures.LAYERS;
import static dev.emcc.ecore.store.Fixtures.create;
import static dev.emcc.ecore.store.Fixtures.delete;
import static dev.emcc.ecore.store.Fixtures.ext;
import static dev.emcc.ecore.store.Fixtures.layer;
import static dev.emcc.ecore.store.Fixtures.number;
import static dev.emcc.ecore.store.Fixtures.p;
import static dev.emcc.ecore.store.Fixtures.polygon;
import static dev.emcc.ecore.store.Fixtures.shape;
import static dev.emcc.ecore.store.Fixtures.symbol;
import static dev.emcc.ecore.store.Fixtures.update;
import static dev.emcc.ecore.store.Fixtures.value;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.geo.GeoArea;
import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.FieldValue;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.TimeAttributes;
import dev.emcc.sdk.store.Change;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** The object store's rules, called directly (single-threaded); the worker is tested separately. */
class ObjectStoreTest {

  private static final Instant NOW = Instant.parse("2026-10-07T10:00:00.123456Z");

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final PictureState state = new PictureState();
  private static final String TRACK = "cot.track";
  private static final String ALERT = "cot.alert";

  private final ObjectStore store = new ObjectStore(state, runtime, Clock.fixed(NOW, ZoneOffset.UTC), DataTypes.of(Set.of(TRACK, ALERT)));
  private final UUID layerId = UUID.randomUUID();

  @AfterEach
  void close() {
    runtime.close();
  }

  private ChangeEvent applied(ChangeRequest request) {
    ChangeOutcome outcome = store.apply(request, Requester.NO_USER);
    assertThat(outcome).isInstanceOf(ChangeOutcome.Applied.class);
    return ((ChangeOutcome.Applied) outcome).event();
  }

  private ChangeRejection rejected(ChangeRequest request) {
    ChangeOutcome outcome = store.apply(request, Requester.NO_USER);
    assertThat(outcome).isInstanceOf(ChangeOutcome.Rejected.class);
    ChangeRejection rejection = ((ChangeOutcome.Rejected) outcome).rejection();
    assertThat(rejection.requestId()).isEqualTo(request.requestId());
    return rejection;
  }

  private UUID withLayer() {
    applied(create(layerId, layer("Units"), LAYERS));
    return layerId;
  }

  // ---- Permissions (overview 4.4), the store's second line of defence -----------------------------

  private ChangeRejection deniedFor(Requester requester, ChangeRequest request) {
    long before = state.sequenceNo();
    ChangeOutcome outcome = store.apply(request, requester);
    assertThat(outcome).as(request.operation() + " " + request.entityType()).isInstanceOf(ChangeOutcome.Rejected.class);
    ChangeRejection rejection = ((ChangeOutcome.Rejected) outcome).rejection();
    assertThat(rejection.code()).isEqualTo(ChangeRejection.Code.PERMISSION_DENIED);
    assertThat(rejection.requestId()).isEqualTo(request.requestId());
    assertThat(state.sequenceNo()).as("nothing changed").isEqualTo(before);
    return rejection;
  }

  @Test
  void aUsersRequestWithoutThePermissionIsRefusedBeforeAnyOtherCheck() {
    withLayer();
    UUID objectId = UUID.randomUUID();
    applied(create(objectId, symbol(layerId, 15.6, 60.1), DRAW));
    Requester viewer = Requester.user("u-viewer", Set.of("settings.admin"));

    assertThat(deniedFor(viewer, create(UUID.randomUUID(), symbol(layerId, 1, 2), EDITOR)).message())
        .isEqualTo("changing an object needs the permission objects.edit");
    deniedFor(viewer, update(objectId, 1, symbol(layerId, 3, 4), EDITOR));
    deniedFor(viewer, delete(objectId, EntityType.OBJECT, EDITOR));
    assertThat(deniedFor(viewer, create(UUID.randomUUID(), layer("Mine"), EDITOR)).message())
        .isEqualTo("changing a layer needs the permission layers.edit");
    deniedFor(viewer, update(layerId, 1, layer("Renamed"), EDITOR));
    deniedFor(viewer, delete(layerId, EntityType.LAYER, EDITOR));
    // Before the store's own checks: an unknown layer, an object that is not there, an id in use.
    deniedFor(viewer, create(UUID.randomUUID(), symbol(UUID.randomUUID(), 1, 2), EDITOR));
    deniedFor(viewer, delete(UUID.randomUUID(), EntityType.OBJECT, EDITOR));
    deniedFor(viewer, create(layerId, layer("Again"), EDITOR));
    assertThat(state.object(objectId).version()).isEqualTo(1);
    assertThat(state.layer(layerId).content().name()).isEqualTo("Units");
  }

  @Test
  void eachPermissionCoversItsOwnEntityTypeWhoeverCreatedTheEntity() {
    withLayer(); // created by a plugin
    UUID objectId = UUID.randomUUID();
    applied(create(objectId, symbol(layerId, 15.6, 60.1), DRAW));
    Requester objects = Requester.user("u-alice", Set.of(Requester.OBJECTS_EDIT));
    Requester layers = Requester.user("u-bob", Set.of(Requester.LAYERS_EDIT));

    assertThat(store.apply(update(objectId, 1, symbol(layerId, 3, 4), EDITOR), objects)).isInstanceOf(ChangeOutcome.Applied.class);
    deniedFor(objects, update(layerId, 1, layer("Renamed"), EDITOR));
    assertThat(store.apply(update(layerId, 1, layer("Renamed"), EDITOR), layers)).isInstanceOf(ChangeOutcome.Applied.class);
    deniedFor(layers, delete(objectId, EntityType.OBJECT, EDITOR));
    assertThat(store.apply(delete(objectId, EntityType.OBJECT, EDITOR), objects)).isInstanceOf(ChangeOutcome.Applied.class);
    assertThat(store.apply(delete(layerId, EntityType.LAYER, EDITOR), layers)).isInstanceOf(ChangeOutcome.Applied.class);
  }

  @Test
  void theNoLoginUserPluginServerPartsAndEcoreAreNotRefused() {
    assertThat(store.apply(create(layerId, layer("Units"), EDITOR), Requester.withAllPermissions("local")))
        .isInstanceOf(ChangeOutcome.Applied.class);
    assertThat(store.apply(create(UUID.randomUUID(), symbol(layerId, 1, 2), DRAW), Requester.NO_USER))
        .isInstanceOf(ChangeOutcome.Applied.class);
    // The permission names are the SDK's (ECore keeps its own copy: only the plugin host uses the SDK's API).
    assertThat(Requester.permissionFor(EntityType.OBJECT)).isEqualTo(dev.emcc.sdk.Permissions.OBJECTS_EDIT);
    assertThat(Requester.permissionFor(EntityType.LAYER)).isEqualTo(dev.emcc.sdk.Permissions.LAYERS_EDIT);
  }

  // ---- Data model 1.2.0 that no loaded plugin declares: refused, never dropped ------------------------
  // (Declared workspaces: WorkspacesStoreTest.)

  private void refusedAt(ChangeRequest request, String path) {
    long before = state.sequenceNo();
    ChangeRejection rejection = rejected(request);
    assertThat(rejection.code()).isEqualTo(ChangeRejection.Code.VALIDATION_FAILED);
    assertThat(rejection.details()).singleElement().satisfies(d -> assertThat(d.path()).isEqualTo(path));
    assertThat(state.sequenceNo()).as("nothing changed").isEqualTo(before);
  }

  @Test
  void aLayerInAWorkspaceNoLoadedPluginDeclaresIsRefusedRatherThanPutIntoView() {
    withLayer();
    UUID simulation = UUID.randomUUID();

    refusedAt(create(simulation, layer("Exercise").inWorkspace("simulator.simulation"), LAYERS), "/data/workspace");
    refusedAt(Fixtures.update(layerId, 1, layer("Units").inWorkspace("simulator.simulation"), LAYERS), "/data/workspace");

    assertThat(state.layer(simulation)).isNull();
    assertThat(state.layer(layerId).content().workspace()).isNull();
  }

  @Test
  void anExplicitViewWorkspaceIsStoredAsAbsent() {
    UUID view = UUID.randomUUID();

    Layer created = (Layer) applied(create(view, layer("Units").inWorkspace("core.view"), LAYERS)).state();
    Layer updated = (Layer) applied(Fixtures.update(view, 1, layer("Renamed").inWorkspace("core.view"), LAYERS)).state();

    assertThat(created.content().workspace()).as("R2").isNull();
    assertThat(updated.content().workspace()).isNull();
    assertThat(state.layer(view).content()).isEqualTo(layer("Renamed"));
  }

  @Test
  void aFieldNoLoadedPluginDeclaresIsRefusedRatherThanDropped() {
    withLayer();
    UUID id = UUID.randomUUID();
    applied(create(id, symbol(layerId, 15.6, 60.1), DRAW));
    MapObject before = state.object(id);
    List<FieldValue> fields = List.of(new FieldValue("cot", "callsign", JsonString.of("ALPHA-1")));
    ChangeRequest create = ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), symbol(layerId, 15.7, 60.2), DRAW);
    ChangeRequest update = ChangeRequest.update(UUID.randomUUID(), id, 1, symbol(layerId, 16.1, 61.3), DRAW);

    refusedAt(withFields(create, fields), "/fields/0");
    refusedAt(withFields(update, fields), "/fields/0");
    refusedAt(Change.updateObject(before, symbol(layerId, 16.1, 61.3)).withFields(fields).toRequest(UUID.randomUUID(), "draw-symbols"),
        "/fields/0");

    assertThat(state.object(id)).isEqualTo(before);
    assertThat(state.objectCount(layerId)).isEqualTo(1);
  }

  @Test
  void theWorkspaceRefusalComesAfterThePermissionAndTheId() {
    withLayer();
    List<FieldValue> fields = List.of(new FieldValue("cot", "callsign", JsonString.of("ALPHA-1")));
    Requester viewer = Requester.user("u-viewer", Set.of("settings.admin"));

    deniedFor(viewer, withFields(create(UUID.randomUUID(), symbol(layerId, 1, 2), EDITOR), fields));
    deniedFor(viewer, create(UUID.randomUUID(), layer("Exercise").inWorkspace("simulator.simulation"), EDITOR));
    assertThat(rejected(create(layerId, layer("Exercise").inWorkspace("simulator.simulation"), LAYERS)).code())
        .as("the id is in use: checked first (model rule 16)").isEqualTo(ChangeRejection.Code.ENTITY_EXISTS);
  }

  private static ChangeRequest withFields(ChangeRequest r, List<FieldValue> fields) {
    return new ChangeRequest(r.requestId(), r.entityType(), r.operation(), r.entityId(), r.baseVersion(), r.data(), r.externalRef(),
        r.source(), fields);
  }

  @Test
  void createsLayersAndObjectsWithVersionsSequenceNumbersAndMeta() {
    ChangeEvent layerEvent = applied(create(layerId, layer("Units"), LAYERS));
    UUID objectId = UUID.randomUUID();
    ChangeRequest request = create(objectId, symbol(layerId, 15.654321, 60.123456), DRAW);

    ChangeEvent event = applied(request);

    assertThat(layerEvent.sequenceNo()).isEqualTo(1);
    assertThat(event.sequenceNo()).isEqualTo(2);
    assertThat(event.operation()).isEqualTo(Operation.CREATE);
    assertThat(event.requestId()).isEqualTo(request.requestId());
    assertThat(event.version()).isEqualTo(1);
    assertThat(event.previousVersion()).isNull();
    assertThat(event.at()).isEqualTo(Instant.parse("2026-10-07T10:00:00.123Z")); // milliseconds
    assertThat(event.by()).isEqualTo(DRAW);
    assertThat(event.label()).isEqualTo(Fixtures.LABEL);
    MapObject object = (MapObject) event.state();
    assertThat(object.meta().created()).isEqualTo(object.meta().modified());
    assertThat(object.meta().created().by()).isEqualTo(DRAW);
    assertThat(((Geometry.Point) object.content().geometry()).coordinates()).isEqualTo(Position.of(15.654321, 60.123456));
    assertThat(state.object(objectId)).isEqualTo(object);
    assertThat(state.objectCount(layerId)).isEqualTo(1);
  }

  @Test
  void referencesAreChecked() {
    UUID objectId = UUID.randomUUID();

    ChangeRejection noLayer = rejected(create(objectId, symbol(UUID.randomUUID(), 15.6, 60.1), DRAW));
    assertThat(noLayer.code()).isEqualTo(ChangeRejection.Code.LAYER_NOT_FOUND);
    assertThat(noLayer.details()).extracting(ChangeRejection.Detail::path).containsExactly("/data/layerId");

    withLayer();
    ChangeRejection exists = rejected(create(layerId, symbol(layerId, 15.6, 60.1), DRAW)); // id of the layer
    assertThat(exists.code()).isEqualTo(ChangeRejection.Code.ENTITY_EXISTS);

    assertThat(rejected(update(objectId, 1, symbol(layerId, 15.6, 60.1), DRAW)).code())
        .isEqualTo(ChangeRejection.Code.ENTITY_NOT_FOUND);
    assertThat(rejected(delete(objectId, EntityType.OBJECT, DRAW)).code()).isEqualTo(ChangeRejection.Code.ENTITY_NOT_FOUND);
    assertThat(rejected(delete(layerId, EntityType.OBJECT, DRAW)).code())
        .as("a layer id is not an object").isEqualTo(ChangeRejection.Code.ENTITY_NOT_FOUND);
  }

  @Test
  void rejectionsDoNotUseSequenceNumbers() {
    withLayer();
    rejected(create(UUID.randomUUID(), symbol(UUID.randomUUID(), 15.6, 60.1), DRAW));
    rejected(delete(UUID.randomUUID(), EntityType.OBJECT, DRAW));

    assertThat(applied(create(UUID.randomUUID(), symbol(layerId, 15.6, 60.1), DRAW)).sequenceNo()).isEqualTo(2);
  }

  @Test
  void anUpdateReplacesTheCoreFieldsAndKeepsCreated() {
    withLayer();
    UUID id = UUID.randomUUID();
    MapObjectContent styled = shape(layerId, polygon(p(10, 60), p(12, 60), p(12, 61), p(10, 60)));
    MapObject first = (MapObject) applied(create(id, styled, DRAW)).state();
    MapObjectContent unstyled = new MapObjectContent(MapObjectContent.SHAPE, MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, layerId, styled.geometry(), null, null, null,
        Fixtures.LABEL, styled.extensions());

    ChangeEvent event = applied(update(id, 1, unstyled, Fixtures.EDITOR));

    MapObject second = (MapObject) event.state();
    assertThat(event.version()).isEqualTo(2);
    assertThat(event.previousVersion()).isEqualTo(1);
    assertThat(event.baseVersion()).isEqualTo(1);
    assertThat(second.content().style()).as("missing core field removed (rule 5)").isNull();
    assertThat(second.meta().created()).isEqualTo(first.meta().created());
    assertThat(second.meta().modified().by()).isEqualTo(Fixtures.EDITOR);
  }

  @Test
  void anUpdateEqualToTheStoredStateIsAppliedLikeAnyOther() {
    withLayer();
    UUID id = UUID.randomUUID();
    MapObjectContent content = symbol(layerId, 15.6, 60.1);
    applied(create(id, content, DRAW));

    ChangeEvent event = applied(update(id, 1, content, DRAW));

    assertThat(event.version()).isEqualTo(2); // rule 12: the requester always gets an answer
  }

  @Test
  void anObjectCanMoveToAnotherLayer() {
    withLayer();
    UUID other = UUID.randomUUID();
    applied(create(other, layer("Other"), LAYERS));
    UUID id = UUID.randomUUID();
    applied(create(id, symbol(layerId, 15.6, 60.1), DRAW));

    applied(update(id, 1, symbol(other, 15.6, 60.1), DRAW));

    assertThat(state.objectCount(layerId)).isZero();
    assertThat(state.objectCount(other)).isEqualTo(1);
    assertThat(rejected(update(id, 2, symbol(UUID.randomUUID(), 15.6, 60.1), DRAW)).code())
        .isEqualTo(ChangeRejection.Code.LAYER_NOT_FOUND);
  }

  @Test
  void aDeleteKeepsTheLabelAndIncreasesTheVersion() {
    withLayer();
    UUID id = UUID.randomUUID();
    applied(create(id, symbol(layerId, 15.6, 60.1), DRAW));

    ChangeEvent event = applied(delete(id, EntityType.OBJECT, DRAW));

    assertThat(event.state()).isNull();
    assertThat(event.label()).isEqualTo(Fixtures.LABEL);
    assertThat(event.version()).isEqualTo(2);
    assertThat(event.previousVersion()).isEqualTo(1);
    assertThat(state.object(id)).isNull();
    assertThat(state.objectCount(layerId)).isZero();
  }

  @Test
  void onlyEmptyLayersCanBeDeleted() {
    withLayer();
    UUID id = UUID.randomUUID();
    applied(create(id, symbol(layerId, 15.6, 60.1), DRAW));

    ChangeRejection rejection = rejected(delete(layerId, EntityType.LAYER, LAYERS));
    assertThat(rejection.code()).isEqualTo(ChangeRejection.Code.LAYER_NOT_EMPTY);
    assertThat(rejection.message()).contains("1 objects");

    applied(delete(id, EntityType.OBJECT, DRAW));
    assertThat(applied(delete(layerId, EntityType.LAYER, LAYERS)).state()).isNull();
    assertThat(state.layer(layerId)).isNull();
  }

  // ---- Extension ownership (model rule 5, ADR-0018) -------------------------------------------------

  @Test
  void aCreateKeepsEveryExtensionNamespace() {
    withLayer();
    UUID id = UUID.randomUUID();
    var extensions = ext(Map.of("nvg-in", value("comment", "imported"), "cot-in", value("uid", "ABC-1")));

    MapObject object = (MapObject) applied(create(id, symbol(layerId, 15.6, 60.1, extensions), DRAW)).state();

    assertThat(object.content().extensions().namespaces()).containsOnlyKeys("nvg-in", "cot-in");
  }

  @Test
  void anUpdateWritesOnlyTheRequestersOwnNamespace() {
    withLayer();
    UUID id = UUID.randomUUID();
    applied(create(id, symbol(layerId, 15.6, 60.1,
        ext(Map.of("draw-symbols", value("note", "v1"), "cot-in", value("uid", "ABC-1")))), DRAW));

    // draw-symbols sends its own new value, a changed copy of cot-in's, and a namespace that is not stored.
    MapObject object = (MapObject) applied(update(id, 1, symbol(layerId, 15.6, 60.1,
        ext(Map.of("draw-symbols", value("note", "v2"), "cot-in", value("uid", "FORGED"), "nvg-in", value("x", "y")))), DRAW))
        .state();

    var namespaces = object.content().extensions().namespaces();
    assertThat(namespaces.get("draw-symbols")).isEqualTo(value("note", "v2"));
    assertThat(namespaces.get("cot-in")).as("foreign namespace taken from the stored object").isEqualTo(value("uid", "ABC-1"));
    assertThat(namespaces).as("a foreign namespace is never added on update").doesNotContainKey("nvg-in");
  }

  @Test
  void anAbsentOwnNamespaceIsKeptAndAnEmptyOneRemovesIt() {
    withLayer();
    UUID id = UUID.randomUUID();
    applied(create(id, symbol(layerId, 15.6, 60.1, ext("draw-symbols", "note", "v1")), DRAW));

    MapObject kept = (MapObject) applied(update(id, 1, symbol(layerId, 15.7, 60.2), DRAW)).state();
    assertThat(kept.content().extensions().get("draw-symbols")).isEqualTo(value("note", "v1"));

    MapObject removed = (MapObject) applied(update(id, 2, symbol(layerId, 15.7, 60.2,
        ext(Map.of("draw-symbols", JsonObject.empty()))), DRAW)).state();
    assertThat(removed.content().extensions().isEmpty()).isTrue();
  }

  @Test
  void extensionNumbersStayExact() {
    withLayer();
    UUID id = UUID.randomUUID();
    String exact = "0.10000000000000000555111512312578270211815834045410156250001";
    applied(create(id, symbol(layerId, 15.6, 60.1, ext(Map.of("nvg-in", number("n", exact)))), DRAW));

    MapObject moved = (MapObject) applied(update(id, 1, symbol(layerId, 15.7, 60.2), DRAW)).state();

    assertThat(moved.content().extensions().get("nvg-in")).isEqualTo(number("n", exact));
    assertThat(moved.content().extensions().get("nvg-in").getNumber("n").text()).isEqualTo(exact);
  }

  // ---- Geometry rules 1, 2 and 10 ----------------------------------------------------------------------

  static Stream<Path> invalidByRule() throws IOException {
    return Files.list(Path.of("../../model/examples/invalid-by-rule")).filter(f -> f.toString().endsWith(".json"))
        .filter(f -> !f.getFileName().toString().contains("-manifest-")) // the plugin host's (PluginHostV1Test)
        .sorted();
  }

  @ParameterizedTest
  @MethodSource("invalidByRule")
  void everyInvalidByRuleExampleIsRejected(Path file) throws IOException {
    MapObject example = new ModelJson().readMapObject(Files.readString(file));
    applied(create(example.content().layerId(), layer("Example layer"), LAYERS));

    String name = file.getFileName().toString();
    String dataType = example.content().dataType();
    DataTypes available = name.startsWith("rule-14-") || dataType.equals(MapObjectContent.GENERAL)
        ? new DataTypes() // the rule-14 example's data type is not declared
        : DataTypes.of(Set.of(dataType));
    ChangeOutcome outcome = new ObjectStore(state, runtime, Clock.fixed(NOW, ZoneOffset.UTC), available)
        .apply(create(example.id(), example.content(), DRAW), Requester.NO_USER);

    assertThat(outcome).isInstanceOf(ChangeOutcome.Rejected.class);
    ChangeRejection rejection = ((ChangeOutcome.Rejected) outcome).rejection();
    String path = name.startsWith("rule-14-") ? "/data/dataType" : name.startsWith("rule-15-") ? "/data/time"
        : name.startsWith("rule-17-") ? "/data/relations/" : name.startsWith("rule-18-") ? "/data/fieldSets/" : "/data/geometry";
    assertThat(rejection.code()).isEqualTo(ChangeRejection.Code.VALIDATION_FAILED);
    assertThat(rejection.details()).isNotEmpty().allSatisfy(d -> assertThat(d.path()).startsWith(path));
  }

  // ---- Data type, data source, time and external identity (rules 14 to 16) -----------------------

  private static MapObjectContent of(MapObjectContent c, String dataType, String dataSource, TimeAttributes time) {
    return new MapObjectContent(c.type(), dataType, dataSource, time, c.layerId(), c.geometry(), c.symbol(), c.style(),
        c.properties(), c.label(), c.extensions());
  }

  private MapObjectContent track(String dataSource) {
    return of(symbol(layerId, 11.97, 57.71), TRACK, dataSource, null);
  }

  @Test
  void aDataTypeMustBeAvailableOnCreateAndWhenAnUpdateChangesIt() {
    withLayer();
    UUID id = UUID.randomUUID();
    ChangeRejection unknown = rejected(create(id, of(symbol(layerId, 11.97, 57.71), "gone.thing", "manual", null), DRAW));
    assertThat(unknown.code()).isEqualTo(ChangeRejection.Code.VALIDATION_FAILED);
    assertThat(unknown.details()).singleElement().satisfies(d -> assertThat(d.path()).isEqualTo("/data/dataType"));

    applied(create(id, track("tak-north"), DRAW));
    applied(update(id, 1, of(track("tak-north"), ALERT, "tak-north", null), DRAW));
    assertThat(rejected(update(id, 2, of(track("tak-north"), "gone.thing", "tak-north", null), DRAW)).details())
        .singleElement().satisfies(d -> assertThat(d.path()).isEqualTo("/data/dataType"));
  }

  @Test
  void storedDataKeepsADataTypeNoPluginDeclaresAnyMore() {
    MapObject stored = new ModelJson().readMapObject(read("invalid-by-rule/rule-14-object-unknown-data-type.json"));
    applied(create(stored.content().layerId(), layer("Example layer"), LAYERS));
    PictureState loaded = PictureState.of(new PictureSnapshot(1, List.of(state.layer(stored.content().layerId())), List.of(stored)));
    ObjectStore restarted = new ObjectStore(loaded, runtime, Clock.fixed(NOW, ZoneOffset.UTC), new DataTypes());

    ChangeOutcome moved = restarted.apply(update(stored.id(), 1, stored.content(), DRAW), Requester.NO_USER);

    assertThat(moved).as("unchanged data type: no check").isInstanceOf(ChangeOutcome.Applied.class);
  }

  @Test
  void theDataSourceIsFixedAtCreation() {
    withLayer();
    UUID id = UUID.randomUUID();
    applied(create(id, track("tak-north"), DRAW));

    ChangeRejection rejection = rejected(update(id, 1, track("tak-south"), DRAW));

    assertThat(rejection.code()).isEqualTo(ChangeRejection.Code.VALIDATION_FAILED);
    assertThat(rejection.details()).singleElement().satisfies(d -> assertThat(d.path()).isEqualTo("/data/dataSource"));
  }

  @Test
  void validFromMayNotBeAfterExpires() {
    withLayer();
    Instant at = Instant.parse("2026-10-07T10:00:00Z");
    MapObjectContent backwards = of(track("tak-north"), TRACK, "tak-north", new TimeAttributes(null, at.plusSeconds(1), at));
    MapObjectContent same = of(track("tak-north"), TRACK, "tak-north", new TimeAttributes(at, at, at));

    assertThat(rejected(create(UUID.randomUUID(), backwards, DRAW)).details())
        .singleElement().satisfies(d -> assertThat(d.path()).isEqualTo("/data/time/validFrom"));
    MapObject stored = (MapObject) applied(create(UUID.randomUUID(), same, DRAW)).state();
    assertThat(stored.content().time()).isEqualTo(new TimeAttributes(at, at, at));
  }

  @Test
  void anExternalIdentityIsKeptForTheObjectsLifeAndBelongsToOneObjectAtATime() {
    withLayer();
    ExternalRef uid = new ExternalRef("cot", "ANDROID-1234");
    UUID first = UUID.randomUUID();
    ChangeRequest create = ChangeRequest.create(UUID.randomUUID(), first, track("tak-north"), uid, DRAW);
    assertThat(((MapObject) applied(create).state()).meta().externalRef()).isEqualTo(uid);
    assertThat(((MapObject) applied(update(first, 1, track("tak-north"), DRAW)).state()).meta().externalRef())
        .as("an update keeps it").isEqualTo(uid);

    ChangeRejection taken = rejected(ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), track("tak-north"), uid, DRAW));
    assertThat(taken.code()).isEqualTo(ChangeRejection.Code.EXTERNAL_REF_EXISTS);
    assertThat(taken.message()).contains(first.toString());
    ChangeRejection resent = rejected(ChangeRequest.create(UUID.randomUUID(), first, track("tak-north"), uid, DRAW));
    assertThat(resent.code()).as("rule 3 first: a resent create arrived the first time").isEqualTo(ChangeRejection.Code.ENTITY_EXISTS);

    applied(delete(first, EntityType.OBJECT, DRAW));
    UUID second = UUID.randomUUID();
    MapObject again = (MapObject) applied(ChangeRequest.create(UUID.randomUUID(), second, track("tak-north"), uid, DRAW)).state();
    assertThat(again.meta().externalRef()).as("deleting frees it").isEqualTo(uid);
    assertThat(state.objectWith(uid)).isEqualTo(second);
  }

  @Test
  void theExternalIdentityIndexIsRebuiltFromAStoredPicture() {
    withLayer();
    ExternalRef uid = new ExternalRef("cot", "ANDROID-1234");
    UUID id = UUID.randomUUID();
    applied(ChangeRequest.create(UUID.randomUUID(), id, track("tak-north"), uid, DRAW));

    PictureState loaded = PictureState.of(state.snapshot());

    assertThat(loaded.objectWith(uid)).isEqualTo(id);
  }

  // ---- The spatial index (spike S3) -------------------------------------------------------------

  @Test
  void anAreaQueryFollowsCreatesUpdatesAndDeletesAndAStoredPicture() {
    withLayer();
    GeoArea stockholm = new GeoArea(Fixtures.ring(p(17, 58), p(20, 58), p(20, 60), p(17, 60), p(17, 58)), Position.of(18.5, 59), 0, 0);
    UUID staying = UUID.randomUUID();
    UUID leaving = UUID.randomUUID();
    UUID deleted = UUID.randomUUID();
    applied(create(staying, symbol(layerId, 18.07, 59.33), DRAW));
    applied(create(leaving, symbol(layerId, 18.5, 59.1), DRAW));
    applied(create(deleted, symbol(layerId, 18.9, 59.2), DRAW));
    applied(create(UUID.randomUUID(), symbol(layerId, 59.33, 18.07), DRAW)); // latitude and longitude swapped: far away

    applied(update(leaving, 1, symbol(layerId, 11.97, 57.71), DRAW)); // to Gothenburg
    applied(delete(deleted, EntityType.OBJECT, DRAW));

    assertThat(state.find(stockholm, o -> true, 10)).extracting(MapObject::id).containsExactly(staying);
    assertThat(PictureState.of(state.snapshot()).find(stockholm, o -> true, 10)).extracting(MapObject::id).containsExactly(staying);
    assertThat(state.find(stockholm, o -> false, 10)).isEmpty();
    assertThat(state.bound(staying)).isNotNull();
    assertThat(state.bound(deleted)).isNull();
  }

  @Test
  void aSubscriptionStartsFromTheAreasObjectsAllLayersAndTheCountsPerLayer() {
    withLayer();
    UUID otherLayer = UUID.randomUUID();
    applied(create(otherLayer, layer("Other"), LAYERS));
    UUID stockholm = UUID.randomUUID();
    applied(create(stockholm, symbol(layerId, 18.07, 59.33), DRAW));
    applied(create(UUID.randomUUID(), symbol(layerId, 11.97, 57.71), DRAW));
    applied(create(UUID.randomUUID(), symbol(otherLayer, 59.33, 18.07), DRAW)); // swapped: far away
    GeoArea around = new GeoArea(Fixtures.ring(p(17, 58), p(20, 58), p(20, 60), p(17, 60), p(17, 58)), Position.of(18.5, 59), 0, 0);

    AreaSnapshot inArea = store.area(around, true);
    AreaSnapshot everything = store.area(null, true);
    AreaSnapshot countsOnly = store.area(around, false);

    assertThat(inArea.objects()).extracting(MapObject::id).containsExactly(stockholm);
    assertThat(inArea.layers()).hasSize(2);
    assertThat(inArea.sequenceNo()).isEqualTo(5);
    assertThat(inArea.objectCounts()).isEqualTo(Map.of(layerId, 2, otherLayer, 1));
    assertThat(everything.objects()).hasSize(3);
    assertThat(countsOnly.objects()).isEmpty();
    assertThat(countsOnly.objectCounts()).isEqualTo(inArea.objectCounts());
    UUID empty = UUID.randomUUID();
    applied(create(empty, layer("Empty"), LAYERS));
    assertThat(store.area(null, false).objectCounts()).as("an empty layer counts 0").containsEntry(empty, 0);
  }

  @Test
  void everyPublishedChangeCarriesTheObjectBeforeItAndBothBounds() {
    dev.emcc.ecore.runtime.Probe<StoreChange> changes = new dev.emcc.ecore.runtime.Probe<>();
    var listener = runtime.owner("core-test").spawn(
        dev.emcc.ecore.runtime.WorkerOptions.<StoreChange>of("listener", () -> (c, ctx) -> changes.add(c)));
    runtime.owner("core-test").subscribe(ObjectStore.CHANGES, listener, c -> c);
    withLayer();
    UUID id = UUID.randomUUID();
    MapObject created = (MapObject) applied(create(id, symbol(layerId, 18.07, 59.33), DRAW)).state();
    applied(update(id, 1, symbol(layerId, 11.97, 57.71), DRAW));
    applied(delete(id, EntityType.OBJECT, DRAW));

    StoreChange layer = changes.next();
    assertThat(layer).isEqualTo(StoreChange.of(layer.event()));
    StoreChange create = changes.next();
    assertThat(create.before()).isNull();
    assertThat(create.afterBound()).isEqualTo(dev.emcc.ecore.geo.Cap.of(new Geometry.Point(Position.of(18.07, 59.33))));
    StoreChange move = changes.next();
    assertThat(move.before()).isEqualTo(created);
    assertThat(move.beforeBound()).isEqualTo(create.afterBound());
    assertThat(move.afterBound()).isEqualTo(dev.emcc.ecore.geo.Cap.of(new Geometry.Point(Position.of(11.97, 57.71))));
    StoreChange gone = changes.next();
    assertThat(gone.beforeBound()).isEqualTo(move.afterBound());
    assertThat(gone.afterBound()).isNull();
  }

  private static String read(String example) {
    try {
      return Files.readString(Path.of("../../model/examples").resolve(example));
    } catch (IOException e) {
      throw new java.io.UncheckedIOException(e);
    }
  }

  @Test
  void aClockwiseExteriorRingIsTurnedCounterClockwise() {
    withLayer();
    Geometry.Polygon clockwise = polygon(p(10, 60), p(10, 61), p(12, 61), p(12, 60), p(10, 60));

    MapObject object = (MapObject) applied(create(UUID.randomUUID(), shape(layerId, clockwise), DRAW)).state();

    List<Position> ring = ((Geometry.Polygon) object.content().geometry()).rings().getFirst();
    assertThat(ring).isEqualTo(clockwise.rings().getFirst().reversed());
    assertThat(RingOrientation.of(ring)).isEqualTo(RingOrientation.Kind.COUNTER_CLOCKWISE);
  }

  @Test
  void holesRunClockwise() {
    withLayer();
    var exterior = Fixtures.ring(p(10, 60), p(14, 60), p(14, 63), p(10, 63), p(10, 60));
    var hole = Fixtures.ring(p(11, 61), p(12, 61), p(12, 62), p(11, 62), p(11, 61)); // counter-clockwise: wrong for a hole

    MapObject object = (MapObject) applied(create(UUID.randomUUID(),
        shape(layerId, new Geometry.Polygon(List.of(exterior, hole))), DRAW)).state();

    var rings = ((Geometry.Polygon) object.content().geometry()).rings();
    assertThat(rings.get(0)).isEqualTo(exterior);
    assertThat(RingOrientation.of(rings.get(1))).isEqualTo(RingOrientation.Kind.CLOCKWISE);
  }

  @Test
  void aRingAcrossTheAntimeridianIsASmallRing() {
    withLayer();
    // Counter-clockwise when the edges go the short way across 180°.
    Geometry.Polygon crossing = polygon(p(179, 10), p(-179, 10), p(-179, 12), p(179, 12), p(179, 10));

    MapObject object = (MapObject) applied(create(UUID.randomUUID(), shape(layerId, crossing), DRAW)).state();

    assertThat(object.content().geometry()).as("already counter-clockwise, unchanged").isEqualTo(crossing);
  }

  @Test
  void aRingAroundAPoleIsRejected() {
    withLayer();
    Geometry.Polygon aroundThePole = polygon(p(0, 80), p(90, 80), p(180, 80), p(-90, 80), p(0, 80));

    ChangeRejection rejection = rejected(create(UUID.randomUUID(), shape(layerId, aroundThePole), DRAW));

    assertThat(rejection.code()).isEqualTo(ChangeRejection.Code.VALIDATION_FAILED);
    assertThat(rejection.details().getFirst().problem()).contains("encloses a pole");
  }

  @Test
  void anOpenRingIsRejectedWithItsPath() {
    withLayer();
    Geometry.Polygon open = polygon(p(10, 60), p(12, 60), p(12, 61), p(10, 61));

    ChangeRejection rejection = rejected(create(UUID.randomUUID(), shape(layerId, open), DRAW));

    assertThat(rejection.code()).isEqualTo(ChangeRejection.Code.VALIDATION_FAILED);
    assertThat(rejection.details()).extracting(ChangeRejection.Detail::path).containsExactly("/data/geometry/coordinates/0");
  }
}
