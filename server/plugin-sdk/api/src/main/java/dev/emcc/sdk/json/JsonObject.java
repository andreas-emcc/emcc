package dev.emcc.sdk.json;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.jspecify.annotations.Nullable;

/**
 * A JSON object: an immutable map of member names to values. It keeps the members' order (for
 * readable output) but, like JSON, compares equal regardless of order. Duplicate names are
 * rejected.
 *
 * <pre>{@code
 * JsonObject settings = context.settings();
 * String url = settings.getString("upstreamUrl");
 * int maxZoom = settings.getNumber("maxZoom").bigDecimalValue().intValueExact();
 * }</pre>
 */
public final class JsonObject implements JsonValue {

  private static final JsonObject EMPTY = new JsonObject(Map.of());

  private final Map<String, JsonValue> members;

  private JsonObject(Map<String, JsonValue> members) {
    this.members = members;
  }

  public static JsonObject empty() {
    return EMPTY;
  }

  /** A copy of {@code members}, in its iteration order. */
  public static JsonObject of(Map<String, ? extends JsonValue> members) {
    if (members.isEmpty()) {
      return EMPTY;
    }
    var copy = new LinkedHashMap<String, JsonValue>();
    members.forEach((name, value) -> copy.put(Objects.requireNonNull(name, "name"), Objects.requireNonNull(value, "value")));
    return new JsonObject(Collections.unmodifiableMap(copy));
  }

  public static Builder builder() {
    return new Builder();
  }

  /** The members, in order. Unmodifiable. */
  public Map<String, JsonValue> members() {
    return members;
  }

  public Set<String> names() {
    return members.keySet();
  }

  public int size() {
    return members.size();
  }

  public boolean isEmpty() {
    return members.isEmpty();
  }

  public boolean has(String name) {
    return members.containsKey(name);
  }

  /** The member's value, or {@code null} if there is no such member. */
  public @Nullable JsonValue get(String name) {
    return members.get(name);
  }

  /** The member's string value; fails if it is missing or not a string. */
  public String getString(String name) {
    return require(name, JsonString.class).value();
  }

  /** The member's number value; fails if it is missing or not a number. */
  public JsonNumber getNumber(String name) {
    return require(name, JsonNumber.class);
  }

  /** The member's boolean value; fails if it is missing or not a boolean. */
  public boolean getBoolean(String name) {
    return require(name, JsonBoolean.class).value();
  }

  /** The member's object value; fails if it is missing or not an object. */
  public JsonObject getObject(String name) {
    return require(name, JsonObject.class);
  }

  /** A copy with {@code name} set to {@code value}. */
  public JsonObject with(String name, JsonValue value) {
    var copy = new LinkedHashMap<String, JsonValue>(members);
    copy.put(Objects.requireNonNull(name, "name"), Objects.requireNonNull(value, "value"));
    return new JsonObject(Collections.unmodifiableMap(copy));
  }

  /** A copy without {@code name}. */
  public JsonObject without(String name) {
    if (!members.containsKey(name)) {
      return this;
    }
    var copy = new LinkedHashMap<String, JsonValue>(members);
    copy.remove(name);
    return copy.isEmpty() ? EMPTY : new JsonObject(Collections.unmodifiableMap(copy));
  }

  private <T extends JsonValue> T require(String name, Class<T> type) {
    JsonValue value = members.get(name);
    if (value == null) {
      throw new IllegalArgumentException("no member \"" + name + "\"");
    }
    if (!type.isInstance(value)) {
      throw new IllegalArgumentException("member \"" + name + "\" is not a " + type.getSimpleName());
    }
    return type.cast(value);
  }

  @Override
  public boolean equals(@Nullable Object other) {
    return other instanceof JsonObject o && members.equals(o.members);
  }

  @Override
  public int hashCode() {
    return members.hashCode();
  }

  @Override
  public String toString() {
    return "JsonObject" + members;
  }

  /** Builds a {@link JsonObject}; rejects duplicate names. Not thread-safe. */
  public static final class Builder {

    private final LinkedHashMap<String, JsonValue> members = new LinkedHashMap<>();

    private Builder() {}

    public Builder put(String name, JsonValue value) {
      Objects.requireNonNull(name, "name");
      Objects.requireNonNull(value, "value");
      if (members.putIfAbsent(name, value) != null) {
        throw new IllegalArgumentException("duplicate member \"" + name + "\"");
      }
      return this;
    }

    public JsonObject build() {
      return members.isEmpty() ? EMPTY : new JsonObject(Collections.unmodifiableMap(new LinkedHashMap<>(members)));
    }
  }
}
