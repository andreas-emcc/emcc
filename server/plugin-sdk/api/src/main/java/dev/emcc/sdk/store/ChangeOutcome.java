package dev.emcc.sdk.store;

import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.ChangeRejection;
import java.util.Objects;

/**
 * The answer to a {@link Store#submit}: exactly one arrives, always delivered.
 *
 * <pre>{@code
 * switch (outcome) {
 *   case ChangeOutcome.Applied a -> known.put(uid, (MapObject) a.event().state());
 *   case ChangeOutcome.Rejected r when r.rejection().code() == ChangeRejection.Code.EXTERNAL_REF_EXISTS -> lookUp(uid);
 *   case ChangeOutcome.Rejected r -> log.warn("rejected: {}", r.rejection().message());
 *   case ChangeOutcome.Unknown u -> retryWithSameId(uid);   // a create may be sent again with the same id
 * }
 * }</pre>
 */
public sealed interface ChangeOutcome permits ChangeOutcome.Applied, ChangeOutcome.Rejected, ChangeOutcome.Unknown {

  /** The object store applied the change. */
  record Applied(ChangeEvent event) implements ChangeOutcome {
    public Applied {
      Objects.requireNonNull(event, "event");
    }
  }

  /** The object store did not apply the change. */
  record Rejected(ChangeRejection rejection) implements ChangeOutcome {
    public Rejected {
      Objects.requireNonNull(rejection, "rejection");
    }
  }

  /**
   * No answer: the timeout passed, and the change may or may not have been applied. A create may
   * be sent again with the same id; if the first arrived, the store answers {@code ENTITY_EXISTS}
   * (the id is checked before the external identity). With the reason {@code "too many
   * outstanding asks"} it was refused at once and not sent.
   */
  record Unknown(String reason) implements ChangeOutcome {
    public Unknown {
      Objects.requireNonNull(reason, "reason");
    }
  }
}
