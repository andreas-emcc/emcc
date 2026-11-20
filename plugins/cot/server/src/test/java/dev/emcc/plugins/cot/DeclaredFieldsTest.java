package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.cot.codec.CotGroup;
import dev.emcc.plugins.cot.codec.CotXml;
import dev.emcc.plugins.cot.codec.Samples;
import dev.emcc.sdk.DeclaredField;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.FieldValue;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.store.Change;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Brief function 16 and acceptance criterion 21, for what a link receives: the declared fields {@code team} and {@code role}. */
class DeclaredFieldsTest {

  @AfterEach
  void closeRigs() {
    Rig.closeAll();
  }

  private static String event(String uid, int seconds, String detail) {
    return "<event version=\"2.0\" uid=\"" + uid + "\" type=\"a-f-G-U-C-I\" how=\"m-g\" time=\"" + dev.emcc.plugins.cot.codec.Samples.clock(seconds)
        + "\" stale=\"" + dev.emcc.plugins.cot.codec.Samples.clock(seconds + 300) + "\"><point lat=\"59.0\" lon=\"18.0\"/><detail>" + detail + "</detail></event>";
  }

  private static JsonObject cot(MapObject object) {
    return object.content().extensions().get("cot");
  }

  @Test
  void theManifestDeclaresTeamAndRoleWithTAKsOwnValues() {
    JsonArray fields = (JsonArray) Manifest.read().get("fields");
    assertThat(fields.size()).as("team, role, staleSeconds and (M5) callsign, how, ce, le").isEqualTo(7);
    var team = (JsonObject) fields.get(0);
    var role = (JsonObject) fields.get(1);
    assertThat(team.getString("name")).isEqualTo("team");
    assertThat(role.getString("name")).isEqualTo("role");
    assertThat(values(team)).as("the code and the manifest list the same teams").isEqualTo(CotGroup.TEAMS);
    assertThat(values(role)).as("the code and the manifest list the same roles").isEqualTo(CotGroup.ROLES);
    for (var field : List.of(team, role)) {
      assertThat(field.getBoolean("editableByOthers")).isTrue();
      assertThat(field.get("dataTypes")).as("they belong to every object").isNull();
      for (var choice : ((JsonArray) field.get("choices")).values()) {
        assertThat(((JsonObject) choice).getString("label")).as("the label is the value").isEqualTo(((JsonObject) choice).getString("value"));
      }
    }
  }

  private static List<String> values(JsonObject field) {
    return ((JsonArray) field.get("choices")).values().stream().map(c -> ((JsonObject) c).getString("value")).toList();
  }

  @Test
  void criterion21_aReceivedGroupSetsTeamAndRole() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.UNIT); // __group name="Cyan" role="Team Member"
    JsonObject ext = cot(rig.object("ANDROID-358240051111110"));
    assertThat(ext.getString("team")).isEqualTo("Cyan");
    assertThat(ext.getString("role")).isEqualTo("Team Member");
    assertThat(ext.getString("detail")).as("the raw detail keeps the group too").contains("<__group name=\"Cyan\" role=\"Team Member\"/>");
  }

  @Test
  void aValueOutsideTheChoicesStaysOnlyInTheRawDetail() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", event("u1", 0, "<__group name=\"Chartreuse\" role=\"Team Lead\"/>"));
    JsonObject ext = cot(rig.object("u1"));
    assertThat(ext.get("team")).isNull();
    assertThat(ext.getString("role")).isEqualTo("Team Lead");
    assertThat(ext.getString("detail")).contains("Chartreuse");
  }

  @Test
  void anEventWithoutAGroupLeavesBothFieldsAsTheyAre() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", event("u1", 0, "<__group name=\"Red\" role=\"HQ\"/>"));
    rig.feed("tak-north", event("u1", 10, "<contact callsign=\"X\"/>"));
    JsonObject ext = cot(rig.object("u1"));
    assertThat(ext.getString("team")).isEqualTo("Red");
    assertThat(ext.getString("role")).isEqualTo("HQ");
  }

  @Test
  void aNewGroupChangesTheFields() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", event("u1", 0, "<__group name=\"Red\" role=\"HQ\"/>"));
    rig.feed("tak-north", event("u1", 10, "<__group name=\"Blue\" role=\"Medic\"/>"));
    JsonObject ext = cot(rig.object("u1"));
    assertThat(ext.getString("team")).isEqualTo("Blue");
    assertThat(ext.getString("role")).isEqualTo("Medic");
  }

  /** The two fields as the object store of the test kit knows them from the manifest. */
  private static List<DeclaredField> declared() {
    return List.of(choice("team", "Team", CotGroup.TEAMS), choice("role", "Role", CotGroup.ROLES));
  }

  private static DeclaredField choice(String name, String label, List<String> values) {
    return new DeclaredField("cot", name, DeclaredField.Type.CHOICE, label, null, null, null, null, null, false,
        values.stream().map(v -> new DeclaredField.Choice(v, v)).toList(), true, List.of());
  }

  @Test
  void aValueAnotherPluginsEditorSetKeepsAfterTheNextEvent() {
    var rig = new Rig(false, b -> b.declaredFields(declared().toArray(new DeclaredField[0])), "tak-north");
    rig.feed("tak-north", event("u1", 0, "<contact callsign=\"X\"/>"));
    MapObject object = rig.object("u1");
    // The "+" of an editor sets a declared field with a change request's fields: the object store writes it into the cot extension.
    rig.ctx.store().applyAs(Actor.plugin("draw-symbols"),
        Change.updateObject(object, object.content()).withFields(List.of(new FieldValue("cot", "team", JsonString.of("Green")))));
    rig.ctx.runUntilIdle();
    assertThat(cot(rig.object("u1")).getString("team")).isEqualTo("Green");

    rig.feed("tak-north", event("u1", 10, "<contact callsign=\"X\"/>"));
    assertThat(cot(rig.object("u1")).getString("team")).as("not lost when an event rewrites the extension").isEqualTo("Green");
    rig.feed("tak-north", event("u1", 20, "<__group name=\"Red\"/>"));
    assertThat(cot(rig.object("u1")).getString("team")).as("a received group wins over the edit").isEqualTo("Red");
  }

  private static CotGroup groupOf(String detail) throws Exception {
    return new CotXml().parse("<event uid=\"g\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"/><detail>" + detail + "</detail></event>").group();
  }

  @Test
  void theGroupIsTheDirectChildOfTheDetailAndNothingElse() throws Exception {
    assertThat(groupOf("<contact callsign=\"Red\"/>")).isNull();
    assertThat(groupOf("<__group name='Dark Blue' role='K9'/>")).isEqualTo(new CotGroup("Dark Blue", "K9"));
    assertThat(groupOf("<__group role=\"RTO\" name=\"Teal\"/>")).isEqualTo(new CotGroup("Teal", "RTO"));
    assertThat(groupOf("<__group name=\"R&#101;d\"/>")).as("the parser resolves the reference: it is Red").isEqualTo(new CotGroup("Red", null));
    assertThat(groupOf("<__group name=\"Chartreuse\" role=\"Medic\"/>")).isEqualTo(new CotGroup(null, "Medic"));
    assertThat(groupOf("<__group data-name=\"Red\"/>")).isNull();
    // what is not an element of the detail's own is not read
    assertThat(groupOf("<!-- <__group name=\"Red\" role=\"HQ\"/> --><__group name=\"Blue\"/>")).isEqualTo(new CotGroup("Blue", null));
    assertThat(groupOf("<![CDATA[<__group name=\"Red\"/>]]>")).isNull();
    assertThat(groupOf("<outer><__group name=\"Red\"/></outer>")).isNull();
    assertThat(groupOf("<remarks>&lt;__group name=\"Red\"/&gt;</remarks>")).isNull();
  }
}
