package dev.emcc.app;

import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.oidc.web.logout.OidcClientInitiatedLogoutSuccessHandler;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import tools.jackson.databind.json.JsonMapper;

/**
 * The answer to {@code POST /logout} (ADR-0022): the IAM's logout page, which also ends the IAM's
 * session (RP-initiated logout), then back to {@code /}.
 *
 * <p>The shell asks with {@code Accept: application/json} and gets {@code 200 {"redirect": url}},
 * then navigates there itself. A form post answered with a redirect to the IAM would be blocked by
 * the Content-Security-Policy's {@code form-action 'self'} (ADR-0030), and the CSP stays {@code
 * 'self'}; a top-level navigation is not restricted by it. Other callers get the redirect.
 */
final class LogoutAnswer extends OidcClientInitiatedLogoutSuccessHandler {

  private static final JsonMapper JSON = JsonMapper.builder().build();

  LogoutAnswer(ClientRegistrationRepository registrations) {
    super(registrations);
    setPostLogoutRedirectUri("{baseUrl}/");
  }

  @Override
  public void onLogoutSuccess(HttpServletRequest request, HttpServletResponse response, Authentication authentication)
      throws IOException, ServletException {
    String accept = request.getHeader("Accept");
    if (accept == null || !accept.contains(MediaType.APPLICATION_JSON_VALUE)) {
      super.onLogoutSuccess(request, response, authentication);
      return;
    }
    String target = determineTargetUrl(request, response, authentication);
    response.setStatus(HttpServletResponse.SC_OK);
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    response.setCharacterEncoding("UTF-8");
    response.getWriter().write(JSON.writeValueAsString(java.util.Map.of("redirect", target)));
  }
}
