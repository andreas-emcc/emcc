package dev.emcc.plugins.adsb;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * The aircraft one link has sent lines for, held by its worker (the playbook's state across frames,
 * per link). At most {@link #MAX_AIRCRAFT}; an aircraft with no line for {@link #FORGET_AFTER} is
 * forgotten, and when the table is full the one that waited longest goes first. Entries are kept in
 * the order of their last line, so the oldest is always first. Not thread-safe: one worker owns it.
 */
final class AircraftTable {

  /** The most aircraft held at once. */
  static final int MAX_AIRCRAFT = 10_000;

  /** An aircraft with no line for this long is forgotten. */
  static final Duration FORGET_AFTER = Duration.ofMinutes(5);

  /**
   * What a line did to the table.
   *
   * @param aircraft the aircraft's state after the line
   * @param created whether the aircraft was not in the table before
   * @param evicted the aircraft forgotten to make room, oldest first
   */
  record Update(Aircraft aircraft, boolean created, List<String> evicted) {}

  private record Entry(Aircraft aircraft, Instant lastSeen) {}

  private final Map<String, Entry> entries = new LinkedHashMap<>();

  /** Merges a line into its aircraft's state, moving the aircraft to the newest end. */
  Update update(Sbs1.Message message, Instant now) {
    String icao = message.icao24();
    Entry before = entries.remove(icao);
    List<String> evicted = new ArrayList<>();
    if (before == null) {
      while (entries.size() >= MAX_AIRCRAFT) {
        Iterator<Map.Entry<String, Entry>> oldest = entries.entrySet().iterator();
        evicted.add(oldest.next().getKey());
        oldest.remove();
      }
    }
    Aircraft base = before == null ? Aircraft.unknown(icao) : before.aircraft();
    Aircraft merged = base.merge(message);
    entries.put(icao, new Entry(merged, now));
    return new Update(merged, before == null, evicted);
  }

  /** Forgets the aircraft with no line since {@code now} minus {@link #FORGET_AFTER}; returns their addresses, oldest first. */
  List<String> forget(Instant now) {
    Instant cutoff = now.minus(FORGET_AFTER);
    List<String> forgotten = new ArrayList<>();
    for (Iterator<Map.Entry<String, Entry>> it = entries.entrySet().iterator(); it.hasNext(); ) {
      Map.Entry<String, Entry> entry = it.next();
      if (!entry.getValue().lastSeen().isBefore(cutoff)) {
        break; // the entries are in the order of their last line
      }
      forgotten.add(entry.getKey());
      it.remove();
    }
    return forgotten;
  }

  /** The aircraft's state, or {@code null} when the table does not hold it. */
  @Nullable Aircraft get(String icao24) {
    Entry entry = entries.get(icao24);
    return entry == null ? null : entry.aircraft();
  }

  int size() {
    return entries.size();
  }
}
