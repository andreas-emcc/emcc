package dev.emcc.app.testplugin;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.stream.StreamRef;
import dev.emcc.sdk.stream.StreamSpec;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.util.List;
import java.util.Objects;

/**
 * A plugin for the edge's tests, packed into a jar at test time. {@code GET /echo/{word}} answers
 * with the word, the query parameter {@code x} and the {@code X-Test} header; {@code GET
 * /teapot} answers 418. SDK 1.2.0: {@code POST /commands/{name}} (needs {@link #RUN}, at most
 * {@link #MAX_BODY} bytes) answers 202 with the name, the query parameter {@code x} and the body;
 * {@code GET /posted} answers how many POSTs the worker has been given. SDK 1.6.0: the service
 * endpoint {@code POST /soap/{link}} (at {@code /api/services/echo/...}, {@code text/xml} as a raw
 * body) answers 200 with its link, the caller's kind and user, and the body as sent. SDK 1.8.0
 * (T-208): the stream {@code feed} (needs {@code plugin.echo.view}, header {@code H}), fed by {@code
 * POST /feed?start=true|false} (needs {@link #RUN}) with a JSON string, answered 204, or 409 when the write was not
 * accepted.
 */
public final class EchoPlugin implements Plugin {

  public static final String RUN = "plugin.echo.run";
  public static final int MAX_BODY = 64;

  /** A request as the worker's message. */
  public record Request(EndpointRequest request) implements Message {}

  @Override
  public void init(PluginContext context) {
    StreamRef feed = context.streams().open(StreamSpec.of("feed", "video/mp2t", "plugin.echo.view", context.defaultLabel()));
    feed.header(Bytes.utf8("H"));
    WorkerRef<Request> echo = context.workers().spawn(WorkerSpec.of("echo", Request.class, () -> {
      int[] posted = {0}; // the worker's own state
      return (message, ctx) -> {
        EndpointRequest r = message.request();
        if (r.path().equals("/teapot")) {
          r.response().respond(HttpReply.status(418));
          return;
        }
        if (r.path().equals("/posted")) {
          r.response().respond(HttpReply.of(200, Headers.of("Content-Type", "text/plain"), Bytes.utf8(String.valueOf(posted[0]))));
          return;
        }
        if (r.path().startsWith("/soap/")) {
          Bytes raw = Objects.requireNonNull(r.rawBody());
          r.response().respond(HttpReply.of(200, Headers.of("Content-Type", "text/plain; charset=utf-8"),
              Bytes.utf8(r.pathParameter("link") + " " + r.caller().kind() + " " + r.user().id() + " " + raw.toUtf8())));
          return;
        }
        if (r.path().equals("/feed")) {
          String text = ((JsonString) Objects.requireNonNull(r.body())).value();
          SendResult sent = feed.write(Bytes.utf8(text), "true".equals(r.queryParameter("start")));
          r.response().respond(HttpReply.status(sent == SendResult.ACCEPTED ? 204 : 409));
          return;
        }
        if (r.method().equals("POST")) {
          posted[0]++;
          String x = r.queryParameter("x");
          r.response().respond(HttpReply.json(202, new JsonArray(List.of(
              JsonString.of(r.pathParameter("name")), JsonString.of(x == null ? "" : x), Objects.requireNonNull(r.body())))));
          return;
        }
        String text = r.pathParameter("word") + " x=" + r.queryParameter("x") + " header=" + r.headers().first("x-test");
        r.response().respond(HttpReply.of(200, Headers.of("Content-Type", "text/plain; charset=utf-8").with("X-Echo", "yes"),
            Bytes.utf8(text)));
      };
    }));
    context.endpoints().register(Endpoint.get("/echo/{word}"), echo, Request::new);
    context.endpoints().register(Endpoint.get("/teapot"), echo, Request::new);
    context.endpoints().register(Endpoint.post("/commands/{name}").requires(RUN).maxBody(MAX_BODY), echo, Request::new);
    context.endpoints().register(Endpoint.get("/posted"), echo, Request::new);
    context.endpoints().register(Endpoint.post("/feed").requires(RUN), echo, Request::new);
    context.endpoints().register(Endpoint.service("POST", "/soap/{link}").accepts("text/xml"), echo, Request::new);
  }

  @Override
  public void start() {}

  @Override
  public void stop() {}
}
