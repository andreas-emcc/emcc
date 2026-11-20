package dev.emcc.plugins.simulator;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** What the brief puts in the manifest (functions 1 and 4, Settings, Permissions, Internet access). */
class ManifestTest {

  private final JsonObject manifest = Manifest.read();

  @Test
  @DisplayName("Criterion 1 (manifest part): the Simulation workspace with its view and edit permissions")
  void declaresTheSimulationWorkspace() {
    JsonArray workspaces = (JsonArray) manifest.get("workspaces");
    assertThat(workspaces.values()).singleElement().isEqualTo(JsonObject.builder()
        .put("id", JsonString.of("simulator.simulation"))
        .put("name", JsonString.of("Simulation"))
        .put("viewPermission", JsonString.of("plugin.simulator.view"))
        .put("editPermission", JsonString.of("plugin.simulator.edit"))
        .build());
    assertThat(((JsonArray) manifest.get("permissions")).values()).extracting(v -> ((JsonString) v).value())
        .containsExactly("plugin.simulator.view", "plugin.simulator.edit", "plugin.simulator.run");
  }

  @Test
  void declaresTheRouteDataTypeNeverFadedOrRemoved() {
    JsonObject route = (JsonObject) ((JsonArray) manifest.get("dataTypes")).values().getFirst();
    assertThat(route.getString("id")).isEqualTo(Engine.ROUTE_TYPE);
    assertThat(route.getString("name")).isEqualTo("Route");
    assertThat(route.has("defaults")).as("absent defaults: never expires, not faded, never removed").isFalse();
  }

  @Test
  @DisplayName("Criterion 50: simulator.route is not chosen by hand (manual false), and carries no field sets")
  void routesAreNotChosenByHand() {
    JsonObject route = (JsonObject) ((JsonArray) manifest.get("dataTypes")).values().getFirst();
    assertThat(route.getBoolean("manual")).isFalse();
    assertThat(route.has("fieldSets")).isFalse();
  }

  @Test
  @DisplayName("Settings: outputStaleSeconds, default 5, from 1 to 3 600, enforced by the schema")
  void outputStaleSecondsSetting() {
    JsonObject setting = manifest.getObject("settings").getObject("properties").getObject("outputStaleSeconds");
    assertThat(setting.getString("type")).isEqualTo("integer");
    assertThat(setting.getNumber("default").longValueExact()).isEqualTo(5);
    assertThat(setting.getNumber("minimum").longValueExact()).isEqualTo(1);
    assertThat(setting.getNumber("maximum").longValueExact()).isEqualTo(3600);
  }

  @Test
  @DisplayName("Internet access: none; no connections; general kind, category simulation; SDK 1.6.0 (M7, functions 47 to 49)")
  void noInternetAndNoConnections() {
    assertThat(manifest.has("internet")).isFalse();
    assertThat(manifest.has("connections")).isFalse();
    assertThat(manifest.has("network")).isFalse();
    assertThat(manifest.getString("kind")).isEqualTo("general");
    assertThat(manifest.getString("category")).isEqualTo("simulation");
    assertThat(manifest.getString("sdkVersion")).isEqualTo("^1.8.0");
    assertThat(manifest.getString("icon")).as("SDK 1.8.0 part D (T-204)").isEqualTo("Play");
  }

  @Test
  @DisplayName("Function 46 (SDK 1.6.0 part F) and criterion 77 (T-189): each colour is a colour picker, shown only with use fixed; from M8 fixed by default, in #BDCF3D, #FD0909 and #7EF26A, with identity still allowed")
  void colourSettingsArePickers() {
    Map<String, String> fixed = Map.of("jobAreaColour", "#BDCF3D", "coverageColour", "#FD0909", "dwellColour", "#7EF26A");
    for (String name : new String[] {"jobAreaColour", "coverageColour", "dwellColour"}) {
      JsonObject setting = manifest.getObject("settings").getObject("properties").getObject(name);
      assertThat(setting.getObject("default").getString("use")).as(name).isEqualTo("fixed");
      assertThat(setting.getObject("default").getString("colour")).as(name).isEqualTo(fixed.get(name));
      JsonObject use = setting.getObject("properties").getObject("use");
      assertThat(use.getString("default")).as(name).isEqualTo("fixed");
      assertThat(use.get("enum").toString()).as(name).contains("identity", "fixed");
      JsonObject colour = setting.getObject("properties").getObject("colour");
      assertThat(colour.getString("pattern")).as(name).isEqualTo("^#[0-9A-Fa-f]{6}$");
      assertThat(colour.getString("default")).as(name).isEqualTo(fixed.get(name));
      JsonObject mark = colour.getObject("x-emc2");
      assertThat(mark.getString("kind")).as(name).isEqualTo("colour");
      assertThat(mark.getObject("visibleWhen").getString("property")).as(name).isEqualTo("use");
    }
  }

  @Test
  @DisplayName("Function 30 (CR-0035): the kind simulator.beyond-reach, red, on by default")
  void beyondReachKind() {
    JsonObject kind = (JsonObject) ((dev.emcc.sdk.json.JsonArray) manifest.get("relationKinds")).values().getFirst();
    assertThat(kind.getString("id")).isEqualTo(Sensors.BEYOND);
    assertThat(kind.getString("label")).isEqualTo("Beyond output reach");
    assertThat(kind.getObject("line").getString("strokeColor")).isEqualTo("#FF0000");
    assertThat(kind.getObject("line").getNumber("strokeWidth").doubleValue()).isEqualTo(1.0);
    assertThat(kind.getBoolean("defaultOn")).isTrue();
  }
}
