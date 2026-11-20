package dev.emcc.plugins.nvg;

import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.testkit.TestJson;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;

/** The plugin's {@code plugin.json}, read the way the plugin host reads it. */
final class Manifest {

  /** {@code plugins/<id>/}, found from the compiled tests ({@code plugins/<id>/server/target/test-classes}), so any working directory works. */
  static final Path PLUGIN_FOLDER = pluginFolder();

  private Manifest() {}

  static JsonObject read() {
    try {
      return (JsonObject) TestJson.parse(Files.readString(PLUGIN_FOLDER.resolve("plugin.json")));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  static String id() {
    return read().getString("id");
  }

  static String entryClass() {
    return read().getObject("server").getString("entryClass");
  }

  /** The settings as the plugin host passes them when nothing is configured: the default of every setting. */
  static JsonObject settingDefaults() {
    var defaults = JsonObject.builder();
    read().getObject("settings").getObject("properties").members().forEach((name, schema) -> {
      JsonValue value = ((JsonObject) schema).get("default");
      if (value == null) {
        throw new IllegalStateException("setting " + name + " has no default");
      }
      defaults.put(name, value);
    });
    return defaults.build();
  }

  private static Path pluginFolder() {
    try {
      Path testClasses = Path.of(Manifest.class.getProtectionDomain().getCodeSource().getLocation().toURI());
      Path folder = testClasses.getParent().getParent().getParent();
      if (!Files.isRegularFile(folder.resolve("plugin.json"))) {
        throw new IllegalStateException("no plugin.json in " + folder + " (tests run from plugins/<id>/server/target/test-classes)");
      }
      return folder;
    } catch (URISyntaxException e) {
      throw new IllegalStateException(e);
    }
  }
}
