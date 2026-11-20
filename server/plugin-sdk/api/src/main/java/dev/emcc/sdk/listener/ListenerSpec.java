package dev.emcc.sdk.listener;

import java.time.Duration;
import java.util.Objects;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * How to connect a listener. Immutable; the methods return a new spec.
 *
 * <pre>{@code
 * ListenerSpec.tcp("tak-north", "tak.example.local", 8087)
 * ListenerSpec.tls("tak-north", "tak.example.local", 8089, "tak-north")
 *     .idleTimeout(Duration.ofMinutes(5))
 *     .reconnect(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60)))
 * }</pre>
 *
 * @param name the listener's name, unique within the plugin: lowercase words separated by hyphens, at most 64 characters (e.g. the stream's name)
 * @param host the host to connect to; must be named by the plugin's settings (manifest {@code network})
 * @param port the port, 1 to 65 535
 * @param transport plain TCP, or TLS with credentials from local server configuration
 * @param connectTimeout how long a connection attempt may take, 100 ms to 60 s (default 10 s)
 * @param idleTimeout how long a read may wait for data before it fails and the loop ends, 1 s to 1 hour (default 5 minutes)
 * @param reconnect how to connect again after the loop ended; {@code null} to stop after the first connection (default)
 *
 * @deprecated from SDK 1.2.0: use a connection task ({@code dev.emcc.sdk.connection}), in which the
 *     plugin opens its own sockets of any kind (ADR-0036). Kept in SDK 1.x for existing code, removed
 *     in the next major version.
 */
@Deprecated(since = "1.2.0")
public record ListenerSpec(
    String name, String host, int port, Transport transport, Duration connectTimeout, Duration idleTimeout, @Nullable Backoff reconnect) {

  public static final Duration DEFAULT_CONNECT_TIMEOUT = Duration.ofSeconds(10);
  public static final Duration DEFAULT_IDLE_TIMEOUT = Duration.ofMinutes(5);

  private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");

  public ListenerSpec {
    Objects.requireNonNull(name, "name");
    Objects.requireNonNull(host, "host");
    Objects.requireNonNull(transport, "transport");
    Objects.requireNonNull(connectTimeout, "connectTimeout");
    Objects.requireNonNull(idleTimeout, "idleTimeout");
    if (!NAME.matcher(name).matches() || name.length() > 64) {
      throw new IllegalArgumentException("listener name must be lowercase words separated by hyphens: " + name);
    }
    if (host.isEmpty() || host.length() > 253) {
      throw new IllegalArgumentException("host must be 1..253 characters");
    }
    if (port < 1 || port > 65_535) {
      throw new IllegalArgumentException("port must be 1..65535: " + port);
    }
    if (connectTimeout.compareTo(Duration.ofMillis(100)) < 0 || connectTimeout.compareTo(Duration.ofSeconds(60)) > 0) {
      throw new IllegalArgumentException("connect timeout must be 100 ms..60 s: " + connectTimeout);
    }
    if (idleTimeout.compareTo(Duration.ofSeconds(1)) < 0 || idleTimeout.compareTo(Duration.ofHours(1)) > 0) {
      throw new IllegalArgumentException("idle timeout must be 1 s..1 h: " + idleTimeout);
    }
  }

  /** A plain TCP client connection. */
  public static ListenerSpec tcp(String name, String host, int port) {
    return new ListenerSpec(name, host, port, new Transport.Tcp(), DEFAULT_CONNECT_TIMEOUT, DEFAULT_IDLE_TIMEOUT, null);
  }

  /** A TLS client connection with the client key and trust store that local server configuration names {@code credentials}. */
  public static ListenerSpec tls(String name, String host, int port, String credentials) {
    return new ListenerSpec(name, host, port, new Transport.Tls(credentials), DEFAULT_CONNECT_TIMEOUT, DEFAULT_IDLE_TIMEOUT, null);
  }

  public ListenerSpec connectTimeout(Duration value) {
    return new ListenerSpec(name, host, port, transport, value, idleTimeout, reconnect);
  }

  public ListenerSpec idleTimeout(Duration value) {
    return new ListenerSpec(name, host, port, transport, connectTimeout, value, reconnect);
  }

  public ListenerSpec reconnect(Backoff value) {
    return new ListenerSpec(name, host, port, transport, connectTimeout, idleTimeout, value);
  }
}
