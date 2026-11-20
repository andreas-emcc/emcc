package dev.emcc.sdk.worker;

import org.jspecify.annotations.Nullable;

/**
 * A message that may replace an earlier queued message with the same key, in a mailbox with
 * {@link Overflow#coalesceByKey()}. The key is data of the message (typically a record component),
 * so no plugin code runs when ECore queues the message.
 *
 * <pre>{@code
 * record Position(String trackId, Point point) implements TrackMsg, Coalescing {
 *   public Object coalesceKey() { return trackId; }
 * }
 * }</pre>
 */
public interface Coalescing {

  /** The key; equal keys coalesce. {@code null} means "never coalesce this message". */
  @Nullable Object coalesceKey();
}
