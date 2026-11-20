package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelInfo;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.channel.ChannelSpec;
import dev.emcc.sdk.channel.DeclaredItem;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** SDK 1.9.0 (CR-0048 point 4): declared channel kinds in the test kit's channels, and the payload check. */
class FakeChannelsDeclaredTest {

  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final String POSE = "fmv.camera-pose";
  private static final JsonObject SCHEMA = (JsonObject) TestJson.parse("""
      { "type": "object",
        "properties": {
          "camera": { "type": "string" },
          "heading": { "type": "number", "minimum": 0, "exclusiveMaximum": 360 },
          "frame": { "$ref": "#/$defs/frame" },
          "mission": { "type": "string", "minLength": 1, "maxLength": 64 } },
        "required": ["camera", "heading", "frame"],
        "additionalProperties": false,
        "$defs": { "frame": { "type": "object",
          "properties": { "width": { "type": "integer", "enum": [640, 1280, 1920] }, "rate": { "type": "integer", "minimum": 1, "maximum": 30 } },
          "required": ["width", "rate"] } } }
      """);

  private static JsonObject pose(String json) {
    return (JsonObject) TestJson.parse(json);
  }

  private static final JsonObject GOOD = pose("""
      { "camera": "c1", "heading": 45, "frame": { "width": 1280, "rate": 25 } }
      """);

  sealed interface Msg extends Message permits Item, Pose {}

  record Item(ChannelItem item) implements Msg {}

  record Pose(DeclaredItem item) implements Msg {}

  @Test
  void aSenderSendsOnlyWhatTheKindsSchemaAllows() {
    var ctx = FakePluginContext.builder("uav-simulation").build();
    var out = new ChannelId("fmv", "uav-north");
    ctx.channels().declare(POSE, SCHEMA);
    ctx.channels().addOther(ChannelInfo.of("fmv", ChannelSpec.of("uav-north", "UAV North (out)", "stanag-4609").declaredKinds(Set.of(POSE)).kinds(Set.of())));
    UUID camera = UUID.randomUUID();
    assertThat(ctx.channels().send(out, new DeclaredItem(POSE, camera, LABEL, GOOD))).isEqualTo(SendResult.ACCEPTED);
    assertThat(ctx.channels().sentDeclared(out)).hasSize(1);
    for (String bad : List.of(
        "{ \"camera\": \"c1\", \"heading\": 360, \"frame\": { \"width\": 1280, \"rate\": 25 } }",
        "{ \"camera\": \"c1\", \"heading\": 45, \"frame\": { \"width\": 1000, \"rate\": 25 } }",
        "{ \"camera\": \"c1\", \"heading\": 45, \"frame\": { \"width\": 1280, \"rate\": 25.5 } }",
        "{ \"camera\": \"c1\", \"heading\": 45 }",
        "{ \"camera\": \"c1\", \"heading\": 45, \"frame\": { \"width\": 1280, \"rate\": 25 }, \"extra\": 1 }",
        "{ \"camera\": \"c1\", \"heading\": 45, \"frame\": { \"width\": 1280, \"rate\": 25 }, \"mission\": \"\" }")) {
      assertThatThrownBy(() -> ctx.channels().send(out, new DeclaredItem(POSE, camera, LABEL, pose(bad)))).as(bad).isInstanceOf(IllegalArgumentException.class);
    }
    // a kind the channel does not take, and a channel that is gone
    assertThatThrownBy(() -> ctx.channels().send(out, new DeclaredItem("fmv.other", camera, LABEL, GOOD))).isInstanceOf(IllegalArgumentException.class);
    ctx.channels().removeOther(out);
    assertThat(ctx.channels().send(out, new DeclaredItem(POSE, camera, LABEL, GOOD))).isEqualTo(SendResult.CLOSED);
  }

  @Test
  void aPayloadOver64KiBIsRefused() {
    var ctx = FakePluginContext.builder("uav-simulation").build();
    var out = new ChannelId("fmv", "uav-north");
    ctx.channels().declare(POSE, pose("{ \"type\": \"object\" }"));
    ctx.channels().addOther(ChannelInfo.of("fmv", ChannelSpec.of("uav-north", "UAV North (out)", "stanag-4609").declaredKinds(Set.of(POSE)).kinds(Set.of())));
    var big = JsonObject.builder().put("text", new JsonString("x".repeat(DeclaredItem.MAX_PAYLOAD_BYTES))).build();
    assertThat(PayloadCheck.size(big)).isGreaterThan(DeclaredItem.MAX_PAYLOAD_BYTES);
    assertThatThrownBy(() -> ctx.channels().send(out, new DeclaredItem(POSE, UUID.randomUUID(), LABEL, big))).hasMessageContaining("at most");
  }

  @Test
  void theOfferingPluginGetsTheNewestItemPerIdThroughToDeclared() {
    var ctx = FakePluginContext.builder("fmv").build();
    List<Msg> got = new ArrayList<>();
    WorkerRef<Msg> w = ctx.workers().spawn(WorkerSpec.of("link", Msg.class, () -> (m, c) -> got.add(m)));
    ctx.channels().declare(POSE, SCHEMA);
    var spec = ChannelSpec.of("uav-north", "UAV North (out)", "stanag-4609").declaredKinds(Set.of(POSE)).kinds(Set.of());
    assertThatThrownBy(() -> ctx.channels().offer(spec, w, Item::new)).as("without toDeclared").isInstanceOf(IllegalArgumentException.class);
    var ref = ctx.channels().offer(spec, w, Item::new, Pose::new);
    UUID camera = UUID.randomUUID();
    ctx.channels().deliver(ref.id(), new DeclaredItem(POSE, camera, LABEL, GOOD));
    JsonObject newer = GOOD.with("heading", JsonNumber.of(90));
    ctx.channels().deliver(ref.id(), new DeclaredItem(POSE, camera, LABEL, newer));
    assertThat(ctx.channels().pendingDeclared(ref.id())).hasSize(1);
    ctx.runUntilIdle();
    assertThat(got).hasSize(1);
    assertThat(((Pose) got.getFirst()).item().payload()).isEqualTo(newer);
  }

  @Test
  void anOfferTakesOnlyItsOwnPluginsDeclaredKinds() {
    var ctx = FakePluginContext.builder("fmv").build();
    WorkerRef<Msg> w = ctx.workers().spawn(WorkerSpec.of("link", Msg.class, () -> (m, c) -> {}));
    var other = ChannelSpec.of("a", "A", "x").declaredKinds(Set.of("cot.track")).kinds(Set.of());
    ctx.channels().declare("cot.track", pose("{ \"type\": \"object\" }"));
    assertThatThrownBy(() -> ctx.channels().offer(other, w, Item::new, Pose::new)).hasMessageContaining("own plugin");
    var undeclared = ChannelSpec.of("b", "B", "x").declaredKinds(Set.of("fmv.unknown")).kinds(Set.of());
    assertThatThrownBy(() -> ctx.channels().offer(undeclared, w, Item::new, Pose::new)).hasMessageContaining("not declared");
  }

  @Test
  void aKindsSchemaIsSelfContained() {
    var ctx = FakePluginContext.builder("fmv").build();
    JsonValue remote = TestJson.parse("{ \"type\": \"object\", \"properties\": { \"a\": { \"$ref\": \"https://example.org/a.json\" } } }");
    assertThatThrownBy(() -> ctx.channels().declare(POSE, (JsonObject) remote)).hasMessageContaining("self-contained");
    assertThatThrownBy(() -> ctx.channels().declare(POSE, pose("{ \"type\": \"array\" }"))).hasMessageContaining("object schema");
    assertThat(PayloadCheck.remoteRef(SCHEMA)).isNull();
  }
}
