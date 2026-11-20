package dev.emcc.app;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * No request is served on an access token that has expired and cannot be renewed (ADR-0022;
 * security review R2). In Spring Security's chain, before the authorization check, for requests with
 * login:
 *
 * <ul>
 *   <li>token valid: on, with no call to the IAM;
 *   <li>expired, renewed: on;
 *   <li>the IAM refuses: the login session has ended ({@link LoginRenewal}), and the request goes on
 *       as one without login: {@code 401} for the API, the login page for pages;
 *   <li>the IAM cannot be reached: {@code 503}, the session stays.
 * </ul>
 *
 * <p>Messages on a live picture socket that is open already are not requests: the shell's keep-alive
 * ends that socket when the IAM refuses. Not a bean, so that Spring Boot does not register it as a
 * servlet filter as well: {@link SecurityConfiguration} adds it to the chain.
 */
final class AccessTokenFilter extends OncePerRequestFilter {

  private final LoginRenewal renewal;

  AccessTokenFilter(LoginRenewal renewal) {
    this.renewal = renewal;
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    if (request.getUserPrincipal() instanceof OAuth2AuthenticationToken login
        && renewal.checkExpired(request, response, login).outcome() == LoginRenewal.Outcome.OUTAGE) {
      response.sendError(HttpServletResponse.SC_SERVICE_UNAVAILABLE, "the login cannot be checked: the IAM does not answer");
      return;
    }
    chain.doFilter(request, response);
  }
}
