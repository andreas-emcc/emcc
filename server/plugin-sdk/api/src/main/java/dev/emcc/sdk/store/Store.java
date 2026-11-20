package dev.emcc.sdk.store;

import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Duration;
import java.util.function.Function;

/**
 * The object store, for a plugin's server part. Every call returns at once; exactly one answer
 * (or, for a subscription, a stream of updates) arrives later in {@code target}'s mailbox,
 * converted by {@code toMessage} (plugin code: pure, non-blocking, run in that worker). Answers
 * and updates are always delivered, whatever the overflow policy, and never coalesced.
 *
 * <p>Every {@code submit} and {@code query} counts as an <b>outstanding ask</b> under the cap of
 * CR-0005 (default 10 000 per plugin). Above it the answer comes at once: {@link
 * ChangeOutcome.Unknown} or {@link QueryResult.Failed} with the reason {@code "too many
 * outstanding asks"}.
 *
 * <pre>{@code
 * store.submit(Change.updateObject(current, content).bySystem("tak-north"), Duration.ofSeconds(10), self,
 *     outcome -> new Updated(uid, outcome));
 * }</pre>
 */
public interface Store {

  /** The most undelivered updates of one subscription before ECore replaces them with a new snapshot. */
  int MAX_PENDING_UPDATES = 1_000;

  /**
   * Sends a change request. ECore fills in {@code requestId} and {@code source.plugin}. A server
   * part's changes carry no user; plugins are trusted, so no user permission is checked.
   *
   * @param timeout 1 ms to 10 minutes; without an answer by then, {@link ChangeOutcome.Unknown}.
   *     Refused at once for the ask cap, it is {@code Unknown("too many outstanding asks")} too,
   *     although it was not sent: check the reason before sending it again.
   */
  <M extends Message> void submit(Change change, Duration timeout, WorkerRef<M> target, Function<ChangeOutcome, ? extends M> toMessage);

  /**
   * Finds the objects that match {@code query}, with all layers.
   *
   * @param timeout 1 ms to 10 minutes; without an answer by then, {@link QueryResult.TimedOut}
   */
  <M extends Message> void query(ObjectQuery query, Duration timeout, WorkerRef<M> target, Function<QueryResult, ? extends M> toMessage);

  /**
   * Subscribes to the objects that match {@code query}, and to all layers: first a {@link
   * StoreUpdate.Snapshot}, then {@link StoreUpdate.Changes} in sequence order. After a gap a new
   * snapshot arrives, which replaces everything. The query's {@code limit} does not apply: a
   * subscription holds every matching object.
   *
   * <p><b>Bound:</b> when more than {@link #MAX_PENDING_UPDATES} updates wait undelivered in the
   * subscriber's mailbox, ECore drops them and later sends one new snapshot instead, so a slow
   * worker never builds up an unbounded backlog. After {@link dev.emcc.sdk.Cancellable#cancel()},
   * updates already queued may still arrive; ignore them.
   *
   * @return what ends the subscription
   */
  <M extends Message> Cancellable subscribe(ObjectQuery query, WorkerRef<M> target, Function<StoreUpdate, ? extends M> toMessage);
}
