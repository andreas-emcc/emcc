package dev.emcc.plugins.ais.transport;

import dev.emcc.plugins.ais.codec.AisMessage;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.connection.ConnectionEvent;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.store.ObjectWriter;
import java.util.UUID;

/** The messages of the {@link LinkWorker}: one sealed interface per worker, one record per message. */
public sealed interface TransportMsg extends Message {

  /** The plugin's settings, at the start and after each accepted change. */
  record SettingsChanged(JsonObject settings) implements TransportMsg {}

  /** ECore's news of a link's task: running, restarting, failed, stopped. Always delivered. */
  record LinkEvent(ConnectionEvent event) implements TransportMsg {}

  /** A run has its socket: connected to {@code peer}, or for UDP bound to its address. */
  record Up(String link, UUID run, String peer) implements TransportMsg {}

  /** That run has ended. */
  record Down(String link, UUID run, String reason) implements TransportMsg {}

  /** A position report received and decoded in the task (types 1, 2, 3, 18, 19). */
  record ReceivedPosition(String link, UUID run, AisMessage.Position message) implements TransportMsg {}

  /** Static data received and decoded in the task (types 5 and 24). */
  record ReceivedStatic(String link, UUID run, AisMessage.StaticReport message) implements TransportMsg {}

  /** Once a second, from a timer. */
  record Tick() implements TransportMsg {}

  /** One of the object writer's own replies (SDK 1.4.0), passed back to it. */
  record Writer(ObjectWriter.Reply reply) implements TransportMsg {}

  /** The plugin stops: the writer ends its subscription and timer. */
  record Stop() implements TransportMsg {}
}
