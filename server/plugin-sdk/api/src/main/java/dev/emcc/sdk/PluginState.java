package dev.emcc.sdk;

/**
 * Health of a plugin, from best to worst. The same states are used by the web SDK.
 *
 * <pre>{@code
 * PluginState effective = PluginState.worse(pluginSet, ecoreSet);
 * }</pre>
 */
public enum PluginState {
  /** Working as intended. */
  OK,
  /** Working, but limited (e.g. a worker hung and was not restarted, or an upstream is down). */
  DEGRADED,
  /** Not working. */
  FAILED;

  /** The worse of two states. The effective status of a plugin is the worse of its own and ECore's. */
  public static PluginState worse(PluginState a, PluginState b) {
    return a.ordinal() >= b.ordinal() ? a : b;
  }
}
