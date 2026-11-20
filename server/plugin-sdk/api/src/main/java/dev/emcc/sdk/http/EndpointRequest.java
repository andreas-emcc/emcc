package dev.emcc.sdk.http;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.User;
import dev.emcc.sdk.json.JsonValue;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * An incoming request to a plugin endpoint, with the handle for its answer.
 *
 * <pre>{@code
 * int z = Integer.parseInt(request.pathParameter("z"));
 * request.response().respond(HttpReply.of(200, Headers.of("Content-Type", "image/png"), body));
 * if (!request.user().has(Permissions.OBJECTS_EDIT)) { ... }
 *
 * // SDK 1.2.0, a POST endpoint:
 * JsonValue command = request.body();   // parsed and checked by ECore; never null for POST
 * request.response().respond(HttpReply.json(202, JsonObject.of(Map.of("state", JsonString.of("running")))));
 *
 * // SDK 1.6.0, a POST endpoint that accepts("application/xml"):
 * Bytes xml = request.rawBody();       // never null for such an endpoint; body() is null
 * if (request.caller().kind() == Caller.Kind.SERVICE) { ... }   // a service endpoint's caller
 * }</pre>
 *
 * <p>Plugins do not build requests; ECore and the test kit do.
 *
 * @param path the request path relative to {@code /api/plugins/{pluginId}}, percent-decoded
 * @param pathParameters the template's placeholder values
 * @param query the query parameters, percent-decoded; a name may have several values
 * @param headers the request headers
 * @param user the logged-in user of the browser session that sent the request; in the no-login mode the local user, who has every permission (ADR-0022)
 * @param response where to send the answer
 * @param method SDK 1.2.0: the endpoint's method, {@code GET} (also for a {@code HEAD}) or {@code POST}
 * @param body SDK 1.2.0: for {@code POST}, the body as ECore parsed it, with numbers exactly as written (ADR-0007); {@code null} for {@code GET}
 * @param userTime SDK 1.4.0: the time the requesting session's user picked (ADR-0045); always {@code now} for a plugin that is not temporal
 * @param rawBody SDK 1.6.0: for a {@code POST} to an endpoint that {@link Endpoint#accepts} raw bodies, the body's bytes as sent (ECore checked its media type and size); {@code null} otherwise, and then {@code body} is the parsed JSON
 * @param caller SDK 1.6.0: who sent it: a browser session, or for a service endpoint another system ({@link Caller})
 */
public record EndpointRequest(
    String path,
    Map<String, String> pathParameters,
    Map<String, List<String>> query,
    Headers headers,
    User user,
    ResponseHandle response,
    String method,
    @Nullable JsonValue body,
    dev.emcc.sdk.UserTime userTime,
    @Nullable Bytes rawBody,
    Caller caller) {

  public EndpointRequest {
    Objects.requireNonNull(path, "path");
    pathParameters = Map.copyOf(pathParameters);
    query = query.entrySet().stream().collect(java.util.stream.Collectors.toUnmodifiableMap(Map.Entry::getKey, e -> List.copyOf(e.getValue())));
    Objects.requireNonNull(headers, "headers");
    Objects.requireNonNull(user, "user");
    Objects.requireNonNull(response, "response");
    Objects.requireNonNull(method, "method");
    Objects.requireNonNull(userTime, "userTime");
    Objects.requireNonNull(caller, "caller");
    switch (method) {
      case "GET" -> {
        if (body != null || rawBody != null) {
          throw new IllegalArgumentException("a GET request has no body");
        }
      }
      case "POST" -> {
        if (rawBody == null) {
          Objects.requireNonNull(body, "a POST request's body");
        } else if (body != null) {
          throw new IllegalArgumentException("a POST request has either a JSON body or a raw body");
        }
      }
      default -> throw new IllegalArgumentException("SDK v1 supports GET and POST endpoints only: " + method);
    }
    if (caller.kind() == Caller.Kind.SERVICE && !user.equals(Caller.SERVICE_USER)) {
      throw new IllegalArgumentException("a service call's user is Caller.SERVICE_USER in SDK 1.6.0");
    }
  }

  /** The SDK 1.4.0 constructor: a JSON body or none, from a browser session. */
  public EndpointRequest(
      String path, Map<String, String> pathParameters, Map<String, List<String>> query, Headers headers, User user, ResponseHandle response,
      String method, @Nullable JsonValue body, dev.emcc.sdk.UserTime userTime) {
    this(path, pathParameters, query, headers, user, response, method, body, userTime, null, Caller.user("unknown"));
  }

  /** The SDK 1.2.0 constructor: the user's time is {@code now}. */
  public EndpointRequest(
      String path, Map<String, String> pathParameters, Map<String, List<String>> query, Headers headers, User user, ResponseHandle response,
      String method, @Nullable JsonValue body) {
    this(path, pathParameters, query, headers, user, response, method, body, dev.emcc.sdk.UserTime.now());
  }

  /** The 1.1.0 constructor: a {@code GET} without a body. */
  public EndpointRequest(
      String path, Map<String, String> pathParameters, Map<String, List<String>> query, Headers headers, User user, ResponseHandle response) {
    this(path, pathParameters, query, headers, user, response, "GET", null);
  }

  /** A placeholder's value; fails if the template has no such placeholder. */
  public String pathParameter(String name) {
    String value = pathParameters.get(name);
    if (value == null) {
      throw new IllegalArgumentException("no path parameter {" + name + "}");
    }
    return value;
  }

  /** The first value of a query parameter, or {@code null}. */
  public @Nullable String queryParameter(String name) {
    List<String> values = query.get(name);
    return values == null || values.isEmpty() ? null : values.getFirst();
  }
}
