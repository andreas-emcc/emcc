package dev.emcc.ecore.runtime;

import static org.assertj.core.api.Assertions.fail;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * Collects values that worker threads report, so tests can wait for them with a timeout instead
 * of sleeping.
 */
public final class Probe<T> {

  public static final Duration WAIT = Duration.ofSeconds(10);

  /**
   * How long a handler (or fake socket) that blocks on purpose waits for the test to release it.
   * Longer than any test, so that it never unblocks by itself when a loaded machine runs a test slowly.
   */
  public static final Duration HOLD = Duration.ofSeconds(60);

  private final LinkedBlockingQueue<T> values = new LinkedBlockingQueue<>();

  public void add(T value) {
    values.add(value);
  }

  /** The next value, waiting at most {@link #WAIT}. */
  public T next() {
    try {
      T value = values.poll(WAIT.toMillis(), TimeUnit.MILLISECONDS);
      if (value == null) {
        return fail("no value within " + WAIT);
      }
      return value;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return fail("interrupted");
    }
  }

  /** The next {@code count} values. */
  public List<T> next(int count) {
    List<T> result = new ArrayList<>();
    for (int i = 0; i < count; i++) {
      result.add(next());
    }
    return result;
  }

  /** What has arrived so far, without waiting. */
  public List<T> drain() {
    List<T> result = new ArrayList<>();
    values.drainTo(result);
    return result;
  }
}
