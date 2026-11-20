package dev.emcc.ecore.store;

import dev.emcc.sdk.model.EntityType;
import java.util.Objects;
import java.util.Set;

/**
 * Whom a change request acts for, and so whether it is checked (overview 4.4, "Permissions are
 * enforced here"): a user, whose request needs {@link #OBJECTS_EDIT} for an object and {@link
 * #LAYERS_EDIT} for a layer; or no user, a plugin's server part acting as the plugin or ECore itself,
 * which are not checked. A browser session's requests are always its user's, whatever their {@code
 * source.plugin} says.
 *
 * <pre>{@code
 * new StoreMsg.Apply(request, Requester.user("u-alice", Set.of("objects.edit")), reply)  // a browser session
 * new StoreMsg.Apply(request, Requester.NO_USER, reply)                                  // a plugin's server part, ECore
 * }</pre>
 */
public sealed interface Requester {

  /** Create, change and delete map objects (the SDK's {@code Permissions.OBJECTS_EDIT}). */
  String OBJECTS_EDIT = "objects.edit";

  /** Create, change and delete layers (the SDK's {@code Permissions.LAYERS_EDIT}). */
  String LAYERS_EDIT = "layers.edit";

  /** A plugin's server part or ECore: not checked. */
  Requester NO_USER = new NoUser();

  /** A logged-in user with these permissions (fixed at login). */
  static User user(String id, Set<String> permissions) {
    return new User(id, permissions, false);
  }

  /** The local user of the no-login mode, who has every permission (ADR-0022). */
  static User withAllPermissions(String id) {
    return new User(id, Set.of(), true);
  }

  /** The permission a user needs to create, update or delete an entity of this type. */
  static String permissionFor(EntityType type) {
    return switch (type) {
      case OBJECT -> OBJECTS_EDIT;
      case LAYER -> LAYERS_EDIT;
    };
  }

  /** The message of a {@code PERMISSION_DENIED} rejection for this type. */
  static String refusal(EntityType type) {
    return "changing " + (type == EntityType.OBJECT ? "an object" : "a layer") + " needs the permission " + permissionFor(type);
  }

  /** Whether it may create, update and delete entities of this type in View. */
  default boolean mayChange(EntityType type) {
    return has(permissionFor(type));
  }

  /** Whether it holds {@code permission}; no user holds every one, as the no-login mode's local user does. */
  boolean has(String permission);

  /**
   * A user.
   *
   * @param id the user id, written as {@code source.user} of the user's changes
   * @param permissions the user's permissions; ignored when {@code all}
   * @param all whether the user has every permission (the no-login mode's local user)
   */
  record User(String id, Set<String> permissions, boolean all) implements Requester {
    public User {
      Objects.requireNonNull(id, "id");
      permissions = Set.copyOf(permissions);
    }

    @Override
    public boolean has(String permission) {
      return all || permissions.contains(permission);
    }
  }

  /** No user: not checked. */
  record NoUser() implements Requester {
    @Override
    public boolean has(String permission) {
      return true;
    }
  }
}
