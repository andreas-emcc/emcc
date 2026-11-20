package dev.emcc.ecore.plugin;

import dev.emcc.sdk.PluginLog;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * A plugin's logger: SLF4J under the name {@code plugin.<id>}, or {@code plugin.<id>.<worker>} in a
 * worker, so every entry is tagged with the plugin (and the worker).
 */
final class PluginLogger implements PluginLog {

  private final Logger log;

  PluginLogger(String pluginId) {
    this.log = LoggerFactory.getLogger("plugin." + pluginId);
  }

  PluginLogger(String pluginId, String worker) {
    this.log = LoggerFactory.getLogger("plugin." + pluginId + "." + worker);
  }

  @Override
  public void debug(String message, @Nullable Object... args) {
    log.debug(message, args);
  }

  @Override
  public void info(String message, @Nullable Object... args) {
    log.info(message, args);
  }

  @Override
  public void warn(String message, @Nullable Object... args) {
    log.warn(message, args);
  }

  @Override
  public void error(String message, @Nullable Object... args) {
    log.error(message, args);
  }

  @Override
  public void error(String message, Throwable error) {
    log.error(message, error);
  }
}
