package dev.emcc.ecore.runtime;

import java.time.Duration;
import java.util.function.Function;

/**
 * What a handler gets with each message. After a restart the old context is fenced: whatever is
 * sent through it, or from its thread, is dropped.
 *
 * @param <M> the worker's message type
 */
public interface HandlerContext<M> {

  /** The shortest allowed ask timeout. */
  Duration MIN_ASK_TIMEOUT = Duration.ofMillis(1);

  /** The longest allowed ask timeout. */
  Duration MAX_ASK_TIMEOUT = Duration.ofMinutes(10);

  /** This worker's handle, e.g. to pass as a reply target. */
  WorkerHandle<M> self();

  /**
   * Asks {@code target} without blocking (rule C5). {@code request} builds the request from a
   * fresh reply handle. Exactly one answer arrives later in this worker's mailbox, as the message
   * that {@code toMessage} makes from the {@link Answer}: {@code Ok}, {@code Failed} (the target
   * failed it, is stopped, refused or evicted it) or {@code TimedOut}. Answers are always
   * delivered, whatever this worker's overflow policy. {@code toMessage} runs in this worker.
   *
   * @param timeout from {@link #MIN_ASK_TIMEOUT} to {@link #MAX_ASK_TIMEOUT}
   */
  <Q, R> void ask(
      WorkerHandle<Q> target,
      Function<ReplyHandle<R>, ? extends Q> request,
      Duration timeout,
      Function<Answer<R>, ? extends M> toMessage);
}
