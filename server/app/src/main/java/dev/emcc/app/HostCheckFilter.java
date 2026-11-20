package dev.emcc.app;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * The {@code Host} check of {@link HostCheckInterceptor} for every request, not only the live
 * picture's handshake: against DNS rebinding, a page from another site must not read or call the
 * API (plugin list, plugin endpoints, health, the development stop) under its own name.
 *
 * <p>Every request, whatever its path, static files included: deciding by the path would have to
 * match exactly how Tomcat and Spring route it, and any difference is a way around the check (a
 * path parameter as in {@code /api;x/...}, or {@code /%61pi/...}; security review, remark 1).
 */
@Component
@Order(SecurityHeadersFilter.ORDER + 1) // after the security headers, before the Origin check
class HostCheckFilter extends OncePerRequestFilter {

  private static final Logger LOG = LoggerFactory.getLogger(HostCheckFilter.class);

  private final HostCheckInterceptor hostCheck;

  HostCheckFilter(HostCheckInterceptor hostCheck) {
    this.hostCheck = hostCheck;
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    if (!hostCheck.allowed(request)) {
      LOG.warn("Refused {} {} for Host {} (see emc2.allowed-hosts)", request.getMethod(), request.getRequestURI(),
          request.getHeader(HttpHeaders.HOST));
      response.sendError(HttpServletResponse.SC_FORBIDDEN, "unknown host");
      return;
    }
    chain.doFilter(request, response);
  }
}
