package dev.emcc.ecore.plugin;

import dev.emcc.sdk.connection.Connections;
import dev.emcc.sdk.listener.Listeners;
import java.util.Map;

/**
 * ECore's settings for plugins' listeners (SDK v1, "Listeners") and connection tasks (SDK 1.2.0,
 * ADR-0036). The TLS credentials are shared: a listener and a connection task name them alike
 * (owner, 2026-10-24). From SDK 1.6.0 also the bearer tokens of outbound HTTP calls ({@code
 * HttpCall.credential}; CR-0041 part A), shared by name as the TLS credentials are (owner, 2026-11-12).
 *
 * @param maxPerPlugin the most listeners one plugin may have at a time
 * @param credentials the TLS credentials by name ({@link TlsCredentials})
 * @param maxTasksPerPlugin the most connection tasks one plugin may have at a time, children included
 * @param httpTokens SDK 1.6.0: the bearer tokens by name, from local configuration only; never shown
 */
public record ListenerConfig(int maxPerPlugin, Map<String, TlsCredentials> credentials, int maxTasksPerPlugin, Map<String, String> httpTokens) {

  /** The connection tasks a plugin may have by default (SDK 1.2.0). */
  public static final int DEFAULT_MAX_TASKS = Connections.MAX_TASKS;

  /** 100 listeners and 100 connection tasks per plugin, no TLS credentials. */
  public static final ListenerConfig DEFAULT = new ListenerConfig(Listeners.MAX_LISTENERS, Map.of(), DEFAULT_MAX_TASKS, Map.of());

  public ListenerConfig {
    if (maxPerPlugin < 1) {
      throw new IllegalArgumentException("maxPerPlugin must be at least 1: " + maxPerPlugin);
    }
    if (maxTasksPerPlugin < 1) {
      throw new IllegalArgumentException("maxTasksPerPlugin must be at least 1: " + maxTasksPerPlugin);
    }
    credentials = Map.copyOf(credentials);
    httpTokens = Map.copyOf(httpTokens);
  }

  /** With the default cap of connection tasks, no bearer tokens. */
  public ListenerConfig(int maxPerPlugin, Map<String, TlsCredentials> credentials) {
    this(maxPerPlugin, credentials, DEFAULT_MAX_TASKS, Map.of());
  }

  public ListenerConfig withMaxTasksPerPlugin(int max) {
    return new ListenerConfig(maxPerPlugin, credentials, max, httpTokens);
  }

  /** SDK 1.6.0: with these bearer tokens by name. */
  public ListenerConfig withHttpTokens(Map<String, String> tokens) {
    return new ListenerConfig(maxPerPlugin, credentials, maxTasksPerPlugin, tokens);
  }

  /** Never shows the tokens, only their names. */
  @Override
  public String toString() {
    return "ListenerConfig[maxPerPlugin=" + maxPerPlugin + ", credentials=" + credentials.keySet() + ", maxTasksPerPlugin="
        + maxTasksPerPlugin + ", httpTokens=" + new java.util.TreeSet<>(httpTokens.keySet()) + "]";
  }
}
