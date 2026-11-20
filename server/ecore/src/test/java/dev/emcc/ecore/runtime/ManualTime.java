package dev.emcc.ecore.runtime;

import java.time.Duration;
import java.util.Comparator;
import java.util.PriorityQueue;

/**
 * Clock and scheduler for tests: time moves only when the test calls {@link #advance}. Due tasks
 * then run on the test's thread, in time order. No real waiting.
 *
 * <p>Workers run on real threads, so a handler call may still be finishing when the test moves the
 * clock: the watchdog would then see a call that took as long as the jump. {@link #advanceSettled}
 * waits until the workers are idle before each due task, so the clock only moves between calls, as
 * if the workers were infinitely fast. Plain {@link #advance} is for tests that make a call hang.
 */
public final class ManualTime implements RuntimeClock, Scheduler {

  private static final class Task {
    final long due;
    final long seq;
    final Runnable action;
    volatile boolean cancelled;

    Task(long due, long seq, Runnable action) {
      this.due = due;
      this.seq = seq;
      this.action = action;
    }
  }

  private final PriorityQueue<Task> tasks =
      new PriorityQueue<>(Comparator.<Task>comparingLong(t -> t.due).thenComparingLong(t -> t.seq));
  private long now;
  private long seq;

  @Override
  public synchronized long nanoTime() {
    return now;
  }

  @Override
  public synchronized Cancellable schedule(Duration delay, Runnable action) {
    Task task = new Task(now + delay.toNanos(), seq++, action);
    tasks.add(task);
    return () -> task.cancelled = true;
  }

  /** Moves time forward by {@code by}, running every task that falls due on the way. */
  public void advance(Duration by) {
    advance(by, () -> {});
  }

  /**
   * Like {@link #advance}, but before each due task, and before the final jump, waits until every
   * one of {@code runtimes} is idle ({@link WorkerRuntime#idle()}): no call that is still finishing
   * can look hung. Calls already reported hung count as idle.
   */
  public void advanceSettled(Duration by, WorkerRuntime... runtimes) {
    advance(by, () -> awaitIdle(runtimes));
  }

  /**
   * Waits until every one of {@code runtimes} is idle. The wait ends as soon as they are; the bound
   * ({@link Probe#WAIT}) only limits a failure, when a worker never becomes idle.
   */
  public static void awaitIdle(WorkerRuntime... runtimes) {
    long deadline = System.nanoTime() + Probe.WAIT.toNanos();
    while (!java.util.Arrays.stream(runtimes).allMatch(WorkerRuntime::idle)) {
      if (System.nanoTime() - deadline > 0) {
        throw new AssertionError("the workers did not become idle within " + Probe.WAIT);
      }
      java.util.concurrent.locks.LockSupport.parkNanos(100_000);
    }
  }

  private void advance(Duration by, Runnable beforeEachStep) {
    long target;
    synchronized (this) {
      target = now + by.toNanos();
    }
    while (true) {
      beforeEachStep.run();
      Task next;
      synchronized (this) {
        next = tasks.peek();
        if (next == null || next.due > target) {
          now = target;
          return;
        }
        tasks.poll();
        now = next.due;
      }
      if (!next.cancelled) {
        next.action.run();
      }
    }
  }
}
