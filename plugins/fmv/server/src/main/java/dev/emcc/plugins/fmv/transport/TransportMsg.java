package dev.emcc.plugins.fmv.transport;

import dev.emcc.plugins.fmv.klv.Metadata;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.connection.ConnectionEvent;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.ObjectWriter;
import dev.emcc.sdk.stream.ConversionEvent;
import java.time.Instant;
import java.util.UUID;

/** The messages of the {@link LinkWorker}: one sealed interface per worker, one record per message. */
public sealed interface TransportMsg extends Message {

  /** The plugin's settings, at the start and after each accepted change. */
  record SettingsChanged(JsonObject settings) implements TransportMsg {}

  /** ECore's news of a link's task: running, restarting, failed, stopped. Always delivered. */
  record LinkEvent(ConnectionEvent event) implements TransportMsg {}

  /** An answer of the object writer. */
  record Writer(ObjectWriter.Reply reply) implements TransportMsg {}

  /** A run has its socket. */
  record Up(String link, UUID run, String where) implements TransportMsg {}

  /** That run has ended. */
  record Down(String link, UUID run, String reason) implements TransportMsg {}

  /**
   * The task chose a program: the first with video, or the same program with another video PID or
   * type (the stream is then opened again), or with another KLV PID.
   */
  record Chosen(String link, UUID run, int programNumber, int videoPid, int videoType, int klvPid) implements TransportMsg {}

  /** The video's width and height, read from the stream. */
  record Size(String link, UUID run, int width, int height) implements TransportMsg {}

  /** One ST 0601 set whose checksum was right. */
  record Telemetry(String link, UUID run, Metadata metadata, Instant received) implements TransportMsg {}

  /**
   * The task's totals, once a second: datagrams and bytes received so far in this run, and whether
   * the tables list no video.
   */
  record Traffic(String link, UUID run, long datagrams, long bytes, boolean noVideo) implements TransportMsg {}

  /** ECore's news of the link's conversion (MPEG-2 to H.264). */
  record Conversion(String link, UUID run, ConversionEvent event) implements TransportMsg {}

  /** The store's answer to the removal of an object. */
  record Removed(String link, String what, ChangeOutcome outcome) implements TransportMsg {}

  /** The store's answer to the look for a removed link's objects. */
  record Found(String link, dev.emcc.sdk.store.QueryResult result) implements TransportMsg {}

  /** {@code GET /streams}: the panel's list. */
  record Streams(EndpointRequest request) implements TransportMsg {}

  /** Twice a second: the writes, the stale marks and the rates. */
  record Tick() implements TransportMsg {}

  /** The output links' lines for the plugin's status, from their worker (brief section 10.7), and whether one cannot render. */
  record OutputStatus(java.util.List<String> lines, boolean degraded) implements TransportMsg {
    public OutputStatus {
      lines = java.util.List.copyOf(lines);
    }
  }
}
