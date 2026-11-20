package dev.emcc.ecore.store;

import static dev.emcc.ecore.store.Fixtures.DRAW;
import static dev.emcc.ecore.store.Fixtures.LAYERS;
import static dev.emcc.ecore.store.Fixtures.create;
import static dev.emcc.ecore.store.Fixtures.delete;
import static dev.emcc.ecore.store.Fixtures.layer;
import static dev.emcc.ecore.store.Fixtures.symbol;
import static dev.emcc.ecore.store.Fixtures.update;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.MapObject;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.stream.IntStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Reading objects by id and a layer's objects page by page (CR-0015 items 8 and 9). */
class ObjectQueriesTest {

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final PictureState state = new PictureState();
  private final ObjectStore store = new ObjectStore(state, runtime, Clock.fixed(Instant.parse("2026-10-16T10:00:00Z"), ZoneOffset.UTC),
      new DataTypes());
  private final UUID layerId = UUID.randomUUID();
  private final UUID otherLayerId = UUID.randomUUID();

  @AfterEach
  void close() {
    runtime.close();
  }

  /** Ids in the order of their text; the later ones have the top bit set (negative as signed longs). */
  private static final List<UUID> IDS = List.of(
      UUID.fromString("0199e8a0-0000-7000-8000-000000000001"),
      UUID.fromString("0199e8a0-0000-7000-8000-000000000002"),
      UUID.fromString("0199e8a0-0000-7000-c000-000000000003"),
      UUID.fromString("7fffffff-0000-7000-8000-000000000004"),
      UUID.fromString("80000000-0000-7000-8000-000000000005"),
      UUID.fromString("ffffffff-0000-7000-8000-000000000006"));

  private void apply(ChangeRequest request) {
    assertThat(store.apply(request, Requester.NO_USER)).isInstanceOf(ChangeOutcome.Applied.class);
  }

  private void withLayers() {
    apply(create(layerId, layer("Own"), LAYERS));
    apply(create(otherLayerId, layer("Other"), LAYERS));
  }

  /** Creates the objects in a shuffled order, so that the order of creation is not the order of the ids. */
  private void withObjects(List<UUID> ids, UUID layer) {
    List<UUID> shuffled = new ArrayList<>(ids);
    Collections.shuffle(shuffled, new Random(7));
    shuffled.forEach(id -> apply(create(id, symbol(layer, 17.5, 59.25), DRAW)));
  }

  private List<UUID> page(UUID layer, int page, int pageSize) {
    LayerPage.Page answer = (LayerPage.Page) store.layerPage(layer, page, pageSize);
    assertThat(answer.layerId()).isEqualTo(layer);
    assertThat(answer.sequenceNo()).isEqualTo(state.sequenceNo());
    return answer.objects().stream().map(MapObject::id).toList();
  }

  @Test
  void aLayersObjectsComeInPagesInTheOrderOfTheirIdsText() {
    withLayers();
    withObjects(IDS.subList(0, 5), layerId);
    withObjects(List.of(IDS.get(5)), otherLayerId);

    assertThat(page(layerId, 0, 2)).containsExactly(IDS.get(0), IDS.get(1));
    assertThat(page(layerId, 1, 2)).containsExactly(IDS.get(2), IDS.get(3));
    assertThat(page(layerId, 2, 2)).containsExactly(IDS.get(4));
    assertThat(page(layerId, 3, 2)).isEmpty(); // past the end
    assertThat(page(layerId, Integer.MAX_VALUE, 500)).isEmpty();
    LayerPage.Page answer = (LayerPage.Page) store.layerPage(layerId, 1, 2);
    assertThat(answer.total()).isEqualTo(5);
    assertThat(answer.page()).isEqualTo(1);
    assertThat(answer.pageSize()).isEqualTo(2);
    assertThat(page(otherLayerId, 0, 100)).containsExactly(IDS.get(5));
  }

  @Test
  void pagesFollowCreatesDeletesUpdatesAndMovesBetweenLayers() {
    withLayers();
    withObjects(List.of(IDS.get(0), IDS.get(2), IDS.get(4)), layerId);
    withObjects(List.of(IDS.get(5)), otherLayerId);
    assertThat(page(layerId, 0, 10)).containsExactly(IDS.get(0), IDS.get(2), IDS.get(4)); // both orders built
    assertThat(page(otherLayerId, 0, 10)).containsExactly(IDS.get(5));

    apply(create(IDS.get(1), symbol(layerId, 17.5, 59.25), DRAW)); // between two
    apply(delete(IDS.get(2), EntityType.OBJECT, DRAW));
    apply(update(IDS.get(0), 1, symbol(layerId, 18.5, 60.25), DRAW)); // stays where it is
    apply(update(IDS.get(4), 1, symbol(otherLayerId, 17.5, 59.25), DRAW)); // to the other layer
    apply(create(IDS.get(3), symbol(otherLayerId, 17.5, 59.25), DRAW));

    assertThat(page(layerId, 0, 10)).containsExactly(IDS.get(0), IDS.get(1));
    assertThat(((LayerPage.Page) store.layerPage(layerId, 0, 1)).objects().getFirst().content().geometry())
        .isEqualTo(symbol(layerId, 18.5, 60.25).geometry()); // the current version
    assertThat(page(otherLayerId, 0, 10)).containsExactly(IDS.get(3), IDS.get(4), IDS.get(5));
    assertThat(((LayerPage.Page) store.layerPage(otherLayerId, 0, 10)).total()).isEqualTo(3);
  }

  @Test
  void pagesStayTheSortedObjectsOfTheLayerThroughRandomChanges() {
    withLayers();
    Random random = new Random(11);
    List<UUID> held = new ArrayList<>();
    Map<UUID, Long> versions = new HashMap<>();
    for (int step = 0; step < 3_000; step++) {
      int what = random.nextInt(10);
      if (held.isEmpty() || what < 5) {
        UUID id = new UUID(random.nextLong(), random.nextLong());
        apply(create(id, symbol(random.nextBoolean() ? layerId : otherLayerId, 17.5, 59.25), DRAW));
        held.add(id);
        versions.put(id, 1L);
      } else if (what < 7) {
        UUID id = held.remove(random.nextInt(held.size()));
        apply(delete(id, EntityType.OBJECT, DRAW));
      } else { // an update, within its layer or to the other one
        UUID id = held.get(random.nextInt(held.size()));
        long version = versions.merge(id, 1L, Long::sum);
        apply(update(id, version - 1, symbol(random.nextBoolean() ? layerId : otherLayerId, 18.5, 60.25), DRAW));
      }
      if (step % 300 == 0 || step == 2_999) {
        for (UUID layer : List.of(layerId, otherLayerId)) {
          List<UUID> expected = held.stream().filter(id -> state.object(id).content().layerId().equals(layer))
              .sorted(Comparator.comparing(UUID::toString)).toList();
          assertThat(page(layer, 0, 500)).as("step " + step).isEqualTo(expected.subList(0, Math.min(500, expected.size())));
          int pageNo = expected.size() / 7;
          assertThat(page(layer, pageNo, 7)).isEqualTo(expected.subList(Math.min(pageNo * 7, expected.size()), Math.min(expected.size(), pageNo * 7 + 7)));
          assertThat(((LayerPage.Page) store.layerPage(layer, 0, 1)).total()).isEqualTo(expected.size());
        }
      }
    }
  }

  /** The layer's order, broken by {@code fault} as a fault of ours would (part 3's re-review). */
  private void withBrokenOrder(Consumer<LayerOrder> fault) {
    withLayers();
    withObjects(IDS.subList(0, 5), layerId);
    LayerOrder order = state.orderOf(layerId);
    assertThat(order).isNotNull();
    fault.accept(order);
  }

  @Test
  void anOrderThatLostAnObjectIsRebuiltAtTheNextPageWhereverTheObjectWas() {
    withBrokenOrder(order -> order.remove(IDS.get(4))); // on the last page; every id left has its object

    assertThat(page(layerId, 0, 2)).containsExactly(IDS.get(0), IDS.get(1));
    assertThat(state.orderOf(layerId).size()).isEqualTo(5); // rebuilt at the first page
    assertThat(page(layerId, 2, 2)).containsExactly(IDS.get(4));
  }

  @Test
  void anOrderThatKeptADeletedObjectIsRebuiltAtTheNextPageWhereverTheObjectWas() {
    withBrokenOrder(order -> order.add(UUID.fromString("ffffffff-0000-7000-8000-000000000007"))); // after all, off the first page

    assertThat(page(layerId, 0, 2)).containsExactly(IDS.get(0), IDS.get(1));
    assertThat(state.orderOf(layerId).size()).isEqualTo(5); // rebuilt at the first page
    assertThat(((LayerPage.Page) store.layerPage(layerId, 0, 1)).total()).isEqualTo(5);
  }

  @Test
  void aLayerThatIsNotThereHasNoPages() {
    withLayers();
    assertThat(store.layerPage(UUID.randomUUID(), 0, 10)).isInstanceOf(LayerPage.NoLayer.class);
    assertThat(page(otherLayerId, 0, 10)).isEmpty();

    apply(delete(otherLayerId, EntityType.LAYER, LAYERS));

    assertThat(store.layerPage(otherLayerId, 0, 10)).isEqualTo(new LayerPage.NoLayer(otherLayerId));
  }

  @Test
  void objectsByIdComeInTheOrderAskedForEachIdOnce() {
    withLayers();
    withObjects(IDS.subList(0, 3), layerId);
    apply(delete(IDS.get(1), EntityType.OBJECT, DRAW));
    UUID unknown = UUID.randomUUID();

    FoundObjects answer = store.objects(List.of(IDS.get(2), unknown, IDS.get(0), IDS.get(1), IDS.get(2), layerId));

    assertThat(answer.found()).extracting(MapObject::id).containsExactly(IDS.get(2), IDS.get(0));
    assertThat(answer.missing()).containsExactly(unknown, IDS.get(1), layerId); // a layer is no object
    assertThat(answer.sequenceNo()).isEqualTo(state.sequenceNo());
    assertThat(store.objects(List.of()).found()).isEmpty();
  }

  @Test
  void theIdOrderIsTheOrderOfTheIdsLowercaseText() {
    Random random = new Random(42);
    List<UUID> ids = IntStream.range(0, 2000).mapToObj(i -> new UUID(random.nextLong(), random.nextLong())).toList();

    assertThat(ids.stream().sorted(LayerOrder.ID_ORDER).toList())
        .isEqualTo(ids.stream().sorted(Comparator.comparing(UUID::toString)).toList());
  }

  @Test
  void theStoreMessagesKeepTheSdksLimits() {
    List<UUID> tooMany = IntStream.range(0, StoreMsg.MAX_IDS + 1).mapToObj(i -> UUID.randomUUID()).toList();
    assertThatThrownBy(() -> new StoreMsg.GetObjects(tooMany, null)).hasMessage("at most 1000 ids: 1001");
    assertThatThrownBy(() -> new StoreMsg.GetLayerPage(layerId, 0, StoreMsg.MAX_PAGE_SIZE + 1, null))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new StoreMsg.GetLayerPage(layerId, -1, 10, null)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new StoreMsg.GetLayerPage(layerId, 0, 0, null)).isInstanceOf(IllegalArgumentException.class);
  }
}
