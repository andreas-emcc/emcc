package dev.emcc.plugins.simulator;

import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Clock;
import java.time.Duration;
import org.jspecify.annotations.Nullable;

/**
 * The entry class ({@code server.entryClass} in {@code plugin.json}): the simulator's server part
 * (ADR-0040, brief {@code docs/plugins/briefs/simulator.md}).
 *
 * <p>One worker, {@code engine}, owns the simulation; a timer ticks it once a second, with no
 * browser open (A2). It follows the Simulation workspace through a store subscription that names
 * the workspace. The plugin creates no thread of its own (rule C1).
 */
public final class SimulatorPlugin implements Plugin {

  /** Outcomes and store updates are always delivered; this bounds the rest (ticks, endpoint requests). */
  static final int MAILBOX = 10_000;

  /** The engine answers from what it holds, so an answer comes at once unless the worker is busy. */
  static final Duration ENDPOINT_TIMEOUT = Duration.ofSeconds(5);

  /** A command naming {@link Engine#MAX_COMMAND_OBJECTS} ids fits: about 40 bytes each. */
  static final int COMMAND_BODY = 256 * 1024;

  private final Clock clock;
  private @Nullable PluginContext context;
  private @Nullable WorkerRef<EngineMsg> engine;
  private @Nullable Cancellable tick;
  private @Nullable Cancellable subscription;
  private @Nullable Cancellable channels;
  private @Nullable Cancellable settings;

  /** ECore creates the plugin with this constructor. */
  public SimulatorPlugin() {
    this(Clock.systemUTC());
  }

  SimulatorPlugin(Clock clock) {
    this.clock = clock;
  }

  @Override
  public void init(PluginContext context) {
    this.context = context;
    WorkerRef<EngineMsg> worker = context.workers().spawn(
        WorkerSpec.of("engine", EngineMsg.class, () -> new Engine(context, clock)).mailbox(MAILBOX, Overflow.dropNewest()).restartable(true));
    this.engine = worker;
    Endpoint routes = Endpoint.get("/routes").requires(Engine.VIEW_PERMISSION).timeout(ENDPOINT_TIMEOUT);
    Endpoint route = Endpoint.get("/routes/{id}").requires(Engine.VIEW_PERMISSION).timeout(ENDPOINT_TIMEOUT);
    context.endpoints().register(routes, worker, EngineMsg.GetRoutes::new);
    context.endpoints().register(route, worker, EngineMsg.GetRoute::new);
    // The commands (brief function 24; CR-0026): each requires its permission, checked by ECore.
    for (EngineMsg.Action action : EngineMsg.Action.values()) {
      String name = action.name().toLowerCase(java.util.Locale.ROOT);
      context.endpoints().register(command("/routes/" + name, Engine.RUN_PERMISSION), worker, r -> new EngineMsg.Control(action, r));
      context.endpoints().register(command("/routes/{id}/" + name, Engine.RUN_PERMISSION), worker, r -> new EngineMsg.Control(action, r));
    }
    context.endpoints().register(command("/put-on-route", Engine.EDIT_PERMISSION).maxBody(COMMAND_BODY), worker, EngineMsg.PutOnRoute::new);
    context.endpoints().register(command("/take-off-route", Engine.EDIT_PERMISSION).maxBody(COMMAND_BODY), worker, EngineMsg.TakeOffRoute::new);
    Endpoint outputs = Endpoint.get("/outputs").requires(Engine.VIEW_PERMISSION).timeout(ENDPOINT_TIMEOUT);
    context.endpoints().register(outputs, worker, EngineMsg.GetOutputs::new);
    context.endpoints().register(command("/outputs", Engine.EDIT_PERMISSION), worker, EngineMsg.ChooseOutputs::new);
    // The sensors (brief function 27): read with the view permission, changed with the edit permission.
    Endpoint sensors = Endpoint.get("/sensors").requires(Engine.VIEW_PERMISSION).timeout(ENDPOINT_TIMEOUT);
    context.endpoints().register(sensors, worker, EngineMsg.GetSensors::new);
    // Function 43: the drawn dwells, with the same permission as the GET for the Sensors panel.
    context.endpoints().register(Endpoint.get("/sensors/dwells").requires(Engine.VIEW_PERMISSION).timeout(ENDPOINT_TIMEOUT), worker, EngineMsg.GetDwells::new);
    context.endpoints().register(command("/sensors", Engine.EDIT_PERMISSION), worker, EngineMsg.SaveSensor::new);
    context.endpoints().register(command("/sensors/remove", Engine.EDIT_PERMISSION), worker, EngineMsg.RemoveSensor::new);
    // Scenarios (brief function 32): the export reads with view; the import needs edit, and run (checked by the engine).
    Endpoint scenario = Endpoint.get("/scenario-state").requires(Engine.VIEW_PERMISSION).timeout(ENDPOINT_TIMEOUT);
    context.endpoints().register(scenario, worker, EngineMsg.GetScenarioState::new);
    context.endpoints().register(command("/scenario-state", Engine.EDIT_PERMISSION).maxBody(Endpoint.MAX_BODY), worker, EngineMsg.ImportScenarioState::new);
    context.status().set(PluginState.OK, "starting");
  }

  private static Endpoint command(String path, String permission) {
    return Endpoint.post(path).requires(permission).timeout(ENDPOINT_TIMEOUT);
  }

  @Override
  public void start() {
    PluginContext ctx = context;
    WorkerRef<EngineMsg> worker = engine;
    if (ctx == null || worker == null) {
      return;
    }
    subscription = ctx.store().subscribe(Engine.workspaceQuery(), worker, EngineMsg.Updated::new);
    tick = ctx.timers().every(Duration.ofSeconds(1), worker, new EngineMsg.Tick());
    channels = ctx.channels().watch(worker, EngineMsg.Channels::new);
    settings = ctx.subscribeSettings(worker, EngineMsg.Settings::new);
  }

  @Override
  public void stop() {
    // A clean stop pauses and saves, best effort: ECore may stop the worker before it is handled (ADR-0041 point 6).
    if (engine != null) {
      engine.send(new EngineMsg.Stop());
    }
    // ECore stops the worker; the timer, the subscriptions and the watch are ours.
    for (Cancellable c : new Cancellable[] {tick, subscription, channels, settings}) {
      if (c != null) {
        c.cancel();
      }
    }
  }
}
