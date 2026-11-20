package dev.emcc.sdk.model;

import dev.emcc.sdk.Message;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * Sent by the object store to the requester when it does not apply a change request (model rule
 * 12). Not published on {@code objects.changed}.
 *
 * <pre>{@code
 * if (rejection.code() == ChangeRejection.Code.LAYER_NOT_EMPTY) { notifyUser(rejection.message()); }
 * }</pre>
 *
 * @param requestId the request this answers
 * @param entityType object or layer
 * @param operation create, update or delete
 * @param entityId the entity
 * @param code why
 * @param message a human-readable explanation in English
 * @param details for {@code VALIDATION_FAILED}: what is wrong where; for {@code LAYER_LOCKED}: the
 *     layer; otherwise usually empty
 * @param at when the request was rejected
 */
public record ChangeRejection(
    UUID requestId, EntityType entityType, Operation operation, UUID entityId, Code code, String message, List<Detail> details, Instant at)
    implements Message {

  public ChangeRejection {
    Objects.requireNonNull(requestId, "requestId");
    Objects.requireNonNull(entityType, "entityType");
    Objects.requireNonNull(operation, "operation");
    Objects.requireNonNull(entityId, "entityId");
    Objects.requireNonNull(code, "code");
    Objects.requireNonNull(message, "message");
    Objects.requireNonNull(at, "at");
    details = List.copyOf(details);
    if (message.isEmpty() || message.length() > 1024) {
      throw new IllegalArgumentException("message must be 1..1024 characters");
    }
    if (details.size() > 50) {
      throw new IllegalArgumentException("at most 50 details");
    }
  }

  /** The rejection codes of data model 1.0.0, and 1.3.0's {@link #LAYER_LOCKED}; see {@code model/schemas/change-rejection.schema.json}. */
  public enum Code {
    VALIDATION_FAILED,
    ENTITY_NOT_FOUND,
    ENTITY_EXISTS,
    /** A create with an {@code externalRef} that another object has (model rule 16). */
    EXTERNAL_REF_EXISTS,
    LAYER_NOT_FOUND,
    LAYER_NOT_EMPTY,
    PERMISSION_DENIED,
    INTERNAL_ERROR,
    /**
     * SDK 1.3.0 (ADR-0042): a user's change to a locked layer's content. One detail names the layer:
     * its path is {@code /data/layerId} when the request carries the layer's id there, else empty. A
     * server part never gets it, since its changes pass the lock; only a test that applies a user's
     * change ({@code FakeStore.applyAs(by, user, change)}) can.
     */
    LAYER_LOCKED
  }

  /**
   * One problem.
   *
   * @param path a JSON Pointer into the change request
   * @param problem what is wrong
   */
  public record Detail(String path, String problem) {
    public Detail {
      Objects.requireNonNull(path, "path");
      Objects.requireNonNull(problem, "problem");
    }
  }
}
