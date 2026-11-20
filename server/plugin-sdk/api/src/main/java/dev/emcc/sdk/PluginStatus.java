package dev.emcc.sdk;

import java.util.Objects;

/**
 * A plugin status: a state and a short human-readable detail. The same shape as the web SDK's
 * status, so the monitor view can show both alike.
 *
 * <pre>{@code
 * new PluginStatus(PluginState.DEGRADED, "upstream tile server unreachable")
 * }</pre>
 *
 * @param state the state
 * @param detail what is going on, in English, at most 512 characters
 */
public record PluginStatus(PluginState state, String detail) implements Message {

  /** The maximum length of {@link #detail}. */
  public static final int MAX_DETAIL = 512;

  public PluginStatus {
    Objects.requireNonNull(state, "state");
    Objects.requireNonNull(detail, "detail");
    if (detail.length() > MAX_DETAIL) {
      throw new IllegalArgumentException("detail is longer than " + MAX_DETAIL + " characters");
    }
  }

  /** The worse of two statuses; on equal states, {@code this}. */
  public PluginStatus worse(PluginStatus other) {
    return other.state.ordinal() > state.ordinal() ? other : this;
  }
}
