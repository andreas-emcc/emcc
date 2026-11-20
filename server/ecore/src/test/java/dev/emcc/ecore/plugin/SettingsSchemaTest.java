package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.json.Problem;
import dev.emcc.sdk.LayerChoice;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Settings schemas with the SDK's annotations, as ECore compiles and validates them. */
class SettingsSchemaTest {

  private static final ModelJson JSON = new ModelJson();
  /** The model's example of the layer picker (SDK 1.2.0, ADR-0037 point 2): {@code x-emc2} on {@code {id?, name}}. */
  private static final PluginManifest PICKER = PluginManifest.read(Path.of("../../model/examples/valid/manifest-layer-picker.json"), JSON);
  private static final SettingsSchema SCHEMA = SettingsSchema.compile(PICKER.id(), PICKER.settingsSchema());

  private static JsonObject values(String json) {
    return (JsonObject) ModelJson.toJsonValue(JSON.parse(json));
  }

  private static List<Problem> problems(String json) {
    return SCHEMA.validate(values(json), JSON);
  }

  @Test
  void theLayerPickersAnnotationCompilesAndItsDefaultsAreValid() {
    assertThat(SCHEMA.validate(PICKER.settings(), JSON)).isEmpty();
    assertThat(PICKER.settings()).isEqualTo(values("{\"links\": []}"));
  }

  /** The settings dialect, but an unknown keyword stops the compile (the real one logs a warning and ignores it). */
  private static final com.networknt.schema.dialect.Dialect STRICT = com.networknt.schema.dialect.Dialect.builder(SettingsSchema.SETTINGS_DIALECT)
      .unknownKeywordFactory((keyword, context) -> {
        throw new IllegalStateException("unknown keyword " + keyword);
      }).build();

  private static final String PICKER_PROPERTY =
      "\"layer\": {\"type\": \"object\", \"x-emc2\": {\"kind\": \"layer\"}, \"properties\": {\"name\": {\"type\": \"string\"}}, \"required\": [\"name\"]}";

  @Test
  void xEmc2IsADeclaredAnnotationNotAnUnknownKeywordAlsoUnderTheSchemasOwn2020Dash12() {
    String withDialect = "{\"$schema\": \"https://json-schema.org/draft/2020-12/schema\", \"type\": \"object\", \"properties\": {" + PICKER_PROPERTY + "}}";
    String without = "{\"type\": \"object\", \"properties\": {" + PICKER_PROPERTY + "}}";

    for (String schema : List.of(withDialect, without)) {
      SettingsSchema strict = SettingsSchema.compile("cot", JSON.parse(schema), STRICT); // would throw for an unknown x-emc2
      assertThat(strict.validate(values("{\"layer\": {\"name\": \"Tracks\"}}"), JSON)).isEmpty();
      assertThat(strict.validate(values("{\"layer\": {}}"), JSON)).extracting(Problem::path).containsExactly("/layer");
    }
    String other = "{\"type\": \"object\", \"x-foo\": 1}";
    assertThatThrownBy(() -> SettingsSchema.compile("cot", JSON.parse(other), STRICT)).as("the strict check works")
        .hasStackTraceContaining("unknown keyword x-foo");
    assertThat(SettingsSchema.compile("cot", JSON.parse(other)).validate(values("{}"), JSON)).as("other unknown keywords: ignored, as before")
        .isEmpty();
  }

  @Test
  void aPickedLayerANewOneOrNoneIsValidAndAPickWithoutANameIsNot() {
    String id = UUID.randomUUID().toString();
    String picked = """
        {"links": [{"name": "tak-north", "direction": "both", "targetLayer": {"id": "%s", "name": "Tracks"},
                    "sourceLayers": [{"id": "%s", "name": "Units"}]}]}""".formatted(id, id);

    assertThat(problems(picked)).isEmpty();
    assertThat(problems("{\"links\": [{\"name\": \"tak-south\", \"direction\": \"in\", \"targetLayer\": {\"name\": \"New tracks\"}}]}"))
        .as("New layer: a name, no id").isEmpty();
    assertThat(problems("{\"links\": [{\"name\": \"tak-east\", \"direction\": \"out\"}]}")).as("none picked: no default needed").isEmpty();
    assertThat(problems("{\"links\": [{\"name\": \"tak-west\", \"direction\": \"in\", \"targetLayer\": {\"id\": \"%s\"}}]}".formatted(id)))
        .extracting(Problem::path).containsExactly("/links/0/targetLayer");
    assertThat(problems("{\"links\": [{\"name\": \"x\", \"direction\": \"in\", \"targetLayer\": {\"name\": \"\"}}]}"))
        .extracting(Problem::path).containsExactly("/links/0/targetLayer/name");

    JsonObject link = (JsonObject) ((JsonArray) values(picked).get("links")).get(0);
    LayerChoice choice = LayerChoice.from(link.get("targetLayer"));
    assertThat(choice).isEqualTo(new LayerChoice(UUID.fromString(id), "Tracks"));
  }

  @Test
  void aHiddenFieldIsStillValidatedAndAnIfThensRequiredIsReportedAtTheItem() {
    // SDK 1.5.0 part 4 (CR-0039 point 8): visibleWhen is an annotation; the shell shows these problems (A2)
    PluginManifest gmti = PluginManifest.read(Path.of("../../model/examples/valid/manifest-settings-visible-when.json"), JSON);
    SettingsSchema schema = SettingsSchema.compile(gmti.id(), gmti.settingsSchema());

    assertThat(schema.validate(values("{\"links\": [{\"name\": \"north\", \"mode\": \"tcp-server\", \"listen\": {\"port\": 4607}, \"port\": 0}]}"), JSON))
        .as("a hidden port is still checked").extracting(Problem::path).containsExactly("/links/0/port");
    assertThat(schema.validate(values("{\"links\": [{\"name\": \"north\", \"mode\": \"tcp-server\"}]}"), JSON))
        .as("the if/then's required, at the item").extracting(Problem::path).containsExactly("/links/0");
    assertThat(schema.validate(values("{\"links\": [{\"name\": \"north\", \"host\": \"tak\", \"port\": 8087}]}"), JSON)).isEmpty();
  }
}
