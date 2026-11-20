package dev.emcc.sdk.testkit;

import org.jspecify.annotations.Nullable;

/**
 * A log entry captured by a {@link FakePluginContext}, with the placeholders filled in.
 *
 * <pre>{@code
 * assertThat(ctx.logEntries()).anyMatch(e -> e.level() == LogEntry.Level.WARN && e.message().contains("upstream"));
 * }</pre>
 *
 * @param level the level
 * @param worker the worker that logged it, or {@code null} for the plugin's own logger
 * @param message the formatted message
 * @param error the logged exception, or {@code null}
 */
public record LogEntry(Level level, @Nullable String worker, String message, @Nullable Throwable error) {

  public enum Level {
    DEBUG,
    INFO,
    WARN,
    ERROR
  }

  /** Fills SLF4J-style {@code {}} placeholders, like ECore's logger. */
  static String format(String message, @Nullable Object[] args) {
    var out = new StringBuilder();
    int arg = 0;
    int i = 0;
    while (i < message.length()) {
      if (i + 1 < message.length() && message.charAt(i) == '{' && message.charAt(i + 1) == '}' && arg < args.length) {
        out.append(args[arg++]);
        i += 2;
      } else {
        out.append(message.charAt(i++));
      }
    }
    return out.toString();
  }
}
