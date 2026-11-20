package dev.emcc.sdk.http;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.json.JsonValue;
import java.util.Objects;

/**
 * The answer to an endpoint request: status, headers and body.
 *
 * <pre>{@code
 * HttpReply.of(200, Headers.of("Content-Type", "image/png"), body)
 * HttpReply.status(404)
 * HttpReply.json(202, JsonObject.of(Map.of("state", JsonString.of("running"))))
 * }</pre>
 *
 * @param status 100 to 599
 * @param headers response headers
 * @param body the body, possibly empty
 */
public record HttpReply(int status, Headers headers, Bytes body) {

  /** SDK 1.2.0: the content type of {@link #json}. */
  public static final String JSON_CONTENT_TYPE = "application/json; charset=utf-8";

  public HttpReply {
    Objects.requireNonNull(headers, "headers");
    Objects.requireNonNull(body, "body");
    if (status < 100 || status > 599) {
      throw new IllegalArgumentException("bad status " + status);
    }
  }

  public static HttpReply of(int status, Headers headers, Bytes body) {
    return new HttpReply(status, headers, body);
  }

  /** A reply with only a status, no headers and no body. */
  public static HttpReply status(int status) {
    return new HttpReply(status, Headers.empty(), Bytes.empty());
  }

  /**
   * SDK 1.2.0: a reply with {@code body} as UTF-8 JSON and {@code Content-Type} {@value
   * #JSON_CONTENT_TYPE}. Numbers are written exactly as they are held.
   */
  public static HttpReply json(int status, JsonValue body) {
    return new HttpReply(status, Headers.of("Content-Type", JSON_CONTENT_TYPE), Bytes.utf8(JsonText.write(body)));
  }
}
