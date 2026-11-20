package dev.emcc.ecore.store;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.TreeSet;
import java.util.UUID;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** A layer's order against a plain sorted set, through many random adds and removes (conformance review F3). */
class LayerOrderTest {

  @ParameterizedTest
  @ValueSource(ints = {2, 3, 4, 7, LayerOrder.BLOCK})
  void staysTheSortedOrderOfItsIdsThroughRandomAddsAndRemoves(int blockSize) {
    Random random = new Random(blockSize);
    LayerOrder order = new LayerOrder(blockSize);
    TreeSet<UUID> expected = new TreeSet<>(LayerOrder.ID_ORDER);
    List<UUID> held = new ArrayList<>();
    for (int step = 0; step < 20_000; step++) {
      // Grows to a few thousand, then shrinks to empty, then grows again: splits and emptied blocks.
      boolean growing = step % 8_000 < 5_000;
      if (held.isEmpty() || random.nextInt(10) < (growing ? 7 : 2)) {
        UUID id = new UUID(random.nextLong(), random.nextLong());
        order.add(id);
        expected.add(id);
        held.add(id);
        if (random.nextInt(50) == 0) {
          order.add(id); // already there: nothing changes
        }
      } else {
        UUID id = held.remove(random.nextInt(held.size()));
        order.remove(id);
        expected.remove(id);
        if (random.nextInt(50) == 0) {
          order.remove(id); // not there any more: nothing changes
        }
      }
      if (step % 500 == 0 || step == 19_999) {
        assertThat(order.size()).isEqualTo(expected.size());
        assertThat(order.slice(0, Integer.MAX_VALUE)).as("step " + step).containsExactlyElementsOf(expected);
        List<UUID> all = List.copyOf(expected);
        for (int k = 0; k < 20; k++) {
          int from = random.nextInt(all.size() + 3);
          int count = 1 + random.nextInt(600);
          assertThat(order.slice(from, count)).containsExactlyElementsOf(all.subList(Math.min(from, all.size()), Math.min(all.size(), from + count)));
        }
      }
    }
  }
}
