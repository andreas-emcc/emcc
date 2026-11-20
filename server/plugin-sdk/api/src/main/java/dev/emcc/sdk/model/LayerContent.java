package dev.emcc.sdk.model;

import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * The fields of a layer that its creator controls.
 *
 * <pre>{@code
 * new LayerContent("Own forces", 20.5, true, label, Extensions.empty())
 * }</pre>
 *
 * <p><b>Compatibility:</b> the 1.1.0 constructor without {@code workspace} and the 1.2.0 constructor
 * without {@code locked} stay. Do not
 * deconstruct this record with a record pattern: it may gain components in later 1.x versions.
 *
 * @param name 1 to 256 characters
 * @param drawOrder higher values are drawn on top; ties are broken by id
 * @param visible the default visibility for new sessions
 * @param label the security label
 * @param extensions plugin data; empty when there is none
 * @param workspace SDK 1.2.0: the workspace it belongs to (ADR-0039), e.g. {@code
 *     simulator.simulation}; {@code null} for View, as the store keeps it (it also accepts {@code
 *     core.view}). On create the creating plugin sets it; on update {@code null} keeps the stored
 *     one, and any other value must equal it: a layer stays in its workspace
 * @param locked SDK 1.3.0: the layer lock (ADR-0042). {@code null} is absent, as the store keeps
 *     {@code false}; read it with {@link #isLocked()}. On update {@code null} keeps the stored
 *     value, {@code true} sets it and {@code false} clears it. While it is set, the store refuses a
 *     user's change to the layer's content with {@code LAYER_LOCKED}; a server part's changes pass
 *     (ADR-0042 point 5), so a server part need not read it
 */
public record LayerContent(String name, double drawOrder, boolean visible, SecurityLabel label, Extensions extensions, @Nullable String workspace,
    @Nullable Boolean locked) implements EntityContent {

  private static final java.util.regex.Pattern TYPE_NAME = java.util.regex.Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*\\.[a-z][a-z0-9]*(-[a-z0-9]+)*");

  /** The 1.1.0 constructor: in View, or (on update) in the stored workspace. */
  public LayerContent(String name, double drawOrder, boolean visible, SecurityLabel label, Extensions extensions) {
    this(name, drawOrder, visible, label, extensions, null, null);
  }

  /** The 1.2.0 constructor: {@code locked} absent, so on update the stored lock stays. */
  public LayerContent(String name, double drawOrder, boolean visible, SecurityLabel label, Extensions extensions, @Nullable String workspace) {
    this(name, drawOrder, visible, label, extensions, workspace, null);
  }

  public LayerContent {
    Objects.requireNonNull(name, "name");
    Objects.requireNonNull(label, "label");
    Objects.requireNonNull(extensions, "extensions");
    if (name.isEmpty() || name.length() > 256) {
      throw new IllegalArgumentException("name must be 1..256 characters");
    }
    if (!Double.isFinite(drawOrder)) {
      throw new IllegalArgumentException("drawOrder must be finite");
    }
    if (workspace != null && (!TYPE_NAME.matcher(workspace).matches() || workspace.length() > 129)) {
      throw new IllegalArgumentException("a workspace is a type name such as simulator.simulation: " + workspace);
    }
  }

  /** SDK 1.2.0: the same content in {@code value}'s workspace ({@code core.view} or {@code null} for View). */
  public LayerContent inWorkspace(@Nullable String value) {
    return new LayerContent(name, drawOrder, visible, label, extensions, value, locked);
  }

  /** SDK 1.2.0: the workspace it is in, {@code core.view} for View. */
  public String workspaceOrView() {
    return workspace == null ? dev.emcc.sdk.Workspace.VIEW : workspace;
  }

  /** SDK 1.3.0: whether the layer is locked; absent and {@code false} both read as not locked. */
  public boolean isLocked() {
    return Boolean.TRUE.equals(locked);
  }

  /**
   * SDK 1.3.0: the same content with {@code value} as its lock: {@code true} to lock, {@code false} to
   * unlock, {@code null} to keep the stored lock on update.
   */
  public LayerContent withLocked(@Nullable Boolean value) {
    return new LayerContent(name, drawOrder, visible, label, extensions, workspace, value);
  }

  @Override
  public EntityType entityType() {
    return EntityType.LAYER;
  }
}
