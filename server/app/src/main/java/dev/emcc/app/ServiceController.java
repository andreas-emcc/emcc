package dev.emcc.app;

import dev.emcc.ecore.plugin.PluginEndpoints;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.async.DeferredResult;

/**
 * SDK 1.6.0 (CR-0041 part A; ADR-0055 point 5.3): the plugins' service endpoints under {@code
 * /api/services/{pluginId}/…}, for other systems that have no browser session, e.g. an NVG client.
 * ECore routes them to the plugin's {@code Endpoint.service} endpoints only, as it routes {@link
 * PluginController}'s to the ordinary ones.
 *
 * <p>In SDK 1.6.0 they have no authentication: open in the login mode too ({@link
 * SecurityConfiguration}), with no session, and the caller is {@code Caller.SERVICE_USER}, who has no
 * permissions. The Host check applies as everywhere; so does the Origin check, which lets through a
 * system that sends no {@code Origin} and refuses a page of another site. ECore logs every call
 * once it is answered, with the caller's address ({@code getRemoteAddr}: behind a reverse proxy the
 * address the proxy forwarded, {@code server.forward-headers-strategy=native}).
 */
@RestController
@RequestMapping(ServiceController.PREFIX)
class ServiceController {

  static final String PREFIX = "/api/services";

  private final ECoreLifecycle ecore;

  ServiceController(ECoreLifecycle ecore) {
    this.ecore = ecore;
  }

  @RequestMapping(value = "/{pluginId}/**", method = {
      RequestMethod.GET, RequestMethod.HEAD, RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE})
  DeferredResult<ResponseEntity<byte[]>> service(@PathVariable("pluginId") String pluginId, HttpServletRequest request)
      throws IOException {
    DeferredResult<ResponseEntity<byte[]>> result = new DeferredResult<>(PluginController.ANSWER_TIMEOUT.toMillis());
    String path = PluginController.pathAfter(PREFIX + "/" + pluginId, request);
    if (path == null) {
      result.setResult(ResponseEntity.badRequest().body("bad path".getBytes(StandardCharsets.UTF_8)));
      return result;
    }
    PluginEndpoints.Request call = PluginEndpoints.Request.service(
        pluginId, request.getMethod(), path, PluginController.query(request), PluginController.headers(request), request.getRemoteAddr());
    try (InputStream body = request.getInputStream()) {
      ecore.core().plugins().endpoints().dispatch(call, body, reply -> result.setResult(PluginController.response(reply)));
    }
    return result;
  }
}
