package dev.emcc.ecore.plugin;

import dev.emcc.ecore.runtime.HungCall;
import dev.emcc.ecore.runtime.RuntimeListener;
import dev.emcc.ecore.runtime.WorkerInfo;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.PluginStatus;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The status of every plugin: the plugin's own status and the one ECore sets (SDK v0 design,
 * "Plugin context"). The effective status is the worse of the two; a plugin cannot clear what ECore
 * set. Also the runtime listener that turns worker health events into ECore's status.
 */
public final class PluginStatuses implements RuntimeListener {

  private static final PluginStatus OK = new PluginStatus(PluginState.OK, "");

  private final Map<String, PluginStatus> own = new ConcurrentHashMap<>();
  private final Map<String, PluginStatus> ecore = new ConcurrentHashMap<>();
  private final Set<String> plugins = ConcurrentHashMap.newKeySet();

  /** Starts tracking a plugin; worker events of other owners (ECore's own) are ignored. */
  void register(String pluginId) {
    plugins.add(pluginId);
  }

  /** The effective status of a plugin; {@code OK} for an unknown one. */
  public PluginStatus of(String pluginId) {
    return own.getOrDefault(pluginId, OK).worse(ecore.getOrDefault(pluginId, OK));
  }

  /** Sets the plugin's own status. */
  void setOwn(String pluginId, PluginState state, String detail) {
    own.put(pluginId, new PluginStatus(state, truncate(detail)));
  }

  /** Sets ECore's status of the plugin, unless it is already worse. */
  void setByEcore(String pluginId, PluginState state, String detail) {
    if (!plugins.contains(pluginId)) {
      return;
    }
    ecore.merge(pluginId, new PluginStatus(state, truncate(detail)), PluginStatus::worse);
  }

  private static String truncate(String detail) {
    return detail.length() <= PluginStatus.MAX_DETAIL ? detail : detail.substring(0, PluginStatus.MAX_DETAIL - 1) + "…";
  }

  // ---- RuntimeListener: worker health of plugin workers (owner = plugin id) ----------------------

  @Override
  public void workerHung(WorkerInfo worker, Duration elapsed, boolean restarting, HungCall call) {
    if (!restarting) {
      setByEcore(worker.owner(), PluginState.DEGRADED,
          "worker " + worker.name() + " hung (" + elapsed.toMillis() + " ms) and is not restarted"); // the log names the call
    }
  }

  @Override
  public void workerFailed(WorkerInfo worker, Throwable error) {
    setByEcore(worker.owner(), PluginState.DEGRADED,
        "worker " + worker.name() + " could not be restarted: " + error);
  }
}
