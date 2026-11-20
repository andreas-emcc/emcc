package dev.emcc.plugins.fmv.transport;

import dev.emcc.sdk.connection.ListenAddress;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.util.Locale;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * The connection of one link: one entry of the {@code links} setting (ADR-0037; brief section 5).
 * Addresses, groups, interfaces and ports come only from here, never from received data, a message
 * or a browser request (ADR-0030). A change of these fields reconnects the link; the link's other
 * settings (its layer, label, symbol, colour, ...) do not.
 *
 * <p>A link is known by its {@code id} (CR-0047, SDK 1.8.0 part F: ECore fills in a missing one with a
 * UUID v7 and nothing changes it afterwards), so a renamed link is the same link. An entry without
 * one, which only a test can write, is known by its name.
 *
 * @param id the link's identity: the stream's name, the task's name and the objects' external ids come from it
 * @param name the name an admin sees; its key ({@link #dataSource()}) is the data source of objects made from now on
 * @param mode unicast or multicast
 * @param listen where it listens: for {@code udp} loopback unless an admin names an address; for
 *     {@code multicast} the group, the port and the interface an admin names
 * @param enabled whether the plugin runs it
 */
public record Link(String id, String name, Mode mode, ListenAddress listen, boolean enabled) {

  /** The longest name of a stream (CR-0044). */
  static final int MAX_NAME = 64;

  private static final Pattern TASK_NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");

  /** How the link receives. */
  public enum Mode {
    UDP, MULTICAST;

    /** As in the settings: {@code udp} or {@code multicast}. */
    public String json() {
      return name().toLowerCase(Locale.ROOT);
    }
  }

  /**
   * Reads one entry of the {@code links} setting.
   *
   * @throws IllegalArgumentException with a problem an admin can act on
   */
  public static Link from(JsonObject entry) {
    String name = text(entry, "name");
    String id = text(entry, "id");
    if (id == null) {
      id = name;
    }
    if (id == null) {
      throw new IllegalArgumentException("a link needs a name");
    }
    if (name == null) {
      name = id;
    }
    String label = name;
    Mode mode = Mode.UDP;
    if (entry.get("mode") instanceof JsonString m) {
      if (m.value().equals("multicast")) {
        mode = Mode.MULTICAST;
      } else if (!m.value().equals("udp")) {
        throw new IllegalArgumentException("link " + label + ": mode is udp or multicast");
      }
    }
    ListenAddress listen;
    try {
      if (mode == Mode.MULTICAST) {
        var group = JsonObject.builder();
        String g = text(entry, "group");
        if (g != null) {
          group.put("address", JsonString.of(g));
        }
        if (entry.get("port") instanceof JsonNumber p) {
          group.put("port", p);
        }
        String nic = text(entry, "interface");
        if (nic != null) {
          group.put("interface", JsonString.of(nic));
        }
        listen = ListenAddress.multicast(group.build());
        if (!isMulticast(listen.address())) {
          throw new IllegalArgumentException("group " + listen.address() + " is not a multicast group (224.0.0.0 to 239.255.255.255)");
        }
      } else {
        var at = JsonObject.builder();
        String a = text(entry, "address");
        if (a != null) {
          at.put("address", JsonString.of(a));
        }
        if (entry.get("port") instanceof JsonNumber p) {
          at.put("port", p);
        }
        listen = ListenAddress.from(at.build());
      }
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("link " + label + ": " + e.getMessage(), e);
    }
    boolean enabled = !(entry.get("enabled") instanceof JsonBoolean b) || b.value();
    return new Link(id, name, mode, listen, enabled);
  }

  /**
   * The stream's name (brief section 4; CR-0044's pattern): the id in lower case, every character
   * other than {@code a}-{@code z}, {@code 0}-{@code 9} and {@code -} turned into {@code -}, cut to
   * 64 characters, and with {@code l-} before it when it does not start with a letter or digit.
   */
  public static String streamName(String id) {
    String s = id.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9-]", "-");
    if (s.isEmpty() || !Character.isLetterOrDigit(s.charAt(0)) || s.charAt(0) == '-') {
      s = "l-" + s;
    }
    return s.length() > MAX_NAME ? s.substring(0, MAX_NAME) : s;
  }

  /** The connection task's name: the stream's name of the link's id made to fit a task's (a letter first, single hyphens). */
  public String key() {
    return taskName(id);
  }

  /**
   * The link's data source (the model's rule: lowercase words joined by hyphens): its name in lower
   * case with other characters turned into hyphens. It is fixed when an object is created (model
   * rule 14), so a renamed link's existing objects keep the one they have; only new objects take the new one.
   */
  public String dataSource() {
    return taskName(name);
  }

  private static String taskName(String text) {
    String s = streamName(text).replaceAll("-{2,}", "-").replaceAll("-+$", "");
    if (!Character.isLetter(s.charAt(0))) {
      s = "l-" + s;
    }
    if (s.length() > MAX_NAME) {
      s = s.substring(0, MAX_NAME).replaceAll("-+$", "");
    }
    if (!TASK_NAME.matcher(s).matches()) {
      throw new IllegalStateException("not a task name: " + s);
    }
    return s;
  }

  /** The stream's name of this link. */
  public String streamName() {
    return streamName(id);
  }

  /** Whether another link's connection is this one's: if so, a change between them needs no reconnect. */
  public boolean sameConnection(Link other) {
    return id.equals(other.id) && mode == other.mode && listen.equals(other.listen) && enabled == other.enabled;
  }

  /** Where the link is, for the status. */
  public String where() {
    return mode.json() + " " + listen.address() + ":" + listen.port() + (listen.networkInterface() != null ? " on " + listen.networkInterface() : "");
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
    JsonValue v = entry.get(key);
    return v instanceof JsonString s && !s.value().isBlank() ? s.value().strip() : null;
  }
}
