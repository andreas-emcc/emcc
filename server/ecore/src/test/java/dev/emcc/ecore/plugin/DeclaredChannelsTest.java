package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.channel.ChannelKind;
import dev.emcc.sdk.channel.ChannelRef;
import dev.emcc.sdk.channel.ChannelSpec;
import dev.emcc.sdk.channel.DeclaredItem;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** SDK 1.9.0 (CR-0048 point 4; PQ2 A): declared channel kinds through {@link PluginChannels}, as plugins use them. */
class DeclaredChannelsTest {

  /** What the offering worker gets from {@code toDeclared}, and whether the registry's lock was held. */
  record Pose(DeclaredItem item, boolean underLock) implements Message {}

  /** What it gets from {@code toMessage}. */
  record Got(ChannelItem item) implements Message {}

  record Gate(CountDownLatch open) implements Message {}

  private static final ModelJson JSON = new ModelJson();
  private static final String POSE = "fmv.camera-pose";
  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final ChannelRegistry registry = new ChannelRegistry(runtime, 3, 1);
  private final PluginChannels fmv = new PluginChannels("fmv", registry, 2, Map.of(POSE, PayloadSchema.compile(POSE, JSON.parse("""
      {"type": "object", "properties": {"heading": {"type": "number", "minimum": 0, "exclusiveMaximum": 360}, "note": {"type": "string"}},
       "required": ["heading"], "additionalProperties": false}"""))));
  private final PluginChannels sim = new PluginChannels("uav-simulation", registry, 2);
  private final LinkedBlockingQueue<Message> got = new LinkedBlockingQueue<>();
  private final PluginWorkers workers = new PluginWorkers("fmv", runtime.owner("fmv"), getClass().getClassLoader());
  private final UUID camera = UUID.randomUUID();
  private int spawned;

  @AfterEach
  void close() {
    runtime.close();
  }

  private WorkerRef<Message> worker() {
    return workers.spawn(WorkerSpec.of("out-" + ++spawned, Message.class, () -> (message, ctx) -> {
      if (message instanceof Gate g) {
        try {
          g.open().await(10, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
        }
      } else {
        got.add(message);
      }
    }));
  }

  private ChannelRef offer(WorkerRef<Message> worker) {
    return fmv.offer(ChannelSpec.of("uav-north", "UAV north (out)", "stanag-4609").declaredKinds(Set.of(POSE)).kinds(Set.of()), worker,
        Got::new, d -> new Pose(d, registry.lockHeldByCurrentThread()));
  }

  private static JsonObject heading(double degrees) {
    return (JsonObject) ModelJson.toJsonValue(JSON.parse("{\"heading\":" + degrees + "}"));
  }

  private DeclaredItem pose(double degrees) {
    return new DeclaredItem(POSE, camera, LABEL, heading(degrees));
  }

  private Pose nextPose() throws InterruptedException {
    Message m = got.poll(10, TimeUnit.SECONDS);
    assertThat(m).as("within 10 s").isInstanceOf(Pose.class);
    Pose p = (Pose) m;
    assertThat(p.underLock()).as("the mapper runs outside the registry's lock").isFalse();
    return p;
  }

  @Test
  void anotherPluginSendsAPoseToTheDeclaringPluginsChannel() throws InterruptedException {
    ChannelRef ref = offer(worker());

    assertThat(sim.send(ref.id(), pose(90))).isEqualTo(SendResult.ACCEPTED);

    DeclaredItem item = nextPose().item();
    assertThat(item.payload().getNumber("heading").bigDecimalValue()).isEqualByComparingTo("90");
    assertThat(item.label()).isEqualTo(LABEL);
    assertThat(registry.list().channels()).singleElement().satisfies(info -> {
      assertThat(info.takesDeclared(POSE)).isTrue();
      assertThat(info.kinds()).isEmpty();
    });
    assertThat(sim.send(new ChannelId("fmv", "nowhere"), pose(1))).isEqualTo(SendResult.CLOSED);
    ref.withdraw();
    assertThat(sim.send(ref.id(), pose(1))).isEqualTo(SendResult.CLOSED);
  }

  @Test
  void refusesAKindTheChannelDoesNotTakeAPayloadOverItsSizeOrOneThatDoesNotMatchItsSchema() {
    ChannelRef ref = offer(worker());

    assertThatThrownBy(() -> sim.send(ref.id(), new DeclaredItem("fmv.frame", camera, LABEL, heading(1))))
        .isInstanceOf(IllegalArgumentException.class).hasMessage("the channel fmv/uav-north does not take fmv.frame (it takes [fmv.camera-pose])");
    assertThatThrownBy(() -> sim.send(ref.id(), pose(360)))
        .isInstanceOf(IllegalArgumentException.class).hasMessageStartingWith("a payload of fmv.camera-pose does not match its schema: /heading: ");
    JsonObject big = (JsonObject) ModelJson.toJsonValue(JSON.parse("{\"heading\":1,\"note\":\"" + "x".repeat(DeclaredItem.MAX_PAYLOAD_BYTES) + "\"}"));
    assertThatThrownBy(() -> sim.send(ref.id(), new DeclaredItem(POSE, camera, LABEL, big)))
        .isInstanceOf(IllegalArgumentException.class).hasMessageStartingWith("a payload of fmv.camera-pose is at most 65536 bytes: 65");
    assertThat(registry.stats("fmv")).singleElement().satisfies(s -> assertThat(s.sent()).as("nothing refused got in").isZero());
  }

  @Test
  void aChannelWithdrawnWhileThePayloadIsCheckedAnswersClosed() {
    ChannelRef ref = offer(worker());
    registry.afterDeclaredCheck = ref::withdraw; // between the check, outside the lock, and the put

    assertThat(sim.send(ref.id(), pose(90))).isEqualTo(SendResult.CLOSED);
    ChannelRef again = offer(worker());
    registry.afterDeclaredCheck = () -> {
      again.withdraw();
      offer(worker()); // withdrawn and offered again: another channel of the same id
    };
    assertThat(sim.send(again.id(), pose(90))).as("not the channel that was checked").isEqualTo(SendResult.CLOSED);
    assertThat(registry.stats("fmv")).singleElement().satisfies(s -> assertThat(s.sent()).isZero());
  }

  @Test
  void aChannelTakesOnlyItsOwnPluginsDeclaredKindsWithAMapperForThem() {
    WorkerRef<Message> worker = worker();
    assertThatThrownBy(() -> sim.offer(ChannelSpec.of("pose-in", "Poses", "pose").declaredKinds(Set.of(POSE)).kinds(Set.of()), worker,
        Got::new, d -> new Pose(d, false)))
        .isInstanceOf(IllegalArgumentException.class).hasMessage("a channel takes only its own plugin's declared kinds: fmv.camera-pose");
    assertThatThrownBy(() -> fmv.offer(ChannelSpec.of("frames", "Frames", "x").declaredKinds(Set.of("fmv.frame")).kinds(Set.of()), worker,
        Got::new, d -> new Pose(d, false)))
        .isInstanceOf(IllegalArgumentException.class).hasMessage("the kind fmv.frame is not declared in the manifest's channelKinds");
    assertThatThrownBy(() -> fmv.offer(ChannelSpec.of("old", "Old", "x").declaredKinds(Set.of(POSE)).kinds(Set.of()), worker, Got::new))
        .as("the old offer has no toDeclared").isInstanceOf(IllegalArgumentException.class).hasMessageContaining("toDeclared");
    assertThat(registry.list().channels()).isEmpty();
  }

  @Test
  void keepsTheNewestPosePerCameraAndNeverReplacesAnObjectsItem() throws InterruptedException {
    WorkerRef<Message> worker = worker();
    ChannelRef ref = fmv.offer(ChannelSpec.of("mixed", "Mixed", "x").kinds(Set.of(ChannelKind.GROUND_TRUTH)).declaredKinds(Set.of(POSE)), worker,
        Got::new, d -> new Pose(d, false));
    CountDownLatch open = new CountDownLatch(1);
    assertThat(worker.send(new Gate(open))).isEqualTo(SendResult.ACCEPTED);

    sim.send(ref.id(), pose(1)); // handed over at once (one in flight), waits behind the gate
    sim.send(ref.id(), pose(2));
    sim.send(ref.id(), new ChannelItem.Removal(camera)); // an object with the camera's id: its own place
    sim.send(ref.id(), pose(3)); // replaces pose 2 in its place
    open.countDown();

    assertThat(heading((Pose) got.poll(10, TimeUnit.SECONDS))).isEqualTo(1);
    assertThat(heading((Pose) got.poll(10, TimeUnit.SECONDS))).isEqualTo(3);
    assertThat(got.poll(10, TimeUnit.SECONDS)).isEqualTo(new Got(new ChannelItem.Removal(camera)));
    assertThat(registry.stats("fmv")).singleElement().satisfies(s -> {
      assertThat(s.sent()).isEqualTo(4);
      assertThat(s.replaced()).isEqualTo(1);
      assertThat(s.info().declaredKinds()).containsExactly(POSE);
    });
  }

  private static double heading(Pose p) {
    return p.item().payload().getNumber("heading").bigDecimalValue().doubleValue();
  }
}
