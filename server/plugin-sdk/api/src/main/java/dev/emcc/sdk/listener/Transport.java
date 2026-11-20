package dev.emcc.sdk.listener;

import java.util.Objects;
import java.util.regex.Pattern;

/**
 * How a listener's connection is made. UDP is not in SDK v1 (owner, 2026-10-10); it would be
 * another case here.
 *
 * <pre>{@code
 * switch (spec.transport()) {
 *   case Transport.Tcp t -> "tcp";
 *   case Transport.Tls t -> "tls with " + t.credentials();
 * }
 * }</pre>
 *
 * @deprecated from SDK 1.2.0: use a connection task ({@code dev.emcc.sdk.connection}), in which the
 *     plugin opens its own sockets of any kind (ADR-0036). Kept in SDK 1.x for existing code, removed
 *     in the next major version.
 */
@Deprecated(since = "1.2.0")
public sealed interface Transport permits Transport.Tcp, Transport.Tls {

  /** Plain TCP. */
  record Tcp() implements Transport {}

  /**
   * TLS. ECore takes the client key, the trust store and their passwords from local server
   * configuration under this name. They are never in the repository, never in the plugin's
   * settings, and never given to the plugin.
   *
   * @param credentials the name, lowercase words separated by hyphens, at most 64 characters
   */
  record Tls(String credentials) implements Transport {
    private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");

    public Tls {
      Objects.requireNonNull(credentials, "credentials");
      if (!NAME.matcher(credentials).matches() || credentials.length() > 64) {
        throw new IllegalArgumentException("credentials name must be lowercase words separated by hyphens: " + credentials);
      }
    }
  }
}
