package dev.emcc.plugins.template;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.WorkerContext;

/**
 * The greeter worker: answers the greeting endpoint. A handler handles one message at a time, so
 * its fields need no locks; it never blocks and never starts threads.
 */
final class Greeter implements Handler<GreeterMsg> {

  private final String greeting;
  private long answered; // worker state: touched only by this handler

  Greeter(String greeting) {
    this.greeting = greeting;
  }

  @Override
  public void handle(GreeterMsg message, WorkerContext<GreeterMsg> context) {
    switch (message) {
      case GreeterMsg.Greet greet -> {
        answered++;
        context.log().debug("greeting {} answered", answered);
        greet.request().response().respond(
            HttpReply.of(200, Headers.of("Content-Type", "text/plain; charset=utf-8"), Bytes.utf8(greeting)));
      }
    }
  }
}
