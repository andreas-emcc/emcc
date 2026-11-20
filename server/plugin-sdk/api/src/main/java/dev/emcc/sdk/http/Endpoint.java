package dev.emcc.sdk.http;

import java.time.Duration;
import dev.emcc.sdk.Permissions;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * An endpoint to register: method, path template, answer timeout, the permission it needs and,
 * for {@code POST}, the largest body. Immutable.
 *
 * <pre>{@code
 * Endpoint.get("/tiles/{z}/{x}/{y}.png").timeout(Duration.ofSeconds(10))
 * Endpoint.get("/streams").requires(Permissions.SETTINGS_ADMIN)
 * Endpoint.post("/routes/{id}/start").requires("plugin.simulator.run").maxBody(4_096)
 * }</pre>
 *
 * <p>SDK 1.2.0 (CR-0026): a {@code POST} endpoint takes a JSON body, which ECore checks and parses
 * before the request reaches the worker ({@link Endpoints}). It must name a permission: {@link
 * Endpoints#register} refuses one without.
 *
 * <p>SDK 1.6.0 (CR-0041 part A; ADR-0055 points 3 and 5):
 * <ul>
 *   <li><b>raw bodies:</b> {@link #accepts} names the media types a {@code POST} takes instead of
 *       JSON, e.g. {@code application/xml}; the body then reaches the worker as bytes ({@link
 *       EndpointRequest#rawBody()}), up to {@link #MAX_RAW_BODY};
 *   <li><b>service endpoints:</b> {@link #service} declares one that systems call without a browser
 *       session, served at {@code /api/services/{pluginId}/...}; in 1.6.0 with no authentication, so
 *       it names no permission ({@link EndpointRequest#caller()});
 *   <li><b>a handler that checks the user itself:</b> {@link #checksUserItself()} lets a {@code POST}
 *       endpoint name no permission when one static permission cannot say who may call it, e.g. an
 *       import whose edit permission depends on the target layer's workspace (ADR-0055 point 3,
 *       ADR-0053 point 5). The handler checks {@code request.user().has(...)} before it changes
 *       anything.
 * </ul>
 *
 * <pre>{@code
 * Endpoint.post("/import").accepts("application/xml", "text/xml").maxBody(Endpoint.MAX_RAW_BODY).checksUserItself()
 * Endpoint.service("POST", "/nvg/{link}").accepts("text/xml", "application/soap+xml")
 * }</pre>
 *
 * <p>SDK 1.8.0 (CR-0044 E1): a browser endpoint's path may not be {@code /stream} or start with
 * {@code /stream/}, where ECore serves the plugin's streams ({@link dev.emcc.sdk.stream.Streams}),
 * before the plugin's own endpoints.
 *
 * @param method {@code GET}, or from SDK 1.2.0 {@code POST}
 * @param path the path template, relative to {@code /api/plugins/{pluginId}} (a service endpoint's to {@code /api/services/{pluginId}})
 * @param timeout how long ECore waits for the worker's answer before it sends {@code 504}; 100 ms to 60 s, default 10 s
 * @param permission the permission the user needs, or {@code null} for every logged-in user; without it ECore answers {@code 403} and never delivers the request (ADR-0022)
 * @param maxBody SDK 1.2.0: the largest body ECore accepts, in bytes, 1 B to {@link #MAX_BODY}, default {@link #DEFAULT_MAX_BODY}; a larger one gets {@code 413}. Ignored for {@code GET}. From SDK 1.6.0 up to {@link #MAX_RAW_BODY} for an endpoint that {@link #accepts} raw bodies
 * @param accepts SDK 1.6.0: for {@code POST}, the media types taken as a raw body instead of JSON, lower case and without parameters (a {@code charset} parameter is allowed on the request); empty for JSON. A body of another type gets {@code 415}
 * @param service SDK 1.6.0: a service endpoint, for callers without a browser session; it names no permission (no authentication in 1.6.0)
 * @param userCheckedByHandler SDK 1.6.0 ({@link #checksUserItself()}): a {@code POST} endpoint whose handler checks the user itself, so it may name no permission
 */
public record Endpoint(
    String method,
    PathTemplate path,
    Duration timeout,
    @Nullable String permission,
    int maxBody,
    List<String> accepts,
    boolean service,
    boolean userCheckedByHandler) {

  public static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(10);

  /** SDK 1.2.0: the default {@link #maxBody}, 64 KiB. */
  public static final int DEFAULT_MAX_BODY = 64 * 1024;

  /** SDK 1.2.0: the largest {@link #maxBody}, 1 MiB. */
  public static final int MAX_BODY = 1024 * 1024;

  /**
   * SDK 1.2.0: how deep a {@code POST} body may nest arrays and objects (the owner, 2026-10-26).
   * Jackson 3.1's own default is 500, so a reader of the body sets this limit itself. A deeper body
   * gets {@code 400}.
   */
  public static final int MAX_BODY_DEPTH = 1000;

  /** SDK 1.6.0: the largest {@link #maxBody} of an endpoint that {@link #accepts} raw bodies, 16 MiB (ADR-0055 point 5.2). */
  public static final int MAX_RAW_BODY = 16 * 1024 * 1024;

  private static final Pattern MEDIA_TYPE = Pattern.compile("[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*");

  public Endpoint {
    Objects.requireNonNull(method, "method");
    Objects.requireNonNull(path, "path");
    Objects.requireNonNull(timeout, "timeout");
    Objects.requireNonNull(accepts, "accepts");
    if (!method.equals("GET") && !method.equals("POST")) {
      throw new IllegalArgumentException("SDK v1 supports GET and POST endpoints only: " + method);
    }
    if (permission != null) {
      Permissions.check(permission);
    }
    if (timeout.compareTo(Duration.ofMillis(100)) < 0 || timeout.compareTo(Duration.ofSeconds(60)) > 0) {
      throw new IllegalArgumentException("endpoint timeout must be 100 ms..60 s: " + timeout);
    }
    accepts = List.copyOf(accepts);
    if (!accepts.isEmpty() && !method.equals("POST")) {
      throw new IllegalArgumentException("only a POST endpoint accepts a raw body: " + path);
    }
    if (accepts.size() > 8 || accepts.stream().distinct().count() != accepts.size()) {
      throw new IllegalArgumentException("an endpoint accepts at most 8 different media types: " + accepts);
    }
    for (String type : accepts) {
      if (!MEDIA_TYPE.matcher(type).matches() || type.length() > 128 || type.equals("application/json")) {
        throw new IllegalArgumentException("a raw body's media type is lower case, without parameters, and not application/json: " + type);
      }
    }
    int limit = accepts.isEmpty() ? MAX_BODY : MAX_RAW_BODY;
    if (maxBody < 1 || maxBody > limit) {
      throw new IllegalArgumentException("endpoint maxBody must be 1.." + limit + " bytes: " + maxBody);
    }
    if (service && permission != null) {
      throw new IllegalArgumentException("a service endpoint has no permission in SDK 1.6.0 (no authentication): " + path);
    }
    if (userCheckedByHandler && (service || !method.equals("POST") || permission != null)) {
      throw new IllegalArgumentException("checksUserItself is for a browser POST endpoint without a permission: " + path);
    }
    String template = path.template();
    if (!service && (template.equals("/stream") || template.startsWith(dev.emcc.sdk.stream.Streams.PATH))) {
      throw new IllegalArgumentException("/stream/ is where ECore serves the plugin's streams (SDK 1.8.0): " + path);
    }
  }

  /** The 1.2.0 constructor: a JSON body, not a service endpoint. */
  public Endpoint(String method, PathTemplate path, Duration timeout, @Nullable String permission, int maxBody) {
    this(method, path, timeout, permission, maxBody, List.of(), false, false);
  }

  /** The 1.1.0 constructor: {@link #maxBody} is {@link #DEFAULT_MAX_BODY}. */
  public Endpoint(String method, PathTemplate path, Duration timeout, @Nullable String permission) {
    this(method, path, timeout, permission, DEFAULT_MAX_BODY);
  }

  public static Endpoint get(String pathTemplate) {
    return new Endpoint("GET", PathTemplate.parse(pathTemplate), DEFAULT_TIMEOUT, null);
  }

  /** SDK 1.2.0: a {@code POST} endpoint with a JSON body. Name its permission with {@link #requires}. */
  public static Endpoint post(String pathTemplate) {
    return new Endpoint("POST", PathTemplate.parse(pathTemplate), DEFAULT_TIMEOUT, null);
  }

  /**
   * SDK 1.6.0: a service endpoint (ADR-0055 point 5.3), {@code GET} or {@code POST}, served at
   * {@code /api/services/{pluginId}} + {@code pathTemplate} without a browser session. In SDK 1.6.0
   * it has no authentication: every caller that reaches the server is answered, also in the
   * no-login mode, so the plugin decides by its settings what it serves.
   */
  public static Endpoint service(String method, String pathTemplate) {
    return new Endpoint(method, PathTemplate.parse(pathTemplate), DEFAULT_TIMEOUT, null, DEFAULT_MAX_BODY, List.of(), true, false);
  }

  public Endpoint timeout(Duration value) {
    return new Endpoint(method, path, value, permission, maxBody, accepts, service, userCheckedByHandler);
  }

  /** Only users with {@code value} may call the endpoint; ECore answers {@code 403} to others. */
  public Endpoint requires(String value) {
    return new Endpoint(method, path, timeout, value, maxBody, accepts, service, userCheckedByHandler);
  }

  /** SDK 1.2.0: the largest body ECore accepts for this endpoint, 1 B to {@link #MAX_BODY} (from 1.6.0 {@link #MAX_RAW_BODY} for raw bodies). */
  public Endpoint maxBody(int bytes) {
    return new Endpoint(method, path, timeout, permission, bytes, accepts, service, userCheckedByHandler);
  }

  /** SDK 1.6.0: a {@code POST} that takes these media types as a raw body instead of JSON. Call it before a {@link #maxBody} above {@link #MAX_BODY}. */
  public Endpoint accepts(String... mediaTypes) {
    return new Endpoint(method, path, timeout, permission, maxBody,
        List.of(mediaTypes).stream().map(s -> s.toLowerCase(Locale.ROOT)).toList(), service, userCheckedByHandler);
  }

  /** SDK 1.6.0: a {@code POST} endpoint whose handler checks {@code request.user()} itself, so it names no permission. */
  public Endpoint checksUserItself() {
    return new Endpoint(method, path, timeout, permission, maxBody, accepts, service, true);
  }

  /** SDK 1.6.0: whether this {@code POST} takes a raw body. */
  public boolean takesRawBody() {
    return !accepts.isEmpty();
  }
}
