package dev.emcc.sdk.timer;

import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Duration;

/**
 * Sends a message to a worker once or periodically. Delivery goes through the target's mailbox and
 * its overflow policy, and never blocks ECore.
 *
 * <pre>{@code
 * context.timers().once(Duration.ofSeconds(30), self, new Retry(key));
 * }</pre>
 *
 * <p>A plugin has at most a fixed number of <b>active timers</b> (an ECore setting, default 1 000
 * per plugin): a {@code once} that has neither fired nor been cancelled, or an {@code every} that
 * has not been cancelled. Above that, {@code once} and {@code every} throw.
 */
public interface Timers {

  /** The shortest allowed period and delay. */
  Duration MIN_PERIOD = Duration.ofMillis(10);

  /**
   * Sends {@code message} to {@code target} once, after {@code delay}.
   *
   * @throws IllegalStateException if the plugin already has the maximum number of active timers
   */
  <M extends Message> Cancellable once(Duration delay, WorkerRef<M> target, M message);

  /**
   * Sends {@code message} to {@code target} repeatedly with a <b>fixed delay</b> of {@code period}
   * between deliveries. A tick is skipped while the previous one is still undelivered, so a slow
   * worker never builds up a queue of ticks.
   *
   * @throws IllegalStateException if the plugin already has the maximum number of active timers
   */
  <M extends Message> Cancellable every(Duration period, WorkerRef<M> target, M message);
}
