package dev.emcc.sdk.testkit;

import dev.emcc.sdk.http.HttpReply;
import org.jspecify.annotations.Nullable;

/**
 * A request a test sent to a plugin endpoint with {@link FakePluginContext#call}, and its answer
 * once there is one: the worker's reply, or {@code 503}, {@code 504} or {@code 404} from the
 * fake ECore.
 *
 * <pre>{@code
 * FakeHttpExchange call = ctx.call("/tiles/5/17/9.png");
 * ctx.runUntilIdle();
 * assertThat(call.reply().status()).isEqualTo(200);
 * }</pre>
 */
public final class FakeHttpExchange {

  private final String path;
  private @Nullable HttpReply reply;

  FakeHttpExchange(String path) {
    this.path = path;
  }

  public String path() {
    return path;
  }

  public boolean isAnswered() {
    return reply != null;
  }

  /** The answer; fails if there is none yet. */
  public HttpReply reply() {
    if (reply == null) {
      throw new IllegalStateException("no answer yet for " + path + " (run the context until idle or advance the clock)");
    }
    return reply;
  }

  public @Nullable HttpReply replyOrNull() {
    return reply;
  }

  /** Sets the answer if there is none yet; returns whether it was set. */
  boolean answer(HttpReply value) {
    if (reply != null) {
      return false;
    }
    reply = value;
    return true;
  }
}
