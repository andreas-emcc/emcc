package dev.emcc.ecore.plugin;

import dev.emcc.ecore.json.InvalidDocumentException;
import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.runtime.Cancellable;
import dev.emcc.ecore.runtime.SendOutcome;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.User;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.http.Caller;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.Endpoints;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.http.ResponseHandle;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.stream.Streams;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Plugin-scoped HTTP endpoints under {@code /api/plugins/{pluginId}/} (overview 4.5, SDK v0
 * design "Inbound HTTP endpoints"; SDK v1: the request carries the user of the browser session). The edge hands every request to {@link #dispatch}; it arrives in
 * the plugin's worker as a message, and the worker answers through the request's
 * {@link ResponseHandle}, possibly later.
 *
 * <p>ECore answers itself, in the order the SDK names ({@link Endpoints}): {@code 404} for an
 * unknown plugin or path; {@code 405} when the path has endpoints but none for the method, with
 * {@code Allow} (a {@code HEAD} is a {@code GET}); {@code 403} when the endpoint {@code requires} a
 * permission the user lacks (SDK v1; the request never reaches the plugin); for {@code POST} (SDK
 * 1.2.0, CR-0026) {@code 415}, {@code 413} and {@code 400} for a body that is not JSON, too long or
 * not valid. After delivery: {@code 503} when the worker's mailbox refuses the request or evicts it
 * later, {@code 504} when the worker does not answer within the endpoint's timeout, and {@code 500}
 * when the plugin's mapper fails. Exactly one answer reaches the edge; a later one is ignored and
 * logged.
 *
 * <p>{@link #dispatch} never waits for a plugin. For a {@code POST} it reads the body from the
 * caller's stream, at most the endpoint's {@code maxBody} plus one byte, on the caller's thread (the
 * edge's request thread, never a worker), and only once the checks before it have passed.
 *
 * <p>Logs (CR-0026, the ACA's R3): every delivered {@code POST} once it is answered, with the
 * plugin, path, user and status, never the body. A {@code POST} refused with {@code 403}, {@code
 * 415}, {@code 413} or {@code 400} at most once a minute per plugin, with the number left out since.
 *
 * <p>SDK 1.6.0 (CR-0041 part A; ADR-0055 point 5):
 * <ul>
 *   <li><b>Service endpoints</b> ({@link Endpoint#service}): the edge hands their requests in from
 *       {@code /api/services/{pluginId}/}, with a {@link Caller.Kind#SERVICE} caller and {@link
 *       Caller#SERVICE_USER}. A browser request reaches only the ordinary endpoints and a service
 *       request only the service endpoints; any other is {@code 404}. Every service call is logged
 *       once answered, whatever its method, with the caller's address; its refusals as a {@code
 *       POST}'s are.
 *   <li><b>Raw bodies</b> ({@link Endpoint#accepts}): a {@code POST} whose {@code Content-Type} is
 *       one of the endpoint's media types, with at most a {@code charset} parameter, else {@code 415};
 *       over {@code maxBody} {@code 413}. The bytes reach the worker unchanged as {@link
 *       EndpointRequest#rawBody()}.
 *   <li><b>Registration:</b> a {@code POST} may name no permission when it is a service endpoint or
 *       its handler checks the user itself ({@link Endpoint#checksUserItself()}).
 * </ul>
 */
public final class PluginEndpoints {

  /**
   * A request as the edge received it.
   *
   * @param path the path after {@code /api/plugins/{pluginId}}, starting with {@code /}, with each
   *     segment percent-decoded
   * @param query the query parameters, percent-decoded
   * @param user the logged-in user of the browser session (the local user in the no-login mode);
   *     for a service call {@link Caller#SERVICE_USER}
   * @param caller SDK 1.6.0: who sent it; a {@link Caller.Kind#SERVICE} caller reaches only service endpoints
   */
  public record Request(String pluginId, String method, String path, Map<String, List<String>> query, Headers headers, User user,
      Caller caller) {
    public Request {
      Objects.requireNonNull(pluginId, "pluginId");
      Objects.requireNonNull(method, "method");
      Objects.requireNonNull(path, "path");
      query = Map.copyOf(query);
      Objects.requireNonNull(headers, "headers");
      Objects.requireNonNull(user, "user");
      Objects.requireNonNull(caller, "caller");
      if (caller.kind() == Caller.Kind.SERVICE && !user.equals(Caller.SERVICE_USER)) {
        throw new IllegalArgumentException("a service call's user is Caller.SERVICE_USER");
      }
    }

    /** A browser session's request, its address unknown (tests). */
    public Request(String pluginId, String method, String path, Map<String, List<String>> query, Headers headers, User user) {
      this(pluginId, method, path, query, headers, user, Caller.user("unknown"));
    }

    /** A service endpoint's request from {@code address}. */
    public static Request service(String pluginId, String method, String path, Map<String, List<String>> query, Headers headers,
        String address) {
      return new Request(pluginId, method, path, query, headers, Caller.SERVICE_USER, Caller.service(address));
    }

    boolean isService() {
      return caller.kind() == Caller.Kind.SERVICE;
    }
  }

  private static final Logger LOG = LoggerFactory.getLogger(PluginEndpoints.class);
  /** How often a plugin's refused {@code POST}s are logged at most. */
  static final Duration REFUSALS_LOGGED_EVERY = Duration.ofMinutes(1);
  /** The refusal log's key for every plugin id without endpoints (a service call may name any). */
  private static final String UNKNOWN_PLUGIN = "";
  /** The longest path a log line repeats. */
  private static final int MAX_LOGGED_PATH = 200;

  /**
   * A plugin's refusal log: when it last wrote a line, and how many refusals it has left out since.
   * {@code log} tells the caller to write a line now, saying {@code reported} more since the last.
   */
  private record Refusals(long loggedAt, int leftOut, boolean log, int reported) {}

  private record Registration<M extends Message>(
      Endpoint endpoint, WorkerHandle<M> worker, Function<EndpointRequest, ? extends M> toMessage) {}

  private final WorkerRuntime runtime;
  private final ModelJson json;
  /** Where the POST lines go: ECore's log, or a test's list. */
  private final Consumer<String> postLog;
  private volatile @Nullable UserTimes userTimes;
  private final Map<String, List<Registration<?>>> byPlugin = new ConcurrentHashMap<>();
  /** Per plugin; changed only through {@link ConcurrentHashMap#compute}, so no lock of ours. */
  private final Map<String, Refusals> refusals = new ConcurrentHashMap<>();

  PluginEndpoints(WorkerRuntime runtime, ModelJson json) {
    this(runtime, json, LOG::info);
  }

  /** With the POST lines going to {@code postLog} (tests). */
  PluginEndpoints(WorkerRuntime runtime, ModelJson json, Consumer<String> postLog) {
    this.runtime = runtime;
    this.json = json;
    this.postLog = postLog;
  }

  /** SDK 1.4.0: where a request's {@code userTime()} comes from (ADR-0045); without it, {@code now}. */
  void userTimes(UserTimes times) {
    this.userTimes = Objects.requireNonNull(times, "times");
  }

  /** The {@link Endpoints} of one plugin. */
  Endpoints of(String pluginId) {
    List<Registration<?>> registrations = byPlugin.computeIfAbsent(pluginId, id -> new CopyOnWriteArrayList<>());
    return new Endpoints() {
      @Override
      public <M extends Message> void register(
          Endpoint endpoint, WorkerRef<M> worker, Function<EndpointRequest, ? extends M> toMessage) {
        Objects.requireNonNull(endpoint, "endpoint");
        Objects.requireNonNull(toMessage, "toMessage");
        if (endpoint.method().equals("POST") && endpoint.permission() == null && !endpoint.service()
            && !endpoint.userCheckedByHandler()) {
          throw new IllegalArgumentException(pluginId + "'s POST endpoint " + endpoint.path()
              + " names no permission: a POST endpoint needs one (Endpoint.requires, CR-0026), or checksUserItself()");
        }
        WorkerHandle<M> handle = PluginWorkers.handleOf(worker);
        synchronized (registrations) {
          for (Registration<?> r : registrations) {
            if (r.endpoint().method().equals(endpoint.method()) && r.endpoint().path().equals(endpoint.path())
                && r.endpoint().service() == endpoint.service()) {
              throw new IllegalArgumentException(
                  pluginId + " already has an endpoint " + endpoint.method() + " " + endpoint.path());
            }
          }
          registrations.add(new Registration<>(endpoint, handle, toMessage));
        }
      }
    };
  }

  /** Removes a plugin's endpoints (it stopped or failed). Requests in progress still get one answer. */
  void remove(String pluginId) {
    byPlugin.remove(pluginId);
    refusals.remove(pluginId);
  }

  /** As {@link #dispatch(Request, InputStream, Consumer)} without a body (a {@code GET}). */
  public void dispatch(Request request, Consumer<HttpReply> responder) {
    dispatch(request, InputStream.nullInputStream(), responder);
  }

  /**
   * Delivers a request to the plugin's worker; {@code responder} gets exactly one answer, later.
   * {@code body} is read only for a {@code POST} that passed the checks before it, and at most
   * the endpoint's {@code maxBody} plus one byte; the caller closes it.
   */
  public void dispatch(Request request, InputStream body, Consumer<HttpReply> responder) {
    if (!request.isService() && (request.path().equals("/stream") || request.path().startsWith(Streams.PATH))) {
      responder.accept(text(404, "no stream " + request.path() + " in plugin " + request.pluginId())); // SDK 1.8.0: ECore's, never a plugin's
      return;
    }
    List<Registration<?>> registrations = byPlugin.get(request.pluginId());
    if (registrations == null) {
      if (request.isService()) { // logged too (ADR-0055 point 5.3), under one key for every unknown id
        refuse(request, 404, "no plugin " + request.pluginId(), "no such plugin", responder);
      } else {
        responder.accept(text(404, "no plugin " + request.pluginId()));
      }
      return;
    }
    // HEAD is a GET without a body: the plugin answers it as a GET, the servlet container drops the body.
    String method = request.method().equals("HEAD") ? "GET" : request.method();
    TreeSet<String> allowed = new TreeSet<>();
    for (Registration<?> registration : registrations) {
      if (registration.endpoint().service() != request.isService()) {
        continue; // a browser request never reaches a service endpoint, nor a service request a browser one
      }
      Map<String, String> parameters = registration.endpoint().path().match(request.path());
      if (parameters == null) {
        continue;
      }
      if (!registration.endpoint().method().equals(method)) {
        allowed.add(registration.endpoint().method());
        continue;
      }
      String permission = registration.endpoint().permission();
      if (permission != null && !request.user().has(permission)) {
        // ADR-0022: refused by ECore, never delivered to the plugin.
        refuse(request, 403, "this needs the permission " + permission, responder);
        return;
      }
      // Logged once answered: a browser POST, and every service call (ADR-0055 point 5.3). Refusals are
      // logged as such, at most once a minute per plugin.
      Consumer<HttpReply> logged = method.equals("POST") || request.isService() ? answered(request, responder) : responder;
      if (!method.equals("POST")) {
        deliver(registration, request, method, parameters, null, null, logged);
        return;
      }
      if (registration.endpoint().takesRawBody()) {
        Bytes raw = rawBodyOf(registration.endpoint(), request, body, responder);
        if (raw != null) {
          deliver(registration, request, method, parameters, null, raw, logged);
        }
        return;
      }
      JsonValue parsed = bodyOf(registration.endpoint(), request, body, responder);
      if (parsed != null) {
        deliver(registration, request, method, parameters, parsed, null, logged);
      }
      return;
    }
    if (!allowed.isEmpty()) {
      HttpReply notAllowed = new HttpReply(405, Headers.of("Allow", String.join(", ", allowed)), dev.emcc.sdk.Bytes.empty());
      if (request.isService()) {
        refuse(request, 405, notAllowed, "the method is not allowed", responder);
      } else {
        responder.accept(notAllowed);
      }
      return;
    }
    if (request.isService()) {
      refuse(request, 404, "no endpoint " + request.path() + " in plugin " + request.pluginId(), "no such endpoint", responder);
      return;
    }
    responder.accept(text(404, "no endpoint " + request.path() + " in plugin " + request.pluginId()));
  }

  /**
   * A {@code POST}'s body as the SDK's checks allow it ({@link Endpoints}): {@code 415}, then
   * {@code 413}, then {@code 400}, each answered here, returning {@code null}. The body is parsed as
   * ECore parses model JSON (the ACA's R2): strict UTF-8 without a byte order mark, one value, no
   * duplicate names, nested at most {@link Endpoint#MAX_BODY_DEPTH} deep.
   */
  private @Nullable JsonValue bodyOf(Endpoint endpoint, Request request, InputStream body, Consumer<HttpReply> responder) {
    String type = request.headers().first("Content-Type");
    if (type == null || !isJson(type)) {
      refuse(request, 415, "the body must be application/json", responder);
      return null;
    }
    byte[] bytes = readBody(endpoint, request, body, responder);
    if (bytes == null) {
      return null;
    }
    String text;
    try {
      // Strict: a body that is not UTF-8 is refused, never repaired with replacement characters.
      text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
    } catch (CharacterCodingException e) {
      refuse(request, 400, "the body is not UTF-8", responder);
      return null;
    }
    if (text.startsWith("\uFEFF")) {
      refuse(request, 400, "the body starts with a byte order mark", responder);
      return null;
    }
    tools.jackson.databind.JsonNode node;
    try {
      node = json.parse(text, Endpoint.MAX_BODY_DEPTH);
    } catch (InvalidDocumentException e) {
      // The parser's detail may quote the body: the client gets it, the log does not.
      String detail = e.problems().isEmpty() ? "" : ": " + e.problems().getFirst().problem();
      refuse(request, 400, "the body is not valid JSON" + detail, "the body is not valid JSON", responder);
      return null;
    }
    if (node == null || node.isMissingNode()) {
      refuse(request, 400, "the body is empty", responder);
      return null;
    }
    return ModelJson.toJsonValue(node);
  }

  /**
   * SDK 1.6.0: a raw body ({@link Endpoint#accepts}): {@code 415} for another media type or a
   * parameter other than {@code charset}, then {@code 413}, each answered here, returning {@code
   * null}. The bytes are not decoded: the plugin reads them as its format says.
   */
  private @Nullable Bytes rawBodyOf(Endpoint endpoint, Request request, InputStream body, Consumer<HttpReply> responder) {
    String type = request.headers().first("Content-Type");
    if (type == null || !accepted(type, endpoint.accepts())) {
      refuse(request, 415, "the body must be " + String.join(" or ", endpoint.accepts()), responder);
      return null;
    }
    byte[] bytes = readBody(endpoint, request, body, responder);
    return bytes == null ? null : Bytes.of(bytes);
  }

  /** A media type of {@code accepts}, ignoring case, with at most one parameter, a {@code charset}. */
  static boolean accepted(String contentType, List<String> accepts) {
    String[] parts = contentType.split(";", -1);
    if (!accepts.contains(parts[0].trim().toLowerCase(Locale.ROOT)) || parts.length > 2) {
      return false;
    }
    if (parts.length == 2) {
      String parameter = parts[1].trim();
      int eq = parameter.indexOf('=');
      return eq > 0 && parameter.substring(0, eq).trim().equalsIgnoreCase("charset") && !parameter.substring(eq + 1).trim().isEmpty();
    }
    return true;
  }

  /**
   * A {@code POST}'s body, at most the endpoint's {@code maxBody}: {@code 413} by the declared
   * length without reading, or once read; {@code 400} when it cannot be read. {@code null} when
   * refused.
   */
  private byte @Nullable [] readBody(Endpoint endpoint, Request request, InputStream body, Consumer<HttpReply> responder) {
    String tooLong = "the body has more than " + endpoint.maxBody() + " bytes";
    String length = request.headers().first("Content-Length");
    if (length != null && declaredLength(length) > endpoint.maxBody()) {
      refuse(request, 413, tooLong, responder); // decided by the declared length, without reading
      return null;
    }
    byte[] bytes;
    try {
      bytes = body.readNBytes(endpoint.maxBody() + 1);
    } catch (IOException e) {
      refuse(request, 400, "the body could not be read", responder);
      return null;
    }
    if (bytes.length > endpoint.maxBody()) {
      refuse(request, 413, tooLong, responder);
      return null;
    }
    return bytes;
  }

  /**
   * {@code application/json}, with at most one parameter, a {@code charset} whose value is {@code
   * utf-8}; case is ignored, and the value may be quoted ({@link Endpoints}).
   */
  static boolean isJson(String contentType) {
    String[] parts = contentType.split(";", -1);
    if (!parts[0].trim().equalsIgnoreCase("application/json") || parts.length > 2) {
      return false;
    }
    for (int i = 1; i < parts.length; i++) {
      String parameter = parts[i].trim();
      int eq = parameter.indexOf('=');
      if (eq < 0 || !parameter.substring(0, eq).trim().equalsIgnoreCase("charset")) {
        return false;
      }
      String charset = parameter.substring(eq + 1).trim();
      if (charset.length() >= 2 && charset.startsWith("\"") && charset.endsWith("\"")) {
        charset = charset.substring(1, charset.length() - 1);
      }
      if (!charset.equalsIgnoreCase("utf-8")) {
        return false;
      }
    }
    return true;
  }

  /** A {@code Content-Length}'s value; {@code -1} if it is not a number (the container checks it). */
  private static long declaredLength(String value) {
    try {
      return Long.parseLong(value.trim());
    } catch (NumberFormatException e) {
      return -1;
    }
  }

  /** Answers a refusal; a {@code POST}'s goes to the log at most once a minute per plugin. */
  private void refuse(Request request, int status, String reason, Consumer<HttpReply> responder) {
    refuse(request, status, reason, reason, responder);
  }

  /** As above, logging {@code loggedReason} instead of the answer's {@code reason}. */
  private void refuse(Request request, int status, String reason, String loggedReason, Consumer<HttpReply> responder) {
    refuse(request, status, text(status, reason), loggedReason, responder);
  }

  /** As above, answering {@code reply}; a service call's refusal is logged as a {@code POST}'s. */
  private void refuse(Request request, int status, HttpReply reply, String loggedReason, Consumer<HttpReply> responder) {
    if (request.method().equals("POST") || request.isService()) {
      long now = runtime.nanoTime();
      long every = REFUSALS_LOGGED_EVERY.toNanos();
      // An id without endpoints counts under one key, so that unknown ids cannot grow the map.
      String key = byPlugin.containsKey(request.pluginId()) ? request.pluginId() : UNKNOWN_PLUGIN;
      Refusals r = refusals.compute(key, (id, old) -> old == null || now - old.loggedAt() >= every
          ? new Refusals(now, 0, true, old == null ? 0 : old.leftOut())
          : new Refusals(old.loggedAt(), old.leftOut() + 1, false, 0));
      if (r.log()) {
        postLog.accept("Plugin " + logged(request.pluginId()) + ": refused " + kindOf(request) + logged(request.path()) + " by " + userOf(request)
            + " with " + status + ": " + loggedReason
            + (r.reported() == 0 ? "" : " (" + r.reported() + " more refused since the last such line)"));
      }
    }
    responder.accept(reply);
  }

  /** The responder of a delivered {@code POST}: logs its answer, whoever gives it (the ACA's R3). */
  private Consumer<HttpReply> answered(Request request, Consumer<HttpReply> responder) {
    return reply -> {
      postLog.accept("Plugin " + logged(request.pluginId()) + ": " + kindOf(request) + logged(request.path()) + " by " + userOf(request)
          + " answered " + reply.status());
      responder.accept(reply);
    };
  }

  /** {@code POST }, or for a service call {@code service GET } and the like. */
  private static String kindOf(Request request) {
    return request.isService() ? "service " + logged(request.method()) + " " : "POST ";
  }

  private static String userOf(Request request) {
    if (request.isService()) {
      return "a service caller at " + logged(request.caller().address());
    }
    return request.user().noLogin() ? "the local user (no login)" : "user " + logged(request.user().id());
  }

  /**
   * A path or user id as a log line repeats it: control characters and the line and paragraph
   * separators escaped, so it cannot start a line of its own; at most {@value #MAX_LOGGED_PATH}
   * characters.
   */
  static String logged(String text) {
    StringBuilder out = new StringBuilder();
    int i = 0;
    for (; i < text.length() && out.length() < MAX_LOGGED_PATH; i++) {
      char c = text.charAt(i);
      boolean breaks = Character.isISOControl(c) || c == ' ' || c == ' ';
      out.append(breaks ? String.format("\\u%04x", (int) c) : String.valueOf(c));
    }
    return i < text.length() ? out + "…" : out.toString();
  }

  private <M extends Message> void deliver(Registration<M> registration, Request request, String method,
      Map<String, String> parameters, @Nullable JsonValue body, @Nullable Bytes rawBody, Consumer<HttpReply> responder) {
    Response response = new Response(request.pluginId(), responder);
    UserTimes times = userTimes;
    // A service call has no page, so no page time (ADR-0045): now.
    dev.emcc.sdk.UserTime time = times == null || request.isService() ? dev.emcc.sdk.UserTime.now()
        : times.timeFor(request.pluginId(), request.headers().first(UserTimes.SESSION_HEADER), request.user());
    EndpointRequest incoming = new EndpointRequest(request.path(), parameters, request.query(), request.headers(), request.user(),
        response, method, body, time, rawBody, request.caller());
    response.timeout.set(runtime.schedule(registration.endpoint().timeout(),
        () -> response.answerByEcore(504, "no answer within " + registration.endpoint().timeout().toMillis() + " ms")));
    SendOutcome outcome = runtime.deliver(registration.worker(), () -> {
      try {
        return registration.toMessage().apply(incoming); // plugin code, in the worker
      } catch (RuntimeException e) {
        response.answerByEcore(500, "the plugin could not take the request");
        throw e;
      }
    }, null, () -> response.answerByEcore(503, "the plugin's worker is busy"));
    if (outcome != SendOutcome.ACCEPTED) {
      response.answerByEcore(503, "the plugin's worker is busy");
    }
  }

  private static HttpReply text(int status, String message) {
    return HttpReply.of(status, Headers.of("Content-Type", "text/plain; charset=utf-8"), dev.emcc.sdk.Bytes.utf8(message));
  }

  /** The {@link ResponseHandle} of one request: one-shot, equal by id. */
  private static final class Response implements ResponseHandle {
    private final HandleId id = new HandleId("http-" + UUID.randomUUID());
    private final String pluginId;
    private final Consumer<HttpReply> responder;
    private final AtomicBoolean answered = new AtomicBoolean();
    final AtomicReference<@Nullable Cancellable> timeout = new AtomicReference<>();

    Response(String pluginId, Consumer<HttpReply> responder) {
      this.pluginId = pluginId;
      this.responder = responder;
    }

    @Override
    public HandleId id() {
      return id;
    }

    @Override
    public void respond(HttpReply reply) {
      Objects.requireNonNull(reply, "reply");
      if (WorkerRuntime.onFencedThread()) {
        LOG.warn("Plugin {}: dropped an HTTP answer sent from a fenced thread", pluginId);
        return;
      }
      if (!complete(reply)) {
        LOG.warn("Plugin {}: ignored a second or late answer (status {}) to request {}", pluginId, reply.status(), id.value());
      }
    }

    void answerByEcore(int status, String reason) {
      if (complete(text(status, reason))) {
        LOG.debug("Plugin {}: request {} answered {} by ECore: {}", pluginId, id.value(), status, reason);
      }
    }

    private boolean complete(HttpReply reply) {
      if (!answered.compareAndSet(false, true)) {
        return false;
      }
      Cancellable t = timeout.getAndSet(null);
      if (t != null) {
        t.cancel();
      }
      try {
        responder.accept(reply);
      } catch (RuntimeException e) {
        LOG.warn("Plugin {}: the edge could not send the answer to request {}", pluginId, id.value(), e);
      }
      return true;
    }

    @Override
    public boolean equals(@Nullable Object other) {
      return other instanceof Response r && id.equals(r.id);
    }

    @Override
    public int hashCode() {
      return id.hashCode();
    }

    @Override
    public String toString() {
      return "ResponseHandle[" + id.value() + "]";
    }
  }
}
