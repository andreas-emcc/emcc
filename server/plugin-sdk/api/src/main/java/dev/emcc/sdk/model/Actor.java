package dev.emcc.sdk.model;

import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * Who caused something: always a plugin, plus the user and/or external system when known. The
 * user is set by the server from the login session, never trusted from a client (model rule 8).
 *
 * <pre>{@code
 * new Actor("cot-in", null, "tak-north")
 * }</pre>
 *
 * @param plugin the plugin id
 * @param user the IAM user id (OIDC {@code sub}), or {@code null}
 * @param system the external system, or {@code null}
 */
public record Actor(String plugin, @Nullable String user, @Nullable String system) {

  public Actor {
    Objects.requireNonNull(plugin, "plugin");
  }

  public static Actor plugin(String pluginId) {
    return new Actor(pluginId, null, null);
  }
}
