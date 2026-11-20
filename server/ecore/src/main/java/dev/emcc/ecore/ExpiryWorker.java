package dev.emcc.ecore;

import dev.emcc.ecore.persistence.ConfigStore.Behaviour;
import dev.emcc.ecore.runtime.Answer;
import dev.emcc.ecore.runtime.HandlerContext;
import dev.emcc.ecore.runtime.MessageHandler;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.store.Removal;
import dev.emcc.ecore.store.StoreMsg;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Removes expired objects (data model rule 15, {@code removeAfterExpirySeconds}; owner,
 * 2026-10-10): every {@link #INTERVAL} it asks the object store to delete the objects that are
 * due, at most {@link #MAX_PER_TICK} at a time, by the effective behaviour of their data type (the
 * configured one, else the declaring manifest's defaults). The store checks and deletes in one go,
 * each by an ordinary delete change request with its change event.
 */
final class ExpiryWorker implements MessageHandler<ExpiryWorker.Msg> {

  /** How often expired objects are looked for. */
  static final Duration INTERVAL = Duration.ofSeconds(5);
  /** The most objects removed per look; the rest wait for the next. */
  static final int MAX_PER_TICK = 1_000;

  private static final Logger LOG = LoggerFactory.getLogger(ExpiryWorker.class);
  private static final Duration ANSWER_WITHIN = Duration.ofSeconds(30);

  sealed interface Msg {}

  /** The timer's message. */
  enum Tick implements Msg { TICK }

  /** The store's answer. */
  record Done(Answer<Integer> answer) implements Msg {}

  private final WorkerHandle<StoreMsg> objectStore;
  private final Supplier<Map<String, Behaviour>> behaviours;
  private boolean asking;

  /** @param behaviours each available data type's effective behaviour */
  ExpiryWorker(WorkerHandle<StoreMsg> objectStore, Supplier<Map<String, Behaviour>> behaviours) {
    this.objectStore = objectStore;
    this.behaviours = behaviours;
  }

  /** The removals of the data types whose objects ECore removes: those with {@code removeAfterExpirySeconds}. */
  static Map<String, Removal> removals(Map<String, Behaviour> behaviours) {
    Map<String, Removal> removals = new LinkedHashMap<>();
    behaviours.forEach((type, b) -> {
      Long after = b.removeAfterExpirySeconds();
      if (after != null) {
        removals.put(type, new Removal(b.expiresAfterSeconds(), after));
      }
    });
    return removals;
  }

  @Override
  public void handle(Msg message, HandlerContext<Msg> ctx) {
    switch (message) {
      case Done done -> {
        asking = false;
        if (!(done.answer() instanceof Answer.Ok<Integer>)) {
          LOG.warn("Expired objects were not removed this time: {}", done.answer());
        }
      }
      case Tick tick -> {
        if (asking) {
          return; // the last look has not been answered yet
        }
        Map<String, Removal> removals = removals(behaviours.get());
        if (removals.isEmpty()) {
          return;
        }
        asking = true;
        ctx.<StoreMsg, Integer>ask(
            objectStore, replyTo -> new StoreMsg.RemoveExpired(removals, MAX_PER_TICK, replyTo), ANSWER_WITHIN, Done::new);
      }
    }
  }
}
