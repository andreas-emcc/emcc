package dev.emcc.ecore.store;

import static dev.emcc.ecore.store.Fixtures.DRAW;
import static dev.emcc.ecore.store.Fixtures.LAYERS;
import static dev.emcc.ecore.store.Fixtures.create;
import static dev.emcc.ecore.store.Fixtures.ext;
import static dev.emcc.ecore.store.Fixtures.layer;
import static dev.emcc.ecore.store.Fixtures.symbol;
import static dev.emcc.ecore.store.Fixtures.update;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.DeclaredField;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.FieldRef;
import dev.emcc.sdk.model.FieldValue;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** A change request's declared fields (ADR-0038; CR-0025 part 4): what the store checks, and how it applies them. */
class DeclaredFieldsTest {

  private static final Instant NOW = Instant.parse("2026-10-26T10:00:00.123Z");
  private static final Actor COT = Actor.plugin("cot");
  private static final Actor PANEL = Actor.plugin("object-list");

  /** cot's fields, as its manifest would declare them. */
  private static final List<DeclaredField> COT_FIELDS = List.of(
      new DeclaredField("cot", "callsign", DeclaredField.Type.TEXT, "Callsign", null, null, null, null, 8, false, List.of(), true,
          List.of("cot.track")),
      new DeclaredField("cot", "role", DeclaredField.Type.CHOICE, "Role", null, null, null, null, null, false,
          List.of(new DeclaredField.Choice("hq", "HQ"), new DeclaredField.Choice("team-member", "Team member")), true, List.of()),
      new DeclaredField("cot", "speedLimit", DeclaredField.Type.NUMBER, "Speed limit", null, "m/s", BigDecimal.ZERO, BigDecimal.valueOf(100),
          null, false, List.of(), true, List.of()),
      new DeclaredField("cot", "team", DeclaredField.Type.INTEGER, "Team", null, null, BigDecimal.ONE, null, null, true, List.of(), true,
          List.of()),
      new DeclaredField("cot", "emergency", DeclaredField.Type.BOOLEAN, "Emergency", null, null, null, null, null, false, List.of(), true,
          List.of()),
      DeclaredField.of("cot", "uid", DeclaredField.Type.TEXT, "UID")); // not editable by others

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final PictureState state = new PictureState();
  private final ObjectStore store = new ObjectStore(state, runtime, Clock.fixed(NOW, ZoneOffset.UTC), DataTypes.of(Set.of("cot.track")),
      DeclaredFields.of(COT_FIELDS.stream().map(f -> new DeclaredFields.Field(f.ref(), f.editableByOthers(), f::problem)).toList()),
      new StoreCounts());
  private final UUID layerId = UUID.randomUUID();
  private final UUID objectId = UUID.randomUUID();

  @BeforeEach
  void aLayer() {
    assertThat(store.apply(create(layerId, layer("Units"), LAYERS), Requester.NO_USER)).isInstanceOf(ChangeOutcome.Applied.class);
  }

  @AfterEach
  void close() {
    runtime.close();
  }

  private static ChangeRequest with(ChangeRequest r, FieldValue... fields) {
    return new ChangeRequest(r.requestId(), r.entityType(), r.operation(), r.entityId(), r.baseVersion(), r.data(), r.externalRef(),
        r.source(), List.of(fields));
  }

  private static FieldValue field(String name, Object value) {
    return new FieldValue("cot", name, switch (value) {
      case String s -> JsonString.of(s);
      case Integer n -> JsonNumber.of(n);
      case Double d -> JsonNumber.of(d);
      case Boolean b -> JsonBoolean.of(b);
      default -> throw new IllegalArgumentException(value.toString());
    });
  }

  private MapObject applied(ChangeRequest request) {
    ChangeOutcome outcome = store.apply(request, Requester.NO_USER);
    assertThat(outcome).isInstanceOf(ChangeOutcome.Applied.class);
    return (MapObject) ((ChangeOutcome.Applied) outcome).event().state();
  }

  private ChangeRejection refused(ChangeRequest request, Requester requester) {
    long before = state.sequenceNo();
    MapObject object = state.object(objectId);
    ChangeOutcome outcome = store.apply(request, requester);
    assertThat(outcome).isInstanceOf(ChangeOutcome.Rejected.class);
    assertThat(state.sequenceNo()).as("no number used").isEqualTo(before);
    assertThat(state.object(objectId)).as("nothing changed").isEqualTo(object);
    return ((ChangeOutcome.Rejected) outcome).rejection();
  }

  private ChangeRejection refused(ChangeRequest request) {
    return refused(request, Requester.NO_USER);
  }

  private static JsonObject cot(MapObject object) {
    return object.content().extensions().get("cot");
  }

  @Test
  void aCreateSetsTheFieldsAfterTheContentAndKeepsTheRestOfTheNamespace() {
    MapObjectContent content = symbol(layerId, 15.6, 60.1, ext("cot", "callsign", "OLD"));

    MapObject created = applied(with(create(objectId, content, DRAW), field("callsign", "ALPHA-1"), field("team", 3)));

    assertThat(cot(created)).isEqualTo(JsonObject.of(Map.of("callsign", JsonString.of("ALPHA-1"), "team", JsonNumber.of(3))));
    assertThat(created.content().extensions().namespaces()).containsOnlyKeys("cot");
  }

  @Test
  void aFieldSetThroughAnotherPluginsEditorSurvivesALaterUpdateThatCarriesAnOlderCopy() {
    MapObject created = applied(create(objectId, symbol(layerId, 15.6, 60.1), DRAW));
    // draw-symbols' editor sets cot's callsign; object-list then updates with the content it had before.
    MapObject named = applied(with(update(objectId, created.version(), symbol(layerId, 15.6, 60.1), DRAW), field("callsign", "ALPHA-1")));
    MapObjectContent stale = symbol(layerId, 15.7, 60.2, ext("cot", "callsign", "STALE"));

    MapObject moved = applied(update(objectId, named.version(), stale, PANEL));

    assertThat(cot(moved).getString("callsign")).as("blind forwarding: the older copy is ignored").isEqualTo("ALPHA-1");
  }

  @Test
  void theOwningPluginWritesItsNamespaceAndOthersOnlyNameItsFields() {
    applied(create(objectId, symbol(layerId, 15.6, 60.1), DRAW));
    MapObject own = applied(with(update(objectId, 1, symbol(layerId, 15.6, 60.1, ext("cot", "uid", "ANDROID-1")), COT),
        field("uid", "ANDROID-2"))); // its own field, not editable by others: fine for cot, applied after its namespace

    assertThat(cot(own).getString("uid")).isEqualTo("ANDROID-2");
    ChangeRejection notOthers = refused(with(update(objectId, 2, symbol(layerId, 15.6, 60.1), DRAW), field("uid", "ANDROID-3")));
    assertThat(notOthers.details()).singleElement().satisfies(d -> {
      assertThat(d.path()).isEqualTo("/fields/0");
      assertThat(d.problem()).isEqualTo("cot.uid is not editable by others: only the plugin cot sets it (ADR-0038)");
    });
  }

  @Test
  void nullRemovesAFieldButNotARequiredOne() {
    applied(with(create(objectId, symbol(layerId, 15.6, 60.1), DRAW), field("callsign", "ALPHA-1"), field("team", 3)));
    FieldValue noCallsign = new FieldValue("cot", "callsign", null);
    FieldValue noTeam = new FieldValue("cot", "team", null);

    MapObject without = applied(with(update(objectId, 1, symbol(layerId, 15.6, 60.1), DRAW), noCallsign));
    ChangeRejection required = refused(with(update(objectId, 2, symbol(layerId, 15.6, 60.1), DRAW), noTeam));

    assertThat(cot(without)).isEqualTo(JsonObject.of(Map.of("team", JsonNumber.of(3))));
    assertThat(required.message()).isEqualTo("Team is required");
  }

  @Test
  void anEmptiedNamespaceGoes() {
    applied(with(create(objectId, symbol(layerId, 15.6, 60.1), DRAW), field("callsign", "ALPHA-1")));

    MapObject without = applied(with(update(objectId, 1, symbol(layerId, 15.6, 60.1), DRAW), new FieldValue("cot", "callsign", null)));

    assertThat(without.content().extensions().namespaces()).isEmpty();
  }

  @Test
  void everyFailingFieldIsNamedAtItsIndexAndNothingIsApplied() {
    applied(create(objectId, symbol(layerId, 15.6, 60.1), DRAW));

    ChangeRejection rejection = refused(with(update(objectId, 1, symbol(layerId, 15.6, 60.1), DRAW),
        field("callsign", "TOO-LONG-1"), field("role", "pilot"), field("speedLimit", -1), field("team", 2.5), field("emergency", "yes"),
        field("callsign", "ALPHA-1"), new FieldValue("cot", "unknown", null), new FieldValue("draw-symbols", "route", JsonString.of("r1")),
        field("role", 7), field("speedLimit", 101.5)));

    assertThat(rejection.code()).isEqualTo(ChangeRejection.Code.VALIDATION_FAILED);
    assertThat(rejection.message()).isEqualTo("Callsign is too long");
    assertThat(rejection.details()).extracting(ChangeRejection.Detail::path, ChangeRejection.Detail::problem).containsExactly(
        org.assertj.core.groups.Tuple.tuple("/fields/0", "Callsign is too long"),
        org.assertj.core.groups.Tuple.tuple("/fields/1", "Role has no choice pilot"),
        org.assertj.core.groups.Tuple.tuple("/fields/2", "Speed limit is below 0 m/s"),
        org.assertj.core.groups.Tuple.tuple("/fields/3", "Team must be a whole number"),
        org.assertj.core.groups.Tuple.tuple("/fields/4", "Emergency must be yes or no"),
        org.assertj.core.groups.Tuple.tuple("/fields/5", "cot.callsign is set twice in one request"),
        org.assertj.core.groups.Tuple.tuple("/fields/6", "no loaded plugin declares the field cot.unknown (ADR-0038)"),
        org.assertj.core.groups.Tuple.tuple("/fields/7", "no loaded plugin declares the field draw-symbols.route (ADR-0038)"),
        org.assertj.core.groups.Tuple.tuple("/fields/8", "cot.role is set twice in one request"),
        org.assertj.core.groups.Tuple.tuple("/fields/9", "cot.speedLimit is set twice in one request"));
  }

  @Test
  void thePermissionAndTheContentAreCheckedFirst() {
    ChangeRequest noPermission = with(create(objectId, symbol(layerId, 15.6, 60.1), DRAW), field("callsign", "TOO-LONG-1"));
    ChangeRequest noLayer = with(create(objectId, symbol(UUID.randomUUID(), 15.6, 60.1), DRAW), field("callsign", "TOO-LONG-1"));

    assertThat(refused(noPermission, Requester.user("u-viewer", Set.of())).code()).isEqualTo(ChangeRejection.Code.PERMISSION_DENIED);
    assertThat(refused(noLayer).code()).isEqualTo(ChangeRejection.Code.LAYER_NOT_FOUND);
    assertThat(refused(with(create(objectId, symbol(layerId, 15.6, 60.1), DRAW), field("callsign", "TOO-LONG-1"))).details())
        .extracting(ChangeRejection.Detail::path).containsExactly("/fields/0");
  }

  @Test
  void aCreateSentAgainIsRefusedAsSuchBeforeItsFieldsAreLookedAt() {
    applied(create(objectId, symbol(layerId, 15.6, 60.1), DRAW));

    ChangeRejection again = refused(with(create(objectId, symbol(layerId, 15.6, 60.1), DRAW), field("callsign", "TOO-LONG-1")));

    assertThat(again.code()).isEqualTo(ChangeRejection.Code.ENTITY_EXISTS);
  }

  @Test
  void aProblemThatRepeatsALongValueIsCutToWhatTheRejectionAllows() {
    String value = "x".repeat(600); // a choice value has no limit; the SDK's problem repeats it

    ChangeRejection rejection = refused(with(create(objectId, symbol(layerId, 15.6, 60.1), DRAW), field("role", value)));

    assertThat(rejection.details()).singleElement().satisfies(d -> {
      assertThat(d.problem()).hasSize(ObjectStore.MAX_DETAIL).startsWith("Role has no choice xxx").endsWith("x…");
    });
  }

  @Test
  void theHolderIsFixedOnceAndHoldsEachFieldOnce() {
    DeclaredFields.Field callsign = new DeclaredFields.Field(new FieldRef("cot", "callsign"), true, v -> null);
    DeclaredFields fields = new DeclaredFields();

    assertThat(fields.get(callsign.ref())).as("none until fixed").isNull();
    assertThatThrownBy(() -> new DeclaredFields().fix(List.of(callsign, callsign))).isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("cot.callsign is declared twice");
    fields.fix(List.of(callsign));
    assertThat(fields.get(callsign.ref())).isSameAs(callsign);
    assertThatThrownBy(() -> fields.fix(List.of())).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void theObjectsDataTypeIsNotChecked() {
    // callsign names cot.track; the SDK's editor offers every editable field through its "+".
    MapObject general = applied(with(create(objectId, symbol(layerId, 15.6, 60.1), DRAW), field("callsign", "ALPHA-1")));

    assertThat(general.content().dataType()).isEqualTo(MapObjectContent.GENERAL);
    assertThat(cot(general).getString("callsign")).isEqualTo("ALPHA-1");
  }

  @Test
  void anUpdateThatIsNotSavedCarriesNoFields() {
    MapObject created = applied(create(objectId, symbol(layerId, 15.6, 60.1), DRAW));

    ChangeOutcome outcome = store.apply(with(update(objectId, created.version(), symbol(layerId, 15.7, 60.2), DRAW),
        field("callsign", "ALPHA-1")), Requester.NO_USER, true);

    assertThat(outcome).isInstanceOfSatisfying(ChangeOutcome.Rejected.class, r -> {
      assertThat(r.rejection().message()).isEqualTo(ObjectStore.NOT_SAVED_FIELDS);
      assertThat(r.rejection().details()).extracting(ChangeRejection.Detail::path).containsExactly("/fields");
    });
    assertThat(state.object(objectId)).isEqualTo(created);
  }
}
