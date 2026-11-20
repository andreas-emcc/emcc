package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.TWO_LEGS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.store.Change;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Editing a route while it runs, and users' changes to the simulation's objects (brief functions 9 to 9b; criteria 7 and 25). */
class EditsTest {

  private static final String SPEEDS = "[{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]";
  /** TWO_LEGS with its middle point moved north. */
  private static final List<Position> MOVED = List.of(TWO_LEGS.get(0), Position.of(18.4, 59.7), TWO_LEGS.get(2));

  private final Rig rig = new Rig();
  private UUID track;
  private UUID route;

  private static double metres(Position a, Position b) {
    return Geodesy.inverse(a, b).distanceMetres();
  }

  private double speed(UUID id) {
    return rig.object(id).content().symbol().modifiers().speed();
  }

  private static String extension(UUID track, String edit) {
    return "{\"points\": " + SPEEDS + ", \"groups\": [{\"kind\": \"single\", \"objects\": [{\"id\": \"" + track + "\"}]}]" + edit + "}";
  }

  private void running(int seconds) {
    track = rig.symbol(TWO_LEGS.getFirst());
    route = rig.route(TWO_LEGS, extension(track, ""));
    rig.started();
    rig.control(route, "start");
    rig.seconds(seconds);
  }

  /** How far along the first leg of {@code line} the track is, as a fraction of its length. */
  private double fractionOfFirstLeg(List<Position> line) {
    return metres(line.get(0), rig.position(track)) / metres(line.get(0), line.get(1));
  }

  @Test
  @DisplayName("Criterion 7: moving a point with \"move with it\" keeps the objects on the same leg, at the same fraction")
  void moveWithIt() {
    running(100);
    double before = fractionOfFirstLeg(TWO_LEGS);
    rig.control(route, "pause");
    rig.editRoute(route, MOVED, extension(track, ", \"edit\": {\"number\": 1, \"objects\": \"move\"}"));
    assertThat(fractionOfFirstLeg(MOVED)).isCloseTo(before, within(1e-6));
    // On the new leg's geodesic, not beside it.
    var leg = Geodesy.inverse(MOVED.get(0), MOVED.get(1));
    Position onLeg = Geodesy.direct(MOVED.get(0), leg.initialAzimuth(), before * leg.distanceMetres());
    assertThat(metres(rig.position(track), onLeg)).isLessThan(0.01);
  }

  @Test
  @DisplayName("Criterion 7: a running route edited with \"move with it\" goes on from the same fraction")
  void moveWithItWhileRunning() {
    running(100);
    double before = fractionOfFirstLeg(TWO_LEGS);
    rig.editRoute(route, MOVED, extension(track, ", \"edit\": {\"number\": 1, \"objects\": \"move\"}"));
    rig.seconds(1);
    double length = metres(MOVED.get(0), MOVED.get(1));
    assertThat(metres(MOVED.get(0), rig.position(track))).isCloseTo(before * length + 100, within(1.0));
    assertThat(speed(track)).isEqualTo(100);
  }

  @Test
  @DisplayName("Criterion 7: \"disconnect\" leaves the objects in place with speed 0 and their altitude, off the route")
  void disconnect() {
    track = rig.symbol(Position.of(TWO_LEGS.getFirst().longitude(), TWO_LEGS.getFirst().latitude(), 500.0));
    route = rig.route(TWO_LEGS, extension(track, ""));
    rig.started();
    rig.control(route, "start");
    rig.seconds(10);
    Position there = rig.position(track);
    rig.editRoute(route, MOVED, extension(track, ", \"edit\": {\"number\": 1, \"objects\": \"disconnect\"}"));
    assertThat(rig.position(track)).isEqualTo(there);
    assertThat(there.altitude()).isEqualTo(500.0);
    assertThat(speed(track)).isZero();
    assertThat(rig.extension(route).get("groups").toString()).doesNotContain(track.toString());
    rig.seconds(3);
    assertThat(rig.position(track)).isEqualTo(there);
  }

  @Test
  @DisplayName("Function 9: a choice number already seen is no new choice: the objects move with the route")
  void anOldChoiceIsNoChoice() {
    track = rig.symbol(TWO_LEGS.getFirst());
    route = rig.route(TWO_LEGS, extension(track, ", \"edit\": {\"number\": 4, \"objects\": \"disconnect\"}"));
    rig.started();
    rig.control(route, "start");
    rig.seconds(100);
    rig.editRoute(route, MOVED, extension(track, ", \"edit\": {\"number\": 4, \"objects\": \"disconnect\"}"));
    rig.seconds(1);
    assertThat(rig.extension(route).get("groups").toString()).contains(track.toString());
    assertThat(speed(track)).isEqualTo(100);
  }

  @Test
  @DisplayName("Criterion 25, function 9b: a reshape by draw-shapes moves the route's objects with it")
  void aReshapeByAnotherPlugin() {
    running(100);
    double before = fractionOfFirstLeg(TWO_LEGS);
    rig.control(route, "pause");
    MapObject current = rig.object(route);
    MapObjectContent c = current.content();
    var reshaped = new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(), new Geometry.LineString(MOVED),
        c.symbol(), c.style(), c.properties(), c.label(), c.extensions());
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("draw-shapes"), Change.updateObject(current, reshaped)));
    rig.ctx.runUntilIdle();
    assertThat(fractionOfFirstLeg(MOVED)).isCloseTo(before, within(1e-6));
  }

  @Test
  @DisplayName("Criterion 25, function 9b: a route whose data type is changed disconnects its objects")
  void aRouteThatIsNoLongerARoute() {
    running(5);
    MapObject current = rig.object(route);
    MapObjectContent c = current.content();
    var shape = new MapObjectContent(c.type(), dev.emcc.sdk.DataType.GENERAL, c.dataSource(), c.time(), c.layerId(), c.geometry(),
        c.symbol(), c.style(), c.properties(), c.label(), c.extensions());
    Position there = rig.position(track);
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("draw-shapes"), Change.updateObject(current, shape)));
    rig.ctx.runUntilIdle();
    assertThat(speed(track)).isZero();
    assertThat(rig.position(track)).isEqualTo(there);
    rig.seconds(2);
    assertThat(rig.position(track)).isEqualTo(there);
    assertThat(rig.object(route).content().extensions().get(Manifest.id())).as("the simulator does not write it").isEqualTo(c.extensions().get(Manifest.id()));
  }

  @Test
  @DisplayName("Criterion 25, function 9a: deleting a route disconnects its objects")
  void aDeletedRoute() {
    running(5);
    Position there = rig.position(track);
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("draw-shapes"), Change.deleteObject(rig.object(route))));
    rig.ctx.runUntilIdle();
    assertThat(speed(track)).isZero();
    assertThat(rig.position(track)).isEqualTo(there);
  }

  @Test
  @DisplayName("Criterion 25, function 9a: deleting a track during a run takes it off its route, counted")
  void aDeletedTrack() {
    running(5);
    UUID other = rig.symbol(TWO_LEGS.getFirst());
    rig.putOnRoute(route, "single", "", other);
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.deleteObject(rig.object(track))));
    rig.ctx.runUntilIdle();
    rig.seconds(1);
    String groups = rig.extension(route).get("groups").toString();
    assertThat(groups).doesNotContain(track.toString()).contains(other.toString());
    assertThat(rig.ctx.pluginStatus().detail()).contains("tracks deleted 1").contains("1 tracks on routes");
  }

  @Test
  @DisplayName("Function 9b: a route whose extension cannot be read keeps its objects, in place")
  void anUnreadableExtensionKeepsTheObjects() {
    running(100);
    double before = fractionOfFirstLeg(TWO_LEGS);
    rig.editRoute(route, TWO_LEGS, "{\"points\": \"broken\", \"groups\": [{\"kind\": \"single\", \"objects\": [{\"id\": \"" + track + "\"}]}]}");
    assertThat(speed(track)).isZero();
    assertThat(rig.get("/routes/" + route).reply().body().toUtf8()).contains("\"objects\":[\"" + track + "\"]");
    rig.editRoute(route, TWO_LEGS, extension(track, ""));
    rig.control(route, "start");
    rig.seconds(1);
    assertThat(metres(TWO_LEGS.getFirst(), rig.position(track))).isCloseTo(10_100, within(1.0));
    assertThat(before).isGreaterThan(0);
  }

  @Test
  @DisplayName("Function 9b: a route made invalid while it runs pauses; fixed and started, it goes on from where it stood")
  void invalidThenValidAgain() {
    running(100);
    double before = fractionOfFirstLeg(TWO_LEGS);
    rig.editRoute(route, TWO_LEGS, "{\"points\": [{\"speed\": 2500}, {\"speed\": 100}, {\"speed\": 100}], \"groups\": [{\"kind\": \"single\", \"objects\": [{\"id\": \"" + track + "\"}]}]}");
    assertThat(speed(track)).isZero();
    rig.editRoute(route, TWO_LEGS, extension(track, ""));
    rig.seconds(5);
    assertThat(fractionOfFirstLeg(TWO_LEGS)).isCloseTo(before, within(1e-6));
    rig.control(route, "start");
    rig.seconds(1);
    assertThat(metres(TWO_LEGS.getFirst(), rig.position(track))).isCloseTo(10_100, within(1.0));
  }
}
