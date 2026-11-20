package dev.emcc.sdk.connection;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.worker.Overflow;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * SDK 1.2.0: how to run a connection task (ADR-0036). Immutable; the methods return a new spec.
 *
 * <p><b>The inbox</b> holds what workers post for the task to send ({@link ConnectionRef#post}),
 * bounded, with the mailboxes' overflow policies ({@link Overflow}): {@code dropNewest()} (the
 * default), {@code dropOldest()}, or {@code coalesceByKey()} for items that implement {@code
 * Coalescing}, so that a slow protocol keeps only the latest update per key. The key is data of the
 * item, so no plugin code runs while ECore queues it (rule C4). As for mailboxes, items that do not
 * implement {@code Coalescing} (e.g. a heartbeat beside the positions of a sealed type) are never
 * coalesced.
 *
 * <pre>{@code
 * ConnectionSpec.of("tak-out", Outgoing.class)
 *     .inbox(1_000, Overflow.coalesceByKey())
 *     .restart(Restart.onFailure(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60))))
 * }</pre>
 *
 * @param name the task's name, unique within the plugin (for a child: within its parent):
 *     lowercase words separated by hyphens, at most 64 characters (e.g. the link's name)
 * @param inboxType the type of the inbox items
 * @param inboxCapacity how many items the inbox holds, 1 to 100 000 (default 1 000)
 * @param overflow what happens to an item posted to a full inbox (default {@code dropNewest()})
 * @param restart what follows when {@code run} ends (default {@link Restart#never()})
 * @param <I> the type of the inbox items
 */
public record ConnectionSpec<I extends Message>(String name, Class<I> inboxType, int inboxCapacity, Overflow<I> overflow, Restart restart) {

  /** The default inbox capacity. */
  public static final int DEFAULT_INBOX_CAPACITY = 1_000;

  private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");

  public ConnectionSpec {
    Objects.requireNonNull(name, "name");
    Objects.requireNonNull(inboxType, "inboxType");
    Objects.requireNonNull(overflow, "overflow");
    Objects.requireNonNull(restart, "restart");
    if (!NAME.matcher(name).matches() || name.length() > 64) {
      throw new IllegalArgumentException("task name must be lowercase words separated by hyphens: " + name);
    }
    if (inboxCapacity < 1 || inboxCapacity > 100_000) {
      throw new IllegalArgumentException("inbox capacity must be 1..100000: " + inboxCapacity);
    }
    // As for mailboxes: items that do not implement Coalescing are never coalesced. Only a final
    // type that cannot implement it (a record, an enum, a final class) is refused, as a mistake.
    if (overflow instanceof Overflow.CoalesceByKey<?>
        && !dev.emcc.sdk.worker.Coalescing.class.isAssignableFrom(inboxType)
        && java.lang.reflect.Modifier.isFinal(inboxType.getModifiers())) {
      throw new IllegalArgumentException("coalesceByKey needs inbox items that implement Coalescing: " + inboxType.getName());
    }
  }

  /** A spec with the defaults: an inbox of 1 000 that drops the newest item when full, and no restart. */
  public static <I extends Message> ConnectionSpec<I> of(String name, Class<I> inboxType) {
    return new ConnectionSpec<>(name, inboxType, DEFAULT_INBOX_CAPACITY, Overflow.dropNewest(), Restart.never());
  }

  public ConnectionSpec<I> inbox(int capacity, Overflow<I> policy) {
    return new ConnectionSpec<>(name, inboxType, capacity, policy, restart);
  }

  public ConnectionSpec<I> restart(Restart value) {
    return new ConnectionSpec<>(name, inboxType, inboxCapacity, overflow, value);
  }
}
