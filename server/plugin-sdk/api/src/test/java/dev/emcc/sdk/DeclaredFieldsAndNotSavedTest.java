package dev.emcc.sdk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.DeclaredField.Choice;
import dev.emcc.sdk.DeclaredField.Type;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.FieldRef;
import dev.emcc.sdk.model.FieldValue;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Meta;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.store.Change;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** SDK 1.2.0 (CR-0025 parts 4 and 8): declared fields and updates that are not saved, in the API. */
class DeclaredFieldsAndNotSavedTest {

  private static final UUID LAYER = UUID.fromString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e01");
  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final FieldValue CALLSIGN = new FieldValue("cot", "callsign", JsonString.of("ALPHA-1"));

  private static MapObjectContent content() {
    return new MapObjectContent("core.shape", MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, LAYER,
        new Geometry.Point(Position.of(18.0723, 59.3311)), null, null, null, LABEL, Extensions.empty());
  }

  private static MapObject object() {
    var audit = new Meta.Audit(Instant.parse("2026-01-01T00:00:00Z"), Actor.plugin("draw-symbols"));
    return new MapObject(UUID.fromString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e16"), 3, content(), new Meta(audit, audit, null));
  }

  private static Layer layer() {
    var audit = new Meta.Audit(Instant.parse("2026-01-01T00:00:00Z"), Actor.plugin("layer-panel"));
    return new Layer(LAYER, 1, new LayerContent("Own", 1, true, LABEL, Extensions.empty()), new Meta(audit, audit, null));
  }

  @Test
  void aFieldValueIsAStringANumberABooleanOrNull() {
    assertThat(new FieldValue("cot", "remarks", JsonNull.INSTANCE).value()).as("JSON null becomes null").isNull();
    assertThat(CALLSIGN.field()).isEqualTo(new FieldRef("cot", "callsign"));
    assertThat(FieldValue.of(new FieldRef("cot", "staleAfter"), JsonNumber.of(60)).value()).isEqualTo(JsonNumber.of(60));
    assertThatThrownBy(() -> new FieldValue("cot", "callsign", JsonObject.empty())).hasMessageContaining("string, a number, a boolean or null");
    assertThatThrownBy(() -> new FieldValue("cot", "call-sign", JsonString.of("x"))).hasMessageContaining("field name");
  }

  @Test
  void aDeclaredFieldChecksValuesAsTheStoreDoes() {
    var text = new DeclaredField("cot", "callsign", Type.TEXT, "Callsign", null, null, null, null, 5, false, List.of(), true, List.of());
    assertThat(text.problem(JsonString.of("ALPHA"))).isNull();
    assertThat(text.problem(JsonString.of("ALPHA-1"))).contains("too long");
    assertThat(text.problem(JsonNumber.of(1))).contains("text");
    assertThat(text.problem(null)).as("not required: may be removed").isNull();

    var speed = new DeclaredField("simulator", "cruiseSpeed", Type.NUMBER, "Cruise speed", null, "m/s", BigDecimal.ZERO, new BigDecimal("340"), null, true, List.of(), true, List.of());
    assertThat(speed.problem(JsonNumber.of(12.5))).isNull();
    assertThat(speed.problem(JsonNumber.of(-1))).contains("below 0 m/s");
    assertThat(speed.problem(JsonNumber.of(341))).contains("above 340 m/s");
    assertThat(speed.problem(JsonNull.INSTANCE)).as("required").contains("required");
    assertThat(speed.problem(JsonNumber.of("1e999999999"))).as("not finite, as in the web SDK").isEqualTo("Cruise speed must be a number");
    assertThat(speed.problem(JsonNumber.of("-1e999999999"))).as("not finite, below the minimum too").isEqualTo("Cruise speed must be a number");

    var count = DeclaredField.of("simulator", "count", Type.INTEGER, "Count");
    assertThat(count.problem(JsonNumber.of("3.0"))).as("3.0 is whole").isNull();
    assertThat(count.problem(JsonNumber.of(3.5))).contains("whole");
    assertThat(count.problem(JsonNumber.of("1e999999999"))).as("not finite, though whole").isEqualTo("Count must be a number");

    var role = new DeclaredField("cot", "role", Type.CHOICE, "Role", null, null, null, null, null, false,
        List.of(new Choice("team-member", "Team member"), new Choice("hq", "HQ")), true, List.of("core.general"));
    assertThat(role.problem(JsonString.of("hq"))).isNull();
    assertThat(role.problem(JsonString.of("HQ"))).contains("no choice");
    assertThat(role.belongsTo("core.general")).isTrue();
    assertThat(role.belongsTo("cot.cot")).isFalse();
    assertThat(text.belongsTo("cot.cot")).as("no data types: every object").isTrue();

    var hide = DeclaredField.of("cot", "hideInTak", Type.BOOLEAN, "Hide in TAK");
    assertThat(hide.problem(JsonBoolean.TRUE)).isNull();
    assertThat(hide.problem(JsonString.of("yes"))).contains("yes or no");
  }

  @Test
  void aDeclarationIsChecked() {
    assertThatThrownBy(() -> DeclaredField.of("cot", "role", Type.CHOICE, "Role")).hasMessageContaining("choices");
    assertThatThrownBy(() -> new DeclaredField("cot", "callsign", Type.TEXT, "Callsign", null, "m", null, null, null, false, List.of(), false, List.of()))
        .hasMessageContaining("unit");
    assertThatThrownBy(() -> new DeclaredField("cot", "n", Type.NUMBER, "N", null, null, BigDecimal.TEN, BigDecimal.ONE, null, false, List.of(), false, List.of()))
        .hasMessageContaining("minimum is above maximum");
    assertThatThrownBy(() -> new DeclaredField("cot", "n", Type.NUMBER, "N", null, null, null, null, 4, false, List.of(), false, List.of()))
        .hasMessageContaining("maxLength");
    assertThatThrownBy(() -> new DeclaredField("cot", "role", Type.CHOICE, "Role", null, null, null, null, null, false,
        List.of(new Choice("hq", "HQ"), new Choice("hq", "Headquarters")), true, List.of())).hasMessageContaining("twice");
    assertThatThrownBy(() -> DeclaredField.of("cot", "callsign", Type.TEXT, "")).hasMessageContaining("label");
    assertThatThrownBy(() -> new DeclaredField("cot", "n", Type.NUMBER, "N", null, "metres per second", null, null, null, false, List.of(), false, List.of()))
        .hasMessageContaining("unit");
    assertThatThrownBy(() -> new DeclaredField("cot", "n", Type.NUMBER, "N", "", null, null, null, null, false, List.of(), false, List.of()))
        .hasMessageContaining("description");
    assertThatThrownBy(() -> new DeclaredField("cot", "n", Type.NUMBER, "N", null, null, null, null, null, false, List.of(), false, List.of("general")))
        .hasMessageContaining("type names");
    assertThatThrownBy(() -> new DeclaredField("cot", "n", Type.NUMBER, "N", null, null, null, null, null, false, List.of(), false, List.of("core.general", "core.general")))
        .hasMessageContaining("each once");
  }

  @Test
  void onlyObjectCreatesAndUpdatesCarryFields() {
    Change create = Change.createObject(UUID.randomUUID(), content()).withFields(List.of(CALLSIGN));
    assertThat(create.fields()).containsExactly(CALLSIGN);
    assertThat(create.toRequest(UUID.randomUUID(), "draw-symbols").fields()).as("the request carries them").containsExactly(CALLSIGN);
    assertThat(Change.updateObject(object(), content()).withFields(List.of(CALLSIGN)).fields()).containsExactly(CALLSIGN);
    assertThatThrownBy(() -> Change.deleteObject(object()).withFields(List.of(CALLSIGN))).hasMessageContaining("declared fields");
    assertThatThrownBy(() -> Change.updateLayer(layer(), layer().content()).withFields(List.of(CALLSIGN))).hasMessageContaining("declared fields");
    List<FieldValue> tooMany = Collections.nCopies(ChangeRequest.MAX_FIELDS + 1, CALLSIGN);
    assertThatThrownBy(() -> Change.createObject(UUID.randomUUID(), content()).withFields(tooMany)).hasMessageContaining("at most");
  }

  @Test
  void onlyAnObjectUpdateWithoutFieldsCanBeNotSaved() {
    Change move = Change.updateObject(object(), content()).notSaved();
    assertThat(move.saved()).isFalse();
    assertThat(move.bySystem("simulation").saved()).as("the withers keep it").isFalse();
    assertThat(Change.updateObject(object(), content()).saved()).isTrue();
    assertThatThrownBy(() -> Change.createObject(UUID.randomUUID(), content()).notSaved()).hasMessageContaining("object update");
    assertThatThrownBy(() -> Change.deleteObject(object()).notSaved()).hasMessageContaining("object update");
    assertThatThrownBy(() -> Change.updateLayer(layer(), layer().content()).notSaved()).hasMessageContaining("object update");
    assertThatThrownBy(() -> move.withFields(List.of(CALLSIGN))).hasMessageContaining("moves only");
    assertThatThrownBy(() -> Change.updateObject(object(), content()).withFields(List.of(CALLSIGN)).notSaved()).hasMessageContaining("moves only");
  }

  /** ACA note N5: the 1.1.0 constructors stay, with the new components' defaults. */
  @Test
  void theOneOneZeroConstructorsGiveNoFieldsAndSaved() {
    var change = new Change(EntityType.OBJECT, Operation.UPDATE, object().id(), 3L, content(), null, null);
    assertThat(change.fields()).isEmpty();
    assertThat(change.saved()).isTrue();
    var request = new ChangeRequest(UUID.randomUUID(), EntityType.OBJECT, Operation.UPDATE, object().id(), 3L, content(), null, Actor.plugin("cot"));
    assertThat(request.fields()).isEmpty();
    assertThatThrownBy(() -> new ChangeRequest(UUID.randomUUID(), EntityType.LAYER, Operation.UPDATE, LAYER, 1L, layer().content(), null, Actor.plugin("cot"), List.of(CALLSIGN)))
        .hasMessageContaining("declared fields");
  }
}
