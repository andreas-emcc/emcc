package dev.emcc.sdk.worker;

import dev.emcc.sdk.Message;
import java.util.Objects;

/**
 * The answer to an {@link WorkerContext#ask ask}: exactly one of these arrives.
 *
 * <pre>{@code
 * case TileMsg.CacheAnswer a -> {
 *   switch (a.reply()) {
 *     case Reply.Ok<Tile> ok -> respond(ok.value());
 *     case Reply.Failed<Tile> f -> fetchUpstream(a.key());
 *     case Reply.TimedOut<Tile> t -> fetchUpstream(a.key());
 *   }
 * }
 * }</pre>
 *
 * @param <R> the answer type
 */
public sealed interface Reply<R extends Message> permits Reply.Ok, Reply.Failed, Reply.TimedOut {

  /** The target answered with a value. */
  record Ok<R extends Message>(R value) implements Reply<R> {
    public Ok {
      Objects.requireNonNull(value, "value");
    }
  }

  /** The target failed the request, or ECore could not deliver it (stopped, refused, evicted). */
  record Failed<R extends Message>(String reason) implements Reply<R> {
    public Failed {
      Objects.requireNonNull(reason, "reason");
    }
  }

  /** No answer within the timeout. */
  record TimedOut<R extends Message>() implements Reply<R> {}
}
