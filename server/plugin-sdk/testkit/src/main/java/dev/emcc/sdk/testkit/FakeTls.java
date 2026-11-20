package dev.emcc.sdk.testkit;

import java.time.LocalDate;
import java.util.Map;
import java.util.Objects;
import javax.net.ssl.SSLContext;

/**
 * SDK 1.9.0 (owner AAR A; ADR-0062 point 4): the TLS credentials the fakes give a connection task,
 * the expired and unreadable ones included, refused as ECore refuses them.
 */
final class FakeTls {

  private FakeTls() {}

  /** ECore's message for a credential whose own certificate expired on {@code on}; ECore also names the certificate's subject. */
  static String expired(String name, LocalDate on) {
    return "the TLS credential " + name + ": its certificate expired on " + Objects.requireNonNull(on, "on");
  }

  /** ECore's message for a credential it cannot read, for {@code reason}. */
  static String unreadable(String name, String reason) {
    return "the TLS credential " + name + " cannot be read: " + Objects.requireNonNull(reason, "reason");
  }

  /**
   * The context named {@code name}.
   *
   * @throws IllegalStateException if it is set up as expired or unreadable, with ECore's message
   * @throws IllegalArgumentException if it is not set up, naming {@code setUpBy}
   */
  static SSLContext context(Map<String, SSLContext> usable, Map<String, String> refused, String name, String setUpBy) {
    Objects.requireNonNull(name, "credentials");
    String failure = refused.get(name);
    if (failure != null) {
      throw new IllegalStateException(failure);
    }
    SSLContext c = usable.get(name);
    if (c == null) {
      throw new IllegalArgumentException("no TLS credentials named " + name + " are configured (" + setUpBy + ")");
    }
    return c;
  }
}
