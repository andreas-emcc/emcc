package dev.emcc.plugins.uavsimulation;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.DataType;
import dev.emcc.sdk.User;
import dev.emcc.sdk.Workspace;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.TestJson;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/** The plugin started as the plugin host starts it, with the Simulation workspace, a layer in it and one in View. */
final class Rig {

  static final Workspace SIMULATION = new Workspace(SimulationCopy.WORKSPACE, "Simulation", "plugin.simulator.view", "plugin.simulator.edit", 100);
  static final String UAV = "10030100001101000000";

  final FakePluginContext ctx;
  final UavSimulationPlugin plugin;
  final Layer layer;
  final Layer viewLayer;

  Rig() {
    this(null);
  }

  /** With {@code documents} seeded, as after a restart (criterion 5). */
  Rig(@Nullable Map<String, JsonObject> documents) {
    ctx = FakePluginContext.builder(Manifest.id()).settings(Manifest.settingDefaults()).workspaces(SIMULATION).build();
    if (documents != null) {
      documents.forEach(ctx.documents()::seed);
    }
    plugin = new UavSimulationPlugin(new FakeClock(ctx));
    UUID id = UUID.randomUUID();
    ctx.store().applyAs(Actor.plugin("layer-panel"),
        Change.createLayer(id, new LayerContent("Blue force", 1, true, ctx.defaultLabel(), Extensions.empty(), SimulationCopy.WORKSPACE)));
    layer = ctx.store().layers().stream().filter(l -> l.id().equals(id)).findFirst().orElseThrow();
    viewLayer = ctx.store().seedLayer("Real world");
  }

  Rig started() {
    plugin.init(ctx);
    plugin.start();
    ctx.runUntilIdle();
    return this;
  }

  /** A track in {@code in}, as draw-symbols places it. */
  UUID track(Layer in, Position at, @Nullable Double direction, @Nullable Double speed, @Nullable String name) {
    UUID id = UUID.randomUUID();
    applied(ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.createObject(id, content(in, at, direction, speed, name, ctx.defaultLabel()))));
    ctx.runUntilIdle();
    return id;
  }

  UUID track(Position at) {
    return track(layer, at, null, null, "Hawk 1");
  }

  /** The simulator's move of a track: position, direction and speed. */
  void move(UUID id, Position at, @Nullable Double direction, @Nullable Double speed) {
    MapObject o = object(id);
    MapObjectContent c = o.content();
    String name = c.properties() == null ? null : c.properties().name();
    applied(ctx.store().applyAs(Actor.plugin("simulator"), Change.updateObject(o, content(in(c), at, direction, speed, name, c.label()))));
    ctx.runUntilIdle();
  }

  void relabel(UUID id, SecurityLabel label) {
    MapObject o = object(id);
    MapObjectContent c = o.content();
    Position at = ((Geometry.Point) c.geometry()).coordinates();
    Modifiers m = c.symbol() == null ? null : c.symbol().modifiers();
    applied(ctx.store().applyAs(Actor.plugin("layer-panel"), Change.updateObject(o,
        content(in(c), at, m == null ? null : m.direction(), m == null ? null : m.speed(), c.properties() == null ? null : c.properties().name(), label))));
    ctx.runUntilIdle();
  }

  void delete(UUID id) {
    applied(ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.deleteObject(object(id))));
    ctx.runUntilIdle();
  }

  private Layer in(MapObjectContent c) {
    return c.layerId().equals(layer.id()) ? layer : viewLayer;
  }

  MapObject object(UUID id) {
    MapObject o = ctx.store().object(id);
    assertThat(o).as("object %s", id).isNotNull();
    return o;
  }

  static MapObjectContent content(Layer in, Position at, @Nullable Double direction, @Nullable Double speed, @Nullable String name, SecurityLabel label) {
    Modifiers m = direction == null && speed == null ? null : new Modifiers(Map.of(), direction, speed);
    return new MapObjectContent(MapObjectContent.SYMBOL, DataType.GENERAL, MapObjectContent.MANUAL, null, in.id(), new Geometry.Point(at),
        new Symbol(SymbolStandard.APP_6D, UAV, m), null, name == null ? null : new ObjectProperties(name, null), label, Extensions.empty());
  }

  private static void applied(ChangeOutcome outcome) {
    assertThat(outcome).isInstanceOf(ChangeOutcome.Applied.class);
  }

  // ---------------------------------------------------------------- the endpoints

  JsonObject get() {
    FakeHttpExchange call = ctx.call("/cameras");
    ctx.runUntilIdle();
    return answer(call, 200);
  }

  FakeHttpExchange post(String path, String json) {
    FakeHttpExchange call = ctx.post(path, TestJson.parse(json));
    ctx.runUntilIdle();
    return call;
  }

  FakeHttpExchange post(String path, String json, User user) {
    FakeHttpExchange call = ctx.post(path, dev.emcc.sdk.http.Headers.empty(), TestJson.parse(json), user);
    ctx.runUntilIdle();
    return call;
  }

  /** Creates a camera on {@code platform} with {@code settings} (a JSON object's members, or empty) and returns its id. */
  UUID camera(UUID platform, String settings) {
    String body = "{\"platform\": \"" + platform + "\"" + (settings.isBlank() ? "" : ", " + settings) + "}";
    JsonObject made = answer(post("/cameras", body), 200);
    return UUID.fromString(made.getString("id"));
  }

  JsonObject camera(UUID id) {
    for (JsonValue v : ((dev.emcc.sdk.json.JsonArray) get().get("cameras")).values()) {
      JsonObject c = (JsonObject) v;
      if (c.getString("id").equals(id.toString())) {
        return c;
      }
    }
    throw new AssertionError("no camera " + id);
  }

  static JsonObject answer(FakeHttpExchange call, int status) {
    assertThat(call.isAnswered()).as("answered").isTrue();
    String body = call.reply().body().toUtf8();
    assertThat(call.reply().status()).as(body).isEqualTo(status);
    return (JsonObject) TestJson.parse(body);
  }

  static User user(String... permissions) {
    return User.of("u1", "Test user", Set.of(permissions));
  }

  /** ECore's clock in the test kit: the fake's virtual wall clock. */
  static final class FakeClock extends Clock {
    private final FakePluginContext ctx;

    FakeClock(FakePluginContext ctx) {
      this.ctx = ctx;
    }

    @Override
    public ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
      return this;
    }

    @Override
    public Instant instant() {
      return ctx.clock();
    }
  }
}
