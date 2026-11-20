package dev.emcc.ecore.store;

import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import java.util.List;

/**
 * The whole live picture at one moment: every layer and object after the change with {@code
 * sequenceNo} (0 for an empty store). Immutable, so any worker may read it (overview 4.4, "Reads").
 *
 * @param sequenceNo the last change event this picture contains
 * @param layers every layer
 * @param objects every map object
 */
public record PictureSnapshot(long sequenceNo, List<Layer> layers, List<MapObject> objects) {

  public PictureSnapshot {
    if (sequenceNo < 0) {
      throw new IllegalArgumentException("sequenceNo must be >= 0: " + sequenceNo);
    }
    layers = List.copyOf(layers);
    objects = List.copyOf(objects);
  }

  public static PictureSnapshot empty() {
    return new PictureSnapshot(0, List.of(), List.of());
  }
}
