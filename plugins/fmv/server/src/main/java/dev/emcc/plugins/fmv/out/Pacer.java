package dev.emcc.plugins.fmv.out;

import dev.emcc.sdk.Bytes;
import java.util.ArrayDeque;
import java.util.Deque;
import org.jspecify.annotations.Nullable;

/**
 * The sender's pacing (brief section 10.6 point 21; spike S10's "what went wrong" 3): datagrams
 * leave no faster than {@code maxRate}, each when the one before it has had its time on the wire,
 * so that a keyframe is never one burst a receiver drops. The datagrams wait here, at most {@link
 * #SECONDS} of them at {@code maxRate}; beyond that the oldest go and are counted ({@code send
 * dropped}).
 *
 * <p>Pure timing, on a clock the caller gives in nanoseconds: the connection task polls its inbox
 * for {@link #waitNanos} (never sleeps), offers what it took, and sends what {@link #take} gives.
 */
public final class Pacer {

  /** The buffer's length at {@code maxRate}. */
  public static final double SECONDS = 2;

  /**
   * How far behind its schedule a sender may catch up: the connection task's {@code poll} waits in
   * whole milliseconds, and at 20 Mbit/s a datagram's time is half of one, so after a wait the
   * datagrams that fell due go together, at most this much of them. An idle sender gets no more.
   */
  public static final long CREDIT_NANOS = 2_000_000L;

  private final double nanosPerByte;
  private final long capacityBytes;
  private final Deque<Bytes> queue = new ArrayDeque<>();
  private long queuedBytes;
  private long next = Long.MIN_VALUE;
  private long dropped;

  /** @param maxBitsPerSecond the link's {@code maxRate}, 1 to 50 Mbit/s */
  public Pacer(double maxBitsPerSecond) {
    if (!(maxBitsPerSecond >= 1e6 && maxBitsPerSecond <= 50e6)) {
      throw new IllegalArgumentException("maxRate is 1 to 50 Mbit/s: " + maxBitsPerSecond);
    }
    nanosPerByte = 8e9 / maxBitsPerSecond;
    capacityBytes = (long) (maxBitsPerSecond / 8 * SECONDS);
  }

  /** Queues a datagram; the oldest go while the queue holds more than its capacity. */
  public void offer(Bytes datagram) {
    queue.addLast(datagram);
    queuedBytes += datagram.size();
    while (queuedBytes > capacityBytes && queue.size() > 1) {
      queuedBytes -= queue.removeFirst().size();
      dropped++;
    }
  }

  /** How long until the next datagram may go: 0 now, {@code -1} with none waiting. */
  public long waitNanos(long now) {
    if (queue.isEmpty()) {
      return -1;
    }
    return next == Long.MIN_VALUE ? 0 : Math.max(0, next - now);
  }

  /** The next datagram if it may go at {@code now}, else {@code null}; its time on the wire starts now. */
  public @Nullable Bytes take(long now) {
    if (queue.isEmpty() || (next != Long.MIN_VALUE && now < next)) {
      return null;
    }
    Bytes d = queue.removeFirst();
    queuedBytes -= d.size();
    long start = next == Long.MIN_VALUE ? now : Math.max(next, now - CREDIT_NANOS);
    next = start + (long) Math.ceil(d.size() * nanosPerByte);
    return d;
  }

  /** The datagrams dropped so far for want of room. */
  public long dropped() {
    return dropped;
  }

  /** The datagrams waiting. */
  public int waiting() {
    return queue.size();
  }
}
