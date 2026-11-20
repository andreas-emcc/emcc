package dev.emcc.plugins.ais.transport;

import dev.emcc.plugins.ais.StandardIdentity;
import dev.emcc.plugins.ais.SymbolType;
import dev.emcc.sdk.LayerChoice;
import dev.emcc.sdk.connection.ListenAddress;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.SecurityLabel;
import java.time.Duration;
import java.util.Locale;
import java.util.Objects;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * One link: one entry of the {@code links} setting (ADR-0037). Hosts, ports and addresses come only
 * from here, never from received data, a message or a browser request (ADR-0030).
 *
 * @param name the link's name, also its connection task's name and the data source of what it receives
 * @param mode UDP or a TCP client
 * @param direction input only
 * @param host the peer a TCP client connects to; {@code null} for UDP
 * @param port the peer's port; 0 for UDP
 * @param listen where a UDP link receives, from the {@code listen} object: loopback unless an admin
 *     sets its {@code address} ({@link ListenAddress#from}); {@code null} for a TCP client
 * @param idle a TCP link that gets nothing for this long connects again; zero: never
 * @param enabled whether the plugin runs it
 * @param target where the ships go: a layer the form picked (with its id; one saved before SDK 1.4.0 has only a name); {@code null}: a new layer named like the link
 * @param label the security label of the link's layer and ships; {@code null}: the server's default label
 * @param identity the standard identity of the symbol of every ship of the link
 * @param symbolType vessel symbols or APP-6D; a stored link without the setting is {@code app6} (brief section 10)
 */
public record Link(
    String name, Mode mode, Direction direction, @Nullable String host, int port, @Nullable ListenAddress listen, Duration idle, boolean enabled,
    @Nullable LayerChoice target, @Nullable SecurityLabel label, StandardIdentity identity, SymbolType symbolType) {

  /** A link's name, as a connection task's name must be. */
  private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");

  /** How the link reaches its peer. */
  public enum Mode {
    UDP, TCP_CLIENT;

    /** As in the settings: {@code udp}, {@code tcp-client}. */
    public String json() {
      return name().toLowerCase(Locale.ROOT).replace('_', '-');
    }
  }

  /** What the link does: it receives, and nothing else (the plugin sends no AIS). */
  public enum Direction {
    IN
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
    if (name.equals("manual")) {
      throw new IllegalArgumentException("link manual: 'manual' is reserved for drawn objects, choose another name");
    }
    Mode mode = choice(entry, "mode", Mode.TCP_CLIENT, Mode.values(), name);
    Direction direction = choice(entry, "direction", Direction.IN, Direction.values(), name);
    String host = null;
    int port = 0;
    ListenAddress listen = null;
    try {
      if (mode == Mode.UDP) {
        if (!(entry.get("listen") instanceof JsonObject at)) {
          throw new IllegalArgumentException("needs a listen port");
        }
        listen = ListenAddress.from(at); // loopback unless an admin sets another address
      } else {
        host = text(entry, "host");
        if (host == null) {
          throw new IllegalArgumentException("needs a host");
        }
        port = port(entry);
      }
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("link " + name + ": " + e.getMessage(), e);
    }
    LayerChoice target;
    SecurityLabel label = null;
    StandardIdentity identity = StandardIdentity.UNKNOWN;
    SymbolType symbolType = SymbolType.APP6; // absent: a link stored before M5 keeps APP-6; the form fills "vessel" into a new one
    try {
      if (entry.get("symbolType") instanceof JsonString st) {
        symbolType = SymbolType.fromJson(st.value());
        if (symbolType == null) {
          throw new IllegalArgumentException("unknown symbolType " + st.value());
        }
      }
      target = LayerChoice.from(entry.get("targetLayer"));
      if (entry.get("label") instanceof JsonObject l) {
        if (l.get("policy") instanceof JsonString policy && l.get("classification") instanceof JsonString classification
            && !policy.value().isEmpty() && !classification.value().isEmpty() && classification.value().length() <= 64) {
          label = SecurityLabel.of(policy.value(), classification.value());
        } else {
          throw new IllegalArgumentException("the label needs a policy and a classification");
        }
      }
      if (entry.get("standardIdentity") instanceof JsonString id) {
        identity = StandardIdentity.fromJson(id.value());
        if (identity == null) {
          throw new IllegalArgumentException("unknown standardIdentity " + id.value());
        }
      }
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("link " + name + ": " + e.getMessage(), e);
    }
    long idleSeconds = entry.get("idleSeconds") instanceof JsonNumber n ? n.longValueExact() : 300;
    boolean enabled = !(entry.get("enabled") instanceof JsonBoolean b) || b.value();
    return new Link(name, mode, direction, host, port, listen, Duration.ofSeconds(Math.max(0, idleSeconds)), enabled, target, label, identity, symbolType);
  }

  /** Whether the same connection serves {@code other}: a change in the layer, label or identity needs no reconnect. */
  public boolean sameConnection(Link other) {
    return name.equals(other.name) && mode == other.mode && Objects.equals(host, other.host) && port == other.port
        && Objects.equals(listen, other.listen) && idle.equals(other.idle) && enabled == other.enabled;
  }

  /** Where the link is, for the status: the peer, or the address it listens on. */
  public String where() {
    String to = host != null ? " to " + host + ":" + port : "";
    String on = listen != null ? " on " + listen.address() + ":" + listen.port() : "";
    return "in " + mode.json() + on + to;
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
