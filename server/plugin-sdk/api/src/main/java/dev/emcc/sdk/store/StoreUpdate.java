package dev.emcc.sdk.store;

import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import java.util.List;

/**
 * What a {@link Store#subscribe} delivers: a snapshot first, then batches of changes. A new
 * snapshot may come at any time (after a gap) and replaces everything. Always delivered, in order.
 *
 * <pre>{@code
 * switch (update) {
 *   case StoreUpdate.Snapshot s -> replaceAll(s.objects(), s.layers());
 *   case StoreUpdate.Changes c -> c.events().forEach(this::apply);
 * }
 * }</pre>
 */
public sealed interface StoreUpdate permits StoreUpdate.Snapshot, StoreUpdate.Changes {

  /**
   * The matching objects and all layers, consistent with {@code sequenceNo}.
   *
   * @param sequenceNo the last change included; the next {@link Changes} continue after it
   */
  record Snapshot(List<MapObject> objects, List<Layer> layers, long sequenceNo) implements StoreUpdate {
    public Snapshot {
      objects = List.copyOf(objects);
      layers = List.copyOf(layers);
    }
  }

  /**
   * Change events in sequence order: every event about a layer, and every event about an object
   * that matched the query before or after the change. So an object that stops matching (moved to
   * another layer, deleted) arrives once more, and can be dropped.
   */
  record Changes(List<ChangeEvent> events) implements StoreUpdate {
    public Changes {
      events = List.copyOf(events);
      if (events.isEmpty()) {
        throw new IllegalArgumentException("a batch has at least one event");
      }
    }
  }
}
