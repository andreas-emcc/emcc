package dev.emcc.sdk.worker;

import dev.emcc.sdk.Message;

/**
 * Creates the plugin's workers. Usually called in {@link dev.emcc.sdk.Plugin#init}; a handler may
 * also spawn workers. ECore stops all of a plugin's workers when the plugin stops.
 *
 * <pre>{@code
 * WorkerRef<TileMsg> tiles = context.workers().spawn(WorkerSpec.of("tiles", TileMsg.class, TileWorker::new));
 * }</pre>
 */
public interface Workers {

  /** Creates and starts a worker. Fails if the plugin already has a worker with that name. */
  <M extends Message> WorkerRef<M> spawn(WorkerSpec<M> spec);
}
