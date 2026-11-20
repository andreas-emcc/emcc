package dev.emcc.ecore.plugin.testplugin;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.UserTime;
import dev.emcc.sdk.capability.SessionTimeChange;
import dev.emcc.sdk.capability.Temporal;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.WorkerContext;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.util.ArrayList;
import java.util.List;

/**
 * A temporal plugin for the plugin host's tests (SDK 1.4.0, ADR-0045): it records each session's
 * time as ECore delivers it, answers {@code GET /changes} with them (one line each: session, user,
 * time) and {@code GET /time} with the request's {@code userTime()}. The setting {@code mode}
 * {@code delivery-throws} makes {@code timeDelivery()} throw, {@code mapper-throws} its mapper.
 */
public final class TemporalPlugin implements Plugin, Temporal {

  /** The worker's messages. */
  public sealed interface Msg extends Message {
    record Changed(SessionTimeChange change) implements Msg {}

    record Asked(EndpointRequest request) implements Msg {}
  }

  private WorkerRef<Msg> worker;
  private String mode = "ok";

  @Override
  public void init(PluginContext context) {
    mode = context.settings().has("mode") ? context.settings().getString("mode") : "ok";
    worker = context.workers().spawn(WorkerSpec.of("times", Msg.class, Recorder::new));
    context.endpoints().register(Endpoint.get("/changes"), worker, Msg.Asked::new);
    context.endpoints().register(Endpoint.get("/time"), worker, Msg.Asked::new);
  }

  @Override
  public Delivery<?> timeDelivery() {
    if (mode.equals("delivery-throws")) {
      throw new IllegalStateException("timeDelivery fails on purpose");
    }
    if (mode.equals("mapper-throws")) {
      return Temporal.deliver(worker, change -> {
        throw new IllegalStateException("the mapper fails on purpose");
      });
    }
    return Temporal.deliver(worker, Msg.Changed::new);
  }

  @Override
  public void start() {}

  @Override
  public void stop() {}

  /** A time as text (CR-0032): the set time ({@code now} or the instant), then {@code from/to} when an interval is set. */
  public static String text(UserTime time) {
    UserTime.Interval i = time.interval();
    return (time.time() == null ? "now" : time.time().toString()) + (i == null ? "" : " " + i.from() + "/" + i.to());
  }

  private static final class Recorder implements Handler<Msg> {
    private final List<String> changes = new ArrayList<>();

    @Override
    public void handle(Msg message, WorkerContext<Msg> ctx) {
      switch (message) {
        case Msg.Changed c -> changes.add(c.change().session() + " " + c.change().user().id() + " " + text(c.change().time()));
        case Msg.Asked a -> {
          String answer = a.request().path().equals("/time") ? text(a.request().userTime()) : String.join("\n", changes);
          a.request().response().respond(HttpReply.of(200, Headers.of("Content-Type", "text/plain"), Bytes.utf8(answer)));
        }
      }
    }
  }
}
