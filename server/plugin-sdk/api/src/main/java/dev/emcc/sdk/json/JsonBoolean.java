package dev.emcc.sdk.json;

/**
 * A JSON boolean.
 *
 * <pre>{@code
 * JsonBoolean.of(true) == JsonBoolean.TRUE
 * }</pre>
 *
 * @param value the value
 */
public record JsonBoolean(boolean value) implements JsonValue {

  public static final JsonBoolean TRUE = new JsonBoolean(true);
  public static final JsonBoolean FALSE = new JsonBoolean(false);

  public static JsonBoolean of(boolean value) {
    return value ? TRUE : FALSE;
  }
}
