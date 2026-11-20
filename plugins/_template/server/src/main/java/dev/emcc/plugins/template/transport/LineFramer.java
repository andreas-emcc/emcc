package dev.emcc.plugins.template.transport;

import dev.emcc.sdk.connection.TaskContext;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;

/**
 * Cuts received bytes into frames. YOUR PROTOCOL: frames are text lines here, as in NMEA 0183 (AIS)
 * and SBS-1 (ADS-B); replace this class if yours are not. A line ends at {@code \n}, a {@code \r}
 * before it is dropped, and empty lines are skipped. A line of more than the limit, a final {@code
 * \r} included, is dropped up to its end and reported, and the next line is read: received data is
 * untrusted, so nothing grows without a limit. One framer per socket; it holds no socket itself.
 */
final class LineFramer {

  /** Where the frames go. */
  interface Sink {
    void frame(String line);

    /** A line of {@code bytes} bytes or more was dropped. */
    void tooLong(long bytes);
  }

  private final int max;
  private final ByteArrayOutputStream line = new ByteArrayOutputStream();
  /** The length of the line being dropped, or -1 while none is. */
  private long dropping = -1;

  LineFramer(int max) {
    this.max = max;
  }

  /** Feeds {@code length} bytes from {@code data}, from {@code offset}. */
  void feed(byte[] data, int offset, int length, Sink sink) {
    for (int i = offset; i < offset + length; i++) {
      byte b = data[i];
      if (b == '\n') {
        end(sink);
      } else if (dropping >= 0) {
        dropping++;
      } else if (line.size() == max) {
        dropping = line.size() + 1L;
        line.reset();
      } else {
        line.write(b);
      }
    }
  }

  /**
   * Reads {@code in} and frames it until the stream ends or the task stops. A read that times out
   * (the socket's idle time) ends it with an {@code IOException}, unless the task is stopping.
   */
  void read(TaskContext<?> task, InputStream in, Sink sink) throws IOException {
    byte[] chunk = new byte[8192];
    try {
      for (int n; !task.stopping() && (n = in.read(chunk)) >= 0; ) {
        feed(chunk, 0, n, sink);
      }
    } catch (SocketTimeoutException e) {
      if (!task.stopping()) {
        throw new IOException("nothing received for the idle time", e);
      }
    }
  }

  /** Ends the line being read, as at a line end: for a datagram, whose end ends its last line too. */
  void end(Sink sink) {
    if (dropping >= 0) {
      sink.tooLong(dropping);
      dropping = -1;
      return;
    }
    byte[] bytes = line.toByteArray();
    line.reset();
    int n = bytes.length > 0 && bytes[bytes.length - 1] == '\r' ? bytes.length - 1 : bytes.length;
    if (n > 0) {
      sink.frame(new String(bytes, 0, n, StandardCharsets.UTF_8));
    }
  }
}
