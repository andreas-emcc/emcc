package dev.emcc.ecore.store;

import dev.emcc.ecore.runtime.Answer;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.ChangeRequest;
import java.time.Instant;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** The one answer to a change request (model rule 12, ADR-0018). */
public sealed interface ChangeOutcome {

  /** The request was applied; the event is also on {@link ObjectStore#CHANGES}. */
  record Applied(ChangeEvent event) implements ChangeOutcome {}

  /** The request was not applied. */
  record Rejected(ChangeRejection rejection) implements ChangeOutcome {}

  /**
   * The outcome a requester reports for the answer to its ask:
   *
   * <ul>
   *   <li>{@code Ok}: the store's own outcome;
   *   <li>{@code Failed}: the store refused, evicted or never got the request, so it was <b>not</b>
   *       applied: a rejection with {@code INTERNAL_ERROR} (the request may be retried);
   *   <li>{@code TimedOut}: {@code null}, because the outcome is unknown: the request may still be
   *       applied. Requesters report "outcome unknown" (ADR-0018).
   * </ul>
   */
  public static @Nullable ChangeOutcome of(ChangeRequest request, Answer<ChangeOutcome> answer, Instant now) {
    return switch (answer) {
      case Answer.Ok<ChangeOutcome> ok -> ok.value();
      case Answer.Failed<ChangeOutcome> failed -> new Rejected(new ChangeRejection(
          request.requestId(), request.entityType(), request.operation(), request.entityId(),
          ChangeRejection.Code.INTERNAL_ERROR, "the object store did not take the request: " + failed.reason(),
          List.of(), now));
      case Answer.TimedOut<ChangeOutcome> timedOut -> null;
    };
  }
}
