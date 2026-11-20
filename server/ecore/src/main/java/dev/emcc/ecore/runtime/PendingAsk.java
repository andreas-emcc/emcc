package dev.emcc.ecore.runtime;

import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * An outstanding ask. Whichever comes first wins: the target's answer, a delivery failure, or the
 * timeout. The winner is turned into the asker's message, in the asker's worker, and delivered as
 * a system envelope, so it is never dropped or coalesced.
 */
final class PendingAsk<R, M> implements ReplyHandle<R> {

  private static final Logger LOG = LoggerFactory.getLogger(PendingAsk.class);

  private final String id;
  private final WorkerCell<M> asker;
  private final Function<Answer<R>, ? extends M> toMessage;
  private final Runnable onComplete;
  private final AtomicBoolean done = new AtomicBoolean();
  private volatile @Nullable Cancellable timer;

  /** {@code onComplete} runs once, when the ask completes (it gives back the owner's slot, CR-0005). */
  PendingAsk(String id, WorkerCell<M> asker, Function<Answer<R>, ? extends M> toMessage, Runnable onComplete) {
    this.id = id;
    this.asker = asker;
    this.toMessage = toMessage;
    this.onComplete = onComplete;
  }

  void startTimer(Scheduler scheduler, Duration timeout) {
    Cancellable t = scheduler.schedule(timeout, () -> complete(new Answer.TimedOut<>()));
    timer = t;
    if (done.get()) {
      t.cancel(); // already answered, e.g. refused at once
    }
  }

  @Override
  public String id() {
    return id;
  }

  @Override
  public void reply(R value) {
    Objects.requireNonNull(value, "value");
    answer(new Answer.Ok<>(value));
  }

  @Override
  public void fail(String reason) {
    Objects.requireNonNull(reason, "reason");
    answer(new Answer.Failed<>(reason));
  }

  private void answer(Answer<R> answer) {
    WorkerCell.ThreadState sender = WorkerCell.current();
    if (sender != null && sender.fenced) {
      LOG.warn("Dropped an answer to {} from the fenced thread of {}", id, sender.cell.id());
      return;
    }
    if (!complete(answer)) {
      LOG.debug("Ignored a late or second answer to {}", id);
    }
  }

  /**
   * Ends the ask without an answer, because its request was never sent (the request function
   * threw). Like {@link #complete}, only the first end counts: if the request function answered
   * through its handle before it threw, that answer stands and the slot was already given back.
   */
  void abandon() {
    if (done.compareAndSet(false, true)) {
      Cancellable t = timer;
      if (t != null) {
        t.cancel();
      }
      onComplete.run();
    }
  }

  /** Completes the ask once. Returns false if it was already complete. */
  boolean complete(Answer<R> answer) {
    if (!done.compareAndSet(false, true)) {
      return false;
    }
    Cancellable t = timer;
    if (t != null) {
      t.cancel();
    }
    onComplete.run();
    asker.deliverSystem(Envelope.system(() -> toMessage.apply(answer)));
    return true;
  }

  @Override
  public String toString() {
    return "ReplyHandle[" + id + " -> " + asker.id() + "]";
  }
}
