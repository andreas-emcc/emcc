package dev.emcc.sdk;

import org.jspecify.annotations.Nullable;

/**
 * The plugin's logger. Messages use SLF4J-style {@code {}} placeholders; ECore tags every entry
 * with the plugin id. The SDK has no logging library dependency.
 *
 * <pre>{@code
 * log.info("fetched tile {}/{}/{} in {} ms", z, x, y, millis);
 * log.error("upstream failed", exception);
 * }</pre>
 */
public interface PluginLog {

  void debug(String message, @Nullable Object... args);

  void info(String message, @Nullable Object... args);

  void warn(String message, @Nullable Object... args);

  void error(String message, @Nullable Object... args);

  /** Logs an error with its stack trace. */
  void error(String message, Throwable error);
}
