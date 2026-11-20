package dev.emcc.ecore.store;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.runtime.Answer;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.EntityType;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ChangeOutcomeTest {

  private static final Instant NOW = Instant.parse("2026-10-07T10:00:00.000Z");
  private final ChangeRequest request = Fixtures.delete(UUID.randomUUID(), EntityType.OBJECT, Fixtures.DRAW);

  @Test
  void theStoresOwnAnswerIsTheOutcome() {
    ChangeOutcome rejected = new ChangeOutcome.Rejected(new ChangeRejection(request.requestId(), EntityType.OBJECT,
        request.operation(), request.entityId(), ChangeRejection.Code.ENTITY_NOT_FOUND, "no object", java.util.List.of(), NOW));

    assertThat(ChangeOutcome.of(request, new Answer.Ok<>(rejected), NOW)).isSameAs(rejected);
  }

  @Test
  void aRequestTheStoreNeverTookIsAnInternalErrorThatMayBeRetried() {
    ChangeOutcome outcome = ChangeOutcome.of(request, new Answer.Failed<>("the mailbox of core-store/object-store is full"), NOW);

    assertThat(outcome).isInstanceOfSatisfying(ChangeOutcome.Rejected.class, r -> {
      assertThat(r.rejection().code()).isEqualTo(ChangeRejection.Code.INTERNAL_ERROR);
      assertThat(r.rejection().requestId()).isEqualTo(request.requestId());
      assertThat(r.rejection().message()).contains("is full");
    });
  }

  @Test
  void aTimeoutMeansTheOutcomeIsUnknown() {
    assertThat(ChangeOutcome.of(request, new Answer.TimedOut<>(), NOW)).isNull();
  }
}
