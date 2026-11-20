package dev.emcc.plugins.template.transport;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.worker.Coalescing;
import java.util.UUID;

/**
 * What goes into a link task's inbox: from the worker, what to send; from the link's own tasks, that a
 * socket has ended or that a client came. The inbox keeps only the latest {@link Send} per key, so a
 * slow peer never builds up a queue ({@code Overflow.coalesceByKey()}).
 */
public sealed interface LinkInbox extends Message {

  /**
   * One frame to send, for {@code key} (e.g. a track's id): a later one for the same key replaces it
   * while it waits. YOUR PROTOCOL: the frame is one line here, sent with a line end; use your own
   * type if your frames are not text.
   */
  record Send(String key, String frame) implements LinkInbox, Coalescing {
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
   * A TCP server's new client that the link sends to: the server's task forwards every {@link Send} to
   * its writer from now on, and only then tells the worker ({@link TransportMsg.Up}), so that nothing
   * the worker sends after it has heard of the client misses it.
   */
  record ClientUp(ConnectionRef<LinkInbox> writer, UUID run, String peer) implements LinkInbox {}
}
