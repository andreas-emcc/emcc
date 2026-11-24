package dev.emcc.plugins.uavsimulation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelInfo;
import dev.emcc.sdk.channel.ChannelSpec;
import dev.emcc.sdk.channel.ChannelState;
import dev.emcc.sdk.channel.DeclaredItem;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.testkit.LogEntry;
import dev.emcc.sdk.testkit.TestJson;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The send to {@code fmv} (brief section 4, functions 9 and 10; criteria 13 and 19), with {@code fmv}'s
 * {@code camera-pose} schema declared to the fake channels as its manifest declares it.
 *
 * <p>The kit's payload check covers a subset of JSON Schema: no {@code prefixItems}, {@code anyOf} or
 * {@code format}. So the height bound (C5), the frame pairs, the UUID and the time have tests of their
 * own here; ECore checks the whole schema. {@code CLOSED} cannot be reached with the fake channels: a
 * removed channel's new list always reaches the worker before its next tick.
 */
class SendTest {

  static final ChannelId OUT = new ChannelId("fmv", "out-a");
  static final ChannelId OTHER = new ChannelId("fmv", "out-b");
  private static final Position AT = Position.of(17.3, 62.4, 500);

  static ChannelInfo fmvOut(ChannelId id, String name) {
    return ChannelInfo.of(id.plugin(), ChannelSpec.of(id.link(), name, "stanag-4609").declaredKinds(Set.of(CameraWorker.KIND)).kinds(Set.of()));
  }

  /** {@code fmv}'s {@code camera-pose} payload schema, copied from its manifest (its brief's 10.1). */
  static JsonObject schema() {
    try (InputStream in = SendTest.class.getResourceAsStream("/fmv-camera-pose.schema.json")) {
      return (JsonObject) TestJson.parse(new String(in.readAllBytes(), StandardCharsets.UTF_8));
    } catch (IOException e) {
      throw new IllegalStateException(e);
    }
  }

  /** The rig with the kind declared and {@code fmv}'s output {@code out-a} on offer. */
  private static Rig rig() {
    Rig rig = new Rig();
    rig.ctx.channels().declare(CameraWorker.KIND, schema());
    rig.ctx.channels().addOther(fmvOut(OUT, "UAV North (out)"));
    return rig.started();
  }

  private static List<DeclaredItem> sent(Rig rig) {
    return rig.ctx.channels().sentDeclared(OUT);
  }

  private static double num(JsonObject o, String... path) {
    JsonObject at = o;
    for (int i = 0; i < path.length - 1; i++) {
      at = at.getObject(path[i]);
    }
    return ((JsonNumber) at.get(path[path.length - 1])).doubleValue();
  }

  @Test
  @DisplayName("Criterion 19: only channels that take fmv.camera-pose are offered, each with the camera that chose it")
  void offered() {
    Rig rig = new Rig();
    rig.ctx.channels().declare(CameraWorker.KIND, schema());
    rig.ctx.channels().addOther(fmvOut(OUT, "UAV North (out)"));
    rig.ctx.channels().addOther(ChannelInfo.of("cot", ChannelSpec.of("tak-north", "TAK North (out)", "cot")));
    rig.started();
    JsonArray outputs = (JsonArray) rig.get().get("outputs");
    assertThat(outputs.values()).hasSize(1);
    JsonObject out = (JsonObject) outputs.get(0);
    assertThat(out.getString("id")).isEqualTo("fmv/out-a");
    assertThat(out.getString("name")).isEqualTo("UAV North (out)");
    assertThat(out.get("camera")).isEqualTo(JsonNull.INSTANCE);
    UUID id = rig.camera(rig.track(AT), "\"output\": \"fmv/out-a\"");
    assertThat(((JsonObject) ((JsonArray) rig.get().get("outputs")).get(0)).getString("camera")).isEqualTo(id.toString());
    assertThat(rig.camera(id).getString("outputName")).isEqualTo("UAV North (out)");
  }

  @Test
  @DisplayName("Criterion 19: each pose is a DeclaredItem with the camera's id, the platform's label and section 4's payload")
  void criterion19() {
    Rig rig = rig();
    UUID track = rig.track(rig.layer, AT, 45.0, null, "Hawk 1");
    UUID id = rig.camera(track, "\"azimuth\": 90, \"output\": \"fmv/out-a\"");
    rig.ctx.advance(Duration.ofSeconds(1));
    assertThat(sent(rig)).as("a stopped camera sends nothing").isEmpty();
    Rig.answer(rig.post("/cameras/" + id + "/start", "{}"), 200);
    rig.ctx.advance(Duration.ofMillis(200));
    List<DeclaredItem> items = sent(rig);
    assertThat(items).hasSize(5);
    SecurityLabel label = rig.object(track).content().label();
    for (DeclaredItem item : items) {
      assertThat(item.kind()).isEqualTo("fmv.camera-pose");
      assertThat(item.id()).isEqualTo(id);
      assertThat(item.label()).isEqualTo(label);
      JsonObject p = item.payload();
      assertThat(p.getString("camera")).isEqualTo(id.toString());
      // what the kit's check leaves out: the format of the time, and the height and frame pair
      assertThat(p.getString("time")).matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z");
      assertThat(((JsonArray) p.getObject("platform").get("position")).values()).hasSize(3);
      assertThat(((JsonNumber) ((JsonArray) p.getObject("platform").get("position")).get(2)).doubleValue()).isEqualTo(500);
      assertThat(num(p, "frame", "width")).isEqualTo(1280);
      assertThat(num(p, "frame", "height")).isEqualTo(720);
      assertThat(num(p, "platform", "heading")).isEqualTo(45);
      assertThat(num(p, "pointing", "azimuth")).isEqualTo(90);
      assertThat(num(p, "pointing", "depression")).isEqualTo(30);
      assertThat(num(p, "fieldOfView", "vertical")).isCloseTo(11.33, within(0.01));
      assertThat(p.has("mission")).as("an empty Mission is left out").isFalse();
    }
    JsonObject camera = rig.camera(id);
    assertThat(camera.getString("state")).isEqualTo("running");
    assertThat(camera.getNumber("sent").longValueExact()).isEqualTo(5);
    assertThat(camera.get("notSent")).isEqualTo(JsonNull.INSTANCE);
    assertThat(rig.ctx.store().requests()).as("the plugin writes no object").isEmpty();

    Rig.answer(rig.post("/cameras/" + id, "{\"mission\": \"RECCE NORTH\"}"), 200);
    rig.ctx.advance(Duration.ofMillis(40));
    assertThat(sent(rig).getLast().payload().getString("mission")).isEqualTo("RECCE NORTH");
  }

  @Test
  @DisplayName("Criteria 23 and 24 (V3): with the sway on, a still platform's poses sway in azimuth, depression and roll, frame to frame, and pass fmv's schema; the platform's angles do not; switched off, the next pose is exact")
  void sway() {
    Rig rig = rig();
    UUID track = rig.track(rig.layer, AT, 45.0, null, "Hawk 1");
    UUID id = rig.camera(track, "\"azimuth\": 90, \"output\": \"fmv/out-a\", \"sway\": true, \"swayAmplitude\": 0.5, \"swayJoltsPerMinute\": 0, \"swaySeed\": 77");
    assertThat(rig.camera(id).getObject("settings").getNumber("swaySeed").longValueExact()).as("a seed given is kept").isEqualTo(77);
    assertThat(rig.camera(id).getObject("settings").get("sway")).isEqualTo(JsonBoolean.TRUE);
    Rig.answer(rig.post("/cameras/" + id + "/start", "{}"), 200);
    rig.ctx.advance(Duration.ofSeconds(2));
    List<DeclaredItem> items = sent(rig);
    assertThat(items).hasSize(50);
    java.util.Set<Double> azimuths = new java.util.HashSet<>();
    for (DeclaredItem item : items) {
      JsonObject p = item.payload();
      assertThat(num(p, "pointing", "azimuth")).isCloseTo(90, within(0.5 + 1e-9));
      assertThat(num(p, "pointing", "depression")).isCloseTo(30, within(0.5 + 1e-9));
      assertThat(num(p, "pointing", "roll")).isCloseTo(0, within(0.5 + 1e-9));
      assertThat(num(p, "platform", "heading")).isEqualTo(45);
      assertThat(num(p, "platform", "pitch")).isZero();
      assertThat(num(p, "platform", "roll")).isZero();
      azimuths.add(num(p, "pointing", "azimuth"));
    }
    assertThat(azimuths).as("it sways").hasSizeGreaterThan(40);
    assertThat(rig.camera(id).get("notSent")).as("every swayed pose passes fmv's schema").isEqualTo(JsonNull.INSTANCE);
    assertThat(rig.camera(id).getNumber("sent").longValueExact()).isEqualTo(50);

    Rig.answer(rig.post("/cameras/" + id, "{\"sway\": false}"), 200);
    rig.ctx.advance(Duration.ofMillis(40));
    JsonObject still = sent(rig).getLast().payload();
    assertThat(num(still, "pointing", "azimuth")).isEqualTo(90);
    assertThat(num(still, "pointing", "depression")).isEqualTo(30);
    assertThat(num(still, "pointing", "roll")).isZero();

    Rig.answer(rig.post("/cameras/" + id, "{\"sway\": true}"), 200);
    rig.ctx.advance(Duration.ofMillis(80));
    assertThat(num(sent(rig).getLast().payload(), "pointing", "azimuth")).as("on again from the next pose, while it runs").isNotEqualTo(90);
    assertThat(rig.camera(id).getString("state")).isEqualTo("running");
  }

  @Test
  @DisplayName("Criterion 21 (V2, CR-0055): every pose carries overlay as the camera's setting; a change while it runs reaches the next pose without a restart")
  void overlay() {
    Rig rig = rig();
    UUID id = rig.camera(rig.track(rig.layer, AT, 45.0, null, "Hawk 1"), "\"output\": \"fmv/out-a\"");
    Rig.answer(rig.post("/cameras/" + id + "/start", "{}"), 200);
    rig.ctx.advance(Duration.ofMillis(1020));
    List<DeclaredItem> off = sent(rig);
    assertThat(off).hasSize(25);
    for (DeclaredItem item : off) {
      assertThat(item.payload().get("overlay")).isEqualTo(JsonBoolean.FALSE);
    }
    Rig.answer(rig.post("/cameras/" + id, "{\"overlay\": true}"), 200);
    rig.ctx.advance(Duration.ofMillis(20));
    assertThat(sent(rig)).as("the next pose comes on the running timer's beat, 20 ms after the change, not 40 ms as after a restart").hasSize(26);
    assertThat(sent(rig).getLast().payload().get("overlay")).isEqualTo(JsonBoolean.TRUE);
    rig.ctx.advance(Duration.ofMillis(960));
    for (DeclaredItem item : sent(rig).subList(25, sent(rig).size())) {
      assertThat(item.payload().get("overlay")).isEqualTo(JsonBoolean.TRUE);
    }
    assertThat(rig.camera(id).getString("state")).isEqualTo("running");
    assertThat(rig.camera(id).get("notSent")).as("fmv's schema takes it").isEqualTo(JsonNull.INSTANCE);
    assertThat(rig.camera(id).getNumber("sent").longValueExact()).isEqualTo(50);
  }

  @Test
  @DisplayName("Criterion 25: with the platform held still (function 5: no update for over 1.5 s), the pointing still sways")
  void swayWhileHeld() {
    Rig rig = rig();
    UUID track = rig.track(rig.layer, AT, 90.0, 50.0, "Hawk 1");
    UUID id = rig.camera(track, "\"azimuth\": 90, \"output\": \"fmv/out-a\", \"sway\": true, \"swayAmplitude\": 0.5");
    Rig.answer(rig.post("/cameras/" + id + "/start", "{}"), 200);
    rig.ctx.advance(Duration.ofSeconds(4));
    List<DeclaredItem> items = sent(rig);
    List<DeclaredItem> held = items.subList(items.size() - 25, items.size()); // the last second, long after 1.5 s
    JsonValue position = held.getFirst().payload().getObject("platform").get("position");
    java.util.Set<Double> azimuths = new java.util.HashSet<>();
    for (DeclaredItem item : held) {
      assertThat(item.payload().getObject("platform").get("position")).as("held").isEqualTo(position);
      azimuths.add(num(item.payload(), "pointing", "azimuth"));
    }
    assertThat(azimuths).as("it sways on").hasSizeGreaterThan(20);
  }

  @Test
  @DisplayName("Criterion 23 (brief section 5): a new camera's sway is off, with a seed of its own")
  void newCameraSeed() {
    Rig rig = rig();
    JsonObject a = rig.camera(rig.camera(rig.track(AT), "")).getObject("settings");
    JsonObject b = rig.camera(rig.camera(rig.track(Position.of(17.4, 62.5, 500)), "")).getObject("settings");
    assertThat(a.get("sway")).isEqualTo(JsonBoolean.FALSE);
    long seedA = a.getNumber("swaySeed").longValueExact();
    long seedB = b.getNumber("swaySeed").longValueExact();
    assertThat(seedA).isBetween(0L, (long) Integer.MAX_VALUE);
    assertThat(seedB).isBetween(0L, (long) Integer.MAX_VALUE).isNotEqualTo(seedA);
  }

  @Test
  @DisplayName("C3: a camera without an output runs and computes its poses, and sends nothing")
  void noOutput() {
    Rig rig = rig();
    UUID id = rig.camera(rig.track(AT), "");
    Rig.answer(rig.post("/cameras/" + id + "/start", "{}"), 200);
    rig.ctx.advance(Duration.ofMillis(200));
    JsonObject camera = rig.camera(id);
    assertThat(camera.getNumber("poses").longValueExact()).isEqualTo(5);
    assertThat(camera.getString("state")).isEqualTo("running");
    assertThat(camera.get("output")).isEqualTo(JsonNull.INSTANCE);
    assertThat(camera.get("pose")).isInstanceOf(JsonObject.class);
    assertThat(sent(rig)).isEmpty();
    assertThat(rig.ctx.effectiveStatus().state()).isEqualTo(PluginState.OK);
  }

  @Test
  @DisplayName("Criterion 13, C4: a link that goes gives Output missing, no sends and DEGRADED; the same id back resumes")
  void outputMissing() {
    Rig rig = rig();
    UUID id = rig.camera(rig.track(AT), "\"output\": \"fmv/out-a\"");
    rig.post("/cameras/" + id + "/start", "{}");
    rig.ctx.advance(Duration.ofMillis(40));
    assertThat(sent(rig)).hasSize(1);

    rig.ctx.channels().removeOther(OUT);
    rig.ctx.runUntilIdle();
    rig.ctx.advance(Duration.ofMillis(200));
    assertThat(sent(rig)).as("nothing while it is missing").hasSize(1);
    JsonObject camera = rig.camera(id);
    assertThat(camera.getString("state")).isEqualTo("outputMissing");
    assertThat(camera.getString("output")).as("kept by its id").isEqualTo("fmv/out-a");
    assertThat(camera.getString("outputName")).as("its last known name").isEqualTo("UAV North (out)");
    assertThat(camera.get("outputMissing")).isEqualTo(JsonBoolean.TRUE);
    assertThat(camera.getNumber("poses").longValueExact()).as("it keeps running").isEqualTo(6);
    assertThat(rig.ctx.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    assertThat(rig.ctx.effectiveStatus().detail()).contains("1 running camera's output is missing").contains("1 output missing");

    rig.ctx.channels().addOther(fmvOut(OUT, "UAV North (out)"));
    rig.ctx.runUntilIdle();
    rig.ctx.advance(Duration.ofMillis(40));
    assertThat(sent(rig)).as("sends again").hasSize(2);
    assertThat(rig.camera(id).getString("state")).isEqualTo("running");
    assertThat(rig.ctx.effectiveStatus().state()).isEqualTo(PluginState.OK);

    rig.ctx.channels().removeOther(OUT);
    rig.post("/cameras/" + id + "/stop", "{}");
    assertThat(rig.ctx.effectiveStatus().state()).as("only a running camera's missing output degrades").isEqualTo(PluginState.OK);
  }

  @Test
  @DisplayName("C1: a camera keeps its missing output through other changes; a new one must be on offer and take the kind")
  void outputSetting() {
    Rig rig = new Rig();
    rig.ctx.channels().declare(CameraWorker.KIND, schema());
    rig.ctx.channels().addOther(fmvOut(OUT, "UAV North (out)"));
    rig.ctx.channels().addOther(ChannelInfo.of("cot", ChannelSpec.of("tak-north", "TAK North (out)", "cot")));
    rig.started();
    UUID track = rig.track(AT);
    for (String output : List.of("fmv/out-b", "cot/tak-north")) {
      JsonObject refused = Rig.answer(rig.post("/cameras", "{\"platform\": \"" + track + "\", \"output\": \"" + output + "\"}"), 404);
      assertThat(refused.getString("field")).as(output).isEqualTo("output");
    }
    assertThat(Rig.answer(rig.post("/cameras", "{\"platform\": \"" + track + "\", \"output\": \"nonsense\"}"), 400).getString("field")).isEqualTo("output");

    UUID id = rig.camera(track, "\"output\": \"fmv/out-a\"");
    rig.ctx.channels().removeOther(OUT);
    rig.ctx.runUntilIdle();
    Rig.answer(rig.post("/cameras/" + id, "{\"azimuth\": 45}"), 200);
    assertThat(rig.camera(id).getString("output")).isEqualTo("fmv/out-a");
    assertThat(Rig.answer(rig.post("/cameras/" + id, "{\"output\": \"fmv/out-b\"}"), 404).getString("field")).isEqualTo("output");
    Rig.answer(rig.post("/cameras/" + id, "{\"output\": null}"), 200);
    assertThat(rig.camera(id).get("output")).isEqualTo(JsonNull.INSTANCE);
  }

  @Test
  @DisplayName("Criterion 13, U10, C2: a link chosen by one camera is refused for a second, running or not")
  void oneCameraPerLink() {
    Rig rig = rig();
    UUID first = rig.camera(rig.track(AT), "\"output\": \"fmv/out-a\"");
    UUID track = rig.track(Position.of(17.4, 62.5));
    JsonObject refused = Rig.answer(rig.post("/cameras", "{\"platform\": \"" + track + "\", \"output\": \"fmv/out-a\"}"), 409);
    assertThat(refused.getString("field")).isEqualTo("output");
    assertThat(refused.getString("camera")).isEqualTo(first.toString());
    UUID second = rig.camera(track, "");
    assertThat(Rig.answer(rig.post("/cameras/" + second, "{\"output\": \"fmv/out-a\"}"), 409).getString("camera")).isEqualTo(first.toString());
    Rig.answer(rig.post("/cameras/" + first + "/remove", "{}"), 200);
    Rig.answer(rig.post("/cameras/" + second, "{\"output\": \"fmv/out-a\"}"), 200);
  }

  @Test
  @DisplayName("C5: a platform height outside −1 000 to 20 000 m is not sent, and counted and shown; in range it sends again")
  void heightGuard() {
    Rig rig = rig();
    UUID track = rig.track(Position.of(17.3, 62.4, 20_000));
    UUID id = rig.camera(track, "\"output\": \"fmv/out-a\"");
    rig.post("/cameras/" + id + "/start", "{}");
    rig.ctx.advance(Duration.ofMillis(40));
    assertThat(sent(rig)).as("20 000 m is in").hasSize(1);

    rig.move(track, Position.of(17.3, 62.4, 20_001), null, null);
    rig.ctx.advance(Duration.ofMillis(80));
    assertThat(sent(rig)).as("20 001 m is out").hasSize(1);
    assertThat(rig.camera(id).getString("notSent")).isEqualTo("the platform's height, 20001 m, is outside −1 000 to 20 000 m");
    assertThat(rig.camera(id).getString("state")).isEqualTo("running");

    rig.move(track, Position.of(17.3, 62.4, -1_001), null, null);
    rig.ctx.advance(Duration.ofMillis(40));
    assertThat(sent(rig)).as("−1 001 m is out").hasSize(1);
    rig.move(track, Position.of(17.3, 62.4, -1_000), null, null);
    rig.ctx.advance(Duration.ofMillis(40));
    assertThat(sent(rig)).as("−1 000 m is in").hasSize(2);
    assertThat(rig.camera(id).get("notSent")).isEqualTo(JsonNull.INSTANCE);

    rig.ctx.advance(Duration.ofMinutes(1));
    assertThat(rig.ctx.effectiveStatus().detail()).contains("3 not sent");
    assertThat(rig.ctx.effectiveStatus().state()).isEqualTo(PluginState.OK);
  }

  @Test
  @DisplayName("C5, C4: a reason not to send goes once the output is missing, which the state says")
  void reasonClears() {
    Rig rig = rig();
    UUID id = rig.camera(rig.track(Position.of(17.3, 62.4, 25_000)), "\"output\": \"fmv/out-a\"");
    rig.post("/cameras/" + id + "/start", "{}");
    rig.ctx.advance(Duration.ofMillis(40));
    assertThat(rig.camera(id).getString("notSent")).contains("25000 m");
    rig.ctx.channels().removeOther(OUT);
    rig.ctx.runUntilIdle();
    rig.ctx.advance(Duration.ofMillis(40));
    assertThat(rig.camera(id).getString("state")).isEqualTo("outputMissing");
    assertThat(rig.camera(id).get("notSent")).isEqualTo(JsonNull.INSTANCE);
  }

  @Test
  @DisplayName("C1: a renamed output's new name is stored, so a restart shows it while the output is missing")
  void renamedOutput() {
    Rig rig = rig();
    UUID id = rig.camera(rig.track(AT), "\"output\": \"fmv/out-a\"");
    rig.ctx.channels().removeOther(OUT);
    rig.ctx.channels().addOther(fmvOut(OUT, "UAV Far North (out)"));
    rig.ctx.runUntilIdle();
    assertThat(rig.camera(id).getString("outputName")).isEqualTo("UAV Far North (out)");
    Rig again = new Rig(rig.ctx.documents().stored());
    again.ctx.channels().declare(CameraWorker.KIND, schema());
    again.started();
    assertThat(again.camera(id).getString("outputName")).isEqualTo("UAV Far North (out)");
  }

  @Test
  @DisplayName("Criterion 13: a platform whose label changes sends the new label from the next pose")
  void label() {
    Rig rig = rig();
    UUID track = rig.track(AT);
    UUID id = rig.camera(track, "\"output\": \"fmv/out-a\"");
    rig.post("/cameras/" + id + "/start", "{}");
    rig.ctx.advance(Duration.ofMillis(40));
    SecurityLabel secret = SecurityLabel.of("NATO", "SECRET");
    assertThat(sent(rig).getLast().label()).isNotEqualTo(secret);
    rig.relabel(track, secret);
    rig.ctx.advance(Duration.ofMillis(40));
    assertThat(sent(rig).getLast().label()).isEqualTo(secret);
  }

  @Test
  @DisplayName("C6: a pose ECore refuses is counted, shown, logged once and DEGRADED; the worker goes on")
  void refused() {
    Rig rig = new Rig();
    rig.ctx.channels().declare(CameraWorker.KIND, (JsonObject) TestJson.parse("{\"type\": \"object\", \"required\": [\"nope\"]}"));
    rig.ctx.channels().addOther(fmvOut(OUT, "UAV North (out)"));
    rig.started();
    UUID id = rig.camera(rig.track(AT), "\"output\": \"fmv/out-a\"");
    rig.post("/cameras/" + id + "/start", "{}");
    rig.ctx.advance(Duration.ofMillis(200));
    assertThat(sent(rig)).isEmpty();
    JsonObject camera = rig.camera(id);
    assertThat(camera.getNumber("poses").longValueExact()).isEqualTo(5);
    assertThat(camera.getString("notSent")).startsWith("refused by ECore: ");
    assertThat(rig.ctx.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    assertThat(rig.ctx.effectiveStatus().detail()).contains("1 camera's poses are refused by ECore");
    assertThat(rig.ctx.logEntries().stream().filter(e -> e.level() == LogEntry.Level.WARN && e.message().contains("refused"))).hasSize(1);
    rig.post("/cameras/" + id + "/stop", "{}");
    assertThat(rig.ctx.effectiveStatus().state()).isEqualTo(PluginState.OK);
  }

  @Test
  @DisplayName("Function 9, part U: the link's state and detail are shown on the camera and the outputs; it sends in every state, and the status stays OK")
  void linkState() {
    Rig rig = rig();
    UUID id = rig.camera(rig.track(AT), "\"output\": \"fmv/out-a\"");
    JsonObject camera = rig.camera(id);
    assertThat(camera.getString("outputState")).as("READY until the link sets a state").isEqualTo("ready");
    assertThat(camera.getString("outputDetail")).isEmpty();
    rig.post("/cameras/" + id + "/start", "{}");
    rig.ctx.advance(Duration.ofMillis(40));
    assertThat(sent(rig)).hasSize(1);

    rig.ctx.channels().setOtherState(OUT, ChannelState.NOT_SENDING, "No destination");
    rig.ctx.runUntilIdle();
    rig.ctx.advance(Duration.ofMillis(80));
    assertThat(sent(rig)).as("the link takes items in every state, and fmv needs poses to try again").hasSize(3);
    camera = rig.camera(id);
    assertThat(camera.getString("state")).as("the camera's own state is unchanged").isEqualTo("running");
    assertThat(camera.getString("outputState")).isEqualTo("notSending");
    assertThat(camera.getString("outputDetail")).isEqualTo("No destination");
    JsonObject out = (JsonObject) ((JsonArray) rig.get().get("outputs")).get(0);
    assertThat(out.getString("state")).isEqualTo("notSending");
    assertThat(out.getString("detail")).isEqualTo("No destination");
    assertThat(rig.ctx.effectiveStatus().state()).as("text only (owner, 2026-11-17): fmv's status reports its fault").isEqualTo(PluginState.OK);
    assertThat(rig.ctx.effectiveStatus().detail()).contains("1 output not sending");

    rig.ctx.channels().setOtherState(OUT, ChannelState.DEGRADED, "Frames late");
    rig.ctx.runUntilIdle();
    assertThat(rig.camera(id).getString("outputState")).isEqualTo("degraded");
    assertThat(rig.camera(id).getString("outputDetail")).isEqualTo("Frames late");
    assertThat(rig.ctx.effectiveStatus().detail()).contains("1 output degraded").doesNotContain("not sending");

    rig.ctx.channels().setOtherState(OUT, ChannelState.READY, "");
    rig.ctx.runUntilIdle();
    assertThat(rig.camera(id).getString("outputState")).isEqualTo("ready");
    assertThat(rig.ctx.effectiveStatus().detail()).doesNotContain("degraded");

    rig.ctx.channels().setOtherState(OUT, ChannelState.NOT_SENDING, "Disabled");
    rig.ctx.runUntilIdle();
    rig.post("/cameras/" + id + "/stop", "{}");
    assertThat(rig.camera(id).getString("outputState")).as("a stopped camera still shows its link's state").isEqualTo("notSending");
    assertThat(rig.ctx.effectiveStatus().detail()).as("counted for running cameras only").doesNotContain("not sending");

    rig.ctx.channels().removeOther(OUT);
    rig.ctx.runUntilIdle();
    camera = rig.camera(id);
    assertThat(camera.get("outputState")).as("a missing output says nothing back (C4)").isEqualTo(JsonNull.INSTANCE);
    assertThat(camera.get("outputDetail")).isEqualTo(JsonNull.INSTANCE);
    UUID none = rig.camera(rig.track(Position.of(17.4, 62.5, 500)), "");
    assertThat(rig.camera(none).get("outputState")).as("no output (C3)").isEqualTo(JsonNull.INSTANCE);
  }

  @Test
  @DisplayName("Criterion 5: after a restart the camera keeps its output")
  void restart() {
    Rig rig = rig();
    UUID id = rig.camera(rig.track(AT), "\"output\": \"fmv/out-a\"");
    Map<String, JsonObject> stored = rig.ctx.documents().stored();
    Rig again = new Rig(stored);
    again.ctx.channels().declare(CameraWorker.KIND, schema());
    again.started(); // the output is not on offer after the restart
    assertThat(again.camera(id).getString("output")).isEqualTo("fmv/out-a");
    assertThat(again.camera(id).getString("outputName")).as("stored, as the platform's name is").isEqualTo("UAV North (out)");
    assertThat(again.camera(id).getBoolean("running")).isFalse();
  }

  @Test
  @DisplayName("C7, criterion 21: the copied schema is fmv's, once fmv's manifest declares camera-pose")
  void schemaIsFmvs() throws IOException {
    Path manifest = Manifest.pluginFolder().getParent().resolve("fmv").resolve("plugin.json");
    assumeTrue(Files.isRegularFile(manifest), "no fmv plugin here");
    JsonObject fmv = (JsonObject) TestJson.parse(Files.readString(manifest, StandardCharsets.UTF_8));
    JsonValue declared = null;
    if (fmv.get("channelKinds") instanceof JsonArray kinds) {
      for (JsonValue k : kinds.values()) {
        if (k instanceof JsonObject kind && "camera-pose".equals(kind.getString("name"))) {
          declared = kind.get("payload");
        }
      }
    }
    assumeTrue(declared != null, "fmv does not declare camera-pose yet (it comes with pca-fmv's output link)");
    assertThat(declared).isEqualTo(schema());
  }
}
