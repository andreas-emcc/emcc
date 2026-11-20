package dev.emcc.plugins.gmti.transport;

import dev.emcc.plugins.gmti.format.Decoded;
import dev.emcc.plugins.gmti.format.Decoder;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.IOException;
import java.util.UUID;

/**
 * What a task does with each packet it received: decodes it here, in the task (assumption B5), and
 * sends the packet to the worker as an immutable message. It never touches objects or the worker's
 * state, and holds no socket.
 *
 * <p>The counters appear in the monitor view, per task: {@code packets in}, {@code bytes in}, and
 * {@code dropped: <reason>} (brief section 6): {@code too long}, {@code malformed}, {@code size
 * mismatch} (UDP), {@code worker busy} (the worker's mailbox was full).
 */
final class Inbound implements PacketFramer.Sink {

  private final String link;
  private final UUID run;
  private final WorkerRef<TransportMsg> worker;
  private final TaskContext<?> task;

  Inbound(String link, UUID run, WorkerRef<TransportMsg> worker, TaskContext<?> task) {
    this.link = link;
    this.run = run;
    this.worker = worker;
    this.task = task;
  }

  /** A packet from a TCP stream: a malformed one ends the stream, since a stream cannot find its place again (pitfall 18). */
  @Override
  public void packet(byte[] bytes) throws IOException {
    Decoded d = Decoder.decode(bytes);
    if (d.packet() == null) {
      task.count("dropped: " + d.reason(), 1);
      throw new IOException("a " + d.reason() + " packet (" + d.detail() + "): the stream is reconnected");
    }
    deliver(d);
  }

  /** One datagram: one packet, whose {@code P2} must be the datagram's length; a bad one is dropped and the link goes on. */
  void datagram(byte[] buffer, int length) {
    task.count("bytes in", length);
    if (length < 6 || Decoder.packetSize(buffer, 0) != length) {
      task.count("dropped: " + Decoded.SIZE_MISMATCH, 1);
      return;
    }
    Decoded d = Decoder.decode(buffer, 0, length);
    if (d.packet() == null) {
      task.count("dropped: " + d.reason(), 1);
      return;
    }
    deliver(d);
  }

  private void deliver(Decoded d) {
    if (task.send(worker, new TransportMsg.Received(link, run, d.packet())) == SendResult.DROPPED) {
      task.count("dropped: worker busy", 1);
    }
    task.count("packets in", 1); // after the send: whoever reads the counter knows the worker has been told
  }
}
