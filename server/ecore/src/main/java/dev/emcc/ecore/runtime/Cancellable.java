package dev.emcc.ecore.runtime;

/** Something that can be stopped: a timer, a subscription or a scheduled task. */
@FunctionalInterface
public interface Cancellable {

  /** Stops it. Calling it again has no effect. */
  void cancel();
}
