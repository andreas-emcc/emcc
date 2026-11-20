package dev.emcc.sdk.json;

/**
 * An immutable JSON value.
 *
 * <pre>{@code
 * String describe(JsonValue v) {
 *   return switch (v) {
 *     case JsonObject o -> "object with " + o.size() + " members";
 *     case JsonArray a -> "array of " + a.size();
 *     case JsonString s -> "string " + s.value();
 *     case JsonNumber n -> "number " + n.text();
 *     case JsonBoolean b -> "boolean " + b.value();
 *     case JsonNull n -> "null";
 *   };
 * }
 * }</pre>
 */
public sealed interface JsonValue permits JsonObject, JsonArray, JsonString, JsonNumber, JsonBoolean, JsonNull {}
