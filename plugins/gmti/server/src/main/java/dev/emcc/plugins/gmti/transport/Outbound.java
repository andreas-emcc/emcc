package dev.emcc.plugins.gmti.transport;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.IOException;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * What a writing task does after it sent one dwell: counts it ({@code dwells out}, {@code packets
 * out}), counts the dwells of the same sensor that the inbox replaced while they waited ({@code dwells
 * dropped}: the gap in the worker's serials), and tells the worker. One per writing task, so its map
 * is that task's own.
 */
final class Outbound {

  private final String link;
  private final WorkerRef<TransportMsg> worker;
  private final TaskContext<?> task;
  private final Map<String, Long> lastSerial = new HashMap<>();

  Outbound(String link, WorkerRef<TransportMsg> worker, TaskContext<?> task) {
    this.link = link;
    this.worker = worker;
    this.task = task;
  }

  /** Writes a dwell's packets back to back on a stream, then counts it. */
  void write(OutputStream out, LinkInbox.Send send) throws IOException {
    for (Bytes packet : send.packets()) {
      out.write(packet.toArray());
    }
    out.flush();
    sent(send);
  }

  /** Counts a dwell that went out and tells the worker. */
  void sent(LinkInbox.Send send) {
    Long before = lastSerial.put(send.key(), send.serial());
    long dropped = before == null ? 0 : Math.max(0, send.serial() - before - 1);
    if (dropped > 0) {
      task.count("dwells dropped", dropped);
    }
    task.count("dwells out", 1);
    task.count("packets out", send.packets().size());
    task.send(worker, new TransportMsg.Sent(link, send.key(), send.serial(), dropped));
  }
}
