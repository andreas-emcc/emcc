package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.TWO_LEGS;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.User;
import dev.emcc.sdk.geo.GeodesicLeg;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The engine worker with the test kit's store, timers and endpoints (brief functions 16, 17, 17a, 24). */
class EngineTest {

  private static final String TWO_LEG_SPEEDS = "[{\"speed\": 100}, {\"speed\": 50}, {\"speed\": 50}]";

  private final Rig rig = new Rig();

  private static double metres(Position a, Position b) {
    return Geodesy.inverse(a, b).distanceMetres();
  }

  @Test
  @DisplayName("Criterion 3: a single object on a two-leg route moves along the geodesics, once a second, latitude ≠ longitude")
  void movesOnceASecondAlongTheGeodesics() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, TWO_LEG_SPEEDS));
    rig.started();
    rig.control(route, "start");

    GeodesicLeg first = Geodesy.inverse(TWO_LEGS.get(0), TWO_LEGS.get(1));
    GeodesicLeg second = Geodesy.inverse(TWO_LEGS.get(1), TWO_LEGS.get(2));
    double firstLegTime = first.distanceMetres() / 100;
    for (int t = 1; t <= 800; t++) {
      rig.seconds(1);
      Position expected = t < firstLegTime
          ? Geodesy.direct(TWO_LEGS.get(0), first.initialAzimuth(), 100.0 * t)
          : Geodesy.direct(TWO_LEGS.get(1), second.initialAzimuth(), 50.0 * (t - firstLegTime));
      MapObject moved = rig.object(track);
      assertThat(metres(rig.position(track), expected)).as("t=%d", t).isLessThan(1);
      Modifiers modifiers = moved.content().symbol().modifiers();
      assertThat(modifiers.speed()).isEqualTo(t < firstLegTime ? 100 : 50);
      double azimuth = t < firstLegTime ? Geodesy.inverse(expected, TWO_LEGS.get(1)).initialAzimuth() : Geodesy.inverse(expected, TWO_LEGS.get(2)).initialAzimuth();
      assertThat(modifiers.direction()).as("direction at t=%d", t).isCloseTo(azimuth, org.assertj.core.api.Assertions.within(0.01));
      assertThat(moved.content().time().observed()).isEqualTo(rig.ctx.clock());
    }
    // One move per tick; the first tick after Start is a save, so its move is saved (A12).
    assertThat(rig.ctx.store().unsaved()).as("one move per tick").hasSize(799);
    assertThat(rig.ctx.store().requests().stream().filter(r -> r.entityId().equals(track))).hasSize(801);
  }

  @Test
  @DisplayName("Criterion 17 (plugin): only moves are marked not saved, and a refused move is counted")
  void onlyMovesAreNotSavedAndRefusalsAreCounted() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, TWO_LEG_SPEEDS));
    rig.started();
    rig.control(route, "start");
    rig.seconds(3);
    rig.ctx.store().rejectNext(ChangeRejection.Code.VALIDATION_FAILED, "the object changed meanwhile");
    rig.seconds(1);
    rig.seconds(1);

    List<ChangeRequest> unsaved = rig.ctx.store().unsaved();
    assertThat(unsaved).hasSize(3).allSatisfy(r -> assertThat(r.entityId()).isEqualTo(track));
    // Besides the moves it wrote the track's place at the start (open question 9) and the save of
    // the first tick after Start (A12), both saved.
    assertThat(rig.ctx.store().requests()).hasSize(6).allSatisfy(r -> assertThat(r.entityId()).isEqualTo(track));
    rig.seconds(1); // the status counts the answers as of each tick
    assertThat(rig.ctx.pluginStatus().detail()).contains("refused 1").contains("answered 5");
  }

  @Test
  void aTrackStillWaitingAtTheNextTickIsSkippedAndCounted() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, TWO_LEG_SPEEDS));
    rig.started();
    rig.control(route, "start");
    rig.ctx.store().loseNextAnswer();
    rig.seconds(1); // submitted, its answer lost: Unknown after 2 s
    rig.seconds(1); // still in flight: skipped
    rig.seconds(2);
    assertThat(rig.ctx.pluginStatus().detail()).containsPattern("skipped [12],").contains("lost 1");
  }

  @Test
  @DisplayName("Criterion 21 (plugin): a new snapshot replaces what the worker holds; no track is lost or doubled")
  void aNewSnapshotReplacesWhatTheWorkerHolds() {
    List<UUID> tracks = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      tracks.add(rig.symbol(TWO_LEGS.getFirst()));
    }
    String groups = String.join(",", tracks.stream().map(t -> "{\"kind\": \"single\", \"objects\": [{\"id\": \"" + t + "\"}]}").toList());
    UUID route = rig.route(TWO_LEGS, "{\"points\": " + TWO_LEG_SPEEDS + ", \"groups\": [" + groups + "]}");
    rig.started();
    rig.control(route, "start");
    rig.seconds(2);
    rig.ctx.store().gap();
    rig.ctx.store().gap();
    rig.ctx.runUntilIdle();
    rig.seconds(2);

    assertThat(rig.ctx.store().unsaved()).as("the first tick after Start is a save (A12)").hasSize(15);
    assertThat(rig.ctx.store().unsaved().subList(10, 15)).extracting(ChangeRequest::entityId).containsExactlyInAnyOrderElementsOf(tracks);
    assertThat(rig.ctx.pluginStatus().detail()).contains("new snapshots 2").contains("5 tracks on routes").contains("skipped 0");
    Position expected = Geodesy.direct(TWO_LEGS.get(0), Geodesy.inverse(TWO_LEGS.get(0), TWO_LEGS.get(1)).initialAzimuth(), 400);
    tracks.forEach(t -> assertThat(metres(rig.position(t), expected)).isLessThan(1));
  }

  @Test
  void aRestartedWorkerLoadsThePictureAgain() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, TWO_LEG_SPEEDS));
    rig.started();
    rig.ctx.restart(rig.engine());
    UUID second = rig.symbol(TWO_LEGS.getFirst()); // a change the new handler gets before its picture
    UUID other = rig.route(TWO_LEGS, Rig.single(second, TWO_LEG_SPEEDS));
    rig.seconds(1); // the tick finds no picture and asks for it
    rig.control("start");
    rig.seconds(1);
    assertThat(metres(rig.position(track), TWO_LEGS.getFirst())).isCloseTo(100, org.assertj.core.api.Assertions.within(1.0));
    assertThat(metres(rig.position(second), TWO_LEGS.getFirst())).isCloseTo(100, org.assertj.core.api.Assertions.within(1.0));
    assertThat(rig.get("/routes/" + other).reply().status()).isEqualTo(200);
    assertThat(route).isNotEqualTo(other);
  }

  @Test
  @DisplayName("Function 2: the server part keeps to the Simulation workspace, also when the store does not filter")
  void keepsToTheSimulationWorkspace() {
    UUID inView = rig.symbol(rig.viewLayer, TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(inView, TWO_LEG_SPEEDS));
    UUID viewRoute = rig.route(rig.viewLayer, TWO_LEGS, Rig.single(inView, TWO_LEG_SPEEDS));
    rig.started();
    rig.control("start");
    rig.seconds(3);
    assertThat(rig.position(inView)).isEqualTo(TWO_LEGS.getFirst());
    // It wrote only its own route's list, which no longer names the object of View (A10).
    assertThat(rig.ctx.store().requests()).singleElement().satisfies(r -> assertThat(r.entityId()).isEqualTo(route));
    assertThat(rig.extension(route).get("groups")).isEqualTo(new dev.emcc.sdk.json.JsonArray(List.of()));
    assertThat(rig.get("/routes/" + viewRoute).reply().status()).isEqualTo(404);
    assertThat(rig.get("/routes/" + route).reply().status()).isEqualTo(200);
    assertThat(Engine.workspaceQuery().workspaces()).containsExactly(Picture.WORKSPACE);
  }

  @Test
  @DisplayName("Criterion 25: dragging a track on a running route: the route wins, and the next tick puts it back")
  void theRouteWinsOverADrag() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, TWO_LEG_SPEEDS));
    rig.started();
    rig.control(route, "start");
    rig.seconds(5);
    MapObject current = rig.object(track);
    MapObjectContent c = current.content();
    var dragged = new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(), new Geometry.Point(Position.of(17.2, 58.4)),
        c.symbol(), c.style(), c.properties(), c.label(), c.extensions());
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.updateObject(current, dragged)));
    rig.seconds(1);
    Position expected = Geodesy.direct(TWO_LEGS.get(0), Geodesy.inverse(TWO_LEGS.get(0), TWO_LEGS.get(1)).initialAzimuth(), 600);
    assertThat(metres(rig.position(track), expected)).isLessThan(1);
  }

  @Test
  @DisplayName("Function 9b and criterion 25: a route made invalid while it runs pauses, its objects in place, and says why")
  void anInvalidRoutePausesAndSaysWhy() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, TWO_LEG_SPEEDS));
    rig.started();
    rig.control(route, "start");
    rig.seconds(3);
    Position stopped = rig.position(track);
    rig.editRoute(route, TWO_LEGS, Rig.single(track, "[{\"speed\": 100}, {\"speed\": 2500}, {\"speed\": 50}]"));
    rig.seconds(3);
    assertThat(rig.position(track)).isEqualTo(stopped);
    assertThat(rig.ctx.pluginStatus().detail()).contains("cannot run: Route 1 (point 2: a speed must be from 0 to 2000 m/s, not 2500)");
    String body = rig.get("/routes/" + route).reply().body().toUtf8();
    assertThat(body).contains("\"state\":\"paused\"").contains("\"runnable\":false").contains("\"point\":1");
    // Start refuses it until it is fixed.
    assertThat(rig.post("/routes/" + route + "/start", "{}").reply().status()).isEqualTo(409);
    rig.seconds(1);
    assertThat(rig.position(track)).isEqualTo(stopped);
  }

  @Test
  void pauseKeepsTheObjectsWhereTheyAreAndStartGoesOn() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, TWO_LEG_SPEEDS));
    rig.started();
    rig.control("start");
    rig.seconds(2);
    rig.control("pause");
    rig.seconds(10);
    rig.control(route, "start");
    rig.seconds(1);
    assertThat(metres(rig.position(track), TWO_LEGS.getFirst())).isCloseTo(300, org.assertj.core.api.Assertions.within(1.0));
  }

  @Test
  @DisplayName("Function 14 and A9: at its end a route stops: the object stays at the last point with speed 0")
  void stopsAtTheEnd() {
    UUID track = rig.symbol(Routes.ONE_LEG.getFirst());
    UUID route = rig.route(Routes.ONE_LEG, Rig.single(track, "[{\"speed\": 1000}, {\"speed\": 1000, \"altitude\": 250}]"));
    rig.started();
    rig.control(route, "start");
    rig.seconds(40);
    assertThat(metres(rig.position(track), Routes.ONE_LEG.get(1))).isLessThan(0.01);
    assertThat(rig.object(track).content().symbol().modifiers().speed()).isZero();
    assertThat(rig.position(track).altitude()).isEqualTo(250);
    int moves = rig.ctx.store().unsaved().size();
    rig.seconds(5);
    assertThat(rig.ctx.store().unsaved()).as("a standing track is not moved again").hasSize(moves);
    assertThat(rig.get("/routes/" + route).reply().body().toUtf8()).contains("\"state\":\"ended\"");
    assertThat(rig.ctx.pluginStatus().detail()).startsWith("running");
  }

  @Test
  @DisplayName("Function 24: the computed values come from a GET endpoint with the route version; it requires plugin.simulator.view")
  void servesTheComputedValues() {
    UUID route = rig.route(TWO_LEGS, "{\"points\": [{\"speed\": 10}, {\"speedKind\": \"ramp\", \"time\": {\"seconds\": 2000, \"unit\": \"kmh\"}}, {\"speed\": 20}]}");
    rig.started();
    FakeHttpExchange all = rig.get("/routes");
    FakeHttpExchange one = rig.get("/routes/" + route);
    FakeHttpExchange garbage = rig.get("/routes/not-an-id");
    FakeHttpExchange denied = rig.ctx.call("/routes", User.of("u1", "Viewer of View", Set.of("objects.edit")));
    rig.ctx.runUntilIdle();
    assertThat(all.reply().status()).isEqualTo(200);
    assertThat(all.reply().headers().first("Content-Type")).startsWith("application/json");
    String body = one.reply().body().toUtf8();
    assertThat(body).contains("\"id\":\"" + route + "\"").contains("\"version\":1").contains("\"speedFrom\":\"time\"").contains("\"arrivalSeconds\":");
    assertThat(all.reply().body().toUtf8()).startsWith("{\"running\":false,\"routes\":[{");
    assertThat(garbage.reply().status()).isEqualTo(404);
    assertThat(denied.reply().status()).isEqualTo(403);
  }

  @Test
  void aRouteWithoutValuesCannotRunAndTheStatusSaysWhy() {
    UUID route = rig.route(TWO_LEGS, "{\"points\": [{\"speed\": 10}]}");
    rig.started();
    FakeHttpExchange start = rig.post("/routes/" + route + "/start", "{}");
    assertThat(start.reply().status()).isEqualTo(409);
    assertThat(start.reply().body().toUtf8()).contains("the route cannot run: the route has 3 points but values for 1");
    assertThat(rig.ctx.pluginStatus().state()).isEqualTo(PluginState.OK);
    assertThat(rig.ctx.pluginStatus().detail()).startsWith("paused").contains("the route has 3 points but values for 1");
  }
}
