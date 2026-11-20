package dev.emcc.app;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Instant;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /api/session}: the shell calls it every minute while the page is open (ADR-0022).
 *
 * <ul>
 *   <li>It keeps the HTTP session from timing out while the user only watches the live picture:
 *       WebSocket traffic does not count as activity for the HTTP session.
 *   <li>With login it renews the access token shortly before it expires ({@link LoginRenewal}):
 *       {@code 200} with the new expiry; {@code 401} when the IAM refused and the login has ended
 *       (the user's live picture is closed with {@code 4401}); {@code 503} when the IAM cannot be
 *       reached, and the next keep-alive tries again.
 * </ul>
 */
@RestController
class SessionController {

  static final String PATH = "/api/session";

  /** @param expiresAt when the access token expires; null in the no-login mode */
  record SessionInfo(String loginMode, @Nullable Instant expiresAt) {}

  private final CurrentUser currentUser;
  private final LoginRenewal renewal;

  SessionController(CurrentUser currentUser, LoginRenewal renewal) {
    this.currentUser = currentUser;
    this.renewal = renewal;
  }

  @GetMapping(PATH)
  ResponseEntity<SessionInfo> session(HttpServletRequest request, HttpServletResponse response) {
    if (currentUser.mode() == LoginMode.NONE) {
      return ResponseEntity.ok(new SessionInfo(LoginMode.NONE.value(), null));
    }
    if (!(request.getUserPrincipal() instanceof OAuth2AuthenticationToken login)) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
    }
    LoginRenewal.Result result = renewal.renew(request, response, login);
    return switch (result.outcome()) {
      case VALID -> ResponseEntity.ok(new SessionInfo(LoginMode.OIDC.value(), result.expiresAt()));
      case ENDED -> ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
      case OUTAGE -> ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
    };
  }
}
