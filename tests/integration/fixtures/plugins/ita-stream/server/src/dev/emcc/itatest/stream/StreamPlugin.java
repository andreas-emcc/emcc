package dev.emcc.itatest.stream;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.stream.StreamRef;
import dev.emcc.sdk.stream.StreamSpec;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerContext;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

/**
 * A test-only plugin of the ITA (tests/integration/README.md, "Test plugins") for SDK 1.8.0's
 * streams to the web part (CR-0044 E1, T-208). Compiled by the tests with javac against the SDK
 * jar, installed only into test servers, never shipped.
 *
 * <p>Two streams, both needing {@code plugin.ita-stream.view}: {@code feed} ({@code video/mp2t})
 * and {@code other} ({@code application/octet-stream}). Endpoints (GET, under
 * /api/plugins/ita-stream/), each with {@code stream=feed|other}:
 * <ul>
 *   <li>{@code /write?fill=A&start=true&size=65536&count=1}: writes {@code count} chunks of {@code
 *       size} bytes, each the character {@code fill} repeated, the first a start point when {@code
 *       start} is true; answers {@code accepted dropped closed} as counted;
 *   <li>{@code /header?text=}: sets the stream's header;
 *   <li>{@code /close}: closes the stream; {@code /open}: opens it again;
 *   <li>{@code /viewers}: the stream's viewers now.
 * </ul>
 */
public final class StreamPlugin implements Plugin {

  static final String VIEW = "plugin.ita-stream.view";

  /** A request as the worker's message. */
  public record Request(EndpointRequest request) implements Message {}

  private PluginContext context;

  @Override
  public void init(PluginContext context) {
    this.context = context;
    WorkerRef<Request> streams = context.workers().spawn(WorkerSpec.of("streams", Request.class, () -> new Worker(context)));
    for (String path : new String[] {"/write", "/header", "/close", "/open", "/viewers"}) {
      context.endpoints().register(Endpoint.get(path), streams, Request::new);
    }
  }

  @Override
  public void start() {
    context.status().set(PluginState.OK, "ITA stream test plugin");
  }

  @Override
  public void stop() {}

  /** Keeps the streams; its own state only. */
  static final class Worker implements Handler<Request> {
    private final PluginContext plugin;
    private final Map<String, StreamRef> open = new HashMap<>();

    Worker(PluginContext plugin) {
      this.plugin = plugin;
      for (String name : new String[] {"feed", "other"}) open(name);
    }

    private void open(String name) {
      String type = name.equals("feed") ? "video/mp2t" : "application/octet-stream";
      open.put(name, plugin.streams().open(StreamSpec.of(name, type, VIEW, plugin.defaultLabel())));
    }

    @Override
    public void handle(Request message, WorkerContext ctx) {
      EndpointRequest r = message.request();
      String name = r.queryParameter("stream") == null ? "feed" : r.queryParameter("stream");
      StreamRef stream = open.get(name);
      String answer;
      switch (r.path()) {
        case "/write" -> {
          char fill = r.queryParameter("fill") == null ? 'x' : r.queryParameter("fill").charAt(0);
          int size = Integer.parseInt(value(r, "size", "1"));
          int count = Integer.parseInt(value(r, "count", "1"));
          boolean start = "true".equals(r.queryParameter("start"));
          byte[] chunk = new byte[size];
          Arrays.fill(chunk, (byte) fill);
          int accepted = 0;
          int dropped = 0;
          int closed = 0;
          for (int i = 0; i < count; i++) {
            SendResult sent = stream.write(Bytes.of(chunk), start && i == 0);
            if (sent == SendResult.ACCEPTED) accepted++;
            else if (sent == SendResult.DROPPED) dropped++;
            else closed++;
          }
          answer = accepted + " " + dropped + " " + closed;
        }
        case "/header" -> {
          stream.header(Bytes.utf8(value(r, "text", "")));
          answer = "ok";
        }
        case "/close" -> {
          stream.close();
          answer = "closed";
        }
        case "/open" -> {
          open(name);
          answer = "opened";
        }
        default -> answer = String.valueOf(stream.viewers());
      }
      r.response().respond(HttpReply.of(200, Headers.of("Content-Type", "text/plain"), Bytes.utf8(answer)));
    }

    private static String value(EndpointRequest r, String name, String otherwise) {
      String v = r.queryParameter(name);
      return v == null ? otherwise : v;
    }
  }
}
