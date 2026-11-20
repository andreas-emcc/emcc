package dev.emcc.ecore.store;

import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.FieldRef;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * The fields the loaded plugins declare (ADR-0038; data model 1.2.0, the manifest's {@code
 * fields}), as the object store checks a change request's {@code fields} against them; from data
 * model 1.4.0 also the ids of their field sets (ADR-0050, rule 18) and relation kinds (ADR-0051,
 * rule 17), against which it checks the sets and relations a request adds. Fixed once,
 * when the plugin host has read the manifests and before any plugin runs, as {@link DataTypes} is;
 * the declarations never change while the server runs.
 *
 * <p>Shared between the plugin host, which fixes it, and the object store's worker, which reads it:
 * an immutable map behind a volatile field, no lock.
 */
public final class DeclaredFields {

  /**
   * One declared field, as the store needs it.
   *
   * @param ref the declaring plugin and the field's name
   * @param editableByOthers whether a request of another plugin may set it
   * @param problem what is wrong with a value for it ({@code null} removes it), or {@code null} if
   *     nothing: the SDK's {@code DeclaredField.problem}, the one check plugins use too
   */
  public record Field(FieldRef ref, boolean editableByOthers, Function<@Nullable JsonValue, @Nullable String> problem) {
    public Field {
      Objects.requireNonNull(ref, "ref");
      Objects.requireNonNull(problem, "problem");
    }
  }

  private final AtomicBoolean fixed = new AtomicBoolean();
  private volatile Map<FieldRef, Field> fields = Map.of();
  private volatile Set<String> fieldSets = Set.of();
  private volatile Set<String> relationKinds = Set.of();

  /** None, until {@link #fix} adds the plugins' fields. */
  public DeclaredFields() {}

  /** Fields fixed at once. For tests. */
  public static DeclaredFields of(List<Field> declared) {
    return of(declared, Set.of(), Set.of());
  }

  /** Fields, field sets and relation kinds fixed at once. For tests. */
  public static DeclaredFields of(List<Field> declared, Set<String> fieldSets, Set<String> relationKinds) {
    DeclaredFields fields = new DeclaredFields();
    fields.fix(declared, fieldSets, relationKinds);
    return fields;
  }

  /**
   * Fixes the plugins' fields, once.
   *
   * @throws IllegalStateException if they were fixed already
   * @throws IllegalArgumentException if a field comes twice
   */
  public void fix(List<Field> declared) {
    fix(declared, Set.of(), Set.of());
  }

  /**
   * Fixes the plugins' fields, the full ids of their field sets and the ids of their relation kinds
   * (data model 1.4.0), once.
   *
   * @throws IllegalStateException if they were fixed already
   * @throws IllegalArgumentException if a field comes twice
   */
  public void fix(List<Field> declared, Set<String> fieldSetIds, Set<String> relationKindIds) {
    if (!fixed.compareAndSet(false, true)) {
      throw new IllegalStateException("the declared fields are fixed already");
    }
    Map<FieldRef, Field> all = new LinkedHashMap<>();
    for (Field f : declared) {
      if (all.put(f.ref(), f) != null) {
        throw new IllegalArgumentException(f.ref().plugin() + "." + f.ref().name() + " is declared twice");
      }
    }
    fields = Map.copyOf(all);
    fieldSets = Set.copyOf(fieldSetIds);
    relationKinds = Set.copyOf(relationKindIds);
  }

  /** Data model 1.4.0: whether a loaded plugin declares the field set {@code id} ({@code <plugin>.<set>}; rule 18). */
  public boolean isFieldSet(String id) {
    return fieldSets.contains(id);
  }

  /** Data model 1.4.0: whether a loaded plugin declares the relation kind {@code id} (rule 17). */
  public boolean isRelationKind(String id) {
    return relationKinds.contains(id);
  }

  /** The declaration of {@code ref}, or {@code null} if no loaded plugin declares it. */
  public @Nullable Field get(FieldRef ref) {
    return fields.get(ref);
  }
}
