package dev.emcc.plugins.simulator;

import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.Operation;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * The engine's copy of the Simulation workspace: its layers and their objects, from the store
 * subscription (brief function 17). Owned by the engine worker; never shared.
 *
 * <p>Every store query and subscription names the workspace (function 2, N9). This class also keeps
 * only the layers marked {@code simulator.simulation}, so that a server that does not filter by
 * workspace yet (T-080) still gives the simulator nothing of View.
 *
 * <p>A new snapshot replaces everything held (criterion 21). A restarted worker has no snapshot: it
 * keeps the changes that arrive until the answer to its own query, then applies those after it.
 */
final class Picture {

  static final String WORKSPACE = "simulator.simulation";

  /** Changes kept while a restarted worker waits for its query; beyond that it waits for the next answer instead. */
  static final int MAX_WAITING = 100_000;

  private final Map<UUID, Layer> layers = new LinkedHashMap<>();
  private final Map<UUID, MapObject> objects = new LinkedHashMap<>();
  private final List<ChangeEvent> waiting = new ArrayList<>();
  private boolean loaded;
  private long sequenceNo;
  private int snapshots;

  /** Whether the picture is complete: a snapshot or a query's answer arrived. */
  boolean loaded() {
    return loaded;
  }

  /** Whether Simulation has layers (function 2: the first layer, from M4). */
  boolean hasLayers() {
    return !layers.isEmpty();
  }

  /** Snapshots after the first one: each means the subscription fell behind or the store restarted. */
  int newSnapshots() {
    return Math.max(0, snapshots - 1);
  }

  /** Replaces everything with a snapshot or a query's answer. */
  void replace(List<MapObject> allObjects, List<Layer> allLayers, long sequence) {
    layers.clear();
    objects.clear();
    for (Layer layer : allLayers) {
      if (inSimulation(layer.content())) {
        layers.put(layer.id(), layer);
      }
    }
    for (MapObject object : allObjects) {
      if (layers.containsKey(object.content().layerId())) {
        objects.put(object.id(), object);
      }
    }
    sequenceNo = sequence;
    snapshots++;
    if (!loaded) {
      loaded = true;
      List<ChangeEvent> after = List.copyOf(waiting);
      waiting.clear();
      after.forEach(this::apply);
    }
    waiting.clear();
  }

  /** Changes from the subscription; kept for later while the picture is not loaded. Returns false when too many wait. */
  boolean changes(List<ChangeEvent> events) {
    if (!loaded) {
      waiting.addAll(events);
      if (waiting.size() > MAX_WAITING) {
        waiting.clear();
        return false;
      }
      return true;
    }
    events.forEach(this::apply);
    return true;
  }

  /** A state the engine learnt from its own change's answer, if newer than the one held. */
  void learn(MapObject object) {
    MapObject held = objects.get(object.id());
    if (held != null && object.version() > held.version() && object.content().layerId().equals(held.content().layerId())) {
      objects.put(object.id(), object);
    }
  }

  private void apply(ChangeEvent event) {
    if (event.sequenceNo() <= sequenceNo) {
      return;
    }
    sequenceNo = event.sequenceNo();
    if (event.entityType() == EntityType.LAYER) {
      if (event.operation() == Operation.DELETE || !(event.state() instanceof Layer layer) || !inSimulation(layer.content())) {
        layers.remove(event.entityId());
      } else {
        layers.put(layer.id(), layer);
      }
      return;
    }
    if (event.operation() == Operation.DELETE || !(event.state() instanceof MapObject object) || !layers.containsKey(object.content().layerId())) {
      objects.remove(event.entityId());
      return;
    }
    MapObject held = objects.get(object.id());
    if (held == null || object.version() >= held.version()) {
      objects.put(object.id(), object);
    }
  }

  private static boolean inSimulation(LayerContent layer) {
    return WORKSPACE.equals(layer.workspace());
  }

  @Nullable MapObject object(UUID id) {
    return objects.get(id);
  }

  Collection<MapObject> objects() {
    return objects.values();
  }
}
