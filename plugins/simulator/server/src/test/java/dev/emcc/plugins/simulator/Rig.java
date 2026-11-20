package dev.emcc.plugins.simulator;

import dev.emcc.sdk.DataType;
import dev.emcc.sdk.RelationKind;
import dev.emcc.sdk.Workspace;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Style;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

/** The plugin started as the plugin host starts it, with the Simulation workspace and a layer in it. */
final class Rig {

  static final Workspace SIMULATION = new Workspace(Picture.WORKSPACE, "Simulation", "plugin.simulator.view", "plugin.simulator.edit", 100);
  static final DataType ROUTE = new DataType(Engine.ROUTE_TYPE, "Route", null, "simulator", DataType.Defaults.NONE);
  static final String SIDC = "10031000001211000000";
  /** As the manifests declare them (SDK 1.4.0, ADR-0051). */
  static final RelationKind BEYOND_KIND = new RelationKind(Sensors.BEYOND, "Beyond output reach", RelationKind.Line.of("#FF0000"), true);
  static final RelationKind PAIRING_KIND = new RelationKind(Sensors.PAIRING, "GMTI Pairing", RelationKind.Line.of("#FFFF00"), false);
  static final RelationKind OTHER_KIND = new RelationKind("other.link", "Other link", RelationKind.Line.of("#00FF00"), false);

  final FakePluginContext ctx;
  final SimulatorPlugin plugin;
  final Layer layer;
  final Layer viewLayer;

  Rig() {
    this(new dev.emcc.sdk.DeclaredField[0]);
  }

  /** With other plugins' declared fields (ADR-0038), as ECore gives them, and {@code gmti} loaded. */
  Rig(dev.emcc.sdk.DeclaredField... fields) {
    this(true, fields);
  }

  /** SDK 1.4.0: the simulator's own relation kind and a test plugin's are always declared; {@code gmti.pairing} when {@code gmti} is loaded. */
  Rig(boolean gmti, dev.emcc.sdk.DeclaredField... fields) {
    var kinds = new java.util.ArrayList<RelationKind>(List.of(BEYOND_KIND, OTHER_KIND));
    if (gmti) {
      kinds.add(PAIRING_KIND);
    }
    var builder = FakePluginContext.builder(Manifest.id()).settings(Manifest.settingDefaults()).dataTypes(ROUTE).workspaces(SIMULATION)
        .declaredFields(fields).relationKinds(kinds.toArray(RelationKind[]::new));
    // cot's field set "CoT unit" (ADR-0050), of the cot fields given.
    List<String> cot = java.util.Arrays.stream(fields).filter(f -> f.plugin().equals("cot")).map(dev.emcc.sdk.DeclaredField::name).toList();
    if (!cot.isEmpty()) {
      builder.fieldSets(new dev.emcc.sdk.FieldSet("cot", "unit", "CoT unit", cot));
    }
    ctx = builder.build();
    plugin = new SimulatorPlugin(new FakeClock(ctx));
    UUID id = UUID.randomUUID();
    ctx.store().applyAs(Actor.plugin("layer-panel"),
        Change.createLayer(id, new LayerContent("Blue force", 1, true, ctx.defaultLabel(), Extensions.empty(), Picture.WORKSPACE)));
    layer = ctx.store().layers().stream().filter(l -> l.id().equals(id)).findFirst().orElseThrow();
    viewLayer = ctx.store().seedLayer("Real world");
  }

  Rig started() {
    plugin.init(ctx);
    plugin.start();
    ctx.runUntilIdle();
    return this;
  }

  @SuppressWarnings("unchecked")
  WorkerRef<EngineMsg> engine() {
    return (WorkerRef<EngineMsg>) ctx.worker("engine");
  }

  void send(EngineMsg message) {
    engine().send(message);
    ctx.runUntilIdle();
  }

  /** Moves virtual time on by whole seconds, one tick each. */
  void seconds(int n) {
    ctx.advance(Duration.ofSeconds(n));
  }

  /** A GET by the no-login user, answered. */
  FakeHttpExchange get(String path) {
    FakeHttpExchange call = ctx.call(path);
    ctx.runUntilIdle();
    return call;
  }

  /** A POST by the no-login user (every permission), answered. */
  FakeHttpExchange post(String path, String json) {
    FakeHttpExchange call = ctx.post(path, Routes.json(json));
    ctx.runUntilIdle();
    return call;
  }

  /** {@code POST /routes/{route}/<action>}, which must succeed. */
  void control(UUID route, String action) {
    ok(post("/routes/" + route + "/" + action, "{}"));
  }

  /** {@code POST /routes/<action>} for every route, which must succeed. */
  void control(String action) {
    ok(post("/routes/" + action, "{}"));
  }

  /** {@code POST /put-on-route}, which must succeed. */
  void putOnRoute(UUID route, String kind, String more, UUID... objects) {
    ok(post("/put-on-route", "{\"route\": \"" + route + "\", \"kind\": \"" + kind + "\"" + more + ", \"objects\": " + ids(objects) + "}"));
  }

  /** {@code POST /take-off-route}, which must succeed. */
  void takeOffRoute(UUID... objects) {
    ok(post("/take-off-route", "{\"objects\": " + ids(objects) + "}"));
  }

  /** {@code cot}'s output channel to TAK, as its link offers it (ADR-0037). */
  static final dev.emcc.sdk.channel.ChannelId TAK = new dev.emcc.sdk.channel.ChannelId("cot", "tak-out");

  /** {@code cot} offers its channel, and the simulation chooses it. */
  void chooseTak() {
    ctx.channels().addOther(dev.emcc.sdk.channel.ChannelInfo.of("cot",
        dev.emcc.sdk.channel.ChannelSpec.of("tak-out", "TAK (out)", "cot").can(dev.emcc.sdk.channel.ChannelCapability.DELETE)
            .fields(List.of(new dev.emcc.sdk.model.FieldRef("cot", "team")))));
    ctx.runUntilIdle();
    ok(post("/outputs", "{\"channels\": [\"cot/tak-out\"]}"));
  }

  /** What the simulation sent to TAK, in order. */
  List<dev.emcc.sdk.channel.ChannelItem> sentToTak() {
    return ctx.channels().sent(TAK);
  }

  static String ids(UUID... objects) {
    var out = new StringBuilder("[");
    for (int i = 0; i < objects.length; i++) {
      out.append(i == 0 ? "" : ", ").append('"').append(objects[i]).append('"');
    }
    return out.append(']').toString();
  }

  static void ok(FakeHttpExchange call) {
    if (call.reply().status() != 200) {
      throw new AssertionError(call.path() + " answered " + call.reply().status() + ": " + call.reply().body().toUtf8());
    }
  }

  /** The simulator's extension of an object, or null. */
  JsonObject extension(UUID id) {
    return object(id).content().extensions().get(Manifest.id());
  }

  UUID symbol(Position at) {
    return symbol(layer, at);
  }

  UUID symbol(Layer in, Position at) {
    UUID id = UUID.randomUUID();
    symbolWithId(in, id, at);
    return id;
  }

  /** A track with a given id, as a scenario's import creates it. */
  void symbolWithId(Layer in, UUID id, Position at) {
    var content = new MapObjectContent(MapObjectContent.SYMBOL, DataType.GENERAL, MapObjectContent.MANUAL, null, in.id(), new Geometry.Point(at),
        new Symbol(SymbolStandard.APP_6D, SIDC, null), null, new ObjectProperties("Track", null), ctx.defaultLabel(), Extensions.empty());
    applied(ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.createObject(id, content)));
  }

  /** A route as the route editor makes it: the simulator's own namespace, its style. */
  UUID route(List<Position> line, String extension) {
    return route(layer, line, extension);
  }

  UUID route(Layer in, List<Position> line, String extension) {
    UUID id = UUID.randomUUID();
    applied(ctx.store().applyAs(Actor.plugin(Manifest.id()), Change.createObject(id, routeContent(in, line, Routes.json(extension), "Route 1"))));
    return id;
  }

  MapObjectContent routeContent(Layer in, List<Position> line, JsonObject extension, String name) {
    var style = new Style(null, null, null, Style.Dash.DASH, null, null, null, null, Style.PointMarkers.CIRCLE);
    return new MapObjectContent(MapObjectContent.SHAPE, Engine.ROUTE_TYPE, MapObjectContent.MANUAL, null, in.id(), new Geometry.LineString(line),
        null, style, new ObjectProperties(name, null), ctx.defaultLabel(), Extensions.empty().with(Manifest.id(), extension));
  }

  /** A user's edit of a route through the route editor. */
  void editRoute(UUID route, List<Position> line, String extension) {
    MapObject current = object(route);
    applied(ctx.store().applyAs(Actor.plugin(Manifest.id()), Change.updateObject(current, routeContent(layer, line, Routes.json(extension), "Route 1"))));
    ctx.runUntilIdle();
  }

  MapObject object(UUID id) {
    MapObject o = ctx.store().object(id);
    if (o == null) {
      throw new AssertionError("no object " + id);
    }
    return o;
  }

  Position position(UUID id) {
    return ((Geometry.Point) object(id).content().geometry()).coordinates();
  }

  static void applied(ChangeOutcome outcome) {
    if (!(outcome instanceof ChangeOutcome.Applied)) {
      throw new AssertionError("not applied: " + outcome);
    }
  }

  /** A route's extension with one single object on it. */
  static String single(UUID object, String points) {
    return "{\"points\": " + points + ", \"groups\": [{\"kind\": \"single\", \"objects\": [{\"id\": \"" + object + "\"}]}]}";
  }

  /** The fake context's virtual wall clock. */
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
