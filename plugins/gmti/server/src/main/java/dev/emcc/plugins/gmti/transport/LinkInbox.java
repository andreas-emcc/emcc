package dev.emcc.plugins.gmti.transport;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.worker.Coalescing;
import java.util.List;
import java.util.UUID;

/**
 * What goes into a link task's inbox: from the worker, what to send; from the link's own tasks, that a
 * socket has ended or that a client came. The inbox keeps only the latest {@link Send} per sensor, so
 * a slow peer loses whole dwells, never part of one (brief section 3, "A slow link drops older
 * dwells"; {@code Overflow.coalesceByKey()}).
 */
public sealed interface LinkInbox extends Message {

  /**
   * One dwell to send, for {@code key} (its sensor): its packets, written back to back over TCP and
   * one datagram each over UDP. A later one with the same key replaces it while it waits: the sensor's, or with a sequence the sensor's and dwell
   * number's (CR-0040; {@code LinkWorker.inboxKey}).
   *
   * @param serial the worker's number of this dwell for its sensor, so that a task can say which it sent
   */
  record Send(String key, long serial, List<Bytes> packets) implements LinkInbox, Coalescing {
    public Send {
      packets = List.copyOf(packets);
    }

    @Override
    public Object coalesceKey() {
      return key;
    }
  }

  /**
   * The reader of a socket has ended (the peer closed it, it was idle, it failed): the writer of the
   * same run ends too, and ECore starts the link again. The inbox outlives runs, so the message names
   * its run, and a writer ignores one from an earlier run.
   */
  record Closed(UUID run, String reason) implements LinkInbox {}

  /**
   * A TCP server's new client: the server's task forwards every {@link Send} to its writer from now
   * on, and only then tells the worker ({@link TransportMsg.Up}).
   */
  record ClientUp(ConnectionRef<LinkInbox> writer, UUID run, String peer) implements LinkInbox {}
}
