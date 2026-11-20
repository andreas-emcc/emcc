package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.channel.ChannelCapability;
import dev.emcc.sdk.channel.ChannelId;
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
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** The output channels (SDK 1.2.0, ADR-0037) through {@link PluginChannels}, as plugins use them. */
class ChannelRegistryTest {

  /** What the offering worker gets: an item, made by the mapper. */
  record Got(ChannelItem item, boolean underLock) implements Message {}

  /** What a watcher gets. */
  record Listed(ChannelList list, boolean underLock) implements Message {}

  /** Holds the offering worker until the test lets it go, so that items pile up. */
  record Gate(CountDownLatch open) implements Message {}

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final ChannelRegistry registry = new ChannelRegistry(runtime, 3, 1);
  private final PluginChannels cot = new PluginChannels("cot", registry, 2);
  private final PluginChannels sim = new PluginChannels("simulator", registry, 2);
  private final LinkedBlockingQueue<Message> got = new LinkedBlockingQueue<>();
  private final Map<String, PluginWorkers> workers = new HashMap<>();
  private final UUID a = UUID.randomUUID();
  private final UUID b = UUID.randomUUID();
  private int spawned;

  @AfterEach
  void close() {
    runtime.close();
  }

  private WorkerRef<Message> worker(String plugin) {
    PluginWorkers w = workers.computeIfAbsent(plugin, p -> new PluginWorkers(p, runtime.owner(p), getClass().getClassLoader()));
    return w.spawn(WorkerSpec.of("link-" + ++spawned, Message.class, () -> (message, ctx) -> {
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

  private ChannelRef offer(WorkerRef<Message> worker, String link) {
    return cot.offer(ChannelSpec.of(link, "TAK " + link, "cot").can(ChannelCapability.DELETE), worker,
        item -> new Got(item, registry.lockHeldByCurrentThread()));
  }

  /** Holds {@code worker} on a gate; returns the latch that opens it. */
  private static CountDownLatch hold(WorkerRef<Message> worker) {
    CountDownLatch open = new CountDownLatch(1);
    assertThat(worker.send(new Gate(open))).isEqualTo(SendResult.ACCEPTED);
    return open;
  }

  private Message next() throws InterruptedException {
    Message m = got.poll(10, TimeUnit.SECONDS);
    assertThat(m).as("within 10 s").isNotNull();
    return m;
  }

  private ChannelItem nextItem() throws InterruptedException {
    Got g = (Got) next();
    assertThat(g.underLock()).as("the mapper runs outside the registry's lock (P3-2)").isFalse();
    return g.item();
  }

  private static ChannelItem.Update update(UUID id, double lon) {
    return new ChannelItem.Update(id, new MapObjectContent(MapObjectContent.SYMBOL, MapObjectContent.GENERAL, "sim-1", null, UUID.randomUUID(),
        new Geometry.Point(Position.of(lon, 60.25)), new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null), null, null,
        SecurityLabel.of("NATO", "UNCLASSIFIED"), Extensions.empty()));
  }

  private static void waitUntil(BooleanSupplier condition) throws InterruptedException {
    long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (!condition.getAsBoolean()) {
      assertThat(System.nanoTime()).as("within 10 s").isLessThan(end);
      Thread.sleep(5);
    }
  }

  private ChannelRegistry.Stats stats(String link) {
    return registry.stats("cot").stream().filter(s -> s.info().id().link().equals(link)).findFirst().orElseThrow();
  }

  @Test
  void aChannelsStateReachesItsWatchersOncePerChangeAndStartsReady() throws Exception { // SDK 1.9.0, CR-0050 point 2
    sim.watch(worker("simulator"), list -> new Listed(list, registry.lockHeldByCurrentThread()));
    next();
    WorkerRef<Message> link = worker("cot");
    ChannelRef north = offer(link, "tak-north");
    assertThat(((Listed) next()).list().channels()).singleElement()
        .satisfies(c -> assertThat(List.of(c.state(), c.stateDetail())).containsExactly(dev.emcc.sdk.channel.ChannelState.READY, ""));

    north.state(dev.emcc.sdk.channel.ChannelState.NOT_SENDING, "No destination");
    assertThat(((Listed) next()).list().channels()).singleElement()
        .satisfies(c -> assertThat(List.of(c.state(), c.stateDetail())).containsExactly(dev.emcc.sdk.channel.ChannelState.NOT_SENDING, "No destination"));
    north.state(dev.emcc.sdk.channel.ChannelState.NOT_SENDING, "No destination");
    assertThat(got.poll(200, TimeUnit.MILLISECONDS)).as("the same state again changes nothing").isNull();
    assertThat(stats("tak-north").info().stateDetail()).isEqualTo("No destination");

    assertThatThrownBy(() -> north.state(dev.emcc.sdk.channel.ChannelState.DEGRADED, "x".repeat(129))).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> north.state(dev.emcc.sdk.channel.ChannelState.DEGRADED, "late\nframes")).isInstanceOf(IllegalArgumentException.class);
    assertThat(got.poll(200, TimeUnit.MILLISECONDS)).as("a refused detail changes nothing").isNull();

    north.withdraw();
    next();
    north.state(dev.emcc.sdk.channel.ChannelState.DEGRADED, "after");
    assertThat(got.poll(200, TimeUnit.MILLISECONDS)).as("nothing once withdrawn").isNull();
    offer(link, "tak-north");
    assertThat(((Listed) next()).list().channels()).singleElement()
        .satisfies(c -> assertThat(c.state()).as("a channel offered again starts READY").isEqualTo(dev.emcc.sdk.channel.ChannelState.READY));
  }

  @Test
  void watchersGetTheListThenEachChangeAndAPluginOffersEachLinkOnceWithinItsCap() throws Exception {
    sim.watch(worker("simulator"), list -> new Listed(list, registry.lockHeldByCurrentThread()));
    assertThat(((Listed) next()).list().channels()).isEmpty();

    WorkerRef<Message> link = worker("cot");
    ChannelRef north = offer(link, "tak-north");
    Listed listed = (Listed) next();
    assertThat(listed.underLock()).as("the mapper runs outside the registry's lock (P3-2)").isFalse();
    assertThat(listed.list().channels()).singleElement().satisfies(c -> {
      assertThat(c.id()).isEqualTo(new ChannelId("cot", "tak-north"));
      assertThat(c.name()).isEqualTo("TAK tak-north");
      assertThat(c.canDelete()).isTrue();
    });
    assertThat(north.id()).isEqualTo(new ChannelId("cot", "tak-north"));
    assertThatThrownBy(() -> offer(link, "tak-north")).isInstanceOf(IllegalArgumentException.class);
    offer(link, "tak-south");
    assertThat(((Listed) next()).list().channels()).hasSize(2);
    assertThatThrownBy(() -> offer(link, "tak-east")).isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("emc2.channels.max-per-plugin");

    north.withdraw();
    north.withdraw(); // no effect
    assertThat(((Listed) next()).list().channels()).extracting(c -> c.id().link()).containsExactly("tak-south");
    offer(link, "tak-north"); // its link free again, within the cap again
    assertThat(((Listed) next()).list().channels()).hasSize(2);
    assertThat(got.poll(200, TimeUnit.MILLISECONDS)).as("one list per change").isNull();
  }

  @Test
  void anItemOfAKindTheChannelDoesNotTakeIsRefusedAndNothingIsSent() throws Exception {
    WorkerRef<Message> link = worker("cot");
    ChannelRef groundTruth = offer(link, "tak-north"); // ground truth only, by default
    ChannelRef sensor = cot.offer(ChannelSpec.of("gmti-out", "GMTI out", "stanag4607").kinds(Set.of(ChannelKind.SENSOR_REPORTS)), link,
        item -> new Got(item, false));
    ChannelItem.SensorReport report = new ChannelItem.SensorReport(UUID.randomUUID(), Position.of(15, 60.25), Instant.parse("2026-11-05T10:00:00Z"),
        new Geometry.Circle(Position.of(15.5, 60.5), 5_000), List.of());

    assertThatThrownBy(() -> sim.send(groundTruth.id(), report)).isInstanceOf(IllegalArgumentException.class)
        .hasMessage("the channel " + groundTruth.id() + " does not take SENSOR_REPORTS (it takes [GROUND_TRUTH])");
    assertThatThrownBy(() -> sim.send(sensor.id(), update(a, 1))).isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("does not take GROUND_TRUTH");
    assertThat(stats("tak-north").sent()).as("nothing sent").isZero();
    assertThat(stats("gmti-out").sent()).isZero();

    assertThat(sim.send(sensor.id(), report)).isEqualTo(SendResult.ACCEPTED);
    assertThat(nextItem()).isEqualTo(report);
  }

  @Test
  void itemsReachTheOfferingWorkerThroughItsMapperAndAPendingItemIsReplacedInItsPlace() throws Exception {
    WorkerRef<Message> link = worker("cot");
    ChannelRef ch = offer(link, "tak-north");
    CountDownLatch open = hold(link);

    assertThat(sim.send(ch.id(), update(a, 1))).isEqualTo(SendResult.ACCEPTED); // handed over (one in flight)
    sim.send(ch.id(), update(b, 1));
    sim.send(ch.id(), update(a, 2));
    sim.send(ch.id(), update(a, 3)); // replaces a=2
    sim.send(ch.id(), new ChannelItem.Removal(b)); // replaces b=1 in its place, before a
    assertThat(stats("tak-north").pending()).isEqualTo(2);
    assertThat(stats("tak-north").inFlight()).isEqualTo(1);
    open.countDown();

    assertThat(((ChannelItem.Update) nextItem()).content().geometry()).isEqualTo(new Geometry.Point(Position.of(1, 60.25)));
    assertThat(nextItem()).isEqualTo(new ChannelItem.Removal(b));
    assertThat(((ChannelItem.Update) nextItem()).content().geometry()).isEqualTo(new Geometry.Point(Position.of(3, 60.25)));
    waitUntil(() -> stats("tak-north").delivered() == 3);
    ChannelRegistry.Stats s = stats("tak-north");
    assertThat(List.of(s.sent(), s.replaced(), s.delivered(), s.dropped())).containsExactly(5L, 2L, 3L, 0L);
    assertThat(s.pending()).isZero();
    assertThat(s.inFlight()).isZero();
  }

  @Test
  void aGroundRadarsDwellsWaitSideBySideAndOnlyTheSameDwellIsReplaced() throws Exception {
    // SDK 1.5.0 part 3 (CR-0040 point 2): the inbox keys by coalesceKey(), the sensor and dwell number
    WorkerRef<Message> link = worker("cot");
    ChannelRef ch = cot.offer(ChannelSpec.of("gmti-out", "GMTI out", "stanag4607").kinds(Set.of(ChannelKind.SENSOR_REPORTS)), link,
        item -> new Got(item, false));
    CountDownLatch open = hold(link);
    UUID sensor = UUID.randomUUID();
    ChannelItem.SensorReport report = new ChannelItem.SensorReport(sensor, Position.of(15, 60.25), Instant.parse("2026-11-10T10:00:00Z"),
        new Geometry.Circle(Position.of(15.5, 60.5), 5_000), List.of());
    ChannelItem.SensorReport plain = report.withSequence(null);
    ChannelItem.SensorReport dwell0 = report.withSequence(new ChannelItem.SensorReport.Sequence(0, 0, false));
    ChannelItem.SensorReport dwell1 = report.withSequence(new ChannelItem.SensorReport.Sequence(0, 1, true));
    ChannelItem.SensorReport dwell0Again = report.withSequence(new ChannelItem.SensorReport.Sequence(1, 0, false));

    sim.send(ch.id(), plain); // handed over (one in flight)
    sim.send(ch.id(), dwell0);
    sim.send(ch.id(), dwell1);
    sim.send(ch.id(), dwell0Again); // the same sensor and dwell: replaces dwell0 in its place
    assertThat(stats("gmti-out").pending()).as("two dwells of one sensor").isEqualTo(2);
    open.countDown();

    assertThat(nextItem()).isEqualTo(plain);
    assertThat(nextItem()).isEqualTo(dwell0Again);
    assertThat(nextItem()).isEqualTo(dwell1);
    waitUntil(() -> stats("gmti-out").delivered() == 3);
    assertThat(stats("gmti-out").replaced()).isEqualTo(1);
  }

  @Test
  void overTheInboxsSizeTheOldestPendingObjectGoesAndIsCounted() throws Exception {
    WorkerRef<Message> link = worker("cot");
    ChannelRef ch = offer(link, "tak-north");
    CountDownLatch open = hold(link);
    List<UUID> ids = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      ids.add(UUID.randomUUID());
      sim.send(ch.id(), new ChannelItem.Removal(ids.get(i)));
    }
    sim.send(ch.id(), new ChannelItem.Removal(ids.get(4))); // a replacement does not make room

    assertThat(stats("tak-north").dropped()).isEqualTo(1);
    open.countDown();

    // 0 was in flight; 1 went for 4 (the inbox holds 3 here).
    assertThat(List.of(nextItem(), nextItem(), nextItem(), nextItem()))
        .extracting(ChannelItem::id).containsExactly(ids.get(0), ids.get(2), ids.get(3), ids.get(4));
  }

  @Test
  void aWithdrawnOrUnknownChannelIsClosedAndItsPendingItemsAreDropped() throws Exception {
    WorkerRef<Message> link = worker("cot");
    ChannelRef ch = offer(link, "tak-north");
    assertThat(sim.send(new ChannelId("cot", "tak-west"), update(a, 1))).isEqualTo(SendResult.CLOSED);
    CountDownLatch open = hold(link);
    sim.send(ch.id(), update(a, 1)); // handed over
    sim.send(ch.id(), update(b, 1)); // pending

    ch.withdraw();
    assertThat(sim.send(ch.id(), update(b, 2))).isEqualTo(SendResult.CLOSED);
    open.countDown();

    assertThat(nextItem().id()).as("handed over before the withdraw").isEqualTo(a);
    assertThat(got.poll(300, TimeUnit.MILLISECONDS)).as("the pending one is dropped").isNull();
    assertThat(registry.stats("cot")).isEmpty();
  }

  @Test
  void aStoppedWorkersItemsAreCountedAsDroppedAndNothingWaitsForThem() throws Exception {
    WorkerRef<Message> link = worker("cot");
    ChannelRef ch = offer(link, "tak-north");
    CountDownLatch open = hold(link);
    sim.send(ch.id(), update(a, 1)); // in its mailbox

    Thread.ofVirtual().start(() -> {
      try {
        Thread.sleep(200);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
      open.countDown(); // lets the running call end; the stop waits for it
    });
    runtime.owner("cot").stop(); // discards the mailbox first
    sim.send(ch.id(), update(b, 1)); // cannot be handed over

    waitUntil(() -> stats("tak-north").dropped() == 2);
    assertThat(stats("tak-north").inFlight()).isZero();
  }

  @Test
  void releasingAPluginWithdrawsItsChannelsAndCancelsItsWatches() throws Exception {
    sim.watch(worker("simulator"), list -> new Listed(list, false));
    next();
    offer(worker("cot"), "tak-north");
    assertThat(((Listed) next()).list().channels()).hasSize(1);

    cot.release();

    assertThat(((Listed) next()).list().channels()).isEmpty();
    assertThat(sim.send(new ChannelId("cot", "tak-north"), update(a, 1))).isEqualTo(SendResult.CLOSED);
    sim.release();
    PluginChannels cotAgain = new PluginChannels("cot", registry, 2); // the plugin's next run
    cotAgain.offer(ChannelSpec.of("tak-south", "TAK South", "cot"), worker("cot"), item -> new Got(item, false));
    assertThat(got.poll(300, TimeUnit.MILLISECONDS)).as("its watch is cancelled").isNull();
    assertThat(registry.list().channels()).hasSize(1);
  }

  @Test
  void aStoppedPluginCanNeitherOfferNorWatchAnyMoreAlsoFromAHandlerThatStillRuns() {
    WorkerRef<Message> link = worker("cot");
    cot.release();

    assertThatThrownBy(() -> offer(link, "tak-north")).isInstanceOf(IllegalStateException.class).hasMessage("plugin cot has stopped");
    assertThatThrownBy(() -> cot.watch(link, list -> new Listed(list, false))).isInstanceOf(IllegalStateException.class);
    assertThat(registry.list().channels()).as("nothing left behind").isEmpty();
  }

  @Test
  void aMapperThatThrowsLosesOnlyItsItemAndTheNextOnesStillGo() throws Exception {
    WorkerRef<Message> link = worker("cot");
    ChannelRef ch = cot.offer(ChannelSpec.of("tak-north", "TAK North", "cot"), link, item -> {
      if (item.id().equals(a)) {
        throw new IllegalStateException("cannot map " + item.id());
      }
      return new Got(item, false);
    });

    sim.send(ch.id(), new ChannelItem.Removal(a));
    sim.send(ch.id(), new ChannelItem.Removal(b));

    assertThat(nextItem().id()).isEqualTo(b);
    waitUntil(() -> stats("tak-north").delivered() == 2);
    assertThat(stats("tak-north").inFlight()).isZero();
  }

  @Test
  void aHandOverThatThrowsDoesNotStallTheChannel() throws Exception {
    java.util.concurrent.atomic.AtomicBoolean fail = new java.util.concurrent.atomic.AtomicBoolean(true);
    ChannelRegistry hooked = new ChannelRegistry(runtime, 10, 2, () -> {
      if (fail.getAndSet(false)) {
        throw new IllegalStateException("hand-over fails once");
      }
    });
    PluginChannels output = new PluginChannels("cot", hooked, 2);
    PluginChannels sender = new PluginChannels("simulator", hooked, 2);
    ChannelRef ch = output.offer(ChannelSpec.of("tak-north", "TAK North", "cot"), worker("cot"), item -> new Got(item, false));

    assertThatThrownBy(() -> sender.send(ch.id(), new ChannelItem.Removal(a))).hasMessage("hand-over fails once");
    sender.send(ch.id(), new ChannelItem.Removal(b));

    assertThat(nextItem().id()).isEqualTo(b);
    waitUntil(() -> hooked.stats("cot").getFirst().inFlight() == 0);
    assertThat(hooked.stats("cot").getFirst().dropped()).as("the item it could not hand over").isEqualTo(1);
  }

  /**
   * A second sender's item of the same object, put while the first sender is between taking its item
   * and handing it over, reaches the worker after it: one thread at a time hands a channel's items
   * over (the review's F1: a removal must not be overtaken by a stale update).
   */
  @Test
  void anItemPutWhileAnotherIsBeingHandedOverArrivesAfterIt() throws Exception {
    java.util.concurrent.atomic.AtomicReference<Runnable> during = new java.util.concurrent.atomic.AtomicReference<>();
    ChannelRegistry hooked = new ChannelRegistry(runtime, 10, 2, () -> {
      Runnable r = during.getAndSet(null);
      if (r != null) {
        r.run();
      }
    });
    PluginChannels output = new PluginChannels("cot", hooked, 2);
    PluginChannels first = new PluginChannels("simulator", hooked, 2);
    PluginChannels second = new PluginChannels("tracker", hooked, 2);
    ChannelRef ch = output.offer(ChannelSpec.of("tak-north", "TAK North", "cot").can(ChannelCapability.DELETE), worker("cot"),
        item -> new Got(item, false));
    during.set(() -> { // in the first sender, after it took the update and before it hands it over
      Thread other = Thread.ofVirtual().start(() -> second.send(ch.id(), new ChannelItem.Removal(a)));
      try {
        assertThat(other.join(java.time.Duration.ofSeconds(10))).isTrue();
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    });

    first.send(ch.id(), update(a, 1));

    assertThat(nextItem()).isInstanceOf(ChannelItem.Update.class);
    assertThat(nextItem()).as("the removal last").isEqualTo(new ChannelItem.Removal(a));
  }
}
