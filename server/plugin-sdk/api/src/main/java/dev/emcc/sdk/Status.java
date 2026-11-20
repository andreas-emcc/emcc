package dev.emcc.sdk;

/**
 * The plugin's own part of its status.
 *
 * <p>ECore keeps a second status for the plugin (e.g. {@link PluginState#DEGRADED} when a
 * non-restartable worker hangs). The <b>effective status</b> shown in the monitor view and health
 * checks is the worse of the two; a plugin cannot clear a state set by ECore. Setting a status is
 * cheap and may be done from any handler.
 *
 * <pre>{@code
 * context.status().set(PluginState.DEGRADED, "upstream unreachable since 10:42");
 * }</pre>
 */
public interface Status {

  /** Sets the plugin's own status. The initial status is {@code OK} with an empty detail. */
  void set(PluginState state, String detail);
}
