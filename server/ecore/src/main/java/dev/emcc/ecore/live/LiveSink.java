package dev.emcc.ecore.live;

/**
 * Where a session's messages go: the browser's WebSocket, provided by the edge. Called only by the
 * session's writer worker, one call at a time, so an implementation may block while the socket
 * sends (it should give up after a send timeout, by throwing).
 */
public interface LiveSink {

  /** Sends one text message. */
  void send(String text) throws Exception;

  /** Sends a WebSocket ping, which the browser answers by itself, so a working connection is never idle. */
  default void ping() throws Exception {}

  /** WebSocket close status: the browser breaks a limit, e.g. sends too much (RFC 6455: 1008). */
  int POLICY_VIOLATION = 1008;
  /** WebSocket close status: an error on the server (1011). */
  int SERVER_ERROR = 1011;
  /** WebSocket close status: overloaded, try again later, e.g. too slow or too many sessions (1013). */
  int TRY_AGAIN_LATER = 1013;

  /** Closes the connection with a WebSocket close status and a short reason (at most 123 bytes). */
  void close(int status, String reason);
}
