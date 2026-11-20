package dev.emcc.app;

import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

/**
 * Refuses a WebSocket handshake whose {@code Host} header is not this server (T-013 review F5):
 * protection against DNS rebinding, where a page from another site makes the browser send its
 * requests here under the other site's name. The origin check alone does not help there, because
 * the browser then sees the page and the server as the same origin.
 *
 * <p>Allowed names: {@code localhost}, {@code 127.0.0.1}, {@code [::1]}, the address the server is
 * bound to ({@code server.address}, unless it is a wildcard), and those in {@code
 * emc2.allowed-hosts} (comma-separated, e.g. the name of a later deployment). The port in the
 * header must be the port the connection came in on. Anything else gets {@code 403}.
 *
 * <p><b>Behind a reverse proxy</b> ({@code server.forward-headers-strategy=native}; Tomcat trusts the
 * forwarded headers only from the proxies in {@code server.tomcat.remoteip.internal-proxies}) the
 * name is the one the browser used, from {@code X-Forwarded-Host}, and it must be in {@code
 * emc2.allowed-hosts}; the port is not compared, because the public port (443) is not the one the
 * server listens on. The trusted proxies must be named: Tomcat's default trusts every address of
 * the private ranges, so any computer of the local network could forge the forwarded name; without
 * {@code server.tomcat.remoteip.internal-proxies} the server does not start.
 */
@Component
class HostCheckInterceptor implements HandshakeInterceptor {

  private static final Logger LOG = LoggerFactory.getLogger(HostCheckInterceptor.class);

  private final Set<String> names = new LinkedHashSet<>();
  private final boolean behindProxy;

  HostCheckInterceptor(@Value("${server.address:}") String serverAddress, @Value("${emc2.allowed-hosts:}") String allowedHosts,
      @Value("${server.forward-headers-strategy:none}") String forwardHeaders,
      @Value("${server.tomcat.remoteip.internal-proxies:}") String trustedProxies) {
    String strategy = forwardHeaders.trim().toLowerCase(Locale.ROOT);
    if (!strategy.equals("none") && !strategy.equals("native")) {
      // "framework" lets Spring take forwarded headers from every client, trusted proxy or not.
      throw new IllegalStateException("server.forward-headers-strategy must be none or native (behind a trusted proxy), not "
          + forwardHeaders + ": other strategies take forwarded headers from any client.");
    }
    this.behindProxy = strategy.equals("native");
    if (behindProxy && trustedProxies.isBlank()) {
      throw new IllegalStateException("server.forward-headers-strategy=native trusts forwarded headers from the proxies in "
          + "server.tomcat.remoteip.internal-proxies, which is not set: Tomcat's default would trust every address of the "
          + "private ranges. Set it to a regular expression for the proxy's address, e.g. 10\\.0\\.0\\.5.");
    }
    names.add("localhost");
    names.add("127.0.0.1");
    names.add("[::1]");
    String bound = serverAddress.trim().toLowerCase(Locale.ROOT);
    if (!bound.isEmpty() && !bound.equals("0.0.0.0") && !bound.equals("::") && !bound.equals("[::]")) {
      names.add(bound.contains(":") && !bound.startsWith("[") ? "[" + bound + "]" : bound);
    }
    for (String name : allowedHosts.split(",")) {
      if (!name.isBlank()) {
        names.add(name.trim().toLowerCase(Locale.ROOT));
      }
    }
  }

  Set<String> names() {
    return Set.copyOf(names);
  }

  @Override
  public boolean beforeHandshake(
      ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler handler, Map<String, Object> attributes) {
    if (request instanceof ServletServerHttpRequest servlet && allowed(servlet.getServletRequest())) {
      return true;
    }
    LOG.warn("Refused a live picture handshake for Host {} (allowed: {}; see emc2.allowed-hosts)",
        request.getHeaders().getFirst(HttpHeaders.HOST), names);
    response.setStatusCode(HttpStatus.FORBIDDEN);
    return false;
  }

  /** Whether the request names this server: its {@code Host}, or behind a proxy the forwarded host. */
  boolean allowed(HttpServletRequest request) {
    if (behindProxy) {
      String name = request.getServerName().trim().toLowerCase(Locale.ROOT);
      return names.contains(name.contains(":") && !name.startsWith("[") ? "[" + name + "]" : name);
    }
    String host = request.getHeader(HttpHeaders.HOST);
    if (host == null) { // HTTP/1.0 without Host: the name the container resolved
      host = request.getServerName() + ":" + request.getServerPort();
    }
    return allowed(host, request.getLocalPort(), request.isSecure() ? 443 : 80);
  }

  boolean behindProxy() {
    return behindProxy;
  }

  /** Whether {@code host} (name and optional port) names this server on {@code localPort}. */
  boolean allowed(@Nullable String host, int localPort, int defaultPort) {
    if (host == null || host.isBlank()) {
      return false;
    }
    String value = host.trim().toLowerCase(Locale.ROOT);
    String name;
    int port;
    int colon = value.lastIndexOf(':');
    if (colon > value.lastIndexOf(']')) { // a port follows (and it is not inside an IPv6 literal)
      name = value.substring(0, colon);
      try {
        port = Integer.parseInt(value.substring(colon + 1));
      } catch (NumberFormatException e) {
        return false;
      }
    } else {
      name = value;
      port = defaultPort;
    }
    return names.contains(name) && port == localPort;
  }

  @Override
  public void afterHandshake(
      ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler handler, @Nullable Exception exception) {}
}
