package dev.emcc.sdk.model;

import dev.emcc.sdk.Message;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * Published by the object store on {@code objects.changed} after applying a change request
 * (ADR-0005). Contains everything needed for persistence, the live picture and, later, history.
 *
 * <pre>{@code
 * if (event.operation() == Operation.DELETE) { remove(event.entityId()); } else { put(event.state()); }
 * }</pre>
 *
 * @param sequenceNo global, gapless order of all changes on one server
 * @param requestId the request this answers
 * @param entityType object or layer
 * @param operation create, update or delete
 * @param entityId the entity
 * @param version the version after the change; for delete, the previous version plus one
 * @param previousVersion {@code null} for create
 * @param baseVersion as sent by the requester, or {@code null}
 * @param state the complete state after the change; {@code null} for delete
 * @param label the entity's label (for delete: as it was), so receivers can filter without the state
 * @param at when the change was applied
 * @param by who caused it
 */
public record ChangeEvent(
    long sequenceNo,
    UUID requestId,
    EntityType entityType,
    Operation operation,
    UUID entityId,
    long version,
    @Nullable Long previousVersion,
    @Nullable Long baseVersion,
    @Nullable Entity state,
    SecurityLabel label,
    Instant at,
    Actor by)
    implements Message {

  public ChangeEvent {
    Objects.requireNonNull(requestId, "requestId");
    Objects.requireNonNull(entityType, "entityType");
    Objects.requireNonNull(operation, "operation");
    Objects.requireNonNull(entityId, "entityId");
    Objects.requireNonNull(label, "label");
    Objects.requireNonNull(at, "at");
    Objects.requireNonNull(by, "by");
    if (sequenceNo < 1 || version < 1) {
      throw new IllegalArgumentException("sequenceNo and version must be >= 1");
    }
    if (operation == Operation.CREATE) {
      if (previousVersion != null || version != 1) {
        throw new IllegalArgumentException("a create has version 1 and no previous version");
      }
    } else if (previousVersion == null || previousVersion + 1 != version) {
      throw new IllegalArgumentException("version must be previousVersion + 1");
    }
    if ((operation == Operation.DELETE) != (state == null)) {
      throw new IllegalArgumentException("state is null exactly for a delete");
    }
    if (state != null && (!state.id().equals(entityId) || state.version() != version || state.content().entityType() != entityType)) {
      throw new IllegalArgumentException("state does not match entityId, version or entityType");
    }
  }
}
