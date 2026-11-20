package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Proxy;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

/** The handler's own guard: a socket without a user never reaches ECore (ADR-0022). */
class LiveWebSocketHandlerTest {

  @Test
  void aSocketWithoutAUserIsClosedBeforeAnyLiveSessionOpens() {
    Map<String, Object> attributes = new HashMap<>(); // the login interceptor put no user here
    List<CloseStatus> closed = new ArrayList<>();
    WebSocketSession socket = (WebSocketSession) Proxy.newProxyInstance(getClass().getClassLoader(),
        new Class<?>[] {WebSocketSession.class}, (proxy, method, args) -> switch (method.getName()) {
          case "getAttributes" -> attributes;
          case "getId" -> "s1";
          case "close" -> {
            closed.add((CloseStatus) args[0]);
            yield null;
          }
          default -> throw new UnsupportedOperationException(method.getName());
        });
    // No ECore: the guard must return before the gateway is asked for a session.
    LiveWebSocketHandler handler = new LiveWebSocketHandler(null, new LoginSessions(), Duration.ofMinutes(2));

    handler.afterConnectionEstablished(socket);

    assertThat(closed).containsExactly(new CloseStatus(CloseStatus.POLICY_VIOLATION.getCode(), "not logged in"));
    assertThat(attributes).isEmpty();
  }
}
