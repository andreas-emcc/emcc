package dev.emcc.app;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.util.Locale;
import java.util.Set;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Refuses state-changing requests that a page of another site sent (ADR-0022,
 * with the {@code SameSite=Lax} session cookie: against cross-site request forgery). Browsers send
 * an {@code Origin} with every POST, PUT, PATCH and DELETE; it must be this server's own origin,
 * the scheme of the request with its {@code Host} (which {@link HostCheckFilter}, ordered before
 * this filter, has checked). Behind a reverse proxy ({@code server.forward-headers-strategy=native})
 * it is the scheme, host and port the browser used, from the forwarded headers.
 *
 * <ul>
 *   <li>{@code Origin: null} (sandboxed frames, local files) is refused.
 *   <li>Without {@code Origin}, a {@code Referer} from another origin is refused.
 *   <li>Without either, the caller is no browser (a script, a test tool), so there is no forgery to
 *       prevent: let through. The development stop refuses any {@code Origin} on its own.
 * </ul>
 *
 * Reading requests ({@code GET}, {@code HEAD}, {@code OPTIONS}, {@code TRACE}) change nothing and
 * are not checked. Every other request is, whatever its path: deciding by the path would have to
 * match exactly how Tomcat and Spring route it, and any difference is a way around the check (a
 * path parameter as in {@code /api;x/...}, or {@code /%61pi/...}; security review, remark 1).
 */
@Component
@Order(SecurityHeadersFilter.ORDER + 3) // after the Host check, whose Host it relies on, and HTTPS's redirect port (M9 C2)
class OriginCheckFilter extends OncePerRequestFilter {

  private final HostCheckInterceptor hostCheck;

  OriginCheckFilter(HostCheckInterceptor hostCheck) {
    this.hostCheck = hostCheck;
  }

  private static final Logger LOG = LoggerFactory.getLogger(OriginCheckFilter.class);
  private static final Set<String> SAFE = Set.of("GET", "HEAD", "OPTIONS", "TRACE");

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    return SAFE.contains(request.getMethod());
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String own = hostCheck.behindProxy() ? forwardedOrigin(request) : ownOrigin(request);
    String origin = request.getHeader(HttpHeaders.ORIGIN);
    String referer = request.getHeader(HttpHeaders.REFERER);
    String from = origin != null ? origin : referer != null ? originOf(referer) : own;
    if (own == null || from == null || !normalize(from).equals(own)) {
      LOG.warn("Refused {} {} from origin {} (this server: {})", request.getMethod(), request.getRequestURI(),
          origin != null ? origin : "of Referer " + referer, own);
      response.sendError(HttpServletResponse.SC_FORBIDDEN, "cross-origin request");
      return;
    }
    chain.doFilter(request, response);
  }

  /** scheme://host[:port] of this request, as the browser names it; null without a Host. */
  static @Nullable String ownOrigin(HttpServletRequest request) {
    String host = request.getHeader(HttpHeaders.HOST);
    if (host == null || host.isBlank()) {
      return null;
    }
    return normalize(request.getScheme() + "://" + host.trim());
  }

  /** Behind a proxy: the scheme, host and port the browser used, as Tomcat has taken them from the forwarded headers. */
  static String forwardedOrigin(HttpServletRequest request) {
    String host = request.getServerName();
    if (host.contains(":") && !host.startsWith("[")) {
      host = "[" + host + "]";
    }
    return normalize(request.getScheme() + "://" + host + ":" + request.getServerPort());
  }

  /** The origin part of a URL, or null if it has none. */
  static @Nullable String originOf(String url) {
    try {
      URI uri = URI.create(url.trim());
      if (uri.getScheme() == null || uri.getRawAuthority() == null) {
        return null;
      }
      return uri.getScheme() + "://" + uri.getRawAuthority();
    } catch (IllegalArgumentException e) {
      return null;
    }
  }

  /** Lower case, without the scheme's default port; "null" stays "null" (never equal to an origin). */
  static String normalize(String origin) {
    String o = origin.trim().toLowerCase(Locale.ROOT);
    if (o.startsWith("http://") && o.endsWith(":80")) {
      return o.substring(0, o.length() - 3);
    }
    if (o.startsWith("https://") && o.endsWith(":443")) {
      return o.substring(0, o.length() - 4);
    }
    return o;
  }
}
