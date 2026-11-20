package dev.emcc.ecore.store;

import static dev.emcc.ecore.store.Fixtures.DRAW;
import static dev.emcc.ecore.store.Fixtures.LAYERS;
import static dev.emcc.ecore.store.Fixtures.create;
import static dev.emcc.ecore.store.Fixtures.layer;
import static dev.emcc.ecore.store.Fixtures.symbol;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.TimeAttributes;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** When objects expire and when ECore removes them (data model rule 15). */
class RemovalTest {

  private static final Instant NOW = Instant.parse("2026-10-12T12:00:00Z");
  private static final Instant CREATED = NOW.minusSeconds(600); // the store's clock when the objects were made

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final PictureState state = new PictureState();
  private final UUID layerId = UUID.randomUUID();

  @AfterEach
  void close() {
    runtime.close();
  }

  private static MapObjectContent of(UUID layerId, String dataType, TimeAttributes time) {
    MapObjectContent c = symbol(layerId, 11.97, 57.71);
    return new MapObjectContent(c.type(), dataType, "tak-north", time, c.layerId(), c.geometry(), c.symbol(), c.style(),
        c.properties(), c.label(), c.extensions());
  }

  /** Makes an object as the store would at {@link #CREATED}. */
  private MapObject made(String dataType, TimeAttributes time) {
    ObjectStore then =
        new ObjectStore(state, runtime, Clock.fixed(CREATED, ZoneOffset.UTC), DataTypes.of(Set.of("cot.track", "cot.alert")));
    if (state.layer(layerId) == null) {
      then.apply(create(layerId, layer("Tracks"), LAYERS), Requester.NO_USER);
    }
    ChangeOutcome outcome = then.apply(create(UUID.randomUUID(), of(layerId, dataType, time), DRAW), Requester.NO_USER);
    return (MapObject) ((ChangeOutcome.Applied) outcome).event().state();
  }

  @Test
  void anObjectExpiresAtItsExpiresElseAfterItsObservationElseNotByItsDataType() {
    Removal removal = new Removal(300L, 0);
    Instant observed = NOW.minusSeconds(100);

    assertThat(removal.expiresAt(made("cot.track", new TimeAttributes(null, null, NOW.plusSeconds(5))))).isEqualTo(NOW.plusSeconds(5));
    assertThat(removal.expiresAt(made("cot.track", new TimeAttributes(observed, null, null)))).isEqualTo(observed.plusSeconds(300));
    assertThat(removal.expiresAt(made("cot.track", new TimeAttributes(null, null, null))))
        .as("without time.observed it does not expire by its data type (1.5.0, CR-0038 point 9); before, it did 300 s after its last change")
        .isNull();
    assertThat(removal.due(made("cot.track", null), NOW.plusSeconds(1_000_000))).as("nor without time at all").isFalse();
    assertThat(new Removal(null, 0).expiresAt(made("cot.track", new TimeAttributes(observed, null, null))))
        .as("without expiresAfterSeconds it never expires").isNull();
  }

  @Test
  void anObjectIsDueRemoveAfterExpirySecondsAfterItExpired() {
    MapObject expired = made("cot.track", new TimeAttributes(null, null, NOW.minusSeconds(60)));

    assertThat(new Removal(null, 0).due(expired, NOW)).isTrue();
    assertThat(new Removal(null, 60).due(expired, NOW)).as("exactly then").isTrue();
    assertThat(new Removal(null, 61).due(expired, NOW)).isFalse();
  }

  @Test
  void theStoreRemovesDueObjectsByOrdinaryDeletesOfCoreAndOnlyForTypesWithARemoval() {
    MapObject due = made("cot.track", new TimeAttributes(null, null, NOW.minusSeconds(1)));
    MapObject fresh = made("cot.track", new TimeAttributes(null, null, NOW.plusSeconds(60)));
    MapObject otherType = made("cot.alert", new TimeAttributes(null, null, NOW.minusSeconds(1)));
    ObjectStore store =
        new ObjectStore(state, runtime, Clock.fixed(NOW, ZoneOffset.UTC), DataTypes.of(Set.of("cot.track", "cot.alert")));
    long before = state.sequenceNo();

    int removed = store.removeExpired(Map.of("cot.track", new Removal(null, 0)), 1_000);

    assertThat(removed).isEqualTo(1);
    assertThat(state.object(due.id())).isNull();
    assertThat(state.object(fresh.id())).isNotNull();
    assertThat(state.object(otherType.id())).as("its type has no removal").isNotNull();
    assertThat(state.sequenceNo()).as("one ordinary change").isEqualTo(before + 1);
  }

  @Test
  void atMostMaxObjectsAreRemovedPerLook() {
    for (int i = 0; i < 5; i++) {
      made("cot.track", new TimeAttributes(null, null, NOW.minusSeconds(1)));
    }
    ObjectStore store = new ObjectStore(state, runtime, Clock.fixed(NOW, ZoneOffset.UTC), DataTypes.of(Set.of("cot.track")));

    assertThat(store.removeExpired(Map.of("cot.track", new Removal(null, 0)), 3)).isEqualTo(3);
    assertThat(store.removeExpired(Map.of("cot.track", new Removal(null, 0)), 3)).isEqualTo(2);
    assertThat(store.removeExpired(Map.of(), 3)).isZero();
  }

  @Test
  void theDeleteIsByCoreWithItsChangeEvent() {
    MapObject due = made("cot.track", new TimeAttributes(null, null, NOW.minusSeconds(1)));
    dev.emcc.ecore.runtime.Probe<ChangeEvent> events = new dev.emcc.ecore.runtime.Probe<>();
    var listener = runtime.owner("core-test").spawn(
        dev.emcc.ecore.runtime.WorkerOptions.<ChangeEvent>of("listener", () -> (e, ctx) -> events.add(e)));
    runtime.owner("core-test").subscribe(ObjectStore.CHANGES, listener, StoreChange::event);
    ObjectStore store = new ObjectStore(state, runtime, Clock.fixed(NOW, ZoneOffset.UTC), DataTypes.of(Set.of("cot.track")));

    store.removeExpired(Map.of("cot.track", new Removal(null, 0)), 10);

    ChangeEvent event = events.next();
    assertThat(event.operation()).isEqualTo(Operation.DELETE);
    assertThat(event.entityId()).isEqualTo(due.id());
    assertThat(event.by().plugin()).isEqualTo("core");
  }
}
