package dev.emcc.itatest.limits;

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
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.Reply;
import dev.emcc.sdk.worker.ReplyTo;
import dev.emcc.sdk.worker.WorkerContext;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Duration;

/**
 * A test-only plugin of the ITA (tests/integration/README.md, "Test plugins"). It breaks the plugin
 * rules on purpose (a handler that sleeps or spins) so that the integration tests can check how
 * ECore contains a misbehaving plugin: the watchdog and the caps of CR-0005. Compiled by the tests
 * with javac against the SDK jar, installed only into test servers, never shipped.
 *
 * <p>Endpoints (GET, under /api/plugins/ita-limits/):
 * <ul>
 *   <li>{@code /ping}: answered at once by its own worker;
 *   <li>{@code /sleep?ms=}: blocks the handler (worker budget 1 s, not restartable);
 *   <li>{@code /sleep-restartable?ms=}: the same in a restartable worker (endpoint timeout 3 s);
 *       {@code /restartable-ping} is answered by that worker;
 *   <li>{@code /spin?ms=}: busy-loops the handler (CPU-bound, worker budget 1 s);
 *   <li>{@code /asks?n=}: makes n asks that are never answered (timeout 60 s); {@code /asks-result}
 *       tells how many came back as Failed, and their reasons;
 *   <li>{@code /timers?n=}: creates n timers of 10 minutes, catching the refusal; answers how many
 *       were created and the refusal's message;
 *   <li>{@code /timers-uncaught?n=}: the same without catching (the handler throws);
 *   <li>{@code /settings}: the settings as the plugin's worker has them now (SDK v1: delivered
 *       without a restart through {@code subscribeSettings}), and how many changes it got.
 * </ul>
 */
public final class LimitsPlugin implements Plugin {

  private PluginContext context;

  @Override
  public void init(PluginContext context) {
    this.context = context;
    Duration oneSecond = Duration.ofSeconds(1);
    Duration short_ = Duration.ofSeconds(3);
    WorkerRef<Msg> pinger = context.workers().spawn(WorkerSpec.of("pinger", Msg.class, Worker::new));
    WorkerRef<Msg> sleeper = context.workers().spawn(WorkerSpec.of("sleeper", Msg.class, Worker::new).budget(oneSecond));
    WorkerRef<Msg> restartable =
        context.workers().spawn(WorkerSpec.of("restartable", Msg.class, Worker::new).budget(oneSecond).restartable(true));
    WorkerRef<Msg> spinner = context.workers().spawn(WorkerSpec.of("spinner", Msg.class, Worker::new).budget(oneSecond));
    WorkerRef<Msg> silent = context.workers().spawn(WorkerSpec.of("silent", Msg.class, Worker::new));
    WorkerRef<Msg> asker = context.workers().spawn(WorkerSpec.of("asker", Msg.class, () -> new Worker(silent)));
    WorkerRef<Msg> timekeeper = context.workers().spawn(WorkerSpec.of("timekeeper", Msg.class, () -> new Worker(context)));
    WorkerRef<Msg> settings = context.workers().spawn(WorkerSpec.of("settings", Msg.class, () -> new Worker(context)));
    context.subscribeSettings(settings, Msg.SettingsChanged::new);

    context.endpoints().register(Endpoint.get("/ping"), pinger, Msg.Ping::new);
    context.endpoints().register(Endpoint.get("/sleep").timeout(Duration.ofSeconds(30)), sleeper, Msg.Sleep::new);
    // A hung message is not delivered again, so this request is answered only by the timeout.
    context.endpoints().register(Endpoint.get("/sleep-restartable").timeout(short_), restartable, Msg.Sleep::new);
    context.endpoints().register(Endpoint.get("/restartable-ping"), restartable, Msg.Ping::new);
    context.endpoints().register(Endpoint.get("/spin").timeout(Duration.ofSeconds(30)), spinner, Msg.Spin::new);
    context.endpoints().register(Endpoint.get("/asks"), asker, Msg.Asks::new);
    context.endpoints().register(Endpoint.get("/asks-result"), asker, Msg.AsksResult::new);
    context.endpoints().register(Endpoint.get("/timers"), timekeeper, Msg.Timers::new);
    context.endpoints().register(Endpoint.get("/timers-uncaught").timeout(short_), timekeeper, Msg.TimersUncaught::new);
    context.endpoints().register(Endpoint.get("/settings"), settings, Msg.Settings::new);
  }

  @Override
  public void start() {
    long inStart = context.settings().getNumber("timersInStart").longValueExact();
    WorkerRef<Msg> self = context.workers().spawn(WorkerSpec.of("start-timers", Msg.class, Worker::new));
    for (long i = 0; i < inStart; i++) {
      context.timers().once(Duration.ofMinutes(10), self, new Msg.Tick());
    }
    context.status().set(PluginState.OK, "ITA limits test plugin");
  }

  @Override
  public void stop() {}

  /** The messages of every worker of this plugin. */
  sealed interface Msg extends Message {
    record Ping(EndpointRequest request) implements Msg {}

    record Sleep(EndpointRequest request) implements Msg {}

    record Spin(EndpointRequest request) implements Msg {}

    record Asks(EndpointRequest request) implements Msg {}

    record AsksResult(EndpointRequest request) implements Msg {}

    record Timers(EndpointRequest request) implements Msg {}

    record TimersUncaught(EndpointRequest request) implements Msg {}

    record Tick() implements Msg {}

    record Settings(EndpointRequest request) implements Msg {}

    record SettingsChanged(JsonObject values) implements Msg {}

    record Question(ReplyTo<Answer> replyTo) implements Msg {}

    record Answer() implements Msg {}

    record Answered(Reply<Answer> reply) implements Msg {}
  }

  /** One handler class for all workers; each worker uses the messages it is sent. */
  static final class Worker implements Handler<Msg> {
    private final WorkerRef<Msg> askTarget;
    private final PluginContext plugin;
    private int failed;
    private final java.util.TreeMap<String, Integer> reasons = new java.util.TreeMap<>();
    private JsonObject settings;
    private int settingsChanges;

    Worker() {
      this(null, null);
    }

    Worker(WorkerRef<Msg> askTarget) {
      this(askTarget, null);
    }

    Worker(PluginContext plugin) {
      this(null, plugin);
    }

    private Worker(WorkerRef<Msg> askTarget, PluginContext plugin) {
      this.askTarget = askTarget;
      this.plugin = plugin;
      this.settings = plugin == null ? JsonObject.empty() : plugin.settings();
    }

    @Override
    public void handle(Msg message, WorkerContext<Msg> context) {
      switch (message) {
        case Msg.Ping p -> respond(p.request(), "pong");
        case Msg.Sleep s -> {
          long ms = number(s.request(), "ms");
          try {
            Thread.sleep(ms); // breaks rule C6 on purpose: the watchdog must catch it
            respond(s.request(), "slept " + ms);
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            respond(s.request(), "interrupted");
          }
        }
        case Msg.Spin s -> {
          long until = System.nanoTime() + number(s.request(), "ms") * 1_000_000;
          long spins = 0;
          while (System.nanoTime() < until) {
            spins++; // breaks rule C7 on purpose: CPU-bound in a worker, which is not preempted
          }
          respond(s.request(), "spun " + spins);
        }
        case Msg.Asks a -> {
          long n = number(a.request(), "n");
          for (long i = 0; i < n; i++) {
            context.ask(askTarget, Msg.Question::new, Duration.ofSeconds(60), Msg.Answered::new);
          }
          respond(a.request(), "asked " + n);
        }
        case Msg.AsksResult r -> respond(r.request(), "{\"failed\":" + failed + ",\"reasons\":" + json(reasons) + "}");
        case Msg.Answered answered -> {
          if (answered.reply() instanceof Reply.Failed<Msg.Answer> f) {
            failed++;
            reasons.merge(f.reason(), 1, Integer::sum);
          }
        }
        case Msg.Question q -> {
          // Never answered: the ask stays outstanding until its timeout.
        }
        case Msg.Timers t -> {
          long n = number(t.request(), "n");
          int created = 0;
          String refusal = "";
          try {
            for (long i = 0; i < n; i++) {
              plugin.timers().once(Duration.ofMinutes(10), context.self(), new Msg.Tick());
              created++;
            }
          } catch (IllegalStateException e) {
            refusal = e.getMessage();
          }
          respond(t.request(), "{\"created\":" + created + ",\"refusal\":\"" + refusal.replace("\"", "'") + "\"}");
        }
        case Msg.TimersUncaught t -> {
          long n = number(t.request(), "n");
          for (long i = 0; i < n; i++) {
            plugin.timers().once(Duration.ofMinutes(10), context.self(), new Msg.Tick());
          }
          respond(t.request(), "created " + n);
        }
        case Msg.Settings r -> respond(r.request(), "{\"changes\":" + settingsChanges + ",\"note\":\""
            + settings.getString("note").replace("\"", "'") + "\",\"timersInStart\":" + settings.getNumber("timersInStart").longValueExact() + "}");
        case Msg.SettingsChanged changed -> {
          settings = changed.values();
          settingsChanges++;
        }
        case Msg.Tick tick -> {}
        case Msg.Answer answer -> {}
      }
    }

    private static long number(EndpointRequest request, String name) {
      String value = request.queryParameter(name);
      return value == null ? 0 : Long.parseLong(value);
    }

    private static void respond(EndpointRequest request, String body) {
      request.response().respond(HttpReply.of(200, Headers.of("Content-Type", "text/plain; charset=utf-8"), Bytes.utf8(body)));
    }

    private static String json(java.util.Map<String, Integer> map) {
      StringBuilder out = new StringBuilder("{");
      map.forEach((key, value) -> out.append(out.length() > 1 ? "," : "").append('"').append(key.replace("\"", "'")).append("\":").append(value));
      return out.append('}').toString();
    }
  }
}
