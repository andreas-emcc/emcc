package dev.emcc.sdk;

/**
 * Marker for messages between workers (overview 4.2, rule C3).
 *
 * <p>A message is a <b>record</b> (or an enum) with immutable fields only: strings, numbers,
 * booleans, enums, other messages, {@link Bytes}, {@link dev.emcc.sdk.json.JsonValue}, model types,
 * and collections created with {@code List.copyOf}, {@code Map.copyOf} and similar. No arrays. The
 * ArchUnit rule set in the test kit checks this. Messages may later cross a process boundary
 * (overview 4.1), so they must also be serializable as data.
 *
 * <pre>{@code
 * sealed interface TileMsg extends Message {
 *   record Get(TileKey key, EndpointRequest request) implements TileMsg {}
 *   record Fetched(TileKey key, HttpResult result) implements TileMsg {}
 * }
 * }</pre>
 */
public interface Message {}
