package dev.emcc.plugins.template.transport;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.connection.ConnectionEvent;
import dev.emcc.sdk.json.JsonObject;
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

  /** YOUR PROTOCOL: one frame received, parsed in the task; replace the text by your own parsed record. */
  record Received(String link, UUID run, String frame) implements TransportMsg {}

  /**
   * Something to send on {@code link}, for {@code key}. In the template it stands for where your data
   * comes from: an output channel's item (ADR-0037) or a change in the store.
   */
  record Outgoing(String link, String key, String frame) implements TransportMsg {}
}
