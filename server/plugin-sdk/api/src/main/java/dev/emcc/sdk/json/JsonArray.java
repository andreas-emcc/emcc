package dev.emcc.sdk.json;

import java.util.List;

/**
 * A JSON array: an immutable list of values.
 *
 * <pre>{@code
 * JsonArray a = JsonArray.of(JsonNumber.of(1), JsonString.of("two"));
 * a.get(1)   // JsonString[value=two]
 * }</pre>
 *
 * @param values the elements
 */
public record JsonArray(List<JsonValue> values) implements JsonValue {

  public JsonArray {
    values = List.copyOf(values);
  }

  public static JsonArray of(JsonValue... values) {
    return new JsonArray(List.of(values));
  }

  public int size() {
    return values.size();
  }

  public JsonValue get(int index) {
    return values.get(index);
  }
}
