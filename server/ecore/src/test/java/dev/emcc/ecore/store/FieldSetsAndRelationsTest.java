package dev.emcc.ecore.store;

import static dev.emcc.ecore.store.Fixtures.DRAW;
import static dev.emcc.ecore.store.Fixtures.LAYERS;
import static dev.emcc.ecore.store.Fixtures.create;
import static dev.emcc.ecore.store.Fixtures.layer;
import static dev.emcc.ecore.store.Fixtures.symbol;
import static dev.emcc.ecore.store.Fixtures.update;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.FieldValue;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Relation;
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
 * SDK 1.4.0 part 3 in the object store: an object's field sets (ADR-0050; rule 5's third exception,
 * rule 18) and relations (ADR-0051, CR-0031; rule 17), the order of their checks, and the move check.
 */
class FieldSetsAndRelationsTest {

  private static final Instant NOW = Instant.parse("2026-11-06T10:00:00.123Z");
  private static final Actor GMTI = Actor.plugin("gmti");

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final PictureState state = new PictureState();
  private final ObjectStore store = new ObjectStore(state, runtime, Clock.fixed(NOW, ZoneOffset.UTC), DataTypes.of(Set.of()),
      DeclaredFields.of(List.of(), Set.of("cot.unit", "ais.ship"), Set.of("gmti.pairing")), new StoreCounts());
  /** The same picture as an earlier run left it, with plugins that are no longer loaded. */
  private final ObjectStore earlier = new ObjectStore(state, runtime, Clock.fixed(NOW, ZoneOffset.UTC), DataTypes.of(Set.of()),
      DeclaredFields.of(List.of(), Set.of("old.set"), Set.of("radar.track")), new StoreCounts());
  private final UUID layerId = UUID.randomUUID();
  private final UUID objectId = UUID.randomUUID();
  private final UUID track1 = UUID.randomUUID();
  private final UUID track2 = UUID.randomUUID();

  @BeforeEach
  void aLayer() {
    assertThat(store.apply(create(layerId, layer("Units"), LAYERS), Requester.NO_USER)).isInstanceOf(ChangeOutcome.Applied.class);
  }

  @AfterEach
  void close() {
    runtime.close();
  }

  private static MapObjectContent unit(UUID layer, List<String> sets, List<Relation> relations) {
    return symbol(layer, 15.6, 60.1).withFieldSets(sets).withRelations(relations);
  }

  private MapObject applied(ChangeRequest request) {
    ChangeOutcome outcome = store.apply(request, Requester.NO_USER);
    assertThat(outcome).isInstanceOf(ChangeOutcome.Applied.class);
    return (MapObject) ((ChangeOutcome.Applied) outcome).event().state();
  }

  private ChangeRejection refused(ChangeRequest request) {
    long before = state.sequenceNo();
    MapObject object = state.object(objectId);
    ChangeOutcome outcome = store.apply(request, Requester.NO_USER);
    assertThat(outcome).isInstanceOf(ChangeOutcome.Rejected.class);
    assertThat(state.sequenceNo()).as("no number used").isEqualTo(before);
    assertThat(state.object(objectId)).as("nothing changed").isEqualTo(object);
    return ((ChangeOutcome.Rejected) outcome).rejection();
  }

  private static void invalidAt(ChangeRejection rejection, String path, String text) {
    assertThat(rejection.code()).isEqualTo(ChangeRejection.Code.VALIDATION_FAILED);
    assertThat(rejection.details()).extracting(ChangeRejection.Detail::path).containsExactly(path);
    assertThat(rejection.message()).contains(text);
  }

  private static ChangeRequest withFields(ChangeRequest r, FieldValue... fields) {
    return new ChangeRequest(r.requestId(), r.entityType(), r.operation(), r.entityId(), r.baseVersion(), r.data(), r.externalRef(),
        r.source(), List.of(fields));
  }

  private static ChangeRequest withRef(ChangeRequest r, ExternalRef ref) {
    return new ChangeRequest(r.requestId(), r.entityType(), r.operation(), r.entityId(), r.baseVersion(), r.data(), ref, r.source(),
        r.fields());
  }

  @Test
  void aCreateKeepsItsDeclaredSetsAndRelationsInTheirOrder() {
    var relations = List.of(new Relation("gmti.pairing", track1), new Relation("gmti.pairing", track2));

    MapObject created = applied(create(objectId, unit(layerId, List.of("cot.unit", "ais.ship"), relations), DRAW));

    assertThat(created.content().fieldSets()).containsExactly("cot.unit", "ais.ship");
    assertThat(created.content().relations()).isEqualTo(relations);
  }

  @Test
  void anUpdateWithoutSetsKeepsTheStoredOnesAndAListedOneIsAddedAfterThem() {
    applied(create(objectId, unit(layerId, List.of("cot.unit"), List.of()), DRAW));

    MapObject kept = applied(update(objectId, 1, unit(layerId, List.of(), List.of()), DRAW));
    MapObject added = applied(update(objectId, 2, unit(layerId, List.of("ais.ship", "cot.unit"), List.of()), DRAW));

    assertThat(kept.content().fieldSets()).as("an absent list keeps the stored one (rule 5's third exception)").containsExactly("cot.unit");
    assertThat(added.content().fieldSets()).as("nothing removes a set; a new one comes after").containsExactly("cot.unit", "ais.ship");
  }

  @Test
  void aSetNoLoadedPluginDeclaresIsRefusedWhenAddedAndKeptWhenStored() {
    invalidAt(refused(create(objectId, unit(layerId, List.of("cot.unit", "nvg.layer"), List.of()), DRAW)),
        "/data/fieldSets/1", "no loaded plugin declares the field set nvg.layer (model rule 18)");

    // A set of a plugin no longer loaded, stored before: kept and not checked again.
    assertThat(earlier.apply(create(objectId, unit(layerId, List.of("old.set"), List.of()), DRAW), Requester.NO_USER))
        .isInstanceOf(ChangeOutcome.Applied.class);
    MapObject updated = applied(update(objectId, 1, unit(layerId, List.of("old.set", "ais.ship"), List.of()), DRAW));
    assertThat(updated.content().fieldSets()).containsExactly("old.set", "ais.ship");
    invalidAt(refused(update(objectId, 2, unit(layerId, List.of("ais.ship", "other.set"), List.of()), DRAW)),
        "/data/fieldSets/1", "other.set");
  }

  @Test
  void aRelationOfAnUndeclaredKindIsRefusedUnlessTheStoredObjectCarriesThatEntry() {
    invalidAt(refused(create(objectId, unit(layerId, List.of(), List.of(new Relation("gmti.pairing", track1),
        new Relation("radar.track", track2))), DRAW)), "/data/relations/1/kind", "no loaded plugin declares the relation kind radar.track (model rule 17)");

    // Stored by a plugin no longer loaded: its entry passes on update, a new entry of its kind does not.
    var old = new Relation("radar.track", track1);
    assertThat(earlier.apply(create(objectId, unit(layerId, List.of(), List.of(old)), DRAW), Requester.NO_USER))
        .isInstanceOf(ChangeOutcome.Applied.class);
    MapObject paired = applied(update(objectId, 1, unit(layerId, List.of(), List.of(old, new Relation("gmti.pairing", track2))), GMTI));
    assertThat(paired.content().relations()).containsExactly(old, new Relation("gmti.pairing", track2));
    invalidAt(refused(update(objectId, 2, unit(layerId, List.of(), List.of(old, new Relation("radar.track", track2))), GMTI)),
        "/data/relations/1/kind", "radar.track");
  }

  @Test
  void relationsAreReplacedAsAWholeAndTheOtherObjectIsNeverChecked() {
    UUID nowhere = UUID.randomUUID(); // no such object
    applied(create(objectId, unit(layerId, List.of(), List.of(new Relation("gmti.pairing", nowhere))), GMTI));

    MapObject emptied = applied(update(objectId, 1, unit(layerId, List.of(), List.of()), GMTI));

    assertThat(emptied.content().relations()).as("a sensor can empty its list (rule 5)").isEmpty();
    applied(create(track1, symbol(layerId, 15.7, 60.2), DRAW));
    applied(update(objectId, 2, unit(layerId, List.of(), List.of(new Relation("gmti.pairing", track1))), GMTI));
    applied(Fixtures.delete(track1, dev.emcc.sdk.model.EntityType.OBJECT, DRAW));
    assertThat(state.object(objectId).content().relations()).as("nothing cascades").containsExactly(new Relation("gmti.pairing", track1));
  }

  @Test
  void theChecksRunAfterRule16AndRule17BeforeRule18BeforeTheDeclaredFields() {
    ExternalRef ref = new ExternalRef("tak", "ANDROID-1");
    applied(withRef(create(UUID.randomUUID(), unit(layerId, List.of(), List.of()), DRAW), ref));
    var bad = unit(layerId, List.of("nvg.layer"), List.of(new Relation("radar.track", track1)));

    assertThat(refused(withRef(create(objectId, bad, DRAW), ref)).code()).as("rule 16 first").isEqualTo(ChangeRejection.Code.EXTERNAL_REF_EXISTS);
    ChangeRequest unknownField = withFields(create(objectId, bad, DRAW), new FieldValue("cot", "callsign", JsonString.of("A")));
    invalidAt(refused(unknownField), "/data/relations/0/kind", "rule 17");
    invalidAt(refused(withFields(create(objectId, unit(layerId, List.of("nvg.layer"), List.of()), DRAW),
        new FieldValue("cot", "callsign", JsonString.of("A")))), "/data/fieldSets/0", "rule 18");
    invalidAt(refused(withFields(create(objectId, unit(layerId, List.of("cot.unit"), List.of()), DRAW),
        new FieldValue("cot", "callsign", JsonString.of("A")))), "/fields/0", "ADR-0038");
  }

  @Test
  void aMoveKeepsSetsAndRelationsAndAChangeOfThemIsNoMove() {
    var pairing = List.of(new Relation("gmti.pairing", track1));
    MapObjectContent placed = unit(layerId, List.of("cot.unit"), pairing);
    applied(create(objectId, placed, GMTI));
    MapObjectContent moved = new MapObjectContent(placed.type(), placed.dataType(), placed.dataSource(), placed.time(), layerId,
        new Geometry.Point(Position.of(15.8, 60.3)), placed.symbol(), placed.style(), placed.properties(), placed.label(),
        placed.extensions(), placed.fieldSets(), placed.relations());

    assertThat(store.apply(update(objectId, 1, moved, GMTI), Requester.NO_USER, true)).as("a move").isInstanceOf(ChangeOutcome.Applied.class);
    assertThat(state.object(objectId).content().relations()).isEqualTo(pairing);
    assertThat(store.apply(update(objectId, 2, moved.withFieldSets(List.of()), GMTI), Requester.NO_USER, true))
        .as("an absent list keeps the sets, so still a move").isInstanceOf(ChangeOutcome.Applied.class);

    for (MapObjectContent notMove : List.of(moved.withRelations(List.of(new Relation("gmti.pairing", track2))),
        moved.withRelations(List.of()), moved.withFieldSets(List.of("ais.ship")))) {
      ChangeOutcome outcome = store.apply(update(objectId, 3, notMove, GMTI), Requester.NO_USER, true);
      assertThat(outcome).as(notMove.relations() + " " + notMove.fieldSets()).isInstanceOf(ChangeOutcome.Rejected.class);
    }
  }
}
