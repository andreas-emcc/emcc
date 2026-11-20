package dev.emcc.sdk;

import java.util.Objects;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.2.0: a workspace (ADR-0039; {@code context.workspaces()}): View, or one a plugin declares
 * in its manifest's {@code workspaces}, shown as a tab next to View. Its layers and their objects
 * are seen by users with its {@code viewPermission} and changed by those with its {@code
 * editPermission}, instead of {@code objects.edit} and {@code layers.edit}, which stay View's.
 *
 * @param id {@link #VIEW}, or the declaring plugin's id, a dot and a name, e.g. {@code simulator.simulation}
 * @param name the tab's name, 1 to 64 characters
 * @param viewPermission who sees it; {@code null} for View, which everyone sees
 * @param editPermission who changes its layers and objects; {@code null} for View, where {@code
 *     objects.edit} and {@code layers.edit} apply
 * @param order lower comes first after View; View is first
 */
public record Workspace(String id, String name, @Nullable String viewPermission, @Nullable String editPermission, int order) {

  /** View's id: the workspace of every layer without a {@code workspace}. */
  public static final String VIEW = "core.view";

  private static final Pattern TYPE_NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*\\.[a-z][a-z0-9]*(-[a-z0-9]+)*");

  public Workspace {
    Objects.requireNonNull(id, "id");
    Objects.requireNonNull(name, "name");
    if (!TYPE_NAME.matcher(id).matches() || id.length() > 129) {
      throw new IllegalArgumentException("a workspace id is a type name such as simulator.simulation: " + id);
    }
    if (name.isBlank() || name.length() > 64) {
      throw new IllegalArgumentException("a workspace's name must be 1..64 characters");
    }
    if (!id.equals(VIEW) && (viewPermission == null || editPermission == null)) {
      throw new IllegalArgumentException("a declared workspace has a view and an edit permission: " + id);
    }
    if (viewPermission != null) {
      Permissions.check(viewPermission);
    }
    if (editPermission != null) {
      Permissions.check(editPermission);
    }
  }

  /** View, first of all workspaces. */
  public static Workspace view() {
    return new Workspace(VIEW, "View", null, null, Integer.MIN_VALUE);
  }

  /** Whether it is View. */
  public boolean isView() {
    return id.equals(VIEW);
  }

  /** The permission a user needs to change this workspace's layers (with {@code layers} true) or their objects. */
  public String editPermissionFor(boolean layers) {
    return editPermission != null ? editPermission : layers ? Permissions.LAYERS_EDIT : Permissions.OBJECTS_EDIT;
  }
}
