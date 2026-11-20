package dev.emcc.sdk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.channel.ChannelCapability;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelInfo;
import dev.emcc.sdk.channel.ChannelKind;
import dev.emcc.sdk.channel.ChannelSpec;
import dev.emcc.sdk.channel.Channels;
import dev.emcc.sdk.channel.DeclaredItem;
import dev.emcc.sdk.channel.SensorType;
import dev.emcc.sdk.compute.ComputeEvent;
import dev.emcc.sdk.compute.ComputeSpec;
import dev.emcc.sdk.compute.Computes;
import dev.emcc.sdk.connection.Restart;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.worker.Coalescing;
import dev.emcc.sdk.worker.Overflow;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** SDK 1.9.0 part P (CR-0048 points 4 and 5): declared channel kinds and compute tasks, as types. */
class Sdk19TypesTest {

  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final String POSE = "fmv.camera-pose";

  @Test
  void aDeclaredItemNamesItsKindAndCoalescesByItsId() {
    UUID camera = UUID.randomUUID();
    var payload = JsonObject.builder().put("camera", new JsonString(camera.toString())).build();
    var item = new DeclaredItem(POSE, camera, LABEL, payload);
    assertThat(item.plugin()).isEqualTo("fmv");
    assertThat(item.coalesceKey()).isEqualTo(camera);
    assertThat(item).isInstanceOf(Message.class).isInstanceOf(Coalescing.class);
    for (String bad : new String[] {"camera-pose", ".camera-pose", "fmv.", "fmv.camera.pose", "Fmv.camera-pose", "fmv.camera_pose", "fmv." + "a".repeat(65)}) {
      assertThatThrownBy(() -> new DeclaredItem(bad, camera, LABEL, payload)).as(bad).isInstanceOf(IllegalArgumentException.class);
    }
    assertThat(new DeclaredItem("map-view-2d." + "a".repeat(64), camera, LABEL, payload).kind()).endsWith("a");
    assertThatThrownBy(() -> new DeclaredItem(POSE, camera, null, payload)).isInstanceOf(NullPointerException.class);
    assertThatThrownBy(() -> new DeclaredItem(POSE, camera, LABEL, null)).isInstanceOf(NullPointerException.class);
    assertThat(DeclaredItem.MAX_PAYLOAD_BYTES).isEqualTo(65_536);
  }

  @Test
  void aChannelMayTakeDeclaredKindsOnly() {
    var spec = ChannelSpec.of("uav-north", "UAV North (out)", "stanag-4609").declaredKinds(Set.of(POSE)).kinds(Set.of());
    assertThat(spec.kinds()).isEmpty();
    assertThat(spec.takesDeclared(POSE)).isTrue();
    assertThat(spec.takes(ChannelKind.GROUND_TRUTH)).isFalse();
    var info = ChannelInfo.of("fmv", spec);
    assertThat(info.declaredKinds()).containsExactly(POSE);
    assertThat(info.takesDeclared(POSE)).isTrue();
    assertThat(info.takesDeclared("fmv.other")).isFalse();
    // at least one kind of either sort
    assertThatThrownBy(() -> ChannelSpec.of("a", "A", "cot").kinds(Set.of())).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> spec.declaredKinds(Set.of())).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> ChannelSpec.of("a", "A", "cot").declaredKinds(Set.of("camera-pose"))).isInstanceOf(IllegalArgumentException.class);
    var many = new java.util.HashSet<String>();
    for (int i = 0; i <= ChannelSpec.MAX_DECLARED_KINDS; i++) {
      many.add("fmv.kind-" + i);
    }
    assertThatThrownBy(() -> ChannelSpec.of("a", "A", "cot").declaredKinds(many)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void theOldConstructorsKeepTheirMeaningWithNoDeclaredKinds() {
    var spec = new ChannelSpec("gmti-out", "GMTI out", "stanag-4607", Set.of(ChannelCapability.DELETE), List.of(), Set.of(ChannelKind.SENSOR_REPORTS), null, 511_980.0,
        Set.of(SensorType.GROUND_RADAR));
    assertThat(spec.declaredKinds()).isEmpty();
    assertThat(spec.maxAreaDepth(1000).declaredKinds()).isEmpty();
    assertThat(ChannelSpec.of("a", "A", "cot").declaredKinds()).isEmpty();
    var info = new ChannelInfo(new ChannelId("gmti", "gmti-out"), "GMTI out", "stanag-4607", Set.of(), List.of(), Set.of(ChannelKind.SENSOR_REPORTS), null, null,
        Set.of(SensorType.GROUND_RADAR));
    assertThat(info.declaredKinds()).isEmpty();
    // other members carry the declared kinds along
    var both = ChannelSpec.of("a", "A", "cot").declaredKinds(Set.of("cot.track")).can(ChannelCapability.DELETE).fieldSet("cot.unit");
    assertThat(both.declaredKinds()).containsExactly("cot.track");
    assertThat(both.kinds()).containsExactly(ChannelKind.GROUND_TRUTH);
  }

  @Test
  void theNewChannelCallsAndComputeAreAbstractSinceTheFreeze() throws Exception {
    for (var m : List.of(
        Channels.class.getMethod("send", ChannelId.class, DeclaredItem.class),
        Channels.class.getMethod("offer", ChannelSpec.class, dev.emcc.sdk.worker.WorkerRef.class, java.util.function.Function.class, java.util.function.Function.class),
        PluginContext.class.getMethod("compute"))) {
      assertThat(m.isDefault()).as(m.getName() + ": a default until the 1.9.0 freeze").isFalse();
      assertThat(java.lang.reflect.Modifier.isAbstract(m.getModifiers())).as(m.getName()).isTrue();
    }
  }

  record Pose(UUID camera) implements Message, Coalescing {
    @Override
    public Object coalesceKey() {
      return camera;
    }
  }

  record Plain(int n) implements Message {}

  @Test
  void aComputeSpecChecksItsNameInboxAndCoalescing() {
    var spec = ComputeSpec.of("camera-north", Pose.class);
    assertThat(spec.inboxCapacity()).isEqualTo(ComputeSpec.DEFAULT_INBOX_CAPACITY);
    assertThat(spec.overflow()).isInstanceOf(Overflow.DropNewest.class);
    assertThat(spec.restart()).isInstanceOf(Restart.Never.class);
    assertThat(spec.inbox(16, Overflow.coalesceByKey()).inboxCapacity()).isEqualTo(16);
    for (String bad : new String[] {"", "Camera", "camera_1", "-a", "a".repeat(65)}) {
      assertThatThrownBy(() -> ComputeSpec.of(bad, Pose.class)).as(bad).isInstanceOf(IllegalArgumentException.class);
    }
    assertThatThrownBy(() -> spec.inbox(0, Overflow.dropNewest())).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> spec.inbox(ComputeSpec.MAX_INBOX_CAPACITY + 1, Overflow.dropNewest())).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> ComputeSpec.of("a", Plain.class).inbox(10, Overflow.coalesceByKey())).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void computeEventsAndTheLimits() {
    Instant at = Instant.parse("2026-11-16T10:00:00Z");
    assertThat(new ComputeEvent.Refused("a", at, ComputeEvent.Refusal.TOTAL_CAP).refusal()).isEqualTo(ComputeEvent.Refusal.TOTAL_CAP);
    assertThat(new ComputeEvent.Stopped("a", at, null).reason()).isNull();
    assertThat(ComputeEvent.Refusal.values()).containsExactly(
        ComputeEvent.Refusal.NOT_DECLARED, ComputeEvent.Refusal.SWITCHED_OFF, ComputeEvent.Refusal.PLUGIN_LIMIT, ComputeEvent.Refusal.TOTAL_CAP);
    assertThat(Computes.STOP_GRACE).isEqualTo(Duration.ofSeconds(5));
    assertThat(Computes.MAX_DECLARED).isEqualTo(64);
    assertThatThrownBy(() -> new ComputeEvent.Failed("a", at, null)).isInstanceOf(NullPointerException.class);
  }
}
