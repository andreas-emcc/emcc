package dev.emcc.plugins.uavsimulation;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.uavsimulation.pose.Aim;
import dev.emcc.plugins.uavsimulation.pose.Frame;
import dev.emcc.plugins.uavsimulation.pose.Pose;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.testkit.TestJson;
import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The pose as {@code fmv.camera-pose}'s payload (brief section 4). */
class PoseJsonTest {

  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "RESTRICTED");

  private static Pose pose(String name, String mission, Instant time) {
    return new Pose("0193a1f2-7c4e-7d10-9a3b-2f6e8c1d4b57", time, Position.of(17.3, 62.4, 1000), 45, 0, 0, new Aim(90, 30), 0, 20, 11.33,
        Frame.DEFAULT, name, mission, LABEL);
  }

  @Test
  @DisplayName("Section 4: the brief's example payload, field by field; the label is not in it")
  void theBriefsExample() {
    JsonObject json = PoseJson.of(pose("Hawk 1", "RECCE NORTH", Instant.parse("2026-11-16T10:15:30.040Z")));
    JsonObject example = (JsonObject) TestJson.parse("""
        {
          "camera": "0193a1f2-7c4e-7d10-9a3b-2f6e8c1d4b57",
          "time": "2026-11-16T10:15:30.040Z",
          "platform": { "position": [17.3, 62.4, 1000], "heading": 45, "pitch": 0, "roll": 0, "name": "Hawk 1" },
          "pointing": { "azimuth": 90, "depression": 30, "roll": 0 },
          "fieldOfView": { "horizontal": 20, "vertical": 11.33 },
          "frame": { "width": 1280, "height": 720, "rate": 25 },
          "mission": "RECCE NORTH"
        }""");
    assertThat(TestJson.normalize(json)).isEqualTo(TestJson.normalize(example));
  }

  @Test
  @DisplayName("Section 4: the time has milliseconds always; the name and the Mission are absent when empty")
  void timeAndAbsentFields() {
    JsonObject json = PoseJson.of(pose(null, "", Instant.parse("2026-11-16T10:15:30.123456Z")));
    assertThat(json.getString("time")).isEqualTo("2026-11-16T10:15:30.123Z");
    assertThat(PoseJson.of(pose(null, "", Instant.parse("2026-11-16T10:15:30Z"))).getString("time")).isEqualTo("2026-11-16T10:15:30.000Z");
    assertThat(json.has("mission")).isFalse();
    assertThat(json.getObject("platform").has("name")).isFalse();
    assertThat(json.has("label")).isFalse();
  }
}
