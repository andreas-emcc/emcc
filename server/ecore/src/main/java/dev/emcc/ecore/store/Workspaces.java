package dev.emcc.ecore.store;

import dev.emcc.sdk.model.EntityType;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import org.jspecify.annotations.Nullable;

/**
 * The workspaces (ADR-0039): View, ECore's own, and those the loaded plugins declare in their
 * manifests' {@code workspaces}, as the object store and the live picture need them. Fixed once,
 * when the plugin host has read the manifests and before any plugin runs, as {@link DataTypes} is.
 *
 * <p>A layer names its workspace ({@code workspace}; absent for View). Who may see a workspace's
 * layers and objects, and who may change them, follows from it: View is everyone's, and changes
 * there need {@code objects.edit} and {@code layers.edit}; a declared workspace has a view and an
 * edit permission of its own (point 7). A workspace no loaded plugin declares any more (its plugin
 * removed or refused) keeps its layers, but nobody may see or change them (owner, 2026-10-27).
 *
 * <p>Shared between the plugin host, which fixes it, the object store's worker and the live
 * sessions, which read it: an immutable map behind a volatile field, no lock.
 */
public final class Workspaces {

  /** View's id: the workspace of every layer without a {@code workspace} (the SDK's {@code Workspace.VIEW}). */
  public static final String VIEW = "core.view";

  /**
   * A workspace a plugin declares.
   *
   * @param viewPermission who sees its layers and objects
   * @param editPermission who changes them, instead of {@code objects.edit} and {@code layers.edit}
   */
  public record Declared(String id, String viewPermission, String editPermission) {
    public Declared {
      Objects.requireNonNull(id, "id");
      Objects.requireNonNull(viewPermission, "viewPermission");
      Objects.requireNonNull(editPermission, "editPermission");
      if (id.equals(VIEW)) {
        throw new IllegalArgumentException("View is ECore's own workspace, not a declared one");
      }
    }
  }

  private final AtomicBoolean fixed = new AtomicBoolean();
  private volatile Map<String, Declared> declared = Map.of();

  /** View only, until {@link #fix} adds the plugins' workspaces. */
  public Workspaces() {}

  /** Workspaces fixed at once. For tests. */
  public static Workspaces of(List<Declared> declared) {
    Workspaces workspaces = new Workspaces();
    workspaces.fix(declared);
    return workspaces;
  }

  /**
   * Fixes the plugins' workspaces, once.
   *
   * @throws IllegalStateException if they were fixed already
   * @throws IllegalArgumentException if a workspace comes twice
   */
  public void fix(List<Declared> all) {
    if (!fixed.compareAndSet(false, true)) {
      throw new IllegalStateException("the workspaces are fixed already");
    }
    Map<String, Declared> byId = new LinkedHashMap<>();
    for (Declared d : all) {
      if (byId.put(d.id(), d) != null) {
        throw new IllegalArgumentException("the workspace " + d.id() + " is declared twice");
      }
    }
    declared = Map.copyOf(byId);
  }

  /** The workspace a layer's {@code workspace} names: View when it names none. */
  public static String ofLayer(@Nullable String layerWorkspace) {
    return layerWorkspace == null ? VIEW : layerWorkspace;
  }

  /** The declaration of {@code id}, or {@code null} for View and for a workspace no loaded plugin declares. */
  public @Nullable Declared declared(String id) {
    return declared.get(id);
  }

  /** Whether {@code id} is View or a workspace a loaded plugin declares. */
  public boolean isKnown(String id) {
    return id.equals(VIEW) || declared.containsKey(id);
  }

  /**
   * Whether {@code requester} may see the layers and objects of {@code workspace}: View, everyone;
   * a declared one, a user with its view permission and every plugin's server part (ADR-0039 point
   * 7: not filtered); one no loaded plugin declares, no user.
   */
  public boolean maySee(Requester requester, String workspace) {
    if (workspace.equals(VIEW) || requester instanceof Requester.NoUser) {
      return true;
    }
    Declared d = declared.get(workspace);
    return d != null && requester.has(d.viewPermission());
  }

  /** Every workspace {@code user} may see: View first, then the declared ones with their view permission. */
  public Set<String> visibleTo(Requester.User user) {
    Set<String> visible = new LinkedHashSet<>();
    visible.add(VIEW);
    declared.values().stream().filter(d -> user.has(d.viewPermission())).forEach(d -> visible.add(d.id()));
    return Set.copyOf(visible);
  }

  /**
   * The permission a user needs to change an entity of {@code type} in {@code workspace}: {@code
   * objects.edit} or {@code layers.edit} in View, the declared workspace's edit permission in
   * another; {@code null} when nobody may, because no loaded plugin declares it.
   */
  public @Nullable String editPermission(String workspace, EntityType type) {
    if (workspace.equals(VIEW)) {
      return Requester.permissionFor(type);
    }
    Declared d = declared.get(workspace);
    return d == null ? null : d.editPermission();
  }

  /**
   * Why a user may not change an entity of {@code type} in {@code workspace}, or {@code null} if it
   * may: the text of the {@code PERMISSION_DENIED} rejection, the same from the object store and
   * from the live session's early check.
   */
  public @Nullable String refusal(Requester.User user, EntityType type, String workspace) {
    String needed = editPermission(workspace, type);
    if (needed == null) {
      return "no loaded plugin declares the workspace " + workspace + ", so its layers and objects cannot be changed (ADR-0039)";
    }
    if (user.has(needed)) {
      return null;
    }
    return workspace.equals(VIEW) ? Requester.refusal(type)
        : "changing " + (type == EntityType.OBJECT ? "an object" : "a layer") + " in the workspace " + workspace
            + " needs the permission " + needed;
  }

  /**
   * Whether {@code user} holds any permission that could let it change an entity of {@code type}:
   * View's, or any declared workspace's edit permission. A first, coarse check for whoever cannot
   * tell the entity's workspace (the live session); the object store decides exactly.
   */
  public boolean mayChangeSomewhere(Requester.User user, EntityType type) {
    return user.mayChange(type) || declared.values().stream().anyMatch(d -> user.has(d.editPermission()));
  }
}
