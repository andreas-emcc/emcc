package dev.emcc.sdk;

import java.util.Objects;
import java.util.regex.Pattern;

/**
 * Permission names (ADR-0022). Core permissions are below; a plugin's own are {@code
 * plugin.<id>.<name>} and are declared in its manifest. Which users have which is ECore's
 * configuration (groups or roles from the IAM); in the no-login mode the local user has all.
 *
 * <pre>{@code
 * Endpoint.get("/streams").requires(Permissions.SETTINGS_ADMIN)
 * Permissions.ofPlugin("cot-in", "replay")   // "plugin.cot-in.replay"
 * }</pre>
 */
public final class Permissions {

  /** Create, change and delete map objects. */
  public static final String OBJECTS_EDIT = "objects.edit";

  /** Create, rename, reorder and delete layers. */
  public static final String LAYERS_EDIT = "layers.edit";

  /** Change ECore's and the plugins' settings in the settings view. */
  public static final String SETTINGS_ADMIN = "settings.admin";

  private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)+");

  private Permissions() {}

  /** A plugin's own permission, {@code plugin.<pluginId>.<name>}. */
  public static String ofPlugin(String pluginId, String name) {
    return check("plugin." + pluginId + "." + name);
  }

  /**
   * Returns {@code permission} if it is a valid name (as in the manifest's {@code permissions}).
   *
   * @throws IllegalArgumentException otherwise
   */
  public static String check(String permission) {
    Objects.requireNonNull(permission, "permission");
    if (!NAME.matcher(permission).matches() || permission.length() > 128) {
      throw new IllegalArgumentException("not a permission name: " + permission);
    }
    return permission;
  }
}
