package dev.emcc.app;

import jakarta.servlet.http.HttpSession;
import java.util.Map;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

/**
 * Lets only a logged-in user open the live picture (ADR-0022): the handshake's user goes into the
 * socket's attributes under {@link #USER}, where {@link LiveWebSocketHandler} takes it for the live
 * session ({@code source.user}), and the HTTP session under {@link #HTTP_SESSION}, so that the
 * connection ends with the login session ({@link LoginSessions}). Without a user the handshake gets
 * {@code 401}. With login a browser's {@code Origin} is required too ({@code 403} without): every
 * browser sends one, and the cookie alone must not open the live picture.
 */
@Component
class LoginHandshakeInterceptor implements HandshakeInterceptor {

  static final String USER = "emc2.user";
  static final String HTTP_SESSION = "emc2.http-session";

  private static final Logger LOG = LoggerFactory.getLogger(LoginHandshakeInterceptor.class);

  private final CurrentUser currentUser;

  LoginHandshakeInterceptor(CurrentUser currentUser) {
    this.currentUser = currentUser;
  }

  @Override
  public boolean beforeHandshake(
      ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler handler, Map<String, Object> attributes) {
    if (!(request instanceof ServletServerHttpRequest servlet)) {
      response.setStatusCode(HttpStatus.UNAUTHORIZED);
      return false;
    }
    User user = currentUser.of(servlet.getServletRequest());
    if (user == null) {
      LOG.debug("Refused a live picture handshake: not logged in");
      response.setStatusCode(HttpStatus.UNAUTHORIZED);
      return false;
    }
    if (currentUser.mode() == LoginMode.OIDC && request.getHeaders().getOrigin() == null) {
      LOG.warn("Refused a live picture handshake without Origin for user {}", user.id());
      response.setStatusCode(HttpStatus.FORBIDDEN);
      return false;
    }
    attributes.put(USER, user);
    HttpSession session = servlet.getServletRequest().getSession(false);
    if (session != null) {
      attributes.put(HTTP_SESSION, session);
    }
    return true;
  }

  @Override
  public void afterHandshake(
      ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler handler, @Nullable Exception exception) {}
}
