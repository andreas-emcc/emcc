package dev.emcc.plugins.basemapwms;

import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * The plugin's settings as the server part uses them. ECore has checked the form against the manifest's schema; what the
 * schema cannot check (unique ids, a background's server exists) is named in {@link #problems}. A property that is
 * absent takes the manifest's default.
 *
 * @param servers the usable servers, in settings order
 * @param backgrounds the backgrounds, in settings order, also those whose server is not configured
 * @param problems what is wrong with the values as saved, for the plugin's status
 */
record WmsSettings(List<Server> servers, List<Background> backgrounds, List<String> problems) {

  static final String DEFAULT_VERSION = "1.3.0";
  static final int DEFAULT_TIMEOUT_SECONDS = 8;
  static final String DEFAULT_FORMAT = "image/png";

  WmsSettings {
    servers = List.copyOf(servers);
    backgrounds = List.copyOf(backgrounds);
    problems = List.copyOf(problems);
  }

  /**
   * A server.
   *
   * @param version {@code 1.3.0} or {@code 1.1.1}
   * @param timeoutSeconds 1 to 20
   */
  record Server(String id, String name, String url, String version, int timeoutSeconds) {}

  /**
   * A background: one server, its layers bottom first, and the image format.
   *
   * @param serverId the id of the background's server
   */
  record Background(String id, String name, String serverId, List<String> layers, String format, boolean transparent) {
    Background {
      layers = List.copyOf(layers);
    }
  }

  static WmsSettings empty() {
    return new WmsSettings(List.of(), List.of(), List.of());
  }

  /** @throws IllegalArgumentException if a value has the wrong type, naming it */
  static WmsSettings parse(JsonObject raw) {
    List<String> problems = new ArrayList<>();
    List<Server> servers = new ArrayList<>();
    Map<String, Server> byId = new HashMap<>();
    for (JsonValue item : list(raw, "servers")) {
      JsonObject o = object(item, "servers");
      String id = string(o, "id", null);
      String protocol = string(o, "protocol", "wms");
      if (!protocol.equals("wms")) {
        throw new IllegalArgumentException("server " + id + ": protocol must be \"wms\"");
      }
      Server server = new Server(id, string(o, "name", id), string(o, "url", null), string(o, "version", DEFAULT_VERSION), integer(o, "timeoutSeconds", DEFAULT_TIMEOUT_SECONDS));
      if (byId.containsKey(id)) {
        problems.add("server " + id + " is listed twice; the first is used");
      } else if (!WmsUrl.isUsable(server.url())) {
        problems.add("server " + id + ": the address is not usable");
      } else {
        byId.put(id, server);
        servers.add(server);
      }
    }
    List<Background> backgrounds = new ArrayList<>();
    Map<String, Background> seen = new HashMap<>();
    for (JsonValue item : list(raw, "backgrounds")) {
      JsonObject o = object(item, "backgrounds");
      String id = string(o, "id", null);
      List<String> layers = new ArrayList<>();
      for (JsonValue layer : list(o, "layers")) {
        if (!(layer instanceof JsonString s)) {
          throw new IllegalArgumentException("backgrounds: a layer is not a string");
        }
        layers.add(s.value());
      }
      Background background = new Background(
          id, string(o, "name", id), string(o, "server", null), layers, string(o, "format", DEFAULT_FORMAT), bool(o, "transparent"));
      if (seen.containsKey(id)) {
        problems.add("background " + id + " is listed twice; the first is used");
        continue;
      }
      seen.put(id, background);
      backgrounds.add(background);
      if (!byId.containsKey(background.serverId())) {
        problems.add("background " + id + ": its server " + background.serverId() + " is not configured");
      }
    }
    return new WmsSettings(servers, backgrounds, problems);
  }

  private static List<JsonValue> list(JsonObject o, String name) {
    JsonValue v = o.get(name);
    if (v == null) {
      return List.of();
    }
    if (v instanceof JsonArray a) {
      return a.values();
    }
    throw new IllegalArgumentException(name + " must be an array");
  }

  private static JsonObject object(JsonValue v, String where) {
    if (v instanceof JsonObject o) {
      return o;
    }
    throw new IllegalArgumentException(where + ": an entry is not an object");
  }

  /** @param fallback the default, or {@code null} when the property is required */
  private static String string(JsonObject o, String name, @Nullable String fallback) {
    JsonValue v = o.get(name);
    if (v == null) {
      if (fallback == null) {
        throw new IllegalArgumentException("a required property is missing: " + name);
      }
      return fallback;
    }
    if (v instanceof JsonString s) {
      return s.value();
    }
    throw new IllegalArgumentException(name + " must be a string");
  }

  private static int integer(JsonObject o, String name, int fallback) {
    JsonValue v = o.get(name);
    if (v == null) {
      return fallback;
    }
    if (v instanceof JsonNumber n) {
      try {
        return Math.toIntExact(n.longValueExact());
      } catch (ArithmeticException e) {
        throw new IllegalArgumentException(name + " must be a whole number", e);
      }
    }
    throw new IllegalArgumentException(name + " must be a number");
  }

  private static boolean bool(JsonObject o, String name) {
    JsonValue v = o.get(name);
    if (v == null) {
      return false;
    }
    if (v instanceof JsonBoolean b) {
      return b.value();
    }
    throw new IllegalArgumentException(name + " must be true or false");
  }
}
