package dev.emcc.ecore.store;

import static dev.emcc.ecore.store.Fixtures.DRAW;
import static dev.emcc.ecore.store.Fixtures.LAYERS;
import static dev.emcc.ecore.store.Fixtures.create;
import static dev.emcc.ecore.store.Fixtures.layer;
import static dev.emcc.ecore.store.Fixtures.p;
import static dev.emcc.ecore.store.Fixtures.polygon;
import static dev.emcc.ecore.store.Fixtures.shape;
import static dev.emcc.ecore.store.Fixtures.symbol;
import static dev.emcc.ecore.store.Fixtures.update;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * SDK 1.5.0 part 1 in the object store (CR-0038 point 3, data model rule 21): a symbol's create, and
 * its change of data type, add the data type's field sets; shapes and graphics get none (owner, NO A).
 */
class DataTypeSetsTest {

  private static final Instant NOW = Instant.parse("2026-11-10T10:00:00.123Z");

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final PictureState state = new PictureState();
  private final ObjectStore store = new ObjectStore(state, runtime, Clock.fixed(NOW, ZoneOffset.UTC),
      DataTypes.of(Map.of("ais.vessel", List.of("ais.ship", "ais.voyage"), "cot.cot", List.of("cot.unit"), "cot.alert", List.of())),
      DeclaredFields.of(List.of(), Set.of("ais.ship", "ais.voyage", "cot.unit", "cot.motion"), Set.of()), new StoreCounts());
  private final UUID layerId = UUID.randomUUID();
  private final UUID objectId = UUID.randomUUID();

  @BeforeEach
  void aLayer() {
    assertThat(store.apply(create(layerId, layer("Units"), LAYERS), Requester.NO_USER)).isInstanceOf(ChangeOutcome.Applied.class);
  }

  @AfterEach
  void close() {
    runtime.close();
  }

  private static MapObjectContent of(MapObjectContent c, String dataType, List<String> sets) {
    return new MapObjectContent(c.type(), dataType, c.dataSource(), c.time(), c.layerId(), c.geometry(), c.symbol(), c.style(),
        c.properties(), c.label(), c.extensions(), sets, c.relations());
  }

  private MapObjectContent unit(String dataType, String... sets) {
    return of(symbol(layerId, 15.6, 60.1), dataType, List.of(sets));
  }

  private MapObject applied(ChangeRequest request) {
    ChangeOutcome outcome = store.apply(request, Requester.NO_USER);
    assertThat(outcome).isInstanceOf(ChangeOutcome.Applied.class);
    return (MapObject) ((ChangeOutcome.Applied) outcome).event().state();
  }

  @Test
  void aSymbolsCreateAddsItsDataTypesSetsAfterItsOwnInTheDataTypesOrder() {
    MapObject created = applied(create(objectId, unit("ais.vessel", "cot.motion"), DRAW));

    assertThat(created.content().fieldSets()).containsExactly("cot.motion", "ais.ship", "ais.voyage");
    assertThat(state.object(objectId).content().fieldSets()).as("as stored").containsExactly("cot.motion", "ais.ship", "ais.voyage");
  }

  @Test
  void aSetTheRequestListsItselfComesOnceWhereTheRequestPutIt() {
    MapObject created = applied(create(objectId, unit("ais.vessel", "ais.voyage"), DRAW));

    assertThat(created.content().fieldSets()).containsExactly("ais.voyage", "ais.ship");
  }

  @Test
  void aChangeOfDataTypeAddsTheNewTypesSetsAndKeepsTheCarriedOnes() {
    applied(create(objectId, unit("cot.cot"), DRAW));

    MapObject changed = applied(update(objectId, 1, unit("ais.vessel"), DRAW));

    assertThat(changed.content().fieldSets()).as("the old type's set is kept (ADR-0050 point 8)")
        .containsExactly("cot.unit", "ais.ship", "ais.voyage");
  }

  @Test
  void anUpdateThatKeepsTheDataTypeAddsNothingSoStoredObjectsAreNotMigrated() {
    applied(create(objectId, unit("cot.alert"), DRAW));
    // An object stored before its type named a set: a later update with the same type adds none.
    ObjectStore later = new ObjectStore(state, runtime, Clock.fixed(NOW, ZoneOffset.UTC),
        DataTypes.of(Map.of("cot.alert", List.of("cot.unit"))), DeclaredFields.of(List.of(), Set.of("cot.unit"), Set.of()), new StoreCounts());

    ChangeOutcome outcome = later.apply(update(objectId, 1, unit("cot.alert"), DRAW), Requester.NO_USER);

    assertThat(((MapObject) ((ChangeOutcome.Applied) outcome).event().state()).content().fieldSets()).isEmpty();
  }

  @Test
  void shapesGetNoneWhateverTheirDataType() {
    MapObjectContent area = of(shape(layerId, polygon(p(15, 60), p(16, 60), p(16, 61), p(15, 60))), "ais.vessel", List.of());

    MapObject created = applied(create(objectId, area, DRAW));
    MapObject changed = applied(update(objectId, 1, of(area, "cot.cot", List.of()), DRAW));

    assertThat(created.content().fieldSets()).isEmpty();
    assertThat(changed.content().fieldSets()).isEmpty();
  }

  @Test
  void coreGeneralAndATypeWithoutSetsAddNone() {
    assertThat(applied(create(objectId, unit("core.general"), DRAW)).content().fieldSets()).isEmpty();
    assertThat(applied(update(objectId, 1, unit("cot.alert"), DRAW)).content().fieldSets()).isEmpty();
  }

  @Test
  void theAddedSetsComeAfterRule18sCheckWhichStillRefusesAnUndeclaredListedSet() {
    ChangeOutcome outcome = store.apply(create(objectId, unit("ais.vessel", "old.set"), DRAW), Requester.NO_USER);

    assertThat(outcome).isInstanceOf(ChangeOutcome.Rejected.class);
    ChangeRejection rejection = ((ChangeOutcome.Rejected) outcome).rejection();
    assertThat(rejection.details()).extracting(ChangeRejection.Detail::path).containsExactly("/data/fieldSets/0");
    assertThat(state.object(objectId)).isNull();
  }
}
