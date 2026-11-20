package dev.emcc.ecore.store;

import dev.emcc.ecore.geo.Cap;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * What a browser's subscription starts from (spike S3, recommendation 9): every layer, the number
 * of objects in each layer over the whole picture, and the objects it asked for, all after the
 * change with {@code sequenceNo}. Immutable.
 *
 * @param objects the objects that reach into the area, every object without an area, or none
 * @param bounds the bound of each object's geometry, in the same order
 * @param objectCounts every layer's id to its number of objects, 0 for an empty layer
 */
public record AreaSnapshot(
    long sequenceNo, List<Layer> layers, List<MapObject> objects, List<Cap> bounds, Map<UUID, Integer> objectCounts) {

  public AreaSnapshot {
    if (sequenceNo < 0) {
      throw new IllegalArgumentException("sequenceNo must be >= 0: " + sequenceNo);
    }
    layers = List.copyOf(layers);
    objects = List.copyOf(objects);
    bounds = List.copyOf(bounds);
    if (bounds.size() != objects.size()) {
      throw new IllegalArgumentException("one bound per object");
    }
    objectCounts = Map.copyOf(objectCounts);
  }
}
