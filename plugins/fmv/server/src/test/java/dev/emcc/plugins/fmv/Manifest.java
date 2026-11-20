package dev.emcc.plugins.fmv;

import dev.emcc.sdk.DataType;
import dev.emcc.sdk.DeclaredField;
import dev.emcc.sdk.FieldSet;
import dev.emcc.sdk.RelationKind;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.TestJson;
import java.util.List;
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

  /**
   * The manifest's {@code dataTypes}, as ECore builds them (the constructor checks them): from SDK
   * 1.5.0 with their field sets as full ids ({@code <plugin-id>.<id>}), {@code manual} (true when absent) and
   * {@code sensorReport} (false when absent).
   */
  static DataType[] dataTypes() {
    return array(read(), "dataTypes").stream().map(v -> {
      JsonObject t = (JsonObject) v;
      JsonObject d = t.getObject("defaults");
      // Absent members mean: never expires, not faded, never removed (fmv's data types: brief F2).
      var defaults = new DataType.Defaults(
          d.has("expiresAfterSeconds") ? d.getNumber("expiresAfterSeconds").longValueExact() : null,
          d.has("fadeWhenExpired") && d.getBoolean("fadeWhenExpired"),
          d.has("removeAfterExpirySeconds") ? d.getNumber("removeAfterExpirySeconds").longValueExact() : null);
      List<String> sets = t.has("fieldSets") ? array(t, "fieldSets").stream().map(s -> id() + "." + ((JsonString) s).value()).toList() : List.of();
      boolean manual = !t.has("manual") || t.getBoolean("manual");
      boolean sensorReport = t.has("sensorReport") && t.getBoolean("sensorReport");
      return new DataType(t.getString("id"), t.getString("name"), t.getString("description"), id(), defaults, sets, manual, sensorReport);
    }).toArray(DataType[]::new);
  }

  /** The manifest's {@code fields}, as ECore builds them. */
  static DeclaredField[] declaredFields() {
    return array(read(), "fields").stream().map(v -> {
      JsonObject f = (JsonObject) v;
      return new DeclaredField(
          id(), f.getString("name"), DeclaredField.Type.valueOf(f.getString("type").toUpperCase(java.util.Locale.ROOT)), f.getString("label"),
          f.has("description") ? f.getString("description") : null, f.has("unit") ? f.getString("unit") : null,
          f.has("minimum") ? f.getNumber("minimum").bigDecimalValue() : null, f.has("maximum") ? f.getNumber("maximum").bigDecimalValue() : null,
          f.has("maxLength") ? (int) f.getNumber("maxLength").longValueExact() : null, f.has("required") && f.getBoolean("required"),
          List.of(), f.has("editableByOthers") && f.getBoolean("editableByOthers"), List.of());
    }).toArray(DeclaredField[]::new);
  }

  /** The manifest's {@code fieldSets}, as ECore builds them. */
  static FieldSet[] fieldSets() {
    return array(read(), "fieldSets").stream().map(v -> {
      JsonObject s = (JsonObject) v;
      List<String> fields = array(s, "fields").stream().map(f -> ((JsonString) f).value()).toList();
      return new FieldSet(id(), s.getString("id"), s.getString("label"), fields);
    }).toArray(FieldSet[]::new);
  }

  /** The manifest's {@code relationKinds}, as ECore builds them; from SDK 1.6.0 with {@code strokeColorSetting}. */
  static RelationKind[] relationKinds() {
    return array(read(), "relationKinds").stream().map(v -> {
      JsonObject k = (JsonObject) v;
      JsonObject line = k.getObject("line");
      var l = RelationKind.Line.of(line.getString("strokeColor"), line.getNumber("strokeWidth").doubleValue(), null, null);
      if (line.get("strokeColorSetting") != null) {
        l = l.withStrokeColorSetting(line.getString("strokeColorSetting"));
      }
      return new RelationKind(k.getString("id"), k.getString("label"), l, k.getBoolean("defaultOn"));
    }).toArray(RelationKind[]::new);
  }

  /** A test context built from the manifest: its settings' defaults, data types, fields, field sets and relation kinds. */
  static FakePluginContext.Builder context() {
    return FakePluginContext.builder(id())
        .settings(settingDefaults())
        .dataTypes(dataTypes())
        .declaredFields(declaredFields())
        .fieldSets(fieldSets())
        .relationKinds(relationKinds());
  }

  private static List<JsonValue> array(JsonObject o, String name) {
    return ((JsonArray) o.get(name)).values();
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
