package dev.emcc.plugins.adsb;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.connection.ConnectionEvent;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.store.ObjectWriter;
import java.util.UUID;

/** The messages of the {@link LinkWorker}: one sealed interface for the worker, one record per message. */
public sealed interface AdsbMsg extends Message {

  /** The plugin's settings, at the start and after each accepted change. */
  record SettingsChanged(JsonObject settings) implements AdsbMsg {}

  /** ECore's news of a link's task: running, restarting, failed, stopped. Always delivered. */
  record LinkEvent(ConnectionEvent event) implements AdsbMsg {}

  /** A link's run has its socket, connected to {@code peer}. */
  record Up(String link, UUID run, String peer) implements AdsbMsg {}

  /** That run has ended, with the reason. */
  record Down(String link, UUID run, String reason) implements AdsbMsg {}

  /** One SBS-1 message, parsed in the task. */
  record Received(String link, UUID run, Sbs1.Message message) implements AdsbMsg {}

  /** Every minute: forgets the aircraft that have gone quiet, and rolls the per-minute counts. */
  record Sweep() implements AdsbMsg {}

  /** The object writer's own messages (its store subscription, its answers, its timer); passed back to it. */
  record Writer(ObjectWriter.Reply reply) implements AdsbMsg {}
}
