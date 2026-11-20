package dev.emcc.ecore.plugin;

import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.jspecify.annotations.Nullable;

/**
 * The endpoints a plugin's listeners may connect to: those found in its current settings at the
 * places its manifest's {@code network.endpoints} names (JSON Pointers to an object with {@code host}
 * and {@code port}, or to an array of them). Host names compare without case.
 */
final class NetworkEndpoints {

  record Endpoint(String host, int port) {}

  private NetworkEndpoints() {}

  static Set<Endpoint> in(JsonObject settings, List<String> pointers) {
    Set<Endpoint> endpoints = new LinkedHashSet<>();
    for (String pointer : pointers) {
      JsonValue value = settings;
      for (String name : pointer.substring(1).split("/")) {
        value = value instanceof JsonObject o ? o.get(name) : null;
        if (value == null) {
          break;
        }
      }
      if (value instanceof JsonArray array) {
        array.values().forEach(v -> add(v, endpoints));
      } else if (value != null) {
        add(value, endpoints);
      }
    }
    return endpoints;
  }

  static boolean allows(JsonObject settings, List<String> pointers, String host, int port) {
    return in(settings, pointers).contains(new Endpoint(host.toLowerCase(Locale.ROOT), port));
  }

  private static void add(@Nullable JsonValue value, Set<Endpoint> endpoints) {
    if (value instanceof JsonObject o && o.get("host") instanceof JsonString host && o.get("port") instanceof JsonNumber port) {
      try {
        endpoints.add(new Endpoint(host.value().toLowerCase(Locale.ROOT), port.bigDecimalValue().intValueExact()));
      } catch (ArithmeticException e) {
        // not a port number: not an endpoint
      }
    }
  }
}
