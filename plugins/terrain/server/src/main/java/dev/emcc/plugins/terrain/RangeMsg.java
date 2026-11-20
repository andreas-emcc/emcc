package dev.emcc.plugins.terrain;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.http.EndpointRequest;

/** The messages of the {@code range} worker. */
sealed interface RangeMsg extends Message {

  /** {@code POST /range}. */
  record Range(EndpointRequest request) implements RangeMsg {}
}
