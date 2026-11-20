package dev.emcc.sdk.json;

import java.util.Objects;

/**
 * A JSON string.
 *
 * <pre>{@code
 * JsonString.of("m-g").value()   // "m-g"
 * }</pre>
 *
 * @param value the string
 */
public record JsonString(String value) implements JsonValue {

  public JsonString {
    Objects.requireNonNull(value, "value");
  }

  public static JsonString of(String value) {
    return new JsonString(value);
  }
}
