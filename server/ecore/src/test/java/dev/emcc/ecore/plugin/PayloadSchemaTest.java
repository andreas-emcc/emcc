package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.InvalidDocumentException;
import dev.emcc.ecore.json.ModelJson;
import dev.emcc.sdk.channel.DeclaredItem;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;

/** SDK 1.9.0 (CR-0048 point 4; model rule 23): a declared kind's payload schema, read, compiled and checked. */
class PayloadSchemaTest {

  private static final ModelJson JSON = new ModelJson();
  private static final Path EXAMPLES = Path.of("../../model/examples");
  private static final String KIND = "fmv.camera-pose";

  private static JsonObject payload(String json) {
    return (JsonObject) ModelJson.toJsonValue(JSON.parse(json));
  }

  @Test
  void readsTheExamplesKindWithItsIdAndCompiledSchema() {
    PluginManifest m = PluginManifest.read(EXAMPLES.resolve("valid/manifest-channel-kinds.json"), JSON);

    PluginManifest.ChannelKind pose = m.channelKindsById().get("fmv.camera-pose");
    assertThat(pose.title()).isEqualTo("Camera pose");
    assertThat(pose.description()).startsWith("One simulated camera's pose");
    String camera = "\"camera\":\"6f1c3c2e-6a43-4f7e-9d6b-2b5f0f4f8a11\",\"time\":\"2026-11-17T09:00:00Z\"";
    assertThat(pose.schema().problem(KIND, payload("{" + camera + ",\"platform\":{\"position\":[17.3,62.4,1200],\"heading\":90}}"))).isNull();
    assertThat(pose.schema().problem(KIND, payload("{" + camera + ",\"platform\":{\"position\":[17.3,62.4,1200],\"heading\":360}}")))
        .startsWith("a payload of fmv.camera-pose does not match its schema: /platform/heading: ");
    assertThat(pose.schema().problem(KIND, payload("{\"camera\":\"not a uuid\",\"time\":\"2026-11-17T09:00:00Z\",\"platform\":"
        + "{\"position\":[17.3,62.4,1200],\"heading\":90}}")))
        .as("formats are asserted, as for the model").startsWith("a payload of fmv.camera-pose does not match its schema: /camera: ");
    assertThat(pose.schema().problem(KIND, payload("{" + camera + ",\"platform\":{\"position\":[17.3,62.4,1200],\"heading\":90},\"extra\":1}")))
        .contains("extra");
    assertThat(PluginManifest.read(EXAMPLES.resolve("valid/manifest-basemap-osm.json"), JSON).channelKinds()).isEmpty();
  }

  @Test
  void refusesAPayloadOverItsSizeBeforeItsSchema() {
    PayloadSchema any = PayloadSchema.compile("p.any", JSON.parse("{\"type\":\"object\"}"));
    String fits = "x".repeat(DeclaredItem.MAX_PAYLOAD_BYTES - "{\"a\":\"\"}".length());
    assertThat(any.problem("p.any", payload("{\"a\":\"" + fits + "\"}"))).as("exactly 64 KiB").isNull();
    assertThat(any.problem("p.any", payload("{\"a\":\"" + fits + "x\"}"))).isEqualTo("a payload of p.any is at most 65536 bytes: 65537");
    assertThat(any.problem("p.any", payload("{\"a\":\"" + "å".repeat(40_000) + "\"}"))).as("UTF-8 bytes, not characters")
        .isEqualTo("a payload of p.any is at most 65536 bytes: 80008");
  }

  @Test
  void refusesASchemaThatIsNotSelfContainedOrNamesAnotherDialectOrAnId() {
    for (String[] c : new String[][] {
        {"{\"type\":\"object\",\"properties\":{\"a\":{\"$ref\":\"https://example.org/a.json\"}}}", "/properties/a/$ref: $ref"},
        {"{\"type\":\"object\",\"properties\":{\"a\":{\"$ref\":\"other.json#/x\"}}}", "/properties/a/$ref: $ref"},
        {"{\"type\":\"object\",\"$dynamicRef\":\"https://example.org/meta\"}", "/$dynamicRef: $dynamicRef"},
        {"{\"type\":\"object\",\"$id\":\"https://example.org/pose\"}", "/$id: a payload schema names no $id"},
        {"{\"type\":\"object\",\"$schema\":\"https://json-schema.org/draft-07/schema\"}", "/$schema: $schema is"},
    }) {
      assertThatThrownBy(() -> PayloadSchema.compile("p.k", JSON.parse(c[0]))).as(c[0])
          .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("not self-contained (model rule 23)").hasMessageContaining(c[1]);
    }
    assertThat(PayloadSchema.compile("p.k", JSON.parse("{\"type\":\"object\",\"$schema\":\"" + PayloadSchema.DIALECT + "\"}"))).isNotNull();
    assertThatThrownBy(() -> PayloadSchema.compile("p.k", JSON.parse("{\"type\":\"object\",\"properties\":{\"a\":{\"$ref\":\"#/$defs/missing\"}}}")))
        .as("a $ref inside that points nowhere").isInstanceOf(IllegalArgumentException.class).hasMessageContaining("p.k");
  }

  @Test
  void aPropertyNamedLikeAKeywordAndDataAreNoReferences() {
    PayloadSchema named = PayloadSchema.compile("p.k", JSON.parse("""
        {"type": "object", "properties": {"$ref": {"type": "string"}, "$id": {"type": "object", "properties": {"$schema": {"const": "x"}}}},
         "default": {"$id": "https://example.org/b"}, "examples": [{"$ref": "https://example.org/c"}], "required": ["$ref"],
         "$defs": {"kept": {"enum": [{"$ref": "https://example.org/a"}]}}}"""));
    assertThat(named.problem("p.k", payload("{\"$ref\":\"https://example.org/a\",\"$id\":{\"$schema\":\"x\"}}"))).isNull();
    assertThatThrownBy(() -> PayloadSchema.compile("p.k", JSON.parse(
        "{\"type\":\"object\",\"properties\":{\"$ref\":{\"$ref\":\"https://example.org/a\"}}}")))
        .as("a reference inside a named property's schema still counts").hasMessageContaining("/properties/$ref/$ref: $ref");
  }

  @Test
  void refusesAManifestWithAKindTwiceOrARemoteRef(@TempDir Path dir) throws IOException {
    String kind = "{\"name\":\"pose\",\"title\":\"Pose\",\"description\":\"A pose.\",\"payload\":%s}";
    String manifest = "{\"id\":\"acme-cam\",\"name\":\"Cam\",\"version\":\"0.1.0\",\"sdkVersion\":\"^1.9.0\",\"kind\":\"general\","
        + "\"server\":{\"entryClass\":\"dev.acme.cam.CamPlugin\"},\"channelKinds\":[%s]}";
    Path twice = dir.resolve("twice.json");
    String plain = kind.formatted("{\"type\":\"object\"}");
    Files.writeString(twice, manifest.formatted(plain + "," + plain));
    assertThatThrownBy(() -> PluginManifest.read(twice, JSON)).isInstanceOf(InvalidDocumentException.class)
        .satisfies(e -> assertThat(((InvalidDocumentException) e).problems()).singleElement().asString()
            .contains("/channelKinds/1/name").contains("declared twice"));

    Path remote = dir.resolve("remote.json");
    Files.writeString(remote, manifest.formatted(kind.formatted("{\"type\":\"object\",\"properties\":{\"p\":{\"$ref\":\"https://example.org/p\"}}}")));
    assertThatThrownBy(() -> PluginManifest.read(remote, JSON)).isInstanceOf(InvalidDocumentException.class)
        .satisfies(e -> assertThat(((InvalidDocumentException) e).problems()).singleElement().asString()
            .contains("/channelKinds/0/payload").contains("model rule 23"));
  }

  @Test
  void convertsTheSdksJsonExactly() {
    JsonValue value = ModelJson.toJsonValue(JSON.parse("{\"a\":[1,2.50,\"x\",true,null],\"b\":{\"c\":-7}}"));
    JsonNode node = PayloadSchema.toNode(value);
    assertThat(node.toString()).isEqualTo("{\"a\":[1,2.50,\"x\",true,null],\"b\":{\"c\":-7}}");
  }
}
