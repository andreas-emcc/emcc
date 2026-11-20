package dev.emcc.plugins.basemapwms;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Builds the URI of a request to a WMS server: the saved server's address with the plugin's own parameters added, in the
 * order given. A parameter of the plugin's that the address already has in its query is replaced (compared ignoring case);
 * every other part of the address stays as it is, and a fragment is dropped.
 */
final class WmsUrl {

  /** The parameters the plugin sets itself, upper case. */
  private static final Set<String> OWN = Set.of(
      "SERVICE", "VERSION", "REQUEST", "LAYERS", "STYLES", "FORMAT", "TRANSPARENT", "CRS", "SRS", "BBOX", "WIDTH", "HEIGHT");

  private static final String HEX = "0123456789ABCDEF";

  private WmsUrl() {}

  /** One parameter to add; the value is percent-encoded here. */
  record Param(String name, String value) {}

  /** Whether {@link #build} accepts the address. */
  static boolean isUsable(String address) {
    try {
      build(address, List.of(new Param("SERVICE", "WMS")));
      return true;
    } catch (IllegalArgumentException e) {
      return false;
    }
  }

  /** @throws IllegalArgumentException if the result is not a valid {@code http} or {@code https} URI */
  static URI build(String address, List<Param> params) {
    String base = address;
    int fragment = base.indexOf('#');
    if (fragment >= 0) {
      base = base.substring(0, fragment);
    }
    String path = base;
    String query = "";
    int question = base.indexOf('?');
    if (question >= 0) {
      path = base.substring(0, question);
      query = base.substring(question + 1);
    }
    List<String> parts = new ArrayList<>();
    for (String pair : query.split("&")) {
      if (pair.isEmpty()) {
        continue;
      }
      int equals = pair.indexOf('=');
      String name = (equals < 0 ? pair : pair.substring(0, equals)).toUpperCase(Locale.ROOT);
      if (!OWN.contains(name)) {
        parts.add(pair);
      }
    }
    for (Param p : params) {
      parts.add(p.name() + "=" + encode(p.value()));
    }
    URI uri = URI.create(path + "?" + String.join("&", parts));
    String scheme = uri.getScheme();
    if (scheme == null || !(scheme.equals("http") || scheme.equals("https")) || uri.getHost() == null) {
      throw new IllegalArgumentException("not an http or https address");
    }
    return uri;
  }

  /** Percent-encodes UTF-8 bytes except unreserved characters and {@code : , /}, which WMS values use as they are. */
  static String encode(String value) {
    StringBuilder out = new StringBuilder();
    for (byte b : value.getBytes(StandardCharsets.UTF_8)) {
      int c = b & 0xFF;
      boolean plain = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || "-._~:,/".indexOf(c) >= 0;
      if (plain) {
        out.append((char) c);
      } else {
        out.append('%').append(HEX.charAt(c >> 4)).append(HEX.charAt(c & 15));
      }
    }
    return out.toString();
  }
}
