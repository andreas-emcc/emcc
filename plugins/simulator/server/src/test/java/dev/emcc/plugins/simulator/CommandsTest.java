package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.ONE_LEG;
import static dev.emcc.plugins.simulator.Routes.TWO_LEGS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.sdk.User;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The commands (brief functions 10, 14 and 24; criteria 1, 11 and 22), as POST endpoints (CR-0026;
 * the owner's Q4, 2026-10-27), with the test kit's endpoints.
 */
class CommandsTest {

  private static final String STEADY = "{\"points\": [{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]}";

  private final Rig rig = new Rig();

  private static double metres(Position a, Position b) {
    return Geodesy.inverse(a, b).distanceMetres();
  }

  private double speed(UUID track) {
    return rig.object(track).content().symbol().modifiers().speed();
  }

  /** Whether the store's last request for {@code id} was saved (not a move, ADR-0041). */
  private boolean lastWriteSaved(UUID id) {
    List<ChangeRequest> all = rig.ctx.store().requests().stream().filter(r -> r.entityId().equals(id)).toList();
    return !all.isEmpty() && !rig.ctx.store().unsaved().contains(all.getLast());
  }

  @Test
  @DisplayName("Function 10, open question 9: Put on route lists the object, and places it at the first point at once, saved")
  void putOnRoutePlacesAtTheFirstPoint() {
    UUID track = rig.symbol(Position.of(17.0, 58.0));
    UUID route = rig.route(TWO_LEGS, STEADY);
    rig.started();
    rig.putOnRoute(route, "single", "", track);
    assertThat(rig.position(track)).isEqualTo(TWO_LEGS.getFirst());
    assertThat(speed(track)).isZero();
    assertThat(lastWriteSaved(track)).isTrue();
    assertThat(rig.extension(route).get("groups").toString()).contains(track.toString()).contains("single");
    assertThat(rig.get("/routes/" + route).reply().body().toUtf8()).contains("\"objects\":[\"" + track + "\"]");
  }

  @Test
  @DisplayName("Open question 8: an object is on one route at a time; putting it on another takes it off the first")
  void oneRouteAtATime() {
    UUID track = rig.symbol(Position.of(17.0, 58.0));
    UUID first = rig.route(TWO_LEGS, STEADY);
    UUID second = rig.route(ONE_LEG, "{\"points\": [{\"speed\": 100}, {\"speed\": 100}]}");
    rig.started();
    rig.putOnRoute(first, "single", "", track);
    rig.putOnRoute(second, "single", "", track);
    assertThat(rig.extension(first).get("groups").toString()).doesNotContain(track.toString());
    assertThat(rig.extension(second).get("groups").toString()).contains(track.toString());
    assertThat(rig.position(track)).isEqualTo(ONE_LEG.getFirst());
  }

  @Test
  @DisplayName("Q6: put on a running route, objects leave the first point at once")
  void putOnARunningRouteLeavesAtOnce() {
    UUID first = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(first, "[{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]"));
    rig.started();
    rig.control(route, "start");
    rig.seconds(5);
    UUID late = rig.symbol(Position.of(17.0, 58.0));
    rig.putOnRoute(route, "single", "", late);
    assertThat(rig.position(late)).isEqualTo(TWO_LEGS.getFirst());
    rig.seconds(1);
    assertThat(metres(rig.position(late), TWO_LEGS.getFirst())).isCloseTo(100, within(1.0));
    assertThat(metres(rig.position(first), TWO_LEGS.getFirst())).isCloseTo(600, within(1.0));
  }

  @Test
  @DisplayName("Function 10: Take off route disconnects: speed 0, in place, off the list, saved")
  void takeOffRouteDisconnects() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, STEADY);
    rig.started();
    rig.putOnRoute(route, "single", "", track);
    rig.control(route, "start");
    rig.seconds(3);
    Position there = rig.position(track);
    rig.takeOffRoute(track);
    assertThat(rig.position(track)).isEqualTo(there);
    assertThat(speed(track)).isZero();
    assertThat(lastWriteSaved(track)).isTrue();
    assertThat(rig.extension(route).get("groups").toString()).doesNotContain(track.toString());
    rig.seconds(3);
    assertThat(rig.position(track)).isEqualTo(there);
  }

  @Test
  @DisplayName("Function 14: reset puts the objects back where they started and leaves the route paused; pause stops them with speed 0")
  void resetAndPause() {
    UUID a = rig.symbol(Position.of(17.0, 58.0));
    UUID b = rig.symbol(Position.of(17.0, 58.1));
    UUID route = rig.route(TWO_LEGS, STEADY);
    rig.started();
    rig.putOnRoute(route, "convoy", ", \"spacing\": 100", a, b);
    rig.control(route, "start");
    rig.seconds(5);
    rig.control(route, "pause");
    Position paused = rig.position(a);
    assertThat(speed(a)).isZero();
    assertThat(lastWriteSaved(a)).isTrue();
    rig.seconds(3);
    assertThat(rig.position(a)).isEqualTo(paused);

    rig.control(route, "reset");
    assertThat(rig.position(a)).isEqualTo(TWO_LEGS.getFirst());
    assertThat(rig.position(b)).isEqualTo(TWO_LEGS.getFirst());
    assertThat(rig.get("/routes/" + route).reply().body().toUtf8()).contains("\"state\":\"paused\"");
    rig.control(route, "start");
    rig.seconds(2);
    assertThat(metres(rig.position(a), TWO_LEGS.getFirst())).isCloseTo(200, within(1.0));
    assertThat(metres(rig.position(b), TWO_LEGS.getFirst())).isCloseTo(100, within(1.0));
  }

  @Test
  @DisplayName("Q7: Start on a route stopped at its end runs it again from the start")
  void startAtTheEndRunsAgain() {
    UUID track = rig.symbol(ONE_LEG.getFirst());
    UUID route = rig.route(ONE_LEG, Rig.single(track, "[{\"speed\": 1000}, {\"speed\": 1000}]"));
    rig.started();
    rig.control(route, "start");
    rig.seconds(40);
    assertThat(rig.get("/routes/" + route).reply().body().toUtf8()).contains("\"state\":\"ended\"");
    rig.control(route, "start");
    assertThat(rig.position(track)).isEqualTo(ONE_LEG.getFirst());
    rig.seconds(2);
    assertThat(metres(rig.position(track), ONE_LEG.getFirst())).isCloseTo(2000, within(1.0));
  }

  @Test
  @DisplayName("Function 14: \"restart\" at the end is a reset followed by a start")
  void restartAtTheEnd() {
    UUID track = rig.symbol(ONE_LEG.getFirst());
    UUID route = rig.route(ONE_LEG, "{\"points\": [{\"speed\": 1000}, {\"speed\": 1000}], \"end\": \"restart\", \"groups\": [{\"kind\": \"single\", \"objects\": [{\"id\": \"" + track + "\"}]}]}");
    rig.started();
    rig.control(route, "start");
    double duration = Routes.plan(ONE_LEG, "{\"points\": [{\"speed\": 1000}, {\"speed\": 1000}]}").durationSeconds();
    rig.seconds((int) Math.ceil(duration)); // reaches the end; the tick restarts it
    rig.seconds(3);
    assertThat(metres(rig.position(track), ONE_LEG.getFirst())).isLessThan(3000);
    assertThat(rig.get("/routes/" + route).reply().body().toUtf8()).contains("\"state\":\"running\"");
  }

  @Test
  void startAndPauseEveryRoute() {
    UUID a = rig.symbol(TWO_LEGS.getFirst());
    UUID b = rig.symbol(ONE_LEG.getFirst());
    rig.route(TWO_LEGS, Rig.single(a, "[{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]"));
    rig.route(ONE_LEG, Rig.single(b, "[{\"speed\": 100}, {\"speed\": 100}]"));
    rig.started();
    rig.control("start");
    rig.seconds(2);
    rig.control("pause");
    rig.seconds(2);
    assertThat(metres(rig.position(a), TWO_LEGS.getFirst())).isCloseTo(200, within(1.0));
    assertThat(metres(rig.position(b), ONE_LEG.getFirst())).isCloseTo(200, within(1.0));
    assertThat(rig.ctx.pluginStatus().detail()).startsWith("paused").contains("routes: Route 1 paused, Route 1 paused");
  }

  @Test
  @DisplayName("Criteria 1 and 22: the commands need their permissions; ECore refuses others with 403")
  void commandsNeedTheirPermissions() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, STEADY);
    rig.started();
    User viewer = User.of("u1", "Viewer", Set.of(Engine.VIEW_PERMISSION, Engine.EDIT_PERMISSION));
    User runner = User.of("u2", "Runner", Set.of(Engine.VIEW_PERMISSION, Engine.RUN_PERMISSION));
    var body = Routes.json("{\"route\": \"" + route + "\", \"kind\": \"single\", \"objects\": [\"" + track + "\"]}");
    FakeHttpExchange start = rig.ctx.post("/routes/" + route + "/start", Routes.json("{}"), viewer);
    FakeHttpExchange startAll = rig.ctx.post("/routes/start", Routes.json("{}"), viewer);
    FakeHttpExchange put = rig.ctx.post("/put-on-route", body, runner);
    FakeHttpExchange takeOff = rig.ctx.post("/take-off-route", Routes.json("{\"objects\": [\"" + track + "\"]}"), runner);
    FakeHttpExchange allowed = rig.ctx.post("/routes/" + route + "/start", Routes.json("{}"), runner);
    rig.ctx.runUntilIdle();
    assertThat(List.of(start, startAll, put, takeOff)).allSatisfy(c -> assertThat(c.reply().status()).isEqualTo(403));
    assertThat(allowed.reply().status()).isEqualTo(200);
  }

  @Test
  @DisplayName("Function 24: the endpoints check every id against the simulation's own objects")
  void refusesWhatIsNotTheSimulations() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID inView = rig.symbol(rig.viewLayer, TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, STEADY);
    rig.started();
    String ok = "\"route\": \"" + route + "\", \"kind\": \"single\"";
    assertThat(status("/put-on-route", "{" + ok + ", \"objects\": [\"" + inView + "\"]}")).isEqualTo(404);
    assertThat(status("/put-on-route", "{" + ok + ", \"objects\": [\"" + route + "\"]}")).as("a route is no track").isEqualTo(404);
    assertThat(status("/put-on-route", "{\"route\": \"" + UUID.randomUUID() + "\", \"kind\": \"single\", \"objects\": [\"" + track + "\"]}")).isEqualTo(404);
    assertThat(status("/put-on-route", "{\"route\": \"" + track + "\", \"kind\": \"single\", \"objects\": [\"" + track + "\"]}")).isEqualTo(404);
    assertThat(status("/put-on-route", "{" + ok + ", \"objects\": []}")).isEqualTo(400);
    assertThat(status("/put-on-route", "{" + ok + ", \"objects\": [\"" + track + "\", \"" + track + "\"]}")).isEqualTo(400);
    assertThat(status("/put-on-route", "{" + ok + ", \"objects\": [\"not-an-id\"]}")).isEqualTo(400);
    assertThat(status("/put-on-route", "{\"route\": \"" + route + "\", \"kind\": \"swarm\", \"objects\": [\"" + track + "\"]}")).isEqualTo(400);
    assertThat(status("/put-on-route", "{\"route\": \"" + route + "\", \"kind\": \"convoy\", \"objects\": [\"" + track + "\"]}")).isEqualTo(400);
    FakeHttpExchange list = rig.ctx.post("/put-on-route", new dev.emcc.sdk.json.JsonArray(List.of()));
    rig.ctx.runUntilIdle();
    assertThat(list.reply().status()).isEqualTo(400);
    assertThat(status("/take-off-route", "{\"objects\": [\"" + inView + "\"]}")).isEqualTo(404);
    assertThat(status("/routes/" + UUID.randomUUID() + "/start", "{}")).isEqualTo(404);
    assertThat(status("/routes/not-an-id/reset", "{}")).isEqualTo(404);
    assertThat(rig.ctx.store().requests()).isEmpty();
  }

  @Test
  @DisplayName("A formation's objects must be within 100 km of its centre")
  void aFormationTooWide() {
    UUID a = rig.symbol(Position.of(17.0, 58.0));
    UUID b = rig.symbol(Position.of(21.0, 58.0));
    UUID route = rig.route(TWO_LEGS, STEADY);
    rig.started();
    assertThat(status("/put-on-route", "{\"route\": \"" + route + "\", \"kind\": \"formation\", \"objects\": [\"" + a + "\", \"" + b + "\"]}")).isEqualTo(400);
  }

  @Test
  @DisplayName("Q7: a route paused at its end runs again on Start, too")
  void pauseThenStartAtTheEnd() {
    UUID track = rig.symbol(ONE_LEG.getFirst());
    UUID route = rig.route(ONE_LEG, Rig.single(track, "[{\"speed\": 1000}, {\"speed\": 1000}]"));
    rig.started();
    rig.control(route, "start");
    rig.seconds(40);
    rig.control(route, "pause");
    rig.control(route, "start");
    assertThat(rig.position(track)).isEqualTo(ONE_LEG.getFirst());
    rig.seconds(1);
    assertThat(metres(rig.position(track), ONE_LEG.getFirst())).isCloseTo(1000, within(1.0));
  }

  @Test
  @DisplayName("Q6: a convoy put on a running route leaves at once, one by one")
  void aConvoyPutOnARunningRoute() {
    UUID route = rig.route(TWO_LEGS, STEADY);
    rig.started();
    rig.control(route, "start");
    rig.seconds(3);
    UUID a = rig.symbol(Position.of(17.0, 58.0));
    UUID b = rig.symbol(Position.of(17.0, 58.1));
    rig.putOnRoute(route, "convoy", ", \"spacing\": 300", a, b);
    rig.seconds(4);
    assertThat(metres(rig.position(a), TWO_LEGS.getFirst())).isCloseTo(400, within(1.0));
    assertThat(metres(rig.position(b), TWO_LEGS.getFirst())).isCloseTo(100, within(1.0));
  }

  @Test
  @DisplayName("Two commands in one go: the second builds on the first's list before the store applies it")
  void twoCommandsAtOnce() {
    UUID a = rig.symbol(Position.of(17.0, 58.0));
    UUID b = rig.symbol(Position.of(17.0, 58.1));
    UUID route = rig.route(TWO_LEGS, STEADY);
    rig.started();
    FakeHttpExchange first = rig.ctx.post("/put-on-route", Routes.json("{\"route\": \"" + route + "\", \"kind\": \"single\", \"objects\": [\"" + a + "\"]}"));
    FakeHttpExchange second = rig.ctx.post("/put-on-route", Routes.json("{\"route\": \"" + route + "\", \"kind\": \"single\", \"objects\": [\"" + b + "\"]}"));
    rig.ctx.runUntilIdle();
    Rig.ok(first);
    Rig.ok(second);
    assertThat(rig.extension(route).get("groups").toString()).contains(a.toString()).contains(b.toString());
    assertThat(rig.position(a)).isEqualTo(TWO_LEGS.getFirst());
    assertThat(rig.position(b)).isEqualTo(TWO_LEGS.getFirst());
  }

  @Test
  @DisplayName("A refused write of a route's list is tried again at the next tick, from the latest version")
  void aRefusedListWriteIsTriedAgain() {
    UUID track = rig.symbol(Position.of(17.0, 58.0));
    UUID route = rig.route(TWO_LEGS, STEADY);
    rig.started();
    rig.ctx.store().rejectNext(dev.emcc.sdk.model.ChangeRejection.Code.VALIDATION_FAILED, "changed meanwhile");
    rig.putOnRoute(route, "single", "", track);
    assertThat(String.valueOf(rig.extension(route).get("groups"))).doesNotContain(track.toString());
    assertThat(rig.position(track)).as("the engine works with the list as written").isEqualTo(TWO_LEGS.getFirst());
    rig.seconds(1);
    assertThat(rig.extension(route).get("groups").toString()).contains(track.toString());
    assertThat(rig.ctx.pluginStatus().detail()).contains("route lists written 1, refused 1");
  }

  @Test
  @DisplayName("A list write refused three times is given up, logged, and not asked for again")
  void aListWriteRefusedThreeTimesIsGivenUp() {
    UUID inView = rig.symbol(rig.viewLayer, TWO_LEGS.getFirst());
    for (int i = 0; i < Engine.MAX_REFUSALS; i++) {
      rig.ctx.store().rejectNext(dev.emcc.sdk.model.ChangeRejection.Code.PERMISSION_DENIED, "no");
    }
    UUID route = rig.route(TWO_LEGS, Rig.single(inView, "[{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]"));
    rig.started();
    rig.seconds(5);
    assertThat(rig.ctx.store().requests()).hasSize(Engine.MAX_REFUSALS);
    assertThat(rig.ctx.pluginStatus().detail()).contains("route lists written 0, refused 3");
    assertThat(rig.ctx.logEntries()).anySatisfy(l -> assertThat(l.message()).contains("refused 3 times"));
    assertThat(route).isNotNull();
  }

  @Test
  @DisplayName("A refused saved write of a track (here a pause) is tried again")
  void aRefusedPlacementIsTriedAgain() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, "[{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]"));
    rig.started();
    rig.control(route, "start");
    rig.seconds(3);
    rig.ctx.store().rejectNext(dev.emcc.sdk.model.ChangeRejection.Code.VALIDATION_FAILED, "changed meanwhile");
    rig.control(route, "pause");
    assertThat(speed(track)).isEqualTo(100);
    rig.seconds(1);
    assertThat(speed(track)).isZero();
    assertThat(lastWriteSaved(track)).isTrue();
  }

  private int status(String path, String json) {
    return rig.post(path, json).reply().status();
  }
}
