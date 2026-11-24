package dev.emcc.plugins.uavsimulation;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.User;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The cameras, their endpoints, permissions and storage (brief functions 1, 2, 8 and 13). */
class CamerasTest {

  private static final Position AT = Position.of(17.3, 62.4, 500);

  @Test
  @DisplayName("Criterion 2: New camera on a symbol in Simulation makes a camera on it, stopped, with section 5's defaults")
  void newCamera() {
    Rig rig = new Rig().started();
    UUID track = rig.track(AT);
    UUID id = rig.camera(track, "");
    JsonObject c = rig.camera(id);
    assertThat(c.getString("platform")).isEqualTo(track.toString());
    assertThat(c.getString("platformName")).isEqualTo("Hawk 1");
    assertThat(c.getString("state")).isEqualTo("stopped");
    // section 5's defaults; the sway's seed is the camera's own (criterion 23)
    assertThat(c.getObject("settings").without("swaySeed")).isEqualTo(CameraSettings.DEFAULTS.json().without("swaySeed"));
    // Section 5: the form's default point when Track a point is chosen; longitude first, latitude ≠ longitude.
    assertThat(c.get("platformPosition")).isEqualTo(dev.emcc.sdk.testkit.TestJson.parse("[17.3, 62.4]"));
    rig.delete(track);
    assertThat(rig.camera(id).get("platformPosition")).as("none while the platform is gone").isEqualTo(dev.emcc.sdk.json.JsonNull.INSTANCE);
  }

  @Test
  @DisplayName("Criterion 2: refused on an object in View, on an unknown id and on no id; a second on one track names the first (U2)")
  void newCameraRefused() {
    Rig rig = new Rig().started();
    UUID inView = rig.track(rig.viewLayer, AT, null, null, "Ship");
    assertField(rig.post("/cameras", "{\"platform\": \"" + inView + "\"}"), 404, "platform");
    assertField(rig.post("/cameras", "{\"platform\": \"" + UUID.randomUUID() + "\"}"), 404, "platform");
    assertField(rig.post("/cameras", "{}"), 404, "platform");
    UUID track = rig.track(AT);
    UUID first = rig.camera(track, "");
    JsonObject second = Rig.answer(rig.post("/cameras", "{\"platform\": \"" + track + "\"}"), 409);
    assertThat(second.getString("camera")).isEqualTo(first.toString());
    assertThat(((JsonArray) rig.get().get("cameras")).size()).isEqualTo(1);
  }

  @Test
  @DisplayName("Criterion 2 (Q6 A): a track the simulator's radar uses takes a camera too: nothing here knows of the radar")
  void radarTrackTakesACamera() {
    // The simulator keeps its sensors in its own documents; the track itself is an ordinary symbol.
    Rig rig = new Rig().started();
    assertThat(rig.camera(rig.track(AT), "")).isNotNull();
  }

  @Test
  @DisplayName("Criterion 3: settings outside their limits are refused by the server naming the field; the target is not the platform")
  void limitsAtTheServer() {
    Rig rig = new Rig().started();
    UUID track = rig.track(AT);
    assertField(rig.post("/cameras", "{\"platform\": \"" + track + "\", \"horizontalFov\": 120.5}"), 400, "horizontalFov");
    UUID id = rig.camera(track, "\"horizontalFov\": 120");
    assertField(rig.post("/cameras/" + id, "{\"sectorStart\": 10, \"sectorEnd\": 10}"), 400, "sectorEnd");
    assertField(rig.post("/cameras/" + id, "{\"target\": \"" + track + "\"}"), 400, "target");
    assertField(rig.post("/cameras/" + id, "{\"target\": \"" + UUID.randomUUID() + "\"}"), 400, "target");
    assertThat(rig.camera(id).getObject("settings").getNumber("horizontalFov").doubleValue()).isEqualTo(120);
  }

  @Test
  @DisplayName("Criterion 20 (V2, CR-0055): a new camera's overlay is false; a POST with true keeps it in settings.overlay; not a boolean is 400; without edit 403")
  void overlaySetting() {
    Rig rig = new Rig().started();
    UUID id = rig.camera(rig.track(AT), "");
    assertThat(rig.camera(id).getObject("settings").getBoolean("overlay")).isFalse();
    Rig.answer(rig.post("/cameras/" + id, "{\"overlay\": true}"), 200);
    assertThat(rig.camera(id).getObject("settings").getBoolean("overlay")).isTrue();
    assertField(rig.post("/cameras/" + id, "{\"overlay\": \"true\"}"), 400, "overlay");
    User viewer = Rig.user("plugin.simulator.view", CameraWorker.VIEW, CameraWorker.RUN);
    assertThat(rig.post("/cameras/" + id, "{\"overlay\": false}", viewer).reply().status()).isEqualTo(403);
    assertThat(rig.camera(id).getObject("settings").getBoolean("overlay")).as("nothing changed").isTrue();
    UUID other = rig.camera(rig.track(Position.of(17.4, 62.5)), "\"overlay\": true");
    assertThat(rig.camera(other).getObject("settings").getBoolean("overlay")).as("a new camera can start with it").isTrue();
  }

  @Test
  @DisplayName("Criterion 3 (U1): a 51st camera is refused")
  void fiftyCameras() {
    Rig rig = new Rig().started();
    for (int i = 0; i < CameraWorker.MAX_CAMERAS; i++) {
      rig.camera(rig.track(Position.of(17 + i * 0.01, 62.4)), "");
    }
    JsonObject refused = Rig.answer(rig.post("/cameras", "{\"platform\": \"" + rig.track(AT) + "\"}"), 409);
    assertThat(refused.getString("error")).contains("50");
  }

  @Test
  @DisplayName("Criterion 4: without view GET is 403, without edit create, change and remove, without run start and stop")
  void permissions() {
    Rig rig = new Rig().started();
    UUID track = rig.track(AT);
    UUID id = rig.camera(track, "");
    User none = Rig.user("plugin.simulator.view");
    User all = Rig.user("plugin.simulator.view", CameraWorker.VIEW, CameraWorker.EDIT, CameraWorker.RUN);
    assertThat(rig.ctx.call("/cameras", none).reply().status()).isEqualTo(403);
    FakeHttpExchange viewer = rig.ctx.call("/cameras", Rig.user("plugin.simulator.view", CameraWorker.VIEW));
    rig.ctx.runUntilIdle();
    assertThat(viewer.reply().status()).isEqualTo(200);
    String body = "{\"platform\": \"" + rig.track(Position.of(17.4, 62.5)) + "\"}";
    for (String[] call : new String[][] {
        {"/cameras", body, CameraWorker.EDIT}, {"/cameras/" + id, "{\"azimuth\": 10}", CameraWorker.EDIT}, {"/cameras/" + id + "/remove", "{}", CameraWorker.EDIT},
        {"/cameras/" + id + "/start", "{}", CameraWorker.RUN}, {"/cameras/" + id + "/stop", "{}", CameraWorker.RUN}}) {
      User without = Rig.user(java.util.Arrays.stream(new String[] {"plugin.simulator.view", CameraWorker.VIEW, CameraWorker.EDIT, CameraWorker.RUN})
          .filter(p -> !p.equals(call[2])).toArray(String[]::new));
      assertThat(rig.post(call[0], call[1], without).reply().status()).as("%s without %s", call[0], call[2]).isEqualTo(403);
    }
    assertThat(rig.camera(id).getString("state")).as("nothing changed").isEqualTo("stopped");
    assertThat(rig.post("/cameras/" + id + "/start", "{}", all).reply().status()).isEqualTo(200);
  }

  @Test
  @DisplayName("Section 6: without the workspace's plugin.simulator.view every endpoint answers 403 and changes nothing")
  void workspaceView() {
    Rig rig = new Rig().started();
    UUID track = rig.track(AT);
    UUID id = rig.camera(track, "");
    User blind = Rig.user(CameraWorker.VIEW, CameraWorker.EDIT, CameraWorker.RUN);
    FakeHttpExchange get = rig.ctx.call("/cameras", blind);
    rig.ctx.runUntilIdle();
    assertThat(get.reply().status()).isEqualTo(403);
    assertThat(get.reply().body().toUtf8()).doesNotContain("Hawk 1");
    for (String[] call : new String[][] {{"/cameras", "{\"platform\": \"" + track + "\"}"}, {"/cameras/" + id, "{\"azimuth\": 10}"},
        {"/cameras/" + id + "/start", "{}"}, {"/cameras/" + id + "/stop", "{}"}, {"/cameras/" + id + "/remove", "{}"}}) {
      assertThat(rig.post(call[0], call[1], blind).reply().status()).as(call[0]).isEqualTo(403);
    }
    JsonObject c = rig.camera(id);
    assertThat(c.getString("state")).isEqualTo("stopped");
    assertThat(c.getObject("settings").getNumber("azimuth").doubleValue()).isZero();
  }

  @Test
  @DisplayName("Function 10: a failed write turns the status DEGRADED until a later write succeeds")
  void writeProblemClears() {
    Rig rig = new Rig().started();
    UUID id = rig.camera(rig.track(AT), "");
    rig.ctx.documents().failNext("disk full");
    Rig.answer(rig.post("/cameras/" + id, "{\"azimuth\": 10}"), 200);
    assertThat(rig.ctx.effectiveStatus().state()).isEqualTo(dev.emcc.sdk.PluginState.DEGRADED);
    assertThat(rig.ctx.effectiveStatus().detail()).contains("disk full");
    Rig.answer(rig.post("/cameras/" + id, "{\"azimuth\": 20}"), 200);
    assertThat(rig.ctx.effectiveStatus().state()).isEqualTo(dev.emcc.sdk.PluginState.OK);
  }

  @Test
  @DisplayName("Criterion 5: after a restart (documents kept) every camera is back with its settings, stopped")
  void storedOverARestart() {
    Rig rig = new Rig().started();
    UUID track = rig.track(AT);
    UUID other = rig.track(Position.of(17.5, 62.6));
    UUID a = rig.camera(track, "\"mode\": \"sweep\", \"sectorStart\": 30, \"sectorEnd\": 120, \"mission\": \"Övning\"");
    UUID b = rig.camera(other, "");
    Rig.answer(rig.post("/cameras/" + a + "/start", "{}"), 200);
    UUID removed = rig.camera(rig.track(Position.of(17.6, 62.7)), "");
    Rig.answer(rig.post("/cameras/" + removed + "/remove", "{}"), 200);
    JsonObject settingsBefore = rig.camera(a).getObject("settings");
    Map<String, JsonObject> stored = rig.ctx.documents().stored();
    assertThat(stored).containsOnlyKeys("cameras", "camera." + a, "camera." + b);

    Rig again = new Rig(stored).started();
    // The new store has new objects; the cameras come back with their settings, stopped (and their platforms gone here).
    JsonArray cameras = (JsonArray) again.get().get("cameras");
    assertThat(cameras.size()).isEqualTo(2);
    JsonObject back = again.camera(a);
    assertThat(back.getObject("settings")).isEqualTo(settingsBefore);
    assertThat(back.getBoolean("running")).isFalse();
    assertThat(back.getString("state")).isEqualTo("platformGone");
    assertThat(back.getString("platformName")).as("the last known name is stored").isEqualTo("Hawk 1");
  }

  @Test
  @DisplayName("Criterion 13: a deleted platform stops the camera with Platform gone; it keeps its settings and may take another platform (B7)")
  void platformGone() {
    Rig rig = new Rig().started();
    UUID track = rig.track(AT);
    UUID id = rig.camera(track, "\"azimuth\": 45");
    Rig.answer(rig.post("/cameras/" + id + "/start", "{}"), 200);
    rig.ctx.advance(Duration.ofMillis(200));
    rig.delete(track);
    JsonObject c = rig.camera(id);
    assertThat(c.getString("state")).isEqualTo("platformGone");
    assertThat(c.getBoolean("running")).isFalse();
    assertThat(c.getString("platformName")).as("still named after its platform").isEqualTo("Hawk 1");
    long poses = c.getNumber("poses").longValueExact();
    rig.ctx.advance(Duration.ofSeconds(1));
    assertThat(rig.camera(id).getNumber("poses").longValueExact()).as("no poses after").isEqualTo(poses);
    assertField(rig.post("/cameras/" + id + "/start", "{}"), 409, "platform");
    UUID next = rig.track(Position.of(17.4, 62.5));
    JsonObject moved = Rig.answer(rig.post("/cameras/" + id, "{\"platform\": \"" + next + "\"}"), 200);
    assertThat(moved.getString("state")).isEqualTo("stopped");
    assertThat(moved.getObject("settings").getNumber("azimuth").doubleValue()).isEqualTo(45);
  }

  @Test
  @DisplayName("B4: Track a point gets the platform's position as its point; Track an object cannot start without its target")
  void startNeedsTheModesValue() {
    Rig rig = new Rig().started();
    UUID id = rig.camera(rig.track(AT), "\"mode\": \"trackPoint\"");
    // Section 5: the point defaults to the platform's position when the mode is chosen.
    assertThat(rig.camera(id).getObject("settings").get("point")).isEqualTo(dev.emcc.sdk.testkit.TestJson.parse("[17.3, 62.4]"));
    Rig.answer(rig.post("/cameras/" + id, "{\"point\": null}"), 200);
    assertThat(rig.camera(id).getObject("settings").get("point")).as("filled in again: the mode needs one").isNotEqualTo(dev.emcc.sdk.json.JsonNull.INSTANCE);
    Rig.answer(rig.post("/cameras/" + id, "{\"mode\": \"trackObject\"}"), 200);
    assertField(rig.post("/cameras/" + id + "/start", "{}"), 400, "target");
    UUID target = rig.track(rig.layer, Position.of(17.31, 62.41), null, null, "Target");
    Rig.answer(rig.post("/cameras/" + id, "{\"target\": \"" + target + "\"}"), 200);
    Rig.answer(rig.post("/cameras/" + id + "/start", "{}"), 200);
    assertField(rig.post("/cameras/" + id, "{\"target\": null}"), 400, "target");
  }

  @Test
  @DisplayName("Unknown cameras answer 404")
  void unknown() {
    Rig rig = new Rig().started();
    assertThat(rig.post("/cameras/" + UUID.randomUUID() + "/start", "{}").reply().status()).isEqualTo(404);
    assertThat(rig.post("/cameras/nope", "{}").reply().status()).isEqualTo(404);
  }

  @Test
  @DisplayName("Criterion 13: the plugin never submits a change request")
  void writesNoObjects() {
    Rig rig = new Rig().started();
    UUID id = rig.camera(rig.track(AT), "");
    Rig.answer(rig.post("/cameras/" + id + "/start", "{}"), 200);
    rig.ctx.advance(Duration.ofSeconds(2));
    assertThat(rig.ctx.store().requests()).isEmpty();
  }

  static void assertField(FakeHttpExchange call, int status, String field) {
    JsonObject body = Rig.answer(call, status);
    assertThat(body.getString("field")).as(body.toString()).isEqualTo(field);
  }
}
