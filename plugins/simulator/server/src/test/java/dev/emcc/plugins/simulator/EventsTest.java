package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.ONE_LEG;
import static dev.emcc.plugins.simulator.Routes.TWO_LEGS;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.DeclaredField;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.TextModifier;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Events at route points (brief function 13; criteria 10 and 11; Q8, Q9, A17 to A19). */
class EventsTest {

  private static final String FAST = "{\"speed\": 1000}";
  private static final String SET_NAME = "{\"kind\": \"set\", \"core\": {\"name\": \"Passed\", \"texts\": {\"uniqueDesignation\": \"P1\"}}}";
  private static final DeclaredField TEAM = new DeclaredField("cot", "team", DeclaredField.Type.TEXT, "Team", null, null, null, null, null,
      false, List.of(), true, List.of());
  private static final DeclaredField ROLE = new DeclaredField("cot", "role", DeclaredField.Type.TEXT, "Role", null, null, null, null, null,
      false, List.of(), false, List.of());

  private Rig rig = new Rig();

  /** When a track at 1 000 m/s reaches TWO_LEGS' middle point. */
  private static double middle() {
    return Routes.plan(TWO_LEGS, "{\"points\": [" + FAST + ", " + FAST + ", " + FAST + "]}").arrivalSeconds(1);
  }

  private static String points(String eventsAtStart, String eventsInTheMiddle) {
    return "[{\"speed\": 1000, \"events\": [" + eventsAtStart + "]}, {\"speed\": 1000, \"events\": [" + eventsInTheMiddle + "]}, " + FAST + "]";
  }

  private MapObjectContent content(UUID id) {
    return rig.object(id).content();
  }

  private String name(UUID id) {
    return content(id).properties().name();
  }

  private boolean lastWriteSaved(UUID id) {
    List<ChangeRequest> all = rig.ctx.store().requests().stream().filter(r -> r.entityId().equals(id)).toList();
    return !all.isEmpty() && !rig.ctx.store().unsaved().contains(all.getLast());
  }

  @Test
  @DisplayName("Criterion 10: \"change a field\" fires as the object passes the point, saved; reset restores what it changed (Q8)")
  void changeAFieldAndReset() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, points("", SET_NAME)));
    rig.started();
    rig.control(route, "start");
    rig.seconds((int) Math.floor(middle()));
    assertThat(name(track)).isEqualTo("Track");
    rig.seconds(1);
    assertThat(name(track)).isEqualTo("Passed");
    assertThat(content(track).symbol().modifiers().text(TextModifier.UNIQUE_DESIGNATION)).isEqualTo("P1");
    assertThat(lastWriteSaved(track)).isTrue();
    // What a reset restores is on the track, written with the change (Q8): the old name, and no designation.
    JsonObject restore = rig.extension(track).getObject(Effects.RESTORE);
    assertThat(restore.getObject("core").get("name")).isEqualTo(JsonString.of("Track"));
    assertThat(restore.getObject("texts").get("uniqueDesignation")).isEqualTo(dev.emcc.sdk.json.JsonNull.INSTANCE);
    rig.seconds(2);
    assertThat(rig.ctx.pluginStatus().detail()).contains("events fired 1, refused 0");

    rig.control(route, "reset");
    assertThat(name(track)).isEqualTo("Track");
    assertThat(content(track).symbol().modifiers().text(TextModifier.UNIQUE_DESIGNATION)).isNull();
    assertThat(content(track).extensions().get(Manifest.id())).as("nothing left of the simulator's on the track").isNull();
  }

  @Test
  @DisplayName("A13: an event at the first point fires as each object leaves it, not before")
  void anEventAtTheFirstPoint() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, points(SET_NAME, "")));
    rig.started();
    rig.seconds(3);
    assertThat(name(track)).isEqualTo("Track");
    rig.control(route, "start");
    rig.seconds(1);
    assertThat(name(track)).isEqualTo("Passed");
  }

  @Test
  @DisplayName("Criterion 10: another plugin's declared field changes through withFields, and a reset removes it again")
  void aDeclaredField() {
    rig = new Rig(TEAM, ROLE);
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    String set = "{\"kind\": \"set\", \"fields\": [{\"plugin\": \"cot\", \"name\": \"team\", \"value\": \"Cyan\"}]}";
    UUID route = rig.route(TWO_LEGS, Rig.single(track, points(set, "")));
    rig.started();
    rig.control(route, "start");
    rig.seconds(1);
    assertThat(content(track).extensions().get("cot").get("team")).isEqualTo(JsonString.of("Cyan"));
    assertThat(rig.ctx.store().requests().stream().filter(r -> r.entityId().equals(track)).anyMatch(r -> !r.fields().isEmpty())).isTrue();
    rig.control(route, "reset");
    JsonObject cot = content(track).extensions().get("cot");
    assertThat(cot == null || !cot.has("team")).isTrue();
  }

  @Test
  @DisplayName("A18: a field the store refuses (not editable by others) is counted, not tried again; the track moves on")
  void aRefusedField() {
    rig = new Rig(TEAM, ROLE);
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    String set = "{\"kind\": \"set\", \"fields\": [{\"plugin\": \"cot\", \"name\": \"role\", \"value\": \"HQ\"}]}";
    UUID route = rig.route(TWO_LEGS, Rig.single(track, points(set, "")));
    rig.started();
    rig.control(route, "start");
    rig.seconds(4);
    assertThat(rig.ctx.pluginStatus().detail()).contains("events fired 1, refused 1");
    assertThat(Geodesy.inverse(TWO_LEGS.getFirst(), rig.position(track)).distanceMetres()).isGreaterThan(2_000);
  }

  @Test
  @DisplayName("Criterion 10, Q9: \"hide\" stops the object, marks it, sends a removal; the route still ends; reset shows it again")
  void hide() {
    UUID hidden = rig.symbol(TWO_LEGS.getFirst());
    UUID other = rig.symbol(TWO_LEGS.getFirst());
    String hide = "{\"kind\": \"hide\", \"objects\": [\"" + hidden + "\"]}";
    String extension = "{\"points\": " + points("", hide) + ", \"groups\": [{\"kind\": \"single\", \"objects\": [{\"id\": \"" + hidden
        + "\"}]}, {\"kind\": \"single\", \"objects\": [{\"id\": \"" + other + "\"}]}]}";
    UUID route = rig.route(TWO_LEGS, extension);
    rig.started();
    rig.chooseTak();
    rig.control(route, "start");
    rig.seconds((int) Math.ceil(middle()));
    Position stopped = rig.position(hidden);
    assertThat(Effects.hidden(content(hidden), Manifest.id())).isTrue();
    assertThat(content(hidden).symbol().modifiers().speed()).isZero();
    assertThat(content(other).properties().name()).as("the event names only one object").isEqualTo("Track");
    List<ChannelItem> sent = rig.sentToTak();
    int removal = sent.indexOf(new ChannelItem.Removal(hidden));
    assertThat(removal).isNotNegative();
    rig.seconds(50); // the route is 80 km long
    assertThat(rig.position(hidden)).isEqualTo(stopped);
    assertThat(rig.sentToTak().subList(removal + 1, rig.sentToTak().size())).noneMatch(i -> i.id().equals(hidden));
    // The other one arrived; the hidden one counts as arrived (Q9).
    assertThat(rig.get("/routes/" + route).reply().body().toUtf8()).contains("\"state\":\"ended\"");

    rig.control(route, "reset");
    assertThat(Effects.hidden(content(hidden), Manifest.id())).isFalse();
    assertThat(rig.position(hidden)).isEqualTo(TWO_LEGS.getFirst());
  }

  @Test
  @DisplayName("Criterion 10, Q18: put on a route again, a hidden object is shown and sent again")
  void putOnAgainShows() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, points("{\"kind\": \"hide\"}", "")));
    rig.started();
    rig.chooseTak();
    rig.control(route, "start");
    rig.seconds(2);
    assertThat(Effects.hidden(content(track), Manifest.id())).isTrue();
    rig.putOnRoute(route, "single", "", track);
    assertThat(Effects.hidden(content(track), Manifest.id())).isFalse();
    int before = rig.sentToTak().size();
    rig.seconds(1);
    // The event at the first point hides it again as it leaves; until then it is sent.
    assertThat(rig.sentToTak().subList(before, rig.sentToTak().size())).anyMatch(i -> i.id().equals(track));
  }

  @Test
  @DisplayName("A hide the store refuses (the object changed meanwhile) goes with the write when it is tried again")
  void aRefusedHideIsTriedAgain() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, points("{\"kind\": \"hide\"}", "")));
    rig.started();
    rig.control(route, "start");
    rig.ctx.store().rejectNext(dev.emcc.sdk.model.ChangeRejection.Code.VALIDATION_FAILED, "changed meanwhile");
    rig.seconds(1);
    assertThat(Effects.hidden(content(track), Manifest.id())).isFalse();
    rig.seconds(1);
    assertThat(Effects.hidden(content(track), Manifest.id())).isTrue();
    assertThat(rig.ctx.pluginStatus().detail()).contains("events fired 1, refused 0");
  }

  @Test
  @DisplayName("An event's change whose answer is lost is written again")
  void aLostEventWriteIsWrittenAgain() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, points(SET_NAME, "")));
    rig.started();
    rig.control(route, "start");
    rig.ctx.store().dropNextRequest();
    rig.seconds(1);
    assertThat(name(track)).isEqualTo("Track");
    rig.seconds(3);
    assertThat(name(track)).isEqualTo("Passed");
  }

  @Test
  @DisplayName("Criterion 20 (amended), Q8: after a crash, the hidden mark and what a reset restores are still on the track; the reset brings back the first value, and an absent field is absent again")
  void hiddenAndRestoreSurviveACrash() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, points(SET_NAME + ", {\"kind\": \"hide\"}", "")));
    rig.started();
    rig.chooseTak();
    rig.control(route, "start");
    rig.seconds(3);
    rig.ctx.store().restart();
    rig.ctx.restart(rig.engine());
    rig.ctx.runUntilIdle();
    assertThat(Effects.hidden(content(track), Manifest.id())).isTrue();
    assertThat(name(track)).isEqualTo("Passed");
    rig.control(route, "start");
    int before = rig.sentToTak().size();
    rig.seconds(2);
    assertThat(rig.sentToTak().subList(before, rig.sentToTak().size())).noneMatch(i -> i.id().equals(track));
    rig.control(route, "reset");
    assertThat(name(track)).isEqualTo("Track");
    assertThat(content(track).symbol().modifiers().text(TextModifier.UNIQUE_DESIGNATION)).isNull();
    assertThat(Effects.hidden(content(track), Manifest.id())).isFalse();
  }

  @Test
  @DisplayName("A hidden object gets no more events, also none later at the same point")
  void noEventsAfterAHide() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, points("{\"kind\": \"hide\"}, " + SET_NAME, "")));
    rig.started();
    rig.control(route, "start");
    rig.seconds(2);
    assertThat(name(track)).isEqualTo("Track");
    assertThat(rig.ctx.pluginStatus().detail()).contains("events fired 1,");
  }

  @Test
  @DisplayName("Criterion 9, A17: a formation's objects pass a point in the order of their places along the route")
  void aFormationPassesInOrder() {
    double azimuth = Geodesy.inverse(TWO_LEGS.get(0), TWO_LEGS.get(1)).initialAzimuth();
    Position centre = Position.of(17.0, 58.0);
    UUID ahead = rig.symbol(Geodesy.direct(centre, azimuth, 500));
    UUID behind = rig.symbol(Geodesy.direct(centre, azimuth + 180, 500));
    String slow = "{\"speed\": 100}";
    UUID route = rig.route(TWO_LEGS, "{\"points\": [" + slow + ", {\"speed\": 100, \"events\": [" + SET_NAME + "]}, " + slow + "]}");
    rig.started();
    rig.putOnRoute(route, "formation", "", ahead, behind);
    rig.control(route, "start");
    double arrive = Routes.plan(TWO_LEGS, "{\"points\": [" + slow + ", " + slow + ", " + slow + "]}").arrivalSeconds(1);
    rig.seconds((int) Math.ceil(arrive));
    assertThat(name(ahead)).isEqualTo("Passed");
    assertThat(name(behind)).isEqualTo("Track");
    rig.seconds(6);
    assertThat(name(behind)).isEqualTo("Passed");
  }

  @Test
  @DisplayName("Criterion 11: \"restart\" at the end fires the events again")
  void restartFiresAgain() {
    UUID track = rig.symbol(ONE_LEG.getFirst());
    String extension = "{\"points\": [" + FAST + ", {\"speed\": 1000, \"events\": [" + SET_NAME + "]}], \"end\": \"restart\", "
        + "\"groups\": [{\"kind\": \"single\", \"objects\": [{\"id\": \"" + track + "\"}]}]}";
    UUID route = rig.route(ONE_LEG, extension);
    rig.started();
    rig.control(route, "start");
    double duration = Routes.plan(ONE_LEG, "{\"points\": [" + FAST + ", " + FAST + "]}").durationSeconds();
    rig.seconds((int) Math.ceil(duration) + 2);
    assertThat(rig.ctx.pluginStatus().detail()).contains("events fired 1,");
    assertThat(name(track)).as("the restart's reset restored it").isEqualTo("Track");
    rig.seconds((int) Math.ceil(duration) + 2);
    assertThat(rig.ctx.pluginStatus().detail()).contains("events fired 2,");
  }

  @Test
  @DisplayName("Function 4: a malformed event makes the route unable to run, and says why")
  void aMalformedEvent() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, points("{\"kind\": \"set\", \"core\": {\"colour\": \"red\"}}", "")));
    rig.started();
    assertThat(rig.post("/routes/" + route + "/start", "{}").reply().status()).isEqualTo(409);
    assertThat(rig.ctx.pluginStatus().detail()).contains("an event cannot change 'colour'");
  }
}
