package dev.emcc.ecore.runtime;

import java.time.Duration;
import java.util.Objects;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * How to create a worker. Immutable; the methods return a changed copy. The limits are those of
 * the Plugin SDK's {@code WorkerSpec}.
 *
 * @param name unique within the owner: lowercase words separated by hyphens
 * @param handlerFactory creates the handler; called again for a fresh handler on restart
 * @param capacity the mailbox size, 1 to {@value #MAX_CAPACITY}
 * @param overflow what a full mailbox does
 * @param budget the watchdog budget per handler call, {@link #MIN_BUDGET} to {@link #MAX_BUDGET}
 * @param restartable whether the watchdog restarts the worker with a fresh handler after it hung
 * @param sendTimeout how long a sender waits under {@link Overflow#BLOCK_SENDER}, at most 60 s
 * @param coalesceKey gives the key of a message (or of a topic payload) for {@link
 *     Overflow#COALESCE_BY_KEY}; {@code null} means "never coalesce"
 * @param contextClassLoader set as the context class loader of the worker's threads (e.g. a
 *     plugin's class loader, overview 4.2); {@code null} leaves the thread's default
 * @param compute whether its handler calls run on the runtime's bounded pool of platform threads
 *     for CPU-heavy work (a compute worker, rule C7) instead of its virtual thread
 * @param <M> the worker's message type
 */
public record WorkerOptions<M>(
    String name,
    Supplier<? extends MessageHandler<M>> handlerFactory,
    int capacity,
    Overflow overflow,
    Duration budget,
    boolean restartable,
    Duration sendTimeout,
    Function<Object, @Nullable Object> coalesceKey,
    @Nullable ClassLoader contextClassLoader,
    boolean compute) {

  public static final int DEFAULT_CAPACITY = 1_000;
  public static final int MAX_CAPACITY = 1_000_000;
  public static final Duration DEFAULT_BUDGET = Duration.ofSeconds(5);
  public static final Duration MIN_BUDGET = Duration.ofMillis(10);
  public static final Duration MAX_BUDGET = Duration.ofSeconds(60);
  public static final Duration DEFAULT_SEND_TIMEOUT = Duration.ofSeconds(1);
  public static final Duration MAX_SEND_TIMEOUT = Duration.ofSeconds(60);

  private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");

  public WorkerOptions {
    Objects.requireNonNull(name, "name");
    Objects.requireNonNull(handlerFactory, "handlerFactory");
    Objects.requireNonNull(overflow, "overflow");
    Objects.requireNonNull(budget, "budget");
    Objects.requireNonNull(sendTimeout, "sendTimeout");
    Objects.requireNonNull(coalesceKey, "coalesceKey");
    if (!NAME.matcher(name).matches() || name.length() > 64) {
      throw new IllegalArgumentException("worker name must be lowercase words separated by hyphens: " + name);
    }
    if (capacity < 1 || capacity > MAX_CAPACITY) {
      throw new IllegalArgumentException("mailbox capacity must be 1.." + MAX_CAPACITY + ": " + capacity);
    }
    if (budget.compareTo(MIN_BUDGET) < 0 || budget.compareTo(MAX_BUDGET) > 0) {
      throw new IllegalArgumentException("budget must be " + MIN_BUDGET + ".." + MAX_BUDGET + ": " + budget);
    }
    if (sendTimeout.isNegative() || sendTimeout.compareTo(MAX_SEND_TIMEOUT) > 0) {
      throw new IllegalArgumentException("send timeout must be 0.." + MAX_SEND_TIMEOUT + ": " + sendTimeout);
    }
  }

  /** Options with the defaults: capacity 1 000, {@link Overflow#DROP_NEWEST}, budget 5 s, not restartable. */
  public static <M> WorkerOptions<M> of(String name, Supplier<? extends MessageHandler<M>> handlerFactory) {
    return new WorkerOptions<>(
        name, handlerFactory, DEFAULT_CAPACITY, Overflow.DROP_NEWEST, DEFAULT_BUDGET, false,
        DEFAULT_SEND_TIMEOUT, message -> null, null, false);
  }

  public WorkerOptions<M> mailbox(int newCapacity, Overflow newOverflow) {
    return new WorkerOptions<>(
        name, handlerFactory, newCapacity, newOverflow, budget, restartable, sendTimeout, coalesceKey, contextClassLoader, compute);
  }

  public WorkerOptions<M> budget(Duration perCall) {
    return new WorkerOptions<>(
        name, handlerFactory, capacity, overflow, perCall, restartable, sendTimeout, coalesceKey, contextClassLoader, compute);
  }

  public WorkerOptions<M> restartable(boolean value) {
    return new WorkerOptions<>(
        name, handlerFactory, capacity, overflow, budget, value, sendTimeout, coalesceKey, contextClassLoader, compute);
  }

  public WorkerOptions<M> sendTimeout(Duration timeout) {
    return new WorkerOptions<>(
        name, handlerFactory, capacity, overflow, budget, restartable, timeout, coalesceKey, contextClassLoader, compute);
  }

  public WorkerOptions<M> coalesceKey(Function<Object, @Nullable Object> keyFunction) {
    return new WorkerOptions<>(
        name, handlerFactory, capacity, overflow, budget, restartable, sendTimeout, keyFunction, contextClassLoader, compute);
  }

  public WorkerOptions<M> contextClassLoader(@Nullable ClassLoader loader) {
    return new WorkerOptions<>(
        name, handlerFactory, capacity, overflow, budget, restartable, sendTimeout, coalesceKey, loader, compute);
  }

  /** Makes this a compute worker (rule C7), or an ordinary one. The budget is not changed. */
  public WorkerOptions<M> compute(boolean value) {
    return new WorkerOptions<>(
        name, handlerFactory, capacity, overflow, budget, restartable, sendTimeout, coalesceKey, contextClassLoader, value);
  }
}
