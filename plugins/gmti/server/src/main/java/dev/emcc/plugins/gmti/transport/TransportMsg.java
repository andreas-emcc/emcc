package dev.emcc.plugins.gmti.transport;

import dev.emcc.plugins.gmti.format.Packet;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.connection.ConnectionEvent;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.ObjectWriter;
import java.util.List;
import java.util.UUID;

/** The messages of the {@link LinkWorker}: one sealed interface per worker, one record per message. */
public sealed interface TransportMsg extends Message {

  /** The plugin's settings, at the start and after each accepted change. */
  record SettingsChanged(JsonObject settings) implements TransportMsg {}

  /** ECore's news of a link's task: running, restarting, failed, stopped. Always delivered. */
  record LinkEvent(ConnectionEvent event) implements TransportMsg {}

  /** A TCP server's run has bound its port and accepts clients. */
  record Listening(String link, UUID run, String address) implements TransportMsg {}

  /** A run has its socket: connected to {@code peer}, or for UDP bound. For a TCP server, one per client. */
  record Up(String link, UUID run, String peer) implements TransportMsg {}

  /** That run, or that client, has ended. */
  record Down(String link, UUID run, String reason) implements TransportMsg {}

  /** One packet received and decoded in the task. */
  record Received(String link, UUID run, Packet packet) implements TransportMsg {}

  /** Packets to send on an {@code out} link, for {@code key} (a sensor): one dwell. */
  record Outgoing(String link, String key, List<Bytes> packets) implements TransportMsg {
    public Outgoing {
      packets = List.copyOf(packets);
    }
  }

  /**
   * A task wrote dwell {@code serial} of {@code key}; {@code dropped} dwells of the same key that the
   * inbox replaced while they waited went before it (brief section 3, "A slow link drops older dwells").
   */
  record Sent(String link, String key, long serial, long dropped) implements TransportMsg {}

  /** An item of an {@code out} link's output channel (ADR-0037 point 4): a dwell of a sensor. */
  record FromChannel(String link, ChannelItem item) implements TransportMsg {}

  /** The object writer's own messages (its store subscription, its answers, its timer); passed back to it. */
  record Writer(ObjectWriter.Reply reply) implements TransportMsg {}

  /** The answer to removing a hidden dwell area or a coverage ({@code what}: "area" or "coverage"). */
  record Removed(String link, String what, ChangeOutcome outcome) implements TransportMsg {}

  /** Once a second: drops what waited too long for its mission, and refreshes the status. */
  record Tick() implements TransportMsg {}
}
