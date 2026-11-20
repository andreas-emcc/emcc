package dev.emcc.plugins.basemaposm;

import dev.emcc.sdk.Bytes;
import java.util.LinkedHashMap;
import org.jspecify.annotations.Nullable;

/** A bounded in-memory cache of tiles; the least recently used tile is dropped first. Touched only by the tiles worker. */
final class TileCache {

  private int capacity;
  private final LinkedHashMap<TileKey, Bytes> tiles = new LinkedHashMap<>(256, 0.75f, true);

  TileCache(int capacity) {
    if (capacity < 1) {
      throw new IllegalArgumentException("capacity must be at least 1");
    }
    this.capacity = capacity;
  }

  /** The tile, which then counts as most recently used. */
  @Nullable Bytes get(TileKey key) {
    return tiles.get(key);
  }

  void put(TileKey key, Bytes tile) {
    tiles.put(key, tile);
    if (tiles.size() > capacity) {
      var eldest = tiles.keySet().iterator();
      eldest.next();
      eldest.remove();
    }
  }

  /** Changes the capacity; the least recently used tiles go first if there are more than fit. */
  void resize(int newCapacity) {
    if (newCapacity < 1) {
      throw new IllegalArgumentException("capacity must be at least 1");
    }
    capacity = newCapacity;
    var eldest = tiles.keySet().iterator();
    while (tiles.size() > capacity) {
      eldest.next();
      eldest.remove();
    }
  }

  void clear() {
    tiles.clear();
  }

  int size() {
    return tiles.size();
  }
}
