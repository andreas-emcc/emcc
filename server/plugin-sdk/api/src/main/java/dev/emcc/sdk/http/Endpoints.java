package dev.emcc.sdk.http;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.worker.WorkerRef;
import java.util.function.Function;

/**
 * Registers the plugin's HTTP endpoints, served under {@code /api/plugins/{pluginId}/}. Register
 * in {@link dev.emcc.sdk.Plugin#init}.
 *
 * <p>Each request arrives at {@code worker} as the message that {@code toMessage} makes from the
 * {@link EndpointRequest} (plugin code: pure, non-blocking, run inside the worker). The worker
 * answers through the request's {@link ResponseHandle}, possibly later from another handler call.
 * Without an answer within the endpoint's timeout ECore sends {@code 504}; a request that the
 * mailbox refuses or later evicts gets {@code 503} at once. ECore never repeats a request, so a
 * command that must not run twice is made idempotent.
 *
 * <pre>{@code
 * context.endpoints().register(Endpoint.get("/tiles/{z}/{x}/{y}.png"), tiles, TileMsg.Get::new);
 * context.endpoints().register(
 *     Endpoint.post("/routes/{id}/start").requires("plugin.simulator.run"), engine, EngineMsg.Command::new);
 * }</pre>
 *
 * <p><b>What ECore answers itself</b> (SDK 1.2.0, CR-0026), in this order, before the request
 * reaches the worker:
 *
 * <ol>
 *   <li>{@code 404} when no endpoint's template matches the path;
 *   <li>{@code 405} when templates match but none for the request's method, with {@code Allow}
 *       naming the methods registered for that path, in alphabetical order and separated by
 *       {@code ", "} (for example {@code GET, POST}). A {@code HEAD} is a {@code GET} without a
 *       body, so a {@code HEAD} to a {@code POST}-only path gets {@code 405} with {@code Allow:
 *       POST};
 *   <li>{@code 403} when the user lacks the endpoint's permission;
 *   <li>for {@code POST}, in this order:
 *       <ul>
 *         <li>{@code 415} unless {@code Content-Type} is {@code application/json}, with at most a
 *             {@code charset} parameter whose value is {@code utf-8}. Case is ignored in the type,
 *             the parameter's name and its value, and the value may be quoted. Any other
 *             parameter, a second one, or an empty one ({@code application/json;}), gets
 *             {@code 415};
 *         <li>{@code 413} for a body longer than the endpoint's {@link Endpoint#maxBody}, decided
 *             by its length before it is parsed;
 *         <li>{@code 400} unless the body is exactly one JSON value in strict UTF-8 (RFC 8259)
 *             with no byte order mark, no duplicate member names, and nesting no deeper than
 *             {@link Endpoint#MAX_BODY_DEPTH}. Such a body never gets {@code 500}.
 *       </ul>
 * </ol>
 *
 * <p>A {@code POST} request carries the parsed body in {@link EndpointRequest#body()}, with
 * numbers exactly as written.
 */
public interface Endpoints {

  /**
   * Fails if a registered endpoint of this plugin has the same method and template, or (SDK 1.2.0)
   * if a {@code POST} endpoint names no permission: a command every logged-in user may send is
   * almost never meant.
   */
  <M extends Message> void register(Endpoint endpoint, WorkerRef<M> worker, Function<EndpointRequest, ? extends M> toMessage);
}
