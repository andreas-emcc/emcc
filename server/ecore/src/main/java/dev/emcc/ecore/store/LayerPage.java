package dev.emcc.ecore.store;

import dev.emcc.sdk.model.MapObject;
import java.util.List;
import java.util.UUID;

/** The answer to {@link StoreMsg.GetLayerPage} (CR-0015 item 9). Immutable. */
public sealed interface LayerPage {

  /**
   * One page of a layer's objects, after the change with {@code sequenceNo}.
   *
   * @param objects the page's objects in id order (for UUID v7 ids the order of creation); empty past the end
   * @param total all the layer's objects
   */
  record Page(long sequenceNo, UUID layerId, int page, int pageSize, int total, List<MapObject> objects) implements LayerPage {
    public Page {
      objects = List.copyOf(objects);
    }
  }

  /** There is no layer with this id. */
  record NoLayer(UUID layerId) implements LayerPage {}
}
