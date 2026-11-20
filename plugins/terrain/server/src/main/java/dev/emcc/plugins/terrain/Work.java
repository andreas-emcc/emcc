package dev.emcc.plugins.terrain;

import java.time.Duration;
import org.jspecify.annotations.Nullable;

/**
 * One folder call waiting in the queue, or in progress. The plugin queues its own calls so that at
 * most {@code LocalFolder.MAX_CONCURRENT_CALLS} are in progress (the ACA's R2).
 *
 * @param kind what the call is
 * @param path the path relative to the folder
 * @param cell the cell a header or a cell read is for; {@code null} for a listing
 * @param size the file's size for a cell read, else 0
 * @param timeout the call's timeout
 */
record Work(Kind kind, String path, @Nullable CellId cell, long size, Duration timeout) {

  /** What a call does. */
  enum Kind {
    LIST,
    HEADER,
    CELL
  }

  static Work list(String path, Duration timeout) {
    return new Work(Kind.LIST, path, null, 0, timeout);
  }

  static Work header(String path, CellId cell, Duration timeout) {
    return new Work(Kind.HEADER, path, cell, 0, timeout);
  }

  static Work cell(String path, CellId cell, long size, Duration timeout) {
    return new Work(Kind.CELL, path, cell, size, timeout);
  }
}
