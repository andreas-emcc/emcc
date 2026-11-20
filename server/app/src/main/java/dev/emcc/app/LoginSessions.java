package dev.emcc.app;

import jakarta.servlet.http.HttpSession;
import jakarta.servlet.http.HttpSessionEvent;
import jakarta.servlet.http.HttpSessionListener;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

/**
 * Ends a user's live picture connections when the login session ends (ADR-0022): by logout, the
 * IAM's back-channel logout, a refused token renewal ({@link LoginRenewal}) or the HTTP
 * session's idle timeout. Each live picture socket opened from an HTTP session is listed under that
 * session's id; when the HTTP session is destroyed, its sockets are closed with {@link
 * #LOGIN_ENDED}, so that the shell asks the user to log in again instead of reconnecting.
 *
 * <p>Tomcat itself closes sockets opened under an authenticated HTTP session when that session is
 * destroyed, with 1008, which also means other things. So the edge closes them first, before it
 * invalidates the session: at logout (also the IAM's back-channel logout, which arrives as a
 * logout) and at a refused renewal ({@link #end}). The session listener is the fallback for an
 * idle timeout, which only happens when the page is gone (the shell keeps the session alive). A
 * message the session's writer is sending at that moment may make the close fail; then Tomcat's
 * close still ends the socket.
 *
 * <p>SDK 1.8.0 (CR-0044 E1, T-208): a stream viewer's endless response is listed the same way, as
 * the action that ends it ({@link #openedStream}), and ends with the login session too.
 *
 * <p>The maps are the edge's: Tomcat's session threads and the socket threads both use them.
 */
@Component
class LoginSessions implements HttpSessionListener {

  /** The close code when the login session has ended: the browser must log in again, not reconnect. */
  static final int LOGIN_ENDED = 4401;

  private static final Logger LOG = LoggerFactory.getLogger(LoginSessions.class);

  private final Map<String, Set<WebSocketSession>> sockets = new ConcurrentHashMap<>();
  private final Map<String, Set<Runnable>> streamViewers = new ConcurrentHashMap<>();

  /**
   * Lists the socket under its HTTP session. If the session has ended between the handshake and now
   * (its listener has run already, or runs any moment), the socket is closed here: listed first,
   * checked second, so the socket is never missed.
   */
  void opened(HttpSession httpSession, WebSocketSession socket) {
    String id = httpSession.getId();
    sockets.computeIfAbsent(id, k -> ConcurrentHashMap.newKeySet()).add(socket);
    try {
      httpSession.getCreationTime(); // throws once the session is invalidated
    } catch (IllegalStateException ended) {
      end(id);
    }
  }

  /**
   * Lists a stream viewer under its HTTP session, as the action that ends its response; as {@link
   * #opened}, it is ended here if the session has ended meanwhile.
   */
  void openedStream(HttpSession httpSession, Runnable end) {
    String id = httpSession.getId();
    streamViewers.computeIfAbsent(id, k -> ConcurrentHashMap.newKeySet()).add(end);
    try {
      httpSession.getCreationTime(); // throws once the session is invalidated
    } catch (IllegalStateException ended) {
      end(id);
    }
  }

  void closedStream(String httpSession, Runnable end) {
    streamViewers.computeIfPresent(httpSession, (k, set) -> {
      set.remove(end);
      return set.isEmpty() ? null : set;
    });
  }

  void closed(HttpSession httpSession, WebSocketSession socket) {
    sockets.computeIfPresent(httpSession.getId(), (k, set) -> {
      set.remove(socket);
      return set.isEmpty() ? null : set;
    });
  }

  @Override
  public void sessionDestroyed(HttpSessionEvent event) {
    end(event.getSession().getId());
  }

  /** Closes the live picture sockets of the HTTP session with {@link #LOGIN_ENDED}, and ends its stream viewers. */
  void end(String httpSession) {
    Set<Runnable> viewers = streamViewers.remove(httpSession);
    if (viewers != null) {
      LOG.info("Login session ended: ending {} stream viewer(s)", viewers.size());
      viewers.forEach(Runnable::run);
    }
    Set<WebSocketSession> ended = sockets.remove(httpSession);
    if (ended == null) {
      return;
    }
    LOG.info("Login session ended: closing {} live picture connection(s)", ended.size());
    for (WebSocketSession socket : ended) {
      try {
        socket.close(new CloseStatus(LOGIN_ENDED, "login session ended"));
      } catch (Exception e) {
        LOG.debug("Live WebSocket {}: closing at the end of the login session failed", socket.getId(), e);
      }
    }
  }
}
