package dev.emcc.ecore.store;

import dev.emcc.ecore.geo.Cap;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.MapObject;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * A change as the object store applied it, published on {@link ObjectStore#CHANGES}: the change
 * event, and beside it what ECore's own parts need to judge it per area without a copy of the
 * picture (spike S3, recommendation 8): the object before the change and the bounds of its geometry
 * before and after. The public {@link ChangeEvent} does not change.
 *
 * @param before the object before the change; null for a create and for a layer
 * @param beforeBound the bound of {@code before}'s geometry; null when {@code before} is
 * @param afterBound the bound of the object after the change; null for a delete and for a layer
 * @param notSaved an update that is not written to the journal (ADR-0041); only persistence
 *     looks at it, everyone else gets an ordinary change
 * @param workspace the workspace of the layer, or of the object's layer (ADR-0039; {@link
 *     Workspaces#VIEW} for View): the live sessions send the change only to users who may see it.
 *     An entity never changes its workspace (model rules R1, R2)
 */
public record StoreChange(
    ChangeEvent event, @Nullable MapObject before, @Nullable Cap beforeBound, @Nullable Cap afterBound, boolean notSaved,
    String workspace) {

  public StoreChange {
    Objects.requireNonNull(event, "event");
    Objects.requireNonNull(workspace, "workspace");
    if ((before == null) != (beforeBound == null)) {
      throw new IllegalArgumentException("an object before the change comes with its bound");
    }
  }

  /** In View. */
  public StoreChange(
      ChangeEvent event, @Nullable MapObject before, @Nullable Cap beforeBound, @Nullable Cap afterBound, boolean notSaved) {
    this(event, before, beforeBound, afterBound, notSaved, Workspaces.VIEW);
  }

  /** A change in View that is saved. */
  public StoreChange(ChangeEvent event, @Nullable MapObject before, @Nullable Cap beforeBound, @Nullable Cap afterBound) {
    this(event, before, beforeBound, afterBound, false);
  }

  /** A change in View with nothing beside the event: a layer's. */
  public static StoreChange of(ChangeEvent event) {
    return of(event, Workspaces.VIEW);
  }

  /** A change in {@code workspace} with nothing beside the event: a layer's. */
  public static StoreChange of(ChangeEvent event, String workspace) {
    return new StoreChange(event, null, null, null, false, workspace);
  }
}
