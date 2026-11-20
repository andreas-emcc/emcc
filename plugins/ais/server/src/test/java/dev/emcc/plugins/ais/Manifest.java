package dev.emcc.plugins.ais;

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

  /** The manifest's {@code fields}, as ECore builds them. */
  static dev.emcc.sdk.DeclaredField[] declaredFields() {
    return array("fields").stream().map(v -> {
      JsonObject f = (JsonObject) v;
      var choices = f.has("choices")
          ? array(f, "choices").stream().map(c -> new dev.emcc.sdk.DeclaredField.Choice(((JsonObject) c).getString("value"), ((JsonObject) c).getString("label"))).toList()
          : java.util.List.<dev.emcc.sdk.DeclaredField.Choice>of();
      return new dev.emcc.sdk.DeclaredField(
          id(), f.getString("name"), dev.emcc.sdk.DeclaredField.Type.valueOf(f.getString("type").toUpperCase(java.util.Locale.ROOT)), f.getString("label"),
          f.has("description") ? f.getString("description") : null, f.has("unit") ? f.getString("unit") : null,
          f.has("minimum") ? f.getNumber("minimum").bigDecimalValue() : null, f.has("maximum") ? f.getNumber("maximum").bigDecimalValue() : null,
          f.has("maxLength") ? (int) f.getNumber("maxLength").longValueExact() : null, f.has("required") && f.getBoolean("required"),
          choices, f.has("editableByOthers") && f.getBoolean("editableByOthers"), java.util.List.of());
    }).toArray(dev.emcc.sdk.DeclaredField[]::new);
  }

  /** The manifest's {@code dataTypes}, as ECore builds them: the sets named by short id become full ids. */
  static dev.emcc.sdk.DataType[] dataTypes() {
    return array("dataTypes").stream().map(v -> {
      JsonObject t = (JsonObject) v;
      JsonObject d = (JsonObject) t.get("defaults");
      var sets = t.has("fieldSets") ? array(t, "fieldSets").stream().map(f -> id() + "." + ((dev.emcc.sdk.json.JsonString) f).value()).toList() : java.util.List.<String>of();
      return new dev.emcc.sdk.DataType(t.getString("id"), t.getString("name"), t.has("description") ? t.getString("description") : null, id(),
          new dev.emcc.sdk.DataType.Defaults(d.getNumber("expiresAfterSeconds").longValueExact(), d.getBoolean("fadeWhenExpired"),
              d.getNumber("removeAfterExpirySeconds").longValueExact()), sets, !t.has("manual") || t.getBoolean("manual"));
    }).toArray(dev.emcc.sdk.DataType[]::new);
  }

  /** The manifest's {@code fieldSets}, as ECore builds them. */
  static dev.emcc.sdk.FieldSet[] fieldSets() {
    return array("fieldSets").stream().map(v -> {
      JsonObject s = (JsonObject) v;
      return new dev.emcc.sdk.FieldSet(id(), s.getString("id"), s.getString("label"), array(s, "fields").stream().map(f -> ((dev.emcc.sdk.json.JsonString) f).value()).toList());
    }).toArray(dev.emcc.sdk.FieldSet[]::new);
  }

  private static java.util.List<JsonValue> array(String name) {
    return array(read(), name);
  }

  private static java.util.List<JsonValue> array(JsonObject o, String name) {
    return ((dev.emcc.sdk.json.JsonArray) o.get(name)).values();
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
