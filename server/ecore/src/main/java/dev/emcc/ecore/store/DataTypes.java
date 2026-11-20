package dev.emcc.ecore.store;

import dev.emcc.sdk.model.MapObjectContent;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * The ids of the available data types (data model rule 14, ADR-0023): {@code core.general} and
 * those the loaded plugins declare, and from SDK 1.5.0 the field sets each names (rule 21,
 * CR-0038). Fixed once, when the plugin host has read the manifests and
 * before any plugin runs; the set never changes while the server runs (plugins load only at start).
 *
 * <p>Shared between the plugin host, which fixes it, and the object store's worker, which reads it:
 * an immutable map behind a volatile field, no lock.
 */
public final class DataTypes {

  private final AtomicBoolean fixed = new AtomicBoolean();
  private volatile Map<String, List<String>> sets = Map.of(MapObjectContent.GENERAL, List.of());

  /** Only {@code core.general}, until {@link #fix} adds the plugins' data types. */
  public DataTypes() {}

  /** Data types fixed at once: {@code core.general} and {@code declared}, without field sets. For tests. */
  public static DataTypes of(Set<String> declared) {
    DataTypes types = new DataTypes();
    types.fix(declared);
    return types;
  }

  /** Data types fixed at once: {@code core.general} and {@code declared}, each with its field sets. For tests. */
  public static DataTypes of(Map<String, List<String>> declared) {
    DataTypes types = new DataTypes();
    types.fix(declared);
    return types;
  }

  /**
   * Fixes the plugins' data types, without field sets, once.
   *
   * @throws IllegalStateException if they were fixed already
   * @throws IllegalArgumentException if one is {@code core.general}
   */
  public void fix(Set<String> declared) {
    Map<String, List<String>> none = new LinkedHashMap<>();
    declared.forEach(id -> none.put(id, List.of()));
    fix(none);
  }

  /**
   * Fixes the plugins' data types, once, each with the full ids of the field sets it names, in its
   * manifest's order (SDK 1.5.0).
   *
   * @throws IllegalStateException if they were fixed already
   * @throws IllegalArgumentException if one is {@code core.general}
   */
  public void fix(Map<String, List<String>> declared) {
    if (!fixed.compareAndSet(false, true)) {
      throw new IllegalStateException("the data types are fixed already");
    }
    Map<String, List<String>> all = new LinkedHashMap<>();
    all.put(MapObjectContent.GENERAL, List.of());
    declared.forEach((id, ids) -> {
      if (all.put(Objects.requireNonNull(id, "id"), List.copyOf(ids)) != null) {
        throw new IllegalArgumentException(id + " is built in");
      }
    });
    sets = Map.copyOf(all);
  }

  public boolean isAvailable(String id) {
    return sets.containsKey(id);
  }

  /** Every available data type's id. */
  public Set<String> ids() {
    return sets.keySet();
  }

  /**
   * SDK 1.5.0: the full ids of the field sets that a data type names (model rule 21), in its
   * manifest's order; empty for {@code core.general}, for a type without sets and for one that is
   * not available.
   */
  public List<String> fieldSets(String id) {
    return sets.getOrDefault(id, List.of());
  }
}
