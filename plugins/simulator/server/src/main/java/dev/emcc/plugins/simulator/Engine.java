package dev.emcc.plugins.simulator;

import dev.emcc.plugins.simulator.EngineMsg.Action;
import dev.emcc.plugins.simulator.EngineMsg.Write;
import dev.emcc.plugins.simulator.RouteDefinition.Choice;
import dev.emcc.plugins.simulator.RouteDefinition.Group;
import dev.emcc.plugins.simulator.RouteDefinition.GroupKind;
import dev.emcc.plugins.simulator.RouteDefinition.Member;
import dev.emcc.plugins.simulator.RoutePlan.Motion;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.PluginStatus;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.channel.ChannelKind;
import dev.emcc.sdk.channel.SensorType;
import dev.emcc.sdk.document.DocumentResult;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.FieldValue;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Relation;
import dev.emcc.sdk.RelationKind;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.TimeAttributes;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.ObjectQuery;
import dev.emcc.sdk.store.QueryResult;
import dev.emcc.sdk.store.StoreUpdate;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.WorkerContext;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * The engine worker (brief functions 9 to 17): owns the simulation's state, and once a second
 * moves every track of a running route to where it is at the tick's wall-clock time, so a late tick
 * does not slow the simulation. Each tick submits all its moves at once, as ordinary updates marked
 * not saved (ADR-0041), with at most one change per object in flight; a track still waiting is
 * skipped and counted. Each move is built from the latest state held.
 *
 * <p><b>Tracks.</b> Each track has its own clock on its route's plan: seconds since it left the
 * first point. A convoy's members run the same motion, each later by the time the one ahead takes
 * to go the spacing (A7), so a member still waiting has a clock below 0. A formation's members share
 * the centre's clock and keep their offsets around it (Q16).
 *
 * <p><b>Saved writes.</b> Putting objects on a route, a reset, a pause, an edit while paused, and
 * taking objects off a route are saved updates, written at once (open question 9). The server
 * part's writes of a route's object list are built from the latest version held, one in flight per
 * route; until the store applies them, the engine acts on the list with them applied.
 *
 * <p><b>Events</b> fire for each track as it passes their point (A17), as saved updates written
 * with that tick's move (A18, A19); what a reset restores is kept on the track (Q8, {@link Effects}).
 *
 * <p><b>Outputs.</b> While the simulation runs, each tick sends every visible track of the
 * simulation to the chosen output channels, with an expiry {@code outputStaleSeconds} after the tick
 * (A21; {@link Outputs}).
 *
 * <p><b>Saving</b> (ADR-0041): a saving moment makes the next tick write every track as a saved
 * update and the documents with that tick's state (A12, A22; {@link SavedState}). When the worker
 * starts, it reads its saved state and places every track from it, everything paused (A23); until
 * then nothing moves.
 */
final class Engine implements Handler<EngineMsg> {

  static final String ROUTE_TYPE = "simulator.route";
  static final String VIEW_PERMISSION = "plugin.simulator.view";
  static final String EDIT_PERMISSION = "plugin.simulator.edit";
  static final String RUN_PERMISSION = "plugin.simulator.run";
  static final Duration MOVE_TIMEOUT = Duration.ofSeconds(2);

  /** The model's longest name. */
  private static final int MAX_NAME = 256;

  /** The name of the layer the server part creates when Simulation has none (function 2, from M4). */
  static final String FIRST_LAYER = "Simulation";
  static final Duration QUERY_TIMEOUT = Duration.ofSeconds(10);
  /** A tick slower than this makes the plugin's status a warning (brief function 17a). */
  static final Duration SLOW_TICK = Duration.ofMillis(500);
  /** The most objects one command names. */
  static final int MAX_COMMAND_OBJECTS = 5_000;
  /** How often a saved write the store refuses is tried again before it is given up. */
  static final int MAX_REFUSALS = 3;
  /** The most output channels one choice names. */
  static final int MAX_OUTPUTS = 1_000;
  /** Below this, a place along the route has reached a point (metres). */
  private static final double REACHED = 1e-6;
  /** The longest route entry in the status. */
  private static final int STATUS_ITEM = 120;

  /** A route's run state (brief function 14). An ended route stopped at its last point and still counts as running. */
  enum RunState {
    PAUSED,
    RUNNING,
    ENDED
  }

  /**
   * One of the server part's own edits of a route's object list: take {@code remove} off it, then
   * add {@code add} at its end. Applying it twice gives what applying it once gives.
   */
  record ListEdit(Set<UUID> remove, List<Group> add) {
    ListEdit {
      remove = Set.copyOf(remove);
      add = List.copyOf(add);
    }

    List<Group> applyTo(List<Group> groups) {
      Set<UUID> out = new HashSet<>(remove);
      add.forEach(g -> g.members().forEach(m -> out.add(m.id())));
      List<Group> result = new ArrayList<>();
      for (Group g : groups) {
        Group left = g.without(out);
        if (left != null) {
          result.add(left);
        }
      }
      result.addAll(add);
      return result;
    }
  }

  /** A route as the engine holds it. Mutable; owned by this worker. */
  private static final class Route {
    MapObject object;
    List<Position> line = List.of();
    @Nullable RouteDefinition definition;
    @Nullable RoutePlan plan;
    List<Problem> problems = List.of();
    RunState state = RunState.PAUSED;
    /** The number of the last edit choice seen (function 9); a different one is a new choice. */
    long editNumber = -1;
    /** The server part's edits of the object list that the store has not applied yet. */
    final List<ListEdit> pending = new ArrayList<>();
    /** How many of {@link #pending} the write in flight carries; 0 when none is in flight. */
    int writing;
    /** How often the store refused the write of the first pending edits; after a refusal the write waits for the next tick. */
    int refusals;
    boolean waitForTick;
    /** Ids whose removal from the list the store refused {@link #MAX_REFUSALS} times: not asked again. */
    final Set<UUID> givenUp = new HashSet<>();
    /** The last object list read, kept while the extension cannot be read, so its objects stay on it. */
    List<Group> lastGroups = List.of();

    Route(MapObject object) {
      this.object = object;
    }

    boolean runnable() {
      return plan != null && problems.isEmpty();
    }

    /** The object list with the server part's pending edits applied; the last one read while the extension cannot be read. */
    List<Group> groups() {
      RouteDefinition d = definition;
      List<Group> groups = d == null ? lastGroups : d.groups();
      for (ListEdit edit : pending) {
        groups = edit.applyTo(groups);
      }
      return groups;
    }
  }

  /** A track on a route. Mutable; owned by this worker. */
  private static final class Track {
    final UUID id;
    final UUID route;
    GroupKind kind = GroupKind.SINGLE;
    Member member;
    /** A formation's centre altitude, kept where the route's altitude is empty (A11). */
    @Nullable Double groupAltitude;
    /** A convoy member's place in its convoy, 0 for the first. */
    int convoyIndex;
    double spacing;
    /** Where a reset or "Put on route" left it: at the start, its clock not yet set. */
    boolean atStart = true;
    /** Seconds on the route up to {@link #since}, or in all while paused. */
    double elapsed;
    /** When its route last started for it; null while paused. */
    @Nullable Instant since;
    /** Where it was when its route last became invalid, for when the route is valid again; -1 when not. */
    int anchorLeg = -1;
    double anchorFraction;
    /** It needs a saved update to where it is: put on route, reset, paused, or its route edited while paused. */
    boolean placeDue = true;
    /** Hidden by an event: it stands where it stopped, and is not sent (function 13). */
    boolean hidden;
    /** The first point whose events it has not passed (A17). */
    int nextEvent;
    /** What events, a reset or "Put on route" do to it at its next saved write. */
    final List<Effects.Effect> effects = new ArrayList<>();

    Track(UUID id, UUID route, Member member) {
      this.id = id;
      this.route = route;
      this.member = member;
    }

    double secondsAt(Instant now) {
      Instant from = since;
      return from == null ? elapsed : elapsed + Duration.between(from, now).toNanos() / 1e9;
    }

    void pause(Instant now) {
      elapsed = secondsAt(now);
      since = null;
    }

    /** Its clock when it leaves the start: a convoy member waits for the ones ahead (A7). */
    double startSeconds(RoutePlan plan) {
      return kind == GroupKind.CONVOY ? -convoyIndex * plan.secondsAtDistance(spacing) : 0;
    }

    double seconds(RoutePlan plan, Instant now) {
      return atStart ? startSeconds(plan) : secondsAt(now);
    }
  }

  /**
   * Where a track is to be.
   *
   * @param altitude metres above the ellipsoid, or null: it keeps its own
   * @param direction degrees from true north
   * @param speed m/s
   */
  record Placement(Position position, @Nullable Double altitude, double direction, double speed) {}

  /** The counts the status shows (brief function 17a), since the worker started. */
  private static final class Counts {
    long submitted;
    long skipped;
    long refused;
    long lost;
    long answered;
    long lastTickMillis;
    int lastTickMoves;
    long listWrites;
    long listRefused;
    long deleted;
    long eventsFired;
    long eventsRefused;
    long saves;
    long documentFailures;
    long relationsRefused;
  }

  /** A command's answer when it cannot be carried out. */
  private static final class Refusal extends Exception {
    final int status;

    Refusal(int status, String message) {
      super(message, null, false, false);
      this.status = status;
    }
  }

  private final PluginContext context;
  private final Clock clock;
  private final Picture picture = new Picture();
  private final Map<UUID, Route> routes = new LinkedHashMap<>();
  private final Map<UUID, Track> tracks = new LinkedHashMap<>();
  /** Objects taken off their routes: each gets a saved update with speed 0, in place (function 9). */
  private final Set<UUID> stopDue = new LinkedHashSet<>();
  /** Objects with a write of the engine's in flight: at most one each. */
  private final Set<UUID> inFlight = new HashSet<>();
  /** How often the store refused the saved writes of an object in a row. */
  private final Map<UUID, Integer> placeRefusals = new HashMap<>();
  /** What events changed, carried by a saved write in flight: put back if its answer is lost. */
  private final Map<UUID, List<Effects.Effect>> carried = new HashMap<>();
  /** "Put on route" shows hidden objects again (Q18), and names unnamed ones (T-121). */
  private final Set<UUID> showOnPut = new HashSet<>();
  /** The highest number given to "<route name>-<n>" since the start, as names in flight are not in the picture yet. */
  private final Map<String, Integer> lastNumbers = new HashMap<>();
  /** The content each track was given at this tick, for the outputs. */
  private final Map<UUID, MapObjectContent> fresh = new HashMap<>();
  private final Outputs outputs = new Outputs(ChannelKind.GROUND_TRUTH);
  private final Sensors sensors = new Sensors();
  /** Whether {@code gmti.pairing} is declared (function 30): read once, as the loaded plugins are fixed while the server runs. */
  private @Nullable Boolean pairing;
  /** The picture as the sensors see it: this tick's contents first. */
  private final Sensors.View view = new Sensors.View() {
    @Override
    public @Nullable MapObjectContent content(UUID id) {
      MapObject object = picture.object(id);
      return isTrack(object) ? fresh.getOrDefault(id, object.content()) : null;
    }

    @Override
    public boolean hidden(UUID id) {
      Track track = tracks.get(id);
      MapObject object = picture.object(id);
      return track != null ? track.hidden : object != null && Effects.hidden(object.content(), context.pluginId());
    }

    @Override
    public List<UUID> tracks() {
      return picture.objects().stream().filter(Engine::isTrack).map(MapObject::id).toList();
    }
  };
  private final Counts counts = new Counts();
  private long staleSeconds;
  /** A saving moment came: the next tick saves (A12). */
  private boolean saveDue;
  /** The saved state is read and applied; until then nothing moves and commands answer 503 (A23). */
  private boolean restored;
  private boolean stateAsked;
  private SavedState.@Nullable Loaded saved;
  /** The saved state as read so far, while track documents are still to come. */
  private SavedState.@Nullable Loaded reading;
  private int documentsToRead;
  private final Set<String> readingKeys = new HashSet<>();
  /** Track documents whose read failed: read again at the next tick. */
  private final Set<String> failedReads = new LinkedHashSet<>();
  /** How many track documents the last save wrote, so a smaller save deletes the rest. */
  private int trackDocuments;
  private boolean querying;
  /** Whether this start has looked for Simulation's layers yet (function 2: the first layer, from M4). */
  private boolean layersChecked;
  private String lastStatus = "";

  Engine(PluginContext context, Clock clock) {
    this.context = context;
    this.clock = clock;
    this.staleSeconds = staleSeconds(context.settings());
    sensors.startDrawn(clock.instant());
  }

  /** The admin setting {@code outputStaleSeconds}, 1 to 3 600 (the settings schema enforces it). */
  static long staleSeconds(JsonObject settings) {
    return settings.get("outputStaleSeconds") instanceof JsonNumber n ? Math.clamp((long) n.doubleValue(), 1, 3600) : 5;
  }

  @Override
  public void handle(EngineMsg message, WorkerContext<EngineMsg> ctx) {
    switch (message) {
      case EngineMsg.Updated(StoreUpdate.Snapshot s) -> {
        picture.replace(s.objects(), s.layers(), s.sequenceNo());
        firstLayer(ctx);
        refresh(ctx);
      }
      case EngineMsg.Updated(StoreUpdate.Changes c) -> {
        if (!picture.changes(c.events())) {
          querying = false; // too many waited: ask again
        }
        if (picture.loaded()) {
          if (c.events().stream().anyMatch(this::reshapes)) {
            refresh(ctx);
          }
        } else {
          load(ctx);
        }
      }
      case EngineMsg.Found f -> found(f.result(), ctx);
      case EngineMsg.Tick ignored -> {
        if (!picture.loaded()) {
          load(ctx);
        } else if (restored) {
          tick(ctx);
        } else {
          askState(ctx);
          readAgain(ctx);
        }
      }
      case EngineMsg.Written w -> written(w, ctx);
      case EngineMsg.LayerCreated l -> {
        if (l.outcome() instanceof ChangeOutcome.Applied) {
          ctx.log().info("created the layer \"{}\" (Simulation had no layers)", FIRST_LAYER);
        } else {
          ctx.log().warn("could not create the layer \"{}\": {}", FIRST_LAYER, l.outcome());
        }
      }
      case EngineMsg.Control c -> control(c.action(), c.request(), ctx);
      case EngineMsg.PutOnRoute p -> command(p.request(), ctx, this::putOnRoute);
      case EngineMsg.TakeOffRoute t -> command(t.request(), ctx, this::takeOffRoute);
      case EngineMsg.GetOutputs g -> respond(g.request(), 200, outputs.json());
      case EngineMsg.ChooseOutputs c -> chooseOutputs(c.request());
      case EngineMsg.Channels c -> {
        outputs.listed(c.list());
        sensors.listed(c.list(), running());
        if (restored) {
          writeTracks(ctx, clock.instant(), false); // CR-0035: what is beyond an output is written at once
        }
        report();
      }
      case EngineMsg.Settings s -> staleSeconds = staleSeconds(s.settings()); // a stored maxEmptyDwellsPerTargetDwell is ignored (T-196, UQ A)
      case EngineMsg.Document d -> document(d.result(), ctx);
      case EngineMsg.Stop ignored -> stop(ctx);
      case EngineMsg.GetRoutes g -> respond(g.request(), 200, routesJson());
      case EngineMsg.GetRoute g -> answerRoute(g.request());
      case EngineMsg.GetSensors g -> respond(g.request(), 200, sensors.json(view, running(), pairing()));
      case EngineMsg.GetDwells g -> answerDwells(g.request());
      case EngineMsg.SaveSensor s -> saveSensor(s.request(), ctx);
      case EngineMsg.RemoveSensor r -> removeSensor(r.request(), ctx);
      case EngineMsg.GetScenarioState g -> respond(g.request(), 200, scenarioState());
      case EngineMsg.ImportScenarioState i -> importScenarioState(i.request(), ctx);
    }
  }

  // ---------------------------------------------------------------- the picture

  /** The store query naming the workspace (function 2, N9), for the subscription and a restarted worker. */
  static ObjectQuery workspaceQuery() {
    return ObjectQuery.all().inWorkspaces(Picture.WORKSPACE);
  }

  /** A restarted worker has no snapshot: it asks for the picture once, and keeps the changes meanwhile. */
  private void load(WorkerContext<EngineMsg> ctx) {
    if (!querying) {
      querying = true;
      context.store().query(workspaceQuery(), QUERY_TIMEOUT, ctx.self(), EngineMsg.Found::new);
    }
  }

  /**
   * The first layer (function 2, from M4; the owner's BT and BX): once per start, at the first
   * complete picture, Simulation gets a layer "Simulation" when it has none, as ECore gives View
   * "Drawing". Later snapshots (a store restart, a subscription that fell behind) create none.
   */
  private void firstLayer(WorkerContext<EngineMsg> ctx) {
    if (layersChecked) {
      return;
    }
    layersChecked = true;
    if (picture.hasLayers()) {
      return;
    }
    LayerContent content = new LayerContent(FIRST_LAYER, 0, true, context.defaultLabel(), Extensions.empty(), Picture.WORKSPACE);
    context.store().submit(Change.createLayer(UUID.randomUUID(), content), MOVE_TIMEOUT, ctx.self(), EngineMsg.LayerCreated::new);
  }

  private void found(QueryResult result, WorkerContext<EngineMsg> ctx) {
    querying = false;
    if (picture.loaded()) {
      return;
    }
    switch (result) {
      case QueryResult.Found f -> {
        picture.replace(f.objects(), f.layers(), f.sequenceNo());
        firstLayer(ctx);
        refresh(ctx);
      }
      case QueryResult.Failed failed -> ctx.log().warn("the simulation's objects could not be loaded: {}", failed.reason());
      case QueryResult.TimedOut t -> ctx.log().warn("loading the simulation's objects timed out; trying again");
    }
  }

  /**
   * Reads the routes again, and which tracks are on which route, after the picture changed. A route
   * that is gone, is no longer a route, or left Simulation disconnects its objects (functions 9a, 9b).
   */
  private void refresh(WorkerContext<EngineMsg> ctx) {
    Instant now = clock.instant();
    Map<UUID, Route> seen = new LinkedHashMap<>();
    boolean changed = false;
    for (MapObject object : picture.objects()) {
      if (!isRoute(object)) {
        continue;
      }
      Route route = routes.get(object.id());
      if (route == null) {
        route = new Route(object);
        read(route, now, true);
        changed = true;
      } else if (route.object.version() != object.version()) {
        route.object = object;
        read(route, now, false);
        changed = true;
      }
      seen.put(object.id(), route);
    }
    changed |= !seen.keySet().containsAll(routes.keySet());
    routes.clear();
    routes.putAll(seen);
    for (Route route : routes.values()) {
      if (route.state != RunState.PAUSED && !route.runnable()) {
        // A route that becomes invalid while it runs pauses, its objects in place (function 9b).
        pause(route, now);
      }
    }
    if (!restored) {
      askState(ctx);
      if (saved != null) {
        restore(ctx, now);
      } else {
        report();
      }
      return;
    }
    if (changed) {
      saveDue = true; // a change of the simulation's routes (A22)
    }
    assignTracks(now);
    writeRoutes(ctx, false);
    writeTracks(ctx, now, false);
    report();
  }

  /**
   * Whether an event can change the routes or which tracks are on them; a track's move cannot, so
   * the burst of each tick's own moves needs no refresh.
   */
  private boolean reshapes(ChangeEvent event) {
    if (event.entityType() != EntityType.OBJECT || event.operation() != Operation.UPDATE || routes.containsKey(event.entityId())) {
      return true;
    }
    return event.state() instanceof MapObject object && isRoute(object);
  }

  private static boolean isRoute(MapObject object) {
    MapObjectContent c = object.content();
    return ROUTE_TYPE.equals(c.dataType()) && MapObjectContent.SHAPE.equals(c.type()) && c.geometry() instanceof Geometry.LineString;
  }

  private static boolean isTrack(@Nullable MapObject object) {
    return object != null && MapObjectContent.SYMBOL.equals(object.content().type()) && object.content().geometry() instanceof Geometry.Point;
  }

  /**
   * Reads a route's new version. An edit of its line or its points' values is an edit of the route
   * (function 9): with a new "disconnect" choice its objects are taken off it; otherwise they move
   * with it, on the same leg at the same fraction (also for edits by other plugins, function 9b).
   */
  private void read(Route route, Instant now, boolean first) {
    MapObjectContent c = route.object.content();
    List<Position> line = ((Geometry.LineString) c.geometry()).coordinates();
    RouteDefinition.Parsed parsed = RouteDefinition.parse(c.extensions().get(context.pluginId()), line.size());
    List<Problem> problems = new ArrayList<>(parsed.problems());
    RouteDefinition before = route.definition;
    RoutePlan oldPlan = route.runnable() ? route.plan : null;
    RouteDefinition after = parsed.definition();
    route.definition = after;
    if (after != null) {
      route.lastGroups = after.groups();
    }
    route.plan = null;
    if (after != null) {
      RoutePlan plan = RoutePlan.of(line, after);
      route.plan = plan;
      problems.addAll(plan.problems());
    }
    route.problems = List.copyOf(problems);
    boolean edited = !first && (before == null || after == null || !before.points().equals(after.points()) || !line.equals(route.line));
    route.line = line;
    RouteDefinition.EditChoice choice = after == null ? null : after.edit();
    boolean newChoice = choice != null && !first && choice.number() != route.editNumber;
    if (choice != null) {
      route.editNumber = choice.number();
    }
    if (!edited) {
      return;
    }
    if (newChoice && choice.objects() == Choice.DISCONNECT) {
      Set<UUID> all = new HashSet<>();
      route.groups().forEach(g -> g.members().forEach(m -> all.add(m.id())));
      if (!all.isEmpty()) {
        route.pending.add(new ListEdit(all, List.of()));
      }
      return;
    }
    moveWith(route, oldPlan, now);
  }

  /** The route's tracks keep their leg and its fraction on the edited route (function 9, A9). */
  private void moveWith(Route route, @Nullable RoutePlan oldPlan, Instant now) {
    RoutePlan plan = route.runnable() ? route.plan : null;
    for (Track t : tracksOf(route)) {
      if (route.state == RunState.PAUSED) {
        t.placeDue = true; // it stands where the edit puts it
      }
      if (t.atStart) {
        continue; // it stays at the start, wherever that now is
      }
      double seconds = t.secondsAt(now);
      if (seconds < 0) {
        continue; // a convoy member still waiting goes on waiting
      }
      int leg;
      double fraction;
      if (oldPlan != null) {
        Motion m = oldPlan.at(seconds);
        leg = m.leg();
        fraction = m.fraction();
      } else if (t.anchorLeg >= 0) {
        leg = t.anchorLeg;
        fraction = t.anchorFraction;
      } else {
        continue;
      }
      if (plan == null) {
        t.anchorLeg = leg;
        t.anchorFraction = fraction;
        continue;
      }
      t.anchorLeg = -1;
      t.elapsed = plan.secondsAt(leg, fraction);
      if (t.since != null) {
        t.since = now;
      }
      t.nextEvent = passed(plan, place(t, plan, t.elapsed)); // the events behind it count as passed
    }
  }

  /**
   * The routes' lists decide which objects are on which route; an object on two lists stays on the
   * first. An object taken off every list is stopped in place (function 9); a list's id that is no
   * track of the simulation, such as a deleted one, is taken off the list (function 9a, A10).
   */
  private void assignTracks(Instant now) {
    Map<UUID, Track> assigned = new LinkedHashMap<>();
    for (Route route : routes.values()) {
      Set<UUID> gone = new HashSet<>();
      for (Group group : route.groups()) {
        int index = 0;
        for (Member member : group.members()) {
          MapObject object = picture.object(member.id());
          if (!isTrack(object)) {
            if (!route.givenUp.contains(member.id())) {
              gone.add(member.id());
            }
            continue;
          }
          if (assigned.containsKey(member.id())) {
            continue;
          }
          Track track = tracks.get(member.id());
          if (track == null || !track.route.equals(route.object.id())) {
            track = new Track(member.id(), route.object.id(), member);
            setGroup(track, group, member, index);
            track.hidden = Effects.hidden(object.content(), context.pluginId());
            boolean put = showOnPut.remove(member.id());
            if (put && track.hidden) {
              track.hidden = false; // put on a route again, it is shown and sent again (Q18)
              track.effects.add(new Effects.Show());
            }
            if (put && unnamed(object)) {
              track.effects.add(new Effects.Name(nextName(route))); // a name for the outputs, such as a callsign (T-121)
            }
            RoutePlan plan = route.plan;
            if (route.state != RunState.PAUSED && route.runnable() && plan != null) {
              // Put on a running route, it leaves at once (the owner's Q6, 2026-10-27).
              track.atStart = false;
              track.elapsed = track.startSeconds(plan);
              track.since = now;
            }
          } else {
            setGroup(track, group, member, index);
          }
          assigned.put(member.id(), track);
          index++;
        }
      }
      if (!gone.isEmpty()) {
        route.pending.add(new ListEdit(gone, List.of()));
      }
    }
    for (Track old : tracks.values()) {
      if (assigned.containsKey(old.id)) {
        continue;
      }
      if (picture.object(old.id) == null) {
        counts.deleted++;
      } else {
        stopDue.add(old.id);
      }
    }
    tracks.clear();
    tracks.putAll(assigned);
    stopDue.removeIf(id -> assigned.containsKey(id) || picture.object(id) == null);
  }

  private static boolean unnamed(MapObject object) {
    ObjectProperties properties = object.content().properties();
    return properties == null || properties.name() == null || properties.name().isBlank();
  }

  /**
   * The name "Put on route" gives an unnamed object (T-121, A74): the route's name and one more than
   * the highest number any symbol in Simulation has after it, such as "Alpha-3"; "Track-1" for a
   * route without a name.
   */
  private String nextName(Route route) {
    ObjectProperties properties = route.object.content().properties();
    String base = properties == null || properties.name() == null || properties.name().isBlank() ? "Track" : properties.name().strip();
    base = base.substring(0, Math.min(base.length(), MAX_NAME - 12));
    String prefix = base + "-";
    int highest = lastNumbers.getOrDefault(base, 0);
    for (MapObject o : picture.objects()) {
      ObjectProperties p = o.content().properties();
      String name = p == null ? null : p.name();
      if (MapObjectContent.SYMBOL.equals(o.content().type()) && name != null && name.startsWith(prefix)) {
        String number = name.substring(prefix.length());
        if (!number.isEmpty() && number.length() < 10 && number.chars().allMatch(c -> c >= '0' && c <= '9')) {
          highest = Math.max(highest, Integer.parseInt(number));
        }
      }
    }
    lastNumbers.put(base, highest + 1);
    return prefix + (highest + 1);
  }

  private static void setGroup(Track track, Group group, Member member, int index) {
    track.kind = group.kind();
    track.member = member;
    track.groupAltitude = group.altitude();
    track.convoyIndex = index;
    track.spacing = group.spacing();
  }

  private List<Track> tracksOf(Route route) {
    UUID id = route.object.id();
    return tracks.values().stream().filter(t -> t.route.equals(id)).toList();
  }

  // ---------------------------------------------------------------- control

  private void start(Route route, Instant now) {
    RoutePlan current = route.plan;
    if (route.state == RunState.ENDED || route.runnable() && current != null && atEnd(route, current, now)) {
      reset(route); // Start on a route stopped at its end runs it again, also after a pause (the owner's Q7, 2026-10-27)
    }
    RoutePlan plan = route.plan;
    if (route.state != RunState.PAUSED || !route.runnable() || plan == null) {
      return;
    }
    route.state = RunState.RUNNING;
    for (Track t : tracksOf(route)) {
      if (t.atStart) {
        t.atStart = false;
        t.elapsed = t.startSeconds(plan);
      }
      if (!t.hidden) {
        t.since = now; // a hidden track stays where it stopped
      }
    }
  }

  /** Whether the route has objects and all of them have reached its end; a hidden one counts as arrived (Q9). */
  private boolean atEnd(Route route, RoutePlan plan, Instant now) {
    List<Track> onRoute = tracksOf(route);
    return !onRoute.isEmpty() && onRoute.stream().allMatch(t -> t.hidden || t.seconds(plan, now) >= plan.durationSeconds());
  }

  /** Paused, its tracks stand where they are, with speed 0. */
  private void pause(Route route, Instant now) {
    if (route.state == RunState.PAUSED) {
      return;
    }
    route.state = RunState.PAUSED;
    for (Track t : tracksOf(route)) {
      t.pause(now);
      t.placeDue = true;
    }
  }

  /**
   * Every object back where it started, the values events changed restored and hidden objects
   * shown again, the route paused (function 14).
   */
  private void reset(Route route) {
    route.state = RunState.PAUSED;
    for (Track t : tracksOf(route)) {
      t.atStart = true;
      t.elapsed = 0;
      t.since = null;
      t.anchorLeg = -1;
      t.placeDue = true;
      t.hidden = false;
      t.nextEvent = 0;
      t.effects.add(new Effects.Restore());
    }
  }

  private void control(Action action, EndpointRequest request, WorkerContext<EngineMsg> ctx) {
    if (!restored) {
      respond(request, 503, error("the simulation is loading; try again"));
      return;
    }
    String id = request.pathParameters().get("id");
    Route one = id == null ? null : routes.get(uuidOrNull(id));
    if (id != null && one == null) {
      respond(request, 404, error("no such route in the simulation"));
      return;
    }
    if (one != null && action == Action.START && !one.runnable()) {
      respond(request, 409, error("the route cannot run: " + firstProblem(one)));
      return;
    }
    Instant now = clock.instant();
    for (Route route : one == null ? List.copyOf(routes.values()) : List.of(one)) {
      switch (action) {
        case START -> start(route, now);
        case PAUSE -> pause(route, now);
        case RESET -> {
          reset(route);
          sensors.clearDrawn(one == null ? null : tracksOf(route).stream().map(t -> t.id).collect(java.util.stream.Collectors.toSet())); // function 43
        }
      }
    }
    saveDue = true; // before a route runs, at a pause and at a reset (ADR-0041 point 4)
    writeTracks(ctx, now, false);
    report();
    respond(request, 200, one == null ? routesJson() : json(one));
  }

  // ---------------------------------------------------------------- put on route, take off route

  @FunctionalInterface
  private interface Command {
    JsonObject run(JsonObject body) throws Refusal;
  }

  private void command(EndpointRequest request, WorkerContext<EngineMsg> ctx, Command command) {
    if (!restored) {
      respond(request, 503, error("the simulation is loading; try again"));
      return;
    }
    if (!(request.body() instanceof JsonObject body)) {
      respond(request, 400, error("the body must be a JSON object"));
      return;
    }
    JsonObject answer;
    try {
      answer = command.run(body);
    } catch (Refusal r) {
      respond(request, r.status, error(r.getMessage()));
      return;
    }
    Instant now = clock.instant();
    saveDue = true; // put on route and take off route (open question 15)
    assignTracks(now);
    writeRoutes(ctx, false);
    writeTracks(ctx, now, false);
    report();
    respond(request, 200, answer);
  }

  /**
   * "Put on route" (brief function 10): the objects become a group at the end of the route's list,
   * and leave every other list (open question 8). They go to the route's first point at once
   * (open question 9), and leave it at once if the route runs (Q6).
   */
  private JsonObject putOnRoute(JsonObject body) throws Refusal {
    Route route = routes.get(requireUuid(body.get("route"), "route"));
    if (route == null) {
      throw new Refusal(404, "no such route in the simulation");
    }
    if (route.definition == null) {
      throw new Refusal(409, "the route's values cannot be read; edit it in the route editor first");
    }
    GroupKind kind = switch (body.get("kind") instanceof JsonString s ? s.value() : "") {
      case "single" -> GroupKind.SINGLE;
      case "convoy" -> GroupKind.CONVOY;
      case "formation" -> GroupKind.FORMATION;
      default -> throw new Refusal(400, "'kind' must be single, convoy or formation");
    };
    List<UUID> ids = trackIds(body);
    List<Group> add = new ArrayList<>();
    switch (kind) {
      case SINGLE -> ids.forEach(id -> add.add(Group.single(id)));
      case CONVOY -> {
        double spacing = body.get("spacing") instanceof JsonNumber n ? n.doubleValue() : Double.NaN;
        if (!(spacing >= 1 && spacing <= RouteDefinition.MAX_OFFSET)) {
          throw new Refusal(400, "a convoy's 'spacing' must be from 1 to " + (long) RouteDefinition.MAX_OFFSET + " m");
        }
        add.add(new Group(GroupKind.CONVOY, spacing, null, ids.stream().map(id -> new Member(id, 0, 0, 0)).toList()));
      }
      case FORMATION -> add.add(formation(route, ids));
    }
    Set<UUID> moving = new HashSet<>(ids);
    for (Route other : routes.values()) {
      if (other != route && other.groups().stream().anyMatch(g -> g.members().stream().anyMatch(m -> moving.contains(m.id())))) {
        other.pending.add(new ListEdit(moving, List.of()));
      }
    }
    route.pending.add(new ListEdit(Set.of(), add));
    ids.forEach(tracks::remove); // put on again, they start again from the first point
    showOnPut.addAll(ids);
    return JsonObject.builder().put("route", JsonString.of(route.object.id().toString())).put("objects", idsJson(ids)).build();
  }

  private Group formation(Route route, List<UUID> ids) throws Refusal {
    List<Formation.Placed> placed = new ArrayList<>();
    for (UUID id : ids) {
      MapObject object = picture.object(id);
      if (object != null && object.content().geometry() instanceof Geometry.Point p) {
        placed.add(new Formation.Placed(id, p.coordinates()));
      }
    }
    List<Position> line = route.line;
    double azimuth = Geodesy.inverse(line.get(0), line.get(1)).initialAzimuth();
    Formation.Shape shape = Formation.of(placed, azimuth);
    for (Member m : shape.members()) {
      if (Math.hypot(m.forward(), m.right()) > RouteDefinition.MAX_OFFSET || Math.abs(m.up()) > RouteDefinition.MAX_ALTITUDE) {
        throw new Refusal(400, "a formation's objects must be within " + (long) RouteDefinition.MAX_OFFSET / 1000 + " km of its centre");
      }
    }
    return new Group(GroupKind.FORMATION, 0, shape.altitude(), shape.members());
  }

  /** "Take off route" (brief function 10): the objects leave their routes' lists, and stop in place. */
  private JsonObject takeOffRoute(JsonObject body) throws Refusal {
    List<UUID> ids = trackIds(body);
    Set<UUID> leaving = new HashSet<>(ids);
    for (Route route : routes.values()) {
      if (route.groups().stream().anyMatch(g -> g.members().stream().anyMatch(m -> leaving.contains(m.id())))) {
        route.pending.add(new ListEdit(leaving, List.of()));
      }
    }
    return JsonObject.builder().put("objects", idsJson(ids)).build();
  }

  private List<UUID> trackIds(JsonObject body) throws Refusal {
    if (!(body.get("objects") instanceof JsonArray list) || list.values().isEmpty() || list.size() > MAX_COMMAND_OBJECTS) {
      throw new Refusal(400, "'objects' must be a list of 1 to " + MAX_COMMAND_OBJECTS + " object ids");
    }
    List<UUID> ids = new ArrayList<>();
    for (JsonValue value : list.values()) {
      UUID id = requireUuid(value, "objects");
      if (ids.contains(id)) {
        throw new Refusal(400, "an object is named twice: " + id);
      }
      if (!isTrack(picture.object(id))) {
        throw new Refusal(404, "not a symbol in the simulation: " + id);
      }
      ids.add(id);
    }
    return ids;
  }

  private static UUID requireUuid(@Nullable JsonValue value, String name) throws Refusal {
    UUID id = value instanceof JsonString s ? uuidOrNull(s.value()) : null;
    if (id == null) {
      throw new Refusal(400, "'" + name + "' must name an object id");
    }
    return id;
  }

  private static @Nullable UUID uuidOrNull(String text) {
    try {
      return UUID.fromString(text);
    } catch (IllegalArgumentException e) {
      return null;
    }
  }

  // ---------------------------------------------------------------- writes

  /** The server part's writes of route lists: one in flight per route, built from the latest version held. */
  private void writeRoutes(WorkerContext<EngineMsg> ctx, boolean tick) {
    for (Route route : routes.values()) {
      if (route.pending.isEmpty() || route.writing > 0 || route.waitForTick && !tick) {
        continue;
      }
      route.waitForTick = false;
      MapObjectContent c = route.object.content();
      JsonObject extension = c.extensions().get(context.pluginId());
      if (extension == null) {
        route.pending.clear(); // a route without simulator values has no list
        continue;
      }
      JsonObject next = RouteDefinition.withGroups(extension, route.groups());
      if (next.equals(extension)) {
        route.pending.clear(); // the store has them already
        continue;
      }
      var content = new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(), c.geometry(), c.symbol(),
          c.style(), c.properties(), c.label(), c.extensions().with(context.pluginId(), next), c.fieldSets(), c.relations());
      UUID id = route.object.id();
      route.writing = route.pending.size();
      inFlight.add(id);
      context.store().submit(Change.updateObject(route.object, content), MOVE_TIMEOUT, ctx.self(), o -> new EngineMsg.Written(id, Write.ROUTE, o));
    }
  }

  /**
   * Submits the tracks' writes: every due saved update, and at a tick every move. A track whose
   * write is still in flight waits; at a tick it is skipped and counted.
   */
  private void writeTracks(WorkerContext<EngineMsg> ctx, Instant now, boolean tick) {
    int moves = 0;
    for (Track track : tracks.values()) {
      Route route = routes.get(track.route);
      MapObject current = picture.object(track.id);
      List<Relation> relations = current == null || route == null ? null : dueRelations(current);
      boolean saved = track.placeDue || !track.effects.isEmpty() || relations != null;
      if (route == null || current == null || !(saved || tick && route.state != RunState.PAUSED)) {
        continue;
      }
      Placement placement = placement(track, route, now);
      MapObjectContent content = placement == null ? stood(current.content(), now) : moved(current.content(), placement, now);
      if (content == null && !saved) {
        continue; // standing where it already is
      }
      if (inFlight.contains(track.id)) {
        if (tick) {
          counts.skipped++;
        }
        continue;
      }
      MapObjectContent data = content == null ? current.content() : content;
      List<FieldValue> fields = List.of();
      if (!track.effects.isEmpty()) {
        Effects.Result result = Effects.apply(data, track.effects, context.pluginId());
        data = result.content();
        fields = result.fields();
        carried.put(track.id, List.copyOf(track.effects));
        track.effects.clear();
      }
      if (relations != null) {
        data = data.withRelations(relations); // a sensor's revisit, with the move (function 30)
        sensors.written(track.id);
      }
      track.placeDue = false;
      // The outputs get the declared fields in this tick, as the store writes them (T-112).
      fresh.put(track.id, Effects.withFields(data, fields));
      submit(current, data, fields, saved, ctx);
      moves++;
    }
    for (UUID id : List.copyOf(stopDue)) {
      MapObject current = picture.object(id);
      if (current == null || inFlight.contains(id)) {
        continue;
      }
      stopDue.remove(id);
      MapObjectContent content = stood(current.content(), now);
      submit(current, content == null ? current.content() : content, List.of(), true, ctx);
    }
    writeRelations(ctx);
    if (tick) {
      counts.lastTickMoves = moves;
    }
  }

  /** Sensor platforms on no route: their relations alone, as a saved update (function 30, the ACA's R2). */
  private void writeRelations(WorkerContext<EngineMsg> ctx) {
    for (UUID id : List.copyOf(sensors.relationsDue())) {
      MapObject current = picture.object(id);
      Track track = tracks.get(id);
      if (current == null) {
        sensors.written(id);
        continue;
      }
      if (track != null && routes.containsKey(track.route) || inFlight.contains(id)) {
        continue; // with its track's write, or after the write in flight
      }
      List<Relation> relations = dueRelations(current);
      if (relations != null) {
        sensors.written(id);
        inFlight.add(id);
        counts.submitted++;
        context.store().submit(Change.updateObject(current, current.content().withRelations(relations)), MOVE_TIMEOUT, ctx.self(),
            o -> new EngineMsg.Written(id, Write.RELATIONS, o));
      }
    }
  }

  /**
   * The relations a sensor's platform should get now, or null when none are due or they are what
   * it has (A103: an unchanged list is not written).
   */
  private @Nullable List<Relation> dueRelations(MapObject current) {
    UUID id = current.id();
    if (!sensors.relationsDue().contains(id)) {
      return null;
    }
    List<Relation> stored = current.content().relations();
    List<Relation> next;
    try {
      next = sensors.relations(id, stored, pairing());
    } catch (IllegalArgumentException e) {
      counts.relationsRefused++;
      next = stored; // more than one object carries (CR-0031): kept as it is
    }
    if (next.equals(stored)) {
      sensors.written(id);
      return null;
    }
    return next;
  }

  /** Whether {@code gmti.pairing} is declared (function 30); false on an ECore without relation kinds. */
  private boolean pairing() {
    Boolean known = pairing;
    if (known == null) {
      try {
        known = context.relationKinds().stream().map(RelationKind::id).anyMatch(Sensors.PAIRING::equals);
      } catch (UnsupportedOperationException e) {
        known = false;
      }
      pairing = known;
    }
    return known;
  }

  /** Whether the simulation runs: a route running or stopped at its end (function 18). */
  private boolean running() {
    return routes.values().stream().anyMatch(r -> r.state != RunState.PAUSED);
  }

  private void submit(MapObject current, MapObjectContent data, List<FieldValue> fields, boolean saved, WorkerContext<EngineMsg> ctx) {
    UUID id = current.id();
    Write write = saved ? Write.PLACE : Write.MOVE;
    Change change = fields.isEmpty() ? Change.updateObject(current, data) : Change.updateObject(current, data).withFields(fields);
    inFlight.add(id);
    counts.submitted++;
    context.store().submit(saved ? change : change.notSaved(), MOVE_TIMEOUT, ctx.self(), o -> new EngineMsg.Written(id, write, o));
  }

  private void written(EngineMsg.Written w, WorkerContext<EngineMsg> ctx) {
    inFlight.remove(w.id());
    if (w.write() == Write.ROUTE) {
      routeWritten(w.id(), w.outcome(), ctx);
      return;
    }
    if (!(w.outcome() instanceof ChangeOutcome.Applied) && w.write() != Write.MOVE && sensors.get(w.id()) != null) {
      sensors.relationsDue().add(w.id()); // its relations may not be written: tried again from the latest state
    }
    if (w.write() == Write.RELATIONS) {
      if (w.outcome() instanceof ChangeOutcome.Applied a && a.event().state() instanceof MapObject object) {
        picture.learn(object);
      } else if (w.outcome() instanceof ChangeOutcome.Rejected r) {
        counts.relationsRefused++;
        ctx.log().warn("the relations of the sensor platform {} were refused: {}", w.id(), r.rejection().message());
      }
      return;
    }
    switch (w.outcome()) {
      case ChangeOutcome.Applied a -> {
        counts.answered++;
        placeRefusals.remove(w.id());
        carried.remove(w.id());
        if (a.event().state() instanceof MapObject object) {
          picture.learn(object);
        }
      }
      case ChangeOutcome.Rejected r -> {
        // A move: the object changed meanwhile, and the next tick uses the new state. A saved
        // write is tried again from the latest state, a few times, unless the object is gone.
        counts.refused++;
        int refused = w.write() == Write.PLACE ? placeRefusals.merge(w.id(), 1, Integer::sum) : 0;
        boolean again = w.write() == Write.PLACE && r.rejection().code() != ChangeRejection.Code.ENTITY_NOT_FOUND && refused < MAX_REFUSALS;
        refusedEffects(w.id(), r.rejection(), again, ctx);
        if (again) {
          writeAgain(w.id());
        } else if (w.write() == Write.PLACE) {
          placeRefusals.remove(w.id());
          ctx.log().warn("the object {} could not be placed: {}", w.id(), r.rejection().message());
        }
      }
      case ChangeOutcome.Unknown u -> {
        counts.lost++;
        List<Effects.Effect> lost = carried.remove(w.id());
        Track track = tracks.get(w.id());
        if (lost != null && track != null) {
          track.effects.addAll(0, lost);
        }
        if (w.write() == Write.PLACE) {
          writeAgain(w.id()); // it may not have been applied
        }
      }
    }
  }

  /**
   * What a refused saved write carried from events, a reset or "Put on route". Declared fields the
   * store names in its refusal (such as one not editable by others) are dropped and counted, not
   * tried again (A18); the rest, such as a hide or a reset, goes with the write when it is tried
   * again, since a refusal may only mean the object changed meanwhile. A write given up drops them.
   */
  private void refusedEffects(UUID id, ChangeRejection rejection, boolean again, WorkerContext<EngineMsg> ctx) {
    List<Effects.Effect> effects = carried.remove(id);
    if (effects == null) {
      return;
    }
    boolean fields = rejection.details().stream().anyMatch(d -> d.path().startsWith("/fields"));
    List<Effects.Effect> kept = fields ? effects.stream().filter(e -> !(e instanceof Effects.SetValues s && !s.fields().isEmpty())).toList() : effects;
    Track track = tracks.get(id);
    if (kept.size() < effects.size() || !again || track == null) {
      counts.eventsRefused++;
      ctx.log().warn("an event's change of the object {} was refused: {}", id, rejection.message());
    }
    if (again && track != null) {
      track.effects.addAll(0, kept);
    }
  }

  private void writeAgain(UUID id) {
    Track track = tracks.get(id);
    if (track != null) {
      track.placeDue = true;
    } else {
      stopDue.add(id);
    }
  }

  private void routeWritten(UUID id, ChangeOutcome outcome, WorkerContext<EngineMsg> ctx) {
    Route route = routes.get(id);
    if (route == null) {
      return;
    }
    int carried = Math.min(route.writing, route.pending.size());
    route.writing = 0;
    switch (outcome) {
      case ChangeOutcome.Applied a -> {
        counts.listWrites++;
        route.refusals = 0;
        route.pending.subList(0, carried).clear();
        if (a.event().state() instanceof MapObject object) {
          picture.learn(object);
        }
        refresh(ctx);
      }
      case ChangeOutcome.Rejected r -> {
        counts.listRefused++;
        if (++route.refusals < MAX_REFUSALS) {
          route.waitForTick = true; // tried again at the next tick, from the latest version
          return;
        }
        // Given up: the edits are dropped, and an id they took off is not asked for again.
        List<ListEdit> dropped = route.pending.subList(0, carried);
        dropped.forEach(e -> route.givenUp.addAll(e.remove()));
        dropped.clear();
        route.refusals = 0;
        ctx.log().warn("the route {}'s object list was refused {} times; its changes are dropped: {}", id, MAX_REFUSALS, r.rejection().message());
        refresh(ctx);
      }
      case ChangeOutcome.Unknown u -> writeRoutes(ctx, false); // it may not have been applied: write it again
    }
  }

  // ---------------------------------------------------------------- the tick

  private void tick(WorkerContext<EngineMsg> ctx) {
    long began = System.nanoTime();
    Instant now = clock.instant();
    fresh.clear();
    fireEvents(now);
    for (Route route : routes.values()) {
      RoutePlan plan = route.plan;
      if (route.state == RunState.PAUSED || plan == null) {
        continue;
      }
      boolean ended = atEnd(route, plan, now);
      if (ended && route.state == RunState.RUNNING) {
        if (route.definition != null && route.definition.end() == RouteDefinition.End.RESTART) {
          reset(route); // "restart" (function 14): a reset, then a start, so the events fire again
          start(route, now);
        } else {
          route.state = RunState.ENDED; // "stop" (A9): still counts as running
        }
        saveDue = true; // at the end (ADR-0041 point 4)
      } else if (!ended && route.state == RunState.ENDED) {
        route.state = RunState.RUNNING; // an edit made it longer
      }
    }
    boolean saving = saveDue;
    if (saving) {
      tracks.values().forEach(t -> t.placeDue = true); // every track, as a saved update of its state now (A12)
    }
    writeRoutes(ctx, true);
    writeTracks(ctx, now, true);
    if (saving) {
      saveDue = false;
      saveDocuments(now, ctx);
    }
    sendOutputs(now);
    // The sensors look at this tick's positions; their platforms' relations go with the next writes (function 30).
    sensors.tick(now, running(), view, context.channels(), staleSeconds);
    writeRelations(ctx);
    counts.lastTickMillis = (System.nanoTime() - began) / 1_000_000;
    report();
  }

  // ---------------------------------------------------------------- events

  /** Fires the events of the points each moving track has passed since the last tick (A17). */
  private void fireEvents(Instant now) {
    for (Track t : tracks.values()) {
      Route route = routes.get(t.route);
      RouteDefinition definition = route == null ? null : route.definition;
      RoutePlan plan = route == null || !route.runnable() ? null : route.plan;
      if (route == null || definition == null || plan == null || route.state == RunState.PAUSED || t.hidden || t.atStart) {
        continue;
      }
      double seconds = t.secondsAt(now);
      if (seconds < 0) {
        continue; // a convoy member still waiting has not left the first point
      }
      double place = place(t, plan, seconds);
      List<RouteDefinition.Point> points = definition.points();
      while (t.nextEvent < points.size() && plan.distanceMetres(t.nextEvent) <= place + REACHED && !t.hidden) {
        for (RouteDefinition.PointEvent event : points.get(t.nextEvent).events()) {
          if (!event.objects().isEmpty() && !event.objects().contains(t.id)) {
            continue;
          }
          counts.eventsFired++;
          t.effects.add(event.effect());
          if (event.effect() instanceof Effects.Hide) {
            hide(t, now);
            break; // a hidden object gets no more events
          }
        }
        t.nextEvent++;
      }
    }
  }

  /** "Hide" (function 13, A19): it stops where it is, and each chosen output gets a removal. */
  private void hide(Track t, Instant now) {
    t.hidden = true;
    t.pause(now);
    if (outputs.any()) {
      outputs.send(context.channels(), new ChannelItem.Removal(t.id));
    }
  }

  /**
   * A track's own place along the route, in metres: a formation member's is the centre's plus its
   * offset forward; at the end, every one has passed the last point (A8).
   */
  private static double place(Track t, RoutePlan plan, double seconds) {
    if (seconds >= plan.durationSeconds()) {
      return plan.lengthMetres();
    }
    Motion m = plan.at(Math.max(0, seconds));
    if (t.kind != GroupKind.FORMATION) {
      return m.distance();
    }
    return Math.clamp(m.distance() + t.member.forward(), 0, plan.lengthMetres());
  }

  /** How many of the route's points lie at or behind {@code place}. */
  private static int passed(RoutePlan plan, double place) {
    int n = 0;
    while (n < plan.pointCount() && plan.distanceMetres(n) <= place + REACHED) {
      n++;
    }
    return n;
  }

  // ---------------------------------------------------------------- outputs

  /**
   * While the simulation runs (a route running or stopped at its end), every track of the
   * simulation, on a route or not, hidden ones excepted, goes to each chosen output with an expiry
   * {@code outputStaleSeconds} after the tick (function 18, A21).
   */
  private void sendOutputs(Instant now) {
    if (!running() || !outputs.any()) {
      return;
    }
    Instant expires = now.plusSeconds(staleSeconds);
    var channels = context.channels();
    for (MapObject object : picture.objects()) {
      if (!isTrack(object)) {
        continue;
      }
      Track track = tracks.get(object.id());
      MapObjectContent content = fresh.getOrDefault(object.id(), object.content());
      boolean hidden = track != null ? track.hidden : Effects.hidden(content, context.pluginId());
      if (!hidden) {
        outputs.sendUpdate(channels, object.id(), expiring(content, expires));
      }
    }
  }

  /** The content as an output item carries it: only the item has the expiry, never the stored object. */
  static MapObjectContent expiring(MapObjectContent c, Instant expires) {
    TimeAttributes time = c.time();
    var expiring = new TimeAttributes(time == null ? null : time.observed(), time == null ? null : time.validFrom(), expires);
    return new MapObjectContent(c.type(), c.dataType(), c.dataSource(), expiring, c.layerId(), c.geometry(), c.symbol(), c.style(),
        c.properties(), c.label(), c.extensions(), c.fieldSets(), c.relations());
  }

  /** {@code POST /outputs} (A20): each id offered now, or already chosen, so a missing one may stay. */
  private void chooseOutputs(EndpointRequest request) {
    if (!restored) {
      respond(request, 503, error("the simulation is loading; try again"));
      return;
    }
    if (!(request.body() instanceof JsonObject body) || !(body.get("channels") instanceof JsonArray list) || list.size() > MAX_OUTPUTS) {
      respond(request, 400, error("the body must be {\"channels\": [\"plugin/link\", …]}, at most " + MAX_OUTPUTS));
      return;
    }
    List<ChannelId> ids = new ArrayList<>();
    for (JsonValue value : list.values()) {
      ChannelId id;
      try {
        id = ChannelId.parse(value instanceof JsonString s ? s.value() : "");
      } catch (IllegalArgumentException e) {
        respond(request, 400, error("not a channel id: " + value));
        return;
      }
      if (ids.contains(id)) {
        respond(request, 400, error("a channel is named twice: " + id));
        return;
      }
      if (!outputs.offered(id) && !outputs.chosen().contains(id)) {
        respond(request, 404, error("no output channel " + id));
        return;
      }
      ids.add(id);
    }
    outputs.choose(ids);
    saveDue = true; // the choice of outputs (A22)
    report();
    respond(request, 200, outputs.json());
  }

  // ---------------------------------------------------------------- sensors (functions 27 to 30)

  /**
   * {@code POST /sensors} (A95): {@code {platform, create?, …settings}}. With {@code create} the
   * platform must be a track of the simulation that is no sensor's platform yet, {@code type} says
   * the sensor's type (a ground radar when absent; function 36), and the absent settings take that
   * type's defaults (functions 27, 37 and 38); otherwise the sensor must exist, and absent settings keep
   * its values. A setting outside its limits is refused, named.
   */
  private void saveSensor(EndpointRequest request, WorkerContext<EngineMsg> ctx) {
    if (!restored) {
      respond(request, 503, error("the simulation is loading; try again"));
      return;
    }
    if (!(request.body() instanceof JsonObject body) || uuid(body.get("platform")) == null) {
      respond(request, 400, error("the body must be {\"platform\": \"<track id>\", …settings}"));
      return;
    }
    UUID platform = uuid(body.get("platform"));
    boolean create = body.get("create") instanceof JsonBoolean b && b.value();
    Sensors.Sensor existing = sensors.get(platform);
    if (create && existing != null) {
      respond(request, 409, error("the track is already a sensor's platform"));
      return;
    }
    if (!create && existing == null) {
      respond(request, 404, error("no sensor on that track"));
      return;
    }
    if (create && !isTrack(picture.object(platform))) {
      respond(request, 404, error("no track of the simulation with that id"));
      return;
    }
    SensorSettings settings;
    try {
      settings = SensorSettings.parse(body, existing == null ? SensorSettings.defaults(SensorSettings.type(body, SensorType.GROUND_RADAR)) : existing.settings);
    } catch (SensorSettings.Invalid e) {
      respond(request, 400, JsonObject.builder().put("error", JsonString.of(e.getMessage())).put("field", JsonString.of(e.field)).build());
      return;
    }
    List<ChannelId> before = existing == null ? List.of() : existing.settings.outputs();
    for (ChannelId id : settings.outputs()) {
      if (!before.contains(id) && (existing == null ? !sensorChannelOffered(id, settings.type()) : !existing.outputs.offered(id))) {
        respond(request, 404, error("no output channel for sensor reports " + id));
        return;
      }
    }
    sensors.put(platform, settings);
    saveDue = true; // a change of the simulation (A22)
    writeTracks(ctx, clock.instant(), false); // CR-0035: what its outputs leave out is written at once
    report();
    respond(request, 200, sensors.json(view, running(), pairing()));
  }

  private boolean sensorChannelOffered(ChannelId id, SensorType type) {
    var probe = new Outputs(ChannelKind.SENSOR_REPORTS, type);
    probe.listed(outputs.list());
    return probe.offered(id);
  }

  /** {@code POST /sensors/remove}: {@code {platform}}; the platform's relations of the sensor's kinds are cleared. */
  private void removeSensor(EndpointRequest request, WorkerContext<EngineMsg> ctx) {
    if (!restored) {
      respond(request, 503, error("the simulation is loading; try again"));
      return;
    }
    UUID platform = request.body() instanceof JsonObject body ? uuid(body.get("platform")) : null;
    if (platform == null || sensors.get(platform) == null) {
      respond(request, 404, error("no sensor on that track"));
      return;
    }
    sensors.remove(platform);
    saveDue = true;
    writeTracks(ctx, clock.instant(), false);
    report();
    respond(request, 200, sensors.json(view, running(), pairing()));
  }

  private static @Nullable UUID uuid(@Nullable JsonValue value) {
    return value instanceof JsonString s ? uuidOrNull(s.value()) : null;
  }

  // ---------------------------------------------------------------- scenarios (function 32)

  /**
   * The simulator's own part of a scenario (A108): the chosen Ground truth outputs and the sensors
   * with every setting. The routes, their groups and events, and the tracks are objects, which the
   * browser takes from the live picture; progress and run states are not exported, as an import resets.
   */
  private JsonObject scenarioState() {
    return JsonObject.builder()
        .put("outputs", new JsonArray(outputs.chosen().stream().map(id -> (JsonValue) JsonString.of(id.toString())).toList()))
        .put("sensors", sensors.saved())
        .build();
  }

  /**
   * {@code POST /scenario-state}: {@code {mode: "new" | "merge", outputs, sensors}}, the ids already
   * remapped by the browser. Only while the simulation is reset or paused, and only with {@code
   * plugin.simulator.run} as well. "new" replaces the outputs and the sensors; "merge" adds them (A109).
   * Outputs whose channels this server does not offer are kept, shown as missing (function 18).
   */
  private void importScenarioState(EndpointRequest request, WorkerContext<EngineMsg> ctx) {
    if (!restored) {
      respond(request, 503, error("the simulation is loading; try again"));
      return;
    }
    if (!request.user().has(RUN_PERMISSION)) {
      respond(request, 403, error("importing a scenario needs " + RUN_PERMISSION + " as well"));
      return;
    }
    if (running()) {
      respond(request, 409, error("pause or reset the simulation before importing a scenario"));
      return;
    }
    JsonObject body = request.body() instanceof JsonObject o ? o : JsonObject.builder().build();
    String mode = body.get("mode") instanceof JsonString s ? s.value() : "";
    if (!mode.equals("new") && !mode.equals("merge") || !(body.get("outputs") instanceof JsonArray list) || list.size() > MAX_OUTPUTS) {
      respond(request, 400, error("the body must be {\"mode\": \"new\" | \"merge\", \"outputs\": [\"plugin/link\", …], \"sensors\": [{platform, settings}]}"));
      return;
    }
    List<ChannelId> ids = new ArrayList<>(mode.equals("merge") ? outputs.chosen() : List.of());
    for (JsonValue value : list.values()) {
      try {
        ChannelId id = ChannelId.parse(value instanceof JsonString s ? s.value() : "");
        if (!ids.contains(id)) {
          ids.add(id);
        }
      } catch (IllegalArgumentException e) {
        respond(request, 400, error("not a channel id: " + value));
        return;
      }
    }
    Map<UUID, SensorSettings> imported = Sensors.read(body.get("sensors"));
    if (mode.equals("new")) {
      List.copyOf(sensors.all().keySet()).forEach(sensors::remove);
    }
    outputs.choose(ids);
    imported.forEach(sensors::put);
    saveDue = true;
    writeTracks(ctx, clock.instant(), false);
    report();
    respond(request, 200, scenarioState());
  }

  // ---------------------------------------------------------------- saving and restoring

  /** The documents of a save: the tracks' progress, and the state with the route states and outputs (A24). */
  private void saveDocuments(Instant now, WorkerContext<EngineMsg> ctx) {
    Map<UUID, SavedState.Progress> progress = new LinkedHashMap<>();
    for (Track t : tracks.values()) {
      Route route = routes.get(t.route);
      RoutePlan plan = route != null && route.runnable() ? route.plan : null;
      double seconds = plan == null ? t.secondsAt(now) : t.seconds(plan, now);
      int leg = -1;
      double fraction = 0;
      if (plan != null && !t.atStart && seconds >= 0) {
        Motion m = plan.at(seconds);
        leg = m.leg();
        fraction = m.fraction();
      } else if (t.anchorLeg >= 0) {
        leg = t.anchorLeg;
        fraction = t.anchorFraction;
      }
      progress.put(t.id, new SavedState.Progress(t.route, t.atStart, seconds, leg, fraction, t.nextEvent));
    }
    List<JsonObject> documents = SavedState.tracks(progress);
    for (int i = 0; i < documents.size(); i++) {
      context.documents().put(SavedState.tracksKey(i), documents.get(i), ctx.self(), EngineMsg.Document::new);
    }
    for (int i = documents.size(); i < trackDocuments; i++) {
      context.documents().delete(SavedState.tracksKey(i), ctx.self(), EngineMsg.Document::new);
    }
    trackDocuments = documents.size();
    Map<UUID, String> states = new LinkedHashMap<>();
    routes.values().forEach(r -> states.put(r.object.id(), r.state.name().toLowerCase(Locale.ROOT)));
    context.documents().put(SavedState.STATE, SavedState.state(now, states, outputs.chosen(), documents.size(), sensors.saved()), ctx.self(),
        EngineMsg.Document::new);
    counts.saves++;
  }

  /** A clean stop pauses and saves at once, best effort (ADR-0041 point 6). */
  private void stop(WorkerContext<EngineMsg> ctx) {
    if (!restored) {
      return;
    }
    Instant now = clock.instant();
    routes.values().forEach(r -> pause(r, now));
    tracks.values().forEach(t -> t.placeDue = true);
    writeTracks(ctx, now, false);
    saveDocuments(now, ctx);
    saveDue = false;
  }

  private void readAgain(WorkerContext<EngineMsg> ctx) {
    for (String key : List.copyOf(failedReads)) {
      failedReads.remove(key);
      readingKeys.add(key);
      context.documents().get(key, ctx.self(), EngineMsg.Document::new);
    }
  }

  private void askState(WorkerContext<EngineMsg> ctx) {
    if (!stateAsked) {
      stateAsked = true;
      readingKeys.add(SavedState.STATE);
      context.documents().get(SavedState.STATE, ctx.self(), EngineMsg.Document::new);
    }
  }

  private void document(DocumentResult result, WorkerContext<EngineMsg> ctx) {
    String key = result.key();
    boolean read = readingKeys.remove(key);
    if (!read) {
      if (result instanceof DocumentResult.Failed f) {
        counts.documentFailures++;
        ctx.log().warn("the document {} could not be written: {}", key, f.reason());
        report();
      }
      return;
    }
    boolean state = key.equals(SavedState.STATE);
    switch (result) {
      case DocumentResult.Found f when state -> {
        SavedState.Loaded loaded = SavedState.readState(f.value());
        reading = loaded;
        documentsToRead = loaded.trackDocuments();
        trackDocuments = loaded.trackDocuments();
        for (int i = 0; i < documentsToRead; i++) {
          readingKeys.add(SavedState.tracksKey(i));
          context.documents().get(SavedState.tracksKey(i), ctx.self(), EngineMsg.Document::new);
        }
      }
      case DocumentResult.Found f -> {
        SavedState.Loaded loaded = reading;
        if (loaded != null) {
          SavedState.readTracks(f.value(), loaded.tracks());
        }
        documentsToRead--;
      }
      case DocumentResult.Missing m when state -> {
        reading = SavedState.Loaded.empty(); // nothing saved yet
        documentsToRead = 0;
      }
      case DocumentResult.Failed f when state -> {
        counts.documentFailures++;
        stateAsked = false; // asked again at the next tick
        ctx.log().warn("the saved state could not be read; trying again: {}", f.reason());
        report();
        return;
      }
      case DocumentResult.Failed f -> {
        // Read again at the next tick: placing its tracks at their starts would lose their progress at the next save.
        counts.documentFailures++;
        failedReads.add(key);
        ctx.log().warn("the saved document {} could not be read; trying again: {}", key, f.reason());
        report();
        return;
      }
      default -> documentsToRead--; // a track document missing: its tracks are placed as "Put on route" places them
    }
    if (documentsToRead <= 0 && reading != null) {
      saved = reading;
      reading = null;
      if (picture.loaded()) {
        refresh(ctx);
      }
    }
  }

  /**
   * After a start or a worker restart, the saved state is the source (function 21; ADR-0041 point
   * 5): every track is placed where it says, with saved updates, and the whole simulation is paused.
   * The routes' lists decide which objects are on which route (S2): an object without saved progress
   * on its route is placed as "Put on route" places it; progress for an object on no list is dropped,
   * and a track deleted meanwhile is counted.
   */
  private void restore(WorkerContext<EngineMsg> ctx, Instant now) {
    SavedState.Loaded loaded = saved;
    if (loaded == null) {
      return;
    }
    restored = true;
    saved = null;
    outputs.choose(loaded.outputs());
    loaded.sensors().forEach(sensors::put);
    assignTracks(now);
    for (Track t : tracks.values()) {
      SavedState.Progress p = loaded.tracks().get(t.id);
      Route route = routes.get(t.route);
      if (p == null || route == null || !p.route().equals(t.route)) {
        continue;
      }
      t.nextEvent = p.nextEvent();
      t.atStart = p.atStart();
      if (p.atStart()) {
        continue;
      }
      RoutePlan plan = route.runnable() ? route.plan : null;
      if (p.leg() >= 0 && plan != null) {
        t.elapsed = plan.secondsAt(p.leg(), p.fraction());
      } else {
        t.elapsed = p.seconds();
        if (p.leg() >= 0) {
          t.anchorLeg = p.leg();
          t.anchorFraction = p.fraction();
        }
      }
    }
    for (UUID id : loaded.tracks().keySet()) {
      if (picture.object(id) == null) {
        counts.deleted++;
      }
    }
    writeRoutes(ctx, false);
    writeTracks(ctx, now, false);
    report();
  }

  /** Where a track is to be now, or null when its route cannot run: it then stands where it is. */
  private static @Nullable Placement placement(Track track, Route route, Instant now) {
    RoutePlan plan = route.plan;
    if (!route.runnable() || plan == null) {
      return null;
    }
    double seconds = track.seconds(plan, now);
    boolean standing = route.state == RunState.PAUSED || track.atStart || track.hidden || seconds < 0;
    Motion m = plan.at(Math.max(0, seconds));
    double speed = standing ? 0 : m.speed();
    if (track.kind != GroupKind.FORMATION) {
      return new Placement(m.position(), m.altitude(), m.azimuth(), speed);
    }
    Position at = Formation.place(m.position(), m.azimuth(), track.member);
    Double centre = m.altitude() != null ? m.altitude() : track.groupAltitude;
    return new Placement(at, centre == null ? null : centre + track.member.up(), m.azimuth(), speed);
  }

  /**
   * The track's content moved to {@code placement} at {@code now}, or null when it already stands
   * there. It keeps {@code c}'s layer, the stored object's: a track a user moved into another layer of
   * Simulation moves on there (function 40, ADR-0053 point 8).
   */
  static @Nullable MapObjectContent moved(MapObjectContent c, Placement placement, Instant now) {
    Symbol symbol = c.symbol();
    if (symbol == null || !(c.geometry() instanceof Geometry.Point point)) {
      return null;
    }
    Double altitude = placement.altitude() != null ? placement.altitude() : point.coordinates().altitude();
    Position position = new Position(placement.position().longitude(), placement.position().latitude(), altitude);
    Modifiers old = symbol.modifiers();
    double direction = placement.direction() >= 360 || placement.direction() < 0 ? ((placement.direction() % 360) + 360) % 360 : placement.direction();
    if (position.equals(point.coordinates()) && old != null && Double.valueOf(direction).equals(old.direction())
        && Double.valueOf(placement.speed()).equals(old.speed())) {
      return null;
    }
    Modifiers modifiers = new Modifiers(old == null ? Map.of() : old.texts(), direction, placement.speed());
    TimeAttributes time = c.time();
    TimeAttributes observed = new TimeAttributes(now, time == null ? null : time.validFrom(), time == null ? null : time.expires());
    return new MapObjectContent(c.type(), c.dataType(), c.dataSource(), observed, c.layerId(), new Geometry.Point(position),
        new Symbol(symbol.standard(), symbol.sidc(), modifiers), c.style(), c.properties(), c.label(), c.extensions(), c.fieldSets(), c.relations());
  }

  /** The object standing where it is, speed 0, its altitude kept (function 9's "disconnect"), or null when it already does. */
  static @Nullable MapObjectContent stood(MapObjectContent c, Instant now) {
    Symbol symbol = c.symbol();
    if (symbol == null || !(c.geometry() instanceof Geometry.Point point)) {
      return null;
    }
    Modifiers old = symbol.modifiers();
    double direction = old == null || old.direction() == null ? 0 : old.direction();
    return moved(c, new Placement(point.coordinates(), point.coordinates().altitude(), direction, 0), now);
  }

  // ---------------------------------------------------------------- status

  /**
   * Sets the plugin's status when it changed (brief function 17a). It holds at most {@link
   * PluginStatus#MAX_DETAIL} characters: the counts first, then the routes that cannot run and each
   * route's state, as many as fit.
   */
  private void report() {
    long running = routes.values().stream().filter(r -> r.state != RunState.PAUSED).count();
    boolean slow = counts.lastTickMillis > SLOW_TICK.toMillis();
    var detail = new StringBuilder();
    if (!restored) {
      detail.append("reading the saved state; ");
    }
    if (slow) {
      detail.append("the last tick took longer than ").append(SLOW_TICK.toMillis()).append(" ms; ");
    }
    detail.append(running == 0 ? "paused" : "running").append(": ")
        .append(running).append(" of ").append(routes.size()).append(" routes running, ").append(tracks.size()).append(" tracks on routes; ")
        .append("last tick ").append(counts.lastTickMillis).append(" ms, ").append(counts.lastTickMoves).append(" moves; ")
        .append("moves submitted ").append(counts.submitted).append(", skipped ").append(counts.skipped)
        .append(", refused ").append(counts.refused).append(", lost ").append(counts.lost).append(", answered ").append(counts.answered)
        .append("; new snapshots ").append(picture.newSnapshots())
        .append("; route lists written ").append(counts.listWrites).append(", refused ").append(counts.listRefused)
        .append("; tracks deleted ").append(counts.deleted)
        .append("; events fired ").append(counts.eventsFired).append(", refused ").append(counts.eventsRefused)
        .append(", hidden ").append(tracks.values().stream().filter(t -> t.hidden).count())
        .append("; ").append(outputs.status())
        .append("; ").append(sensors.status(pairing(), view)).append(counts.relationsRefused == 0 ? "" : ", relations refused " + counts.relationsRefused)
        .append("; saves ").append(counts.saves).append(", document failures ").append(counts.documentFailures);
    appendAsFits(detail, "; cannot run: ", routes.values().stream().filter(r -> !r.runnable()).map(r -> name(r) + " (" + firstProblem(r) + ")").toList());
    appendAsFits(detail, "; routes: ", routes.values().stream().map(r -> name(r) + " " + stateText(r)).toList());
    String text = detail.length() <= PluginStatus.MAX_DETAIL ? detail.toString() : detail.substring(0, PluginStatus.MAX_DETAIL - 1) + "…";
    if (!text.equals(lastStatus)) {
      lastStatus = text;
      context.status().set(slow ? PluginState.DEGRADED : PluginState.OK, text);
    }
  }

  /** Appends {@code label} and as many of {@code items} as fit in the status, then how many more there are. */
  private static void appendAsFits(StringBuilder detail, String label, List<String> items) {
    if (items.isEmpty()) {
      return;
    }
    int room = PluginStatus.MAX_DETAIL - detail.length() - label.length() - " and 99999 more".length();
    List<String> shown = new ArrayList<>();
    int used = 0;
    for (String item : items) {
      String text = item.length() > STATUS_ITEM ? item.substring(0, STATUS_ITEM - 1) + "…" : item;
      int length = text.length() + (shown.isEmpty() ? 0 : 2);
      if (used + length > room) {
        break;
      }
      shown.add(text);
      used += length;
    }
    if (room <= 0) {
      return;
    }
    detail.append(label).append(String.join(", ", shown));
    if (shown.size() < items.size()) {
      detail.append(shown.isEmpty() ? "" : " and ").append(items.size() - shown.size()).append(" more");
    }
  }

  private static String stateText(Route route) {
    return switch (route.state) {
      case PAUSED -> "paused";
      case RUNNING -> "running";
      case ENDED -> "at its end";
    };
  }

  private static String name(Route route) {
    var properties = route.object.content().properties();
    return properties != null && properties.name() != null ? properties.name() : "a route";
  }

  private static String firstProblem(Route route) {
    if (route.problems.isEmpty()) {
      return "no values";
    }
    Problem p = route.problems.getFirst();
    return (p.point() == Problem.ROUTE ? "" : "point " + (p.point() + 1) + ": ") + p.message();
  }

  // ---------------------------------------------------------------- endpoints

  private JsonObject routesJson() {
    List<JsonValue> list = new ArrayList<>();
    for (Route route : routes.values()) {
      list.add(json(route));
    }
    boolean running = routes.values().stream().anyMatch(r -> r.state != RunState.PAUSED);
    return JsonObject.builder().put("running", JsonBoolean.of(running)).put("routes", new JsonArray(list)).build();
  }

  private void answerRoute(EndpointRequest request) {
    UUID id = uuidOrNull(request.pathParameter("id"));
    Route route = id == null ? null : routes.get(id);
    if (route == null) {
      respond(request, 404, error("no such route in the simulation"));
    } else {
      respond(request, 200, json(route));
    }
  }

  private static JsonObject error(String message) {
    return JsonObject.builder().put("error", JsonString.of(message)).build();
  }

  private static JsonArray idsJson(List<UUID> ids) {
    return new JsonArray(ids.stream().map(id -> (JsonValue) JsonString.of(id.toString())).toList());
  }

  /** Function 43: {@code GET /sensors/dwells[?since=n]}; 304 when nothing changed after {@code n}, 400 for an {@code n} that is not a number. */
  private void answerDwells(EndpointRequest request) {
    String since = request.queryParameter("since");
    Long n = null;
    if (since != null) {
      try {
        n = Long.parseLong(since);
      } catch (NumberFormatException e) {
        respond(request, 400, error("since: a whole number"));
        return;
      }
    }
    JsonObject body = sensors.drawnJson(n);
    if (body == null) {
      HttpReply unchanged = HttpReply.status(304);
      request.response().respond(new HttpReply(304, unchanged.headers().with("Cache-Control", "no-store"), unchanged.body()));
      return;
    }
    respond(request, 200, body);
  }

  private static void respond(EndpointRequest request, int status, JsonObject body) {
    HttpReply reply = HttpReply.json(status, body);
    request.response().respond(new HttpReply(reply.status(), reply.headers().with("Cache-Control", "no-store"), reply.body()));
  }

  /**
   * A route as the web part shows it, with the version the values were computed from (brief
   * functions 6 and 24): the editor shows them only when that is the version it shows.
   */
  private JsonObject json(Route route) {
    var out = JsonObject.builder()
        .put("id", JsonString.of(route.object.id().toString()))
        .put("version", JsonNumber.of(route.object.version()))
        .put("name", JsonString.of(name(route)))
        .put("layerId", JsonString.of(route.object.content().layerId().toString()))
        .put("state", JsonString.of(route.state.name().toLowerCase(Locale.ROOT)))
        .put("runnable", JsonBoolean.of(route.runnable()));
    List<JsonValue> problems = new ArrayList<>();
    for (Problem p : route.problems) {
      problems.add(JsonObject.builder()
          .put("point", p.point() == Problem.ROUTE ? JsonNull.INSTANCE : JsonNumber.of(p.point()))
          .put("message", JsonString.of(p.message()))
          .build());
    }
    out.put("problems", new JsonArray(problems));
    out.put("objects", idsJson(tracksOf(route).stream().map(t -> t.id).toList()));
    RoutePlan plan = route.plan;
    if (plan != null) {
      out.put("lengthMetres", number(plan.lengthMetres())).put("durationSeconds", number(plan.durationSeconds()));
      List<JsonValue> points = new ArrayList<>();
      for (int i = 0; i < plan.pointCount(); i++) {
        points.add(JsonObject.builder()
            .put("legMetres", number(plan.legMetres(i)))
            .put("distanceMetres", number(plan.distanceMetres(i)))
            .put("arrivalSeconds", number(plan.arrivalSeconds(i)))
            .put("speed", number(plan.speed(i)))
            .put("speedFrom", JsonString.of(switch (plan.speedSource(i)) {
              case TYPED -> "typed";
              case OWN_TIME -> "time";
              case NEXT_TIME -> "next-time";
            }))
            .build());
      }
      out.put("points", new JsonArray(points));
    }
    return out.build();
  }

  private static JsonValue number(double value) {
    return Double.isFinite(value) ? JsonNumber.of(value) : JsonNull.INSTANCE;
  }
}
