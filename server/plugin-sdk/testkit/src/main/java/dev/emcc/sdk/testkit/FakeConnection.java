package dev.emcc.sdk.testkit;

import dev.emcc.sdk.Bytes;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * A scripted connection of a listener in {@link FakePluginContext}: the test plays the peer. The
 * listener's loop reads only what the test fed; it runs when the test calls {@code
 * runUntilIdle()} (or {@code advance}), until it waits for more data or ends.
 *
 * <pre>{@code
 * plugin.start();
 * FakeConnection tak = ctx.connection("tak-north");
 * tak.feed("<event uid=\"ANDROID-1\" ...>...</event>");
 * ctx.runUntilIdle();
 * assertThat(tak.writtenUtf8()).contains("t-x-c-t");   // the presence event
 * tak.close();                                          // the peer closes; the loop's read returns -1
 * ctx.runUntilIdle();
 * }</pre>
 */
public final class FakeConnection {

  /** What {@link #take} returns when there is neither data nor an end yet: the reader must wait. */
  static final int NOTHING_YET = -2;

  private final String listener;
  private final String host;
  private final int port;
  private final Runnable onData;
  private final Deque<byte[]> chunks = new ArrayDeque<>();
  private final List<Bytes> written = new ArrayList<>();
  private int offset;
  private @Nullable String endReason;
  private boolean endOfStream;
  private boolean closed;

  FakeConnection(String listener, String host, int port, Runnable onData) {
    this.listener = listener;
    this.host = host;
    this.port = port;
    this.onData = onData;
  }

  /** The peer sends {@code data}. */
  public void feed(Bytes data) {
    Objects.requireNonNull(data, "data");
    synchronized (this) {
      if (closed || endReason != null) {
        throw new IllegalStateException("the connection of listener " + listener + " has ended");
      }
      if (!data.isEmpty()) {
        chunks.add(data.toArray());
      }
    }
    onData.run();
  }

  /** The peer sends {@code text} as UTF-8. */
  public void feed(String text) {
    feed(Bytes.utf8(text));
  }

  /** The peer closes the connection: after the data fed so far, reads return {@code -1}. */
  public synchronized void close() {
    end(true, "closed by the peer");
  }

  /** The connection fails: after the data fed so far, reads throw an {@link IOException} with {@code reason}. */
  public synchronized void fail(String reason) {
    end(false, Objects.requireNonNull(reason, "reason"));
  }

  /** Everything the loop wrote, in order. */
  public synchronized List<Bytes> written() {
    return List.copyOf(written);
  }

  /** Everything the loop wrote, decoded as UTF-8 and joined. */
  public synchronized String writtenUtf8() {
    var text = new StringBuilder();
    written.forEach(b -> text.append(b.toUtf8()));
    return text.toString();
  }

  /** False once ECore (the fake) closed the connection, after the loop ended. */
  public synchronized boolean isOpen() {
    return !closed;
  }

  public String host() {
    return host;
  }

  public int port() {
    return port;
  }

  // ---------------------------------------------------------------- for the fake listener

  /** Why the connection ended (peer closed, failed, idle, stopped), or {@code null} while it has not. */
  synchronized @Nullable String endReason() {
    return endReason;
  }

  synchronized boolean hasInputOrEnd() {
    return !chunks.isEmpty() || endReason != null;
  }

  synchronized void end(boolean eof, String reason) {
    if (endReason == null) {
      endReason = reason;
      endOfStream = eof;
    }
  }

  synchronized void markClosed() {
    closed = true;
    end(false, "closed");
  }

  /** Copies up to {@code len} bytes; returns their number, {@code -1} at the peer's end of stream, or {@link #NOTHING_YET}. */
  synchronized int take(byte[] b, int off, int len) throws IOException {
    if (!chunks.isEmpty()) {
      byte[] chunk = chunks.peekFirst();
      int n = Math.min(len, chunk.length - offset);
      System.arraycopy(chunk, offset, b, off, n);
      offset += n;
      if (offset == chunk.length) {
        chunks.removeFirst();
        offset = 0;
      }
      return n;
    }
    if (endReason == null) {
      return NOTHING_YET;
    }
    if (endOfStream) {
      return -1;
    }
    throw new IOException(endReason);
  }

  synchronized void write(Bytes data) throws IOException {
    if (endReason != null) {
      throw new IOException("the connection has ended: " + endReason);
    }
    written.add(data);
  }
}
