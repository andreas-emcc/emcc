/**
 * HTTP for plugins, without blocking a worker: outbound calls that ECore performs outside the
 * worker ({@link dev.emcc.sdk.http.OutboundHttp}), and plugin-scoped endpoints under
 * {@code /api/plugins/{pluginId}/} whose requests arrive as messages and may be answered later
 * ({@link dev.emcc.sdk.http.Endpoints}). Plugin code never sees Spring (ADR-0002).
 *
 * <pre>{@code
 * context.endpoints().register(Endpoint.get("/tiles/{z}/{x}/{y}.png"), tiles, TileMsg.Get::new);
 * context.http().send(HttpCall.get(uri), Duration.ofSeconds(5), tiles, r -> new TileMsg.Fetched(key, r));
 * }</pre>
 */
@NullMarked
package dev.emcc.sdk.http;

import org.jspecify.annotations.NullMarked;
