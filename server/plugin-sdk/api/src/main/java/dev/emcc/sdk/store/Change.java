package dev.emcc.sdk.store;

import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.EntityContent;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.FieldValue;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Operation;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * A change request as a server part sends it: without {@code requestId} and {@code
 * source.plugin}, which ECore fills in. Immutable; the {@code with…} and {@code by…} methods return
 * a new change.
 *
 * <pre>{@code
 * Change.createObject(newId, content).withExternalRef(new ExternalRef("cot", uid)).bySystem("tak-north")
 * Change.updateObject(current, content)          // baseVersion = current.version()
 * Change.deleteLayer(layer)
 * }</pre>
 *
 * <p><b>Compatibility:</b> the 1.1.0 constructor without {@code fields} and {@code saved}
 * stays. Do not deconstruct this record with a record pattern: it may gain components in later 1.x
 * versions.
 *
 * @param entityType object or layer
 * @param operation create, update or delete
 * @param entityId the entity; for create a new UUID v7
 * @param baseVersion the version the change is based on, or {@code null}
 * @param data the new content for create and update; {@code null} for delete
 * @param externalRef only for the create of an object (model rule 16); otherwise {@code null}
 * @param system the external system the change comes from ({@code source.system}), e.g. the stream's name; or {@code null}
 * @param fields SDK 1.2.0: declared fields to set ({@link #withFields}); empty when there are none
 * @param saved SDK 1.2.0: {@code false} for an update the store applies and sends but does not save ({@link #notSaved()}); {@code true} otherwise
 */
public record Change(
    EntityType entityType,
    Operation operation,
    UUID entityId,
    @Nullable Long baseVersion,
    @Nullable EntityContent data,
    @Nullable ExternalRef externalRef,
    @Nullable String system,
    List<FieldValue> fields,
    boolean saved) {

  /** The 1.1.0 constructor: no declared fields, saved. */
  public Change(
      EntityType entityType, Operation operation, UUID entityId, @Nullable Long baseVersion,
      @Nullable EntityContent data, @Nullable ExternalRef externalRef, @Nullable String system) {
    this(entityType, operation, entityId, baseVersion, data, externalRef, system, List.of(), true);
  }

  public Change {
    if (system != null && (system.isEmpty() || system.length() > 256)) {
      throw new IllegalArgumentException("system must be 1..256 characters");
    }
    fields = List.copyOf(fields);
    // The same checks as a ChangeRequest; the request id and plugin are only placeholders here.
    new ChangeRequest(new UUID(0, 1), entityType, operation, entityId, baseVersion, data, externalRef, new Actor("placeholder", null, system), fields);
    if (!saved && (entityType != EntityType.OBJECT || operation != Operation.UPDATE)) {
      throw new IllegalArgumentException("only an object update can be not saved (ADR-0041)");
    }
    if (!saved && !fields.isEmpty()) {
      throw new IllegalArgumentException("an update that is not saved carries no declared fields (ADR-0041: moves only)");
    }
  }

  public static Change createObject(UUID entityId, MapObjectContent data) {
    return new Change(EntityType.OBJECT, Operation.CREATE, entityId, null, data, null, null);
  }

  /** An update based on {@code current}: the complete new core content (model rule 5), with {@code baseVersion} set. */
  public static Change updateObject(MapObject current, MapObjectContent data) {
    return new Change(EntityType.OBJECT, Operation.UPDATE, current.id(), current.version(), data, null, null);
  }

  public static Change deleteObject(MapObject current) {
    return new Change(EntityType.OBJECT, Operation.DELETE, current.id(), current.version(), null, null, null);
  }

  public static Change createLayer(UUID entityId, LayerContent data) {
    return new Change(EntityType.LAYER, Operation.CREATE, entityId, null, data, null, null);
  }

  public static Change updateLayer(Layer current, LayerContent data) {
    return new Change(EntityType.LAYER, Operation.UPDATE, current.id(), current.version(), data, null, null);
  }

  public static Change deleteLayer(Layer current) {
    return new Change(EntityType.LAYER, Operation.DELETE, current.id(), current.version(), null, null, null);
  }

  /** The object's identity in an external system; only for the create of an object. */
  public Change withExternalRef(ExternalRef value) {
    return new Change(entityType, operation, entityId, baseVersion, data, Objects.requireNonNull(value, "value"), system, fields, saved);
  }

  /** The external system the change comes from, recorded as {@code source.system} and in the object's audit. */
  public Change bySystem(String value) {
    return new Change(entityType, operation, entityId, baseVersion, data, externalRef, Objects.requireNonNull(value, "value"), fields, saved);
  }

  /**
   * SDK 1.2.0: the change with these declared fields to set, instead of its own (ADR-0038). Only
   * for the create and update of an object. The store checks each against its declaration and
   * applies it after the content; a field of another plugin must be {@code editableByOthers}.
   *
   * <pre>{@code
   * Change.updateObject(current, content).withFields(List.of(new FieldValue("cot", "callsign", JsonString.of("ALPHA-1"))))
   * }</pre>
   *
   * @throws IllegalArgumentException on anything but the create or update of an object, with more
   *     than {@link ChangeRequest#MAX_FIELDS} fields, or on a change that is not saved
   */
  public Change withFields(List<FieldValue> value) {
    return new Change(entityType, operation, entityId, baseVersion, data, externalRef, system, value, saved);
  }

  /**
   * SDK 1.2.0: the update is applied and sent as any other (change event, live picture, store
   * subscriptions, outputs), but <b>not saved</b> (ADR-0041): after a restart the object comes back
   * as its last saved change, or a later snapshot of the store, left it.
   *
   * <p><b>Moves only:</b> the update may change only the object's {@code geometry}, its {@code
   * time}, and the symbol's {@code direction} and {@code speed}; everything else must equal the
   * current object, and it carries no declared fields. The store rejects any other with {@code
   * VALIDATION_FAILED}, so a real edit is never lost unsaved. Save the object's whole state with
   * an ordinary update at the saving moments of ADR-0041 point 4, not periodically: before a route
   * runs; when it pauses, stops at its end or is reset; and when a user changes the simulation
   * during a run.
   *
   * <p><b>Only the simulator uses it</b> (ADR-0041 point 7): another plugin uses it only with the
   * project owner's approval, since it trades durability for load.
   *
   * <pre>{@code
   * context.store().submit(Change.updateObject(track, moved).notSaved(), TIMEOUT, self, SimMsg.Moved::new);
   * }</pre>
   *
   * @throws IllegalArgumentException on anything but the update of an object, or with declared fields
   */
  public Change notSaved() {
    return new Change(entityType, operation, entityId, baseVersion, data, externalRef, system, fields, false);
  }

  /** The full change request, as ECore (or the test kit) sends it for {@code pluginId}. Whether it is saved is not part of it. */
  public ChangeRequest toRequest(UUID requestId, String pluginId) {
    return new ChangeRequest(requestId, entityType, operation, entityId, baseVersion, data, externalRef, new Actor(pluginId, null, system), fields);
  }
}
