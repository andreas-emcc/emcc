package dev.emcc.ecore.plugin;

import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketAddress;

/**
 * The text of a task's listening address or peer for the monitor view (ADR-0036 point 6): the
 * address first, since that is what the SRA compares with the settings, then the name the plugin
 * gave, if any (owner, 2026-10-27; the ITA's finding: Java's own text reads {@code /127.0.0.1:55144}).
 * It never looks a name up.
 *
 * <ul>
 *   <li>{@code 127.0.0.1:55144}, {@code 0.0.0.0:5000}
 *   <li>{@code [::1]:5000}, {@code [fe80::1%3]:5000} (IPv6 shortened as in RFC 5952)
 *   <li>{@code 10.0.0.5:8089 (tak.example)} when the plugin connected by a name
 *   <li>{@code tak.example:8089} when the name is not resolved
 *   <li>any other kind of address, such as a Unix domain socket's, as Java writes it
 * </ul>
 */
final class SocketAddressText {

  private SocketAddressText() {}

  static String of(SocketAddress address) {
    if (!(address instanceof InetSocketAddress socket)) {
      return String.valueOf(address);
    }
    String name = socket.getHostString(); // the name given, or the address's text: no lookup
    InetAddress ip = socket.getAddress();
    if (ip == null) {
      return withPort(name, socket.getPort());
    }
    String literal = ip.getHostAddress();
    String shown = ip instanceof Inet6Address ? shortened(literal) : literal;
    String text = withPort(shown, socket.getPort());
    // No name when it is the address's own text; a name that only looks like one is still shown (review, 1).
    return name.equalsIgnoreCase(literal) || name.equalsIgnoreCase(shown) ? text : text + " (" + name + ")";
  }

  private static String withPort(String host, int port) {
    return (host.indexOf(':') >= 0 ? "[" + host + "]" : host) + ":" + port;
  }

  /**
   * Java's eight groups ({@code 0:0:0:0:0:0:0:1}) with the longest run of two or more zero groups as
   * {@code ::}, the first of equal ones. An IPv4-mapped address keeps hex groups ({@code ::ffff:102:304}),
   * not RFC 5952's dotted tail; Java makes nearly all of those IPv4 addresses anyway.
   */
  static String shortened(String full) {
    int percent = full.indexOf('%');
    String zone = percent < 0 ? "" : full.substring(percent);
    String[] groups = (percent < 0 ? full : full.substring(0, percent)).split(":");
    int bestStart = -1;
    int bestLength = 1;
    for (int i = 0; i < groups.length; ) {
      if (!groups[i].equals("0")) {
        i++;
        continue;
      }
      int j = i;
      while (j < groups.length && groups[j].equals("0")) {
        j++;
      }
      if (j - i > bestLength) {
        bestStart = i;
        bestLength = j - i;
      }
      i = j;
    }
    if (bestStart < 0) {
      return String.join(":", groups) + zone;
    }
    String head = String.join(":", java.util.Arrays.copyOfRange(groups, 0, bestStart));
    String tail = String.join(":", java.util.Arrays.copyOfRange(groups, bestStart + bestLength, groups.length));
    return head + "::" + tail + zone;
  }
}
