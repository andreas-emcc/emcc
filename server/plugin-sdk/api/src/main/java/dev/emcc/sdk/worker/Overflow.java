package dev.emcc.sdk.worker;

import dev.emcc.sdk.Message;

/**
 * What a worker's mailbox does when it is full (overview 4.2). Applies to plugin sends and to
 * ECore's deliveries alike (timer ticks, topic messages, endpoint requests). Replies, ask timeouts
 * and HTTP results are exempt: they are always delivered and never coalesced.
 *
 * <p>{@code BLOCK_SENDER} is deliberately not offered to plugins (SDK v0 and v1): a plugin never blocks
 * on a send.
 *
 * <pre>{@code
 * WorkerSpec.of("tracks", TrackMsg.class, TrackWorker::new)
 *     .mailbox(10_000, Overflow.coalesceByKey())   // TrackMsg.Position implements Coalescing
 * }</pre>
 *
 * @param <M> the worker's message type
 */
public sealed interface Overflow<M extends Message> permits Overflow.DropOldest, Overflow.DropNewest, Overflow.CoalesceByKey {

  /** Evicts the oldest queued message to make room. */
  static <M extends Message> Overflow<M> dropOldest() {
    return new DropOldest<>();
  }

  /** Refuses the new message ({@link SendResult#DROPPED}). The default. */
  static <M extends Message> Overflow<M> dropNewest() {
    return new DropNewest<>();
  }

  /**
   * Keeps only the latest message per key. The key comes from the message itself: messages that
   * implement {@link Coalescing} and return a non-null {@link Coalescing#coalesceKey() key}
   * <b>replace a queued message with an equal key in place</b>, keeping its position. Other
   * messages, and messages whose key is {@code null}, are never coalesced. If nothing is replaced
   * and the mailbox is full, the oldest message is evicted. Ideal for track positions.
   *
   * <p>For deliveries that a mapper converts (topic messages), the key is taken from the original
   * payload, because the worker's message only exists once the mapper has run inside the worker.
   */
  static <M extends Message> Overflow<M> coalesceByKey() {
    return new CoalesceByKey<>();
  }

  record DropOldest<M extends Message>() implements Overflow<M> {}

  record DropNewest<M extends Message>() implements Overflow<M> {}

  record CoalesceByKey<M extends Message>() implements Overflow<M> {}
}
