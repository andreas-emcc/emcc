package dev.emcc.sdk.http;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Duration;
import java.util.function.Function;

/**
 * Outbound HTTP that never blocks a worker. ECore performs the call on its own threads and delivers
 * the {@link HttpResult} later to {@code target}, converted by {@code toMessage} (plugin code:
 * pure, non-blocking, run inside the target worker).
 *
 * <p>Limits: {@code GET}, and from SDK 1.6.0 {@code POST} with a body of at most {@link HttpCall#MAX_REQUEST_BODY_BYTES}
 * (CR-0041 part A); no redirects; a response body limit of {@link #MAX_BODY_BYTES}, or the call's own
 * {@link HttpCall#maxResponseBytes()} up to {@link HttpCall#MAX_RESPONSE_BYTES}; a named {@link HttpCall#credential}
 * that is not configured fails at once; at most
 * {@link #MAX_CONCURRENT_CALLS} calls per plugin at a time. A call beyond a limit fails at once
 * with {@link HttpResult.Failed}. Any host may be called: from M2 ECore no longer checks the
 * manifest's {@code internet.hosts}, which only declare the default hosts and why (owner,
 * 2026-10-18; CR-0013, ADR-0030), but never one taken from a browser request, a message or an
 * object's data (ADR-0030; owner, 2026-10-19). Every function must still work offline.
 *
 * <pre>{@code
 * context.http().send(HttpCall.get(uri).header("User-Agent", "emc2/0.1 (+basemap-osm)"),
 *     Duration.ofSeconds(5), self, result -> new TileMsg.Fetched(key, result));
 * }</pre>
 */
public interface OutboundHttp {

  /** The default response body limit, 10 MiB; from SDK 1.6.0 a call may ask for up to {@link HttpCall#MAX_RESPONSE_BYTES}. */
  int MAX_BODY_BYTES = 10 * 1024 * 1024;

  int MAX_CONCURRENT_CALLS = 16;

  /** Starts the call and returns at once. Exactly one result message arrives later. */
  <M extends Message> void send(HttpCall call, Duration timeout, WorkerRef<M> target, Function<HttpResult, ? extends M> toMessage);
}
