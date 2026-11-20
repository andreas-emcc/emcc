package dev.emcc.sdk;

import java.util.Objects;
import java.util.Set;

/**
 * A user and their permissions (ADR-0022), e.g. the user of a browser session that called a
 * plugin endpoint. Immutable.
 *
 * <pre>{@code
 * if (!request.user().has(Permissions.OBJECTS_EDIT)) {
 *   request.response().respond(HttpReply.of(403, Headers.empty(), Bytes.empty()));
 * }
 * }</pre>
 *
 * @param id the user's identifier from the IAM (OIDC {@code sub}), or {@link #NO_LOGIN_ID} in the no-login mode
 * @param name a display name
 * @param permissions the user's permissions; ignored for the no-login user, who has all
 * @param noLogin whether this is the local user of the no-login mode
 */
public record User(String id, String name, Set<String> permissions, boolean noLogin) {

  /** The id of the local user in the no-login mode. */
  public static final String NO_LOGIN_ID = "local";

  public User {
    Objects.requireNonNull(id, "id");
    Objects.requireNonNull(name, "name");
    permissions = Set.copyOf(permissions);
    if (id.isEmpty() || id.length() > 256) {
      throw new IllegalArgumentException("id must be 1..256 characters");
    }
    permissions.forEach(Permissions::check);
  }

  /** A logged-in user with these permissions. */
  public static User of(String id, String name, Set<String> permissions) {
    return new User(id, name, permissions, false);
  }

  /** The local user of the no-login mode, who has every permission. */
  public static User noLoginUser() {
    return new User(NO_LOGIN_ID, "Local user", Set.of(), true);
  }

  /** Whether the user has {@code permission}: always true in the no-login mode. */
  public boolean has(String permission) {
    return noLogin || permissions.contains(permission);
  }
}
