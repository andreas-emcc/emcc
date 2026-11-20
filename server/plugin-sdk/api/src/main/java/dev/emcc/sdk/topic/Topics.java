package dev.emcc.sdk.topic;

import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.worker.WorkerRef;
import java.util.function.Function;

/**
 * Publishes to and subscribes to topics. Publishing never blocks; each subscriber's mailbox applies
 * its own overflow policy. Messages from one publisher arrive at a subscriber in the order they
 * were published (overview 4.3).
 *
 * <pre>{@code
 * Cancellable sub = context.topics().subscribe(FETCHED, statsWorker, StatsMsg.Fetched::new);
 * }</pre>
 */
public interface Topics {

  /** Publishes {@code message} to every subscriber. A plugin may publish only to its own topics. */
  <T extends Message> void publish(Topic<T> topic, T message);

  /**
   * Delivers every message on {@code topic} to {@code target}, converted by {@code mapper}.
   * {@code mapper} is plugin code: pure, non-blocking, run inside the target worker.
   */
  <T extends Message, M extends Message> Cancellable subscribe(Topic<T> topic, WorkerRef<M> target, Function<? super T, ? extends M> mapper);
}
