package dev.emcc.sdk.store;

import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import java.util.List;
import java.util.Objects;

/**
 * The answer to a {@link Store#query}: exactly one arrives, always delivered.
 *
 * <pre>{@code
 * switch (result) {
 *   case QueryResult.Found f -> f.objects().forEach(o -> known.put(o.meta().externalRef().id(), o));
 *   case QueryResult.Failed f -> log.warn("query failed: {}", f.reason());
 *   case QueryResult.TimedOut t -> retryLater();
 * }
 * }</pre>
 */
public sealed interface QueryResult permits QueryResult.Found, QueryResult.Failed, QueryResult.TimedOut {

  /**
   * The matching objects and all layers, consistent with each other.
   *
   * @param objects the matching objects, in no particular order
   * @param layers all layers
   * @param sequenceNo the sequence number of the last change the result includes
   */
  record Found(List<MapObject> objects, List<Layer> layers, long sequenceNo) implements QueryResult {
    public Found {
      objects = List.copyOf(objects);
      layers = List.copyOf(layers);
    }
  }

  /** No result, e.g. more objects matched than the query's limit, or too many outstanding asks. */
  record Failed(String reason) implements QueryResult {
    public Failed {
      Objects.requireNonNull(reason, "reason");
    }
  }

  /** No answer within the timeout. */
  record TimedOut() implements QueryResult {}
}
