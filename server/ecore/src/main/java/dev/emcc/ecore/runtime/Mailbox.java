package dev.emcc.ecore.runtime;

import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * A worker's bounded mailbox (overview 4.2). FIFO, so messages from one sender arrive in the order
 * they were sent, except where coalescing replaces a message in place.
 *
 * <p>The lock is internal to the runtime and never held while running hooks or plugin code.
 */
final class Mailbox<M> {

  private static final Logger LOG = LoggerFactory.getLogger(Mailbox.class);

  /** A queue position. Coalescing replaces the envelope in the slot, so the position is kept. */
  private static final class Slot<M> {
    Envelope<M> envelope;

    Slot(Envelope<M> envelope) {
      this.envelope = envelope;
    }
  }

  /** Counter snapshot. */
  record Counters(int queued, long accepted, long dropped, long evicted, long coalesced) {}

  private final int capacity;
  private final Overflow overflow;
  private final ReentrantLock lock = new ReentrantLock();
  private final Condition notEmpty = lock.newCondition();
  private final Condition notFull = lock.newCondition();

  // Guarded by lock.
  private final ArrayDeque<Slot<M>> queue = new ArrayDeque<>();
  private final Map<Object, Slot<M>> byKey = new HashMap<>();
  private int normal; // queued non-system envelopes; the capacity applies to these
  private boolean closed;
  /** The worker thread handling the envelope it took last; cleared when it comes back for the next. */
  private @Nullable Thread processing;
  private long accepted;
  private long dropped;
  private long evicted;
  private long coalesced;

  Mailbox(int capacity, Overflow overflow) {
    this.capacity = capacity;
    this.overflow = overflow;
  }

  /**
   * Offers an envelope. Waits only under {@link Overflow#BLOCK_SENDER} when {@code mayBlock}, at
   * most {@code blockTimeout}.
   */
  SendOutcome offer(Envelope<M> envelope, boolean mayBlock, Duration blockTimeout) {
    Envelope<M> victim = null;
    lock.lock();
    try {
      if (closed) {
        return SendOutcome.CLOSED;
      }
      if (envelope.system()) {
        queue.addLast(new Slot<>(envelope));
        accepted++;
        notEmpty.signal();
        return SendOutcome.ACCEPTED;
      }
      Object key = overflow == Overflow.COALESCE_BY_KEY ? envelope.key() : null;
      if (key != null) {
        Slot<M> slot = byKey.get(key);
        if (slot != null) {
          victim = slot.envelope;
          slot.envelope = envelope;
          coalesced++;
          accepted++;
          return SendOutcome.ACCEPTED;
        }
      }
      if (normal >= capacity) {
        switch (overflow) {
          case DROP_NEWEST -> {
            dropped++;
            return SendOutcome.DROPPED;
          }
          case DROP_OLDEST, COALESCE_BY_KEY -> victim = evictOldest();
          case BLOCK_SENDER -> {
            SendOutcome waited = awaitRoom(mayBlock, blockTimeout);
            if (waited != SendOutcome.ACCEPTED) {
              return waited;
            }
          }
        }
      }
      Slot<M> slot = new Slot<>(envelope);
      queue.addLast(slot);
      normal++;
      accepted++;
      if (key != null) {
        byKey.put(key, slot);
      }
      notEmpty.signal();
      return SendOutcome.ACCEPTED;
    } finally {
      lock.unlock();
      if (victim != null) {
        runDropped(victim);
      }
    }
  }

  /** Waits for room under BLOCK_SENDER. Called with the lock held. ACCEPTED means "there is room". */
  private SendOutcome awaitRoom(boolean mayBlock, Duration timeout) {
    if (!mayBlock) {
      dropped++;
      return SendOutcome.DROPPED;
    }
    long nanos = timeout.toNanos();
    try {
      while (normal >= capacity && !closed) {
        if (nanos <= 0) {
          dropped++;
          return SendOutcome.DROPPED;
        }
        nanos = notFull.awaitNanos(nanos);
      }
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      dropped++;
      return SendOutcome.DROPPED;
    }
    return closed ? SendOutcome.CLOSED : SendOutcome.ACCEPTED;
  }

  /** Removes the oldest non-system envelope. Called with the lock held. */
  private @Nullable Envelope<M> evictOldest() {
    Iterator<Slot<M>> it = queue.iterator();
    while (it.hasNext()) {
      Slot<M> slot = it.next();
      if (!slot.envelope.system()) {
        it.remove();
        normal--;
        evicted++;
        forgetKey(slot);
        return slot.envelope;
      }
    }
    return null;
  }

  private void forgetKey(Slot<M> slot) {
    Object key = overflow == Overflow.COALESCE_BY_KEY ? slot.envelope.key() : null;
    if (key != null && byKey.get(key) == slot) {
      byKey.remove(key);
    }
  }

  /** Takes the next envelope, waiting for one. Returns {@code null} once the mailbox is closed. */
  @Nullable Envelope<M> take() throws InterruptedException {
    Envelope<M> envelope;
    lock.lockInterruptibly();
    try {
      if (processing == Thread.currentThread()) {
        processing = null; // back for the next one: the last call has ended
      }
      while (queue.isEmpty()) {
        if (closed) {
          return null;
        }
        notEmpty.await();
      }
      Slot<M> slot = queue.removeFirst();
      envelope = slot.envelope;
      processing = Thread.currentThread();
      if (!envelope.system()) {
        normal--;
        forgetKey(slot);
        notFull.signal();
      }
    } finally {
      lock.unlock();
    }
    try {
      envelope.taken();
    } catch (RuntimeException e) {
      LOG.warn("An on-taken hook failed", e);
    }
    return envelope;
  }

  /**
   * Takes the next envelope for a reader that is not a worker ({@link Inbox}), waiting at most
   * {@code nanos}. Returns {@code null} when the time is up or once the mailbox is closed. No
   * worker is handling it, so {@link #idle()} does not wait for it.
   */
  @Nullable Envelope<M> next(long nanos) throws InterruptedException {
    Envelope<M> envelope;
    lock.lockInterruptibly();
    try {
      long left = nanos;
      while (queue.isEmpty()) {
        if (closed || left <= 0) {
          return null;
        }
        left = notEmpty.awaitNanos(left);
      }
      Slot<M> slot = queue.removeFirst();
      envelope = slot.envelope;
      if (!envelope.system()) {
        normal--;
        forgetKey(slot);
        notFull.signal();
      }
    } finally {
      lock.unlock();
    }
    return envelope;
  }

  /**
   * True if nothing is queued and no worker thread is handling an envelope it took from here (or
   * the mailbox is closed). For tests on the manual clock, see {@link WorkerRuntime#idle()}.
   */
  boolean idle() {
    lock.lock();
    try {
      return closed || (queue.isEmpty() && processing == null);
    } finally {
      lock.unlock();
    }
  }

  /** The thread handling the last envelope was fenced (a restart): its call no longer counts here. */
  void abandonProcessing() {
    lock.lock();
    try {
      processing = null;
    } finally {
      lock.unlock();
    }
  }

  /** Closes the mailbox and discards what is queued. Returns the number of discarded envelopes. */
  int close() {
    List<Envelope<M>> discarded = new ArrayList<>();
    lock.lock();
    try {
      if (closed) {
        return 0;
      }
      closed = true;
      for (Slot<M> slot : queue) {
        discarded.add(slot.envelope);
      }
      evicted += discarded.size();
      queue.clear();
      byKey.clear();
      normal = 0;
      notEmpty.signalAll();
      notFull.signalAll();
    } finally {
      lock.unlock();
    }
    discarded.forEach(this::runDropped);
    return discarded.size();
  }

  Counters counters() {
    lock.lock();
    try {
      return new Counters(queue.size(), accepted, dropped, evicted, coalesced);
    } finally {
      lock.unlock();
    }
  }

  private void runDropped(Envelope<M> envelope) {
    try {
      envelope.dropped();
    } catch (RuntimeException e) {
      LOG.warn("An on-dropped hook failed", e);
    }
  }
}
