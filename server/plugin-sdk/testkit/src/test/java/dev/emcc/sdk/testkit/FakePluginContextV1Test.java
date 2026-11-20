package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.DataType;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.Permissions;
import dev.emcc.sdk.User;
import dev.emcc.sdk.document.DocumentResult;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.listener.Backoff;
import dev.emcc.sdk.listener.Listener;
import dev.emcc.sdk.listener.ListenerConnection;
import dev.emcc.sdk.listener.ListenerContext;
import dev.emcc.sdk.listener.ListenerEvent;
import dev.emcc.sdk.listener.ListenerRef;
import dev.emcc.sdk.listener.ListenerSpec;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.TimeAttributes;
import dev.emcc.sdk.store.Area;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.ObjectQuery;
import dev.emcc.sdk.store.QueryResult;
import dev.emcc.sdk.store.StoreUpdate;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The SDK v1 parts of {@link FakePluginContext}: store, documents, settings, data types, permissions and listeners. */
class FakePluginContextV1Test {

  sealed interface Msg extends Message {}

  record Outcome(ChangeOutcome outcome) implements Msg {}

  record Found(QueryResult result) implements Msg {}

  record Update(StoreUpdate update) implements Msg {}

  record Doc(DocumentResult result) implements Msg {}

  record Settings(JsonObject values) implements Msg {}

  record Request(EndpointRequest request) implements Msg {}

  record Line(String text) implements Msg {}

  record Event(ListenerEvent event) implements Msg {}

  private static final Duration TIMEOUT = Duration.ofSeconds(10);
  private static final ExternalRef REF = new ExternalRef("cot", "ANDROID-1");
  private static final DataType COT = new DataType("cot-in.cot", "CoT", null, "cot-in", new DataType.Defaults(null, true, 600L));

  private final List<Msg> handled = new ArrayList<>();

  private WorkerRef<Msg> recorder(FakePluginContext ctx) {
    return ctx.workers().spawn(WorkerSpec.of("main", Msg.class, () -> (m, c) -> handled.add(m)));
  }

  private <T extends Msg> List<T> handled(Class<T> type) {
    return handled.stream().filter(type::isInstance).map(type::cast).toList();
  }

  private static MapObjectContent content(Layer layer, String dataType, String dataSource) {
    return new MapObjectContent("core.shape", dataType, dataSource, null, layer.id(), new Geometry.Point(Position.of(18.1012, 59.3507)),
        null, null, null, layer.content().label(), Extensions.empty());
  }

  // ---------------------------------------------------------------- store

  @Test
  void theStoreAppliesChangesAndTellsSubscribers() {
    var ctx = FakePluginContext.builder("cot-in").dataTypes(COT).build();
    var main = recorder(ctx);
    Layer layer = ctx.store().seedLayer("TAK north");
    ctx.store().subscribe(ObjectQuery.byDataSource("tak-north"), main, Update::new);
    UUID id = UUID.randomUUID();
    ctx.store().submit(Change.createObject(id, content(layer, "cot-in.cot", "tak-north")).withExternalRef(REF).bySystem("tak-north"), TIMEOUT, main, Outcome::new);
    ctx.runUntilIdle();

    assertThat(handled(Outcome.class)).singleElement().extracting(Outcome::outcome).isInstanceOf(ChangeOutcome.Applied.class);
    MapObject stored = ctx.store().object(id);
    assertThat(stored).isNotNull();
    assertThat(stored.version()).isEqualTo(1);
    assertThat(stored.meta().externalRef()).isEqualTo(REF);
    assertThat(stored.meta().created().by()).isEqualTo(new Actor("cot-in", null, "tak-north"));
    assertThat(stored.meta().created().at()).isEqualTo(FakePluginContext.CLOCK_START);
    List<Update> updates = handled(Update.class);
    assertThat(updates).hasSize(2);
    assertThat(updates.get(0).update()).isInstanceOf(StoreUpdate.Snapshot.class);
    assertThat(((StoreUpdate.Changes) updates.get(1).update()).events()).singleElement().satisfies(e -> assertThat(e.entityId()).isEqualTo(id));
    assertThat(ctx.store().requests()).singleElement().satisfies(r -> assertThat(r.source().plugin()).isEqualTo("cot-in"));
    assertThat(ctx.outstandingAsks()).isZero();
  }

  @Test
  void theStoreRejectsWhatTheModelRulesForbid() {
    var ctx = FakePluginContext.builder("cot-in").dataTypes(COT).build();
    var main = recorder(ctx);
    Layer layer = ctx.store().seedLayer("TAK north");
    UUID id = UUID.randomUUID();
    ctx.store().submit(Change.createObject(id, content(layer, "cot-in.cot", "tak-north")).withExternalRef(REF), TIMEOUT, main, Outcome::new);
    ctx.runUntilIdle();
    MapObject stored = ctx.store().object(id);
    assertThat(stored).isNotNull();

    Instant t = Instant.parse("2026-10-03T08:25:00Z");
    var reversed = new MapObjectContent("core.shape", "cot-in.cot", "tak-north", new TimeAttributes(null, t.plusSeconds(60), t), layer.id(),
        new Geometry.Point(Position.of(18.1012, 59.3507)), null, null, null, layer.content().label(), Extensions.empty());
    List<Change> forbidden = List.of(
        Change.createObject(UUID.randomUUID(), content(layer, "cot-in.cot", "tak-north")).withExternalRef(REF),   // rule 16
        Change.createObject(UUID.randomUUID(), content(layer, "removed-plugin.thing", "tak-north")),             // rule 14
        Change.updateObject(stored, content(layer, "cot-in.cot", "tak-south")),                                  // rule 14
        Change.createObject(UUID.randomUUID(), reversed),                                                        // rule 15
        Change.createObject(id, content(layer, "cot-in.cot", "tak-north")),                                      // rule 3
        Change.deleteLayer(layer));                                                                              // rule 11
    forbidden.forEach(c -> ctx.store().submit(c, TIMEOUT, main, Outcome::new));
    ctx.runUntilIdle();

    List<ChangeRejection> rejections = handled(Outcome.class).stream().skip(1).map(o -> ((ChangeOutcome.Rejected) o.outcome()).rejection()).toList();
    assertThat(rejections).extracting(ChangeRejection::code).containsExactly(
        ChangeRejection.Code.EXTERNAL_REF_EXISTS,
        ChangeRejection.Code.VALIDATION_FAILED,
        ChangeRejection.Code.VALIDATION_FAILED,
        ChangeRejection.Code.VALIDATION_FAILED,
        ChangeRejection.Code.ENTITY_EXISTS,
        ChangeRejection.Code.LAYER_NOT_EMPTY);
    assertThat(rejections.get(1).details()).singleElement().satisfies(d -> assertThat(d.path()).isEqualTo("/data/dataType"));
    assertThat(rejections.get(2).details()).singleElement().satisfies(d -> assertThat(d.path()).isEqualTo("/data/dataSource"));
    assertThat(ctx.store().objects()).hasSize(1);
  }

  @Test
  void anUpdateChangesOnlyTheRequestersOwnExtension() {
    var ctx = FakePluginContext.builder("cot-in").dataTypes(COT).build();
    var main = recorder(ctx);
    Layer layer = ctx.store().seedLayer("TAK north");
    UUID id = UUID.randomUUID();
    var drawn = content(layer, "cot-in.cot", "tak-north");
    var withBoth = new MapObjectContent(drawn.type(), drawn.dataType(), drawn.dataSource(), null, drawn.layerId(), drawn.geometry(), null, null, null, drawn.label(),
        Extensions.empty().with("draw-symbols", JsonObject.of(Map.of("by", JsonString.of("hand")))).with("cot-in", JsonObject.of(Map.of("how", JsonString.of("m-g")))));
    ctx.store().submit(Change.createObject(id, withBoth), TIMEOUT, main, Outcome::new);
    ctx.runUntilIdle();

    // The plugin sends its own namespace as {} (remove) and a different draw-symbols value (ignored, rule 5).
    var removeOwn = new MapObjectContent(drawn.type(), drawn.dataType(), drawn.dataSource(), null, drawn.layerId(), drawn.geometry(), null, null, null, drawn.label(),
        Extensions.empty().with("cot-in", JsonObject.empty()).with("draw-symbols", JsonObject.empty()));
    ctx.store().submit(Change.updateObject(ctx.store().object(id), removeOwn), TIMEOUT, main, Outcome::new);
    ctx.runUntilIdle();

    var ext = ctx.store().object(id).content().extensions();
    assertThat(ext.get("cot-in")).isNull();
    assertThat(ext.get("draw-symbols")).isEqualTo(JsonObject.of(Map.of("by", JsonString.of("hand"))));
  }

  @Test
  void lostDroppedAndRejectedAnswersCanBeScripted() {
    var ctx = FakePluginContext.builder("cot-in").dataTypes(COT).build();
    var main = recorder(ctx);
    Layer layer = ctx.store().seedLayer("TAK north");
    UUID lost = UUID.randomUUID();
    UUID dropped = UUID.randomUUID();
    ctx.store().loseNextAnswer();
    ctx.store().submit(Change.createObject(lost, content(layer, "cot-in.cot", "tak-north")), TIMEOUT, main, Outcome::new);
    ctx.store().dropNextRequest();
    ctx.store().submit(Change.createObject(dropped, content(layer, "cot-in.cot", "tak-north")), TIMEOUT, main, Outcome::new);
    ctx.store().rejectNext(ChangeRejection.Code.INTERNAL_ERROR, "the disk is full");
    ctx.store().submit(Change.createObject(UUID.randomUUID(), content(layer, "cot-in.cot", "tak-north")), TIMEOUT, main, Outcome::new);
    ctx.runUntilIdle();
    assertThat(ctx.outstandingAsks()).isEqualTo(2);
    assertThat(handled(Outcome.class)).singleElement().satisfies(o ->
        assertThat(((ChangeOutcome.Rejected) o.outcome()).rejection().code()).isEqualTo(ChangeRejection.Code.INTERNAL_ERROR));

    ctx.advance(TIMEOUT);
    assertThat(handled(Outcome.class)).hasSize(3).last().extracting(Outcome::outcome).isInstanceOf(ChangeOutcome.Unknown.class);
    assertThat(ctx.store().object(lost)).as("lost answer: applied").isNotNull();
    assertThat(ctx.store().object(dropped)).as("dropped request: not applied").isNull();
    assertThat(ctx.outstandingAsks()).isZero();
  }

  @Test
  void queriesCountAsAsksAndAreasNeedAMatcher() {
    var ctx = FakePluginContext.builder("cot-in").dataTypes(COT).caps(1, 10).build();
    var main = recorder(ctx);
    Layer layer = ctx.store().seedLayer("TAK north");
    ctx.store().submit(Change.createObject(UUID.randomUUID(), content(layer, "cot-in.cot", "tak-north")).withExternalRef(REF), TIMEOUT, main, Outcome::new);
    ctx.store().query(ObjectQuery.byExternalSystem("cot"), TIMEOUT, main, Found::new);
    ctx.store().query(ObjectQuery.byExternalRef(new ExternalRef("cot", "other")), TIMEOUT, main, Found::new);
    ctx.runUntilIdle();
    assertThat(handled(Found.class)).extracting(f -> ((QueryResult.Found) f.result()).objects().size()).containsExactly(1, 0);
    var area = Area.of(List.of(Position.of(10, 50), Position.of(20, 50), Position.of(20, 60), Position.of(10, 50)), Position.of(17, 53));
    assertThatThrownBy(() -> ctx.store().query(ObjectQuery.all().within(area), TIMEOUT, main, Found::new)).isInstanceOf(AssertionError.class);
    ctx.store().areaMatcher((object, polygon) -> true);
    ctx.store().query(ObjectQuery.all().within(area), TIMEOUT, main, Found::new);
    ctx.runUntilIdle();
    assertThat(((QueryResult.Found) handled(Found.class).getLast().result()).objects()).hasSize(1);

    ctx.store().dropNextRequest();
    ctx.store().submit(Change.createObject(UUID.randomUUID(), content(layer, "cot-in.cot", "tak-north")), TIMEOUT, main, Outcome::new);
    ctx.store().query(ObjectQuery.all(), TIMEOUT, main, Found::new);
    ctx.runUntilIdle();
    assertThat(handled(Found.class).getLast().result()).isEqualTo(new QueryResult.Failed(FakePluginContext.TOO_MANY_ASKS));
  }

  @Test
  void changesByOthersAndGapsReachSubscribers() {
    var ctx = FakePluginContext.builder("cot-in").dataTypes(COT).build();
    var main = recorder(ctx);
    Layer layer = ctx.store().seedLayer("TAK north");
    UUID id = UUID.randomUUID();
    ctx.store().submit(Change.createObject(id, content(layer, "cot-in.cot", "tak-north")), TIMEOUT, main, Outcome::new);
    ctx.runUntilIdle();
    ctx.store().subscribe(ObjectQuery.byDataSource("tak-north"), main, Update::new);
    ctx.store().applyAs(new Actor("draw-symbols", "3f2c9a10", null), Change.deleteObject(ctx.store().object(id)));
    ctx.store().gap();
    ctx.runUntilIdle();

    List<StoreUpdate> updates = handled(Update.class).stream().map(Update::update).toList();
    assertThat(updates).hasSize(3);
    assertThat(((StoreUpdate.Snapshot) updates.get(0)).objects()).hasSize(1);
    assertThat(((StoreUpdate.Changes) updates.get(1)).events().getFirst().by().user()).isEqualTo("3f2c9a10");
    assertThat(((StoreUpdate.Snapshot) updates.get(2)).objects()).isEmpty();
  }

  // ---------------------------------------------------------------- documents, settings, data types, permissions

  @Test
  void documentsAreStoredWithEcoresLimits() {
    var ctx = FakePluginContext.builder("cot-in").build();
    var main = recorder(ctx);
    var value = JsonObject.of(Map.of("tak-north", JsonString.of("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e02")));
    ctx.documents().get("layers", main, Doc::new);
    ctx.documents().put("layers", value, main, Doc::new);
    ctx.documents().get("layers", main, Doc::new);
    ctx.documents().put("big", JsonObject.of(Map.of("x", JsonString.of("a".repeat(1024 * 1024)))), main, Doc::new);
    ctx.documents().failNext("disk full");
    ctx.documents().delete("layers", main, Doc::new);
    ctx.runUntilIdle();
    assertThat(handled(Doc.class)).extracting(Doc::result).satisfiesExactly(
        r -> assertThat(r).isEqualTo(new DocumentResult.Missing("layers")),
        r -> assertThat(r).isEqualTo(new DocumentResult.Written("layers")),
        r -> assertThat(r).isEqualTo(new DocumentResult.Found("layers", value)),
        r -> assertThat(r).isInstanceOf(DocumentResult.Failed.class),
        r -> assertThat(r).isEqualTo(new DocumentResult.Failed("layers", "disk full")));
    assertThat(ctx.documents().stored()).containsOnlyKeys("layers");
    assertThatThrownBy(() -> ctx.documents().get("../x", main, Doc::new)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void changedSettingsReachSubscribersAndSettings() {
    var ctx = FakePluginContext.builder("cot-in").settings(JsonObject.of(Map.of("idleSeconds", JsonNumber.of(300)))).build();
    var main = recorder(ctx);
    ctx.subscribeSettings(main, Settings::new);
    var changed = JsonObject.of(Map.of("idleSeconds", JsonNumber.of(60)));
    ctx.changeSettings(changed);
    assertThat(ctx.settings()).isEqualTo(changed);
    ctx.runUntilIdle();
    assertThat(handled(Settings.class)).singleElement().isEqualTo(new Settings(changed));
  }

  @Test
  void dataTypesStartWithCoreGeneral() {
    var ctx = FakePluginContext.builder("cot-in").dataTypes(COT).build();
    assertThat(ctx.dataTypes()).extracting(DataType::id).containsExactly("core.general", "cot-in.cot");
    assertThat(FakePluginContext.builder("x").build().dataTypes()).extracting(DataType::id).containsExactly("core.general");
  }

  @Test
  void anEndpointThatRequiresAPermissionRefusesOtherUsers() {
    var ctx = FakePluginContext.builder("cot-in").build();
    var main = recorder(ctx);
    ctx.endpoints().register(Endpoint.get("/streams").requires(Permissions.SETTINGS_ADMIN), main, Request::new);
    var viewer = User.of("viewer", "Viewer", Set.of(Permissions.OBJECTS_EDIT));
    assertThat(ctx.call("/streams", viewer).reply().status()).isEqualTo(403);
    FakeHttpExchange admin = ctx.call("/streams", User.of("admin", "Admin", Set.of(Permissions.SETTINGS_ADMIN)));
    ctx.runUntilIdle();
    assertThat(handled(Request.class)).singleElement().satisfies(r -> assertThat(r.request().user().id()).isEqualTo("admin"));
    handled(Request.class).getFirst().request().response().respond(HttpReply.status(200));
    assertThat(admin.reply().status()).isEqualTo(200);
    ctx.call("/streams");   // the no-login user has every permission
    ctx.runUntilIdle();
    assertThat(handled(Request.class)).hasSize(2);
  }

  // ---------------------------------------------------------------- listeners

  /** Writes "hello", then sends every read as a line. */
  static final class LineReader implements Listener {
    private final WorkerRef<Msg> target;

    LineReader(WorkerRef<Msg> target) {
      this.target = target;
    }

    @Override
    public void run(ListenerConnection connection, ListenerContext ctx) throws IOException {
      connection.write(Bytes.utf8("hello"));
      byte[] buffer = new byte[256];
      for (int n; (n = connection.input().read(buffer)) >= 0; ) {
        ctx.send(target, new Line(new String(buffer, 0, n, StandardCharsets.UTF_8)));
      }
    }
  }

  private static JsonObject streams(String host, int port) {
    var stream = JsonObject.of(Map.of("name", JsonString.of("tak-north"), "host", JsonString.of(host), "port", JsonNumber.of(port)));
    return JsonObject.of(Map.of("streams", JsonArray.of(stream)));
  }

  private static FakePluginContext.Builder cotIn() {
    return FakePluginContext.builder("cot-in").networkEndpoints("/streams").settings(streams("tak.example.local", 8087));
  }

  @Test
  void aListenerReadsWhatIsFedAndWrites() {
    var ctx = cotIn().build();
    var main = recorder(ctx);
    ctx.listeners().start(ListenerSpec.tcp("tak-north", "tak.example.local", 8087), () -> new LineReader(main), main, Event::new);
    ctx.runUntilIdle();
    FakeConnection tak = ctx.connection("tak-north");
    assertThat(tak.writtenUtf8()).isEqualTo("hello");
    assertThat(handled(Event.class)).singleElement().extracting(Event::event).isInstanceOf(ListenerEvent.Connected.class);

    tak.feed("<event uid=\"A\"/>");
    ctx.runUntilIdle();
    tak.feed("<event uid=\"B\"/>");
    ctx.runUntilIdle();
    assertThat(handled(Line.class)).extracting(Line::text).containsExactly("<event uid=\"A\"/>", "<event uid=\"B\"/>");
    assertThat(ctx.listeners().connected("tak-north")).isTrue();
  }

  @Test
  void aListenerReconnectsWithItsBackoff() {
    var ctx = cotIn().build();
    var main = recorder(ctx);
    var spec = ListenerSpec.tcp("tak-north", "tak.example.local", 8087).reconnect(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(4)));
    ctx.listeners().start(spec, () -> new LineReader(main), main, Event::new);
    ctx.runUntilIdle();
    FakeConnection first = ctx.connection("tak-north");
    ctx.listeners().refuse("tak-north", "connection refused");
    first.close();
    ctx.runUntilIdle();
    assertThat(first.isOpen()).isFalse();
    ctx.advance(Duration.ofSeconds(1));   // refused
    ctx.listeners().accept("tak-north");
    ctx.advance(Duration.ofSeconds(2));   // connects
    List<ListenerEvent> events = handled(Event.class).stream().map(Event::event).toList();
    assertThat(events).hasSize(4);
    var closed = (ListenerEvent.Disconnected) events.get(1);
    assertThat(closed.reason()).isEqualTo("closed by the peer");
    assertThat(closed.retryAt()).isEqualTo(FakePluginContext.CLOCK_START.plusSeconds(1));
    var refused = (ListenerEvent.Disconnected) events.get(2);
    assertThat(refused.reason()).isEqualTo("connection refused");
    assertThat(refused.retryAt()).isEqualTo(FakePluginContext.CLOCK_START.plusSeconds(3));
    assertThat(events.get(3)).isInstanceOf(ListenerEvent.Connected.class);
    assertThat(ctx.connection("tak-north")).isNotSameAs(first);
    assertThat(ctx.connection("tak-north").writtenUtf8()).as("a fresh loop").isEqualTo("hello");
  }

  @Test
  void anIdleConnectionEnds() {
    var ctx = cotIn().build();
    var main = recorder(ctx);
    ctx.listeners().start(ListenerSpec.tcp("tak-north", "tak.example.local", 8087).idleTimeout(Duration.ofSeconds(30)), () -> new LineReader(main), main, Event::new);
    ctx.runUntilIdle();
    ctx.advance(Duration.ofSeconds(20));
    ctx.connection("tak-north").feed("x");
    ctx.advance(Duration.ofSeconds(20));
    assertThat(ctx.listeners().connected("tak-north")).as("data arrived 20 s ago").isTrue();
    ctx.advance(Duration.ofSeconds(10));
    assertThat(handled(Event.class).getLast().event()).isInstanceOfSatisfying(ListenerEvent.Disconnected.class, d -> {
      assertThat(d.reason()).contains("idle");
      assertThat(d.retryAt()).isNull();
    });
  }

  @Test
  void aStoppedListenerEndsAndItsNameIsFreeAgain() {
    var ctx = cotIn().build();
    var main = recorder(ctx);
    ListenerRef ref = ctx.listeners().start(ListenerSpec.tcp("tak-north", "tak.example.local", 8087), () -> new LineReader(main), main, Event::new);
    ctx.runUntilIdle();
    ref.stop();
    ctx.runUntilIdle();
    assertThat(handled(Event.class).getLast().event()).isEqualTo(new ListenerEvent.Disconnected("tak-north", ctx.clock(), "stopped", null));
    assertThat(ctx.listeners().names()).isEmpty();
    ctx.listeners().start(ListenerSpec.tcp("tak-north", "tak.example.local", 8087), () -> new LineReader(main));
    ctx.runUntilIdle();
    assertThat(ctx.listeners().connected("tak-north")).isTrue();
  }

  @Test
  void listenersConnectOnlyToEndpointsTheSettingsName() {
    var none = FakePluginContext.builder("cot-in").build();
    assertThatThrownBy(() -> none.listeners().start(ListenerSpec.tcp("tak-north", "tak.example.local", 8087), () -> (c, x) -> {}))
        .hasMessageContaining("network.endpoints");
    var ctx = cotIn().build();
    assertThatThrownBy(() -> ctx.listeners().start(ListenerSpec.tcp("tak-north", "evil.example", 8087), () -> (c, x) -> {}))
        .hasMessageContaining("not an endpoint");
    assertThatThrownBy(() -> ctx.listeners().start(ListenerSpec.tcp("tak-north", "tak.example.local", 8089), () -> (c, x) -> {}))
        .hasMessageContaining("not an endpoint");
  }

  @Test
  void aRemovedEndpointIsNotConnectedAgain() {
    var ctx = cotIn().build();
    var main = recorder(ctx);
    var spec = ListenerSpec.tcp("tak-north", "tak.example.local", 8087).reconnect(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(4)));
    ctx.listeners().start(spec, () -> new LineReader(main), main, Event::new);
    ctx.runUntilIdle();
    ctx.changeSettings(streams("other.example.local", 8087));
    ctx.connection("tak-north").fail("connection reset");
    ctx.advance(Duration.ofSeconds(1));
    assertThat(handled(Event.class).getLast().event()).isInstanceOfSatisfying(ListenerEvent.Disconnected.class, d -> {
      assertThat(d.reason()).contains("not an endpoint");
      assertThat(d.retryAt()).isNull();
    });
    assertThat(ctx.listeners().names()).isEmpty();
  }

  @Test
  void listenersAreCappedAndNamedOnce() {
    var ctx = cotIn().maxListeners(1).build();
    ctx.listeners().start(ListenerSpec.tcp("tak-north", "tak.example.local", 8087), () -> (c, x) -> {});
    assertThatThrownBy(() -> ctx.listeners().start(ListenerSpec.tcp("tak-north", "tak.example.local", 8087), () -> (c, x) -> {}))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> ctx.listeners().start(ListenerSpec.tcp("tak-south", "tak.example.local", 8087), () -> (c, x) -> {}))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void aLoopThatThrowsFailsTheTest() {
    var ctx = cotIn().build();
    ctx.listeners().start(ListenerSpec.tcp("tak-north", "tak.example.local", 8087), () -> (c, x) -> {
      throw new IllegalStateException("bug");
    });
    assertThatThrownBy(ctx::runUntilIdle).isInstanceOf(AssertionError.class).hasMessageContaining("tak-north");
  }

  @Test
  void writesAreSmall() {
    var ctx = cotIn().build();
    var main = recorder(ctx);
    ctx.listeners().start(ListenerSpec.tcp("tak-north", "tak.example.local", 8087), () -> (c, x) -> {
      try {
        c.write(Bytes.of(new byte[ListenerConnection.MAX_WRITE_BYTES + 1]));
      } catch (IllegalArgumentException e) {
        x.send(main, new Line("refused"));
      }
    });
    ctx.runUntilIdle();
    assertThat(handled(Line.class)).containsExactly(new Line("refused"));
  }

  // ---------------------------------------------------------------- review fixes

  @Test
  void stoppingAnEndedListenerLeavesANewOneWithItsNameAlone() {
    var ctx = cotIn().build();
    var main = recorder(ctx);
    ListenerRef old = ctx.listeners().start(ListenerSpec.tcp("tak-north", "tak.example.local", 8087), () -> new LineReader(main), main, Event::new);
    ctx.runUntilIdle();
    ctx.connection("tak-north").close();   // no back-off: the listener ends, and its name is free
    ctx.runUntilIdle();
    ctx.listeners().start(ListenerSpec.tcp("tak-north", "tak.example.local", 8087), () -> new LineReader(main), main, Event::new);
    ctx.runUntilIdle();
    int events = handled(Event.class).size();
    old.stop();
    ctx.runUntilIdle();
    assertThat(ctx.listeners().connected("tak-north")).isTrue();
    assertThat(handled(Event.class)).hasSize(events);
  }

  @Test
  void aFactoryThatThrowsIsALoopThatThrew() {
    var ctx = cotIn().rethrowHandlerErrors(false).build();
    var main = recorder(ctx);
    ctx.listeners().start(ListenerSpec.tcp("tak-north", "tak.example.local", 8087), () -> {
      throw new IllegalStateException("bad parser config");
    }, main, Event::new);
    ctx.runUntilIdle();
    assertThat(ctx.handlerErrors()).singleElement().satisfies(e -> assertThat(e).hasMessage("bad parser config"));
    assertThat(handled(Event.class).getLast().event()).isInstanceOfSatisfying(ListenerEvent.Disconnected.class, d ->
        assertThat(d.reason()).contains("bad parser config"));
  }

  @Test
  void aQueryCanBeScriptedToTimeOutAndSubscriptionsIgnoreTheLimit() {
    var ctx = FakePluginContext.builder("cot-in").dataTypes(COT).build();
    var main = recorder(ctx);
    Layer layer = ctx.store().seedLayer("TAK north");
    for (int i = 0; i < 2; i++) {
      ctx.store().submit(Change.createObject(UUID.randomUUID(), content(layer, "cot-in.cot", "tak-north")), TIMEOUT, main, Outcome::new);
    }
    ctx.store().timeOutNextQuery();
    ctx.store().query(ObjectQuery.all(), TIMEOUT, main, Found::new);
    ctx.store().subscribe(ObjectQuery.all().limit(1), main, Update::new);
    ctx.runUntilIdle();
    assertThat(handled(Found.class)).isEmpty();
    assertThat(((StoreUpdate.Snapshot) handled(Update.class).getFirst().update()).objects()).hasSize(2);
    ctx.advance(TIMEOUT);
    assertThat(handled(Found.class)).singleElement().extracting(Found::result).isEqualTo(new QueryResult.TimedOut());
    assertThat(ctx.outstandingAsks()).isZero();
  }

  @Test
  void onlyTheLatestUndeliveredSettingsAreKept() {
    var ctx = FakePluginContext.builder("cot-in").build();
    var main = recorder(ctx);
    ctx.subscribeSettings(main, Settings::new);
    ctx.changeSettings(JsonObject.of(Map.of("idleSeconds", JsonNumber.of(60))));
    ctx.changeSettings(JsonObject.of(Map.of("idleSeconds", JsonNumber.of(90))));
    ctx.runUntilIdle();
    ctx.changeSettings(JsonObject.of(Map.of("idleSeconds", JsonNumber.of(120))));
    ctx.runUntilIdle();
    assertThat(handled(Settings.class)).extracting(m -> m.values().getNumber("idleSeconds").longValueExact()).containsExactly(90L, 120L);
  }
}
