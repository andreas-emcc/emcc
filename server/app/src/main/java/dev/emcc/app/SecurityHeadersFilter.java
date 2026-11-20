package dev.emcc.app;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Headers on every response (overview 4.5, ADR-0030).
 *
 * <p>The <b>Content-Security-Policy</b> lets the web client and its plugins load and contact only
 * the emc2 server ({@code 'self'}), so no web part can reach another host, even by mistake. It
 * allows {@code data:} and {@code blob:} images and workers (symbols drawn to images, map tiles
 * in workers), {@code blob:} media (live video from a MediaSource the page builds, CR-0046) and
 * inline style attributes; none of these reaches another host. Scripts come only
 * from the server's own files, plus the shell's inline import map, named by its hash ({@link
 * InlineScriptHashes}).
 *
 * <p>API answers are never cached ({@code no-store}); the web client's files are cached as {@link
 * WebClientConfiguration} decides.
 */
@Component
@Order(SecurityHeadersFilter.ORDER) // first: refusals by the filters after it carry the headers too
class SecurityHeadersFilter extends OncePerRequestFilter {

  /**
   * The order of the edge's own filters: this one, then {@link HostCheckFilter}, then {@link
   * OriginCheckFilter}, all before Spring Security's chain (-100), so that a login, a logout or a
   * login callback under a foreign Host or from another site's page is refused first.
   */
  static final int ORDER = -150;

  /** The policy, with {@code %s} for the extra sources of {@code script-src}. */
  private static final String CONTENT_SECURITY_POLICY = String.join("; ",
      "default-src 'self'",
      "script-src 'self'%s",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "media-src 'self' blob:", // CR-0046: live video, a MediaSource the page builds (mpegts.js)
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'");

  private final InlineScriptHashes inlineScripts;

  SecurityHeadersFilter(InlineScriptHashes inlineScripts) {
    this.inlineScripts = inlineScripts;
  }

  /** The policy with these extra {@code script-src} sources. */
  static String policy(List<String> scriptSources) {
    return CONTENT_SECURITY_POLICY.formatted(scriptSources.stream().map(s -> " " + s).collect(Collectors.joining()));
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    response.setHeader("Content-Security-Policy", policy(inlineScripts.sources()));
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    if (request.getRequestURI().startsWith(request.getContextPath() + "/api/")) {
      response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
    }
    chain.doFilter(request, response);
  }
}
