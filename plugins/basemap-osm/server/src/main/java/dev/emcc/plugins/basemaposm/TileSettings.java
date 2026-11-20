package dev.emcc.plugins.basemaposm;

import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.net.URI;
import java.net.URISyntaxException;
import java.time.Duration;

/**
 * The plugin's settings, checked where they are read. A bad value is reported (the plugin becomes
 * FAILED) instead of failing later on the first tile. A setting that is missing from the document
 * gets the default the manifest declares: ECore replaces the settings as a whole and fills in no
 * defaults, so a document from a script or from an older version may lack a property (the
 * defaults below are checked against {@code plugin.json} by a test).
 *
 * @param upstreamTemplate the upstream URL template with {@code {z}}, {@code {x}} and {@code {y}}
 * @param maxZoom highest zoom level served (0 to 19)
 * @param cacheTiles tiles kept in the cache
 * @param upstreamTimeout how long one upstream request may take
 */
record TileSettings(String upstreamTemplate, int maxZoom, int cacheTiles, Duration upstreamTimeout) {

  static final String DEFAULT_UPSTREAM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  static final int DEFAULT_MAX_ZOOM = 19;
  static final int DEFAULT_CACHE_TILES = 2000;
  static final int DEFAULT_TIMEOUT_SECONDS = 5;

  static final int ABSOLUTE_MAX_ZOOM = 19;
  static final int MAX_CACHE_TILES = 10_000;
  static final int MAX_TIMEOUT_SECONDS = 30;

  /** @throws IllegalArgumentException with a message for the status detail if a setting is bad */
  static TileSettings parse(JsonObject settings) {
    String template = string(settings, "upstreamUrl", DEFAULT_UPSTREAM_URL);
    for (String placeholder : new String[] {"{z}", "{x}", "{y}"}) {
      if (!template.contains(placeholder)) {
        throw new IllegalArgumentException("upstreamUrl needs " + placeholder);
      }
    }
    URI sample = uri(template, new TileKey(0, 0, 0));
    String scheme = sample.getScheme();
    if (sample.getHost() == null || scheme == null || !(scheme.equals("http") || scheme.equals("https"))) {
      throw new IllegalArgumentException("upstreamUrl must be an absolute http or https URL");
    }
    int maxZoom = integer(settings, "maxZoom", DEFAULT_MAX_ZOOM, 0, ABSOLUTE_MAX_ZOOM);
    int cacheTiles = integer(settings, "cacheTiles", DEFAULT_CACHE_TILES, 1, MAX_CACHE_TILES);
    int seconds = integer(settings, "upstreamTimeoutSeconds", DEFAULT_TIMEOUT_SECONDS, 1, MAX_TIMEOUT_SECONDS);
    return new TileSettings(template, maxZoom, cacheTiles, Duration.ofSeconds(seconds));
  }

  /** The upstream URI of a tile: only integers are substituted, so nothing a client sends reaches the URL. */
  URI uriFor(TileKey key) {
    return uri(upstreamTemplate, key);
  }

  private static URI uri(String template, TileKey key) {
    String text = template.replace("{z}", Integer.toString(key.z())).replace("{x}", Integer.toString(key.x())).replace("{y}", Integer.toString(key.y()));
    try {
      return new URI(text);
    } catch (URISyntaxException e) {
      throw new IllegalArgumentException("upstreamUrl is not a valid URL: " + e.getReason());
    }
  }

  private static String string(JsonObject settings, String name, String fallback) {
    JsonValue value = settings.get(name);
    if (value == null) {
      return fallback;
    }
    if (!(value instanceof JsonString text) || text.value().isBlank()) {
      throw new IllegalArgumentException(name + " must be a non-empty string");
    }
    return text.value();
  }

  private static int integer(JsonObject settings, String name, int fallback, int min, int max) {
    JsonValue value = settings.get(name);
    if (value == null) {
      return fallback;
    }
    if (!(value instanceof JsonNumber number)) {
      throw new IllegalArgumentException(name + " must be a number");
    }
    long n;
    try {
      n = number.longValueExact();
    } catch (ArithmeticException e) {
      throw new IllegalArgumentException(name + " must be an integer");
    }
    if (n < min || n > max) {
      throw new IllegalArgumentException(name + " must be " + min + " to " + max);
    }
    return (int) n;
  }
}
