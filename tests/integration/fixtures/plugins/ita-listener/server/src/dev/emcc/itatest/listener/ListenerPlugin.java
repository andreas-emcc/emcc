package dev.emcc.itatest.listener;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.listener.Backoff;
import dev.emcc.sdk.listener.Listener;
import dev.emcc.sdk.listener.ListenerConnection;
import dev.emcc.sdk.listener.ListenerContext;
import dev.emcc.sdk.listener.ListenerEvent;
import dev.emcc.sdk.listener.ListenerSpec;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.WorkerContext;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * A test-only plugin of the ITA (tests/integration/README.md, "Test plugins"): a minimal client of
 * the TAK test double through an SDK v1 listener, so that the double, the certificates made at test
 * time and ECore's listeners are checked together before the cot plugin exists. It writes one
 * presence event per connection and counts the CoT events it reads (by their end tags). Compiled by
 * the tests with javac against the SDK jar, installed only into test servers, never shipped.
 *
 * <p>Endpoint (GET, under /api/plugins/ita-listener/): {@code /received}: connects, disconnects,
 * the last disconnect reason, events and bytes read, as JSON.
 */
public final class ListenerPlugin implements Plugin {

  static final String PRESENCE = "<event version=\"2.0\" uid=\"ita-listener\" type=\"t-x-c-t\" how=\"h-g-i-g-o\""
      + " time=\"2026-10-12T00:00:00Z\" start=\"2026-10-12T00:00:00Z\" stale=\"2026-10-12T00:05:00Z\">"
      + "<point lat=\"0.25\" lon=\"0.5\" hae=\"9999999.0\" ce=\"9999999.0\" le=\"9999999.0\"/><detail/></event>";

  private PluginContext context;
  private WorkerRef<Msg> counter;

  @Override
  public void init(PluginContext context) {
    this.context = context;
    counter = context.workers().spawn(WorkerSpec.of("counter", Msg.class, Counter::new));
    context.endpoints().register(Endpoint.get("/received"), counter, Msg.Received::new);
  }

  @Override
  public void start() {
    JsonObject settings = context.settings();
    JsonObject stream = settings.getObject("stream");
    String host = stream.getString("host");
    int port = Math.toIntExact(stream.getNumber("port").longValueExact());
    if (port > 0) {
      ListenerSpec spec = settings.getString("transport").equals("tls")
          ? ListenerSpec.tls("tak", host, port, settings.getString("credentials"))
          : ListenerSpec.tcp("tak", host, port);
      WorkerRef<Msg> target = counter;
      context.listeners().start(
          spec.reconnect(Backoff.exponential(Duration.ofMillis(100), Duration.ofSeconds(1))), () -> new Reader(target), counter, Msg.Event::new);
    }
    context.status().set(PluginState.OK, port > 0 ? "listening to " + host + ":" + port : "no stream");
  }

  @Override
  public void stop() {}

  sealed interface Msg extends Message {
    record Received(EndpointRequest request) implements Msg {}

    record Read(int events, int bytes) implements Msg {}

    record Event(ListenerEvent event) implements Msg {}
  }

  /** The listener's loop: one presence event, then counts end tags as they arrive. */
  static final class Reader implements Listener {
    private final WorkerRef<Msg> counter;

    Reader(WorkerRef<Msg> counter) {
      this.counter = counter;
    }

    @Override
    public void run(ListenerConnection connection, ListenerContext context) throws IOException {
      connection.write(Bytes.utf8(PRESENCE));
      InputStream in = connection.input();
      byte[] buffer = new byte[8192];
      String tail = "";
      for (int n; (n = in.read(buffer)) >= 0; ) {
        String text = tail + new String(buffer, 0, n, StandardCharsets.ISO_8859_1);
        int events = 0;
        for (int at = text.indexOf("</event>"); at >= 0; at = text.indexOf("</event>", at + 1)) {
          events++;
        }
        // Shorter than the end tag, so no tag is counted twice.
        tail = text.substring(Math.max(0, text.length() - 7));
        context.send(counter, new Msg.Read(events, n));
      }
    }
  }

  static final class Counter implements Handler<Msg> {
    private int connects;
    private int disconnects;
    private String lastReason = "";
    private long events;
    private long bytes;

    @Override
    public void handle(Msg message, WorkerContext<Msg> context) {
      switch (message) {
        case Msg.Read r -> {
          events += r.events();
          bytes += r.bytes();
        }
        case Msg.Event e -> {
          switch (e.event()) {
            case ListenerEvent.Connected c -> connects++;
            case ListenerEvent.Disconnected d -> {
              disconnects++;
              lastReason = d.reason();
            }
          }
        }
        case Msg.Received r -> r.request().response().respond(HttpReply.of(200, Headers.of("Content-Type", "application/json"),
            Bytes.utf8("{\"connects\":" + connects + ",\"disconnects\":" + disconnects + ",\"lastReason\":\""
                + lastReason.replace("\\", "/").replace("\"", "'") + "\",\"events\":" + events + ",\"bytes\":" + bytes + "}")));
      }
    }
  }
}
