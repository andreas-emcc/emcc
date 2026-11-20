package dev.emcc.ecore.store;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/**
 * How much the live picture holds, for the monitor view (overview 4.10). The object store worker,
 * the picture's single writer, sets it after every applied change; anyone may read it at any time,
 * without asking the store. No lock: one immutable value, published atomically.
 */
public final class StoreCounts {

  /** The counts at one sequence number. */
  public record Counts(int layers, int objects, long sequenceNo) {}

  private final AtomicReference<Counts> current = new AtomicReference<>(new Counts(0, 0, 0));
  /** Each plugin's updates that were not saved (ADR-0041), since the start; written by the store worker only. */
  private final AtomicReference<Map<String, Long>> notSaved = new AtomicReference<>(Map.of());

  public Counts current() {
    return current.get();
  }

  /** How many updates {@code plugin} sent that were not saved (ADR-0041), since the start. */
  public long notSaved(String plugin) {
    return notSaved.get().getOrDefault(plugin, 0L);
  }

  /** Called by the object store worker only. */
  void update(PictureState state) {
    current.set(new Counts(state.layerCount(), state.objectCount(), state.sequenceNo()));
  }

  /** Called by the object store worker only, after each update that is not saved. */
  void countNotSaved(String plugin) {
    Map<String, Long> next = new HashMap<>(notSaved.get());
    next.merge(plugin, 1L, Long::sum);
    notSaved.set(Map.copyOf(next));
  }
}
