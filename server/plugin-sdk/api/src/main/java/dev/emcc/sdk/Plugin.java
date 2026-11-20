package dev.emcc.sdk;

/**
 * The entry point of a plugin's server part, named in the manifest as {@code server.entryClass}.
 *
 * <p>The class needs a public no-argument constructor. ECore calls the methods once each, in this
 * order, from a single thread (overview 4.1). {@link #init} and {@link #start} must return quickly
 * (budget 5 s): a plugin that throws or exceeds the budget fails to start and is disabled.
 *
 * <pre>{@code
 * public void init(PluginContext context) {
 *   tiles = context.workers().spawn(WorkerSpec.of("tiles", TileMsg.class, TileWorker::new));
 *   context.endpoints().register(Endpoint.get("/tiles/{z}/{x}/{y}.png"), tiles, TileMsg.Get::new);
 * }
 * }</pre>
 */
public interface Plugin {

  /** Creates workers and registers endpoints and subscriptions. No I/O yet. */
  void init(PluginContext context);

  /** Begins the work, e.g. starts timers or sends first requests. */
  void start();

  /** Stops timers and similar. ECore stops the plugin's workers afterwards, in reverse order. */
  void stop();
}
