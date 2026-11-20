package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.DataType;
import dev.emcc.sdk.DeclaredField;
import dev.emcc.sdk.FieldSet;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** SDK 1.5.0 part 1 (CR-0038 point 3, model rule 21): the fake store adds a data type's sets to symbols, as ECore does (owner, NO A). */
class FakeStoreDataTypeSetsTest {

  private static final DeclaredField MMSI =
      new DeclaredField("ais", "mmsi", DeclaredField.Type.TEXT, "MMSI", null, null, null, null, 9, false, List.of(), true, List.of());
  private static final DeclaredField CALLSIGN =
      new DeclaredField("cot", "callsign", DeclaredField.Type.TEXT, "Callsign", null, null, null, null, 64, false, List.of(), true, List.of());

  private final FakePluginContext ctx = FakePluginContext.builder("draw-symbols")
      .declaredFields(MMSI, CALLSIGN)
      .fieldSets(new FieldSet("ais", "ship", "AIS ship", List.of("mmsi")), new FieldSet("cot", "unit", "CoT unit", List.of("callsign")))
      .dataTypes(
          new DataType("ais.vessel", "AIS vessel", null, "ais", new DataType.Defaults(600L, true, 1800L)).withFieldSets("ais.ship"),
          new DataType("cot.cot", "CoT", null, "cot", new DataType.Defaults(null, true, 600L)).withFieldSets("cot.unit"))
      .build();
  private final Layer layer = ctx.store().seedLayer("Drawn");

  private MapObjectContent content(String dataType) {
    // lon differs from lat, so a swapped order would show
    return new MapObjectContent("core.symbol", dataType, MapObjectContent.MANUAL, null, layer.id(),
        new Geometry.Point(Position.of(15.2003, 58.4108)), new Symbol(SymbolStandard.APP_6D, "10030100001101000000", null),
        null, null, layer.content().label(), Extensions.empty());
  }

  private MapObject applied(Change change) {
    return (MapObject) ((ChangeOutcome.Applied) ctx.store().applyAs(Actor.plugin("draw-symbols"), change)).event().state();
  }

  private MapObjectContent moved(String dataType) {
    MapObjectContent c = content(dataType);
    return new MapObjectContent(c.type(), c.dataType(), c.dataSource(), null, c.layerId(), new Geometry.Point(Position.of(15.3003, 58.5108)), c.symbol(),
        null, null, c.label(), Extensions.empty());
  }

  private dev.emcc.sdk.model.Meta meta() {
    var audit = new dev.emcc.sdk.model.Meta.Audit(ctx.clock(), Actor.plugin("ais"));
    return new dev.emcc.sdk.model.Meta(audit, audit, null);
  }

  @Test
  void aShapeGetsNoSetsWhateverItsDataType() {
    MapObjectContent c = content("ais.vessel");
    var shape = new MapObjectContent(MapObjectContent.SHAPE, c.dataType(), c.dataSource(), null, c.layerId(),
        new Geometry.Point(Position.of(15.2003, 58.4108)), null, null, null, c.label(), Extensions.empty());
    MapObject o = applied(Change.createObject(UUID.randomUUID(), shape));
    assertThat(o.content().fieldSets()).isEmpty();
  }

  @Test
  void aCreateGetsItsDataTypesSets() {
    MapObject o = applied(Change.createObject(UUID.randomUUID(), content("ais.vessel")));
    assertThat(o.content().fieldSets()).containsExactly("ais.ship");
    MapObject general = applied(Change.createObject(UUID.randomUUID(), content(MapObjectContent.GENERAL)));
    assertThat(general.content().fieldSets()).as("core.general has none").isEmpty();
  }

  @Test
  void aListedSetComesFirstAndTheDataTypesOnceAfterIt() {
    MapObject o = applied(Change.createObject(UUID.randomUUID(), content("ais.vessel").withFieldSets(List.of("cot.unit", "ais.ship"))));
    assertThat(o.content().fieldSets()).containsExactly("cot.unit", "ais.ship");
  }

  @Test
  void aDataTypeChangeAddsTheNewTypesSetsAndKeepsTheOld() {
    MapObject o = applied(Change.createObject(UUID.randomUUID(), content("ais.vessel")));
    MapObject cot = applied(Change.updateObject(o, content("cot.cot")));
    assertThat(cot.content().fieldSets()).containsExactly("ais.ship", "cot.unit");
  }

  @Test
  void anUpdateThatKeepsTheDataTypeAddsNothing() {
    MapObject o = applied(Change.createObject(UUID.randomUUID(), content(MapObjectContent.GENERAL)));
    MapObject general = applied(Change.updateObject(o, moved(MapObjectContent.GENERAL)));
    assertThat(general.content().fieldSets()).isEmpty();
    // A stored object of the type without its set (from before 1.5.0) is not migrated by an update that keeps the type.
    MapObject old = new MapObject(UUID.randomUUID(), 1, content("ais.vessel"), meta());
    ctx.store().seed(old);
    MapObject kept = applied(Change.updateObject(old, moved("ais.vessel")));
    assertThat(kept.content().fieldSets()).isEmpty();
  }
}
