package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.TWO_LEGS;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.User;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The outputs (brief function 18; criteria 13, 14 and 16; A20, A21). */
class OutputsTest {

  private static final String STEADY = "[{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]";

  private final Rig rig = new Rig();

  private List<ChannelItem.Update> updatesSince(int from) {
    return rig.sentToTak().subList(from, rig.sentToTak().size()).stream()
        .filter(ChannelItem.Update.class::isInstance).map(ChannelItem.Update.class::cast).toList();
  }

  @Test
  @DisplayName("Criterion 13: each channel is listed with its type, delete capability and fields; users with edit choose them")
  void listAndChoose() {
    rig.started();
    rig.chooseTak();
    String body = rig.get("/outputs").reply().body().toUtf8();
    assertThat(body).contains("\"id\":\"cot/tak-out\"").contains("\"outputType\":\"cot\"").contains("\"canDelete\":true")
        .contains("{\"plugin\":\"cot\",\"name\":\"team\"}").contains("\"chosen\":true").contains("\"missing\":false");
    assertThat(rig.post("/outputs", "{\"channels\": [\"cot/other\"]}").reply().status()).isEqualTo(404);
    assertThat(rig.post("/outputs", "{\"channels\": [\"not a channel\"]}").reply().status()).isEqualTo(400);
    assertThat(rig.post("/outputs", "{\"channels\": [\"cot/tak-out\", \"cot/tak-out\"]}").reply().status()).isEqualTo(400);
    FakeHttpExchange viewer = rig.ctx.post("/outputs", Routes.json("{\"channels\": []}"), User.of("u1", "Viewer", Set.of(Engine.VIEW_PERMISSION)));
    rig.ctx.runUntilIdle();
    assertThat(viewer.reply().status()).isEqualTo(403);
  }

  @Test
  @DisplayName("Criteria 13 and 16: while running, every track goes out each tick with an expiry after the tick; after a pause, its stop once, then nothing")
  void sendsWhileRunning() {
    UUID moving = rig.symbol(TWO_LEGS.getFirst());
    UUID standing = rig.symbol(Position.of(17.0, 58.0)); // on no route: sent too (function 3)
    UUID route = rig.route(TWO_LEGS, Rig.single(moving, STEADY));
    rig.started();
    rig.chooseTak();
    rig.seconds(2);
    assertThat(rig.sentToTak()).as("nothing runs: nothing is sent").isEmpty();
    rig.control(route, "start");
    for (int t = 1; t <= 3; t++) {
      int before = rig.sentToTak().size();
      rig.seconds(1);
      List<ChannelItem.Update> tick = updatesSince(before);
      assertThat(tick).extracting(ChannelItem.Update::id).containsExactlyInAnyOrder(moving, standing);
      tick.forEach(u -> assertThat(u.content().time().expires()).isEqualTo(rig.ctx.clock().plusSeconds(5)));
      assertThat(tick.stream().filter(u -> u.id().equals(moving)).findFirst().orElseThrow().content().geometry())
          .isEqualTo(rig.object(moving).content().geometry());
    }
    // Only the item carries the expiry, never the stored object.
    assertThat(rig.object(moving).content().time().expires()).isNull();
    rig.control(route, "pause");
    int paused = rig.sentToTak().size();
    rig.seconds(3);
    assertThat(rig.sentToTak()).hasSize(paused);
    assertThat(rig.ctx.pluginStatus().detail()).contains("outputs 1 chosen, sent 7,"); // 3 ticks of 2, and the pause's stop
  }

  @Test
  @DisplayName("ITA mass test 2: a pause between ticks sends where the track stopped, speed 0, once; the receiver no longer keeps the last tick's position")
  void aPauseSendsWhereItStopped() {
    UUID moving = rig.symbol(TWO_LEGS.getFirst());
    rig.symbol(Position.of(17.0, 58.0)); // standing, on no route
    UUID route = rig.route(TWO_LEGS, Rig.single(moving, STEADY));
    rig.started();
    rig.chooseTak();
    rig.control(route, "start");
    rig.seconds(3);
    var lastTick = updatesSince(0).stream().filter(u -> u.id().equals(moving)).toList().getLast().content().geometry();
    rig.ctx.advance(Duration.ofMillis(400)); // between two ticks
    int before = rig.sentToTak().size();
    rig.control(route, "pause");
    List<ChannelItem.Update> sent = updatesSince(before);
    assertThat(sent).as("only the paused route's track, not the standing symbol").extracting(ChannelItem.Update::id).containsExactly(moving);
    ChannelItem.Update stop = sent.getFirst();
    assertThat(stop.content().geometry()).isEqualTo(rig.object(moving).content().geometry()).isNotEqualTo(lastTick);
    assertThat(stop.content().symbol().modifiers().speed()).isZero();
    assertThat(stop.content().time().expires()).isEqualTo(rig.ctx.clock().plusSeconds(5));
    int paused = rig.sentToTak().size();
    rig.seconds(3);
    rig.control(route, "pause"); // already paused: nothing new
    assertThat(rig.sentToTak()).as("nothing more while paused (A8)").hasSize(paused);
  }

  @Test
  @DisplayName("ITA mass test 2: a reset sends the start once, also after a pause; starting again sends with the ticks as before")
  void aResetSendsTheStart() {
    UUID moving = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(moving, STEADY));
    rig.started();
    rig.chooseTak();
    rig.control(route, "start");
    rig.seconds(3);
    rig.control(route, "pause");
    int before = rig.sentToTak().size();
    rig.control(route, "reset");
    List<ChannelItem.Update> sent = updatesSince(before);
    assertThat(sent).extracting(ChannelItem.Update::id).containsExactly(moving);
    assertThat(sent.getFirst().content().geometry()).isEqualTo(rig.object(moving).content().geometry());
    assertThat(rig.position(moving)).isEqualTo(TWO_LEGS.getFirst());
    int reset = rig.sentToTak().size();
    rig.seconds(2);
    assertThat(rig.sentToTak()).hasSize(reset);
    rig.control(route, "start");
    rig.seconds(1);
    assertThat(updatesSince(reset)).extracting(ChannelItem.Update::id).contains(moving);
  }

  @Test
  @DisplayName("ITA mass test 2 and function 9b: a route made invalid while it runs pauses and sends where it stopped once")
  void anInvalidRouteSendsWhereItStopped() {
    UUID moving = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(moving, STEADY));
    rig.started();
    rig.chooseTak();
    rig.control(route, "start");
    rig.seconds(2);
    int before = rig.sentToTak().size();
    rig.editRoute(route, TWO_LEGS, "{\"points\": [{\"speed\": 2500}, {\"speed\": 100}, {\"speed\": 100}], \"groups\": [{\"kind\": \"single\", \"objects\": [{\"id\": \"" + moving + "\"}]}]}");
    rig.seconds(1);
    List<ChannelItem.Update> sent = updatesSince(before);
    assertThat(sent).extracting(ChannelItem.Update::id).containsExactly(moving);
    assertThat(sent.getFirst().content().symbol().modifiers().speed()).isZero();
    assertThat(sent.getFirst().content().geometry()).isEqualTo(rig.object(moving).content().geometry());
    int paused = rig.sentToTak().size();
    rig.seconds(3);
    assertThat(rig.sentToTak()).hasSize(paused);
  }

  @Test
  @DisplayName("ITA mass test 2: one route paused while another runs goes with the ticks, not twice")
  void onePausedWhileAnotherRuns() {
    UUID a = rig.symbol(TWO_LEGS.getFirst());
    UUID b = rig.symbol(TWO_LEGS.getFirst());
    UUID first = rig.route(TWO_LEGS, Rig.single(a, STEADY));
    rig.route(TWO_LEGS, Rig.single(b, STEADY));
    rig.started();
    rig.chooseTak();
    rig.control("start");
    rig.seconds(2);
    int before = rig.sentToTak().size();
    rig.control(first, "pause");
    rig.seconds(1);
    List<ChannelItem.Update> sent = updatesSince(before);
    assertThat(sent).extracting(ChannelItem.Update::id).containsExactlyInAnyOrder(a, b);
    assertThat(sent.stream().filter(u -> u.id().equals(a)).findFirst().orElseThrow().content().symbol().modifiers().speed()).isZero();
  }

  @Test
  @DisplayName("Criterion 13: a changed outputStaleSeconds applies from the next tick")
  void aChangedStaleTime() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, STEADY));
    rig.started();
    rig.chooseTak();
    rig.control(route, "start");
    rig.seconds(1);
    rig.ctx.changeSettings(JsonObject.builder().put("outputStaleSeconds", JsonNumber.of(30)).build());
    int before = rig.sentToTak().size();
    rig.seconds(1);
    assertThat(updatesSince(before)).singleElement().satisfies(u -> assertThat(u.content().time().expires()).isEqualTo(rig.ctx.clock().plus(Duration.ofSeconds(30))));
  }

  @Test
  @DisplayName("Criterion 14 (N8): a chosen channel that goes is shown as missing, not dropped; when it comes back, sending resumes")
  void aMissingChannel() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, STEADY));
    rig.started();
    rig.chooseTak();
    rig.control(route, "start");
    rig.seconds(1);
    var info = rig.ctx.channels().list().find(Rig.TAK).orElseThrow();
    rig.ctx.channels().removeOther(Rig.TAK);
    rig.ctx.runUntilIdle();
    assertThat(rig.get("/outputs").reply().body().toUtf8()).contains("{\"id\":\"cot/tak-out\",\"missing\":true}");
    assertThat(rig.ctx.pluginStatus().detail()).contains("outputs 1 chosen (missing: cot/tak-out)");
    int before = rig.sentToTak().size();
    rig.seconds(2);
    assertThat(rig.sentToTak()).hasSize(before);
    // A user may keep a missing channel in a new choice.
    assertThat(rig.post("/outputs", "{\"channels\": [\"cot/tak-out\"]}").reply().status()).isEqualTo(200);
    rig.ctx.channels().addOther(info);
    rig.ctx.runUntilIdle();
    rig.seconds(1);
    assertThat(updatesSince(before)).singleElement().satisfies(u -> assertThat(u.id()).isEqualTo(track));
  }
}
