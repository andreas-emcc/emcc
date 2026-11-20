package dev.emcc.sdk.connection;

import java.util.Objects;

/**
 * SDK 1.2.0: what ECore does when a connection task's {@code run} ends (ADR-0036 point 2). Each
 * restart runs a fresh task from the factory.
 *
 * <pre>{@code
 * Restart.onFailure(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60)))   // a client that reconnects
 * Restart.always(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60)))      // also when run returns
 * Restart.never()                                                                         // the default
 * }</pre>
 */
public sealed interface Restart permits Restart.Never, Restart.OnFailure, Restart.Always {

  /** The task ends for good when {@code run} returns or throws. */
  record Never() implements Restart {}

  /** A fresh task runs after the back-off when {@code run} throws; a return ends it. */
  record OnFailure(Backoff backoff) implements Restart {
    public OnFailure {
      Objects.requireNonNull(backoff, "backoff");
    }
  }

  /** A fresh task runs after the back-off whenever {@code run} returns or throws, until it is stopped. */
  record Always(Backoff backoff) implements Restart {
    public Always {
      Objects.requireNonNull(backoff, "backoff");
    }
  }

  static Restart never() {
    return new Never();
  }

  static Restart onFailure(Backoff backoff) {
    return new OnFailure(backoff);
  }

  static Restart always(Backoff backoff) {
    return new Always(backoff);
  }
}
