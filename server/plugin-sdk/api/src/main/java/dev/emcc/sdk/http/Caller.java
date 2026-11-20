package dev.emcc.sdk.http;

import dev.emcc.sdk.User;
import java.util.Objects;
import java.util.Set;

/**
 * SDK 1.6.0 (CR-0041 part A; ADR-0055 point 5.3): who sent an endpoint request.
 *
 * <ul>
 *   <li>{@link Kind#USER}: a browser session, the plugin's ordinary endpoints ({@code /api/plugins/...});
 *       {@link EndpointRequest#user()} is its user;
 *   <li>{@link Kind#SERVICE}: another system calling a service endpoint ({@link Endpoint#service});
 *       in SDK 1.6.0 without authentication, so {@link EndpointRequest#user()} is {@link #SERVICE_USER},
 *       who has no permissions. Later a service has a name and the permissions configured for it.
 * </ul>
 *
 * @param kind the caller's kind
 * @param address the caller's network address as ECore saw it, e.g. {@code 127.0.0.1}, for logs and
 *     the status; never a way to decide who may call (it can be forged behind a proxy)
 */
public record Caller(Kind kind, String address) {

  /** The caller's kind. */
  public enum Kind { USER, SERVICE }

  /** The user of a service call in SDK 1.6.0: no permissions, not the no-login user. */
  public static final User SERVICE_USER = User.of("service", "Service caller", Set.of());

  public Caller {
    Objects.requireNonNull(kind, "kind");
    Objects.requireNonNull(address, "address");
    if (address.length() > 128) {
      throw new IllegalArgumentException("an address is at most 128 characters");
    }
  }

  /** A browser session's request; the address unknown to a test. */
  public static Caller user(String address) {
    return new Caller(Kind.USER, address);
  }

  /** A service endpoint's caller. */
  public static Caller service(String address) {
    return new Caller(Kind.SERVICE, address);
  }
}
