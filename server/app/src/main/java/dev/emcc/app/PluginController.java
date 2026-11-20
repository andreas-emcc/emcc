package dev.emcc.app;

import dev.emcc.ecore.plugin.PluginEndpoints;
import dev.emcc.ecore.plugin.PluginHost;
import dev.emcc.ecore.plugin.PluginManifest;
import dev.emcc.sdk.http.Caller;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.async.DeferredResult;
import org.springframework.web.util.UriUtils;
import tools.jackson.databind.JsonNode;

/**
 * The plugins over HTTP (overview 4.5): the list of plugins with their status, and the plugins' own
 * endpoints under {@code /api/plugins/{pluginId}/…}, which ECore routes into the plugin's workers.
 * The answer comes asynchronously; the request thread never waits for a plugin.
 *
 * <p>SDK 1.2.0 (CR-0026): {@code POST} endpoints with a JSON body. Every method reaches ECore, which
 * answers {@code 404}, {@code 405} with {@code Allow}, {@code 403}, {@code 415}, {@code 413} and
 * {@code 400} itself ({@link PluginEndpoints}); it reads a {@code POST}'s body from this request's
 * stream on the request thread, at most the endpoint's {@code maxBody} plus one byte. {@code
 * OriginCheckFilter} has refused a cross-site request before it gets here.
 */
@RestController
@RequestMapping("/api/plugins")
class PluginController {

  /** Longer than the longest endpoint timeout (60 s), after which ECore has answered 504 itself. */
  static final Duration ANSWER_TIMEOUT = Duration.ofSeconds(70);

  /**
   * One plugin as {@code GET /api/plugins} lists it: what the shell needs to load its web part (T-014).
   * A folder without a readable manifest has only its id, {@code active} false and its status.
   */
  record PluginView(
      String id, @Nullable String name, @Nullable String version, @Nullable String kind, boolean active,
      Status status, @Nullable Web web, @Nullable String sdkVersion, List<String> dependsOn,
      List<String> provides, List<String> requires, List<String> uses, boolean required, @Nullable JsonNode settings,
      boolean hasSettings, List<String> capabilities, boolean serverPart, @Nullable String category,
      @Nullable JsonNode symbolPalettes, @Nullable String icon, int computeThreads) {}

  record Status(String state, String detail) {}

  /**
   * The web part.
   *
   * @param url the folder the web part is served from, {@code /plugins/<id>/web/}; entry and CSS
   *     files are relative to it
   */
  record Web(String entry, List<String> css, Map<String, String> shared, String url) {}

  private final ECoreLifecycle ecore;
  private final CurrentUser currentUser;

  PluginController(ECoreLifecycle ecore, CurrentUser currentUser) {
    this.ecore = ecore;
    this.currentUser = currentUser;
  }

  /**
   * True if a plugin has settings a user can change at runtime: its settings schema names at least
   * one property. Such a plugin gets its own tab in the top bar (ADR-0026).
   */
  static boolean hasSettings(@Nullable JsonNode settingsSchema) {
    JsonNode properties = settingsSchema == null ? null : settingsSchema.get("properties");
    return properties != null && properties.isObject() && !properties.isEmpty();
  }

  /** Every plugin folder found at start: active ones in start order, then the disabled ones. */
  @GetMapping
  List<PluginView> plugins() {
    List<PluginView> views = new ArrayList<>();
    for (PluginHost.PluginInfo p : ecore.core().plugins().plugins()) {
      PluginManifest m = p.manifest();
      Status status = new Status(p.status().state().name(), p.status().detail());
      if (m == null) {
        views.add(new PluginView(p.id(), null, null, null, p.active(), status, null, null, List.of(), List.of(),
            List.of(), List.of(), false, null, false, List.of(), false, null, null, null, 0));
        continue;
      }
      PluginManifest.WebPart w = m.web();
      Web web = w == null ? null
          : new Web(w.entry(), w.css(), new TreeMap<>(w.shared()), PluginWebFiles.PREFIX + p.id() + "/web/");
      views.add(new PluginView(p.id(), m.name(), m.version(), m.kind(), p.active(), status, web, m.sdkVersion(),
          m.dependsOn(), m.provides(), m.requires(), m.uses(), m.required(), ecore.core().json().toNode(
              p.active() ? ecore.core().plugins().settings().current(p.id()) : m.settings()),
          p.active() && hasSettings(m.settingsSchema()), m.capabilityIds(), m.entryClass() != null, m.category(), // 1.6.0: T-174
          p.active() ? m.symbolPalettes() : null, // 1.6.0 (CR-0041 part G): an enabled plugin's palettes, server-only ones too
          m.icon(), // SDK 1.8.0 (CR-0043 part D): the Settings list's icon, as the category
          m.computeThreads())); // SDK 1.9.0 (ADR-0064): a declaring plugin's Settings entry sets its number
    }
    return views;
  }

  @RequestMapping(value = "/{pluginId}/**", method = {
      RequestMethod.GET, RequestMethod.HEAD, RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE})
  DeferredResult<ResponseEntity<byte[]>> endpoint(@PathVariable("pluginId") String pluginId, HttpServletRequest request)
      throws IOException {
    DeferredResult<ResponseEntity<byte[]>> result = new DeferredResult<>(ANSWER_TIMEOUT.toMillis());
    String path = pathAfter("/api/plugins/" + pluginId, request);
    if (path == null) {
      result.setResult(ResponseEntity.badRequest().body("bad path".getBytes(StandardCharsets.UTF_8)));
      return result;
    }
    User user = currentUser.of(request);
    if (user == null) {
      result.setResult(ResponseEntity.status(401).body("not logged in".getBytes(StandardCharsets.UTF_8)));
      return result;
    }
    PluginEndpoints.Request call = new PluginEndpoints.Request(
        pluginId, request.getMethod(), path, query(request), headers(request), sdkUser(user, currentUser.mode()),
        Caller.user(request.getRemoteAddr())); // SDK 1.6.0: EndpointRequest.caller()
    try (InputStream body = request.getInputStream()) {
      ecore.core().plugins().endpoints().dispatch(call, body, reply -> result.setResult(response(reply)));
    }
    return result;
  }

  /**
   * The request path after {@code prefix}, each segment percent-decoded; {@code null} if a segment
   * has a bad percent sequence or would decode to something containing a {@code /}.
   */
  static @Nullable String pathAfter(String prefix, HttpServletRequest request) {
    String raw = request.getRequestURI().substring(request.getContextPath().length());
    String rest = raw.length() > prefix.length() ? raw.substring(prefix.length()) : "/";
    StringBuilder path = new StringBuilder();
    for (String segment : rest.substring(1).split("/", -1)) {
      String decoded;
      try {
        decoded = UriUtils.decode(segment, StandardCharsets.UTF_8);
      } catch (IllegalArgumentException e) {
        return null;
      }
      if (decoded.contains("/")) {
        return null;
      }
      path.append('/').append(decoded);
    }
    return path.toString();
  }

  /**
   * The query parameters. For a form's content type the container would read them from the body
   * too, so such a request gets none: ECore refuses it ({@code 415}, or earlier) whatever its query.
   */
  static Map<String, List<String>> query(HttpServletRequest request) {
    String type = request.getContentType();
    if (!request.getMethod().equals("GET") && !request.getMethod().equals("HEAD") && type != null
        && type.trim().toLowerCase(Locale.ROOT).startsWith("application/x-www-form-urlencoded")) {
      return Map.of();
    }
    Map<String, List<String>> query = new LinkedHashMap<>();
    request.getParameterMap().forEach((name, values) -> query.put(name, List.of(values)));
    return query;
  }

  static Headers headers(HttpServletRequest request) {
    List<Headers.Header> headers = new ArrayList<>();
    for (String name : Collections.list(request.getHeaderNames())) {
      for (String value : Collections.list(request.getHeaders(name))) {
        try {
          headers.add(new Headers.Header(name, value));
        } catch (IllegalArgumentException e) {
          // not a header the SDK can carry: left out
        }
      }
    }
    return new Headers(headers);
  }

  static ResponseEntity<byte[]> response(HttpReply reply) {
    HttpHeaders headers = new HttpHeaders();
    reply.headers().entries().forEach(h -> headers.add(h.name(), h.value()));
    return ResponseEntity.status(reply.status()).headers(headers).body(reply.body().toArray());
  }

  /** The user as plugins see it (SDK v1): in the no-login mode the local user, who has every permission. */
  static dev.emcc.sdk.User sdkUser(User user, LoginMode mode) {
    return mode == LoginMode.NONE ? dev.emcc.sdk.User.noLoginUser() : dev.emcc.sdk.User.of(user.id(), user.name(), user.permissions());
  }
}
