package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.http.HttpSessionEvent;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

/** The live picture's sockets end with their login session (ADR-0022), whatever the order of events. */
class LoginSessionsTest {

  private final LoginSessions sessions = new LoginSessions();

  /** A socket that records how it was closed. */
  private static WebSocketSession socket(List<CloseStatus> closed) {
    return (WebSocketSession) Proxy.newProxyInstance(LoginSessionsTest.class.getClassLoader(), new Class<?>[] {WebSocketSession.class},
        (proxy, method, args) -> switch (method.getName()) {
          case "close" -> {
            closed.add((CloseStatus) args[0]);
            yield null;
          }
          case "getId" -> "s";
          case "hashCode" -> System.identityHashCode(proxy);
          case "equals" -> proxy == args[0];
          default -> throw new UnsupportedOperationException(method.getName());
        });
  }

  @Test
  void whenTheHttpSessionTimesOutItsSocketsCloseWith4401() {
    MockHttpSession http = new MockHttpSession();
    List<CloseStatus> closed = new ArrayList<>();
    sessions.opened(http, socket(closed));
    sessions.opened(http, socket(closed));

    sessions.sessionDestroyed(new HttpSessionEvent(http));

    assertThat(closed).containsExactly(new CloseStatus(4401, "login session ended"), new CloseStatus(4401, "login session ended"));
  }

  @Test
  void aSocketOpenedJustAfterItsSessionEndedIsClosedAtOnce() {
    MockHttpSession http = new MockHttpSession();
    http.invalidate(); // ended between the handshake and the socket's registration
    List<CloseStatus> closed = new ArrayList<>();

    sessions.opened(http, socket(closed));

    assertThat(closed).containsExactly(new CloseStatus(4401, "login session ended"));
  }

  @Test
  void aSocketClosedByTheBrowserIsForgotten() {
    MockHttpSession http = new MockHttpSession();
    List<CloseStatus> closed = new ArrayList<>();
    WebSocketSession socket = socket(closed);
    sessions.opened(http, socket);
    sessions.closed(http, socket);

    sessions.sessionDestroyed(new HttpSessionEvent(http));

    assertThat(closed).isEmpty();
  }

  @Test
  void aStreamViewerEndsWithItsLoginSessionAndAClosedOneIsForgotten() {
    MockHttpSession http = new MockHttpSession();
    java.util.List<String> ended = new java.util.ArrayList<>();
    Runnable one = () -> ended.add("one");
    Runnable two = () -> ended.add("two");
    sessions.openedStream(http, one);
    sessions.openedStream(http, two);
    sessions.closedStream(http.getId(), two);

    sessions.end(http.getId());
    sessions.sessionDestroyed(new HttpSessionEvent(http));

    assertThat(ended).as("once, and only the open one").containsExactly("one");
  }

  @Test
  void aStreamViewerOpenedJustAfterItsSessionEndedEndsAtOnce() {
    MockHttpSession http = new MockHttpSession();
    http.invalidate();
    java.util.List<String> ended = new java.util.ArrayList<>();
    sessions.openedStream(http, () -> ended.add("late"));
    assertThat(ended).containsExactly("late");
  }
}
