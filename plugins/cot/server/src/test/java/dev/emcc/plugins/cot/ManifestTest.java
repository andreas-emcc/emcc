package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** What the manifest declares for M3 (brief functions 11 and 12, criterion 24). */
class ManifestTest {

  @Test
  void itNeedsSdk140AndDeclaresItsConnectionsInsteadOfNetwork() {
    JsonObject manifest = Manifest.read();
    assertThat(manifest.getString("sdkVersion")).isEqualTo("^1.9.0");
    assertThat(manifest.get("network")).as("no listener any more").isNull();
    JsonArray connections = (JsonArray) manifest.get("connections");
    assertThat(connections.size()).isEqualTo(1);
    var declared = (JsonObject) connections.get(0);
    assertThat(declared.getString("settings")).isEqualTo("/links");
    assertThat(((JsonArray) declared.get("kinds")).values().stream().map(v -> ((dev.emcc.sdk.json.JsonString) v).value()).toList())
        .containsExactlyInAnyOrder("tcp-client", "udp", "multicast");
    assertThat(manifest.get("internet")).as("no internet declaration").isNull();
  }

  @Test
  void theSettingsHaveLinksAndNoStreamsAndTheTopLevelIsOpenSoStoredStreamsStillValidate() {
    JsonObject settings = Manifest.read().getObject("settings");
    JsonObject properties = settings.getObject("properties");
    assertThat(properties.names()).contains("links", "idleTimeoutSeconds", "writeStallSeconds", "maxEventBytes", "sendPresence", "presenceCallsign").doesNotContain("streams");
    // ECore uses stored settings only if they validate: an old 'streams' entry must not make them invalid, or the plugin could not say it found them.
    assertThat(settings.get("additionalProperties")).isNotEqualTo(JsonBoolean.of(false));
  }

  @Test
  void aLinkIsPickedWithTheLayerPickerAndItsTransportsAreTheFourOfTheBrief() {
    JsonObject link = Manifest.read().getObject("settings").getObject("properties").getObject("links").getObject("items").getObject("properties");
    assertThat(link.getObject("targetLayer").getObject("x-emc2").getString("kind")).isEqualTo("layer");
    assertThat(((JsonArray) link.getObject("transport").get("enum")).values().stream().map(v -> ((dev.emcc.sdk.json.JsonString) v).value()).toList())
        .isEqualTo(List.of("tcp", "tls", "udp", "multicast"));
    assertThat(link.getObject("transport").getString("default")).isEqualTo("tcp");
  }

  @Test
  void itIsIngoingAndOutgoingAndDeclaresConnectionsInBothDirections() {
    JsonObject manifest = Manifest.read();
    assertThat(((JsonArray) manifest.get("properties")).values().stream().map(v -> ((dev.emcc.sdk.json.JsonString) v).value()).toList())
        .containsExactly("ingoing", "outgoing");
    assertThat(((JsonObject) ((JsonArray) manifest.get("connections")).get(0)).getString("direction")).isEqualTo("both");
  }

  @Test
  void anOutputLinkHasSourceLayersOfExistingLayersOnlyAndALimitAndTheTimes() {
    JsonObject link = Manifest.read().getObject("settings").getObject("properties").getObject("links").getObject("items").getObject("properties");
    assertThat(link.getObject("sourceLayers").getObject("items").getObject("x-emc2").getBoolean("allowNew")).as("existing layers only").isFalse();
    assertThat(link.getObject("highestClassification").get("default")).as("absent: the server's default label").isNull();
    assertThat(link.getObject("staleSeconds").getNumber("default").longValueExact()).isEqualTo(60);
    assertThat(link.getObject("refreshSeconds").getNumber("default").longValueExact()).isEqualTo(30);
    assertThat(((JsonArray) link.getObject("direction").get("enum")).values().stream().map(v -> ((dev.emcc.sdk.json.JsonString) v).value()).toList())
        .containsExactly("in", "out", "both");
  }

  // ---------------------------------------------------------------- criterion 31: greyed link fields (M4, T-107)

  private static List<String> strings(JsonValue array) {
    return ((JsonArray) array).values().stream().map(v -> ((dev.emcc.sdk.json.JsonString) v).value()).toList();
  }

  /** The {@code enabledWhen} of every link field: "property=a,b" (a field's own annotation, or its array items' if the field has none). */
  private static Map<String, String> enabledWhenOfTheLinkFields() {
    JsonObject link = Manifest.read().getObject("settings").getObject("properties").getObject("links").getObject("items").getObject("properties");
    var found = new LinkedHashMap<String, String>();
    for (var field : link.members().entrySet()) {
      var annotation = ((JsonObject) field.getValue()).get("x-emc2") instanceof JsonObject a ? a : null;
      if (annotation != null && annotation.get("enabledWhen") != null) {
        JsonObject when = annotation.getObject("enabledWhen");
        assertThat(when.names()).as(field.getKey() + ": the shape").containsExactlyInAnyOrder("property", "in");
        found.put(field.getKey(), when.getString("property") + "=" + String.join(",", strings(when.get("in"))));
      }
    }
    return found;
  }

  @Test
  void criterion31_everyEnabledWhenNamesDirectionOrTransportAndListsOnlyValuesOfItsEnum() {
    JsonObject link = Manifest.read().getObject("settings").getObject("properties").getObject("links").getObject("items").getObject("properties");
    var seen = 0;
    for (var field : link.members().entrySet()) {
      var annotation = ((JsonObject) field.getValue()).get("x-emc2") instanceof JsonObject a ? a : null;
      if (annotation == null || annotation.get("enabledWhen") == null) {
        continue;
      }
      seen++;
      JsonObject when = annotation.getObject("enabledWhen");
      String property = when.getString("property");
      assertThat(property).as(field.getKey() + " is greyed by").isIn("direction", "transport");
      List<String> values = strings(when.get("in"));
      assertThat(values).as(field.getKey() + ": one to 32 values").isNotEmpty().hasSizeLessThanOrEqualTo(32).doesNotHaveDuplicates();
      assertThat(strings(link.getObject(property).get("enum"))).as(field.getKey() + ": only values of " + property).containsAll(values);
      assertThat(link.getObject(property).get("x-emc2") instanceof JsonObject a ? a.get("enabledWhen") : null).as(property + " itself is never greyed").isNull();
    }
    assertThat(seen).isEqualTo(enabledWhenOfTheLinkFields().size()).isGreaterThan(0);
  }

  @Test
  void criterion31_theFieldsOnlySomeLinksUseAreGreyedAsTheBriefSays() {
    var out = "direction=out,both";
    var in = "direction=in,both";
    assertThat(enabledWhenOfTheLinkFields()).containsExactlyInAnyOrderEntriesOf(Map.of(
        "targetLayer", in, "label", in,
        "sourceLayers", out, "highestClassification", out, "staleSeconds", out, "refreshSeconds", out,
        "host", "transport=tcp,tls,udp", "address", "transport=udp,multicast", "interface", "transport=multicast",
        "tlsCredential", "transport=tls")); // M9, function 33
  }

  @Test
  void criterion31_theLayerPickersKeepTheirKindAndAGreyedFieldHasNoDefaultOrRuleOfItsOwnBeyondTheSchema() {
    JsonObject link = Manifest.read().getObject("settings").getObject("properties").getObject("links").getObject("items").getObject("properties");
    assertThat(link.getObject("targetLayer").getObject("x-emc2").getString("kind")).isEqualTo("layer");
    assertThat(link.getObject("sourceLayers").getObject("x-emc2").get("kind")).as("the array carries its hint, its item words and enabledWhen, no kind").isNull();
    assertThat(link.getObject("sourceLayers").getObject("items").getObject("x-emc2").getString("kind")).isEqualTo("layer");
    // the links' own list is not a required-field rule: validation of a greyed field is the same as before
    assertThat(strings(Manifest.read().getObject("settings").getObject("properties").getObject("links").getObject("items").get("required")))
        .containsExactly("name", "direction");
  }
}
