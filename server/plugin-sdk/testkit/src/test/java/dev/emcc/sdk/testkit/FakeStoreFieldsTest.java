package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.DeclaredField;
import dev.emcc.sdk.DeclaredField.Choice;
import dev.emcc.sdk.DeclaredField.Type;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.FieldValue;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.model.TimeAttributes;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.ObjectQuery;
import dev.emcc.sdk.store.StoreUpdate;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** SDK 1.2.0 (CR-0025 parts 4 and 8): the fake store's declared fields and updates that are not saved, as ECore has them. */
class FakeStoreFieldsTest {

  private static final DeclaredField CALLSIGN =
      new DeclaredField("cot", "callsign", Type.TEXT, "Callsign", null, null, null, null, 64, false, List.of(), true, List.of());
  private static final DeclaredField ROLE = new DeclaredField("cot", "role", Type.CHOICE, "Role", null, null, null, null, null, true,
      List.of(new Choice("team-member", "Team member"), new Choice("hq", "HQ")), true, List.of("core.general"));
  private static final DeclaredField STALE = new DeclaredField("cot", "staleAfter", Type.INTEGER, "Stale after", null, "s",
      java.math.BigDecimal.ONE, null, null, false, List.of(), false, List.of());

  private final FakePluginContext ctx = FakePluginContext.builder("draw-symbols").declaredFields(CALLSIGN, ROLE, STALE).build();
  private final Layer layer = ctx.store().seedLayer("Own");

  private MapObjectContent content(double lon, Extensions ext) {
    // lon differs from lat, so a swapped order would show
    return new MapObjectContent("core.symbol", MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, layer.id(),
        new Geometry.Point(Position.of(lon, 59.3311)), new Symbol(SymbolStandard.APP_6D, "10061000001211000000", new Modifiers(Map.of(), 90.0, 5.0)),
        null, null, layer.content().label(), ext);
  }

  private MapObject create(Extensions ext) {
    var outcome = ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.createObject(UUID.randomUUID(), content(18.0723, ext)));
    return (MapObject) ((ChangeOutcome.Applied) outcome).event().state();
  }

  private static ChangeRejection rejected(ChangeOutcome outcome) {
    return ((ChangeOutcome.Rejected) outcome).rejection();
  }

  @Test
  void anEditorSetsAnotherPluginsEditableFieldsAfterTheContent() {
    MapObject o = create(Extensions.empty());
    var outcome = ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.updateObject(o, o.content())
        .withFields(List.of(new FieldValue("cot", "callsign", JsonString.of("ALPHA-1")), new FieldValue("cot", "role", JsonString.of("hq")))));
    assertThat(outcome).isInstanceOf(ChangeOutcome.Applied.class);
    assertThat(ctx.store().object(o.id()).content().extensions().get("cot"))
        .isEqualTo(JsonObject.builder().put("callsign", JsonString.of("ALPHA-1")).put("role", JsonString.of("hq")).build());
  }

  @Test
  void anOlderCopyOfTheNamespaceDoesNotOverwriteWhatWasSet() {
    MapObject o = create(Extensions.empty());
    MapObject older = o;
    ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.updateObject(o, o.content()).withFields(List.of(new FieldValue("cot", "callsign", JsonString.of("ALPHA-1")))));
    // a third plugin forwards an older copy of the object, with another cot namespace
    var stale = content(18.0800, Extensions.empty().with("cot", JsonObject.builder().put("callsign", JsonString.of("OLD")).build()));
    ctx.store().applyAs(Actor.plugin("map-view-2d"), Change.updateObject(older, stale));
    assertThat(ctx.store().object(o.id()).content().extensions().get("cot")).as("blind forwarding: ignored").isEqualTo(JsonObject.builder().put("callsign", JsonString.of("ALPHA-1")).build());
  }

  @Test
  void nullRemovesAFieldAndAnEmptiedNamespaceGoes() {
    MapObject o = create(Extensions.empty());
    ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.updateObject(o, o.content()).withFields(List.of(new FieldValue("cot", "callsign", JsonString.of("ALPHA-1")))));
    MapObject set = ctx.store().object(o.id());
    ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.updateObject(set, set.content()).withFields(List.of(new FieldValue("cot", "callsign", null))));
    assertThat(ctx.store().object(o.id()).content().extensions().get("cot")).isNull();
  }

  @Test
  void badFieldsAreRejectedAtTheirIndex() {
    MapObject o = create(Extensions.empty());
    var notEditable = ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.updateObject(o, o.content())
        .withFields(List.of(new FieldValue("cot", "callsign", JsonString.of("A")), new FieldValue("cot", "staleAfter", JsonNumber.of(60)))));
    assertThat(rejected(notEditable).code()).isEqualTo(ChangeRejection.Code.VALIDATION_FAILED);
    assertThat(rejected(notEditable).details()).singleElement().satisfies(d -> {
      assertThat(d.path()).isEqualTo("/fields/1");
      assertThat(d.problem()).contains("not editable by others");
    });
    var unknown = ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.updateObject(o, o.content()).withFields(List.of(new FieldValue("cot", "colour", JsonString.of("red")))));
    assertThat(rejected(unknown).details().getFirst().problem()).contains("no plugin declares");
    var twice = ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.updateObject(o, o.content())
        .withFields(List.of(new FieldValue("cot", "callsign", JsonString.of("A")), new FieldValue("cot", "callsign", JsonString.of("B")))));
    assertThat(rejected(twice).details().getFirst().path()).isEqualTo("/fields/1");
    var badValue = ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.updateObject(o, o.content()).withFields(List.of(new FieldValue("cot", "role", JsonString.of("boss")))));
    assertThat(rejected(badValue).details().getFirst().problem()).contains("no choice");
    var required = ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.updateObject(o, o.content()).withFields(List.of(new FieldValue("cot", "role", null))));
    assertThat(rejected(required).details().getFirst().problem()).contains("required");
    assertThat(ctx.store().object(o.id()).version()).as("nothing applied").isEqualTo(o.version());
  }

  @Test
  void theOwningPluginSetsItsOwnFieldsThatOthersMayNot() {
    MapObject o = create(Extensions.empty());
    var own = ctx.store().applyAs(Actor.plugin("cot"), Change.updateObject(o, o.content()).withFields(List.of(new FieldValue("cot", "staleAfter", JsonNumber.of(60)))));
    assertThat(own).isInstanceOf(ChangeOutcome.Applied.class);
  }

  // ---------------------------------------------------------------- updates that are not saved (ADR-0041)

  @Test
  void anUnsavedMoveIsAppliedAndARestartGivesBackTheLastSavedState() {
    MapObject o = create(Extensions.empty());
    var moved = new MapObjectContent(o.content().type(), o.content().dataType(), o.content().dataSource(),
        new TimeAttributes(Instant.parse("2026-01-01T00:00:10Z"), null, null), o.content().layerId(), new Geometry.Point(Position.of(18.0900, 59.3400)),
        new Symbol(SymbolStandard.APP_6D, "10061000001211000000", new Modifiers(Map.of(), 180.0, 7.5)), null, null, o.content().label(), o.content().extensions());
    var outcome = ctx.store().applyAs(Actor.plugin("simulator"), Change.updateObject(o, moved).notSaved());
    assertThat(outcome).isInstanceOf(ChangeOutcome.Applied.class);
    assertThat(ctx.store().object(o.id()).content().geometry()).isEqualTo(new Geometry.Point(Position.of(18.0900, 59.3400)));
    assertThat(ctx.store().unsaved()).hasSize(1);
    ctx.store().restart();
    assertThat(ctx.store().object(o.id())).as("back as last saved").isEqualTo(o);
  }

  @Test
  void aSnapshotKeepsMovedPositionsOverARestart() {
    MapObject o = create(Extensions.empty());
    var moved = content(18.0900, Extensions.empty());
    ctx.store().applyAs(Actor.plugin("simulator"), Change.updateObject(o, moved).notSaved());
    ctx.store().snapshotNow();
    ctx.store().restart();
    assertThat(ctx.store().object(o.id()).content().geometry()).isEqualTo(new Geometry.Point(Position.of(18.0900, 59.3311)));
  }

  @Test
  void anUnsavedUpdateThatChangesMoreThanAMoveIsRejected() {
    MapObject o = create(Extensions.empty());
    var renamed = new MapObjectContent(o.content().type(), o.content().dataType(), o.content().dataSource(), null, o.content().layerId(),
        o.content().geometry(), o.content().symbol(), null, new dev.emcc.sdk.model.ObjectProperties("Alpha", null), o.content().label(), o.content().extensions());
    var outcome = ctx.store().applyAs(Actor.plugin("simulator"), Change.updateObject(o, renamed).notSaved());
    assertThat(rejected(outcome).details().getFirst()).satisfies(d -> {
      assertThat(d.path()).isEqualTo("/data");
      assertThat(d.problem()).contains("only the geometry");
    });
    var ownNamespace = content(18.0723, Extensions.empty().with("simulator", JsonObject.builder().put("step", JsonNumber.of(1)).build()));
    assertThat(ctx.store().applyAs(Actor.plugin("simulator"), Change.updateObject(o, ownNamespace).notSaved()))
        .as("its own namespace is no move either").isInstanceOf(ChangeOutcome.Rejected.class);
    assertThat(ctx.store().unsaved()).isEmpty();
  }

  /** The same object with one thing changed that is no move. */
  private MapObjectContent with(MapObject o, String what) {
    MapObjectContent c = o.content();
    Symbol s = java.util.Objects.requireNonNull(c.symbol());
    Layer other = ctx.store().seedLayer("Other");
    return switch (what) {
      case "sidc" -> new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(), c.geometry(),
          new Symbol(s.standard(), "10061000001211000001", s.modifiers()), c.style(), c.properties(), c.label(), c.extensions());
      case "text modifier" -> new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(), c.geometry(),
          new Symbol(s.standard(), s.sidc(), new Modifiers(Map.of(dev.emcc.sdk.model.TextModifier.values()[0], "A"), 90.0, 5.0)), c.style(), c.properties(), c.label(), c.extensions());
      case "style" -> new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(), c.geometry(), s,
          new dev.emcc.sdk.model.Style("#A33A3A", 2.0, null, null, null, null), c.properties(), c.label(), c.extensions());
      case "layer" -> new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), other.id(), c.geometry(), s, c.style(), c.properties(), c.label(), c.extensions());
      default -> throw new IllegalArgumentException(what);
    };
  }

  @org.junit.jupiter.params.ParameterizedTest
  @org.junit.jupiter.params.provider.ValueSource(strings = {"sidc", "text modifier", "style", "layer"})
  void anUnsavedUpdateMayChangeNoCoreFieldButAMove(String what) {
    MapObject o = create(Extensions.empty());
    var outcome = ctx.store().applyAs(Actor.plugin("simulator"), Change.updateObject(o, with(o, what)).notSaved());
    assertThat(rejected(outcome).details().getFirst().problem()).contains("only the geometry");
    assertThat(ctx.store().object(o.id())).isEqualTo(o);
  }

  @Test
  void aSavedUpdateAfterUnsavedMovesIsWhatARestartGivesBack() {
    MapObject o = create(Extensions.empty());
    ctx.store().applyAs(Actor.plugin("simulator"), Change.updateObject(o, content(18.0900, Extensions.empty())).notSaved());
    MapObject moved = ctx.store().object(o.id());
    ctx.store().applyAs(Actor.plugin("simulator"), Change.updateObject(moved, content(18.1000, Extensions.empty())));
    MapObject savedState = ctx.store().object(o.id());
    ctx.store().applyAs(Actor.plugin("simulator"), Change.updateObject(savedState, content(18.1100, Extensions.empty())).notSaved());
    ctx.store().restart();
    assertThat(ctx.store().object(o.id())).isEqualTo(savedState);
  }

  @Test
  void createsAndDeletesAreSavedOverARestart() {
    MapObject kept = create(Extensions.empty());
    MapObject gone = create(Extensions.empty());
    ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.deleteObject(gone));
    ctx.store().restart();
    assertThat(ctx.store().objects()).containsExactly(kept);
  }

  @Test
  void aRestartSendsSubscribersANewSnapshotAndASubmittedMoveIsNotSaved() {
    var updates = new ArrayList<StoreUpdate>();
    record Got(StoreUpdate update) implements Message {}
    record Answer(ChangeOutcome outcome) implements Message {}
    WorkerRef<Message> w = ctx.workers().spawn(WorkerSpec.of("sim", Message.class, () -> (m, c) -> {
      if (m instanceof Got g) {
        updates.add(g.update());
      }
    }));
    MapObject o = create(Extensions.empty());
    ctx.store().subscribe(ObjectQuery.all(), w, Got::new);
    ctx.store().submit(Change.updateObject(o, content(18.0900, Extensions.empty())).notSaved(), Duration.ofSeconds(5), w, Answer::new);
    ctx.runUntilIdle();
    assertThat(ctx.store().unsaved()).hasSize(1);
    ctx.store().restart();
    ctx.runUntilIdle();
    assertThat(updates).last().isInstanceOfSatisfying(StoreUpdate.Snapshot.class,
        s -> assertThat(s.objects()).singleElement().satisfies(x -> assertThat(x).isEqualTo(o)));
  }
}
