package dev.emcc.sdk.connection;

import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.net.InetSocketAddress;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.2.0: where a link that listens binds, read from the link's settings (ADR-0036 point 4).
 * <b>It binds to loopback when no address is set</b>; an admin ({@code settings.admin}) sets an
 * interface address, or all interfaces ({@code "0.0.0.0"} or {@code "::"}), to receive from the
 * network.
 *
 * <p>It only parses: it never looks a name up (rule C6), and gives an unresolved address. The task
 * resolves it, since only a connection task may block.
 *
 * <p>The settings schema to copy (the design pattern): {@code {"address": {"type": "string",
 * "default": "127.0.0.1"}, "port": {"type": "integer", "minimum": 1, "maximum": 65535},
 * "interface": {"type": "string"}}}, with {@code address} the multicast group for a multicast link.
 *
 * <pre>{@code
 * ListenAddress at = ListenAddress.from(link);                       // TCP server, UDP
 * var server = new ServerSocket();
 * task.closeOnStop(server);
 * server.bind(new InetSocketAddress(InetAddress.getByName(at.address()), at.port()));   // inside the task
 * task.listening(server.getLocalSocketAddress());
 * }</pre>
 *
 * @param address the address to bind to, or the multicast group: an IP literal or a host name, 1 to 253 characters
 * @param port 1 to 65 535
 * @param networkInterface the network interface's name, for multicast; {@code null} for none
 */
public record ListenAddress(String address, int port, @Nullable String networkInterface) {

  /** The address a link binds to when its settings name none. */
  public static final String LOOPBACK = "127.0.0.1";

  public ListenAddress {
    Objects.requireNonNull(address, "address");
    if (address.isBlank() || address.length() > 253) {
      throw new IllegalArgumentException("address must be 1..253 characters");
    }
    if (port < 1 || port > 65_535) {
      throw new IllegalArgumentException("port must be 1..65535: " + port);
    }
    if (networkInterface != null && networkInterface.isBlank()) {
      throw new IllegalArgumentException("interface must not be blank");
    }
  }

  /**
   * For a TCP server or a UDP link: {@code port} (required), {@code address} (default {@link
   * #LOOPBACK}) and an optional {@code interface}.
   *
   * @throws IllegalArgumentException if {@code port} is missing or out of range, or a value has the wrong type
   */
  public static ListenAddress from(JsonObject link) {
    return new ListenAddress(text(link, "address", LOOPBACK), port(link), optionalText(link, "interface"));
  }

  /**
   * For a multicast link: {@code address} is the group and {@code port} the port, both required, and
   * <b>{@code interface} is required too</b> (R4 of the ACA's review of CR-0025; owner,
   * 2026-10-22): loopback does not carry multicast on every platform (Linux's {@code lo} has no
   * {@code MULTICAST} flag by default), so without an interface the link stays stopped, and its
   * status says that an admin must name one. Nothing is then open to the network by default.
   *
   * @throws IllegalArgumentException if a value is missing or has the wrong type; for a missing
   *     interface the message says that an admin must name one
   */
  public static ListenAddress multicast(JsonObject link) {
    if (!(link.get("address") instanceof JsonString group) || group.value().isBlank()) {
      throw new IllegalArgumentException("a multicast link needs its group in \"address\"");
    }
    String networkInterface = optionalText(link, "interface");
    if (networkInterface == null) {
      throw new IllegalArgumentException("a multicast link needs a network interface: an admin names one in \"interface\" (loopback does not carry multicast on every platform)");
    }
    return new ListenAddress(group.value(), port(link), networkInterface);
  }

  /** Whether it binds to all interfaces, so that it receives from the network. */
  public boolean allInterfaces() {
    // The unspecified address in any spelling: 0.0.0.0, ::, [::], 0:0:0:0:0:0:0:0.
    String a = address.startsWith("[") && address.endsWith("]") ? address.substring(1, address.length() - 1) : address;
    return a.equals("0.0.0.0") || (a.contains(":") && a.chars().allMatch(ch -> ch == '0' || ch == ':'));
  }

  /** The address and port, not resolved. */
  public InetSocketAddress unresolved() {
    return InetSocketAddress.createUnresolved(address, port);
  }

  private static int port(JsonObject link) {
    if (!(link.get("port") instanceof JsonNumber n) || n.doubleValue() != Math.rint(n.doubleValue())) {
      throw new IllegalArgumentException("a link that listens needs a whole \"port\"");
    }
    return (int) n.doubleValue();
  }

  private static String text(JsonObject link, String name, String fallback) {
    String value = optionalText(link, name);
    return value == null ? fallback : value;
  }

  private static @Nullable String optionalText(JsonObject link, String name) {
    JsonValue v = link.get(name);
    if (v == null) {
      return null;
    }
    if (!(v instanceof JsonString s)) {
      throw new IllegalArgumentException("\"" + name + "\" must be a string");
    }
    return s.value().isBlank() ? null : s.value();
  }
}
