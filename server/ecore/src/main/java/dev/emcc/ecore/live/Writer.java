package dev.emcc.ecore.live;

import dev.emcc.ecore.runtime.HandlerContext;
import dev.emcc.ecore.runtime.MessageHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The only code that writes to a session's socket. Sending may block while the browser reads
 * slowly, so it happens here, in ECore's own worker with the longest budget (like the persistence
 * manager's file I/O), never in the session worker. After a failed send the connection is closed
 * and everything still queued is dropped. Once the writer has closed the socket, the session ends.
 */
final class Writer implements MessageHandler<LiveMsg.Writer> {

  private static final Logger LOG = LoggerFactory.getLogger(Writer.class);

  private final String session;
  private final LiveSink sink;
  private final Runnable onClosed;
  private boolean closed;

  /** @param onClosed runs after the writer closed the socket, whether that worked or not */
  Writer(String session, LiveSink sink, Runnable onClosed) {
    this.session = session;
    this.sink = sink;
    this.onClosed = onClosed;
  }

  @Override
  public void handle(LiveMsg.Writer message, HandlerContext<LiveMsg.Writer> context) {
    if (closed) {
      return;
    }
    switch (message) {
      case LiveMsg.Writer.Text text -> {
        try {
          sink.send(text.text());
        } catch (Exception e) {
          LOG.info("Live session {}: sending failed ({}); closing it", session, e.toString());
          close(LiveSink.SERVER_ERROR, "sending failed");
          return;
        }
        Runnable afterSent = text.afterSent();
        if (afterSent != null) {
          afterSent.run();
        }
      }
      case LiveMsg.Writer.Close close -> close(close.status(), close.reason());
      case LiveMsg.Writer.Ping ping -> {
        try {
          sink.ping();
        } catch (Exception e) {
          LOG.info("Live session {}: ping failed ({}); closing it", session, e.toString());
          close(LiveSink.SERVER_ERROR, "sending failed");
        }
      }
    }
  }

  private void close(int status, String reason) {
    closed = true;
    try {
      sink.close(status, reason);
    } catch (RuntimeException e) {
      LOG.debug("Live session {}: closing failed", session, e);
    } finally {
      onClosed.run(); // the session ends even if the edge never learns that the socket closed
    }
  }
}
