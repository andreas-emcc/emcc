package dev.emcc.sdk.worker;

import dev.emcc.sdk.Message;

/**
 * The handle a request carries for its answer. An immutable value, equal by {@link #id()}, so it
 * can be part of a message record. Answer once; later answers, and answers after the asker's
 * timeout, are ignored.
 *
 * <pre>{@code
 * record Get(TileKey key, ReplyTo<Tile> replyTo) implements CacheMsg {}
 * // in the cache worker:
 * case Get get -> get.replyTo().reply(tiles.get(get.key()));
 * }</pre>
 *
 * @param <R> the answer type
 */
public interface ReplyTo<R extends Message> {

  HandleId id();

  /** Answers with a value. */
  void reply(R value);

  /** Answers that the request failed, with a short reason in English. */
  void fail(String reason);
}
