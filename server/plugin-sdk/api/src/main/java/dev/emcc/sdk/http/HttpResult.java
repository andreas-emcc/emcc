package dev.emcc.sdk.http;

import dev.emcc.sdk.Bytes;
import java.util.Objects;

/**
 * The outcome of an outbound call, delivered to the worker as a message. Exactly one arrives, and
 * it is always delivered, whatever the mailbox's overflow policy.
 *
 * <pre>{@code
 * switch (fetched.result()) {
 *   case HttpResult.Response r when r.status() == 200 -> cacheAndAnswer(r.body());
 *   case HttpResult.Response r -> answer(502);
 *   case HttpResult.Failed f -> answer(502);
 *   case HttpResult.TimedOut t -> answer(504);
 * }
 * }</pre>
 */
public sealed interface HttpResult permits HttpResult.Response, HttpResult.Failed, HttpResult.TimedOut {

  /** The server answered (any status, including 4xx and 5xx). */
  record Response(int status, Headers headers, Bytes body) implements HttpResult {
    public Response {
      Objects.requireNonNull(headers, "headers");
      Objects.requireNonNull(body, "body");
      if (status < 100 || status > 999) {
        throw new IllegalArgumentException("bad status " + status);
      }
    }
  }

  /**
   * No answer: e.g. connection refused, too many concurrent calls, body too large, a redirect
   * (not followed in SDK v1).
   */
  record Failed(String reason) implements HttpResult {
    public Failed {
      Objects.requireNonNull(reason, "reason");
    }
  }

  /** No answer within the timeout. */
  record TimedOut() implements HttpResult {}
}
