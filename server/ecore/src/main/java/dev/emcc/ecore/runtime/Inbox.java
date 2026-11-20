package dev.emcc.ecore.runtime;

import java.time.Duration;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * A bounded queue from workers to one reader that may block: a connection task's inbox (ADR-0036,
 * CR-0025 part 2). Writers never wait. When it is full, {@link Overflow#DROP_NEWEST} refuses the new
 * item, {@link Overflow#DROP_OLDEST} drops the oldest, and {@link Overflow#COALESCE_BY_KEY} lets an
 * item with the key of a waiting one take its place (the latest wins, in the older one's position),
 * otherwise drops the oldest. The key is the caller's, worked out before {@link #offer}, so no
 * plugin code runs while the inbox's lock is held (rule C4).
 *
 * <p>The same queue as a worker's mailbox, with its lock internal to the runtime and never held
 * while plugin code runs. Any thread may offer; one thread reads.
 */
public final class Inbox<M> {

  /** Counter snapshot, as for a mailbox. */
  public record Counters(int queued, long accepted, long dropped, long evicted, long coalesced) {}

  private final Mailbox<M> mailbox;
  private final int capacity;

  /**
   * @param overflow any but {@link Overflow#BLOCK_SENDER}: a writer never waits
   */
  public Inbox(int capacity, Overflow overflow) {
    if (capacity < 1) {
      throw new IllegalArgumentException("an inbox holds at least one item: " + capacity);
    }
    if (Objects.requireNonNull(overflow, "overflow") == Overflow.BLOCK_SENDER) {
      throw new IllegalArgumentException("an inbox never makes its writer wait");
    }
    this.mailbox = new Mailbox<>(capacity, overflow);
    this.capacity = capacity;
  }

  public int capacity() {
    return capacity;
  }

  /**
   * Offers {@code item}, never waiting. {@code key} counts only for {@link Overflow#COALESCE_BY_KEY};
   * {@code null} never coalesces.
   */
  public SendOutcome offer(M item, @Nullable Object key) {
    return mailbox.offer(Envelope.of(Objects.requireNonNull(item, "item"), key), false, Duration.ZERO);
  }

  /** The next item, waiting for one; {@code null} once the inbox is closed. */
  public @Nullable M take() throws InterruptedException {
    return poll(Long.MAX_VALUE);
  }

  /** The next item, waiting at most {@code timeout}; {@code null} when the time is up or the inbox is closed. */
  public @Nullable M poll(Duration timeout) throws InterruptedException {
    return poll(Objects.requireNonNull(timeout, "timeout").isNegative() ? 0 : saturatedNanos(timeout));
  }

  private @Nullable M poll(long nanos) throws InterruptedException {
    Envelope<M> envelope = mailbox.next(nanos);
    return envelope == null ? null : envelope.resolve();
  }

  private static long saturatedNanos(Duration timeout) {
    try {
      return timeout.toNanos();
    } catch (ArithmeticException e) {
      return Long.MAX_VALUE;
    }
  }

  /** Closes it: what is queued is discarded, offers answer {@link SendOutcome#CLOSED}, a waiting reader gets {@code null}. */
  public void close() {
    mailbox.close();
  }

  public Counters counters() {
    Mailbox.Counters c = mailbox.counters();
    return new Counters(c.queued(), c.accepted(), c.dropped(), c.evicted(), c.coalesced());
  }
}
