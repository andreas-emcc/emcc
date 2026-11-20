package dev.emcc.plugins.cot;

import dev.emcc.sdk.DeclaredField;
import dev.emcc.sdk.FieldSet;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.testkit.TestJson;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.math.BigDecimal;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** The plugin's {@code plugin.json}, read the way the plugin host reads it. */
public final class Manifest {

  /** {@code plugins/<id>/}, found from the compiled tests ({@code plugins/<id>/server/target/test-classes}), so any working directory works. */
  static final Path PLUGIN_FOLDER = pluginFolder();

  private Manifest() {}

  /** The manifest as JSON (public: the codec's palette test reads it). */
  public static JsonObject read() {
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

  /** The fields the manifest declares, as ECore passes them to the store and the editors. */
  static List<DeclaredField> declaredFields() {
    var fields = new ArrayList<DeclaredField>();
    for (var value : ((JsonArray) read().get("fields")).values()) {
      var f = (JsonObject) value;
      var choices = new ArrayList<DeclaredField.Choice>();
      if (f.get("choices") instanceof JsonArray array) {
        for (var choice : array.values()) {
          var c = (JsonObject) choice;
          choices.add(new DeclaredField.Choice(c.getString("value"), c.getString("label")));
        }
      }
      fields.add(new DeclaredField(id(), f.getString("name"), DeclaredField.Type.valueOf(f.getString("type").toUpperCase(java.util.Locale.ROOT)),
          f.getString("label"), f.get("description") instanceof JsonString d ? d.value() : null, f.get("unit") instanceof JsonString u ? u.value() : null,
          f.get("minimum") instanceof JsonNumber n ? new BigDecimal(n.text()) : null, f.get("maximum") instanceof JsonNumber n ? new BigDecimal(n.text()) : null,
          f.get("maxLength") instanceof JsonNumber n ? (int) n.longValueExact() : null, false, choices, f.has("editableByOthers") && f.getBoolean("editableByOthers"),
          List.of()));
    }
    return fields;
  }

  /** The field sets the manifest declares. */
  static List<FieldSet> fieldSets() {
    var sets = new ArrayList<FieldSet>();
    for (var value : ((JsonArray) read().get("fieldSets")).values()) {
      var s = (JsonObject) value;
      var names = new ArrayList<String>();
      for (var name : ((JsonArray) s.get("fields")).values()) {
        names.add(((JsonString) name).value());
      }
      sets.add(new FieldSet(id(), s.getString("id"), s.getString("label"), names));
    }
    return sets;
  }

  /** The data type {@code cot.cot} as the manifest declares it, with the field sets it names (SDK 1.5.0, their full ids). */
  static dev.emcc.sdk.DataType dataType() {
    var declared = (JsonObject) ((JsonArray) read().get("dataTypes")).get(0);
    var sets = new ArrayList<String>();
    for (var name : ((JsonArray) declared.get("fieldSets")).values()) {
      sets.add(id() + "." + ((JsonString) name).value());
    }
    var type = new dev.emcc.sdk.DataType(declared.getString("id"), declared.getString("name"), declared.getString("description"), id(),
        new dev.emcc.sdk.DataType.Defaults(null, true, 600L));
    return type.withFieldSets(sets.toArray(String[]::new));
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
