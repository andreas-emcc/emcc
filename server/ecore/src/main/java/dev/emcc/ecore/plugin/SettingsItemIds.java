package dev.emcc.ecore.plugin;

import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;
import tools.jackson.databind.JsonNode;

/**
 * The stable ids of a settings list's items (SDK and data model 1.8.0, CR-0047 F2). For every array
 * whose schema names a string property of its items in {@code x-emc2.item.id}, at any depth, ECore
 * gives each item whose id is missing, empty or not a string a new UUID v7, and finds the items of
 * one list that share an id. It follows the schema's {@code properties}, {@code items} and its
 * references within itself ({@code #/...}).
 */
final class SettingsItemIds {

  /** How deep the schema is followed; a deeper or self-referring schema is not walked further. */
  private static final int MAX_DEPTH = 64;

  private static final SecureRandom RANDOM = new SecureRandom();

  /**
   * The outcome of {@link #fill}.
   *
   * @param values the values with every missing id filled in (and, when renewing, every repeated one renewed)
   * @param filled the pointers of the ids filled in or renewed
   * @param duplicates the pointers of the ids that repeat an earlier item's id in the same list
   */
  record Filled(JsonObject values, List<String> filled, List<String> duplicates) {
    boolean changed() {
      return !filled.isEmpty();
    }
  }

  private final JsonNode root;
  private final Supplier<String> newId;

  private SettingsItemIds(JsonNode root, Supplier<String> newId) {
    this.root = root;
    this.newId = newId;
  }

  /**
   * Fills in the missing ids of {@code values} by {@code schema}.
   *
   * @param renewDuplicates at load: an item that repeats an earlier one's id gets a new one; at a
   *     change it keeps it, and the caller refuses the change
   */
  static Filled fill(JsonNode schema, JsonObject values, boolean renewDuplicates) {
    return fill(schema, values, renewDuplicates, SettingsItemIds::uuidv7);
  }

  /** With ids from {@code newId} (tests). */
  static Filled fill(JsonNode schema, JsonObject values, boolean renewDuplicates, Supplier<String> newId) {
    SettingsItemIds walker = new SettingsItemIds(schema, newId);
    List<String> filled = new ArrayList<>();
    List<String> duplicates = new ArrayList<>();
    JsonValue result = walker.walk(schema, values, "", 0, renewDuplicates, filled, duplicates);
    return new Filled((JsonObject) result, List.copyOf(filled), List.copyOf(duplicates));
  }

  /** A new UUID v7 (RFC 9562), in lower case: 48 bits of Unix milliseconds, then random bits. */
  static String uuidv7() {
    long millis = System.currentTimeMillis();
    long msb = (millis << 16) | 0x7000L | (RANDOM.nextInt() & 0x0FFFL);
    long lsb = (RANDOM.nextLong() & 0x3FFFFFFFFFFFFFFFL) | 0x8000000000000000L;
    return new UUID(msb, lsb).toString();
  }

  private JsonValue walk(JsonNode schema, JsonValue value, String pointer, int depth, boolean renew,
      List<String> filled, List<String> duplicates) {
    JsonNode node = resolve(schema);
    if (node == null || depth > MAX_DEPTH) {
      return value;
    }
    if (value instanceof JsonObject object && node.path("properties").isObject()) {
      JsonNode properties = node.get("properties");
      Map<String, JsonValue> members = null;
      for (Map.Entry<String, JsonValue> member : object.members().entrySet()) {
        JsonNode property = properties.get(member.getKey());
        if (property == null) {
          continue;
        }
        JsonValue next = walk(property, member.getValue(), pointer + "/" + escape(member.getKey()), depth + 1, renew, filled, duplicates);
        if (next != member.getValue()) {
          if (members == null) {
            members = new LinkedHashMap<>(object.members());
          }
          members.put(member.getKey(), next);
        }
      }
      return members == null ? object : JsonObject.of(members);
    }
    if (value instanceof JsonArray array && node.path("items").isObject()) {
      JsonNode items = node.get("items");
      @Nullable String idName = idProperty(node);
      Set<String> seen = new HashSet<>();
      List<JsonValue> elements = null;
      for (int i = 0; i < array.size(); i++) {
        JsonValue element = array.get(i);
        String at = pointer + "/" + i;
        JsonValue next = walk(items, element, at, depth + 1, renew, filled, duplicates);
        if (idName != null && next instanceof JsonObject item) {
          JsonValue id = item.get(idName);
          String idAt = at + "/" + escape(idName);
          if (!(id instanceof JsonString s) || s.value().isEmpty()) {
            next = withNewId(item, idName, seen);
            filled.add(idAt);
          } else if (!seen.add(s.value())) {
            duplicates.add(idAt);
            if (renew) {
              next = withNewId(item, idName, seen);
              filled.add(idAt);
            }
          }
        }
        if (next != element) {
          if (elements == null) {
            elements = new ArrayList<>(array.values());
          }
          elements.set(i, next);
        }
      }
      return elements == null ? array : new JsonArray(elements);
    }
    return value;
  }

  private JsonObject withNewId(JsonObject item, String idName, Set<String> seen) {
    String id = newId.get();
    seen.add(id);
    return item.with(idName, new JsonString(id));
  }

  /** The array's {@code x-emc2.item.id}, or null if it declares none. */
  private static @Nullable String idProperty(JsonNode array) {
    JsonNode id = array.path("x-emc2").path("item").path("id");
    return id.isString() && !id.stringValue().isEmpty() ? id.stringValue() : null;
  }

  /** The node, or the node a reference within the schema leads to; null for one that leads nowhere or outside. */
  private @Nullable JsonNode resolve(JsonNode node) {
    JsonNode current = node;
    for (int hops = 0; current.has("$ref"); hops++) {
      JsonNode ref = current.get("$ref");
      if (hops > MAX_DEPTH || !ref.isString() || !ref.stringValue().startsWith("#")) {
        return null;
      }
      JsonNode target = root.at(ref.stringValue().substring(1));
      if (target.isMissingNode()) {
        return null;
      }
      current = target;
    }
    return current;
  }

  /** A JSON Pointer token (RFC 6901). */
  private static String escape(String name) {
    return name.replace("~", "~0").replace("/", "~1");
  }
}
