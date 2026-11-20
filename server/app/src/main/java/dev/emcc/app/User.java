package dev.emcc.app;

import java.util.Objects;
import java.util.Set;

/**
 * The user behind a browser session (ADR-0022): who changes go out as ({@code source.user}) and what
 * they may do. With login the id is the IAM's {@code sub}; in the no-login mode it is {@link #LOCAL}.
 *
 * @param id the user id as the model writes it in {@code source.user}
 * @param name for showing, e.g. the IAM's {@code preferred_username}
 * @param allPermissions true for the local user of the no-login mode
 * @param permissions the emc2 permissions mapped from the IAM's roles (with login; empty otherwise)
 */
record User(String id, String name, boolean allPermissions, Set<String> permissions) {

  /** The one built-in user of the no-login mode, with all permissions. */
  static final User LOCAL = new User("local", "Local user", true, Set.of());

  User {
    Objects.requireNonNull(id, "id");
    Objects.requireNonNull(name, "name");
    permissions = Set.copyOf(permissions);
    if (id.isEmpty() || id.length() > 256) {
      throw new IllegalArgumentException("a user id has 1 to 256 characters (model: actor.user)");
    }
  }
}
