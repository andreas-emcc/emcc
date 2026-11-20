package dev.emcc.ecore.runtime;

import java.util.Objects;

/**
 * The answer to an {@link HandlerContext#ask ask}: exactly one of these arrives.
 *
 * @param <R> the answer type
 */
public sealed interface Answer<R> permits Answer.Ok, Answer.Failed, Answer.TimedOut {

  /** The target answered with a value. */
  record Ok<R>(R value) implements Answer<R> {
    public Ok {
      Objects.requireNonNull(value, "value");
    }
  }

  /** The target failed the request, or it could not be delivered (stopped, refused, evicted). */
  record Failed<R>(String reason) implements Answer<R> {
    public Failed {
      Objects.requireNonNull(reason, "reason");
    }
  }

  /** No answer within the timeout. */
  record TimedOut<R>() implements Answer<R> {}
}
