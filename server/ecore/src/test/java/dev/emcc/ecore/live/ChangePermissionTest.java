package dev.emcc.ecore.live;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.live.LiveGatewayTest.Browser;
import dev.emcc.ecore.runtime.ManualTime;
import dev.emcc.ecore.runtime.MessageHandler;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.ReplyHandle;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.ecore.store.ChangeOutcome;
import dev.emcc.ecore.store.DataTypes;
import dev.emcc.ecore.store.ObjectStore;
import dev.emcc.ecore.store.PictureSnapshot;
import dev.emcc.ecore.store.PictureState;
import dev.emcc.ecore.store.Requester;
import dev.emcc.ecore.store.StoreMsg;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.FieldValue;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/**
 * Permissions on a browser session's change requests (overview 4.4): checked first, before the
 * schema, ECore's own plugin ids and the limit on waiting requests; refused with {@code
 * PERMISSION_DENIED}, or an error when the request cannot be answered; nothing changes.
 */
class ChangePermissionTest {

  private static final ModelJson JSON = new ModelJson();
  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-14T12:00:00Z"), ZoneOffset.UTC);
  /** A web part's word for itself, and a user it claims: neither counts for permissions. */
  private static final Actor CLAIMED = new Actor("draw-symbols", "mallory", null);

  private static final Requester.User VIEWER = Requester.user("u-viewer", Set.of("settings.admin"));
  private static final Requester.User OBJECTS = Requester.user("u-alice", Set.of(Requester.OBJECTS_EDIT));
  private static final Requester.User LAYERS = Requester.user("u-bob", Set.of(Requester.LAYERS_EDIT));
  private static final Requester.User EDITOR = Requester.user("u-carol", Set.of(Requester.OBJECTS_EDIT, Requester.LAYERS_EDIT));

  private final ManualTime time = new ManualTime();
  private final List<WorkerRuntime> runtimes = new ArrayList<>();
  private final WorkerRuntime runtime = runtime();
  private final WorkerHandle<StoreMsg> store = runtime.owner("core-store").spawn(
      WorkerOptions.<StoreMsg>of("object-store", () -> new ObjectStore(new PictureState(), runtime, CLOCK, new DataTypes())));
  private final LiveGateway gateway = gateway(runtime, store);
  private final UUID layerId = UUID.randomUUID();
  private final UUID objectId = UUID.randomUUID();

  private WorkerRuntime runtime() {
    WorkerRuntime started = WorkerRuntime.start(RuntimeConfig.defaults().time(time));
    runtimes.add(started);
    return started;
  }

  private static LiveGateway gateway(WorkerRuntime runtime, WorkerHandle<StoreMsg> store) {
    return new LiveGateway(runtime, store, JSON, CLOCK, new LiveGateway.Limits(LiveGateway.BATCH_INTERVAL, 100, 10,
        LiveGateway.INBOUND_BUDGET, WorkerOptions.MAX_BUDGET, LiveGateway.DEFAULT_MAX_BUDGET, LiveGateway.MAX_HELD));
  }

  /** A layer and an object in it, made by a plugin's server part. */
  @BeforeEach
  void picture() {
    assertThat(apply(ChangeRequest.create(UUID.randomUUID(), layerId, layer("Tracks"), Actor.plugin("cot"))))
        .isInstanceOf(ChangeOutcome.Applied.class);
    assertThat(apply(ChangeRequest.create(UUID.randomUUID(), objectId, symbol(15.6, 60.1), Actor.plugin("cot"))))
        .isInstanceOf(ChangeOutcome.Applied.class);
  }

  @AfterEach
  void close() {
    runtimes.forEach(WorkerRuntime::close);
  }

  private LiveGateway.LiveSession open(Browser browser, Requester.User user) {
    return open(gateway, browser, user);
  }

  private static LiveGateway.LiveSession open(LiveGateway gateway, Browser browser, Requester.User user) {
    LiveGateway.LiveSession session = gateway.open(user, browser);
    browser.next("welcome");
    return session;
  }

  private LayerContent layer(String name) {
    return new LayerContent(name, 0, true, LABEL, Extensions.empty());
  }

  private MapObjectContent symbol(double lon, double lat) {
    return new MapObjectContent(MapObjectContent.SYMBOL, MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, layerId,
        new Geometry.Point(Position.of(lon, lat)), new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null), null, null,
        LABEL, Extensions.empty());
  }

  /**
   * Every operation on objects and on layers, as a browser would send it (claiming another user):
   * create, update and delete of an object (cot's), create of a layer, update of cot's layer (name,
   * draw order, default visibility), delete of the new layer.
   */
  private List<ChangeRequest> everyKind() {
    UUID mine = UUID.randomUUID();
    return List.of(
        ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), symbol(1, 2), CLAIMED),
        ChangeRequest.update(UUID.randomUUID(), objectId, 1L, symbol(3, 4), CLAIMED),
        ChangeRequest.delete(UUID.randomUUID(), EntityType.OBJECT, objectId, null, CLAIMED),
        ChangeRequest.create(UUID.randomUUID(), mine, layer("Mine"), CLAIMED),
        ChangeRequest.update(UUID.randomUUID(), layerId, 1L, new LayerContent("Renamed", 5, false, LABEL, Extensions.empty()), CLAIMED),
        ChangeRequest.delete(UUID.randomUUID(), EntityType.LAYER, mine, null, CLAIMED));
  }

  private static String changeRequest(ChangeRequest request) {
    return "{\"type\":\"change-request\",\"request\":" + JSON.write(request) + "}";
  }

  private static JsonNode submit(LiveGateway.LiveSession session, Browser browser, ChangeRequest request) {
    session.receive(changeRequest(request));
    JsonNode outcome = browser.next("change-outcome");
    assertThat(outcome.get("requestId").asString()).isEqualTo(request.requestId().toString());
    return outcome;
  }

  /** Asserts a PERMISSION_DENIED rejection of {@code request} and returns its message. */
  private static String assertDenied(JsonNode outcome, ChangeRequest request) {
    assertThat(outcome.get("outcome").asString()).as(outcome.toString()).isEqualTo("rejected");
    JsonNode rejection = outcome.get("rejection");
    assertThat(rejection.get("code").asString()).isEqualTo("PERMISSION_DENIED");
    assertThat(rejection.get("requestId").asString()).isEqualTo(request.requestId().toString());
    assertThat(rejection.get("entityType").asString()).isEqualTo(request.entityType().json());
    assertThat(rejection.get("operation").asString()).isEqualTo(request.operation().json());
    assertThat(rejection.get("entityId").asString()).isEqualTo(request.entityId().toString());
    return rejection.get("message").asString();
  }

  /** Waits until the session has handled everything sent to it so far (its answer to a marker). */
  private static void handled(LiveGateway.LiveSession session, Browser browser) {
    session.receive("{\"type\":\"marker\"}");
    assertThat(browser.next("error").get("message").asString()).contains("marker");
  }

  @Test
  void withoutThePermissionEveryKindOfChangeIsRefusedAndNothingChanges() {
    PictureSnapshot before = snapshot();
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser, VIEWER);

    for (ChangeRequest request : everyKind()) {
      String message = assertDenied(submit(session, browser, request), request);
      assertThat(message).isEqualTo(request.entityType() == EntityType.OBJECT
          ? "changing an object needs the permission objects.edit"
          : "changing a layer needs the permission layers.edit");
    }

    assertThat(snapshot()).as("nothing changed").isEqualTo(before);
  }

  @Test
  void withThePermissionEveryKindOfChangeIsAppliedAsTheSessionsUser() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser, EDITOR);
    for (ChangeRequest request : everyKind()) {
      JsonNode outcome = submit(session, browser, request);
      assertThat(outcome.get("outcome").asString()).as(request.operation() + " " + request.entityType() + ": " + outcome)
          .isEqualTo("applied");
      assertThat(outcome.get("event").get("by").get("user").asString()).isEqualTo("u-carol");
    }
  }

  @Test
  void eachPermissionCoversItsOwnEntityTypeEvenForAPluginsEntities() {
    Browser alice = new Browser();
    LiveGateway.LiveSession objects = open(alice, OBJECTS);
    Browser bob = new Browser();
    LiveGateway.LiveSession layers = open(bob, LAYERS);
    List<ChangeRequest> kinds = everyKind();

    assertThat(submit(objects, alice, kinds.get(1)).get("outcome").asString()).as("cot's object").isEqualTo("applied");
    assertDenied(submit(objects, alice, kinds.get(4)), kinds.get(4));
    assertThat(submit(layers, bob, kinds.get(4)).get("outcome").asString()).as("cot's layer").isEqualTo("applied");
    assertDenied(submit(layers, bob, kinds.get(0)), kinds.get(0));
  }

  @Test
  void aBrowsersDeclaredFieldsAndOtherWorkspacesReachTheStoreAndAreChecked() {
    PictureSnapshot before = snapshot();
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser, EDITOR);
    ChangeRequest create = ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), symbol(1, 2), CLAIMED);
    ChangeRequest withFields = new ChangeRequest(create.requestId(), create.entityType(), create.operation(), create.entityId(), null,
        create.data(), null, CLAIMED, List.of(new FieldValue("cot", "callsign", JsonString.of("ALPHA-1"))));
    ChangeRequest simulation = ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), layer("Exercise").inWorkspace("simulator.simulation"),
        CLAIMED);

    JsonNode fields = submit(session, browser, withFields).get("rejection");
    JsonNode workspace = submit(session, browser, simulation).get("rejection");

    assertThat(fields.get("code").asString()).as("no plugin here declares it").isEqualTo("VALIDATION_FAILED");
    assertThat(fields.at("/details/0/path").asString()).isEqualTo("/fields/0");
    assertThat(fields.at("/details/0/problem").asString()).isEqualTo("no loaded plugin declares the field cot.callsign (ADR-0038)");
    assertThat(workspace.get("code").asString()).as("no plugin here declares it").isEqualTo("VALIDATION_FAILED");
    assertThat(workspace.at("/details/0/path").asString()).isEqualTo("/data/workspace");
    assertThat(workspace.get("message").asString()).isEqualTo("no loaded plugin declares the workspace simulator.simulation (ADR-0039)");
    assertThat(snapshot()).as("nothing changed").isEqualTo(before);
  }

  @Test
  void theNoLoginUserMayChangeEverything() {
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser, Requester.withAllPermissions("local"));
    for (ChangeRequest request : everyKind()) {
      assertThat(submit(session, browser, request).get("outcome").asString()).isEqualTo("applied");
    }
  }

  @Test
  void thePermissionIsCheckedBeforeTheSchemaAndEcoresOwnPluginIds() {
    PictureSnapshot before = snapshot();
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser, OBJECTS);
    UUID requestId = UUID.randomUUID();
    UUID entityId = UUID.randomUUID();

    // A layer the schema refuses (no content at all), from a reserved plugin id.
    session.receive("""
        {"type": "change-request", "request": {"requestId": "%s", "entityType": "layer", "operation": "create",
         "entityId": "%s", "data": {"nonsense": true}, "source": {"plugin": "core"}}}
        """.formatted(requestId, entityId));
    JsonNode outcome = browser.next("change-outcome");
    assertThat(outcome.get("rejection").get("code").asString()).isEqualTo("PERMISSION_DENIED");
    assertThat(outcome.get("rejection").get("entityId").asString()).isEqualTo(entityId.toString());

    ChangeRequest asCore = ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), layer("Core's"), Actor.plugin("core"));
    assertDenied(submit(session, browser, asCore), asCore);

    // With the permission, the same request meets the next checks as before.
    ChangeRequest objectAsCore = ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), symbol(1, 2), Actor.plugin("core"));
    assertThat(submit(session, browser, objectAsCore).get("rejection").get("code").asString()).isEqualTo("VALIDATION_FAILED");
    assertThat(snapshot()).isEqualTo(before);
  }

  @Test
  void thePermissionIsCheckedBeforeTheLimitAndRefusedRequestsDoNotCountTowardIt() {
    WorkerRuntime other = runtime();
    MessageHandler<StoreMsg> silent = (message, context) -> {}; // never answers
    WorkerHandle<StoreMsg> silentStore = other.owner("core-store").spawn(WorkerOptions.<StoreMsg>of("object-store", () -> silent));
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(gateway(other, silentStore), browser, OBJECTS);

    for (int i = 0; i < SessionWorker.MAX_OUTSTANDING + 50; i++) { // refused: they do not count
      ChangeRequest layer = ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), layer("L" + i), CLAIMED);
      assertDenied(submit(session, browser, layer), layer);
    }
    for (int i = 0; i < SessionWorker.MAX_OUTSTANDING; i++) { // all wait for the store
      session.receive(changeRequest(ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), symbol(i % 90, 0), CLAIMED)));
    }
    handled(session, browser); // none was refused as one too many

    ChangeRequest layer = ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), layer("Over"), CLAIMED);
    assertDenied(submit(session, browser, layer), layer); // at the limit: still the permission first
    ChangeRequest object = ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), symbol(5, 5), CLAIMED);
    assertThat(submit(session, browser, object).get("rejection").get("message").asString())
        .startsWith("too many change requests in progress");
  }

  @Test
  void aRefusedRequestThatCannotBeAnsweredGetsAnError() {
    PictureSnapshot before = snapshot();
    Browser browser = new Browser();
    LiveGateway.LiveSession session = open(browser, VIEWER);
    UUID requestId = UUID.randomUUID();

    session.receive("{\"type\":\"change-request\",\"request\":{\"entityType\":\"object\",\"operation\":\"create\",\"entityId\":\""
        + UUID.randomUUID() + "\",\"data\":{}}}");
    JsonNode error = browser.next("error");
    assertThat(error.has("requestId")).isFalse();
    assertThat(error.get("message").asString()).isEqualTo("changing an object needs the permission objects.edit");

    session.receive("{\"type\":\"change-request\",\"request\":{\"requestId\":\"" + requestId + "\",\"entityType\":\"layer\",\"operation\":\"rename\"}}");
    error = browser.next("error");
    assertThat(error.get("requestId").asString()).isEqualTo(requestId.toString());
    assertThat(error.get("message").asString()).isEqualTo("changing a layer needs the permission layers.edit");

    // No entityType to read, or one that is neither: the schema check answers, as without login.
    session.receive("{\"type\":\"change-request\",\"request\":{\"requestId\":\"" + requestId + "\",\"entityType\":\"track\"}}");
    assertThat(browser.next("error").get("message").asString()).startsWith("the change request is not valid");
    assertThat(snapshot()).isEqualTo(before);
  }

  // ---- The store, directly ----------------------------------------------------------------------

  private ChangeOutcome apply(ChangeRequest request) {
    Probe<ChangeOutcome> outcome = new Probe<>();
    store.send(new StoreMsg.Apply(request, Requester.NO_USER, reply(outcome)));
    return outcome.next();
  }

  private PictureSnapshot snapshot() {
    Probe<PictureSnapshot> snapshot = new Probe<>();
    store.send(new StoreMsg.GetSnapshot(reply(snapshot)));
    return snapshot.next();
  }

  private static <T> ReplyHandle<T> reply(Probe<T> probe) {
    return new ReplyHandle<>() {
      @Override
      public String id() {
        return "test";
      }

      @Override
      public void reply(T value) {
        probe.add(value);
      }

      @Override
      public void fail(String reason) {
        throw new AssertionError(reason);
      }
    };
  }
}
