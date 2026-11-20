package dev.emcc.ecore.runtime;

import java.util.Objects;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * A message on its way through a mailbox, with what the runtime needs to know about it.
 *
 * <p>A message is either given directly, or <b>deferred</b>: made by a supplier when the worker
 * takes it, so that plugin code that converts it (an ask's {@code toMessage}, a topic mapper) runs
 * in the receiving worker, under its watchdog.
 *
 * <p>A <b>system</b> envelope (answers to asks) ignores the mailbox's capacity and is never
 * coalesced, so an answer is never lost. Each ask produces at most one, which bounds the overrun.
 */
final class Envelope<M> {

  private final @Nullable M message;
  private final @Nullable Supplier<? extends M> deferred;
  private final @Nullable Object key;
  private final boolean system;
  private final @Nullable Runnable onDropped;
  private final @Nullable Runnable onTaken;

  private Envelope(
      @Nullable M message,
      @Nullable Supplier<? extends M> deferred,
      @Nullable Object key,
      boolean system,
      @Nullable Runnable onDropped,
      @Nullable Runnable onTaken) {
    this.message = message;
    this.deferred = deferred;
    this.key = key;
    this.system = system;
    this.onDropped = onDropped;
    this.onTaken = onTaken;
  }

  /** The message if it was given directly; null for a deferred one, which {@link #resolve} still has to make. */
  @Nullable M given() {
    return message;
  }

  static <M> Envelope<M> of(M message, @Nullable Object key) {
    return new Envelope<>(Objects.requireNonNull(message, "message"), null, key, false, null, null);
  }

  static <M> Envelope<M> deferred(Supplier<? extends M> supplier, @Nullable Object key) {
    return new Envelope<>(null, Objects.requireNonNull(supplier, "supplier"), key, false, null, null);
  }

  /** Always delivered: ignores capacity and coalescing. */
  static <M> Envelope<M> system(Supplier<? extends M> supplier) {
    return new Envelope<>(null, Objects.requireNonNull(supplier, "supplier"), null, true, null, null);
  }

  /**
   * Runs {@code hook} if the envelope is evicted, replaced by coalescing, discarded at stop, or taken
   * but never made; at most once, whichever path drops it.
   */
  Envelope<M> onDropped(Runnable hook) {
    java.util.concurrent.atomic.AtomicBoolean ran = new java.util.concurrent.atomic.AtomicBoolean();
    Runnable once = () -> {
      if (ran.compareAndSet(false, true)) {
        hook.run();
      }
    };
    return new Envelope<>(message, deferred, key, system, once, onTaken);
  }

  /** Runs {@code hook} when the worker takes the envelope from the mailbox. */
  Envelope<M> onTaken(Runnable hook) {
    return new Envelope<>(message, deferred, key, system, onDropped, hook);
  }

  /** The message; for a deferred envelope, makes it now (in the worker). */
  M resolve() {
    if (message != null) {
      return message;
    }
    Supplier<? extends M> supplier = Objects.requireNonNull(deferred);
    return Objects.requireNonNull(supplier.get(), "a message mapper returned null");
  }

  @Nullable Object key() {
    return key;
  }

  boolean system() {
    return system;
  }

  void dropped() {
    if (onDropped != null) {
      onDropped.run();
    }
  }

  void taken() {
    if (onTaken != null) {
      onTaken.run();
    }
  }
}
