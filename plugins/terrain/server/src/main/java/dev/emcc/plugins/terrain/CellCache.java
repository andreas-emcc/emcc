package dev.emcc.plugins.terrain;

import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * The parsed cells, least recently used first out, never holding more bytes than its limit
 * ({@code cacheMegabytes}, criterion 10). One worker owns it. A cell larger than the limit is not
 * kept at all.
 */
final class CellCache {

  private final Map<Long, DtedCell> cells = new LinkedHashMap<>(16, 0.75f, true);
  private long limit;
  private long bytes;

  CellCache(long limit) {
    this.limit = limit;
  }

  /** The cell, which becomes the most recently used; {@code null} when it is not held. */
  @Nullable DtedCell get(long key) {
    return cells.get(key);
  }

  void put(DtedCell cell) {
    DtedCell old = cells.remove(cell.id().key());
    if (old != null) {
      bytes -= old.data().size();
    }
    if (cell.data().size() > limit) {
      return;
    }
    cells.put(cell.id().key(), cell);
    bytes += cell.data().size();
    evict();
  }

  void setLimit(long value) {
    limit = value;
    evict();
  }

  void clear() {
    cells.clear();
    bytes = 0;
  }

  long bytes() {
    return bytes;
  }

  int size() {
    return cells.size();
  }

  private void evict() {
    Iterator<DtedCell> oldest = cells.values().iterator();
    while (bytes > limit && oldest.hasNext()) {
      bytes -= oldest.next().data().size();
      oldest.remove();
    }
  }
}
