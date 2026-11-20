package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.DeclaredField;
import dev.emcc.sdk.FieldSet;
import dev.emcc.sdk.RelationKind;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Relation;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** SDK 1.4.0 part 3: the fake store's field sets (rule 5's third exception, rule 18) and relations (rule 17), as ECore has them. */
class FakeStorePart3Test {

  private static final DeclaredField CALLSIGN =
      new DeclaredField("cot", "callsign", DeclaredField.Type.TEXT, "Callsign", null, null, null, null, 64, false, List.of(), true, List.of());
  private static final UUID A = UUID.fromString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e21");
  private static final UUID B = UUID.fromString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e22");

  private final FakePluginContext ctx = FakePluginContext.builder("simulator")
      .declaredFields(CALLSIGN)
      .fieldSets(new FieldSet("cot", "unit", "CoT unit", List.of("callsign")))
      .relationKinds(new RelationKind("gmti.pairing", "GMTI Pairing", RelationKind.Line.of("#FFFF00"), false))
      .build();
  private final Layer layer = ctx.store().seedLayer("Simulation");

  private MapObjectContent content() {
    // lon differs from lat, so a swapped order would show
    return new MapObjectContent("core.symbol", MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, layer.id(),
        new Geometry.Point(Position.of(15.2003, 58.4108)), new Symbol(SymbolStandard.APP_6D, "10030100001101000000", null),
        null, null, layer.content().label(), Extensions.empty());
  }

  private ChangeOutcome apply(Change change) {
    return ctx.store().applyAs(Actor.plugin("simulator"), change);
  }

  private MapObject create(MapObjectContent c) {
    return (MapObject) ((ChangeOutcome.Applied) apply(Change.createObject(UUID.randomUUID(), c))).event().state();
  }

  private static ChangeRejection.Detail rejected(ChangeOutcome outcome) {
    var r = ((ChangeOutcome.Rejected) outcome).rejection();
    assertThat(r.code()).isEqualTo(ChangeRejection.Code.VALIDATION_FAILED);
    return r.details().getFirst();
  }

  @Test
  void anUpdateWithoutSetsKeepsThemAndAListedSetIsAdded() {
    MapObject o = create(content().withFieldSet("cot.unit"));
    assertThat(o.content().fieldSets()).containsExactly("cot.unit");
    apply(Change.updateObject(o, content()));
    assertThat(ctx.store().object(o.id()).content().fieldSets()).as("absent keeps the stored list").containsExactly("cot.unit");
    apply(Change.updateObject(ctx.store().object(o.id()), content().withFieldSet("cot.unit")));
    assertThat(ctx.store().object(o.id()).content().fieldSets()).as("listed again, kept once").containsExactly("cot.unit");
  }

  @Test
  void aSetNoPluginDeclaresIsRejectedWhenAddedButKeptWhenStored() {
    assertThat(rejected(apply(Change.createObject(UUID.randomUUID(), content().withFieldSets(List.of("cot.unit", "removed.unit"))))).path())
        .isEqualTo("/data/fieldSets/1");
    MapObject stored = new MapObject(UUID.randomUUID(), 1, content().withFieldSet("removed.unit"), ctxMeta());
    ctx.store().seed(stored);
    assertThat(apply(Change.updateObject(stored, content().withFieldSets(List.of("removed.unit", "cot.unit")))))
        .as("a stored set of a removed plugin passes").isInstanceOf(ChangeOutcome.Applied.class);
    assertThat(ctx.store().object(stored.id()).content().fieldSets()).containsExactly("removed.unit", "cot.unit");
  }

  @Test
  void relationsAreReplacedAsAWholeAndAnUpdateWithoutThemEmptiesThem() {
    MapObject o = create(content().withRelations(List.of(new Relation("gmti.pairing", A), new Relation("gmti.pairing", B))));
    apply(Change.updateObject(o, content().withRelations(Relation.replace(o.content().relations(), "gmti.pairing", List.of(B)))));
    assertThat(ctx.store().object(o.id()).content().relations()).containsExactly(new Relation("gmti.pairing", B));
    apply(Change.updateObject(ctx.store().object(o.id()), content()));
    assertThat(ctx.store().object(o.id()).content().relations()).isEmpty();
  }

  @Test
  void anUndeclaredKindIsRejectedOnCreateAndForNewEntriesButAStoredEntryPasses() {
    assertThat(rejected(apply(Change.createObject(UUID.randomUUID(), content().withRelations(List.of(new Relation("gmti.pairing", A), new Relation("removed.link", B)))))).path())
        .isEqualTo("/data/relations/1/kind");
    MapObject stored = new MapObject(UUID.randomUUID(), 1, content().withRelations(List.of(new Relation("removed.link", A))), ctxMeta());
    ctx.store().seed(stored);
    assertThat(apply(Change.updateObject(stored, content().withRelations(List.of(new Relation("removed.link", A), new Relation("gmti.pairing", B))))))
        .as("the stored entry passes, the new one is declared").isInstanceOf(ChangeOutcome.Applied.class);
    MapObject now = ctx.store().object(stored.id());
    assertThat(rejected(apply(Change.updateObject(now, content().withRelations(List.of(new Relation("removed.link", A), new Relation("removed.link", B)))))).path())
        .as("a new entry of an undeclared kind, though the object carries that kind").isEqualTo("/data/relations/1/kind");
  }

  @Test
  void theOtherObjectIsNeverChecked() {
    UUID nowhere = UUID.fromString("0192a5c4-3b1e-7c2d-9f00-0000000000ff");
    assertThat(apply(Change.createObject(UUID.randomUUID(), content().withRelations(List.of(new Relation("gmti.pairing", nowhere))))))
        .isInstanceOf(ChangeOutcome.Applied.class);
  }

  @Test
  void aSetThatNamesAnUndeclaredFieldIsRefusedAsECoreDoes() {
    assertThatThrownBy(() -> FakePluginContext.builder("cot").declaredFields(CALLSIGN).fieldSets(new FieldSet("cot", "unit", "CoT unit", List.of("callsign", "remarks"))))
        .isInstanceOf(IllegalArgumentException.class);
  }

  private dev.emcc.sdk.model.Meta ctxMeta() {
    var audit = new dev.emcc.sdk.model.Meta.Audit(ctx.clock(), Actor.plugin("removed"));
    return new dev.emcc.sdk.model.Meta(audit, audit, null);
  }
}
