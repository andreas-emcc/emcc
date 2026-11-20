package dev.emcc.sdk;

/**
 * Something that can be stopped, such as a timer or a subscription.
 *
 * <pre>{@code
 * Cancellable tick = context.timers().every(Duration.ofSeconds(30), self, new Tick());
 * tick.cancel();
 * }</pre>
 */
public interface Cancellable {

  /** Stops it. Calling it again has no effect. */
  void cancel();
}
