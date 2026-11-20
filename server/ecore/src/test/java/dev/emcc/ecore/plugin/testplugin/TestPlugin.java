package dev.emcc.ecore.plugin.testplugin;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.PluginStatus;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.channel.ChannelRef;
import dev.emcc.sdk.channel.ChannelSpec;
import dev.emcc.sdk.connection.ConnectionSpec;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.listener.ListenerSpec;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.ObjectQuery;
import dev.emcc.sdk.store.QueryResult;
import dev.emcc.sdk.topic.Topic;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.WorkerContext;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * A plugin for the plugin host's tests, loaded from a jar in its own class loader. It uses only the
 * SDK. The setting {@code mode} makes it fail on purpose: {@code init-throws}, {@code init-hangs},
 * {@code start-throws}, {@code init-timers} and {@code start-timers} (sets three timers, more than
 * the plugin host allows in its test); {@code listen} opens a listener named {@code tak} to the first
 * of its settings' {@code servers} (its manifest must name {@code /servers} as a network endpoint),
 * reading until the peer closes; {@code move} answers {@code GET /move} by moving a track without
 * saving it (SDK 1.2.0, {@link Mover}); anything else works. It reports {@code started <id>} and {@code stopped
 * <id>} on the topic {@code <id>.events}, and answers {@code GET /info/{what}}. It follows its
 * settings and reports {@code settings <mode>} for each change it gets.
 */
public final class TestPlugin implements Plugin {

  /** An endpoint request as the info worker's message. */
  public record Request(EndpointRequest request) implements Message {}

  /** New settings, as the follower worker's message. */
  public record Changed(JsonObject settings) implements Message {}

  private PluginContext context;

  @Override
  public void init(PluginContext ctx) {
    this.context = ctx;
    switch (mode(ctx.settings())) {
      case "init-throws" -> throw new IllegalStateException("init fails on purpose");
      case "init-hangs" -> {
        try {
          Thread.sleep(60_000);
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
        }
      }
      case "init-timers" -> threeTimers(ctx);
      default -> {}
    }
    String id = ctx.pluginId();
    JsonObject settings = ctx.settings();
    WorkerRef<Request> info = ctx.workers().spawn(WorkerSpec.of("info", Request.class, () -> new Info(id, settings, ctx)));
    WorkerRef<Changed> follower = ctx.workers().spawn(WorkerSpec.of("follower", Changed.class,
        () -> (changed, c) -> report("settings " + mode(changed.settings()))));
    ctx.subscribeSettings(follower, Changed::new);
    ctx.endpoints().register(Endpoint.get("/info/{what}"), info, Request::new);
    if (mode(settings).equals("move")) {
      WorkerRef<Step> mover = ctx.workers().spawn(WorkerSpec.of("mover", Step.class, () -> new Mover(ctx)));
      ctx.endpoints().register(Endpoint.get("/move"), mover, Step.Go::new);
    }
  }

  @Override
  public void start() {
    if (mode(context.settings()).equals("start-throws")) {
      throw new IllegalStateException("start fails on purpose");
    }
    if (mode(context.settings()).equals("start-timers")) {
      threeTimers(context);
    }
    if (mode(context.settings()).equals("listen")) {
      JsonObject server = (JsonObject) ((JsonArray) context.settings().get("servers")).get(0);
      context.listeners().start(ListenerSpec.tcp("tak", server.getString("host"), (int) server.getNumber("port").longValueExact()),
          () -> (connection, ctx) -> connection.input().transferTo(OutputStream.nullOutputStream()));
    }
    if (mode(context.settings()).equals("connect")) {
      connect(context, (int) context.settings().getNumber("port").longValueExact());
    }
    if (mode(context.settings()).equals("channel")) {
      channel(context);
    }
    report("started");
  }

  private static final Duration STORE_TIMEOUT = Duration.ofSeconds(10);
  /** How often {@link Mover} moves its track without saving it. */
  public static final int MOVES = 3;

  /** The mover's messages: {@code GET /move}, then the answers of the store. */
  public sealed interface Step extends Message {
    record Go(EndpointRequest request) implements Step {}

    record Layers(QueryResult result) implements Step {}

    record Created(ChangeOutcome outcome) implements Step {}

    record Moved(ChangeOutcome outcome) implements Step {}

    record Edited(ChangeOutcome outcome) implements Step {}
  }

  /**
   * SDK 1.2.0 (ADR-0041), on {@code GET /move}: creates a track at 15.1, 60.2 in the first layer, saved; moves it {@link
   * #MOVES} times 0.01 east, not saved; then tries a change of its symbol code (hostile), not saved. Reports {@code track
   * <id>}, {@code moved <version>} for each move and {@code edit <code>: <message>} at the end.
   */
  private static final class Mover implements Handler<Step> {
    private final PluginContext context;
    private int moves;

    Mover(PluginContext context) {
      this.context = context;
    }

    @Override
    public void handle(Step step, WorkerContext<Step> ctx) {
      switch (step) {
        case Step.Go(EndpointRequest request) -> {
          request.response().respond(HttpReply.of(202, Headers.empty(), Bytes.utf8("")));
          context.store().query(ObjectQuery.all(), STORE_TIMEOUT, ctx.self(), Step.Layers::new);
        }
        case Step.Layers(QueryResult.Found found) -> {
          MapObjectContent content = new MapObjectContent(MapObjectContent.SYMBOL, MapObjectContent.GENERAL, "sim", null,
              found.layers().getFirst().id(), new Geometry.Point(Position.of(15.1, 60.2)),
              new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null), null, null, SecurityLabel.of("NATO", "UNCLASSIFIED"),
              Extensions.empty());
          context.store().submit(Change.createObject(UUID.randomUUID(), content), STORE_TIMEOUT, ctx.self(), Step.Created::new);
        }
        case Step.Created(ChangeOutcome.Applied applied) -> {
          report(context, "track " + applied.event().entityId());
          move((MapObject) applied.event().state(), ctx);
        }
        case Step.Moved(ChangeOutcome.Applied applied) -> {
          MapObject track = (MapObject) applied.event().state();
          report(context, "moved " + track.version());
          if (moves < MOVES) {
            move(track, ctx);
          } else {
            MapObjectContent c = track.content();
            MapObjectContent edited = new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(), c.geometry(),
                new Symbol(SymbolStandard.APP_6D, "10061000001211000000", null), c.style(), c.properties(), c.label(), c.extensions());
            context.store().submit(Change.updateObject(track, edited).notSaved(), STORE_TIMEOUT, ctx.self(), Step.Edited::new);
          }
        }
        case Step.Edited(ChangeOutcome.Rejected rejected) ->
            report(context, "edit " + rejected.rejection().code() + ": " + rejected.rejection().message());
        default -> report(context, "unexpected " + step.getClass().getSimpleName());
      }
    }

    private void move(MapObject track, WorkerContext<Step> ctx) {
      moves++;
      MapObjectContent c = track.content();
      MapObjectContent moved = new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(),
          new Geometry.Point(Position.of(15.1 + moves * 0.01, 60.2)), c.symbol(), c.style(), c.properties(), c.label(), c.extensions());
      context.store().submit(Change.updateObject(track, moved).notSaved(), STORE_TIMEOUT, ctx.self(), Step.Moved::new);
    }
  }

  /**
   * SDK 1.2.0: offers a channel for the link {@code loop} and sends itself a removal through it; its
   * worker reports the item it gets. Also reports the configured classifications.
   */
  private void channel(PluginContext ctx) {
    WorkerRef<PluginStatus> reporter = ctx.workers().spawn(
        WorkerSpec.of("reporter", PluginStatus.class, () -> (status, c) -> report(status.detail())));
    ChannelRef loop = ctx.channels().offer(ChannelSpec.of("loop", "Loop", "test"), reporter, item -> new PluginStatus(PluginState.OK,
        "item " + item.getClass().getSimpleName() + " on " + Thread.currentThread().getContextClassLoader().getName()));
    ctx.channels().send(loop.id(), new ChannelItem.Removal(new UUID(0, 1)));
    report("classifications " + ctx.classifications().orders());
  }

  /**
   * SDK 1.2.0: a connection task that connects to {@code port} on loopback, reads one line, and
   * hands it to a worker, which reports it; its events are reported too.
   */
  private void connect(PluginContext ctx, int port) {
    WorkerRef<PluginStatus> reporter = ctx.workers().spawn(
        WorkerSpec.of("reporter", PluginStatus.class, () -> (status, c) -> report(status.detail())));
    ctx.connections().start(ConnectionSpec.of("echo", Line.class), () -> new EchoTask(port, reporter), reporter,
        event -> new PluginStatus(PluginState.OK, "task " + event.getClass().getSimpleName() + " " + event.task() + " in"));
  }

  /** What workers would post to the echo task. */
  public record Line(String text) implements Message {}

  /** A connection task (a class, as PluginRules wants): connects, reads a line, passes it on, then waits to be stopped. */
  private record EchoTask(int port, WorkerRef<PluginStatus> reporter) implements ConnectionTask<Line> {
    @Override
    public void run(TaskContext<Line> task) throws Exception {
      Socket socket = task.closeOnStop(new Socket());
      socket.connect(new InetSocketAddress(InetAddress.getLoopbackAddress(), port), 5_000);
      task.peer(socket.getRemoteSocketAddress());
      String line = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8)).readLine();
      task.count("received", 1);
      task.send(reporter, new PluginStatus(PluginState.OK, "received " + line + " on " + Thread.currentThread().getContextClassLoader().getName()));
      while (task.take() != null) {
        // nothing is posted; take() answers null when the task stops
      }
    }
  }

  @Override
  public void stop() {
    report("stopped");
  }

  private void report(String what) {
    report(context, what);
  }

  private static void report(PluginContext context, String what) {
    context.topics().publish(Topic.of(context.pluginId() + ".events", PluginStatus.class),
        new PluginStatus(PluginState.OK, what + " " + context.pluginId()));
  }

  private static void threeTimers(PluginContext ctx) {
    WorkerRef<PluginStatus> ticker = ctx.workers().spawn(WorkerSpec.of("ticker", PluginStatus.class, () -> (status, c) -> {}));
    for (int i = 0; i < 3; i++) {
      ctx.timers().every(Duration.ofHours(1), ticker, new PluginStatus(PluginState.OK, "tick " + i));
    }
  }

  private static String mode(JsonObject settings) {
    return settings.has("mode") ? settings.getString("mode") : "ok";
  }

  /** Answers questions about where the plugin runs. */
  private record Info(String id, JsonObject settings, PluginContext context) implements Handler<Request> {
    @Override
    public void handle(Request message, WorkerContext<Request> ctx) {
      EndpointRequest request = message.request();
      String answer = switch (request.pathParameter("what")) {
        case "id" -> id;
        case "loader" -> Thread.currentThread().getContextClassLoader().getName() + " / " + getClass().getClassLoader().getName();
        case "ecore" -> visible("dev.emcc.ecore.ECore");
        case "jackson" -> visible("tools.jackson.databind.ObjectMapper");
        case "sdk" -> visible("dev.emcc.sdk.Plugin");
        case "testkit" -> visible("dev.emcc.sdk.testkit.FakePluginContext");
        case "mode" -> mode(settings);
        case "current-mode" -> mode(context.settings());
        case "data-types" -> context.dataTypes().stream()
            .map(t -> t.id() + (t.defaults().expiresAfterSeconds() == null ? "" : "/" + t.defaults().expiresAfterSeconds()))
            .collect(Collectors.joining(","));
        case "declared-fields" -> context.declaredFields().stream().map(f -> f.plugin() + "." + f.name()).collect(Collectors.joining(","));
        case "workspaces" -> context.workspaces().stream().map(w -> w.id()).collect(Collectors.joining(","));
        case "field-sets" -> context.fieldSets().stream().map(f -> f.id()).collect(Collectors.joining(","));
        case "relation-kinds" -> context.relationKinds().stream().map(k -> k.id()).collect(Collectors.joining(","));
        default -> "?";
      };
      request.response().respond(HttpReply.of(200, Headers.of("Content-Type", "text/plain"), Bytes.utf8(answer)));
    }

    private static String visible(String className) {
      try {
        Class.forName(className, false, Info.class.getClassLoader());
        return "visible";
      } catch (ClassNotFoundException e) {
        return "hidden";
      }
    }
  }
}
