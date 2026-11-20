package dev.emcc.plugins.uavsimulation;

import dev.emcc.plugins.uavsimulation.pose.Platform;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.Operation;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * What the worker keeps of the Simulation workspace (brief function 3; owner Q3 A): its layers, and a
 * small {@link Platform} record for every {@code core.symbol} in them, read when its update reached
 * the worker. Everything else is dropped at once. After the simulator's {@code Picture}: a snapshot
 * replaces everything, changes apply in sequence order, and changes that come before the first
 * snapshot or query answer wait for it.
 */
final class SimulationCopy {

  /** The simulator's workspace (ADR-0039). */
  static final String WORKSPACE = "simulator.simulation";

  /** Changes kept before the first snapshot; more means one is coming anyway (the store's MAX_PENDING_UPDATES). */
  static final int MAX_WAITING = 10_000;

  private record Entry(UUID layer, long version, Platform platform) {}

  private final Set<UUID> layers = new HashSet<>();
  private final Map<UUID, Entry> symbols = new HashMap<>();
  private final List<ChangeEvent> waiting = new ArrayList<>();
  private long sequenceNo = -1;
  private boolean loaded;
  private int snapshots;

  boolean loaded() {
    return loaded;
  }

  /** Snapshots after the first one: each means the subscription fell behind or the store restarted. */
  int newSnapshots() {
    return Math.max(0, snapshots - 1);
  }

  /** Replaces everything with a snapshot or a query's answer, read at {@code now}. */
  void replace(List<MapObject> objects, List<Layer> allLayers, long sequence, Instant now) {
    layers.clear();
    symbols.clear();
    for (Layer layer : allLayers) {
      if (WORKSPACE.equals(layer.content().workspace())) {
        layers.add(layer.id());
      }
    }
    for (MapObject object : objects) {
      keep(object, now);
    }
    sequenceNo = sequence;
    snapshots++;
    if (!loaded) {
      loaded = true;
      List<ChangeEvent> after = List.copyOf(waiting);
      waiting.clear();
      after.forEach(e -> apply(e, now));
    }
    waiting.clear();
  }

  /** Changes from the subscription, read at {@code now}. Returns false when too many wait for the first snapshot. */
  boolean changes(List<ChangeEvent> events, Instant now) {
    if (!loaded) {
      waiting.addAll(events);
      if (waiting.size() > MAX_WAITING) {
        waiting.clear();
        return false;
      }
      return true;
    }
    events.forEach(e -> apply(e, now));
    return true;
  }

  /** The symbol's platform record, or {@code null} when it is not a {@code core.symbol} in a Simulation layer. */
  @Nullable Platform platform(UUID id) {
    Entry e = symbols.get(id);
    return e != null && layers.contains(e.layer) ? e.platform : null;
  }

  /** How many symbols it holds (for tests and the status). */
  int size() {
    return symbols.size();
  }

  private void apply(ChangeEvent event, Instant now) {
    if (event.sequenceNo() <= sequenceNo) {
      return;
    }
    sequenceNo = event.sequenceNo();
    if (event.entityType() == EntityType.LAYER) {
      if (event.operation() == Operation.DELETE || !(event.state() instanceof Layer layer) || !WORKSPACE.equals(layer.content().workspace())) {
        layers.remove(event.entityId());
      } else {
        layers.add(layer.id());
      }
      return;
    }
    if (event.operation() == Operation.DELETE || !(event.state() instanceof MapObject object)) {
      symbols.remove(event.entityId());
      return;
    }
    Entry held = symbols.get(object.id());
    if (held == null || object.version() >= held.version) {
      symbols.remove(object.id());
      keep(object, now, held);
    }
  }

  private void keep(MapObject object, Instant now) {
    keep(object, now, null);
  }

  /**
   * Keeps a symbol in a Simulation layer. An update that leaves the position, direction and speed as
   * they were (a new name or label) keeps the time of the last move, so the extrapolation does not
   * start again from an old position.
   */
  private void keep(MapObject object, Instant now, @Nullable Entry held) {
    if (!layers.contains(object.content().layerId())) {
      return;
    }
    Platform p = Platform.of(object.content(), now);
    if (p == null) {
      return;
    }
    if (held != null && held.platform.fix().position().equals(p.fix().position())
        && java.util.Objects.equals(held.platform.fix().direction(), p.fix().direction()) && java.util.Objects.equals(held.platform.fix().speed(), p.fix().speed())) {
      p = new Platform(held.platform.fix(), p.name(), p.label());
    }
    symbols.put(object.id(), new Entry(object.content().layerId(), object.version(), p));
  }
}
