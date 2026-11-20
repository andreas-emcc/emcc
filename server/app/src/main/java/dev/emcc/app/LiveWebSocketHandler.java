package dev.emcc.app;

import dev.emcc.ecore.live.LiveGateway;
import dev.emcc.ecore.live.LiveSink;
import dev.emcc.ecore.store.Requester;
import jakarta.servlet.http.HttpSession;
import jakarta.websocket.Session;
import java.time.Duration;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.PingMessage;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.adapter.NativeWebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * The browser's WebSocket to the live picture ({@code /api/live}, overview 4.5): translates text
 * frames to and from ECore's live picture gateway, nothing more. The protocol is in {@code
 * server/live-picture-protocol.md}.
 *
 * <p><b>A message larger than 1 MiB</b> closes the connection with {@code 1009} (owner VV A,
 * 2026-11-14). The handler takes messages in parts and checks the size itself: Tomcat, when it
 * checks, closes at once without reading the rest of the frame, and the reset of the unread bytes
 * can lose the close frame, so the browser saw {@code 1006}. Here the rest is read and thrown away
 * (at most {@link #MAX_DRAIN}), and the connection is closed after the message's last part.
 */
@Component
class LiveWebSocketHandler extends TextWebSocketHandler {

  static final String PATH = "/api/live";

  private static final Logger LOG = LoggerFactory.getLogger(LiveWebSocketHandler.class);
  private static final String SESSION = "emc2.live-session";
  private static final String PARTS = "emc2.live-parts";

  /** The largest browser message, in characters (the protocol's 1 MiB). */
  static final int MAX_MESSAGE = 1024 * 1024;

  /** The most of a too large message that is read and thrown away before the close; beyond, it closes at once. */
  static final long MAX_DRAIN = 16L * MAX_MESSAGE;

  /** Tomcat's per-session read idle timeout (milliseconds, a Long). */
  static final String READ_IDLE_TIMEOUT = "org.apache.tomcat.websocket.READ_IDLE_TIMEOUT_MS";

  private final ECoreLifecycle ecore;
  private final LoginSessions loginSessions;
  private final Duration idleTimeout;

  /**
   * @param idleTimeout a connection from which nothing (not even the answer to a ping) arrives for
   *     this long is closed (F6); the gateway pings every 30 s, so it must be longer than that
   */
  LiveWebSocketHandler(ECoreLifecycle ecore, LoginSessions loginSessions, @Value("${emc2.live.idle-timeout}") Duration idleTimeout) {
    this.ecore = ecore;
    this.loginSessions = loginSessions;
    this.idleTimeout = idleTimeout;
  }

  @Override
  public void afterConnectionEstablished(WebSocketSession socket) {
    if (socket instanceof NativeWebSocketSession nativeSocket
        && nativeSocket.getNativeSession(Session.class) instanceof Session tomcat) {
      tomcat.getUserProperties().put(READ_IDLE_TIMEOUT, idleTimeout.toMillis());
    }
    // The user of the handshake (LoginHandshakeInterceptor): source.user of every change request, and
    // the permissions they need (overview 4.4), fixed for the life of the socket.
    if (!(socket.getAttributes().get(LoginHandshakeInterceptor.USER) instanceof User user)) {
      new Sink(socket).close(CloseStatus.POLICY_VIOLATION.getCode(), "not logged in");
      return;
    }
    LiveGateway.LiveSession session;
    try {
      session = ecore.core().live().open(requester(user), sdkUser(user), new Sink(socket));
    } catch (LiveGateway.TooManySessions e) {
      new Sink(socket).close(LiveSink.TRY_AGAIN_LATER, "too many sessions");
      return;
    }
    socket.getAttributes().put(SESSION, session);
    if (socket.getAttributes().get(LoginHandshakeInterceptor.HTTP_SESSION) instanceof HttpSession httpSession) {
      loginSessions.opened(httpSession, socket); // ends with the login session
    }
  }

  @Override
  public boolean supportsPartialMessages() {
    return true; // the size is checked here, after reading the whole message (MAX_MESSAGE)
  }

  @Override
  protected void handleTextMessage(WebSocketSession socket, TextMessage message) {
    Parts parts = (Parts) socket.getAttributes().computeIfAbsent(PARTS, k -> new Parts());
    String whole = parts.add(message.getPayload(), message.isLast());
    if (parts.tooBig()) {
      if (parts.closeOnce()) {
        new Sink(socket).close(CloseStatus.TOO_BIG_TO_PROCESS.getCode(), "message too big");
      }
      return;
    }
    if (whole != null
        && socket.getAttributes().get(SESSION) instanceof LiveGateway.LiveSession session) {
      session.receive(whole);
    }
  }

  /**
   * One socket's message in parts. Tomcat calls the handler for one socket one call at a time, so it
   * needs no lock.
   */
  static final class Parts {
    private @Nullable StringBuilder text;
    /** The characters of a too large message so far; -1 while the message fits. */
    private long tooLarge = -1;
    private boolean close;
    private boolean closed;

    /** Adds a part; the whole message at its last part, else null. */
    @Nullable String add(String part, boolean last) {
      if (tooLarge >= 0) {
        tooLarge += part.length();
        close = last || tooLarge > MAX_DRAIN;
        return null;
      }
      int have = text == null ? 0 : text.length();
      if ((long) have + part.length() > MAX_MESSAGE) {
        text = null;
        tooLarge = (long) have + part.length();
        close = last || tooLarge > MAX_DRAIN;
        return null;
      }
      if (last) {
        if (text == null) {
          return part;
        }
        String whole = text.append(part).toString();
        text = null;
        return whole;
      }
      if (text == null) {
        text = new StringBuilder();
      }
      text.append(part);
      return null;
    }

    /** Whether the connection is to close with 1009: a too large message has been read to its end (or past MAX_DRAIN). */
    boolean tooBig() {
      return close;
    }

    /** True the first time only: the close is sent once, whatever parts still come during its handshake. */
    boolean closeOnce() {
      if (closed) {
        return false;
      }
      closed = true;
      return true;
    }
  }

  @Override
  public void handleTransportError(WebSocketSession socket, Throwable error) {
    LOG.debug("Live WebSocket {}: transport error", socket.getId(), error);
    closeSession(socket);
  }

  @Override
  public void afterConnectionClosed(WebSocketSession socket, CloseStatus status) {
    closeSession(socket);
  }

  private void closeSession(WebSocketSession socket) {
    if (socket.getAttributes().remove(SESSION) instanceof LiveGateway.LiveSession session) {
      if (socket.getAttributes().get(LoginHandshakeInterceptor.HTTP_SESSION) instanceof HttpSession httpSession) {
        loginSessions.closed(httpSession, socket);
      }
      session.close();
    }
  }

  /** The user as plugins see it (SDK 1.4.0, a session's time): the no-login mode's local user, or the login's. */
  static dev.emcc.ecore.live.SessionTimes.SessionUser sdkUser(User user) {
    return new dev.emcc.ecore.live.SessionTimes.SessionUser(user.id(), user.name(), user.permissions(), user.allPermissions());
  }

  /** The user as ECore checks change requests: the no-login mode's local user has every permission. */
  static Requester.User requester(User user) {
    return user.allPermissions() ? Requester.withAllPermissions(user.id()) : Requester.user(user.id(), user.permissions());
  }

  /** The socket as ECore's sink. Only the session's writer worker calls it, one call at a time. */
  private record Sink(WebSocketSession socket) implements LiveSink {
    @Override
    public void send(String text) throws Exception {
      socket.sendMessage(new TextMessage(text)); // blocks while the browser reads; Tomcat times out
    }

    @Override
    public void ping() throws Exception {
      socket.sendMessage(new PingMessage()); // the browser answers by itself; the answer counts as reading
    }

    @Override
    public void close(int status, String reason) {
      try {
        socket.close(new CloseStatus(status, reason));
      } catch (Exception e) {
        LOG.debug("Live WebSocket {}: closing failed", socket.getId(), e);
      }
    }
  }
}
