package dev.emcc.ecore.store;

import dev.emcc.sdk.model.MapObject;
import java.util.List;
import java.util.UUID;

/**
 * The answer to {@link StoreMsg.GetObjects} (CR-0015 item 8): the objects that exist and the ids no
 * object has, after the change with {@code sequenceNo}. Immutable.
 *
 * @param found the objects, in the order asked for
 * @param missing the ids no object has (deleted, never there, or a layer's), in the order asked for
 */
public record FoundObjects(long sequenceNo, List<MapObject> found, List<UUID> missing) {

  public FoundObjects {
    found = List.copyOf(found);
    missing = List.copyOf(missing);
  }
}
