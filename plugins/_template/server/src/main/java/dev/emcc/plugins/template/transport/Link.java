package dev.emcc.plugins.template.transport;

import dev.emcc.sdk.connection.ListenAddress;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.time.Duration;
import java.util.Locale;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * One link: one entry of the {@code links} setting (ADR-0037). Hosts, ports and addresses come only
 * from here, never from received data, a message or a browser request (ADR-0030).
 *
 * <p>The template's {@code plugin.json} has the whole {@code links} setting, with titles,
 * descriptions, groups, hints and a stable item id (SDK 1.9.0); copy it from there. In short, one
 * entry:
 * <pre>{@code
 * "name":      { "type": "string", "pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*$", "maxLength": 64 },
 * "mode":      { "enum": ["udp", "tcp-client", "tcp-server"], "default": "tcp-client" },
 * "direction": { "enum": ["in", "out", "both"], "default": "in" },
 * "host":      { "type": "string", "minLength": 1, "maxLength": 253 },
 * "port":      { "type": "integer", "minimum": 1, "maximum": 65535 },
 * "listen":    { "type": "object", "required": ["port"], "additionalProperties": false, "properties": {
 *                  "address": { "type": "string", "minLength": 1, "maxLength": 253, "default": "127.0.0.1" },
 *                  "port":    { "type": "integer", "minimum": 1, "maximum": 65535 } } },
 * "tls":       { "type": "boolean", "default": false },
 * "tlsCredential": { "type": "string", "default": "", "x-emc2": { "kind": "tls-credential" } },
 * "idleSeconds": { "type": "integer", "minimum": 0, "maximum": 86400, "default": 120 },
 * "enabled":   { "type": "boolean", "default": true }
 * }</pre>
 *
 * <p>From SDK 1.5.0 (CR-0039 point 8) the settings form can show only what a mode uses: give
 * {@code host} and {@code port} {@code "x-emc2": {"visibleWhen": {"property": "mode", "in": ["tcp-client", "udp"]}}}
 * and {@code listen} the same with {@code ["tcp-server", "udp"]}, and require them where used with the
 * item's own {@code if}/{@code then} (the model's example {@code manifest-settings-visible-when.json}).
 *
 * @param name the link's name, also its connection task's name and the data source of what it receives
 * @param mode UDP, a TCP client or a TCP server
 * @param direction what it does: receive, send, or both on one socket
 * @param host the peer: where a TCP client connects, and where UDP sends; {@code null} where unused
 * @param port the peer's port; 0 where unused
 * @param listen where a TCP server or a receiving UDP link binds, from the {@code listen} object:
 *     loopback unless an admin sets its {@code address} ({@link ListenAddress#from}); {@code null}
 *     where unused. A UDP link that sends and receives binds here and sends to {@code host} and
 *     {@code port}, from the same socket
 * @param idle a link that receives and gets nothing for this long reconnects (TCP only); zero: never
 * @param enabled whether the plugin runs it
 * @param tls SDK 1.2.0 and ADR-0062: a TCP client that talks TLS, with ECore's credential {@link
 *     #credential()}; ignored by the other modes
 * @param tlsCredential SDK 1.9.0 (ADR-0062 point 3): the TLS credential the admin picked in Settings
 *     (the field of kind {@code tls-credential}), or empty for the link's name
 */
public record Link(String name, Mode mode, Direction direction, @Nullable String host, int port, @Nullable ListenAddress listen, Duration idle, boolean enabled,
    boolean tls, String tlsCredential) {

  /** A link's name, as a connection task's name must be. */
  private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");

  /** How the link reaches its peer. */
  public enum Mode {
    UDP, TCP_CLIENT, TCP_SERVER;

    /** As in the settings: {@code udp}, {@code tcp-client}, {@code tcp-server}. */
    public String json() {
      return name().toLowerCase(Locale.ROOT).replace('_', '-');
    }
  }

  /** What the link does; {@code both} uses one socket for both ways. */
  public enum Direction {
    IN, OUT, BOTH;

    public boolean receives() {
      return this != OUT;
    }

    public boolean sends() {
      return this != IN;
    }
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
    Mode mode = choice(entry, "mode", Mode.TCP_CLIENT, Mode.values(), name);
    Direction direction = choice(entry, "direction", Direction.IN, Direction.values(), name);
    String host = null;
    int port = 0;
    ListenAddress listen = null;
    try {
      if (mode == Mode.TCP_SERVER || (mode == Mode.UDP && direction.receives())) {
        if (!(entry.get("listen") instanceof JsonObject at)) {
          throw new IllegalArgumentException("needs a listen port");
        }
        listen = ListenAddress.from(at); // loopback unless an admin sets another address
      }
      if (mode == Mode.TCP_CLIENT || (mode == Mode.UDP && direction.sends())) {
        host = text(entry, "host");
        if (host == null) {
          throw new IllegalArgumentException("needs a host");
        }
        port = port(entry);
      }
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("link " + name + ": " + e.getMessage(), e);
    }
    long idleSeconds = entry.get("idleSeconds") instanceof JsonNumber n ? n.longValueExact() : 120;
    boolean enabled = !(entry.get("enabled") instanceof JsonBoolean b) || b.value();
    boolean tls = mode == Mode.TCP_CLIENT && entry.get("tls") instanceof JsonBoolean t && t.value();
    String credential = tls && text(entry, "tlsCredential") instanceof String c ? c : "";
    return new Link(name, mode, direction, host, port, listen, Duration.ofSeconds(Math.max(0, idleSeconds)), enabled, tls, credential);
  }

  /** The name of the TLS credential: the one picked, or the link's name (ADR-0062 point 3). */
  public String credential() {
    return tlsCredential.isEmpty() ? name : tlsCredential;
  }

  /** Where the link is, for the status: the peer, or the address it listens on. */
  public String where() {
    String to = host != null ? " to " + host + ":" + port : "";
    String on = listen != null ? " on " + listen.address() + ":" + listen.port() : "";
    return direction.name().toLowerCase(Locale.ROOT) + " " + mode.json() + (tls ? " with TLS" : "") + on + to;
  }

  private static @Nullable String text(JsonObject entry, String key) {
    return entry.get(key) instanceof JsonString s && !s.value().isBlank() ? s.value() : null;
  }

  private static int port(JsonObject entry) {
    if (entry.get("port") instanceof JsonNumber n) {
      long value = n.longValueExact();
      if (value >= 1 && value <= 65_535) {
        return (int) value;
      }
    }
    throw new IllegalArgumentException("needs a port from 1 to 65535");
  }

  private static <E extends Enum<E>> E choice(JsonObject entry, String key, E fallback, E[] values, String name) {
    JsonValue value = entry.get(key);
    if (value == null) {
      return fallback;
    }
    if (value instanceof JsonString s) {
      for (E e : values) {
        if (e.name().toLowerCase(Locale.ROOT).replace('_', '-').equals(s.value())) {
          return e;
        }
      }
    }
    throw new IllegalArgumentException("link " + name + ": unknown " + key + (value instanceof JsonString s ? " " + s.value() : ""));
  }
}
