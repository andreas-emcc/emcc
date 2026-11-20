package dev.emcc.plugins.nvg.files;

import dev.emcc.plugins.nvg.compute.ComputeMsg;
import dev.emcc.plugins.nvg.sync.SyncRun;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.store.QueryResult;
import dev.emcc.sdk.worker.Reply;
import java.util.UUID;

/** The files worker's messages. */
public sealed interface FilesMsg extends Message {

  /** {@code POST /import?layer=&name=&policy=&classification=}, an NVG file as the raw body. */
  record Import(EndpointRequest request) implements FilesMsg {}

  /** {@code GET /import/{job}}: an import's state and counts. */
  record ImportState(EndpointRequest request) implements FilesMsg {}

  /** {@code GET /export?layer=&layer=...}: layers as one NVG file. */
  record Export(EndpointRequest request) implements FilesMsg {}

  /** The store's answer for an import: the file's objects and all layers. */
  record ImportQueried(UUID job, QueryResult result) implements FilesMsg {}

  /** The compute worker's read and planned file. */
  record ImportPrepared(UUID job, Reply<ComputeMsg.Prepared> reply) implements FilesMsg {}

  /** One change request's outcome. */
  record Synced(SyncRun.Outcome outcome) implements FilesMsg {}

  /** The store's answer for one exported layer. */
  record ExportQueried(UUID export, int index, QueryResult result) implements FilesMsg {}

  /** An import ended ten minutes ago: it is forgotten (brief, section 4; owner NV2 P1). */
  record Expire(UUID job) implements FilesMsg {}

  /** The compute worker's written document. */
  record Exported(UUID export, Reply<ComputeMsg.Exported> reply) implements FilesMsg {}
}
