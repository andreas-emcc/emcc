package dev.emcc.sdk.http;

import dev.emcc.sdk.Bytes;
import java.net.URI;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * An outbound HTTP request over {@code http} or {@code https}, without redirects: a {@code GET},
 * or from SDK 1.6.0 a {@code POST} with a body (CR-0041 part A; ADR-0055 point 5.1).
 *
 * <pre>{@code
 * HttpCall.get(URI.create("https://tile.openstreetmap.org/5/17/9.png")).header("User-Agent", "emc2/0.1")
 * // SDK 1.6.0: a SOAP call with a token from local configuration
 * HttpCall.post(url, "text/xml; charset=utf-8", envelope).header("SOAPAction", "\"GetNvg\"")
 *     .credential("anet").maxResponseBytes(16 * 1024 * 1024)
 * }</pre>
 *
 * @param method {@code GET}, or from SDK 1.6.0 {@code POST}
 * @param uri an absolute {@code http} or {@code https} URI, to any host: the manifest's {@code internet} field only
 *     declares the plugin's default hosts and why (from M2; CR-0013, ADR-0030); never a host taken
 *     from a browser request, a message or an object's data (owner, 2026-10-19)
 * @param headers request headers; from SDK 1.6.0 not {@code Authorization} (use {@link #credential}),
 *     {@code Content-Type} (the {@code POST}'s media type) or {@code Content-Length}
 * @param body SDK 1.6.0: a {@code POST}'s body, at most {@link #MAX_REQUEST_BODY_BYTES}; empty for a {@code GET}
 * @param mediaType SDK 1.6.0: a {@code POST}'s {@code Content-Type}, e.g. {@code text/xml; charset=utf-8};
 *     {@code null} for a {@code GET}
 * @param credential SDK 1.6.0: the name of a bearer token in local server configuration, or {@code null};
 *     ECore adds {@code Authorization: Bearer <token>} and the plugin never sees the token. A name that
 *     is not configured fails the call at once with {@link HttpResult.Failed} {@code "no credential <name>"}
 * @param maxResponseBytes SDK 1.6.0: the largest response body, 1 B to {@link #MAX_RESPONSE_BYTES};
 *     default {@link OutboundHttp#MAX_BODY_BYTES}. A larger response fails the call
 */
public record HttpCall(
    String method,
    URI uri,
    Headers headers,
    Bytes body,
    @Nullable String mediaType,
    @Nullable String credential,
    int maxResponseBytes) {

  /** SDK 1.6.0: the largest {@code POST} body, 1 MiB. */
  public static final int MAX_REQUEST_BODY_BYTES = 1024 * 1024;

  /** SDK 1.6.0: the largest {@link #maxResponseBytes}, 16 MiB, so that an NVG document of a file's size fits. */
  public static final int MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

  private static final Pattern CREDENTIAL = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,63}");

  private static final Pattern MEDIA_TYPE = Pattern.compile("[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*(\\s*;\\s*[A-Za-z0-9!#$&^_.+-]+=(\"[^\"\\r\\n]*\"|[A-Za-z0-9!#$&^_.+-]+))*");

  /** Headers ECore sets itself, which a call may not set (case-insensitive). */
  private static final Set<String> RESERVED = Set.of("authorization", "content-type", "content-length", "host", "transfer-encoding");

  public HttpCall {
    Objects.requireNonNull(method, "method");
    Objects.requireNonNull(uri, "uri");
    Objects.requireNonNull(headers, "headers");
    Objects.requireNonNull(body, "body");
    switch (method) {
      case "GET" -> {
        if (body.size() > 0 || mediaType != null) {
          throw new IllegalArgumentException("a GET has no body and no media type");
        }
      }
      case "POST" -> {
        if (mediaType == null || !MEDIA_TYPE.matcher(mediaType).matches() || mediaType.length() > 256) {
          throw new IllegalArgumentException("a POST needs a media type such as text/xml; charset=utf-8: " + mediaType);
        }
        if (body.size() > MAX_REQUEST_BODY_BYTES) {
          throw new IllegalArgumentException("a POST body is at most " + MAX_REQUEST_BODY_BYTES + " bytes: " + body.size());
        }
      }
      default -> throw new IllegalArgumentException("SDK 1.6.0 supports GET and POST only: " + method);
    }
    String scheme = uri.getScheme();
    if (scheme == null || !(scheme.equals("http") || scheme.equals("https")) || uri.getHost() == null) {
      throw new IllegalArgumentException("need an absolute http or https URI: " + uri);
    }
    if (credential != null && !CREDENTIAL.matcher(credential).matches()) {
      throw new IllegalArgumentException("a credential's name is 1 to 64 letters, digits, '.', '_' or '-': " + credential);
    }
    if (maxResponseBytes < 1 || maxResponseBytes > MAX_RESPONSE_BYTES) {
      throw new IllegalArgumentException("maxResponseBytes must be 1.." + MAX_RESPONSE_BYTES + ": " + maxResponseBytes);
    }
  }

  /** The SDK v1 form: a {@code GET} with these headers. */
  public HttpCall(String method, URI uri, Headers headers) {
    this(method, uri, headers, Bytes.empty(), null, null, OutboundHttp.MAX_BODY_BYTES);
  }

  public static HttpCall get(URI uri) {
    return new HttpCall("GET", uri, Headers.empty());
  }

  /**
   * SDK 1.6.0: a {@code POST} of {@code body} as {@code mediaType}, with the same limits as a {@code
   * GET} (no redirects, {@link OutboundHttp#MAX_CONCURRENT_CALLS}, the call's timeout).
   */
  public static HttpCall post(URI uri, String mediaType, Bytes body) {
    return new HttpCall("POST", uri, Headers.empty(), body, mediaType, null, OutboundHttp.MAX_BODY_BYTES);
  }

  /**
   * A copy with one more header. From SDK 1.6.0 {@code Authorization}, {@code Content-Type}, {@code
   * Content-Length}, {@code Host} and {@code Transfer-Encoding} are refused: ECore sets them.
   */
  public HttpCall header(String name, String value) {
    if (RESERVED.contains(name.toLowerCase(java.util.Locale.ROOT))) {
      throw new IllegalArgumentException("ECore sets " + name + " itself" + (name.equalsIgnoreCase("authorization") ? "; use credential(name)" : ""));
    }
    return new HttpCall(method, uri, headers.with(name, value), body, mediaType, credential, maxResponseBytes);
  }

  /** SDK 1.6.0: a copy that sends the bearer token named {@code name} from local server configuration. */
  public HttpCall credential(String name) {
    return new HttpCall(method, uri, headers, body, mediaType, Objects.requireNonNull(name, "name"), maxResponseBytes);
  }

  /** SDK 1.6.0: a copy that accepts a response body of up to {@code bytes}, at most {@link #MAX_RESPONSE_BYTES}. */
  public HttpCall maxResponseBytes(int bytes) {
    return new HttpCall(method, uri, headers, body, mediaType, credential, bytes);
  }
}
