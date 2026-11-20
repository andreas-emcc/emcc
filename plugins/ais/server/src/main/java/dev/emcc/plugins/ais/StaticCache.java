package dev.emcc.plugins.ais;

import dev.emcc.plugins.ais.codec.AisStatic;
import java.util.LinkedHashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * What the ships of one link have said about themselves, by MMSI, so that static data that comes
 * before a ship's first position goes with it (brief section 4). <b>It lives in the worker, one per
 * link.</b> At most {@value #MAX_SHIPS} ships; a ship is forgotten {@value #KEEP_MILLIS} ms after its
 * last message; when full, the ship that has been silent longest goes first. Not thread-safe: the worker
 * uses it.
 */
final class StaticCache {

  static final int MAX_SHIPS = 50_000;
  static final long KEEP_MILLIS = 60 * 60 * 1000L;

  private record Entry(AisStatic data, long at) {}

  /** In order of the last message, oldest first. */
  private final Map<Integer, Entry> ships = new LinkedHashMap<>();

  /** The result of {@link #put}: whether the ship was new here, and how many ships were forgotten to make room. */
  record Put(boolean added, int forgotten) {}

  /** Adds what a message said, over what is known; the ship is now the newest. */
  Put put(int mmsi, AisStatic said, long nowMillis) {
    Entry before = ships.remove(mmsi);
    AisStatic merged = before == null ? said : before.data().merge(said);
    int forgotten = 0;
    if (before == null && ships.size() >= MAX_SHIPS) {
      var oldest = ships.keySet().iterator();
      oldest.next();
      oldest.remove();
      forgotten = 1;
    }
    ships.put(mmsi, new Entry(merged, nowMillis));
    return new Put(before == null, forgotten);
  }

  @Nullable AisStatic get(int mmsi) {
    Entry e = ships.get(mmsi);
    return e == null ? null : e.data();
  }

  /** Forgets the ships whose last message is too old; returns how many. */
  int expire(long nowMillis) {
    int n = 0;
    for (var it = ships.values().iterator(); it.hasNext(); ) {
      if (nowMillis - it.next().at() < KEEP_MILLIS) {
        break; // the oldest comes first
      }
      it.remove();
      n++;
    }
    return n;
  }

  int size() {
    return ships.size();
  }
}
