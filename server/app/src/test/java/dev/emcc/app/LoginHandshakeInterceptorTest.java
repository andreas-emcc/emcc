package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.http.server.ServletServerHttpResponse;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/** Only a logged-in user opens the live picture, and the socket knows who it is (ADR-0022). */
class LoginHandshakeInterceptorTest {

  /** No OpenID Connect settings: nobody is logged in through them here. */
  static final org.springframework.beans.factory.ObjectProvider<OidcProperties> NO_OIDC =
      new org.springframework.beans.factory.support.StaticListableBeanFactory().getBeanProvider(OidcProperties.class);

  @Test
  void theNoLoginModesLocalUserGoesOnTheSocket() {
    Map<String, Object> attributes = new HashMap<>();
    MockHttpServletResponse response = new MockHttpServletResponse();

    boolean accepted = new LoginHandshakeInterceptor(new CurrentUser(LoginMode.NONE, NO_OIDC)).beforeHandshake(
        new ServletServerHttpRequest(new MockHttpServletRequest("GET", "/api/live")), new ServletServerHttpResponse(response),
        new TextWebSocketHandler(), attributes);

    assertThat(accepted).isTrue();
    assertThat(attributes.get(LoginHandshakeInterceptor.USER)).isEqualTo(User.LOCAL);
  }

  @Test
  void withoutALoggedInUserTheHandshakeGets401() throws Exception {
    Map<String, Object> attributes = new HashMap<>();
    MockHttpServletResponse servletResponse = new MockHttpServletResponse();
    ServletServerHttpResponse response = new ServletServerHttpResponse(servletResponse);

    boolean accepted = new LoginHandshakeInterceptor(new CurrentUser(LoginMode.OIDC, NO_OIDC)).beforeHandshake(
        new ServletServerHttpRequest(new MockHttpServletRequest("GET", "/api/live")), response, new TextWebSocketHandler(), attributes);
    response.flush();

    assertThat(accepted).isFalse();
    assertThat(servletResponse.getStatus()).isEqualTo(401);
    assertThat(attributes).isEmpty();
  }
}
