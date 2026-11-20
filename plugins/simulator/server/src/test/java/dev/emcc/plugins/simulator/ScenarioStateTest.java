package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.TWO_LEGS;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.User;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The simulator's own part of a scenario (brief function 32; criteria 46 and 47; A108, A109). */
class ScenarioStateTest {

  private static final String STEADY = "{\"points\": [{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]}";

  private final Rig rig = new Rig();

  private String state() {
    return rig.get("/scenario-state").reply().body().toUtf8();
  }

  private String importing(String mode, String outputs, UUID platform, String mission) {
    String sensor = "{\"platform\": \"" + platform + "\", \"settings\": {\"revisitSeconds\": 20, \"minRange\": 0, \"maxRange\": 50000, \"startBearing\": 0,"
        + " \"endBearing\": 360, \"detectionProbability\": 1, \"rangeError\": 0, \"crossRangeError\": 0, \"minimumDetectableSpeed\": 0,"
        + " \"maxDetections\": 10, \"detectAll\": false, \"outputs\": [\"gmti/vista-out\"]" + mission + "}}";
    return "{\"mode\": \"" + mode + "\", \"outputs\": " + outputs + ", \"sensors\": [" + sensor + "]}";
  }

  @Test
  @DisplayName("Criteria 46 and 47: the export has the outputs and the sensors with every setting and the Mission; an import as new replaces them, a merge adds them")
  void exportAndImport() {
    UUID old = rig.symbol(Position.of(17.0, 58.0));
    rig.started();
    rig.chooseTak();
    Rig.ok(rig.post("/sensors", "{\"platform\": \"" + old + "\", \"create\": true, \"mission\": \"ATO-2611-BRAVO\"}"));
    assertThat(state()).contains("\"outputs\":[\"cot/tak-out\"]", "\"platform\":\"" + old + "\"", "\"mission\":\"ATO-2611-BRAVO\"", "\"maxDetections\":200");

    UUID merged = UUID.randomUUID();
    Rig.ok(rig.post("/scenario-state", importing("merge", "[\"gmti/vista-out\"]", merged, "")));
    assertThat(state()).contains("\"outputs\":[\"cot/tak-out\",\"gmti/vista-out\"]", old.toString(), merged.toString());
    assertThat(rig.get("/outputs").reply().body().toUtf8()).contains("{\"id\":\"gmti/vista-out\",\"missing\":true}");

    UUID fresh = UUID.randomUUID();
    Rig.ok(rig.post("/scenario-state", importing("new", "[]", fresh, "")));
    String after = state();
    assertThat(after).contains("\"outputs\":[]", fresh.toString(), "\"mission\":null", "\"revisitSeconds\":20").doesNotContain(old.toString(), merged.toString());
    assertThat(rig.get("/sensors").reply().body().toUtf8()).contains("\"missing\":true"); // its track comes with the objects
  }

  @Test
  @DisplayName("Criterion 46: the import needs plugin.simulator.run as well, and the simulation reset or paused")
  void onlyWhenAllowed() {
    UUID route = rig.route(TWO_LEGS, STEADY);
    rig.started();
    User editor = User.of("u1", "Editor", Set.of(Engine.VIEW_PERMISSION, Engine.EDIT_PERMISSION));
    FakeHttpExchange refused = rig.ctx.post("/scenario-state", Routes.json(importing("new", "[]", UUID.randomUUID(), "")), editor);
    rig.ctx.runUntilIdle();
    assertThat(refused.reply().status()).isEqualTo(403);
    rig.control(route, "start");
    assertThat(rig.post("/scenario-state", importing("new", "[]", UUID.randomUUID(), "")).reply().status()).isEqualTo(409);
    rig.control(route, "pause");
    assertThat(rig.post("/scenario-state", "{\"mode\": \"other\", \"outputs\": []}").reply().status()).isEqualTo(400);
    Rig.ok(rig.post("/scenario-state", importing("new", "[]", UUID.randomUUID(), ", \"mission\": \"M1\"")));
    assertThat(state()).contains("\"mission\":\"M1\"");
  }
}
