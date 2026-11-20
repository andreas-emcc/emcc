package dev.emcc.plugins.cot;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.worker.Coalescing;
import java.time.Instant;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * What workers and a link's own reader post to the link's connection task. The inbox keeps only the
 * latest {@link Send} per object (a slow peer never builds up a queue, brief function 21).
 */
sealed interface LinkInbox extends Message {

  /**
   * One CoT event to send, for the object {@code id}: a later one for the same object replaces it
   * while it waits. The text is the whole event. {@code expires} is the expiry of a channel item: if it has passed when the
   * task comes to write the event (the link was down), the event is not sent and is counted as expired.
   */
  record Send(UUID id, String xml, @Nullable Instant expires) implements LinkInbox, Coalescing {
    /** An event with no expiry of its own. */
    Send(UUID id, String xml) {
      this(id, xml, null);
    }

    /** Takes the place of a waiting event for the object and sends nothing: its removal, for an update that never went out. */
    static Send nothing(UUID id) {
      return new Send(id, "", null);
    }

    boolean isNothing() {
      return xml.isEmpty();
    }

    @Override
    public Object coalesceKey() {
      return id;
    }
  }

  /**
   * The link's reader has ended (the peer closed the connection, it was idle, or it failed): the writer of the same
   * run ends too, and ECore starts the link again. The inbox outlives runs, so the message says which run it is for: a
   * writer ignores one from an earlier run.
   */
  record Closed(java.util.UUID run, String reason) implements LinkInbox {}
}
