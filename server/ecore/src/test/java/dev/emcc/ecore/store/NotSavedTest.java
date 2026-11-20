package dev.emcc.ecore.store;

import static dev.emcc.ecore.store.Fixtures.DRAW;
import static dev.emcc.ecore.store.Fixtures.EDITOR;
import static dev.emcc.ecore.store.Fixtures.LABEL;
import static dev.emcc.ecore.store.Fixtures.LAYERS;
import static dev.emcc.ecore.store.Fixtures.create;
import static dev.emcc.ecore.store.Fixtures.delete;
import static dev.emcc.ecore.store.Fixtures.ext;
import static dev.emcc.ecore.store.Fixtures.layer;
import static dev.emcc.ecore.store.Fixtures.p;
import static dev.emcc.ecore.store.Fixtures.polygon;
import static dev.emcc.ecore.store.Fixtures.ring;
import static dev.emcc.ecore.store.Fixtures.shape;
import static dev.emcc.ecore.store.Fixtures.symbol;
import static dev.emcc.ecore.store.Fixtures.update;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Style;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.model.TextModifier;
import dev.emcc.sdk.model.TimeAttributes;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Updates that are not saved (ADR-0041): what the store accepts as a move, and what it marks. */
class NotSavedTest {

  private static final Instant NOW = Instant.parse("2026-10-22T10:00:00.123Z");

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final PictureState state = new PictureState();
  private final StoreCounts counts = new StoreCounts();
  private final ObjectStore store =
      new ObjectStore(state, runtime, Clock.fixed(NOW, ZoneOffset.UTC), DataTypes.of(Set.of()), counts);
  private final UUID layerId = UUID.randomUUID();
  private final UUID trackId = UUID.randomUUID();

  @AfterEach
  void close() {
    runtime.close();
  }

  /** A track as the simulator makes it: a symbol with a name, a text modifier, direction and speed, and its own extension. */
  private static MapObjectContent track(UUID layerId, double lon, double lat, double alt, double direction, double speed) {
    Modifiers modifiers = Modifiers.builder().text(TextModifier.UNIQUE_DESIGNATION, "T1").direction(direction).speed(speed).build();
    return new MapObjectContent(MapObjectContent.SYMBOL, MapObjectContent.GENERAL, "simulator", null, layerId,
        new Geometry.Point(Position.of(lon, lat, alt)), new Symbol(SymbolStandard.APP_6D, "10031000001211000000", modifiers),
        null, new ObjectProperties("Track 1", null), LABEL, ext("draw-symbols", "route", "r1"));
  }

  private MapObject made() {
    assertThat(store.apply(create(layerId, layer("Simulation"), LAYERS), Requester.NO_USER)).isInstanceOf(ChangeOutcome.Applied.class);
    assertThat(store.apply(create(trackId, track(layerId, 15.1, 60.2, 1000, 90, 100), DRAW), Requester.NO_USER))
        .isInstanceOf(ChangeOutcome.Applied.class);
    return state.object(trackId);
  }

  private ChangeOutcome notSaved(ChangeRequest request) {
    return store.apply(request, Requester.NO_USER, true);
  }

  private static MapObjectContent with(MapObjectContent c, Symbol symbol, ObjectProperties properties, UUID layer, Extensions extensions) {
    return new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), layer, c.geometry(), symbol, c.style(), properties,
        c.label(), extensions);
  }

  @Test
  void aMoveIsAppliedAndPublishedMarkedNotSavedAndCountedForItsPlugin() throws InterruptedException {
    LinkedBlockingQueue<StoreChange> published = new LinkedBlockingQueue<>();
    WorkerHandle<StoreChange> listener =
        runtime.owner("core-test").spawn(WorkerOptions.<StoreChange>of("listener", () -> (c, ctx) -> published.add(c)));
    runtime.owner("core-test").subscribe(ObjectStore.CHANGES, listener, c -> c);
    MapObject before = made();
    // Position (lat != lon) with altitude, the time, and the symbol's direction and speed: a move.
    MapObjectContent moved = track(layerId, 15.2, 60.3, 1200, 95, 110);
    moved = new MapObjectContent(moved.type(), moved.dataType(), moved.dataSource(), new TimeAttributes(NOW, null, null),
        moved.layerId(), moved.geometry(), moved.symbol(), moved.style(), moved.properties(), moved.label(), moved.extensions());

    ChangeOutcome outcome = notSaved(update(trackId, before.version(), moved, DRAW));

    assertThat(outcome).isInstanceOf(ChangeOutcome.Applied.class);
    assertThat(state.object(trackId).version()).isEqualTo(before.version() + 1);
    assertThat(((Geometry.Point) state.object(trackId).content().geometry()).coordinates()).isEqualTo(Position.of(15.2, 60.3, 1200));
    assertThat(counts.notSaved("draw-symbols")).isEqualTo(1);
    assertThat(counts.notSaved("layer-panel")).isZero();
    StoreChange change;
    do {
      change = published.poll(10, TimeUnit.SECONDS);
      assertThat(change).as("the move is published").isNotNull();
    } while (change.event().operation() != dev.emcc.sdk.model.Operation.UPDATE);
    assertThat(change.notSaved()).isTrue();
    assertThat(change.event().version()).isEqualTo(before.version() + 1);
  }

  @Test
  void anUpdateThatChangesMoreThanAMoveIsRefusedAndChangesNothing() {
    MapObject before = made();
    MapObjectContent c = before.content();
    Symbol symbol = c.symbol();
    Modifiers m = symbol.modifiers();
    UUID otherLayer = UUID.randomUUID();
    assertThat(store.apply(create(otherLayer, layer("Other"), LAYERS), Requester.NO_USER)).isInstanceOf(ChangeOutcome.Applied.class);
    var notMoves = new java.util.LinkedHashMap<String, MapObjectContent>();
    notMoves.put("the name", with(c, symbol, new ObjectProperties("Renamed", null), layerId, c.extensions()));
    notMoves.put("the symbol code", with(c, new Symbol(symbol.standard(), "10061000001211000000", m), c.properties(), layerId, c.extensions()));
    notMoves.put("a text modifier", with(c, new Symbol(symbol.standard(), symbol.sidc(),
        new Modifiers(java.util.Map.of(TextModifier.UNIQUE_DESIGNATION, "T2"), m.direction(), m.speed())), c.properties(), layerId, c.extensions()));
    // SDK 1.4.0 part 2: a tactical graphic's distances and azimuths are content, not a move.
    notMoves.put("the distances", with(c, new Symbol(symbol.standard(), symbol.sidc(), new Modifiers(m.texts(), m.direction(), m.speed(),
        java.util.List.of(500.0), java.util.List.of())), c.properties(), layerId, c.extensions()));
    notMoves.put("the azimuths", with(c, new Symbol(symbol.standard(), symbol.sidc(), new Modifiers(m.texts(), m.direction(), m.speed(),
        java.util.List.of(), java.util.List.of(45.0))), c.properties(), layerId, c.extensions()));
    notMoves.put("the layer", with(c, symbol, c.properties(), otherLayer, c.extensions()));
    notMoves.put("its own extension", with(c, symbol, c.properties(), layerId, ext("draw-symbols", "route", "r2")));
    notMoves.put("the label", new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), layerId, c.geometry(), symbol,
        c.style(), c.properties(), dev.emcc.sdk.model.SecurityLabel.of("NATO", "RESTRICTED"), c.extensions()));
    notMoves.put("the style", new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), layerId, c.geometry(), symbol,
        new Style("#1F6F8B", 1.5, null, null, null, null), c.properties(), c.label(), c.extensions()));

    notMoves.forEach((what, content) -> {
      ChangeOutcome outcome = notSaved(update(trackId, before.version(), content, DRAW));
      assertThat(outcome).as(what).isInstanceOf(ChangeOutcome.Rejected.class);
      ChangeRejection rejection = ((ChangeOutcome.Rejected) outcome).rejection();
      assertThat(rejection.code()).as(what).isEqualTo(ChangeRejection.Code.VALIDATION_FAILED);
      assertThat(rejection.message()).as(what).isEqualTo(ObjectStore.NOT_ONLY_MOVED);
    });
    assertThat(state.object(trackId)).isEqualTo(before);
    assertThat(counts.notSaved("draw-symbols")).isZero();

    // Saved, the same changes are fine.
    assertThat(store.apply(update(trackId, before.version(), notMoves.get("the name"), DRAW), Requester.NO_USER))
        .isInstanceOf(ChangeOutcome.Applied.class);
  }

  @Test
  void aSymbolWithDistancesAndAzimuthsMovesWithThemUnchanged() {
    made();
    UUID fanId = UUID.randomUUID();
    MapObjectContent plain = symbol(layerId, 16.1, 59.2);
    Symbol s = plain.symbol();
    Modifiers fan = Modifiers.builder().distances(java.util.List.of(500.0, 3000.0)).azimuths(java.util.List.of(315.0, 45.0)).build();
    MapObjectContent placed = with(plain, new Symbol(s.standard(), s.sidc(), fan), plain.properties(), layerId, plain.extensions());
    assertThat(store.apply(create(fanId, placed, DRAW), Requester.NO_USER)).isInstanceOf(ChangeOutcome.Applied.class);
    MapObjectContent moved = new MapObjectContent(placed.type(), placed.dataType(), placed.dataSource(), placed.time(), layerId,
        new Geometry.Point(Position.of(16.3, 59.4)), placed.symbol(), placed.style(), placed.properties(), placed.label(),
        placed.extensions());

    assertThat(notSaved(update(fanId, 1, moved, DRAW))).isInstanceOf(ChangeOutcome.Applied.class);
    assertThat(state.object(fanId).content().symbol()).isEqualTo(placed.symbol());
  }

  @Test
  void createsDeletesAndLayersCannotBeNotSaved() {
    made();
    ChangeOutcome create = notSaved(create(UUID.randomUUID(), track(layerId, 16.1, 59.2, 0, 0, 0), DRAW));
    ChangeOutcome delete = notSaved(delete(trackId, EntityType.OBJECT, DRAW));
    ChangeOutcome renamed = notSaved(update(layerId, 1, new LayerContent("Renamed", 1.0, true, LABEL, Extensions.empty()), LAYERS));

    for (ChangeOutcome outcome : java.util.List.of(create, delete, renamed)) {
      assertThat(outcome).isInstanceOf(ChangeOutcome.Rejected.class);
      assertThat(((ChangeOutcome.Rejected) outcome).rejection().code()).isEqualTo(ChangeRejection.Code.VALIDATION_FAILED);
    }
    assertThat(state.object(trackId)).isNotNull();
    assertThat(state.layer(layerId).content().name()).isEqualTo("Simulation");
  }

  @Test
  void aShapeWithoutASymbolMovesAndAGeometryTypeChangeIsAGeometryChange() {
    made();
    UUID shapeId = UUID.randomUUID();
    assertThat(store.apply(create(shapeId, shape(layerId, polygon(p(15, 60), p(15.2, 60), p(15.2, 60.1), p(15, 60))), DRAW),
        Requester.NO_USER)).isInstanceOf(ChangeOutcome.Applied.class);

    ChangeOutcome shifted = notSaved(update(shapeId, 1, shape(layerId, polygon(p(15.1, 60.05), p(15.3, 60.05), p(15.3, 60.15),
        p(15.1, 60.05))), DRAW));
    // ADR-0041 point 1 names the geometry, not its coordinates: a polygon that becomes a line is a move.
    ChangeOutcome line = notSaved(update(shapeId, 2, shape(layerId, new Geometry.LineString(ring(p(15.1, 60.05), p(15.3, 60.15)))),
        DRAW));

    assertThat(shifted).isInstanceOf(ChangeOutcome.Applied.class);
    assertThat(line).isInstanceOf(ChangeOutcome.Applied.class);
    assertThat(state.object(shapeId).content().geometry()).isInstanceOf(Geometry.LineString.class);
    assertThat(counts.notSaved("draw-symbols")).isEqualTo(2);
  }

  @Test
  void aSymbolWithoutModifiersMayGainADirectionAndASpeedButNotAText() {
    made();
    UUID plainId = UUID.randomUUID();
    MapObjectContent plain = symbol(layerId, 16.1, 59.2);
    assertThat(store.apply(create(plainId, plain, DRAW), Requester.NO_USER)).isInstanceOf(ChangeOutcome.Applied.class);
    Symbol s = plain.symbol();
    MapObjectContent fast = with(plain, new Symbol(s.standard(), s.sidc(), Modifiers.builder().speed(50.0).build()), plain.properties(),
        layerId, plain.extensions());
    MapObjectContent named = with(plain, new Symbol(s.standard(), s.sidc(),
        Modifiers.builder().text(TextModifier.UNIQUE_DESIGNATION, "T9").speed(50.0).build()), plain.properties(), layerId, plain.extensions());

    assertThat(notSaved(update(plainId, 1, fast, DRAW))).isInstanceOf(ChangeOutcome.Applied.class);
    assertThat(notSaved(update(plainId, 2, named, DRAW))).isInstanceOfSatisfying(ChangeOutcome.Rejected.class,
        r -> assertThat(r.rejection().message()).isEqualTo(ObjectStore.NOT_ONLY_MOVED));
    assertThat(state.object(plainId).content().symbol().modifiers().speed()).isEqualTo(50.0);
  }

  @Test
  void aUserWithoutThePermissionIsRefusedForThatFirstAndNoRefusalUsesASequenceNumber() {
    MapObject before = made();
    long sequenceNo = state.sequenceNo();
    MapObjectContent c = before.content();
    MapObjectContent renamed = with(c, c.symbol(), new ObjectProperties("Renamed", null), layerId, c.extensions());
    Requester viewer = Requester.user("u-viewer", Set.of());

    ChangeOutcome denied = store.apply(update(trackId, before.version(), renamed, EDITOR), viewer, true);
    ChangeOutcome notAMove = notSaved(update(trackId, before.version(), renamed, DRAW));

    assertThat(denied).as("more than a move too, but the permission comes first").isInstanceOfSatisfying(ChangeOutcome.Rejected.class,
        r -> assertThat(r.rejection().code()).isEqualTo(ChangeRejection.Code.PERMISSION_DENIED));
    assertThat(notAMove).isInstanceOf(ChangeOutcome.Rejected.class);
    assertThat(state.sequenceNo()).as("no number used").isEqualTo(sequenceNo);
    ChangeOutcome moved = notSaved(update(trackId, before.version(), track(layerId, 15.2, 60.3, 1000, 90, 100), DRAW));
    assertThat(((ChangeOutcome.Applied) moved).event().sequenceNo()).as("the next move takes the next number").isEqualTo(sequenceNo + 1);
  }
}
