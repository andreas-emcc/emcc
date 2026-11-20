package dev.emcc.plugins.gmti.transport;

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
 * The connection of one link: one entry of the {@code links} setting (ADR-0037; brief section 5).
 * Hosts, ports, groups and interfaces come only from here, never from received data, a message or a
 * browser request (ADR-0030). A change of these fields reconnects the link; the link's other
 * settings (its layer, label, cap, ...) do not.
 *
 * @param name the link's name, also its connection task's name and the data source of what it receives
 * @param mode UDP, a TCP client or a TCP server
 * @param direction {@code in} (receive 4607) or {@code out} (send the simulator's dwells); no {@code both}
 * @param host the peer: where a TCP client connects, and where UDP sends (a multicast group allowed); {@code null} where unused
 * @param port the peer's port; 0 where unused
 * @param listen where a TCP server or a receiving UDP link binds: loopback unless an admin sets its
 *     {@code address} ({@link ListenAddress#from}); {@code null} where unused
 * @param multicastGroup {@code udp in}: the group to join, received on {@code listen}'s port; {@code null} for unicast
 * @param multicastInterface the interface that joins the group ({@code in}) or sends to it ({@code out}):
 *     a name, a display name or an address such as {@code 127.0.0.1}; {@code null}: the system's choice
 * @param idle a link that receives and gets nothing for this long reconnects (TCP only); zero: never
 * @param enabled whether the plugin runs it
 */
public record Link(
    String name, Mode mode, Direction direction, @Nullable String host, int port, @Nullable ListenAddress listen, @Nullable String multicastGroup,
    @Nullable String multicastInterface, Duration idle, boolean enabled) {

  /** A link's name, as a connection task's name and a data source must be. */
  private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");

  /** How the link reaches its peer. */
  public enum Mode {
    UDP, TCP_CLIENT, TCP_SERVER;

    /** As in the settings: {@code udp}, {@code tcp-client}, {@code tcp-server}. */
    public String json() {
      return name().toLowerCase(Locale.ROOT).replace('_', '-');
    }
  }

  /** What the link does. */
  public enum Direction {
    IN, OUT;

    public boolean receives() {
      return this == IN;
    }

    public boolean sends() {
      return this == OUT;
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
    String group = null;
    String networkInterface = null;
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
      if (mode == Mode.UDP) {
        if (direction.receives()) {
          group = text(entry, "multicastGroup");
          if (group != null && !isMulticast(group)) {
            throw new IllegalArgumentException("multicastGroup " + group + " is not a multicast group (224.0.0.0 to 239.255.255.255)");
          }
        }
        networkInterface = text(entry, "multicastInterface");
      }
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("link " + name + ": " + e.getMessage(), e);
    }
    long idleSeconds = entry.get("idleSeconds") instanceof JsonNumber n ? n.longValueExact() : 120;
    boolean enabled = !(entry.get("enabled") instanceof JsonBoolean b) || b.value();
    return new Link(name, mode, direction, host, port, listen, group, networkInterface, Duration.ofSeconds(Math.max(0, idleSeconds)), enabled);
  }

  /** Where the link is, for the status: the peer, the address it listens on, the group it joins. */
  public String where() {
    String to = host != null ? " to " + host + ":" + port : "";
    String on = listen != null ? " on " + (multicastGroup != null ? multicastGroup : listen.address()) + ":" + listen.port() : "";
    return direction.name().toLowerCase(Locale.ROOT) + " " + mode.json() + on + to;
  }

  /**
   * A literal IPv4 multicast address (224.0.0.0 to 239.255.255.255) or IPv6 one ({@code ff..::}),
   * parsed here: no name is looked up outside a connection task (rule C6).
   */
  static boolean isMulticast(String address) {
    if (address.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")) {
      String[] octets = address.split("\\.");
      for (String o : octets) {
        if (Integer.parseInt(o) > 255) {
          return false;
        }
      }
      int first = Integer.parseInt(octets[0]);
      return first >= 224 && first <= 239;
    }
    return address.matches("(?i)ff[0-9a-f]{2}:[0-9a-f:]*");
  }

  private static @Nullable String text(JsonObject entry, String key) {
    return entry.get(key) instanceof JsonString s && !s.value().isBlank() ? s.value().strip() : null;
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
