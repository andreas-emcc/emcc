package dev.emcc.sdk.json;

/**
 * The JSON {@code null} value. Use {@link #INSTANCE}.
 *
 * <pre>{@code
 * array.get(2) instanceof JsonNull
 * }</pre>
 */
public record JsonNull() implements JsonValue {

  public static final JsonNull INSTANCE = new JsonNull();
}
