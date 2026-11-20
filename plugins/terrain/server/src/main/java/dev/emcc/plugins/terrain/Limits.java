package dev.emcc.plugins.terrain;

import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;

/**
 * The plugin's settings as the server part reads them (the brief's "Settings"). ECore validates them
 * against the manifest's schema before they reach the plugin; a value that is still unusable (a test,
 * or a schema that changed) is replaced by the nearest allowed one, so the plugin never fails on one.
 *
 * @param folder the height data folder's path as set; only for noticing a change, the path is ECore's
 * @param refraction the refraction coefficient k, 0 to 1
 * @param maxRange the longest range, metres
 * @param maxCells the most height cells (raster nodes) one viewshed may need
 * @param timeoutSeconds how long a request may take, 5 to 55 (the endpoint's own timeout is at most 60 s, the SDK's limit)
 * @param cacheBytes the memory of the parsed cells together
 */
record Limits(String folder, double refraction, int maxRange, long maxCells, int timeoutSeconds, long cacheBytes) {

  static Limits read(JsonObject settings) {
    JsonValue folder = settings.get("heightDataFolder");
    return new Limits(
        folder instanceof JsonString s ? s.value() : "",
        number(settings, "refractionCoefficient", 0.13, 0, 1),
        (int) number(settings, "maxRange", 50_000, 1_000, 200_000),
        (long) number(settings, "maxCells", 10_000_000, 100_000, 100_000_000),
        (int) number(settings, "timeoutSeconds", 30, 5, 55),
        (long) number(settings, "cacheMegabytes", 256, 32, 2_048) * 1024 * 1024);
  }

  private static double number(JsonObject settings, String name, double fallback, double min, double max) {
    JsonValue value = settings.get(name);
    if (!(value instanceof JsonNumber n)) {
      return fallback;
    }
    double v = n.doubleValue();
    if (Double.isNaN(v)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, v));
  }
}
