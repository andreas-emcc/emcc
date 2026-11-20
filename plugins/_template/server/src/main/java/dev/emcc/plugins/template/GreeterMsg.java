package dev.emcc.plugins.template;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.http.EndpointRequest;

/** The messages of the greeter worker: one sealed interface per worker, one record per message. */
sealed interface GreeterMsg extends Message {

  /** A request to {@code GET /api/plugins/template/greeting}. */
  record Greet(EndpointRequest request) implements GreeterMsg {}
}
