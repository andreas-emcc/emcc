package dev.emcc.itatest.compute;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.compute.ComputeContext;
import dev.emcc.sdk.compute.ComputeEvent;
import dev.emcc.sdk.compute.ComputeRef;
import dev.emcc.sdk.compute.ComputeSpec;
import dev.emcc.sdk.compute.ComputeTask;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.WorkerContext;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A test-only plugin of the ITA (tests/integration/README.md, "Test plugins"; M9 T4, ADR-0064). It starts compute
 * tasks of three kinds; one of them breaks the rules on purpose (it ignores its stop), so that the tests can see how
 * ECore contains it. Compiled by the tests with javac against the SDK jar, installed only into test servers, never
 * shipped.
 *
 * <p>Endpoints (GET, under /api/plugins/ita-compute/):
 * <ul>
 *   <li>{@code /start?name=&kind=spin|stubborn|echo}: starts a compute task; its events come to the control worker;
 *   <li>{@code /stop?name=}: stops it ({@code ComputeRef.stop});
 *   <li>{@code /post?name=&n=}: posts n pings to it; an echo task sends each back to the control worker;
 *   <li>{@code /events}: what the control worker got, as JSON: the events in order, the echoes and the posts' results;
 *   <li>{@code /ping}: answered at once by a worker of its own, to see the plugin's workers answer under load.
 * </ul>
 * Kinds: {@code spin} keeps a core busy until it is asked to stop ({@code stopping()}); {@code stubborn} keeps a core busy
 * and never looks at its stop; {@code echo} takes pings from its inbox and sends each back.
 */
public final class ComputePlugin implements Plugin {

  private PluginContext context;

  @Override
  public void init(PluginContext context) {
    this.context = context;
    WorkerRef<Msg> control = context.workers().spawn(WorkerSpec.of("control", Msg.class, () -> new Control(context)));
    WorkerRef<Msg> pinger = context.workers().spawn(WorkerSpec.of("pinger", Msg.class, Control::pinger));
    context.endpoints().register(Endpoint.get("/start"), control, Msg.Start::new);
    context.endpoints().register(Endpoint.get("/stop"), control, Msg.Stop::new);
    context.endpoints().register(Endpoint.get("/post"), control, Msg.Post::new);
    context.endpoints().register(Endpoint.get("/events"), control, Msg.Events::new);
    context.endpoints().register(Endpoint.get("/ping"), pinger, Msg.Ping::new);
  }

  @Override
  public void start() {
    context.status().set(PluginState.OK, "ITA compute test plugin");
  }

  @Override
  public void stop() {}

  /** The workers' messages. */
  sealed interface Msg extends Message {
    record Start(EndpointRequest request) implements Msg {}

    record Stop(EndpointRequest request) implements Msg {}

    record Post(EndpointRequest request) implements Msg {}

    record Events(EndpointRequest request) implements Msg {}

    record Ping(EndpointRequest request) implements Msg {}

    record Event(ComputeEvent event) implements Msg {}

    record Echoed(String task, long n) implements Msg {}
  }

  /** What a compute task's inbox takes. */
  record Item(long n) implements Message {}

  /** The control worker: holds the refs and what came back (its own state, touched by no one else). */
  static final class Control implements Handler<Msg> {
    private final PluginContext plugin;
    private final Map<String, ComputeRef<Item>> refs = new LinkedHashMap<>();
    private final List<String> events = new ArrayList<>();
    private final Map<String, Long> echoes = new LinkedHashMap<>();
    private final List<String> posts = new ArrayList<>();

    Control(PluginContext plugin) {
      this.plugin = plugin;
    }

    static Control pinger() {
      return new Control(null);
    }

    @Override
    public void handle(Msg message, WorkerContext<Msg> context) {
      switch (message) {
        case Msg.Ping p -> respond(p.request(), "pong");
        case Msg.Start s -> {
          String name = s.request().queryParameter("name");
          String kind = s.request().queryParameter("kind");
          WorkerRef<Msg> self = context.self();
          ComputeTask<Item> task = switch (kind) {
            case "spin" -> ComputePlugin::spin;
            case "stubborn" -> ComputePlugin::stubborn;
            case "echo" -> t -> echo(t, self);
            default -> throw new IllegalArgumentException("kind: " + kind);
          };
          ComputeRef<Item> ref = plugin.compute().start(ComputeSpec.of(name, Item.class), () -> task, self, Msg.Event::new);
          refs.put(name, ref);
          respond(s.request(), "{\"started\":\"" + name + "\"}");
        }
        case Msg.Stop s -> {
          String name = s.request().queryParameter("name");
          ComputeRef<Item> ref = refs.get(name);
          if (ref != null) {
            ref.stop();
          }
          respond(s.request(), "{\"stopped\":" + (ref != null) + "}");
        }
        case Msg.Post p -> {
          ComputeRef<Item> ref = refs.get(p.request().queryParameter("name"));
          long n = Long.parseLong(p.request().queryParameter("n"));
          for (long i = 0; i < n; i++) {
            posts.add(String.valueOf(ref.post(new Item(i))));
          }
          respond(p.request(), "{\"posted\":" + n + "}");
        }
        case Msg.Event e -> events.add(describe(e.event()));
        case Msg.Echoed e -> echoes.merge(e.task(), 1L, Long::sum);
        case Msg.Events e -> respond(e.request(), "{\"events\":" + strings(events) + ",\"echoes\":" + longs(echoes) + ",\"posts\":" + strings(posts) + "}");
      }
    }
  }

  /** Busy until asked to stop: one core held, the stop seen within a few ms. */
  private static void spin(ComputeContext<Item> task) {
    long x = 1;
    while (!task.stopping()) {
      for (int i = 0; i < 100_000; i++) {
        x = x * 6364136223846793005L + 1442695040888963407L;
      }
      task.count("rounds", 1);
    }
    task.detail("last", Long.toHexString(x));
  }

  /** Busy for ever, never looking at its stop: breaks ADR-0064 on purpose, so that ECore marks it hung. */
  private static void stubborn(ComputeContext<Item> task) {
    long x = 1;
    long rounds = 0;
    for (;;) {
      for (int i = 0; i < 100_000; i++) {
        x = x * 6364136223846793005L + 1442695040888963407L;
      }
      if (++rounds % 1_000 == 0) {
        task.detail("last", Long.toHexString(x)); // keeps x alive; never ends
      }
    }
  }

  /** Takes pings and sends each back to the control worker, until it is stopped. */
  private static void echo(ComputeContext<Item> task, WorkerRef<Msg> control) {
    for (Item item; (item = task.take()) != null; ) {
      task.send(control, new Msg.Echoed(task.self().name(), item.n()));
    }
  }

  private static String describe(ComputeEvent event) {
    return switch (event) {
      case ComputeEvent.Running r -> "Running " + r.task();
      case ComputeEvent.Restarting r -> "Restarting " + r.task();
      case ComputeEvent.Stopped s -> "Stopped " + s.task() + (s.reason() == null ? "" : ": " + s.reason());
      case ComputeEvent.Failed f -> "Failed " + f.task() + ": " + f.reason();
      case ComputeEvent.Refused r -> "Refused " + r.task() + " " + r.refusal();
      case ComputeEvent.Hung h -> "Hung " + h.task();
    };
  }

  private static void respond(EndpointRequest request, String body) {
    request.response().respond(HttpReply.of(200, Headers.of("Content-Type", "application/json"), Bytes.utf8(body)));
  }

  private static String strings(List<String> list) {
    StringBuilder out = new StringBuilder("[");
    for (String s : list) {
      out.append(out.length() > 1 ? "," : "").append('"').append(s.replace("\\", "\\\\").replace("\"", "'")).append('"');
    }
    return out.append(']').toString();
  }

  private static String longs(Map<String, Long> map) {
    StringBuilder out = new StringBuilder("{");
    map.forEach((k, v) -> out.append(out.length() > 1 ? "," : "").append('"').append(k).append("\":").append(v));
    return out.append('}').toString();
  }
}
