package dev.emcc.sdk.worker;

import dev.emcc.sdk.Message;
import java.time.Duration;
import java.util.Objects;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * How to create a worker. Immutable; the {@code with…}-style methods return a new spec.
 *
 * <pre>{@code
 * WorkerSpec.of("tiles", TileMsg.class, TileWorker::new)
 *     .mailbox(1_000, Overflow.dropOldest())
 *     .budget(Duration.ofSeconds(5))
 *     .restartable(true)
 *
 * WorkerSpec.of("render", RenderMsg.class, Renderer::new).compute(true)   // CPU-heavy work (rule C7)
 * }</pre>
 *
 * @param name the worker's name, unique within the plugin: lowercase letters, digits and hyphens
 * @param messageType the messages the worker accepts
 * @param handlerFactory creates the handler; called again for a fresh handler on restart
 * @param mailboxCapacity the mailbox size, 1 to 1 000 000 (default 1 000)
 * @param overflow what a full mailbox does (default {@link Overflow#dropNewest()})
 * @param budget the watchdog budget per handler call, 10 ms to 60 s (default 5 s)
 * @param restartable whether ECore restarts the worker with a fresh handler after it hung (default false)
 * @param compute whether the worker runs on ECore's bounded pool of platform threads for CPU-heavy
 *     work (a <b>compute worker</b>, rule C7) instead of a virtual thread (default false). It is an
 *     ordinary worker otherwise, and must not block on I/O either
 * @param <M> the worker's message type
 */
public record WorkerSpec<M extends Message>(
    String name,
    Class<M> messageType,
    Supplier<? extends Handler<M>> handlerFactory,
    int mailboxCapacity,
    Overflow<M> overflow,
    Duration budget,
    boolean restartable,
    boolean compute) {

  public static final int DEFAULT_CAPACITY = 1_000;
  public static final int MAX_CAPACITY = 1_000_000;
  public static final Duration DEFAULT_BUDGET = Duration.ofSeconds(5);
  /** The default budget of a compute worker. */
  public static final Duration DEFAULT_COMPUTE_BUDGET = Duration.ofSeconds(30);
  public static final Duration MIN_BUDGET = Duration.ofMillis(10);
  public static final Duration MAX_BUDGET = Duration.ofSeconds(60);

  private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");

  public WorkerSpec {
    Objects.requireNonNull(name, "name");
    Objects.requireNonNull(messageType, "messageType");
    Objects.requireNonNull(handlerFactory, "handlerFactory");
    Objects.requireNonNull(overflow, "overflow");
    Objects.requireNonNull(budget, "budget");
    if (!NAME.matcher(name).matches() || name.length() > 64) {
      throw new IllegalArgumentException("worker name must be lowercase words separated by hyphens: " + name);
    }
    if (mailboxCapacity < 1 || mailboxCapacity > MAX_CAPACITY) {
      throw new IllegalArgumentException("mailbox capacity must be 1.." + MAX_CAPACITY + ": " + mailboxCapacity);
    }
    if (budget.compareTo(MIN_BUDGET) < 0 || budget.compareTo(MAX_BUDGET) > 0) {
      throw new IllegalArgumentException("budget must be " + MIN_BUDGET + ".." + MAX_BUDGET + ": " + budget);
    }
  }

  /** A spec with the defaults. */
  public static <M extends Message> WorkerSpec<M> of(String name, Class<M> messageType, Supplier<? extends Handler<M>> handlerFactory) {
    return new WorkerSpec<>(name, messageType, handlerFactory, DEFAULT_CAPACITY, Overflow.dropNewest(), DEFAULT_BUDGET, false, false);
  }

  public WorkerSpec<M> mailbox(int capacity, Overflow<M> policy) {
    return new WorkerSpec<>(name, messageType, handlerFactory, capacity, policy, budget, restartable, compute);
  }

  public WorkerSpec<M> budget(Duration perCall) {
    return new WorkerSpec<>(name, messageType, handlerFactory, mailboxCapacity, overflow, perCall, restartable, compute);
  }

  public WorkerSpec<M> restartable(boolean value) {
    return new WorkerSpec<>(name, messageType, handlerFactory, mailboxCapacity, overflow, budget, value, compute);
  }

  /**
   * Makes this a compute worker (rule C7), or an ordinary one. Switching on, a budget of 5 s (the
   * default) becomes {@link #DEFAULT_COMPUTE_BUDGET}; switching off, 30 s becomes 5 s again. Any
   * other budget is kept. To give a compute worker exactly 5 s, set the budget after {@code
   * compute(true)}.
   */
  public WorkerSpec<M> compute(boolean value) {
    Duration perCall = budget;
    if (value && budget.equals(DEFAULT_BUDGET)) {
      perCall = DEFAULT_COMPUTE_BUDGET;
    } else if (!value && compute && budget.equals(DEFAULT_COMPUTE_BUDGET)) {
      perCall = DEFAULT_BUDGET;
    }
    return new WorkerSpec<>(name, messageType, handlerFactory, mailboxCapacity, overflow, perCall, restartable, value);
  }
}
