package dev.emcc.ecore.store;

import dev.emcc.ecore.geo.Cap;
import dev.emcc.ecore.geo.CellIndex;
import dev.emcc.ecore.geo.GeoArea;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.BiConsumer;
import java.util.function.Predicate;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The live picture in memory: layers, objects and the last sequence number. Changed only by
 * applying change events in sequence order, which is the same path for the object store and for
 * replaying the journal at start-up. Keeps each object's bound ({@link Cap}) and a spatial index
 * of them (spike S3), so area queries need not test every object.
 *
 * <p>Not thread-safe: owned by the object store's worker (rule C2), or by the start-up code before
 * that worker exists.
 */
public final class PictureState {

  private static final Logger LOG = LoggerFactory.getLogger(PictureState.class);

  private final Map<UUID, Layer> layers = new LinkedHashMap<>();
  private final Map<UUID, Entry> objects = new LinkedHashMap<>();
  /** Each object's entry by its handle in the index; null for a free handle. */
  private @Nullable Entry[] byHandle = new Entry[1024];
  private int[] freeHandles = new int[64];
  private int freeCount;
  private int nextHandle;
  private final CellIndex index = new CellIndex();
  private final Map<UUID, Integer> objectsPerLayer = new HashMap<>();
  /** Each layer's object ids in order, for its pages (CR-0015 item 9); none for a layer without objects. */
  private final Map<UUID, LayerOrder> orders = new HashMap<>();
  /** Data model rule 16: which object holds an external identity; deleting the object frees it. */
  private final Map<ExternalRef, UUID> byExternalRef = new HashMap<>();
  private long sequenceNo;

  /** A state holding {@code snapshot}. */
  public static PictureState of(PictureSnapshot snapshot) {
    PictureState state = new PictureState();
    snapshot.layers().forEach(l -> state.layers.put(l.id(), l));
    snapshot.objects().forEach(state::add);
    state.sequenceNo = snapshot.sequenceNo();
    return state;
  }

  /**
   * Applies one change event. Events must come in sequence order without gaps (model rule 7); a
   * loaded journal passes over updates that were not saved only through {@link #skipNotSaved}.
   *
   * @throws IllegalStateException if the event is not the next one, or does not fit the state
   */
  public void apply(ChangeEvent event) {
    if (event.sequenceNo() != sequenceNo + 1) {
      throw new IllegalStateException("expected change event " + (sequenceNo + 1) + ", got " + event.sequenceNo());
    }
    UUID id = event.entityId();
    if (event.entityType() == EntityType.LAYER) {
      Layer old = layers.get(id);
      checkVersion(old == null ? null : old.version(), event);
      if (event.state() == null) {
        layers.remove(id);
        orders.remove(id); // empty (model rule 11)
      } else {
        layers.put(id, (Layer) event.state());
      }
    } else {
      Entry entry = objects.get(id);
      MapObject old = entry == null ? null : entry.object();
      checkVersion(old == null ? null : old.version(), event);
      // An update within its layer keeps its place in the layer's order.
      boolean sameLayer = old != null && event.state() instanceof MapObject object
          && object.content().layerId().equals(old.content().layerId());
      if (entry != null) {
        remove(entry, !sameLayer);
      }
      if (event.state() instanceof MapObject object) {
        add(object, !sameLayer);
      }
    }
    sequenceNo = event.sequenceNo();
  }

  /**
   * Passes over the sequence numbers {@code from} to {@code to} of updates that were not saved
   * (ADR-0041): a journal's declared gap, when it is loaded. Nothing else changes.
   *
   * @throws IllegalStateException if {@code from} is not the next sequence number, or {@code to} is before it
   */
  public void skipNotSaved(long from, long to) {
    if (from != sequenceNo + 1 || to < from) {
      throw new IllegalStateException("expected updates not saved from " + (sequenceNo + 1) + ", got " + from + " to " + to);
    }
    sequenceNo = to;
  }

  /**
   * Sets the version an object reached through updates that were not saved (ADR-0041), and keeps
   * its content: a journal's declaration before a saved update or delete of it, when it is loaded.
   * That event then replaces or deletes the object as strictly as any other. The version the
   * object has already changes nothing. No writer produces that today: a declaration names only
   * moves after the latest snapshot, which raise the version. It is accepted because it is
   * consistent, and the next event is still checked strictly (owner, 2026-10-26).
   *
   * @throws IllegalStateException if there is no such object, or {@code version} is before its own
   */
  public void declareNotSavedVersion(UUID id, long version) {
    Entry entry = objects.get(id);
    if (entry == null || version < entry.object().version()) {
      throw new IllegalStateException("cannot declare version " + version + " of object " + id + ": the state has "
          + (entry == null ? "no such object" : "version " + entry.object().version()));
    }
    if (version == entry.object().version()) {
      return;
    }
    MapObject old = entry.object();
    Entry moved = new Entry(new MapObject(old.id(), version, old.content(), old.meta()), entry.handle(), entry.bound());
    objects.put(id, moved);
    byHandle[entry.handle()] = moved;
  }

  /** An object with its handle in the index and its bound. */
  private record Entry(MapObject object, int handle, Cap bound) {}

  private void add(MapObject object) {
    add(object, true);
  }

  private void add(MapObject object, boolean order) {
    int handle = freeCount > 0 ? freeHandles[--freeCount] : nextHandle++;
    Entry entry = new Entry(object, handle, Cap.of(object.content().geometry()));
    if (handle >= byHandle.length) {
      byHandle = Arrays.copyOf(byHandle, byHandle.length * 2);
    }
    byHandle[handle] = entry;
    index.put(handle, null, entry.bound());
    objects.put(object.id(), entry);
    objectsPerLayer.merge(object.content().layerId(), 1, Integer::sum);
    if (order) {
      orders.computeIfAbsent(object.content().layerId(), l -> new LayerOrder()).add(object.id());
    }
    ExternalRef ref = object.meta().externalRef();
    if (ref != null) {
      byExternalRef.put(ref, object.id());
    }
  }

  private void remove(Entry entry, boolean order) {
    MapObject object = entry.object();
    index.remove(entry.handle(), entry.bound());
    byHandle[entry.handle()] = null;
    if (freeCount == freeHandles.length) {
      freeHandles = Arrays.copyOf(freeHandles, freeCount * 2);
    }
    freeHandles[freeCount++] = entry.handle();
    objects.remove(object.id());
    objectsPerLayer.merge(object.content().layerId(), -1, (a, b) -> a + b == 0 ? null : a + b);
    LayerOrder layerOrder = order ? orders.get(object.content().layerId()) : null;
    if (layerOrder != null) {
      layerOrder.remove(object.id());
      if (layerOrder.size() == 0) {
        orders.remove(object.content().layerId());
      }
    }
    ExternalRef ref = object.meta().externalRef();
    if (ref != null) {
      byExternalRef.remove(ref, object.id());
    }
  }

  private static void checkVersion(@Nullable Long current, ChangeEvent event) {
    if (!Objects.equals(current, event.previousVersion())) {
      throw new IllegalStateException("change event " + event.sequenceNo() + " expects version "
          + event.previousVersion() + " of " + event.entityId() + ", but the state has " + current);
    }
  }

  public long sequenceNo() {
    return sequenceNo;
  }

  public @Nullable Layer layer(UUID id) {
    return layers.get(id);
  }

  public @Nullable MapObject object(UUID id) {
    Entry entry = objects.get(id);
    return entry == null ? null : entry.object();
  }

  /** The bound of an object's geometry (spike S3), or null if there is no such object. */
  public @Nullable Cap bound(UUID id) {
    Entry entry = objects.get(id);
    return entry == null ? null : entry.bound();
  }

  /** True if any layer or object has this id (ids are unique across both). */
  public boolean contains(UUID id) {
    return layers.containsKey(id) || objects.containsKey(id);
  }

  /** The object that holds this external identity (data model rule 16), or null. */
  public @Nullable UUID objectWith(ExternalRef ref) {
    return byExternalRef.get(ref);
  }

  public int objectCount(UUID layerId) {
    return objectsPerLayer.getOrDefault(layerId, 0);
  }

  /** Every layer's id to its number of objects, 0 for an empty layer. A copy. */
  public Map<UUID, Integer> objectCounts() {
    Map<UUID, Integer> counts = new HashMap<>();
    layers.keySet().forEach(id -> counts.put(id, objectsPerLayer.getOrDefault(id, 0)));
    return Map.copyOf(counts);
  }

  public int layerCount() {
    return layers.size();
  }

  public int objectCount() {
    return objects.size();
  }

  /**
   * Page {@code page} (from 0) of {@code layerId}'s objects, {@code pageSize} to a page, in id order
   * (for UUID v7 ids the order of creation); empty past the end. Costs finding the page plus its
   * own size ({@link LayerOrder}); an order that does not match the layer's objects is rebuilt
   * first, at the cost of reading every object.
   */
  public List<MapObject> layerPage(UUID layerId, int page, int pageSize) {
    LayerOrder current = orders.get(layerId);
    // An order of another size has lost an object or kept a deleted one (part 3's re-review).
    int ordered = current == null ? 0 : current.size();
    List<MapObject> found = ordered == objectCount(layerId) ? pageOf(current, page, pageSize) : null;
    if (found != null) {
      return found;
    }
    // The order does not match the objects: a fault of ours. Rebuilt from them, so that the next pages are right again.
    LOG.error("The order of layer {} did not match its objects (order {}, objects {}); rebuilt", layerId, ordered, objectCount(layerId));
    LayerOrder order = new LayerOrder();
    objects.values().forEach(e -> {
      if (e.object().content().layerId().equals(layerId)) {
        order.add(e.object().id());
      }
    });
    if (order.size() == 0) {
      // Defensive and not reached by a test: remove() already drops an order that empties.
      orders.remove(layerId); // none for a layer without objects
    } else {
      orders.put(layerId, order);
    }
    return Objects.requireNonNull(pageOf(order, page, pageSize), "a rebuilt layer order matches its objects");
  }

  /** A layer's order, or null for a layer without objects; for tests that break it. */
  @Nullable LayerOrder orderOf(UUID layerId) {
    return orders.get(layerId);
  }

  /** The page's objects, or null if an id of the order has no object. */
  private @Nullable List<MapObject> pageOf(@Nullable LayerOrder order, int page, int pageSize) {
    if (order == null) {
      return List.of();
    }
    List<MapObject> found = new ArrayList<>(pageSize);
    for (UUID id : order.slice((long) page * pageSize, pageSize)) {
      Entry entry = objects.get(id);
      if (entry == null) {
        return null;
      }
      found.add(entry.object());
    }
    return found;
  }

  /** The objects that match {@code filter}, at most {@code max}, in insertion order. */
  public List<MapObject> find(Predicate<MapObject> filter, int max) {
    List<MapObject> found = new ArrayList<>();
    for (Entry e : objects.values()) {
      if (found.size() >= max) {
        break;
      }
      if (filter.test(e.object())) {
        found.add(e.object());
      }
    }
    return found;
  }

  /**
   * The objects whose bound reaches into {@code area} and that match {@code filter}, at most
   * {@code max}, in no particular order. Uses the spatial index: the same objects as testing every
   * one, but in about a millisecond per 100 000 objects in the area, and far less when zoomed in.
   */
  public List<MapObject> find(GeoArea area, Predicate<MapObject> filter, int max) {
    List<MapObject> found = new ArrayList<>();
    index.query(area, h -> entryAt(h).bound(), h -> {
      MapObject o = entryAt(h).object();
      if (found.size() < max && filter.test(o)) {
        found.add(o);
      }
    });
    return found;
  }

  /**
   * Every object with its bound: those that reach into {@code area} (through the index, in no
   * particular order), or every object in insertion order when {@code area} is null.
   */
  public void forEach(@Nullable GeoArea area, BiConsumer<MapObject, Cap> out) {
    if (area == null) {
      objects.values().forEach(e -> out.accept(e.object(), e.bound()));
    } else {
      index.query(area, h -> entryAt(h).bound(), h -> out.accept(entryAt(h).object(), entryAt(h).bound()));
    }
  }

  private Entry entryAt(int handle) {
    return Objects.requireNonNull(byHandle[handle], "a handle in the index has an entry");
  }

  /** The layers, in insertion order. */
  public List<Layer> layers() {
    return List.copyOf(layers.values());
  }

  /** An immutable copy of the whole picture. */
  public PictureSnapshot snapshot() {
    return new PictureSnapshot(sequenceNo, layers.values().stream().toList(), objects.values().stream().map(Entry::object).toList());
  }
}
