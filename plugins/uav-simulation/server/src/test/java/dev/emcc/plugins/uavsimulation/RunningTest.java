package dev.emcc.plugins.uavsimulation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.testkit.FakePluginContext;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Running cameras: the frames, the poses between updates, the target and the status (brief functions 5 to 10). */
class RunningTest {

  private static final Position AT = Position.of(17.3, 62.4, 500);

  private static JsonObject pose(Rig rig, UUID camera) {
    return rig.camera(camera).getObject("pose");
  }

  private static Position position(JsonObject pose) {
    JsonArray p = (JsonArray) pose.getObject("platform").get("position");
    return Position.of(num(p, 0), num(p, 1), num(p, 2));
  }

  private static double num(JsonArray a, int i) {
    return ((dev.emcc.sdk.json.JsonNumber) a.get(i)).doubleValue();
  }

  private static long poses(Rig rig, UUID camera) {
    return rig.camera(camera).getNumber("poses").longValueExact();
  }

  private static Instant time(JsonObject pose) {
    return Instant.parse(pose.getString("time"));
  }

  @Test
  @DisplayName("Criterion 12: at 25 frames a second one pose every 40 ms, each at its tick's time; at 30 every 33 ms")
  void frames() {
    Rig rig = new Rig().started();
    UUID id = rig.camera(rig.track(AT), "");
    assertThat(rig.camera(id).get("pose")).as("a stopped camera has no pose").isEqualTo(dev.emcc.sdk.json.JsonNull.INSTANCE);
    rig.ctx.advance(Duration.ofSeconds(1));
    assertThat(poses(rig, id)).as("a stopped camera computes nothing").isZero();
    Rig.answer(rig.post("/cameras/" + id + "/start", "{}"), 200);
    Instant started = rig.ctx.clock();
    for (int i = 1; i <= 5; i++) {
      rig.ctx.advance(Duration.ofMillis(40));
      assertThat(poses(rig, id)).isEqualTo(i);
      assertThat(time(pose(rig, id))).isEqualTo(started.plusMillis(40L * i));
    }
    Rig.answer(rig.post("/cameras/" + id, "{\"frameRate\": 30}"), 200);
    Instant changed = rig.ctx.clock();
    rig.ctx.advance(Duration.ofMillis(33));
    assertThat(poses(rig, id)).as("a new frame rate restarts the timer").isEqualTo(6);
    assertThat(time(pose(rig, id))).isEqualTo(changed.plusMillis(33));
    rig.ctx.advance(Duration.ofMillis(330));
    assertThat(poses(rig, id)).isEqualTo(16);
    Rig.answer(rig.post("/cameras/" + id + "/stop", "{}"), 200);
    rig.ctx.advance(Duration.ofSeconds(1));
    assertThat(poses(rig, id)).as("stopped").isEqualTo(16);
    assertThat(rig.ctx.activeTimers()).as("only the status timer is left").isEqualTo(1);
  }

  @Test
  @DisplayName("Criterion 6: the pose's height is the platform's altitude, else the Height setting")
  void height() {
    Rig rig = new Rig().started();
    UUID high = rig.camera(rig.track(AT), "");
    UUID flat = rig.camera(rig.track(rig.layer, Position.of(17.3, 62.4), null, null, "Flat"), "\"height\": 1500");
    rig.post("/cameras/" + high + "/start", "{}");
    rig.post("/cameras/" + flat + "/start", "{}");
    rig.ctx.advance(Duration.ofMillis(40));
    assertThat(position(pose(rig, high))).isEqualTo(Position.of(17.3, 62.4, 500));
    assertThat(position(pose(rig, flat))).isEqualTo(Position.of(17.3, 62.4, 1500));
  }

  @Test
  @DisplayName("Criterion 11: 50 m/s east: 25 m after 0.5 s, held at 75 m after 1.5 s (counted), and a new update moves the pose at once")
  void betweenUpdates() {
    Rig rig = new Rig().started();
    UUID track = rig.track(rig.layer, AT, 90.0, 50.0, "Hawk 1");
    UUID id = rig.camera(track, "");
    rig.post("/cameras/" + id + "/start", "{}");
    Instant update = rig.ctx.clock();
    rig.ctx.advance(Duration.ofMillis(520)); // 13 frames: 520 ms after the update
    assertThat(Geodesy.inverse(AT, position(pose(rig, id))).distanceMetres()).isCloseTo(26, within(0.1));
    rig.ctx.advance(Duration.ofMillis(2000));
    assertThat(Geodesy.inverse(AT, position(pose(rig, id))).distanceMetres()).isCloseTo(75, within(0.1));
    assertThat(time(pose(rig, id))).isEqualTo(update.plusMillis(2520));
    Position next = Position.of(17.302, 62.4, 500);
    rig.move(track, next, 90.0, 50.0);
    rig.ctx.advance(Duration.ofMillis(40));
    assertThat(Geodesy.inverse(next, position(pose(rig, id))).distanceMetres()).as("from the new update").isCloseTo(2, within(0.1));
    rig.ctx.advance(Duration.ofMinutes(1));
    assertThat(rig.ctx.effectiveStatus().detail()).containsPattern("last minute: \\d+ poses, 0 sent, [1-9]\\d* held");
  }

  @Test
  @DisplayName("Criterion 16: a stopped route (no more updates) keeps the camera running, still after 1.5 s, the held count growing")
  void stillAfterUpdatesStop() {
    Rig rig = new Rig().started();
    UUID track = rig.track(rig.layer, AT, 0.0, 20.0, "Hawk 1");
    UUID id = rig.camera(track, "");
    rig.post("/cameras/" + id + "/start", "{}");
    rig.ctx.advance(Duration.ofSeconds(2));
    Position held = position(pose(rig, id));
    rig.ctx.advance(Duration.ofSeconds(5));
    assertThat(position(pose(rig, id))).isEqualTo(held);
    assertThat(rig.camera(id).getString("state")).isEqualTo("running");
  }

  @Test
  @DisplayName("Criterion 9: a target moving east at 20 m/s under a still platform; deleted: the last angles, Target gone, the poses go on")
  void trackAnObject() {
    Rig rig = new Rig().started();
    UUID platform = rig.track(rig.layer, Position.of(17.3, 62.4, 1000), null, null, "Hawk 1");
    Position start = Geodesy.direct(Position.of(17.3, 62.4), 270, 100);
    UUID target = rig.track(rig.layer, start, 90.0, 20.0, "Truck");
    UUID id = rig.camera(platform, "\"mode\": \"trackObject\", \"target\": \"" + target + "\"");
    rig.post("/cameras/" + id + "/start", "{}");
    rig.ctx.advance(Duration.ofSeconds(1));
    JsonObject p = pose(rig, id).getObject("pointing");
    // 1 s after its update the target is 80 m west, 1 000 m below: atan(1000 / 80).
    assertThat(p.getNumber("azimuth").doubleValue()).isCloseTo(270, within(0.05));
    assertThat(p.getNumber("depression").doubleValue()).isCloseTo(Math.toDegrees(Math.atan(12.5)), within(0.05));
    rig.delete(target);
    long before = poses(rig, id);
    rig.ctx.advance(Duration.ofMillis(400));
    JsonObject after = pose(rig, id).getObject("pointing");
    assertThat(after).isEqualTo(p);
    assertThat(rig.camera(id).getString("state")).isEqualTo("targetGone");
    assertThat(poses(rig, id)).isEqualTo(before + 10);
    assertThat(rig.ctx.effectiveStatus().detail()).contains("1 target gone");
  }

  @Test
  @DisplayName("Criterion 10: a sweep's azimuth follows the triangle wave from the camera's start")
  void sweep() {
    Rig rig = new Rig().started();
    UUID id = rig.camera(rig.track(AT), "\"mode\": \"sweep\"");
    rig.post("/cameras/" + id + "/start", "{}");
    rig.ctx.advance(Duration.ofMillis(4520)); // 4.52 s: 315 + 45.2 = 0.2°
    assertThat(pose(rig, id).getObject("pointing").getNumber("azimuth").doubleValue()).isCloseTo(0.2, within(0.01));
  }

  @Test
  @DisplayName("Criterion 13: each pose carries its platform's label; a changed label goes out from the next pose")
  void label() {
    Rig rig = new Rig().started();
    UUID track = rig.track(AT);
    UUID id = rig.camera(track, "");
    rig.post("/cameras/" + id + "/start", "{}");
    rig.ctx.advance(Duration.ofMillis(40));
    assertThat(rig.camera(id).getString("poseClassification")).isEqualTo(rig.ctx.defaultLabel().classification());
    Position before = position(pose(rig, id));
    SecurityLabel secret = SecurityLabel.of("NATO", "SECRET");
    rig.relabel(track, secret);
    rig.ctx.advance(Duration.ofMillis(40));
    assertThat(rig.camera(id).getString("poseClassification")).isEqualTo("SECRET");
    assertThat(position(pose(rig, id))).isEqualTo(before);
  }

  @Test
  @DisplayName("Criterion 17: the status lists the cameras, the running ones and the poses per minute")
  void status() {
    Rig rig = new Rig().started();
    FakePluginContext ctx = rig.ctx;
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.OK);
    UUID a = rig.camera(rig.track(AT), "");
    rig.camera(rig.track(Position.of(17.4, 62.5)), "");
    rig.post("/cameras/" + a + "/start", "{}");
    ctx.advance(Duration.ofMinutes(2));
    assertThat(ctx.effectiveStatus().detail()).startsWith("2 cameras, 1 running").contains("last minute: 1500 poses");
  }
}
