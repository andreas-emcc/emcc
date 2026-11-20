package dev.emcc.plugins.nvg.sync;

import dev.emcc.plugins.nvg.codec.Item;
import dev.emcc.plugins.nvg.codec.NvgDocument;
import dev.emcc.plugins.nvg.mapping.ItemMapper;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Relation;
import dev.emcc.sdk.store.Change;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * Decides the change requests that make the store hold a document's items for one external system
 * (brief, sections 3 and 4). Pure: the caller gives the stored objects of that system.
 *
 * <ul>
 *   <li>an item whose {@code uri} a stored object carries updates it, in the layer it is in now (a
 *       user may have moved it, owner RM A); an unchanged one is not sent;
 *   <li>any other item creates an object in the target layer, with {@code externalRef} {@code
 *       (system, uri)};
 *   <li>a composite's parts after the first are related to the first by {@code nvg.part} (owner, RL B);
 *   <li>with {@code deleteMissing} (a consumer's whole picture), a stored object whose {@code uri} is
 *       not in the document is deleted; an import deletes nothing (N3);
 *   <li>a stored object the writer may not change ({@code blocked}) is neither updated nor deleted.
 * </ul>
 */
public final class SyncPlan {

  private SyncPlan() {}

  /**
   * The plan.
   *
   * @param changes the change requests, in document order, deletes last
   * @param unchanged items equal to their stored object
   * @param skipped items left out, by counter (e.g. {@code label not understood})
   * @param notes values left out of items that were used, by counter
   * @param items the document's items
   */
  public record Plan(List<Change> changes, int unchanged, Map<String, Long> skipped, Map<String, Long> notes, int items) {
    public Plan {
      changes = List.copyOf(changes);
      skipped = Map.copyOf(skipped);
      notes = Map.copyOf(notes);
    }
  }

  /**
   * @param blocked stored objects this writer may not change, by {@code uri}, with the counter to skip them by (e.g. an
   *     imported object a user moved into a locked layer, or into a workspace the importing user may not edit)
   */
  public static Plan plan(String system, NvgDocument document, List<MapObject> stored, Map<String, String> blocked, ItemMapper.Context ctx,
      boolean deleteMissing, Supplier<UUID> ids) {
    Map<String, MapObject> byUri = new HashMap<>();
    for (MapObject o : stored) {
      ExternalRef ref = o.meta().externalRef();
      if (ref != null && ref.system().equals(system)) {
        byUri.put(ref.id(), o);
      }
    }
    List<Change> changes = new ArrayList<>();
    Map<String, Long> skipped = new LinkedHashMap<>(document.skipped());
    Map<String, Long> notes = new LinkedHashMap<>();
    Set<String> seen = new HashSet<>();
    Map<String, UUID> firstParts = new HashMap<>();
    int unchanged = 0;
    for (Item item : document.items()) {
      if (!seen.add(item.uri())) {
        count(skipped, "skipped: duplicate uri");
        continue;
      }
      String block = blocked.get(item.uri());
      if (block != null) {
        count(skipped, block);
        continue;
      }
      ItemMapper.Mapped mapped = ItemMapper.map(item, ctx);
      mapped.notes().forEach(n -> count(notes, n));
      if (mapped.content() == null) {
        count(skipped, Objects.requireNonNull(mapped.skipped()));
        continue;
      }
      MapObject existing = byUri.get(item.uri());
      UUID id = existing != null ? existing.id() : ids.get();
      List<UUID> partOf = List.of();
      if (item.compositeUri() != null) {
        UUID first = firstParts.putIfAbsent(item.compositeUri(), id);
        if (first != null) {
          partOf = List.of(first);
        }
      }
      MapObjectContent content = mapped.content();
      if (existing == null) {
        content = content.withRelations(partOf.stream().map(p -> new Relation(ItemMapper.PART_RELATION, p)).toList());
        changes.add(Change.createObject(id, content).withExternalRef(new ExternalRef(system, item.uri())));
        continue;
      }
      MapObjectContent now = existing.content();
      MapObjectContent update = new MapObjectContent(content.type(), content.dataType(), now.dataSource(), content.time(), now.layerId(),
          content.geometry(), content.symbol(), content.style(), content.properties(), content.label(),
          content.extensions(), List.of(), Relation.replace(now.relations(), ItemMapper.PART_RELATION, partOf), content.text());
      if (same(now, update)) {
        unchanged++;
      } else {
        changes.add(Change.updateObject(existing, update));
      }
    }
    if (deleteMissing) {
      for (MapObject o : stored) {
        ExternalRef ref = o.meta().externalRef();
        if (ref != null && ref.system().equals(system) && !seen.contains(ref.id()) && !blocked.containsKey(ref.id())) {
          changes.add(Change.deleteObject(o));
        }
      }
    }
    return new Plan(changes, unchanged, skipped, notes, document.items().size());
  }

  /** Whether an update would change nothing: the store keeps other namespaces and the field sets. */
  static boolean same(MapObjectContent stored, MapObjectContent update) {
    var ours = update.extensions().get(ItemMapper.NAMESPACE);
    var namespaces = new HashMap<>(stored.extensions().namespaces());
    if (ours == null) {
      namespaces.remove(ItemMapper.NAMESPACE);
    } else {
      namespaces.put(ItemMapper.NAMESPACE, ours);
    }
    var mergedExtensions = new dev.emcc.sdk.model.Extensions(namespaces);
    MapObjectContent expected = new MapObjectContent(update.type(), update.dataType(), update.dataSource(), update.time(), update.layerId(),
        update.geometry(), update.symbol(), update.style(), update.properties(), update.label(), mergedExtensions, stored.fieldSets(),
        update.relations(), update.text());
    return expected.equals(stored);
  }

  private static void count(Map<String, Long> counts, String key) {
    counts.merge(key, 1L, Long::sum);
  }

  /** The plan's counters, for a status line: {@code key n, key n}. */
  public static String describe(@Nullable Map<String, Long> counts) {
    if (counts == null || counts.isEmpty()) {
      return "";
    }
    StringBuilder b = new StringBuilder();
    counts.forEach((k, v) -> b.append(b.isEmpty() ? "" : ", ").append(k).append(' ').append(v));
    return b.toString();
  }
}
