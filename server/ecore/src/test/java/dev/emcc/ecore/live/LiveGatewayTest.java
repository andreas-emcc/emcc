package dev.emcc.ecore.live;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.runtime.HandlerContext;
import dev.emcc.ecore.runtime.ManualTime;
import dev.emcc.ecore.runtime.MessageHandler;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.ecore.store.DataTypes;
import dev.emcc.ecore.store.ObjectStore;
import dev.emcc.ecore.store.PictureState;
import dev.emcc.ecore.store.Requester;
import dev.emcc.ecore.store.StoreMsg;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/** The live picture gateway with a real object store, manual time and recording sinks. */
class LiveGatewayTest {

  private static final ModelJson JSON = new ModelJson();
  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final Actor DRAW = Actor.plugin("draw-symbols");
  private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-07T12:00:00Z"), ZoneOffset.UTC);
  /** The session user where the test is not about permissions: the no-login mode's, with every one. */
  private static final Requester.User LOCAL = Requester.withAllPermissions("local");

  private final ManualTime time = new ManualTime();
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time));
  private final WorkerHandle<StoreMsg> store = runtime.owner("core-store").spawn(
      WorkerOptions.<StoreMsg>of("object-store", () -> new ObjectStore(new PictureState(), runtime, CLOCK, new DataTypes())));
  private final LiveGateway gateway = gateway(10, LiveGateway.INBOUND_BUDGET);
  private final UUID layerId = UUID.randomUUID();

  private LiveGateway gateway(int maxSessions, long inboundBudget) {
    return new LiveGateway(runtime, store, JSON, CLOCK, limits(maxSessions, inboundBudget));
  }

  /** A gateway with other limits, on a runtime of its own (one gateway per runtime). */
  private LiveGateway otherGateway(int maxSessions, long inboundBudget) {
    return otherGateway(maxSessions, inboundBudget, null);
  }

  private LiveGateway otherGateway(int maxSessions, long inboundBudget, @Nullable MessageHandler<StoreMsg> fakeStore) {
    WorkerRuntime other = WorkerRuntime.start(RuntimeConfig.defaults().time(time));
    others.add(other);
    WorkerHandle<StoreMsg> otherStore = other.owner("core-store").spawn(WorkerOptions.<StoreMsg>of("object-store",
        () -> fakeStore != null ? fakeStore : new ObjectStore(new PictureState(), other, CLOCK, new DataTypes())));
    return new LiveGateway(other, otherStore, JSON, CLOCK, limits(maxSessions, inboundBudget));
  }

  /** Two objects or events per message, so a few make several parts. */
  private static LiveGateway.Limits limits(int maxSessions, long inboundBudget) {
    return new LiveGateway.Limits(LiveGateway.BATCH_INTERVAL, 2, maxSessions, inboundBudget, WorkerOptions.MAX_BUDGET,
        LiveGateway.DEFAULT_MAX_BUDGET, LiveGateway.MAX_HELD);
  }

  private final List<WorkerRuntime> others = new java.util.ArrayList<>();

  /**
   * Moves the manual clock once every worker of this test is idle, before each due task: a call that
   * is still finishing must not look hung (the cause of this test class's load-sensitive failures).
   * Plain {@code time.advance} is kept where a test makes a call hang on purpose.
   */
  private void advance(Duration by) {
    List<WorkerRuntime> all = new java.util.ArrayList<>(others);
    all.add(runtime);
    time.advanceSettled(by, all.toArray(WorkerRuntime[]::new));
  }

  @AfterEach
  void close() {
    others.forEach(WorkerRuntime::close);
    runtime.close();
  }

  /** A browser: what the server sent, as JSON. */
  static class Browser implements LiveSink {
    final Probe<JsonNode> received = new Probe<>();
    final Probe<String> closed = new Probe<>();
    final Probe<String> pings = new Probe<>();

    @Override
    public void ping() {
      pings.add("ping");
    }

    @Override
    public void send(String text) throws Exception {
      received.add(JSON.parse(text));
    }

    @Override
    public void close(int status, String reason) {
      closed.add(status + " " + reason);
    }

    JsonNode next(String type) {
      JsonNode message = received.next();
      assertThat(message.get("type").asString()).as("message " + message).isEqualTo(type);
      return message;
    }
  }

  private LiveGateway.LiveSession open(Browser browser) {
    return open(browser, null);
  }

  private LiveGateway.LiveSession open(Browser browser, @Nullable String user) {
    LiveGateway.LiveSession session = gateway.open(user == null ? LOCAL : Requester.withAllPermissions(user), browser);
    assertThat(browser.next("welcome").get("protocol").asInt()).isEqualTo(LiveGateway.PROTOCOL);
    return session;
  }

  /** The whole picture, as subscription "all". */
  private static final String SUBSCRIBE = "{\"type\":\"subscribe\",\"subscription\":\"all\"}";
  private static final String UNSUBSCRIBE = "{\"type\":\"unsubscribe\",\"subscription\":\"all\"}";

  private static String subscribe(String id, String options) {
    return "{\"type\":\"subscribe\",\"subscription\":\"" + id + "\"" + options + "}";
  }

  /** A square area around (lon, lat), as the protocol carries it. */
  private static String area(double lon, double lat, double half) {
    return String.format(java.util.Locale.ROOT, "{\"ring\":[[%s,%s],[%s,%s],[%s,%s],[%s,%s],[%s,%s]],\"inside\":[%s,%s]}",
        lon - half, lat - half, lon + half, lat - half, lon + half, lat + half, lon - half, lat + half, lon - half, lat - half, lon, lat);
  }

  private static String changeRequest(ChangeRequest request) {
    return "{\"type\":\"change-request\",\"request\":" + JSON.write(request) + "}";
  }

  private ChangeRequest createLayer() {
    return ChangeRequest.create(UUID.randomUUID(), layerId, new LayerContent("Own", 0, true, LABEL, Extensions.empty()), DRAW);
  }

  private ChangeRequest createSymbol(double lon, double lat) {
    MapObjectContent content = new MapObjectContent(MapObjectContent.SYMBOL, MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, layerId, new Geometry.Point(Position.of(lon, lat)),
        new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null), null, null, LABEL, Extensions.empty());
    return ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), content, DRAW);
  }

  /** Applies a change through a session and returns its change-outcome. */
  private static JsonNode submit(LiveGateway.LiveSession session, Browser browser, ChangeRequest request) {
    session.receive(changeRequest(request));
    JsonNode outcome = browser.next("change-outcome");
    assertThat(outcome.get("requestId").asString()).isEqualTo(request.requestId().toString());
    return outcome;
  }

  @Test
  void afterWelcomeEveryBrowserGetsTheNoticesAndBroadcastsReachEveryOpenOne() {
    gateway.atWelcome(() -> List.of("{\"type\":\"data-types\",\"dataTypes\":[]}"));
    Browser first = new Browser();
    open(first);
    assertThat(first.next("data-types").get("dataTypes")).isEmpty();
    Browser second = new Browser();
    open(second);
    second.next("data-types");

    gateway.broadcast(() -> "{\"type\":\"settings\",\"plugin\":\"cot\",\"values\":{\"mode\":\"x\"}}");

    assertThat(first.next("settings").get("plugin").asString()).isEqualTo("cot");
    assertThat(second.next("settings").get("values").get("mode").asString()).isEqualTo("x");
  }

  @Test
  void theNoticesAndBroadcastsCarryTheValueCurrentWhenTheHubSendsThem() {
    AtomicReference<String> mode = new AtomicReference<>("a");
    Supplier<String> settings = () -> "{\"type\":\"settings\",\"plugin\":\"cot\",\"values\":{\"mode\":\"" + mode.get() + "\"}}";
    gateway.atWelcome(() -> List.of(settings.get()));
    Browser browser = new Browser();
    open(browser);
    assertThat(browser.next("settings").get("values").get("mode").asString()).isEqualTo("a");

    // The hub is held up by a first broadcast; a change made after the second broadcast call still
    // reaches the browser, because the message is made when the hub sends it.
    CountDownLatch release = new CountDownLatch(1);
    gateway.broadcast(() -> {
      try {
        assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
      return settings.get();
    });
    mode.set("b");
    gateway.broadcast(settings);
    mode.set("c");
    release.countDown();

    assertThat(browser.next("settings").get("values").get("mode").asString()).isEqualTo("c");
    assertThat(browser.next("settings").get("values").get("mode").asString()).isEqualTo("c");
  }

  @Test
  void aSubscriberGetsTheSnapshotInPartsThenBatchesOfChanges() {
    Browser editor = new Browser();
    LiveGateway.LiveSession editing = open(editor);
    submit(editing, editor, createLayer());
    for (int i = 0; i < 3; i++) {
      submit(editing, editor, createSymbol(10 + i, 55));
    }

    Browser viewer = new Browser();
    open(viewer).receive(SUBSCRIBE);

    JsonNode begin = viewer.next("snapshot-begin");
    assertThat(begin.get("sequenceNo").asLong()).isEqualTo(4);
    assertThat(begin.get("objectCount").asInt()).isEqualTo(3);
    assertThat(begin.get("layers")).hasSize(1);
    assertThat(viewer.next("snapshot-objects").get("objects")).hasSize(2);
    assertThat(viewer.next("snapshot-objects").get("objects")).hasSize(1);
    assertThat(viewer.next("snapshot-end").get("sequenceNo").asLong()).isEqualTo(4);

    submit(editing, editor, createSymbol(20, 60));
    submit(editing, editor, createSymbol(21, 61));
    submit(editing, editor, createSymbol(22, 62));
    advance(LiveGateway.BATCH_INTERVAL);

    List<Long> sequenceNumbers = new java.util.ArrayList<>();
    viewer.next("changes").get("events").forEach(e -> sequenceNumbers.add(e.get("sequenceNo").asLong()));
    viewer.next("changes").get("events").forEach(e -> sequenceNumbers.add(e.get("sequenceNo").asLong()));
    assertThat(sequenceNumbers).containsExactly(5L, 6L, 7L);
    assertThat(viewer.received.drain()).isEmpty();
  }

  @Test
  void everyChangeRequestGetsOneOutcome() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser);

    assertThat(submit(session, browser, createLayer()).get("outcome").asString()).isEqualTo("applied");
    JsonNode applied = submit(session, browser, createSymbol(15.5, 59.2));
    assertThat(applied.get("event").get("sequenceNo").asLong()).isEqualTo(2);

    ChangeRequest unknown = ChangeRequest.delete(UUID.randomUUID(), EntityType.OBJECT, UUID.randomUUID(), 1L, DRAW);
    JsonNode rejected = submit(session, browser, unknown);
    assertThat(rejected.get("outcome").asString()).isEqualTo("rejected");
    assertThat(rejected.get("rejection").get("code").asString()).isEqualTo("ENTITY_NOT_FOUND");
  }

  @Test
  void aRequestTheSchemaRefusesIsRejectedIfItCanBeAddressed() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser);
    UUID requestId = UUID.randomUUID();

    session.receive("""
        {"type": "change-request", "request": {"requestId": "%s", "entityType": "object", "operation": "create",
         "entityId": "%s", "data": {"type": "core.symbol"}, "source": {"plugin": "draw-symbols"}}}
        """.formatted(requestId, UUID.randomUUID()));

    JsonNode outcome = browser.next("change-outcome");
    assertThat(outcome.get("requestId").asString()).isEqualTo(requestId.toString());
    assertThat(outcome.get("rejection").get("code").asString()).isEqualTo("VALIDATION_FAILED");
    assertThat(outcome.get("rejection").get("details")).isNotEmpty();
  }

  @Test
  void unreadableMessagesGetAnError() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser);

    session.receive("not json");
    session.receive("{\"type\":\"dance\"}");
    session.receive("{\"type\":\"change-request\",\"request\":{\"requestId\":\"" + UUID.randomUUID() + "\"}}");

    assertThat(browser.next("error").get("message").asString()).isEqualTo("not valid JSON");
    assertThat(browser.next("error").get("message").asString()).contains("unknown message type");
    JsonNode error = browser.next("error");
    assertThat(error.has("requestId")).isTrue();
    assertThat(error.get("message").asString()).startsWith("the change request is not valid");
  }

  @Test
  void theServerSetsTheUserNotTheBrowser() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser, "alice");
    ChangeRequest layer = createLayer();
    ChangeRequest claimed = new ChangeRequest(layer.requestId(), layer.entityType(), layer.operation(), layer.entityId(),
        null, layer.data(), null, new Actor("layer-panel", "mallory", null));

    JsonNode event = submit(session, browser, claimed).get("event");

    assertThat(event.get("by").get("user").asString()).isEqualTo("alice");
    assertThat(event.get("by").get("plugin").asString()).isEqualTo("layer-panel");
  }

  @Test
  void aBrowserCannotClaimAnExternalSystemOrEcoresOwnPluginIds() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser);
    ChangeRequest layer = createLayer();
    ChangeRequest asSystem = new ChangeRequest(layer.requestId(), layer.entityType(), layer.operation(), layer.entityId(),
        null, layer.data(), null, new Actor("layer-panel", null, "tak:server-1"));

    JsonNode applied = submit(session, browser, asSystem);
    assertThat(applied.get("outcome").asString()).isEqualTo("applied");
    assertThat(applied.get("event").get("by").has("system")).isFalse();

    for (String reserved : List.of("core", "core-store", "core-shells")) {
      ChangeRequest symbol = createSymbol(1, 2);
      ChangeRequest asCore = new ChangeRequest(symbol.requestId(), symbol.entityType(), symbol.operation(),
          symbol.entityId(), null, symbol.data(), null, Actor.plugin(reserved));
      JsonNode rejected = submit(session, browser, asCore);
      assertThat(rejected.get("rejection").get("code").asString()).isEqualTo("VALIDATION_FAILED");
      assertThat(rejected.get("rejection").get("message").asString()).isEqualTo("source.plugin " + reserved + " is reserved for ECore");
    }
  }

  @Test
  void aGapOrAResyncBringsAFreshSnapshot() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser);
    submit(session, browser, createLayer());
    session.receive(SUBSCRIBE);
    browser.next("snapshot-begin");
    assertThat(browser.next("snapshot-end").get("sequenceNo").asLong()).isEqualTo(1);

    ChangeEvent later = ((dev.emcc.ecore.store.ChangeOutcome.Applied) apply(createSymbol(1, 2))).event();
    ChangeEvent third = ((dev.emcc.ecore.store.ChangeOutcome.Applied) apply(createSymbol(3, 4))).event();
    session.handle().send(new LiveMsg.Session.Batch(List.of(dev.emcc.ecore.store.StoreChange.of(third)))); // event 2 never arrived
    handled(session, browser);
    advance(SessionWorker.MIN_SNAPSHOT_INTERVAL); // at most one snapshot per interval
    assertThat(browser.next("snapshot-begin").get("sequenceNo").asLong()).isEqualTo(3);
    browser.next("snapshot-objects");
    browser.next("snapshot-end");

    runtime.deliverAlways(session.handle(), () -> LiveMsg.Session.Resync.RESYNC);
    handled(session, browser);
    advance(SessionWorker.MIN_SNAPSHOT_INTERVAL);
    assertThat(browser.next("snapshot-begin").get("sequenceNo").asLong()).isEqualTo(3);
    assertThat(later.sequenceNo()).isEqualTo(2);
  }

  /** Waits until the session has handled everything sent to it so far (its answer to a marker). */
  private static void handled(LiveGateway.LiveSession session, Browser browser) {
    session.receive("{\"type\":\"marker\"}");
    assertThat(browser.next("error").get("message").asString()).contains("marker");
  }

  @Test
  void aSubscribeLoopTakesAtMostOneSnapshotPerInterval() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser);
    session.receive(SUBSCRIBE);
    browser.next("snapshot-begin");
    browser.next("snapshot-end");

    for (int i = 0; i < 50; i++) {
      session.receive(UNSUBSCRIBE);
      session.receive(SUBSCRIBE);
    }
    handled(session, browser); // no snapshot before the marker's answer

    advance(SessionWorker.MIN_SNAPSHOT_INTERVAL);
    browser.next("snapshot-begin");
    browser.next("snapshot-end");
    handled(session, browser); // and only one
  }

  @Test
  void tooManyChangeRequestsAreRejectedAtOnceAndTheOthersEndUnknown() {
    Browser browser = new Browser();
    LiveGateway silent = otherGateway(10, LiveGateway.INBOUND_BUDGET, (message, context) -> {}); // never answers
    LiveGateway.LiveSession session = silent.open(LOCAL, browser);
    browser.next("welcome");
    List<ChangeRequest> requests = new java.util.ArrayList<>();
    for (int i = 0; i < SessionWorker.MAX_OUTSTANDING + 5; i++) {
      requests.add(createSymbol(i % 90, 0));
      session.receive(changeRequest(requests.getLast()));
    }

    for (int i = SessionWorker.MAX_OUTSTANDING; i < requests.size(); i++) {
      JsonNode outcome = browser.next("change-outcome");
      assertThat(outcome.get("requestId").asString()).isEqualTo(requests.get(i).requestId().toString());
      assertThat(outcome.get("rejection").get("code").asString()).isEqualTo("INTERNAL_ERROR");
      assertThat(outcome.get("rejection").get("message").asString()).startsWith("too many change requests in progress");
    }
    advance(SessionWorker.STORE_TIMEOUT);
    for (int i = 0; i < SessionWorker.MAX_OUTSTANDING; i++) {
      JsonNode outcome = browser.next("change-outcome");
      assertThat(outcome.get("requestId").asString()).isEqualTo(requests.get(i).requestId().toString());
      assertThat(outcome.get("outcome").asString()).isEqualTo("unknown");
      assertThat(outcome.has("event") || outcome.has("rejection")).isFalse();
    }
    session.receive(changeRequest(createSymbol(1, 1))); // room again: this one waits for the store
    handled(session, browser);
  }

  /** Applies a change directly at the store, not through a session. */
  private dev.emcc.ecore.store.ChangeOutcome apply(ChangeRequest request) {
    Probe<dev.emcc.ecore.store.ChangeOutcome> outcome = new Probe<>();
    store.send(new StoreMsg.Apply(request, Requester.NO_USER, new dev.emcc.ecore.runtime.ReplyHandle<>() {
      @Override
      public String id() {
        return "test";
      }

      @Override
      public void reply(dev.emcc.ecore.store.ChangeOutcome value) {
        outcome.add(value);
      }

      @Override
      public void fail(String reason) {
        throw new AssertionError(reason);
      }
    }));
    return outcome.next();
  }

  @Test
  void anUnsubscribedSessionGetsNoChanges() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser);
    session.receive(SUBSCRIBE);
    browser.next("snapshot-begin");
    browser.next("snapshot-end");
    session.receive(UNSUBSCRIBE);

    submit(session, browser, createLayer());
    advance(LiveGateway.BATCH_INTERVAL);
    session.receive("{\"type\":\"dance\"}"); // a marker: everything before it has been handled

    assertThat(browser.next("error").get("message").asString()).contains("unknown message type");
  }

  @Test
  void aFailingSendClosesTheConnectionAndNothingMoreIsSent() {
    Probe<String> sent = new Probe<>();
    Browser broken = new Browser() {
      @Override
      public void send(String text) throws Exception {
        sent.add(text);
        throw new java.io.IOException("connection reset");
      }
    };
    LiveGateway.LiveSession session = gateway.open(LOCAL, broken);
    assertThat(sent.next()).contains("welcome");
    assertThat(broken.closed.next()).isEqualTo("1011 sending failed");

    session.receive(SUBSCRIBE);
    session.receive("{\"type\":\"dance\"}");
    session.close();
    assertThat(sent.drain()).isEmpty();
  }

  @Test
  void aBrowserThatDoesNotKeepUpIsDisconnected() {
    Browser editor = new Browser();
    LiveGateway.LiveSession editing = open(editor);
    ChangeEvent layerCreated = ((dev.emcc.ecore.store.ChangeOutcome.Applied) apply(createLayer())).event();

    CountDownLatch release = new CountDownLatch(1);
    Browser slow = new Browser() {
      @Override
      public void send(String text) throws Exception {
        release.await(Probe.HOLD.toMillis(), TimeUnit.MILLISECONDS);
        super.send(text);
      }
    };
    LiveGateway.LiveSession session = gateway.open(LOCAL, slow);
    session.receive(SUBSCRIBE); // the store holds only the layer: its snapshot is at 1, whenever it is taken

    // One batch of far more messages than the writer holds (2 events per message), straight to the
    // session: it continues the snapshot whether it comes before or after it.
    Layer layer = (Layer) java.util.Objects.requireNonNull(layerCreated.state());
    List<dev.emcc.ecore.store.StoreChange> changes = new java.util.ArrayList<>();
    for (long v = 2; v <= LiveGateway.WRITER_CAPACITY * 4L; v++) {
      Layer renamed = new Layer(layer.id(), v, layer.content(), layer.meta());
      changes.add(dev.emcc.ecore.store.StoreChange.of(new ChangeEvent(v, UUID.randomUUID(), EntityType.LAYER, dev.emcc.sdk.model.Operation.UPDATE,
          layer.id(), v, v - 1, v - 1, renamed, LABEL, Instant.EPOCH, DRAW)));
    }
    session.handle().send(new LiveMsg.Session.Batch(changes));
    awaitDropped(session.name() + "-writer"); // the writer's mailbox is full while the browser does not read

    release.countDown();
    assertThat(slow.closed.next()).isEqualTo("1013 the browser does not keep up");
    editing.close();
  }

  @Test
  void aLargeSnapshotGoesOutPartByPartAndArrivesComplete() {
    Browser editor = new Browser();
    LiveGateway.LiveSession editing = open(editor);
    submit(editing, editor, createLayer());
    int objects = LiveGateway.WRITER_CAPACITY * 2 + 11; // more parts than the writer holds
    for (int i = 0; i < objects; i++) {
      submit(editing, editor, createSymbol(i % 180, 0));
    }
    submit(editing, editor, createSymbol(1, 1)); // and one more while nobody watches

    Browser viewer = new Browser();
    open(viewer).receive(SUBSCRIBE);

    assertThat(viewer.next("snapshot-begin").get("objectCount").asInt()).isEqualTo(objects + 1);
    int received = 0;
    JsonNode message;
    while ((message = viewer.received.next()).get("type").asString().equals("snapshot-objects")) {
      received += message.get("objects").size();
    }
    assertThat(message.get("type").asString()).isEqualTo("snapshot-end");
    assertThat(received).isEqualTo(objects + 1);
  }

  /** Waits, at most {@link Probe#WAIT}, until a worker's mailbox has refused a message. */
  private void awaitDropped(String worker) {
    long deadline = System.nanoTime() + Probe.WAIT.toNanos();
    while (runtime.stats().stream().noneMatch(s -> s.worker().name().equals(worker) && s.dropped() > 0)) {
      assertThat(System.nanoTime()).as("a full mailbox of " + worker).isLessThan(deadline);
      java.util.concurrent.locks.LockSupport.parkNanos(1_000_000);
    }
  }

  @Test
  void closingASessionStopsItsWorkers() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser);
    assertThat(gateway.openSessions()).isEqualTo(1);

    session.close();
    session.close();

    assertThat(gateway.openSessions()).isZero();
    assertThat(runtime.owner(LiveGateway.OWNER).workers()).extracting(WorkerHandle::name)
        .as("the gateway's own workers stay, the session's are gone").contains("hub", "area-fill-0")
        .allMatch(name -> name.equals("hub") || name.startsWith("area-fill-"));
    session.receive(SUBSCRIBE); // ignored
    assertThat(browser.received.drain()).isEmpty();
  }

  @Test
  void theNumberOfSessionsIsLimited() {
    LiveGateway small = otherGateway(2, LiveGateway.INBOUND_BUDGET);
    LiveGateway.LiveSession first = small.open(LOCAL, new Browser());
    small.open(LOCAL, new Browser());

    assertThatThrownBy(() -> small.open(LOCAL, new Browser())).isInstanceOf(LiveGateway.TooManySessions.class);
    assertThat(small.openSessions()).isEqualTo(2);

    first.close();
    small.open(LOCAL, new Browser()); // room again
    assertThat(small.openSessions()).isEqualTo(2);
  }

  @Test
  void aBrowserWhoseWaitingMessagesExceedTheBudgetIsDisconnected() {
    LiveGateway tight = otherGateway(10, 100);
    Browser browser = new Browser();
    LiveGateway.LiveSession session = tight.open(LOCAL, browser);
    browser.next("welcome");

    for (int i = 0; i < 20; i++) { // each one handled before the next: nothing piles up
      session.receive("{\"type\":\"dance\",\"pad\":\"" + "x".repeat(50) + "\"}");
      browser.next("error");
    }
    assertThat(browser.closed.drain()).isEmpty();

    session.receive("{\"type\":\"dance\",\"pad\":\"" + "x".repeat(120) + "\"}"); // alone above the budget
    assertThat(browser.closed.next()).isEqualTo("1008 the browser sends faster than it is served");
  }

  @Test
  void everyBrowserIsPingedSoThatAnIdleTimeoutOnlyEndsDeadConnections() {
    Browser first = new Browser();
    Browser second = new Browser();
    open(first);
    open(second);

    advance(LiveGateway.KEEPALIVE_INTERVAL.plus(LiveGateway.BATCH_INTERVAL));

    assertThat(first.pings.next()).isEqualTo("ping");
    assertThat(second.pings.next()).isEqualTo("ping");
  }

  @Test
  void aSessionWhoseWriterHangsIsClosed() {
    WorkerRuntime other = WorkerRuntime.start(RuntimeConfig.defaults().time(time));
    others.add(other);
    WorkerHandle<StoreMsg> otherStore = other.owner("core-store").spawn(
        WorkerOptions.<StoreMsg>of("object-store", () -> new ObjectStore(new PictureState(), other, CLOCK, new DataTypes())));
    LiveGateway shortBudget = new LiveGateway(other, otherStore, JSON, CLOCK,
        new LiveGateway.Limits(LiveGateway.BATCH_INTERVAL, 2, 10, LiveGateway.INBOUND_BUDGET, Duration.ofSeconds(1),
            LiveGateway.DEFAULT_MAX_BUDGET, LiveGateway.MAX_HELD));
    CountDownLatch release = new CountDownLatch(1);
    Probe<String> stuck = new Probe<>();
    Browser hanging = new Browser() {
      @Override
      public void send(String text) throws Exception {
        stuck.add("sending");
        release.await(Probe.HOLD.toMillis(), TimeUnit.MILLISECONDS); // a socket write that never returns
      }
    };
    shortBudget.open(LOCAL, hanging);
    assertThat(stuck.next()).isEqualTo("sending");

    time.advance(Duration.ofMillis(1_200)); // the writer's call is over its budget: HUNG
    advance(LiveGateway.HEALTH_INTERVAL); // the hub's next health check

    // 1011 is the protocol's promise. Two closes race for the reason: the gateway's "server error",
    // and the writer's "sending failed" when ending the session interrupts its stuck send.
    assertThat(hanging.closed.next()).isIn("1011 server error", "1011 sending failed");
    await("the session ended", () -> shortBudget.openSessions() == 0);
    release.countDown();
  }

  /** Waits, at most {@link Probe#WAIT}, until {@code condition} holds. */
  private static void await(String what, java.util.function.BooleanSupplier condition) {
    long deadline = System.nanoTime() + Probe.WAIT.toNanos();
    while (!condition.getAsBoolean()) {
      assertThat(System.nanoTime()).as(what).isLessThan(deadline);
      java.util.concurrent.locks.LockSupport.parkNanos(1_000_000);
    }
  }

  @Test
  void aFloodingBrowserIsClosedOnceAndItsSessionEnds() {
    LiveGateway tight = otherGateway(10, 100);
    Browser browser = new Browser();
    LiveGateway.LiveSession session = tight.open(LOCAL, browser);
    browser.next("welcome");

    String large = "{\"type\":\"dance\",\"pad\":\"" + "x".repeat(120) + "\"}"; // each alone above the budget
    for (int i = 0; i < 50; i++) {
      session.receive(large);
    }

    assertThat(browser.closed.next()).isEqualTo("1008 the browser sends faster than it is served");
    await("the session ended", () -> tight.openSessions() == 0);
    assertThat(browser.closed.drain()).as("one close, not one per message").isEmpty();
  }

  @Test
  void aSessionEndsEvenIfClosingTheSocketFails() {
    LiveGateway tight = otherGateway(10, 100);
    Browser broken = new Browser() {
      @Override
      public void close(int status, String reason) {
        super.close(status, reason);
        throw new IllegalStateException("the socket is gone already");
      }
    };
    LiveGateway.LiveSession session = tight.open(LOCAL, broken);
    broken.next("welcome");

    session.receive("{\"type\":\"dance\",\"pad\":\"" + "x".repeat(120) + "\"}");

    assertThat(broken.closed.next()).startsWith("1008");
    await("the session ended although the edge never heard of it", () -> tight.openSessions() == 0);
  }

  @Test
  void aSocketThatBlocksWhileClosingDoesNotHoldUpTheOtherSessions() {
    WorkerRuntime other = WorkerRuntime.start(RuntimeConfig.defaults().time(time));
    others.add(other);
    WorkerHandle<StoreMsg> otherStore = other.owner("core-store").spawn(
        WorkerOptions.<StoreMsg>of("object-store", () -> new ObjectStore(new PictureState(), other, CLOCK, new DataTypes())));
    LiveGateway shortBudget = new LiveGateway(other, otherStore, JSON, CLOCK,
        new LiveGateway.Limits(LiveGateway.BATCH_INTERVAL, 2, 10, LiveGateway.INBOUND_BUDGET, Duration.ofSeconds(1),
            LiveGateway.DEFAULT_MAX_BUDGET, LiveGateway.MAX_HELD));
    CountDownLatch release = new CountDownLatch(1);
    Probe<String> stuck = new Probe<>();
    Browser blocking = new Browser() {
      @Override
      public void send(String text) throws Exception {
        stuck.add("sending");
        release.await(Probe.HOLD.toMillis(), TimeUnit.MILLISECONDS);
      }

      @Override
      public void close(int status, String reason) {
        stuck.add("closing " + status);
        try {
          release.await(Probe.HOLD.toMillis(), TimeUnit.MILLISECONDS); // a socket close that blocks too
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
        }
      }
    };
    shortBudget.open(LOCAL, blocking);
    assertThat(stuck.next()).isEqualTo("sending");
    time.advance(Duration.ofMillis(1_200)); // the writer is HUNG
    advance(LiveGateway.HEALTH_INTERVAL);
    assertThat(stuck.next()).isEqualTo("closing 1011"); // and that close blocks

    Browser healthy = new Browser(); // the hub still serves everyone else
    LiveGateway.LiveSession session = shortBudget.open(LOCAL, healthy);
    healthy.next("welcome");
    session.receive(SUBSCRIBE);
    healthy.next("snapshot-begin");
    healthy.next("snapshot-end");
    advance(LiveGateway.KEEPALIVE_INTERVAL.plus(LiveGateway.BATCH_INTERVAL));
    assertThat(healthy.pings.next()).isEqualTo("ping");
    // The dead session has ended although its socket's close still blocks (live-hardening R2).
    await("the dead session ended", () -> shortBudget.openSessions() == 1);

    release.countDown();
  }

  // ---- Protocol version 2: several subscriptions, areas, clusters --------------------------------

  /** The next message of {@code type} for {@code subscription}. */
  private static JsonNode next(Browser browser, String type, String subscription) {
    JsonNode message = browser.next(type);
    assertThat(message.get("subscription").asString()).as("message " + message).isEqualTo(subscription);
    return message;
  }

  /** The centre of the level-6 cube cell holding (lon, lat): points a few metres from it share the cell. */
  private static Position cellCentre(double lon, double lat) {
    dev.emcc.ecore.geo.CubeCells cells = new dev.emcc.ecore.geo.CubeCells(6);
    double[] v = dev.emcc.ecore.geo.Sphere.vec(lon, lat);
    dev.emcc.ecore.geo.Cap cap = cells.cap(cells.cell(v[0], v[1], v[2]));
    return Position.of(dev.emcc.ecore.geo.Sphere.lon(cap.x(), cap.y()), dev.emcc.ecore.geo.Sphere.lat(cap.x(), cap.y(), cap.z()));
  }

  @Test
  void oneConnectionCarriesSeveralSubscriptionsEachWithItsOwnStream() {
    Browser editor = new Browser();
    LiveGateway.LiveSession editing = open(editor);
    submit(editing, editor, createLayer());
    ChangeRequest stockholm = createSymbol(18.07, 59.33);
    submit(editing, editor, stockholm);
    submit(editing, editor, createSymbol(11.97, 57.71)); // Gothenburg

    Browser viewer = new Browser();
    LiveGateway.LiveSession session = open(viewer);
    session.receive(subscribe("layers", ",\"objects\":false"));
    JsonNode begin = next(viewer, "snapshot-begin", "layers");
    assertThat(begin.get("objectCount").asInt()).isZero();
    assertThat(begin.get("layers")).hasSize(1);
    assertThat(begin.get("objectCounts").get(layerId.toString()).asInt()).isEqualTo(2);
    assertThat(next(viewer, "snapshot-end", "layers").get("sequenceNo").asLong()).isEqualTo(3);
    session.receive(subscribe("map", ",\"area\":" + area(18, 59.3, 0.5) + ",\"resolution\":30"));
    assertThat(next(viewer, "snapshot-begin", "map").get("objectCount").asInt()).isEqualTo(1);
    assertThat(next(viewer, "snapshot-objects", "map").get("objects").get(0).get("id").asString())
        .isEqualTo(stockholm.entityId().toString());
    next(viewer, "snapshot-end", "map");
    JsonNode clusters = next(viewer, "clusters", "map");
    assertThat(clusters.get("full").asBoolean()).isTrue();
    assertThat(clusters.get("upsert")).isEmpty();

    ChangeRequest near = createSymbol(18.2, 59.4);
    submit(editing, editor, near);
    submit(editing, editor, createSymbol(0.5, 0.25)); // far away
    advance(LiveGateway.BATCH_INTERVAL);

    JsonNode layers = next(viewer, "changes", "layers");
    assertThat(layers.get("events")).as("no object events without objects").isEmpty();
    assertThat(layers.get("sequenceNo").asLong()).isEqualTo(5);
    assertThat(next(viewer, "counts", "layers").get("counts").get(layerId.toString()).asInt()).isEqualTo(4);
    JsonNode map = next(viewer, "changes", "map");
    assertThat(map.get("sequenceNo").asLong()).isEqualTo(5);
    assertThat(map.get("events")).singleElement()
        .satisfies(e -> assertThat(e.get("entityId").asString()).isEqualTo(near.entityId().toString()));
    handled(session, viewer); // nothing else
  }

  @Test
  void theCountsHoldEveryLayerAnEmptyOneWithZero() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser);
    submit(session, browser, createLayer());
    session.receive(subscribe("layers", ",\"objects\":false"));
    assertThat(next(browser, "snapshot-begin", "layers").get("objectCounts").get(layerId.toString()).asInt()).isZero();
    next(browser, "snapshot-end", "layers");

    ChangeRequest symbol = createSymbol(18.07, 59.33);
    submit(session, browser, symbol);
    UUID other = UUID.randomUUID();
    submit(session, browser, ChangeRequest.create(UUID.randomUUID(), other, new LayerContent("Other", 1, true, LABEL, Extensions.empty()), DRAW));
    submit(session, browser, ChangeRequest.delete(UUID.randomUUID(), EntityType.OBJECT, symbol.entityId(), null, DRAW));
    advance(LiveGateway.BATCH_INTERVAL);

    next(browser, "changes", "layers");
    JsonNode counts = next(browser, "counts", "layers").get("counts");
    assertThat(counts.get(layerId.toString()).asInt()).as("emptied again").isZero();
    assertThat(counts.get(other.toString()).asInt()).as("a new layer").isZero();
    submit(session, browser, ChangeRequest.delete(UUID.randomUUID(), EntityType.LAYER, other, null, DRAW));
    advance(LiveGateway.BATCH_INTERVAL);
    next(browser, "changes", "layers");
    assertThat(next(browser, "counts", "layers").get("counts").has(other.toString())).as("a deleted layer").isFalse();
  }

  @Test
  void aMoveSendsTheObjectsThatEnteredAndTheIdsThatLeft() {
    Browser editor = new Browser();
    LiveGateway.LiveSession editing = open(editor);
    submit(editing, editor, createLayer());
    ChangeRequest stockholm = createSymbol(18.07, 59.33);
    ChangeRequest gothenburg = createSymbol(11.97, 57.71);
    submit(editing, editor, stockholm);
    submit(editing, editor, gothenburg);
    Browser viewer = new Browser();
    LiveGateway.LiveSession session = open(viewer);
    session.receive(subscribe("map", ",\"area\":" + area(18, 59.3, 0.5) + ",\"resolution\":30"));
    next(viewer, "snapshot-begin", "map");
    next(viewer, "snapshot-objects", "map");
    next(viewer, "snapshot-end", "map");
    next(viewer, "clusters", "map");

    session.receive("{\"type\":\"area\",\"subscription\":\"map\",\"area\":" + area(12, 57.7, 0.5) + ",\"resolution\":30}");

    JsonNode moved = next(viewer, "area-objects", "map");
    assertThat(moved.get("sequenceNo").asLong()).isEqualTo(3);
    assertThat(moved.get("entered")).singleElement()
        .satisfies(o -> assertThat(o.get("id").asString()).isEqualTo(gothenburg.entityId().toString()));
    assertThat(moved.get("left")).singleElement()
        .satisfies(id -> assertThat(id.asString()).isEqualTo(stockholm.entityId().toString()));
    handled(session, viewer); // no snapshot, no clusters
  }

  @Test
  void aboveTheBudgetTheAreaComesAsClustersWithCounts() {
    Browser editor = new Browser();
    LiveGateway.LiveSession editing = open(editor);
    submit(editing, editor, createLayer());
    Position centre = cellCentre(18.0, 59.3);
    for (int i = 0; i < 5; i++) {
      submit(editing, editor, createSymbol(centre.longitude() + i * 0.0002, centre.latitude()));
    }
    Browser viewer = new Browser();
    LiveGateway.LiveSession session = open(viewer);
    // About 3 km per pixel: cells of about 190 km (level 6), so the five share one.
    session.receive(subscribe("map", ",\"area\":" + area(18, 59.3, 3) + ",\"resolution\":3000,\"budget\":2"));

    assertThat(next(viewer, "snapshot-begin", "map").get("objectCount").asInt()).isZero();
    next(viewer, "snapshot-end", "map");
    JsonNode clusters = next(viewer, "clusters", "map");
    assertThat(clusters.get("level").asInt()).isEqualTo(6);
    assertThat(clusters.get("upsert")).singleElement().satisfies(c -> {
      assertThat(c.get("count").asInt()).isEqualTo(5);
      assertThat(c.get("byLayer").get(layerId.toString()).asInt()).isEqualTo(5);
      assertThat(c.get("byIdentity").get("friend").asInt()).isEqualTo(5);
      assertThat(c.get("position")).hasSize(2);
    });

    submit(editing, editor, createSymbol(centre.longitude(), centre.latitude() + 0.0002));
    advance(LiveGateway.BATCH_INTERVAL);

    assertThat(next(viewer, "changes", "map").get("events")).as("the new object is in the cluster").isEmpty();
    JsonNode update = next(viewer, "clusters", "map");
    assertThat(update.get("full").asBoolean()).isFalse();
    assertThat(update.get("upsert")).singleElement().satisfies(c -> assertThat(c.get("count").asInt()).isEqualTo(6));
  }

  @Test
  void invalidSubscriptionsAndMovesGetAnErrorNamingThem() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser);

    session.receive(subscribe("bad id", ""));
    assertThat(browser.next("error").get("message").asString()).contains("subscription id");
    session.receive(subscribe("map", ",\"area\":{\"ring\":[[1,2],[3,4]],\"inside\":[2,3]}"));
    JsonNode notOpened = browser.next("error");
    assertThat(notOpened.get("subscription").asString()).isEqualTo("map");
    assertThat(notOpened.get("message").asString()).contains("not opened").contains("ring");
    session.receive(subscribe("map", ",\"area\":" + area(18, 59, 1) + ",\"budget\":0"));
    assertThat(browser.next("error").get("message").asString()).contains("budget");
    session.receive(subscribe("map", ",\"area\":" + area(18, 59, 1) + ",\"resolution\":-1"));
    assertThat(browser.next("error").get("message").asString()).contains("resolution");
    session.receive("{\"type\":\"area\",\"subscription\":\"nothing\",\"area\":" + area(18, 59, 1) + "}");
    assertThat(browser.next("error").get("message").asString()).contains("no area subscription nothing");

    session.receive(SUBSCRIBE);
    next(browser, "snapshot-begin", "all"); // its snapshot comes from the store: wait for it, so the next message is the error
    next(browser, "snapshot-end", "all");
    session.receive(SUBSCRIBE);
    assertThat(browser.next("error").get("message").asString()).contains("open already");
    for (int i = 1; i < SessionWorker.MAX_SUBSCRIPTIONS; i++) {
      session.receive(subscribe("s" + i, ",\"objects\":false"));
    }
    session.receive(subscribe("one-too-many", ",\"objects\":false"));
    session.receive("{\"type\":\"marker\"}");
    List<String> errors = new java.util.ArrayList<>();
    JsonNode message;
    do {
      message = browser.received.next();
      if (message.get("type").asString().equals("error")) {
        errors.add(message.get("message").asString());
      }
    } while (!(message.get("type").asString().equals("error") && message.get("message").asString().contains("marker")));
    assertThat(errors).hasSize(2).first().asString().contains("at most " + SessionWorker.MAX_SUBSCRIPTIONS);
  }

  // ---- The fill workers (T-047, rule C7) ---------------------------------------------------------

  /** Fill workers that answer only when the test lets them. */
  private static final class HeldFills implements MessageHandler<AreaFill.Fill> {
    final LinkedBlockingQueue<AreaFill.Fill> waiting = new LinkedBlockingQueue<>();

    @Override
    public void handle(AreaFill.Fill fill, HandlerContext<AreaFill.Fill> context) {
      waiting.add(fill);
    }

    AreaFill.Fill next() {
      try {
        AreaFill.Fill fill = waiting.poll(Probe.WAIT.toMillis(), TimeUnit.MILLISECONDS);
        assertThat(fill).as("a fill was asked for").isNotNull();
        return fill;
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new AssertionError(e);
      }
    }

    static void release(AreaFill.Fill fill) {
      fill.replyTo().reply(AreaView.filled(fill.area(), fill.resolution(), fill.budget(), fill.answer().objects(), fill.answer().bounds()));
    }
  }

  /** A gateway on a runtime of its own whose fill workers are {@code fills}. */
  private LiveGateway heldGateway(HeldFills fills) {
    return heldGateway(fills, LiveGateway.MAX_HELD);
  }

  private LiveGateway heldGateway(HeldFills fills, int maxHeld) {
    WorkerRuntime other = WorkerRuntime.start(RuntimeConfig.defaults().time(time));
    others.add(other);
    WorkerHandle<StoreMsg> otherStore = other.owner("core-store").spawn(
        WorkerOptions.<StoreMsg>of("object-store", () -> new ObjectStore(new PictureState(), other, CLOCK, new DataTypes())));
    stores.put(other, otherStore);
    return new LiveGateway(other, otherStore, JSON, CLOCK, new LiveGateway.Limits(LiveGateway.BATCH_INTERVAL, 2, 10,
        LiveGateway.INBOUND_BUDGET, WorkerOptions.MAX_BUDGET, LiveGateway.DEFAULT_MAX_BUDGET, maxHeld), () -> fills);
  }

  @Test
  void changesThatComeWhileAnAreaIsFilledAreKeptAndFollowItsSnapshot() {
    HeldFills fills = new HeldFills();
    LiveGateway gateway = heldGateway(fills);
    Browser browser = new Browser();
    ChangeRequest first = createSymbol(18.07, 59.33);
    LiveGateway.LiveSession session = filled(gateway, browser, List.of(first));
    session.receive(subscribe("map", ",\"area\":" + area(18, 59.3, 0.5) + ",\"resolution\":30"));
    AreaFill.Fill fill = fills.next(); // the store has answered; the fill is out

    ChangeRequest second = createSymbol(18.1, 59.35);
    submit(session, browser, second);
    time.advanceSettled(LiveGateway.BATCH_INTERVAL, others.getLast()); // the batch reaches the session while the fill is out
    HeldFills.release(fill);

    assertThat(next(browser, "snapshot-begin", "map").get("sequenceNo").asLong()).isEqualTo(2);
    assertThat(next(browser, "snapshot-objects", "map").get("objects")).singleElement()
        .satisfies(o -> assertThat(o.get("id").asString()).isEqualTo(first.entityId().toString()));
    next(browser, "snapshot-end", "map");
    next(browser, "clusters", "map");
    JsonNode kept = next(browser, "changes", "map");
    assertThat(kept.get("sequenceNo").asLong()).isEqualTo(3);
    assertThat(kept.get("events")).singleElement()
        .satisfies(e -> assertThat(e.get("entityId").asString()).isEqualTo(second.entityId().toString()));
  }

  @Test
  void aMovesChangesWhileItsAreaIsFilledAreInTheDifferenceOnce() {
    HeldFills fills = new HeldFills();
    LiveGateway gateway = heldGateway(fills);
    Browser browser = new Browser();
    ChangeRequest stockholm = createSymbol(18.07, 59.33);
    ChangeRequest gothenburg = createSymbol(11.97, 57.71);
    LiveGateway.LiveSession session = filled(gateway, browser, List.of(stockholm, gothenburg));
    session.receive(subscribe("map", ",\"area\":" + area(18, 59.3, 0.5) + ",\"resolution\":30"));
    HeldFills.release(fills.next());
    subscribed(browser, "map");

    session.receive("{\"type\":\"area\",\"subscription\":\"map\",\"area\":" + area(12, 57.7, 0.5) + ",\"resolution\":30}");
    AreaFill.Fill move = fills.next(); // the store has answered the move; its fill is out
    ChangeRequest arrived = createSymbol(12.0, 57.75); // in the new area only
    submit(session, browser, arrived);
    time.advanceSettled(LiveGateway.BATCH_INTERVAL, others.getLast());
    assertThat(next(browser, "changes", "map").get("events")).as("judged by the old area: not in it").isEmpty();
    HeldFills.release(move);

    JsonNode moved = next(browser, "area-objects", "map");
    assertThat(moved.get("sequenceNo").asLong()).isEqualTo(4);
    List<String> entered = new ArrayList<>();
    moved.get("entered").forEach(o -> entered.add(o.get("id").asString()));
    assertThat(entered).containsExactlyInAnyOrder(gothenburg.entityId().toString(), arrived.entityId().toString());
    assertThat(moved.get("left")).singleElement()
        .satisfies(id -> assertThat(id.asString()).isEqualTo(stockholm.entityId().toString()));
  }

  @Test
  void aFillThatTimesOutIsAskedForAgain() {
    HeldFills fills = new HeldFills();
    LiveGateway gateway = heldGateway(fills);
    Browser browser = new Browser();
    ChangeRequest first = createSymbol(18.07, 59.33);
    LiveGateway.LiveSession session = filled(gateway, browser, List.of(first));
    session.receive(subscribe("map", ",\"area\":" + area(18, 59.3, 0.5) + ",\"resolution\":30"));
    AreaFill.Fill lost = fills.next();

    time.advanceSettled(SessionWorker.SNAPSHOT_TIMEOUT, others.getLast());
    AreaFill.Fill again = fills.next(); // the store was asked again, then the fill worker
    HeldFills.release(lost); // too late: its ask has ended
    HeldFills.release(again);

    assertThat(next(browser, "snapshot-begin", "map").get("objectCount").asInt()).isEqualTo(1);
    next(browser, "snapshot-objects", "map");
    next(browser, "snapshot-end", "map");
    next(browser, "clusters", "map");
    handled(session, browser); // one snapshot, not two
  }

  @Test
  void aFillThatIsRefusedIsAskedForAgainAndAfterThreeTimesTheBrowserIsTold() {
    HeldFills fills = new HeldFills();
    LiveGateway gateway = heldGateway(fills);
    Browser browser = new Browser();
    LiveGateway.LiveSession session = filled(gateway, browser, List.of(createSymbol(18.07, 59.33)));
    session.receive(subscribe("map", ",\"area\":" + area(18, 59.3, 0.5) + ",\"resolution\":30"));

    for (int i = 1; i < SessionWorker.MAX_FILL_TRIES; i++) {
      fills.next().replyTo().fail("the mailbox is full");
      time.advanceSettled(SessionWorker.MIN_SNAPSHOT_INTERVAL, others.getLast()); // a snapshot per interval
    }
    fills.next().replyTo().fail("the mailbox is full");

    JsonNode error = next(browser, "error", "map");
    assertThat(error.get("message").asString()).contains("no snapshot").contains("the mailbox is full");
  }

  @Test
  void aMovesFillThatComesBackBeforeItsChangesWaitsForThem() {
    HeldFills fills = new HeldFills();
    LiveGateway gateway = heldGateway(fills);
    Browser browser = new Browser();
    ChangeRequest stockholm = createSymbol(18.07, 59.33);
    ChangeRequest gothenburg = createSymbol(11.97, 57.71);
    LiveGateway.LiveSession session = filled(gateway, browser, List.of(stockholm, gothenburg));
    session.receive(subscribe("map", ",\"area\":" + area(18, 59.3, 0.5) + ",\"resolution\":30"));
    HeldFills.release(fills.next());
    subscribed(browser, "map");

    ChangeRequest arrived = createSymbol(12.0, 57.75); // stored, but its batch has not reached the session yet
    submit(session, browser, arrived);
    session.receive("{\"type\":\"area\",\"subscription\":\"map\",\"area\":" + area(12, 57.7, 0.5) + ",\"resolution\":30}");
    HeldFills.release(fills.next()); // the fill, which includes it, comes back first: held
    handled(session, browser);

    time.advanceSettled(LiveGateway.BATCH_INTERVAL, others.getLast());

    assertThat(next(browser, "changes", "map").get("events")).as("judged by the old area").isEmpty();
    JsonNode moved = next(browser, "area-objects", "map");
    List<String> entered = new ArrayList<>();
    moved.get("entered").forEach(o -> entered.add(o.get("id").asString()));
    assertThat(entered).containsExactlyInAnyOrder(gothenburg.entityId().toString(), arrived.entityId().toString());
  }

  @Test
  void aSnapshotThatOvertakesAMoveTakesItsAreaAndItsFillIsIgnored() {
    HeldFills fills = new HeldFills();
    LiveGateway gateway = heldGateway(fills);
    Browser browser = new Browser();
    ChangeRequest stockholm = createSymbol(18.07, 59.33);
    ChangeRequest gothenburg = createSymbol(11.97, 57.71);
    LiveGateway.LiveSession session = filled(gateway, browser, List.of(stockholm, gothenburg));
    session.receive(subscribe("map", ",\"area\":" + area(18, 59.3, 0.5) + ",\"resolution\":30"));
    HeldFills.release(fills.next());
    subscribed(browser, "map");
    time.advanceSettled(SessionWorker.MIN_SNAPSHOT_INTERVAL, others.getLast());

    session.receive("{\"type\":\"area\",\"subscription\":\"map\",\"area\":" + area(12, 57.7, 0.5) + ",\"resolution\":30}");
    AreaFill.Fill move = fills.next();
    session.missedChanges(); // a fresh snapshot is needed while the move's fill is out
    AreaFill.Fill snapshot = fills.next();
    HeldFills.release(move);
    HeldFills.release(snapshot);

    next(browser, "snapshot-begin", "map");
    assertThat(next(browser, "snapshot-objects", "map").get("objects")).as("the area moved to").singleElement()
        .satisfies(o -> assertThat(o.get("id").asString()).isEqualTo(gothenburg.entityId().toString()));
    next(browser, "snapshot-end", "map");
    next(browser, "clusters", "map");
    handled(session, browser); // no area-objects from the overtaken move
  }

  @Test
  void theObjectsAConnectionsAreasHoldAreCountedAgainWhenTheirFillsComeBack() {
    HeldFills fills = new HeldFills();
    LiveGateway gateway = heldGateway(fills, 3);
    Browser browser = new Browser();
    LiveGateway.LiveSession session = filled(gateway, browser,
        List.of(createSymbol(18.07, 59.33), createSymbol(18.1, 59.35)));
    session.receive(subscribe("a", ",\"area\":" + area(18, 59.3, 0.5) + ",\"resolution\":30"));
    session.receive(subscribe("b", ",\"area\":" + area(18, 59.3, 0.5) + ",\"resolution\":30"));
    AreaFill.Fill a = fills.next();
    AreaFill.Fill b = fills.next(); // both asked for before either view exists: 2 + 2 > 3 only counts once both are filled
    HeldFills.release(a);
    subscribed(browser, "a");
    HeldFills.release(b);

    assertThat(next(browser, "error", "b").get("message").asString()).contains("closed").contains("at most 3");
  }

  // ---- Limits of protocol version 2 (conformance review F1, N2) ----------------------------------

  /** A gateway with these limits, on a runtime of its own. */
  private LiveGateway limitedGateway(int maxBudget, int maxHeld) {
    WorkerRuntime other = WorkerRuntime.start(RuntimeConfig.defaults().time(time));
    others.add(other);
    WorkerHandle<StoreMsg> otherStore = other.owner("core-store").spawn(
        WorkerOptions.<StoreMsg>of("object-store", () -> new ObjectStore(new PictureState(), other, CLOCK, new DataTypes())));
    stores.put(other, otherStore);
    return new LiveGateway(other, otherStore, JSON, CLOCK, new LiveGateway.Limits(LiveGateway.BATCH_INTERVAL, 2, 10,
        LiveGateway.INBOUND_BUDGET, WorkerOptions.MAX_BUDGET, maxBudget, maxHeld));
  }

  private final java.util.Map<WorkerRuntime, WorkerHandle<StoreMsg>> stores = new java.util.HashMap<>();

  /** Opens a session on {@code gateway} and fills its store through it with a layer and {@code symbols}. */
  private LiveGateway.LiveSession filled(LiveGateway gateway, Browser browser, List<ChangeRequest> symbols) {
    LiveGateway.LiveSession session = gateway.open(LOCAL, browser);
    browser.next("welcome");
    submit(session, browser, createLayer());
    symbols.forEach(request -> submit(session, browser, request));
    return session;
  }

  private static void subscribed(Browser browser, String subscription) {
    next(browser, "snapshot-begin", subscription);
    JsonNode message;
    while ((message = browser.received.next()).get("type").asString().equals("snapshot-objects")) {
      assertThat(message.get("subscription").asString()).isEqualTo(subscription);
    }
    assertThat(message.get("type").asString()).isEqualTo("snapshot-end");
    next(browser, "clusters", subscription);
  }

  @Test
  void aBudgetAboveTheServersCapIsCapped() {
    Position centre = cellCentre(18.0, 59.3);
    List<ChangeRequest> five = new java.util.ArrayList<>();
    for (int i = 0; i < 5; i++) {
      five.add(createSymbol(centre.longitude() + i * 0.0002, centre.latitude()));
    }
    Browser browser = new Browser();
    LiveGateway.LiveSession session = filled(limitedGateway(2, LiveGateway.MAX_HELD), browser, five);

    session.receive(subscribe("map", ",\"area\":" + area(18, 59.3, 3) + ",\"resolution\":3000,\"budget\":1000"));

    assertThat(next(browser, "snapshot-begin", "map").get("objectCount").asInt()).as("clusters: the cap of 2 counts").isZero();
  }

  @Test
  void anAreaOfMoreThanTheMostPositionsIsRefused() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser);
    StringBuilder ring = new StringBuilder("[");
    for (int i = 0; i < SessionWorker.MAX_RING; i++) {
      ring.append(String.format(java.util.Locale.ROOT, "[%s,60],", -180 + 359.0 * i / SessionWorker.MAX_RING));
    }
    ring.append("[-180,60]]"); // one more than the limit

    session.receive(subscribe("map", ",\"area\":{\"ring\":" + ring + ",\"inside\":[0,90]}"));

    assertThat(browser.next("error").get("message").asString()).contains("at most " + SessionWorker.MAX_RING + " positions");
  }

  @Test
  void movesWaitForTheIntervalOfTheirSubscriptionAndOfTheSessionAndTheLatestCounts() {
    ChangeRequest stockholm = createSymbol(18.07, 59.33);
    ChangeRequest gothenburg = createSymbol(11.97, 57.71);
    ChangeRequest oslo = createSymbol(10.75, 59.91);
    Browser browser = new Browser();
    LiveGateway.LiveSession session = filled(limitedGateway(LiveGateway.DEFAULT_MAX_BUDGET, LiveGateway.MAX_HELD), browser,
        List.of(stockholm, gothenburg, oslo));
    for (int i = 1; i <= SessionWorker.MAX_MOVES_PER_SECOND + 1; i++) {
      session.receive(subscribe("m" + i, ",\"area\":" + area(18, 59.3, 0.5) + ",\"resolution\":30"));
      subscribed(browser, "m" + i);
    }

    String toGothenburg = ",\"area\":" + area(12, 57.7, 0.5) + ",\"resolution\":30}";
    for (int i = 1; i <= SessionWorker.MAX_MOVES_PER_SECOND + 1; i++) {
      session.receive("{\"type\":\"area\",\"subscription\":\"m" + i + "\"" + toGothenburg);
    }
    // m1 moves again at once, to Oslo: within its own interval, and the latest area counts.
    session.receive("{\"type\":\"area\",\"subscription\":\"m1\",\"area\":" + area(10.75, 59.9, 0.5) + ",\"resolution\":30}");
    List<String> moved = new java.util.ArrayList<>();
    for (int i = 0; i < SessionWorker.MAX_MOVES_PER_SECOND; i++) {
      moved.add(browser.next("area-objects").get("subscription").asString());
    }
    handled(session, browser);
    assertThat(moved).as("at most four area queries per session and second").containsExactly("m1", "m2", "m3", "m4");

    advance(Duration.ofSeconds(1));

    JsonNode later = browser.next("area-objects");
    JsonNode last = browser.next("area-objects");
    assertThat(List.of(later.get("subscription").asString(), last.get("subscription").asString())).containsExactlyInAnyOrder("m1", "m5");
    JsonNode m1 = later.get("subscription").asString().equals("m1") ? later : last;
    assertThat(m1.get("entered")).singleElement()
        .satisfies(o -> assertThat(o.get("id").asString()).isEqualTo(oslo.entityId().toString()));
  }

  @Test
  void aConnectionsAreasHoldAtMostItsShareOfObjects() {
    List<ChangeRequest> three = List.of(createSymbol(18.0, 59.3), createSymbol(18.1, 59.3), createSymbol(11.97, 57.71));
    Browser browser = new Browser();
    LiveGateway.LiveSession session = filled(limitedGateway(LiveGateway.DEFAULT_MAX_BUDGET, 3), browser, three);
    session.receive(subscribe("a", ",\"area\":" + area(18, 59.3, 0.5) + ",\"resolution\":30"));
    subscribed(browser, "a"); // holds 2

    session.receive(subscribe("b", ",\"area\":" + area(18, 59.3, 0.5) + ",\"resolution\":30")); // 2 more: over 3
    JsonNode closed = browser.next("error");
    assertThat(closed.get("subscription").asString()).isEqualTo("b");
    assertThat(closed.get("message").asString()).contains("at most 3");
    session.receive(subscribe("c", ",\"area\":" + area(12, 57.7, 0.5) + ",\"resolution\":30")); // 1 more: room
    subscribed(browser, "c");

    session.receive("{\"type\":\"area\",\"subscription\":\"c\",\"area\":" + area(18, 59.3, 0.5) + ",\"resolution\":30}");
    assertThat(browser.next("error").get("message").asString()).contains("area of c not moved").contains("at most 3");
  }

  @Test
  void theDefaultLimits() {
    assertThat(LiveGateway.DEFAULT_MAX_SESSIONS).isEqualTo(200);
    assertThat(LiveGateway.INBOUND_BUDGET).isEqualTo(2L * 1024 * 1024);
  }

  @Test
  void theDefaultCadenceIs200Milliseconds() {
    assertThat(LiveGateway.BATCH_INTERVAL).isEqualTo(Duration.ofMillis(200));
  }

  // ---- Object queries (CR-0015 items 8 and 9) ---------------------------------------------------

  private static String getObjects(String queryId, List<UUID> ids) {
    return "{\"type\":\"get-objects\",\"queryId\":\"" + queryId + "\",\"ids\":["
        + String.join(",", ids.stream().map(id -> "\"" + id + "\"").toList()) + "]}";
  }

  private static String queryLayer(String queryId, UUID layer, int page, int pageSize) {
    return "{\"type\":\"query-layer\",\"queryId\":\"" + queryId + "\",\"layerId\":\"" + layer + "\",\"page\":" + page
        + ",\"pageSize\":" + pageSize + "}";
  }

  private static JsonNode failed(Browser browser, String queryId, String problem) {
    JsonNode message = browser.next("query-failed");
    assertThat(message.get("queryId").asString()).isEqualTo(queryId);
    assertThat(message.get("problem").asString()).as(message.toString()).isEqualTo(problem);
    return message;
  }

  @Test
  void aBrowserFetchesObjectsByIdAndALayersObjectsPageByPage() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser);
    submit(session, browser, createLayer());
    List<ChangeRequest> symbols = List.of(createSymbol(17.5, 59.25), createSymbol(18.5, 60.25), createSymbol(11.75, 57.5));
    symbols.forEach(s -> submit(session, browser, s));
    List<UUID> ids = symbols.stream().map(ChangeRequest::entityId).sorted(Comparator.comparing(UUID::toString)).toList();
    UUID gone = UUID.randomUUID();

    session.receive(getObjects("q1", List.of(ids.get(2), gone, ids.get(0), ids.get(2))));
    JsonNode objects = browser.next("objects");
    assertThat(objects.get("queryId").asString()).isEqualTo("q1");
    assertThat(objects.get("sequenceNo").asLong()).isEqualTo(4);
    assertThat(objects.get("found")).extracting(o -> o.get("id").asString()).containsExactly(ids.get(2).toString(), ids.get(0).toString());
    assertThat(objects.get("found").get(0).get("geometry").get("coordinates")).isNotNull(); // whole map objects, as the model writes them
    assertThat(objects.get("missing")).extracting(JsonNode::asString).containsExactly(gone.toString());

    session.receive(queryLayer("q2", layerId, 1, 2));
    JsonNode page = browser.next("layer-page");
    assertThat(page.get("queryId").asString()).isEqualTo("q2");
    assertThat(page.get("sequenceNo").asLong()).isEqualTo(4);
    assertThat(page.get("layerId").asString()).isEqualTo(layerId.toString());
    assertThat(page.get("page").asInt()).isEqualTo(1);
    assertThat(page.get("pageSize").asInt()).isEqualTo(2);
    assertThat(page.get("total").asInt()).isEqualTo(3);
    assertThat(page.get("objects")).extracting(o -> o.get("id").asString()).containsExactly(ids.get(2).toString());
  }

  @Test
  void aQueryTheServerCannotUseIsAnsweredWithItsProblem() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser);
    submit(session, browser, createLayer());

    session.receive(queryLayer("q1", UUID.randomUUID(), 0, 10));
    assertThat(failed(browser, "q1", "no-layer").get("message").asString()).startsWith("no layer ");
    List<UUID> tooMany = java.util.stream.IntStream.range(0, 1001).mapToObj(i -> UUID.randomUUID()).toList();
    session.receive(getObjects("q2", tooMany));
    assertThat(failed(browser, "q2", "invalid").get("message").asString()).isEqualTo("ids is an array of at most 1000 object ids");
    session.receive("{\"type\":\"get-objects\",\"queryId\":\"q3\",\"ids\":[\"" + layerId.toString().toUpperCase(java.util.Locale.ROOT) + "\"]}");
    assertThat(failed(browser, "q3", "invalid").get("message").asString()).startsWith("not an id: ");
    session.receive(queryLayer("q4", layerId, 0, 501));
    assertThat(failed(browser, "q4", "invalid").get("message").asString()).isEqualTo("pageSize is a whole number from 1 to 500");
    session.receive(queryLayer("q5", layerId, -1, 10));
    assertThat(failed(browser, "q5", "invalid").get("message").asString()).isEqualTo("page is a whole number from 0");
    session.receive("{\"type\":\"query-layer\",\"queryId\":\"q6\",\"layerId\":\"" + layerId + "\",\"page\":0.5,\"pageSize\":10}");
    failed(browser, "q6", "invalid");
    session.receive("{\"type\":\"query-layer\",\"queryId\":\"q7\",\"layerId\":\"" + layerId + "\",\"page\":0}");
    failed(browser, "q7", "invalid");

    session.receive("{\"type\":\"get-objects\",\"queryId\":\"a b\",\"ids\":[]}"); // no query id to answer
    JsonNode error = browser.next("error");
    assertThat(error.get("message").asString()).isEqualTo("a query id has 1 to 64 letters, digits, - or _");
    assertThat(error.has("queryId")).isFalse();
    session.receive(queryLayer("q8", layerId, 0, 10)); // the session goes on
    assertThat(browser.next("layer-page").get("total").asInt()).isZero();
  }

  @Test
  void atMostEightQueriesWaitAndAQueryTheStoreDoesNotAnswerIsUnavailable() {
    Browser browser = new Browser();
    LiveGateway silent = otherGateway(10, LiveGateway.INBOUND_BUDGET, (message, context) -> {}); // never answers
    LiveGateway.LiveSession session = silent.open(LOCAL, browser);
    browser.next("welcome");
    for (int i = 0; i < SessionWorker.MAX_QUERIES + 2; i++) {
      session.receive(i % 2 == 0 ? getObjects("q" + i, List.of(UUID.randomUUID())) : queryLayer("q" + i, layerId, 0, 10));
    }

    for (int i = SessionWorker.MAX_QUERIES; i < SessionWorker.MAX_QUERIES + 2; i++) {
      assertThat(failed(browser, "q" + i, "busy").get("message").asString()).startsWith("at most 8 queries at a time");
    }
    advance(SessionWorker.STORE_TIMEOUT);
    for (int i = 0; i < SessionWorker.MAX_QUERIES; i++) {
      assertThat(failed(browser, "q" + i, "unavailable").get("message").asString())
          .isEqualTo("the object store did not answer within 10 s");
    }
    session.receive(getObjects("again", List.of(UUID.randomUUID()))); // room again: this one waits for the store
    handled(session, browser);
  }

  @Test
  void aQueryTheStoreFailsIsUnavailableAndFreesItsPlace() {
    Browser browser = new Browser();
    LiveGateway failing = otherGateway(10, LiveGateway.INBOUND_BUDGET, (message, context) -> {
      switch (message) {
        case StoreMsg.GetObjects get -> get.replyTo().fail("the store is broken");
        case StoreMsg.GetLayerPage get -> get.replyTo().fail("the store is broken");
        default -> { }
      }
    });
    LiveGateway.LiveSession session = failing.open(LOCAL, browser);
    browser.next("welcome");

    // Of each kind more than the waiting queries allowed, one after another: each failure frees its place.
    for (int i = 0; i < 2 * (SessionWorker.MAX_QUERIES + 1); i++) {
      session.receive(i <= SessionWorker.MAX_QUERIES ? getObjects("q" + i, List.of(UUID.randomUUID())) : queryLayer("q" + i, layerId, 0, 10));
      assertThat(failed(browser, "q" + i, "unavailable").get("message").asString()).isEqualTo("the object store failed: the store is broken");
    }
  }

  @Test
  void theShellsOwnPluginIdIsTheOneOfEcoresABrowserMayUse() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser);
    submit(session, browser, createLayer());
    ChangeRequest symbol = createSymbol(17.5, 59.25);
    ChangeRequest asShell = new ChangeRequest(symbol.requestId(), symbol.entityType(), symbol.operation(), symbol.entityId(),
        null, symbol.data(), null, Actor.plugin("core-shell"));

    JsonNode applied = submit(session, browser, asShell);

    assertThat(applied.get("outcome").asString()).isEqualTo("applied");
    assertThat(applied.get("event").get("by").get("plugin").asString()).isEqualTo("core-shell");
    assertThat(applied.get("event").get("by").get("user").asString()).isEqualTo("local");
  }
}
