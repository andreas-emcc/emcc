package dev.emcc.sdk.http;

import dev.emcc.sdk.worker.HandleId;

/**
 * Where the answer to an endpoint request goes. An immutable value, equal by {@link #id()}, so it
 * can travel inside messages; the worker may answer from any later handler call. Answer once: a
 * second answer, or one after ECore already sent {@code 503} or {@code 504}, is ignored and
 * logged.
 *
 * <pre>{@code
 * pending.put(key, request.response());           // remember it
 * // ... later, when the tile has arrived:
 * pending.remove(key).respond(HttpReply.of(200, Headers.of("Content-Type", "image/png"), body));
 * }</pre>
 */
public interface ResponseHandle {

  HandleId id();

  void respond(HttpReply reply);
}
