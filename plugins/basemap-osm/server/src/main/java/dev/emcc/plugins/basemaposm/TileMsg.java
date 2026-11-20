package dev.emcc.plugins.basemaposm;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.HttpResult;
import dev.emcc.sdk.json.JsonObject;

/** The messages of the {@code tiles} worker: one sealed interface per worker, one record per message. */
sealed interface TileMsg extends Message {

  /** A request to {@code GET /api/plugins/basemap-osm/tiles/{z}/{x}/{y}.png}. */
  record Get(EndpointRequest request) implements TileMsg {}

  /** The outcome of the upstream request for one tile. */
  record Fetched(TileKey key, HttpResult result) implements TileMsg {}

  /** The complete new settings after a change in the settings view (SDK v1). */
  record SettingsChanged(JsonObject settings) implements TileMsg {}

  /** The worker's clock (every 500 ms): waiting-time limit of queued requests, circuit breaker, warning interval. */
  record Tick() implements TileMsg {}
}
