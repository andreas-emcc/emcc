package dev.emcc.sdk.listener;

import dev.emcc.sdk.Bytes;
import java.io.IOException;
import java.io.InputStream;

/**
 * The connection ECore opened for a listener. Use it only on the listener's own thread, inside
 * {@link Listener#run}. ECore closes it when the loop ends or the listener is stopped; a blocked
 * read then fails with an {@link IOException}.
 *
 * <pre>{@code
 * InputStream in = connection.input();
 * connection.write(Bytes.utf8(presenceEvent));
 * }</pre>
 *
 * @deprecated from SDK 1.2.0: use a connection task ({@code dev.emcc.sdk.connection}), in which the
 *     plugin opens its own sockets of any kind (ADR-0036). Kept in SDK 1.x for existing code, removed
 *     in the next major version.
 */
@Deprecated(since = "1.2.0")
public interface ListenerConnection {

  /** The largest amount one {@link #write} may send. A listener is for receiving. */
  int MAX_WRITE_BYTES = 64 * 1024;

  /**
   * The data the peer sends. Reads block until data arrives; one that waits longer than the spec's
   * idle timeout fails with an {@link IOException}, which ends the loop.
   */
  InputStream input();

  /**
   * Sends {@code data} to the peer, e.g. a presence event a TAK Server needs (cot-in brief,
   * function 9). May block until sent, but not longer than the spec's idle timeout: a write that
   * cannot complete by then fails with an {@link IOException}, which ends the loop. Stopping the
   * listener, and the peer closing, end a blocked write too.
   *
   * @throws IllegalArgumentException if {@code data} is larger than {@link #MAX_WRITE_BYTES}
   * @throws IOException if the connection fails
   */
  void write(Bytes data) throws IOException;

  /** The host the connection goes to, as in the spec. */
  String host();

  /** The port, as in the spec. */
  int port();
}
