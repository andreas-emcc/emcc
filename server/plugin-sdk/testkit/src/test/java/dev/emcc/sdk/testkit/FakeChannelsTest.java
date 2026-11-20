package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.ClassificationLimit;
import dev.emcc.sdk.Classifications;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.channel.ChannelCapability;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelInfo;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.channel.ChannelKind;
import dev.emcc.sdk.channel.ChannelList;
import dev.emcc.sdk.channel.ChannelRef;
import dev.emcc.sdk.channel.ChannelSpec;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** SDK 1.2.0 (CR-0025 part 3): the test kit's output channels, as ECore keeps them (ADR-0037). */
class FakeChannelsTest {

  sealed interface Msg extends Message permits Item, Channels {}

  record Item(ChannelItem item) implements Msg {}

  record Channels(ChannelList list) implements Msg {}

  private static final UUID A = UUID.fromString("0b5c2f4e-8f43-4d7a-9a51-2c1f1c3c9e01");
  private static final UUID B = UUID.fromString("5e8d7c6b-4a39-4281-b7f6-0e1d2c3b4a59");
  private static final UUID LAYER = UUID.fromString("7d3f1a52-2b4e-4c1f-9e0a-5b6c7d8e9f10");

  private final List<Msg> received = new ArrayList<>();

  private WorkerRef<Msg> worker(FakePluginContext ctx) {
    return ctx.workers().spawn(WorkerSpec.of("link", Msg.class, () -> (m, c) -> received.add(m)));
  }

  private List<ChannelItem> items() {
    return received.stream().filter(m -> m instanceof Item).map(m -> ((Item) m).item()).toList();
  }

  private List<ChannelList> lists() {
    return received.stream().filter(m -> m instanceof Channels).map(m -> ((Channels) m).list()).toList();
  }

  private static ChannelItem.Update update(UUID id, double lon) {
    // lon differs from lat in every position, so a swapped order would show
    var content = new MapObjectContent("core.shape", MapObjectContent.GENERAL, "simulation", null, LAYER,
        new Geometry.Point(Position.of(lon, 57.7089)), null, null, null, SecurityLabel.of("NATO", "UNCLASSIFIED"), Extensions.empty());
    return new ChannelItem.Update(id, content);
  }

  @Test
  void anOfferedChannelIsListedToWatchersAndWithdrawnAgain() {
    var ctx = FakePluginContext.builder("cot").build();
    WorkerRef<Msg> w = worker(ctx);
    ctx.channels().watch(w, Channels::new);
    ChannelRef ref = ctx.channels().offer(ChannelSpec.of("tak-north", "TAK North (out)", "cot").can(ChannelCapability.DELETE), w, Item::new);
    ctx.runUntilIdle();
    assertThat(ref.id()).isEqualTo(new ChannelId("cot", "tak-north"));
    assertThat(lists()).as("only the latest undelivered list").hasSize(1);
    assertThat(lists().getLast().find(ref.id())).hasValueSatisfying(c -> assertThat(c.canDelete()).isTrue());
    ref.withdraw();
    ref.withdraw();
    ctx.runUntilIdle();
    assertThat(lists().getLast().channels()).isEmpty();
    assertThat(ctx.channels().send(ref.id(), update(A, 11.9746))).isEqualTo(SendResult.CLOSED);
    ctx.channels().offer(ChannelSpec.of("tak-north", "TAK North (out)", "cot"), w, Item::new); // the link may come back
  }

  @Test
  void cr0035AnOfferedChannelsMaxAreaDepthIsListed() {
    var ctx = FakePluginContext.builder("gmti").build();
    WorkerRef<Msg> w = worker(ctx);
    ctx.channels().watch(w, Channels::new);
    ChannelRef ref = ctx.channels().offer(
        ChannelSpec.of("vista-out", "VISTA (out)", "gmti").kinds(Set.of(ChannelKind.SENSOR_REPORTS)).maxAreaDepth(511_980), w, Item::new);
    ctx.runUntilIdle();
    assertThat(lists().getLast().find(ref.id())).hasValueSatisfying(c -> assertThat(c.maxAreaDepth()).isEqualTo(511_980.0));
  }

  @Test
  void theInboxKeepsTheLatestItemPerObjectUntilTheWorkerHandlesIt() {
    var ctx = FakePluginContext.builder("cot").build();
    WorkerRef<Msg> w = worker(ctx);
    ChannelId id = ctx.channels().offer(ChannelSpec.of("tak-north", "TAK North (out)", "cot"), w, Item::new).id();
    ctx.channels().send(id, update(A, 11.9746));
    ctx.channels().send(id, update(B, 12.0001));
    ctx.channels().send(id, update(A, 11.9800));
    assertThat(ctx.channels().pending(id)).as("replaced in place").containsExactly(update(A, 11.9800), update(B, 12.0001));
    ctx.channels().send(id, new ChannelItem.Removal(B));
    assertThat(ctx.channels().pending(id)).as("a removal replaces a pending update").containsExactly(update(A, 11.9800), new ChannelItem.Removal(B));
    ctx.runUntilIdle();
    assertThat(items()).containsExactly(update(A, 11.9800), new ChannelItem.Removal(B));
    assertThat(ctx.channels().sent(id)).as("everything sent is recorded").hasSize(4);
    assertThat(ctx.channels().pending(id)).isEmpty();
  }

  @Test
  void itemsPendingWhenTheChannelIsWithdrawnAreDropped() {
    var ctx = FakePluginContext.builder("cot").build();
    WorkerRef<Msg> w = worker(ctx);
    ChannelRef ref = ctx.channels().offer(ChannelSpec.of("tak-north", "TAK North (out)", "cot"), w, Item::new);
    ctx.channels().send(ref.id(), update(A, 11.9746));
    ref.withdraw();
    ctx.runUntilIdle();
    assertThat(items()).isEmpty();
  }

  @Test
  void otherPluginsChannelsAreScriptedAndWhatIsSentToThemIsRecorded() {
    var ctx = FakePluginContext.builder("simulator").build();
    WorkerRef<Msg> w = worker(ctx);
    var tak = ChannelInfo.of("cot", ChannelSpec.of("tak-north", "TAK North (out)", "cot"));
    var ais = ChannelInfo.of("ais", ChannelSpec.of("coast", "Coast", "ais"));
    ctx.channels().addOther(tak);
    Cancellable watching = ctx.channels().watch(w, Channels::new);
    ctx.runUntilIdle();
    ctx.channels().addOther(ais);
    ctx.runUntilIdle();
    assertThat(lists()).hasSize(2);
    assertThat(lists().getLast().channels()).as("by plugin, then link").containsExactly(ais, tak);
    assertThat(ctx.channels().send(tak.id(), update(A, 11.9746))).isEqualTo(SendResult.ACCEPTED);
    assertThat(ctx.channels().sent(tak.id())).containsExactly(update(A, 11.9746));
    assertThat(ctx.channels().send(new ChannelId("cot", "gone"), update(A, 11.9746))).isEqualTo(SendResult.CLOSED);
    watching.cancel();
    ctx.channels().removeOther(ais.id());
    ctx.runUntilIdle();
    assertThat(lists()).as("no lists after the cancel").hasSize(2);
    assertThatThrownBy(() -> ctx.channels().addOther(ChannelInfo.of("simulator", ChannelSpec.of("x", "X", "cot")))).hasMessageContaining("offer");
  }

  @Test
  void deliverDrivesAnOfferingPluginAndTheCapAndNamesAreChecked() {
    var ctx = FakePluginContext.builder("cot").maxChannels(1).build();
    WorkerRef<Msg> w = worker(ctx);
    ChannelId id = ctx.channels().offer(ChannelSpec.of("tak-north", "TAK North (out)", "cot"), w, Item::new).id();
    ctx.channels().deliver(id, new ChannelItem.Removal(A));
    ctx.runUntilIdle();
    assertThat(items()).containsExactly(new ChannelItem.Removal(A));
    assertThatThrownBy(() -> ctx.channels().deliver(new ChannelId("cot", "other"), new ChannelItem.Removal(A))).hasMessageContaining("offers no channel");
    assertThatThrownBy(() -> ctx.channels().offer(ChannelSpec.of("tak-north", "Again", "cot"), w, Item::new)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> ctx.channels().offer(ChannelSpec.of("tak-south", "South", "cot"), w, Item::new))
        .isInstanceOf(IllegalStateException.class).hasMessageContaining("too many channels");
  }

  @Test
  void anOfferingWorkerPostsItemsToATaskInboxThatCoalescesByTheSameKey() {
    var ctx = FakePluginContext.builder("cot").build();
    // A task that never takes, so its inbox shows what coalesced.
    dev.emcc.sdk.connection.ConnectionTask<ChannelItem> idle = task -> {
      var in = task.closeOnStop(new java.io.PipedInputStream(new java.io.PipedOutputStream()));
      in.read();
    };
    dev.emcc.sdk.connection.ConnectionRef<ChannelItem> out = ctx.connections().start(
        dev.emcc.sdk.connection.ConnectionSpec.of("tak-north", ChannelItem.class).inbox(10, dev.emcc.sdk.worker.Overflow.coalesceByKey()), () -> idle);
    WorkerRef<Msg> link = ctx.workers().spawn(WorkerSpec.of("link", Msg.class, () -> (m, c) -> {
      if (m instanceof Item i) {
        out.post(i.item());
      }
    }));
    ChannelId id = ctx.channels().offer(ChannelSpec.of("tak-north", "TAK North (out)", "cot"), link, Item::new).id();
    ctx.channels().send(id, update(A, 11.9746));
    ctx.runUntilIdle();
    ctx.channels().send(id, update(B, 12.0001));
    ctx.runUntilIdle();
    ctx.channels().send(id, update(A, 11.9800));
    ctx.runUntilIdle();
    ctx.channels().send(id, new ChannelItem.Removal(A));
    ctx.runUntilIdle();
    assertThat(ctx.connectionTask("tak-north", ChannelItem.class).inbox()).as("each handed over, then coalesced in the task's inbox")
        .containsExactly(new ChannelItem.Removal(A), update(B, 12.0001));
    out.stop();
  }

  @Test
  void aFullInboxDropsItsOldestObject() {
    var ctx = FakePluginContext.builder("cot").build();
    WorkerRef<Msg> w = worker(ctx);
    ChannelId id = ctx.channels().offer(ChannelSpec.of("tak-north", "TAK North (out)", "cot"), w, Item::new).id();
    var first = new ChannelItem.Removal(new UUID(0, 0));
    ctx.channels().send(id, first);
    for (int i = 1; i <= dev.emcc.sdk.channel.Channels.MAX_PENDING; i++) {
      ctx.channels().send(id, new ChannelItem.Removal(new UUID(0, i)));
    }
    assertThat(ctx.channels().pending(id)).hasSize(dev.emcc.sdk.channel.Channels.MAX_PENDING).doesNotContain(first);
  }

  @Test
  void aMapperThatThrowsLosesItsItemAndTheNextOnesStillCome() {
    var ctx = FakePluginContext.builder("cot").rethrowHandlerErrors(false).build();
    WorkerRef<Msg> w = worker(ctx);
    ChannelId id = ctx.channels().offer(ChannelSpec.of("tak-north", "TAK North (out)", "cot"), w, item -> {
      if (item.id().equals(A)) {
        throw new IllegalStateException("cannot map " + item.id());
      }
      return new Item(item);
    }).id();
    ctx.channels().send(id, update(A, 11.9746));
    ctx.channels().send(id, update(B, 12.0001));
    ctx.runUntilIdle();
    assertThat(items()).containsExactly(update(B, 12.0001));
    assertThat(ctx.handlerErrors()).hasSize(1);
  }

  @Test
  void aLinkOfferedAgainGetsOnlyWhatIsSentAfterwards() {
    var ctx = FakePluginContext.builder("cot").build();
    WorkerRef<Msg> w = worker(ctx);
    ChannelRef old = ctx.channels().offer(ChannelSpec.of("tak-north", "TAK North (out)", "cot"), w, Item::new);
    ctx.channels().send(old.id(), update(A, 11.9746)); // its delivery is queued
    old.withdraw();
    ChannelRef again = ctx.channels().offer(ChannelSpec.of("tak-north", "TAK North (out)", "cot"), w, Item::new);
    ctx.channels().send(again.id(), update(B, 12.0001));
    ctx.runUntilIdle();
    assertThat(items()).as("the old run's item is dropped with it").containsExactly(update(B, 12.0001));
    assertThat(again).isNotEqualTo(old);
  }

  @Test
  void releaseRefusesOfferAndWatchAsECoreDoesOnceThePluginHasStopped() {
    // SDK 1.3.0 (CR-0028; owner, 2026-10-30, Q4)
    var ctx = FakePluginContext.builder("cot").build();
    WorkerRef<Msg> w = worker(ctx);
    ctx.channels().addOther(ChannelInfo.of("simulator", ChannelSpec.of("ships", "Ships", "simulator")));
    Cancellable watch = ctx.channels().watch(w, Channels::new);
    ChannelRef ref = ctx.channels().offer(ChannelSpec.of("tak-north", "TAK North (out)", "cot"), w, Item::new);
    ctx.runUntilIdle();
    received.clear();
    ctx.channels().send(ref.id(), update(A, 11.9746)); // pending when the plugin stops
    ctx.channels().release();
    ctx.channels().release(); // a second call does nothing
    ctx.runUntilIdle();
    assertThat(received).as("its pending item dropped, its watch cancelled").isEmpty();
    assertThat(ctx.channels().offered()).isEmpty();
    assertThat(ctx.channels().list().channels()).extracting(ChannelInfo::id).containsExactly(new ChannelId("simulator", "ships"));
    assertThat(ctx.channels().send(ref.id(), update(B, 12.0001))).isEqualTo(SendResult.CLOSED);
    assertThatThrownBy(() -> ctx.channels().offer(ChannelSpec.of("tak-south", "TAK South (out)", "cot"), w, Item::new))
        .isInstanceOf(IllegalStateException.class).hasMessageContaining("has stopped");
    assertThatThrownBy(() -> ctx.channels().watch(w, Channels::new)).isInstanceOf(IllegalStateException.class);
    watch.cancel(); // still harmless
  }

  @Test
  void aChannelGetsOnlyTheKindsItTakesAndKeepsTheLatestReportPerSensor() {
    // SDK 1.4.0 (CR-0030 part 1; ADR-0048 point 4)
    var ctx = FakePluginContext.builder("gmti").build();
    WorkerRef<Msg> w = worker(ctx);
    ChannelRef out = ctx.channels().offer(ChannelSpec.of("gmti-out", "GMTI (out)", "gmti").kinds(Set.of(ChannelKind.SENSOR_REPORTS)), w, Item::new);
    ctx.channels().addOther(ChannelInfo.of("cot", ChannelSpec.of("tak-north", "TAK North (out)", "cot")));
    UUID sensor = UUID.fromString("7d3f1a52-2b4e-4c1f-9e0a-5b6c7d8e9f11");
    var area = new Geometry.Circle(Position.of(11.9746, 57.7089), 20_000);
    var first = new ChannelItem.SensorReport(sensor, Position.of(11.5, 57.5), Instant.parse("2026-11-05T12:00:00Z"), area, List.of());
    var second = new ChannelItem.SensorReport(sensor, Position.of(11.6, 57.5), Instant.parse("2026-11-05T12:00:10Z"), area, List.of());
    assertThat(ctx.channels().send(out.id(), first)).isEqualTo(SendResult.ACCEPTED);
    assertThat(ctx.channels().send(out.id(), second)).isEqualTo(SendResult.ACCEPTED);
    ctx.runUntilIdle();
    assertThat(items()).as("the latest report per sensor").containsExactly(second);
    assertThatThrownBy(() -> ctx.channels().send(out.id(), update(A, 11.9746))).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("does not take GROUND_TRUTH");
    assertThatThrownBy(() -> ctx.channels().send(new ChannelId("cot", "tak-north"), first)).as("a 1.3.0 channel takes ground truth only")
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(ctx.channels().send(new ChannelId("cot", "gone"), first)).as("an unknown channel stays CLOSED").isEqualTo(SendResult.CLOSED);
  }

  @Test
  void cr0040ARevisitsDwellsAllReachTheWorkerAndANewerRevisitReplacesTheSameDwell() {
    // SDK 1.5.0 part 3 (CR-0040 point 2): the inbox keeps the latest report per sensor and dwell number
    var ctx = FakePluginContext.builder("gmti").build();
    WorkerRef<Msg> w = worker(ctx);
    ChannelRef out = ctx.channels().offer(ChannelSpec.of("gmti-out", "GMTI (out)", "gmti").kinds(Set.of(ChannelKind.SENSOR_REPORTS))
        .sensorTypes(Set.of(dev.emcc.sdk.channel.SensorType.GROUND_RADAR)), w, Item::new);
    UUID sensor = UUID.fromString("7d3f1a52-2b4e-4c1f-9e0a-5b6c7d8e9f12");
    var area = new Geometry.Circle(Position.of(11.9746, 57.7089), 20_000);
    var start = Instant.parse("2026-11-10T12:00:00Z");
    List<ChannelItem.SensorReport> revisit = new ArrayList<>();
    for (int dwell = 0; dwell < 3; dwell++) {
      revisit.add(new ChannelItem.SensorReport(sensor, Position.of(11.5, 57.5), start.plusMillis(200L * dwell), area, List.of())
          .withSequence(new ChannelItem.SensorReport.Sequence(7, dwell, dwell == 2)));
    }
    revisit.forEach(r -> ctx.channels().send(out.id(), r));
    assertThat(ctx.channels().pending(out.id())).as("no dwell replaces another of its revisit").containsExactlyElementsOf(revisit);
    var newer = new ChannelItem.SensorReport(sensor, Position.of(11.6, 57.5), start.plusSeconds(10), area, List.of())
        .withSequence(new ChannelItem.SensorReport.Sequence(8, 1, false));
    ctx.channels().send(out.id(), newer);
    assertThat(ctx.channels().pending(out.id())).as("dwell 1 of the next revisit replaces dwell 1 in place").containsExactly(revisit.get(0), newer, revisit.get(2));
    ctx.runUntilIdle();
    assertThat(items()).containsExactly(revisit.get(0), newer, revisit.get(2));
  }

  @Test
  void theOrderOfClassificationsIsNatosUnlessTheBuilderSetsAnother() {
    var nato = FakePluginContext.builder("cot").build();
    assertThat(nato.classifications()).isEqualTo(Classifications.nato());
    var se = FakePluginContext.builder("cot").classifications(new Classifications(Map.of("SE", List.of("UNCLASSIFIED", "SECRET")))).build();
    var limit = ClassificationLimit.from(null, SecurityLabel.of("SE", "UNCLASSIFIED"));
    assertThat(se.classifications().within(SecurityLabel.of("SE", "SECRET"), limit)).isFalse();
    assertThat(se.classifications().within(SecurityLabel.of("SE", "UNCLASSIFIED"), limit)).isTrue();
  }
}
