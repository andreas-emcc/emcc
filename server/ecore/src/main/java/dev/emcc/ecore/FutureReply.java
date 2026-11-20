package dev.emcc.ecore;

import dev.emcc.ecore.runtime.ReplyHandle;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.jspecify.annotations.Nullable;

/**
 * A reply handle for code outside any worker (start-up and shutdown), which may wait for the answer
 * with a timeout (rule C5). Workers use {@code ask} instead.
 */
final class FutureReply<R> implements ReplyHandle<R> {

  private final String id = "ecore-" + UUID.randomUUID();
  private final CompletableFuture<R> answer = new CompletableFuture<>();

  @Override
  public String id() {
    return id;
  }

  @Override
  public void reply(R value) {
    answer.complete(value);
  }

  @Override
  public void fail(String reason) {
    answer.completeExceptionally(new IllegalStateException(reason));
  }

  /** The answer, or {@code null} if none arrived within {@code timeout} or the request failed. */
  @Nullable R await(Duration timeout) {
    try {
      return answer.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return null;
    } catch (ExecutionException | TimeoutException e) {
      return null;
    }
  }

  /** The answer if it has already arrived. */
  @Nullable R now() {
    return answer.getNow(null);
  }
}
