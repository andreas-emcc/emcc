package dev.emcc.plugins.basemapwms;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.HttpResult;
import dev.emcc.sdk.json.JsonObject;

/** The messages of the {@code wms} worker: one sealed interface per worker, one record per message. */
sealed interface WmsMsg extends Message {

  /** A request to {@code GET /api/plugins/basemap-wms/map/{background}}. */
  record MapGet(EndpointRequest request) implements WmsMsg {}

  /** A request to {@code GET /api/plugins/basemap-wms/backgrounds}. */
  record BackgroundsGet(EndpointRequest request) implements WmsMsg {}

  /** A request to {@code GET /api/plugins/basemap-wms/servers/{server}/layers}. */
  record LayersGet(EndpointRequest request) implements WmsMsg {}

  /** The complete new settings after a change in the settings view. */
  record SettingsChanged(JsonObject settings) implements WmsMsg {}

  /** The plugin has started: the first capabilities reads may begin. */
  record Start() implements WmsMsg {}

  /** The worker's clock (every 500 ms): waiting-time limit of map requests, due reads. */
  record Tick() implements WmsMsg {}

  /** The outcome of one capabilities read. */
  record ReadDone(String serverId, long readId, HttpResult result) implements WmsMsg {}

  /** The outcome of one map call to a server. */
  record MapDone(long callId, HttpResult result) implements WmsMsg {}
}
