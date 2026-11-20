package dev.emcc.plugins.terrain;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.folder.FolderResult;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.worker.Reply;

/** The messages of the {@code heights} worker, which owns the index, the cache and who is computing. */
sealed interface HeightsMsg extends Message {

  /** The plugin has started: read the settings and make the index. */
  record Begin() implements HeightsMsg {}

  /** An accepted settings change, complete. */
  record SettingsChanged(JsonObject settings) implements HeightsMsg {}

  /** The answer to a folder call made in {@code generation} of the index. */
  record FolderDone(long generation, Work work, FolderResult result) implements HeightsMsg {}

  /** A call was answered {@code BUSY} with none of ours in progress: ask again. */
  record RetryPump(long generation) implements HeightsMsg {}

  /** {@code POST /viewshed}. */
  record Viewshed(EndpointRequest request) implements HeightsMsg {}

  /** {@code POST /heightmap}. */
  record HeightMap(EndpointRequest request) implements HeightsMsg {}

  /** A compute worker's answer for a height map request. */
  record MapReply(long requestId, Reply<MapComputed> reply) implements HeightsMsg {}

  /** {@code GET /status}. */
  record Status(EndpointRequest request) implements HeightsMsg {}

  /** A compute worker's answer for a request. */
  record ComputeReply(long requestId, Reply<Computed> reply) implements HeightsMsg {}

  /** A request has taken as long as the setting allows. */
  record RequestTimeout(long requestId) implements HeightsMsg {}
}
