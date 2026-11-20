package dev.emcc.sdk.model;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * SDK 1.4.0: a relation from an object to another one (ADR-0051, CR-0031), in {@link
 * MapObjectContent#relations()}: a kind that a loaded plugin declares ({@code relationKinds} in its
 * manifest; {@code context.relationKinds()}) and the other object's id.
 *
 * <p>The store checks the kind (model rule 17) but never the other object: it may not exist, or be
 * in another layer or workspace, and deleting it does not change this object. An update replaces
 * the whole list (rule 5), so a writer keeps the entries of other kinds it finds on the stored
 * object: {@link #replace} does that.
 *
 * <pre>{@code
 * List<Relation> next = Relation.replace(stored.content().relations(), "gmti.pairing", detectedIds);
 * var content = stored.content().withRelations(next);
 * }</pre>
 *
 * @param kind the kind, {@code <plugin-id>.<name>}, e.g. {@code gmti.pairing}
 * @param objectId the other object's id
 */
public record Relation(String kind, UUID objectId) {

  /** The most entries one object carries (CR-0031, the owner's Q1). */
  public static final int MAX_PER_OBJECT = 1_024;

  private static final Pattern TYPE_NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*\\.[a-z][a-z0-9]*(-[a-z0-9]+)*");

  public Relation {
    Objects.requireNonNull(kind, "kind");
    Objects.requireNonNull(objectId, "objectId");
    if (!TYPE_NAME.matcher(kind).matches() || kind.length() > 129) {
      throw new IllegalArgumentException("a relation's kind must be '<plugin-id>.<name>': " + kind);
    }
  }

  /**
   * The {@code stored} list with the entries of {@code kind} replaced by one entry per id in
   * {@code objectIds} (in their order, each once); the entries of other kinds are kept, in their
   * places before the new ones.
   *
   * @throws IllegalArgumentException if the result has more than {@link #MAX_PER_OBJECT} entries
   */
  public static List<Relation> replace(List<Relation> stored, String kind, Collection<UUID> objectIds) {
    Objects.requireNonNull(stored, "stored");
    Objects.requireNonNull(objectIds, "objectIds");
    var result = new ArrayList<Relation>();
    for (Relation r : stored) {
      if (!r.kind().equals(kind)) {
        result.add(r);
      }
    }
    for (UUID id : new LinkedHashSet<>(objectIds)) {
      result.add(new Relation(kind, id));
    }
    return checked(result);
  }

  /** {@code values} as an unmodifiable list, checked: each entry once, at most {@link #MAX_PER_OBJECT}. */
  static List<Relation> checked(List<Relation> values) {
    Objects.requireNonNull(values, "relations");
    if (values.size() > MAX_PER_OBJECT) {
      throw new IllegalArgumentException("an object carries at most " + MAX_PER_OBJECT + " relations: " + values.size());
    }
    List<Relation> copy = List.copyOf(values);
    if (new LinkedHashSet<>(copy).size() != copy.size()) {
      throw new IllegalArgumentException("a relation is listed twice");
    }
    return copy;
  }
}
