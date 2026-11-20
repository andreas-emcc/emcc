package dev.emcc.ecore.runtime;

import java.time.Duration;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** The production scheduler: one daemon platform thread that only hands work to mailboxes. */
final class SystemScheduler implements Scheduler, AutoCloseable {

  private static final Logger LOG = LoggerFactory.getLogger(SystemScheduler.class);

  private final ScheduledThreadPoolExecutor executor;

  SystemScheduler() {
    executor =
        new ScheduledThreadPoolExecutor(1, Thread.ofPlatform().name("ecore-scheduler").daemon(true).factory());
    executor.setRemoveOnCancelPolicy(true);
    executor.setExecuteExistingDelayedTasksAfterShutdownPolicy(false);
  }

  @Override
  public Cancellable schedule(Duration delay, Runnable task) {
    try {
      ScheduledFuture<?> future = executor.schedule(() -> run(task), delay.toNanos(), TimeUnit.NANOSECONDS);
      return () -> future.cancel(false);
    } catch (RejectedExecutionException e) {
      return () -> {}; // shutting down: the task would never matter
    }
  }

  private static void run(Runnable task) {
    try {
      task.run();
    } catch (RuntimeException e) {
      LOG.error("A scheduled task failed", e);
    }
  }

  @Override
  public void close() {
    executor.shutdownNow();
  }
}
