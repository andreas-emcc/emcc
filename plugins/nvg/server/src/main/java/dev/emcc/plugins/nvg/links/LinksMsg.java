package dev.emcc.plugins.nvg.links;

import dev.emcc.plugins.nvg.compute.ComputeMsg;
import dev.emcc.plugins.nvg.sync.SyncRun;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.document.DocumentResult;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.HttpResult;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.QueryResult;
import dev.emcc.sdk.store.StoreUpdate;
import dev.emcc.sdk.worker.Reply;
import java.util.UUID;

/** The links worker's messages. */
public sealed interface LinksMsg extends Message {

  /** The plugin's settings, at the start and after each change. */
  record Settings(JsonObject values) implements LinksMsg {}

  /** The plugin document with the links' new layers ({@code layers}). */
  record LayersLoaded(DocumentResult result) implements LinksMsg {}

  /** The document was written. */
  record LayersSaved(DocumentResult result) implements LinksMsg {}

  /** A consumer link's turn: call {@code GetNvg}. */
  record Poll(String link) implements LinksMsg {}

  /** A consumer's {@code GetNvg} answered. */
  record Called(String link, long call, HttpResult result) implements LinksMsg {}

  /** The store's answer for a consumer: the link's objects and all layers. */
  record Queried(String link, long call, QueryResult result) implements LinksMsg {}

  /** A consumer's new layer was created (or not). */
  record LayerCreated(String link, long call, String name, UUID id, ChangeOutcome outcome) implements LinksMsg {}

  /** The compute worker's read and planned answer. */
  record Prepared(String link, long call, Reply<ComputeMsg.Prepared> reply) implements LinksMsg {}

  /** One change request's outcome. */
  record Synced(SyncRun.Outcome outcome) implements LinksMsg {}

  /** {@code POST /api/services/nvg/nvg/{link}}: another system calls a provider link. */
  record Service(EndpointRequest request) implements LinksMsg {}

  /** The compute worker's written answer for a provider call. */
  record Served(UUID call, Reply<ComputeMsg.Exported> reply) implements LinksMsg {}

  /** A source layer's objects changed. */
  record Source(UUID layer, StoreUpdate update) implements LinksMsg {}

  /** An item a sender gave a provider link's output channel. */
  record Channel(String link, ChannelItem item) implements LinksMsg {}

  /** {@code GET /links}: the links and their state, for admins in the NVG panel. */
  record ListLinks(EndpointRequest request) implements LinksMsg {}

  /** {@code POST /links/{name}/capabilities}: call a consumer's provider's {@code GetCapabilities} once (NV1). */
  record Capabilities(EndpointRequest request) implements LinksMsg {}

  /** {@code GetCapabilities} answered. */
  record CapabilitiesCalled(String link, UUID call, HttpResult result) implements LinksMsg {}
}
