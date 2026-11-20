package dev.emcc.plugins.adsb;

import dev.emcc.sdk.LayerChoice;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.SecurityLabel;
import java.time.Duration;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * One link: one entry of the {@code links} setting (ADR-0037). The host and port come only from
 * here, never from received data, a message or a browser request (ADR-0030). The settings schema is
 * in {@code plugin.json}.
 *
 * @param name the link's name, the data source of what it receives
 * @param host the decoder's host
 * @param port the decoder's SBS-1 port
 * @param idle a link that gets nothing for this long reconnects; zero: never
 * @param enabled whether the plugin runs it
 * @param target the layer the aircraft go to, or {@code null} for a layer named like the link
 * @param label the security label of the layer and of the aircraft, or {@code null} for the server's default
 * @param identity the APP-6D standard identity of every aircraft of the link
 */
public record Link(
    String name,
    String host,
    int port,
    Duration idle,
    boolean enabled,
    @Nullable LayerChoice target,
    @Nullable SecurityLabel label,
    Identity identity) {

  /** A link's name, as a connection task's name must be. */
  private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");

  /** The name of the layer of a link with no target: named like the link. */
  public String layerName() {
    return target == null ? name : target.name();
  }

  /**
   * Reads one entry of the {@code links} setting.
   *
   * @throws IllegalArgumentException with a problem an admin can act on
   */
  public static Link from(JsonObject entry) {
    String name = text(entry, "name");
    if (name == null || !NAME.matcher(name).matches() || name.length() > 64) {
      throw new IllegalArgumentException("a link needs a name of lowercase words joined by hyphens, at most 64 characters");
    }
    try {
      String host = text(entry, "host");
      if (host == null) {
        throw new IllegalArgumentException("needs a host");
      }
      int port = entry.get("port") instanceof JsonNumber n ? (int) n.longValueExact() : 30_003;
      if (port < 1 || port > 65_535) {
        throw new IllegalArgumentException("needs a port from 1 to 65535");
      }
      long idleSeconds = entry.get("idleSeconds") instanceof JsonNumber n ? n.longValueExact() : 60;
      boolean enabled = !(entry.get("enabled") instanceof JsonBoolean b) || b.value();
      Identity identity = entry.get("standardIdentity") instanceof JsonString s ? Identity.of(s.value()) : Identity.UNKNOWN;
      return new Link(name, host, port, Duration.ofSeconds(Math.max(0, idleSeconds)), enabled,
          LayerChoice.from(entry.get("targetLayer")), label(entry), identity);
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("link " + name + ": " + e.getMessage(), e);
    }
  }

  /**
   * Whether {@code other} is the same connection: the same name, host, port, idle time and enabled flag.
   * Only these need a reconnect; the layer, label and identity follow without one (playbook, work package 3).
   */
  public boolean sameConnection(Link other) {
    return name.equals(other.name) && host.equals(other.host) && port == other.port && idle.equals(other.idle) && enabled == other.enabled;
  }

  /** Where the link is, for the status. */
  public String where() {
    return "tcp-client to " + host + ":" + port;
  }

  private static @Nullable SecurityLabel label(JsonObject entry) {
    if (!(entry.get("label") instanceof JsonObject label)) {
      return null;
    }
    return SecurityLabel.of(label.getString("policy"), label.getString("classification"));
  }

  private static @Nullable String text(JsonObject entry, String key) {
    return entry.get(key) instanceof JsonString s && !s.value().isBlank() ? s.value() : null;
  }
}
