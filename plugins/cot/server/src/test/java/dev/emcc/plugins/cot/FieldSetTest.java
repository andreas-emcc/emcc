package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.cot.codec.CotEvent;
import dev.emcc.plugins.cot.codec.Samples;
import dev.emcc.sdk.DeclaredField;
import dev.emcc.sdk.FieldSet;
import dev.emcc.sdk.RelationKind;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Relation;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.store.Change;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * Brief functions 23 to 25 and criteria 32 to 36 (M5; T-132, T-131; ADR-0050): the field set {@code cot.unit}, the callsign, how and the
 * errors in and out, vessel symbols out, and the channel that names the set.
 */
class FieldSetTest {

  private static final Actor USER = Actor.plugin("draw-symbols");

  @AfterEach
  void closeRigs() {
    Rig.closeAll();
  }

  private static JsonObject cot(MapObject object) {
    return object.content().extensions().get("cot");
  }

  private static String event(String uid, int seconds, String how, String ce, String le, String detail) {
    return "<event version=\"2.0\" uid=\"" + uid + "\" type=\"a-f-G-U-C-I\" how=\"" + how + "\" time=\"" + Samples.clock(seconds) + "\" stale=\""
        + Samples.clock(seconds + 300) + "\"><point lat=\"59.0\" lon=\"18.0\" ce=\"" + ce + "\" le=\"" + le + "\"/><detail>" + detail + "</detail></event>";
  }

  // ---------------------------------------------------------------- criterion 44 (M6, function 30): the data type names its set

  @Test
  void criterion44_theDataTypeNamesItsSetAndTheKitListsIt() {
    var declared = (JsonObject) ((JsonArray) Manifest.read().get("dataTypes")).get(0);
    assertThat(declared.getString("id")).isEqualTo("cot.cot");
    assertThat(((JsonArray) declared.get("fieldSets")).values()).extracting(v -> ((JsonString) v).value()).containsExactly("unit");
    assertThat(Manifest.read().getString("sdkVersion")).isEqualTo("^1.9.0");

    var rig = new Rig("tak-north");
    var type = rig.ctx.dataTypes().stream().filter(t -> t.id().equals("cot.cot")).findFirst().orElseThrow();
    assertThat(type.fieldSets()).containsExactly("cot.unit");
    assertThat(type.manual()).as("a symbol can still be placed by hand as CoT").isTrue();
  }

  @Test
  void criterion44_aNewObjectCarriesTheSetOnceWhetherTheStoreOrThePluginAddsIt() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", event("n1", 0, "m-g", "12.5", "9999999.0", "<contact callsign=\"VIPER 2\"/>"));
    assertThat(rig.object("n1").content().fieldSets()).containsExactly("cot.unit");
  }

  // ---------------------------------------------------------------- criterion 32: the set

  @Test
  void criterion32_theManifestDeclaresTheSetWithTheSevenFieldsAndTheKitListsThem() {
    var set = (JsonObject) ((JsonArray) Manifest.read().get("fieldSets")).get(0);
    assertThat(set.getString("id")).isEqualTo("unit");
    assertThat(set.getString("label")).isEqualTo("CoT unit");
    assertThat(((JsonArray) set.get("fields")).values()).extracting(v -> ((JsonString) v).value())
        .containsExactly("callsign", "team", "role", "staleSeconds", "how", "ce", "le");

    var rig = new Rig("tak-north");
    FieldSet listed = rig.ctx.fieldSets().stream().filter(s -> s.id().equals("cot.unit")).findFirst().orElseThrow();
    assertThat(listed.fields()).containsExactly("callsign", "team", "role", "staleSeconds", "how", "ce", "le");

    // every field is editable by others, belongs to every object, and has the limits the store checks the values against
    assertThat(Manifest.declaredFields()).extracting(DeclaredField::name).contains("callsign", "how", "ce", "le");
    for (DeclaredField field : Manifest.declaredFields()) {
      assertThat(field.editableByOthers()).as(field.name()).isTrue();
      assertThat(field.dataTypes()).as(field.name()).isEmpty();
    }
    DeclaredField ce = field("ce");
    assertThat(ce.type()).isEqualTo(DeclaredField.Type.NUMBER);
    assertThat(ce.unit()).isEqualTo("m");
    assertThat(ce.minimum()).isEqualByComparingTo("0");
    assertThat(ce.maximum()).isEqualByComparingTo("9999999");
    assertThat(field("le").maximum()).isEqualByComparingTo("9999999");
    assertThat(field("callsign").maxLength()).isEqualTo(64);
    assertThat(field("how").maxLength()).isEqualTo(16);
  }

  private static DeclaredField field(String name) {
    return Manifest.declaredFields().stream().filter(f -> f.name().equals(name)).findFirst().orElseThrow();
  }

  @Test
  void criterion32_everyObjectCreatedOrUpdatedFromCoTCarriesTheSet() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", event("u1", 0, "m-g", "12.5", "9999999.0", "<contact callsign=\"VIPER 2\"/>"));
    assertThat(rig.object("u1").content().fieldSets()).containsExactly("cot.unit");
    rig.feed("tak-north", event("u1", 10, "m-g", "12.5", "9999999.0", "<contact callsign=\"VIPER 2\"/>"));
    assertThat(rig.object("u1").version()).as("it was updated").isGreaterThan(1);
    assertThat(rig.object("u1").content().fieldSets()).as("once, not twice").containsExactly("cot.unit");
  }

  @Test
  void criterion32_anObjectMadeBeforeM5GetsTheSetAtItsNextEventAndKeepsItsRelations() {
    var kind = new RelationKind("sim.follows", "Follows", RelationKind.Line.of("#ff8800"), true);
    var rig = new Rig(false, b -> b.relationKinds(kind), "tak-north");
    rig.feed("tak-north", event("u1", 0, "m-g", "12.5", "9999999.0", "<contact callsign=\"VIPER 2\"/>"));
    MapObject made = rig.object("u1");
    // an object of an earlier release: no set; and one relation another plugin has put on it
    Relation relation = new Relation("sim.follows", UUID.randomUUID());
    var before = new MapObject(made.id(), made.version(), made.content().withFieldSets(List.of()).withRelations(List.of(relation)), made.meta());
    rig.ctx.store().seed(before);
    rig.ctx.store().gap();
    rig.ctx.runUntilIdle();
    assertThat(rig.object("u1").content().fieldSets()).isEmpty();

    rig.feed("tak-north", event("u1", 10, "m-g", "12.5", "9999999.0", "<contact callsign=\"VIPER 2\"/>"));
    MapObjectContent after = rig.object("u1").content();
    assertThat(after.fieldSets()).containsExactly("cot.unit");
    assertThat(after.relations()).as("an update replaces the relations: the stored one is carried over").containsExactly(relation);
  }

  // ---------------------------------------------------------------- criterion 33: callsign, how and ce in

  @Test
  void criterion33_theCallsignHowAndCeOfAnEventAreTheSetsValues() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", event("u1", 0, "m-g", "12.5", "7.0", "<contact callsign=\"VIPER 2\"/>"));
    MapObject object = rig.object("u1");
    JsonObject ext = cot(object);
    assertThat(ext.getString("callsign")).isEqualTo("VIPER 2");
    assertThat(object.content().properties().name()).as("the Name too").isEqualTo("VIPER 2");
    assertThat(ext.getString("how")).isEqualTo("m-g");
    assertThat(((JsonNumber) ext.get("ce")).text()).isEqualTo("12.5");
    assertThat(((JsonNumber) ext.get("le")).text()).isEqualTo("7.0");

    // an event without a callsign leaves the field as it was
    rig.feed("tak-north", event("u1", 10, "m-g", "12.5", "7.0", ""));
    assertThat(cot(rig.object("u1")).getString("callsign")).isEqualTo("VIPER 2");
  }

  @Test
  void criterion33_aValueTheDeclaredFieldDoesNotTakeIsLeftOutAndTheObjectIsStillStored() {
    var rig = new Rig("tak-north");
    String longCallsign = "C".repeat(70);
    rig.feed("tak-north", event("u1", 0, "h-g-i-g-o-with-a-long-tail", "10000000", "-1", "<contact callsign=\"" + longCallsign + "\"/>"));
    MapObject object = rig.object("u1"); // the object is there; only the values the declared fields do not take are not in the set
    JsonObject ext = cot(object);
    assertThat(ext.get("how")).as("17 or more characters").isNull();
    assertThat(ext.get("ce")).as("above 9 999 999").isNull();
    assertThat(ext.get("le")).as("below 0").isNull();
    assertThat(ext.get("callsign")).as("more than 64 characters").isNull();
    assertThat(object.content().properties().name()).as("the Name still has it").isEqualTo(longCallsign);
    assertThat(ext.getString("detail")).as("and the raw detail").contains(longCallsign);
  }

  @Test
  void aCallsignEditedThroughTheSetIsKeptUntilTheNextEventThatNamesOne() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", event("u1", 0, "m-g", "12.5", "7.0", "<contact callsign=\"VIPER 2\"/>"));
    MapObject object = rig.object("u1");
    rig.ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.updateObject(object, object.content())
        .withFields(List.of(new dev.emcc.sdk.model.FieldValue("cot", "callsign", JsonString.of("COBRA")))));
    rig.ctx.runUntilIdle();
    assertThat(cot(rig.object("u1")).getString("callsign")).isEqualTo("COBRA");
    rig.feed("tak-north", event("u1", 10, "m-g", "12.5", "7.0", ""));
    assertThat(cot(rig.object("u1")).getString("callsign")).as("an event without a callsign does not take it back").isEqualTo("COBRA");
    rig.feed("tak-north", event("u1", 20, "m-g", "12.5", "7.0", "<contact callsign=\"VIPER 3\"/>"));
    assertThat(cot(rig.object("u1")).getString("callsign")).as("the next event that names one wins (brief function 5)").isEqualTo("VIPER 3");
  }

  // ---------------------------------------------------------------- criterion 34: callsign, how and ce out

  private static MapObjectContent track(Rig rig, UUID layer, String dataSource, String name, JsonObject cot) {
    return new MapObjectContent("core.symbol", "core.general", dataSource, null, layer, new Geometry.Point(Position.of(11.9746, 57.7089)),
        new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null), null, new ObjectProperties(name, null), rig.ctx.defaultLabel(),
        cot == null ? Extensions.empty() : Extensions.empty().with("cot", cot));
  }

  private static void send(Rig rig, String link, ChannelItem item) {
    rig.ctx.channels().deliver(new ChannelId("cot", link), item);
    rig.ctx.runUntilIdle();
  }

  @Test
  void criterion34_aTrackSentThroughAChannelGoesOutWithItsCallsignElseItsName() {
    var rig = new Rig();
    rig.addOutLink("tak-out", "out", List.of(), "");
    UUID layer = UUID.randomUUID();
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), track(rig, layer, "sim", "Alpha HQ", JsonObject.builder().put("callsign", JsonString.of("ALPHA 6")).build())));
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), track(rig, layer, "sim", "Alpha HQ", null)));
    List<CotEvent> sent = rig.awaitSent("tak-out", 2);
    assertThat(sent.get(0).callsign()).as("the Callsign first").isEqualTo("ALPHA 6");
    assertThat(sent.get(1).callsign()).as("without one, the Name").isEqualTo("Alpha HQ");
    assertThat(sent.get(0).lon()).isEqualTo(11.9746); // longitude, latitude: they differ
    assertThat(sent.get(0).lat()).isEqualTo(57.7089);
  }

  @Test
  void criterion34_aManualSymbolGoesOutWithItsHowAndErrorsElseWithTheDefaults() {
    var rig = new Rig();
    var layer = rig.ctx.store().seedLayer("Own forces");
    rig.ctx.store().gap();
    rig.ctx.runUntilIdle();
    rig.addOutLink("tak-out", "out", List.of(layer), "");
    JsonObject own = JsonObject.builder().put("how", JsonString.of("m-g")).put("ce", JsonNumber.of(12.5)).put("le", JsonNumber.of(3)).build();
    rig.ctx.store().applyAs(USER, Change.createObject(UUID.randomUUID(), track(rig, layer.id(), "manual", "WITH", own)));
    rig.ctx.runUntilIdle();
    rig.ctx.store().applyAs(USER, Change.createObject(UUID.randomUUID(), track(rig, layer.id(), "manual", "WITHOUT", null)));
    rig.ctx.runUntilIdle();
    List<CotEvent> sent = rig.awaitSent("tak-out", 2);
    CotEvent with = sent.stream().filter(e -> "WITH".equals(e.callsign())).findFirst().orElseThrow();
    CotEvent without = sent.stream().filter(e -> "WITHOUT".equals(e.callsign())).findFirst().orElseThrow();
    assertThat(with.how()).isEqualTo("m-g");
    assertThat(with.ce()).isEqualTo("12.5");
    assertThat(with.le()).isEqualTo("3");
    assertThat(without.how()).isEqualTo("h-e");
    assertThat(without.ce()).isEqualTo("9999999.0");
    assertThat(without.le()).isEqualTo("9999999.0");
  }

  // ---------------------------------------------------------------- criterion 35: vessels out

  private static MapObjectContent vessel(Rig rig, UUID layer, Symbol symbol, String name) {
    return new MapObjectContent("core.symbol", "ais.ais", "vernon", null, layer, new Geometry.Point(Position.of(11.8512, 57.6934)), symbol, null,
        new ObjectProperties(name, null), rig.ctx.defaultLabel(), Extensions.empty());
  }

  @Test
  void criterion35_aVesselGoesOutAsASurfaceUnitOfItsIdentityAtItsPosition() {
    var rig = new Rig();
    rig.addOutLink("tak-out", "out", List.of(), "");
    UUID layer = UUID.randomUUID();
    Modifiers moving = Modifiers.builder().direction(212.5).speed(6.4).build();
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), vessel(rig, layer, Symbol.vessel(Symbol.IDENTITY_NEUTRAL, 70, moving), "STENA GERMANICA")));
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), vessel(rig, layer, Symbol.vessel(Symbol.IDENTITY_HOSTILE, 70, null), "RAIDER")));
    List<CotEvent> sent = rig.awaitSent("tak-out", 2);
    CotEvent neutral = sent.get(0);
    assertThat(neutral.type()).isEqualTo("a-n-S");
    assertThat(neutral.callsign()).isEqualTo("STENA GERMANICA");
    assertThat(neutral.lon()).isEqualTo(11.8512); // longitude, latitude: they differ
    assertThat(neutral.lat()).isEqualTo(57.6934);
    assertThat(neutral.course()).isEqualTo(212.5);
    assertThat(sent.get(1).type()).as("identity 6").isEqualTo("a-h-S");
  }

  @Test
  void criterion35_everyIdentityDigitHasItsAffiliationAndTheContextIsNotSent() {
    var rig = new Rig();
    rig.addOutLink("tak-out", "out", List.of(), "");
    UUID layer = UUID.randomUUID();
    String[] affiliations = {"p", "u", "a", "f", "n", "s", "h"};
    for (int identity = 0; identity < 7; identity++) {
      int context = identity % 3; // reality, exercise and simulation all go out the same
      send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), vessel(rig, layer, Symbol.vessel(context, identity, 70, null), "V" + identity)));
    }
    List<CotEvent> sent = rig.awaitSent("tak-out", 7);
    for (int identity = 0; identity < 7; identity++) {
      assertThat(sent.get(identity).type()).as("identity " + identity).isEqualTo("a-" + affiliations[identity] + "-S");
    }
  }

  // ---------------------------------------------------------------- criterion 36: the channel

  @Test
  void criterion36_theChannelNamesTheSetAndKeepsItsFields() {
    var rig = new Rig();
    rig.addOutLink("tak-out", "out", List.of(), "");
    var info = rig.ctx.channels().offered().stream().filter(c -> c.id().equals(new ChannelId("cot", "tak-out"))).findFirst().orElseThrow();
    assertThat(info.fieldSet()).isEqualTo("cot.unit");
    assertThat(info.fields()).as("function 15's fields stay until the simulator reads the set").isNotEmpty();
  }
}
