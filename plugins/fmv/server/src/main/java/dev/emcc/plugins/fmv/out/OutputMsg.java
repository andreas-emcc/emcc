package dev.emcc.plugins.fmv.out;

import dev.emcc.plugins.fmv.out.wms.WmsCache;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.channel.DeclaredItem;
import dev.emcc.sdk.compute.ComputeEvent;
import dev.emcc.sdk.connection.ConnectionEvent;
import dev.emcc.sdk.document.DocumentResult;
import dev.emcc.sdk.folder.FolderResult;
import dev.emcc.sdk.http.HttpResult;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.stream.ConversionEvent;

/** The messages of the {@link OutputWorker}: one record per message. */
public sealed interface OutputMsg extends Message {

  /** The plugin's settings, at the start and after each accepted change. */
  record SettingsChanged(JsonObject settings) implements OutputMsg {}

  /** A pose from a sender, for the output link {@code link} (its id). */
  record Declared(String link, DeclaredItem item) implements OutputMsg {}

  /** An item of a kind the channel does not take: none come, since it takes declared kinds only. */
  record Ignored() implements OutputMsg {}

  /** ECore's news of a link's compute task. */
  record Compute(String link, ComputeEvent event) implements OutputMsg {}

  /** ECore's news of a link's sender. */
  record Sender(String link, ConnectionEvent event) implements OutputMsg {}

  /** ECore's news of a link's encoder (part U), of the encoder the link started as its {@code generation}th. */
  record Encoder(String link, int generation, ConversionEvent event) implements OutputMsg {}

  /** A folder's answer for a link: {@code folder} is {@code terrain} or {@code imagery}. */
  record Folder(String link, String folder, FolderResult result) implements OutputMsg {}

  /** The compute task's totals, once a second. */
  record Rendered(String link, long rendered, long late, long encoderDropped, long encoded, long muxed, long noImagery, double renderMs)
      implements OutputMsg {}

  /** The sender's totals, once a second: datagrams and bytes sent, and datagrams dropped for want of room. */
  record Sent(String link, long datagrams, long bytes, long dropped) implements OutputMsg {}

  /** A document answer for the WMS cache (F2). */
  record WmsDocument(WmsCache.Op op, String key, DocumentResult result) implements OutputMsg {}

  /** A WMS tile's fetch answer (F2). */
  record WmsFetched(String key, HttpResult result) implements OutputMsg {}

  /** Twice a second: a camera that stopped frees its link, a refused start is tried again, the readers go on. */
  record Tick() implements OutputMsg {}
}
