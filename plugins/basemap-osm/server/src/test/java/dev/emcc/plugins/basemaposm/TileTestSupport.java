package dev.emcc.plugins.basemaposm;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.testkit.FakePluginContext;
import java.util.Map;

/** Starts the plugin like the plugin host does, with the manifest's defaults (and overrides), against the fake context. */
final class TileTestSupport {

  static final String HOST = "tile.openstreetmap.org";

  private TileTestSupport() {}

  /** What a real PNG starts with, plus a marker so tests can tell tiles apart. */
  static Bytes png(int marker) {
    return Bytes.of(new byte[] {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n', (byte) marker});
  }

  static String upstreamUrl(int z, int x, int y) {
    return "https://" + HOST + "/" + z + "/" + x + "/" + y + ".png";
  }

  static String path(int z, int x, int y) {
    return "/tiles/" + z + "/" + x + "/" + y + ".png";
  }

  static JsonObject settings(Map<String, JsonValue> overrides) {
    JsonObject settings = Manifest.settingDefaults();
    for (var override : overrides.entrySet()) {
      settings = settings.with(override.getKey(), override.getValue());
    }
    return settings;
  }

  static JsonValue number(long value) {
    return JsonNumber.of(value);
  }

  static JsonValue text(String value) {
    return JsonString.of(value);
  }

  static Plugin newPlugin() throws Exception {
    return (Plugin) Class.forName(Manifest.entryClass()).getConstructor().newInstance();
  }

  static final String OTHER_HOST = "tiles.example.org";
  static final String OTHER_TEMPLATE = "https://" + OTHER_HOST + "/{z}/{x}/{y}.png";

  static FakePluginContext newContext(Map<String, JsonValue> overrides) {
    // OTHER_HOST stands for an upstream an admin moves to in the settings view; the manifest does not list it
    return FakePluginContext.builder(Manifest.id()).settings(settings(overrides)).build();
  }

  static String otherUpstreamUrl(int z, int x, int y) {
    return "https://" + OTHER_HOST + "/" + z + "/" + x + "/" + y + ".png";
  }

  /** The plugin initialised and started like the plugin host does it. */
  static FakePluginContext start(Map<String, JsonValue> overrides) throws Exception {
    FakePluginContext context = newContext(overrides);
    Plugin plugin = newPlugin();
    plugin.init(context);
    plugin.start();
    return context;
  }

  static FakePluginContext start() throws Exception {
    return start(Map.of());
  }

  static Headers pngHeaders() {
    return Headers.of("Content-Type", "image/png");
  }
}
