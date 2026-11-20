package dev.emcc.sdk.compute;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.connection.Restart;
import dev.emcc.sdk.worker.Overflow;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * SDK 1.9.0 (CR-0048 point 5): how a compute task is started. Immutable; the methods return a new
 * spec.
 *
 * <pre>{@code
 * ComputeSpec.of("camera-north", Pose.class)
 *     .inbox(16, Overflow.coalesceByKey())                       // the newest pose per camera
 *     .restart(Restart.onFailure(backoff))
 * }</pre>
 *
 * @param name lowercase words separated by hyphens, at most 64 characters, unique among the
 *     plugin's running compute tasks
 * @param inboxType the type of the inbox items
 * @param inboxCapacity 1 to {@value #MAX_INBOX_CAPACITY} items, by default {@value
 *     #DEFAULT_INBOX_CAPACITY}
 * @param overflow what a full inbox does with a new item; {@code dropNewest} by default. {@code
 *     coalesceByKey} needs items that implement {@code Coalescing}
 * @param restart whether ECore restarts the task when it fails or ends, with a back-off; {@code
 *     Restart.never()} by default, as for connection tasks
 * @param <I> the type of the task's inbox items
 */
public record ComputeSpec<I extends Message>(String name, Class<I> inboxType, int inboxCapacity, Overflow<I> overflow, Restart restart) {

  /** The default inbox capacity. */
  public static final int DEFAULT_INBOX_CAPACITY = 1_000;

  /** The largest inbox capacity. */
  public static final int MAX_INBOX_CAPACITY = 100_000;

  private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");

  public ComputeSpec {
    Objects.requireNonNull(name, "name");
    Objects.requireNonNull(inboxType, "inboxType");
    Objects.requireNonNull(overflow, "overflow");
    Objects.requireNonNull(restart, "restart");
    if (!NAME.matcher(name).matches() || name.length() > 64) {
      throw new IllegalArgumentException("a compute task's name must be lowercase words separated by hyphens, at most 64 characters: " + name);
    }
    if (inboxCapacity < 1 || inboxCapacity > MAX_INBOX_CAPACITY) {
      throw new IllegalArgumentException("inbox capacity must be 1.." + MAX_INBOX_CAPACITY + ": " + inboxCapacity);
    }
    // As for connection tasks: only a final type that cannot implement Coalescing is refused, as a mistake.
    if (overflow instanceof Overflow.CoalesceByKey<?>
        && !dev.emcc.sdk.worker.Coalescing.class.isAssignableFrom(inboxType)
        && java.lang.reflect.Modifier.isFinal(inboxType.getModifiers())) {
      throw new IllegalArgumentException("coalesceByKey needs inbox items that implement Coalescing: " + inboxType.getName());
    }
  }

  /** A spec with the default inbox ({@value #DEFAULT_INBOX_CAPACITY}, {@code dropNewest}) and no restart. */
  public static <I extends Message> ComputeSpec<I> of(String name, Class<I> inboxType) {
    return new ComputeSpec<>(name, inboxType, DEFAULT_INBOX_CAPACITY, Overflow.dropNewest(), Restart.never());
  }

  /** The spec with this inbox. */
  public ComputeSpec<I> inbox(int capacity, Overflow<I> policy) {
    return new ComputeSpec<>(name, inboxType, capacity, policy, restart);
  }

  /** The spec with this restart policy. */
  public ComputeSpec<I> restart(Restart value) {
    return new ComputeSpec<>(name, inboxType, inboxCapacity, overflow, value);
  }
}
