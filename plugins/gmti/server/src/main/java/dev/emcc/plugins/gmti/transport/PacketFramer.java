package dev.emcc.plugins.gmti.transport;

import dev.emcc.plugins.gmti.format.Decoder;
import dev.emcc.sdk.connection.TaskContext;
import java.io.IOException;
import java.io.InputStream;

/**
 * Cuts a TCP stream (or a file, which is the same stream) into 4607 packets by their size {@code P2}
 * (reference 5; brief section 4): read the first six bytes, then the rest of {@code P2}. The format
 * has no marker to find its place again (pitfall 18), so a size below a header or above {@link
 * Decoder#MAX_PACKET} is counted and ends the stream with an {@code IOException}: the connection task
 * reconnects. It holds no socket; the task gives it the stream.
 */
final class PacketFramer {

  /** Takes each whole packet. */
  interface Sink {
    /**
     * One packet of exactly {@code P2} bytes.
     *
     * @throws IOException when the stream must end (a malformed packet over TCP)
     */
    void packet(byte[] bytes) throws IOException;
  }

  private PacketFramer() {}

  /** Reads packets until the stream ends at a packet's boundary, the task is stopped, or a size is impossible. */
  static void read(TaskContext<?> task, InputStream in, Sink sink) throws IOException {
    byte[] head = new byte[6];
    while (!task.stopping()) {
      int got = fill(in, head, 0, head.length);
      if (got == 0) {
        return; // the peer closed between packets
      }
      if (got < head.length) {
        throw new IOException("the peer closed the connection inside a packet header");
      }
      long size = Decoder.packetSize(head, 0);
      if (size > Decoder.MAX_PACKET) {
        task.count("dropped: too long", 1);
        throw new IOException("a packet of " + size + " bytes, more than " + Decoder.MAX_PACKET + ": the stream is reconnected");
      }
      if (size < Decoder.HEADER) {
        task.count("dropped: malformed", 1);
        throw new IOException("a packet size of " + size + " bytes: the stream is reconnected");
      }
      byte[] packet = new byte[(int) size];
      System.arraycopy(head, 0, packet, 0, head.length);
      if (fill(in, packet, head.length, packet.length - head.length) < packet.length - head.length) {
        throw new IOException("the peer closed the connection inside a packet");
      }
      task.count("bytes in", size);
      sink.packet(packet);
    }
  }

  /** Reads up to {@code n} bytes; fewer only at the end of the stream. */
  private static int fill(InputStream in, byte[] into, int at, int n) throws IOException {
    int done = 0;
    while (done < n) {
      int r = in.read(into, at + done, n - done);
      if (r < 0) {
        break;
      }
      done += r;
    }
    return done;
  }
}
