package dev.emcc.plugins.uavsimulation;

import dev.emcc.plugins.uavsimulation.pose.Aim;
import dev.emcc.plugins.uavsimulation.pose.Fix;
import dev.emcc.plugins.uavsimulation.pose.Platform;
import dev.emcc.plugins.uavsimulation.pose.Pose;
import dev.emcc.plugins.uavsimulation.pose.Sway;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelInfo;
import dev.emcc.sdk.channel.ChannelList;
import dev.emcc.sdk.channel.ChannelState;
import dev.emcc.sdk.channel.DeclaredItem;
import dev.emcc.sdk.document.DocumentResult;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.store.ObjectQuery;
import dev.emcc.sdk.store.QueryResult;
import dev.emcc.sdk.store.StoreUpdate;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerContext;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * The {@code cameras} worker: it owns the cameras, follows the Simulation workspace through one store
 * subscription (brief function 3), runs one timer per running camera (function 7), answers the
 * endpoints (function 13) and keeps the status (function 10). It watches the output channels and
 * offers those that take {@code fmv.camera-pose} (function 9). Each tick computes one pose, keeps it as
 * the camera's latest (owner Q4 A) and sends it to the camera's output as a {@link DeclaredItem}
 * (section 4), unless the camera has none (C3), its output is missing (C4) or the platform's height is
 * outside the kind's bounds (C5).
 */
final class CameraWorker implements Handler<CameraMsg> {

  static final String VIEW = "plugin.uav-simulation.view";
  static final String EDIT = "plugin.uav-simulation.edit";
  static final String RUN = "plugin.uav-simulation.run";

  /** The Simulation workspace's view permission (the simulator's): every endpoint needs it too (brief section 6). */
  static final String WORKSPACE_VIEW = "plugin.simulator.view";

  /** The pose's channel kind, which {@code fmv} declares (brief section 4). */
  static final String KIND = "fmv.camera-pose";

  /** C5: the platform heights {@code fmv}'s schema takes ({@code platform.position[2]}, its brief's 10.1), metres HAE. */
  static final double MIN_SEND_HEIGHT = -1_000;
  static final double MAX_SEND_HEIGHT = 20_000;

  /** U1: the most cameras. */
  static final int MAX_CAMERAS = 50;

  /** The index document: the cameras' ids, in their order (owner Q2 A). */
  static final String INDEX = "cameras";

  static final Duration QUERY_TIMEOUT = Duration.ofSeconds(10);

  /** The status timer's period: the counts are per minute (brief function 10). */
  static final Duration REPORT = Duration.ofMinutes(1);

  /** A camera's document key: {@code camera.<uuid>} (document keys allow no {@code /}). */
  static String key(UUID camera) {
    return "camera." + camera;
  }

  /** A camera: what is stored (its id, platform and settings), and its run state, which is not. */
  private static final class Camera {
    final UUID id;
    UUID platform;
    /** The platform's last known name, kept so a camera whose platform is gone is still recognised. */
    @Nullable String platformName;
    /** The output's last known name, kept so a missing output is still recognised (C1). */
    @Nullable String outputName;
    CameraSettings settings;
    @Nullable Cancellable timer;
    Instant startedAt = Instant.EPOCH;
    /** The previous frame's aim without the sway, so Track an object's kept aim does not wander. */
    @Nullable Aim last;
    /** The micro sway while the camera runs with it on (M10 plan point 8), else {@code null}. */
    @Nullable Sway sway;
    /** The latest pose's payload (Q4 A); the label goes beside it, as it will go with the channel item. */
    @Nullable JsonObject pose;
    @Nullable String poseClassification;
    boolean targetGone;
    boolean platformGone;
    long poses;
    long sent;
    /** C4: the last send to the output answered {@code CLOSED}; cleared by the next list of outputs. */
    boolean closed;
    /** C6: the last send was refused by ECore; logged once per start. */
    boolean refused;
    boolean refusalLogged;
    /** Why the latest pose was not sent (C5, C6), or {@code null}. */
    @Nullable String notSent;

    Camera(UUID id, UUID platform, @Nullable String platformName, CameraSettings settings) {
      this.id = id;
      this.platform = platform;
      this.platformName = platformName;
      this.settings = settings;
    }

    boolean running() {
      return timer != null;
    }

    JsonObject document() {
      return JsonObject.builder().put("id", JsonString.of(id.toString())).put("platform", JsonString.of(platform.toString()))
          .put("platformName", platformName == null ? JsonNull.INSTANCE : JsonString.of(platformName))
          .put("outputName", outputName == null ? JsonNull.INSTANCE : JsonString.of(outputName)).put("settings", settings.json()).build();
    }
  }

  private final PluginContext context;
  private final Clock clock;
  private final Map<UUID, Camera> cameras = new LinkedHashMap<>();
  private final SimulationCopy copy = new SimulationCopy();
  private ChannelList outputs = ChannelList.empty();
  private final Set<String> reading = new HashSet<>();
  private boolean readStarted;
  private boolean loaded;
  private boolean querying;
  /** A document that could not be read: cameras may be missing until a restart. */
  private @Nullable String readProblem;
  /** A document that could not be written; cleared by the next write that succeeds. */
  private @Nullable String writeProblem;
  private Minute thisMinute = new Minute();
  private Minute lastMinute = new Minute();

  /** The counts of one minute (brief function 10). */
  private static final class Minute {
    long poses;
    long held;
    long sent;
    long dropped;
    long closed;
    long notSent;
    long refused;
  }

  CameraWorker(PluginContext context, Clock clock) {
    this.context = context;
    this.clock = clock;
  }

  @Override
  public void handle(CameraMsg message, WorkerContext<CameraMsg> ctx) {
    if (!readStarted) {
      readStarted = true;
      reading.add(INDEX);
      context.documents().get(INDEX, ctx.self(), CameraMsg.Document::new);
      // ECore cancels the plugin's timers when it stops the plugin.
      context.timers().every(REPORT, ctx.self(), new CameraMsg.Report());
    }
    switch (message) {
      case CameraMsg.Updated(StoreUpdate.Snapshot s) -> {
        copy.replace(s.objects(), s.layers(), s.sequenceNo(), clock.instant());
        platformsChecked();
      }
      case CameraMsg.Updated(StoreUpdate.Changes c) -> {
        if (!copy.loaded() && !querying) {
          querying = true;
          context.store().query(ObjectQuery.all().inWorkspaces(SimulationCopy.WORKSPACE), QUERY_TIMEOUT, ctx.self(), CameraMsg.Found::new);
        }
        copy.changes(c.events(), clock.instant());
        platformsChecked();
      }
      case CameraMsg.Found(QueryResult r) -> {
        querying = false;
        if (r instanceof QueryResult.Found f && !copy.loaded()) {
          copy.replace(f.objects(), f.layers(), f.sequenceNo(), clock.instant());
          platformsChecked();
        }
      }
      case CameraMsg.Tick(UUID id) -> tick(id);
      case CameraMsg.Outputs(ChannelList list) -> {
        outputs = list;
        for (Camera c : cameras.values()) {
          c.closed = false; // C4: a new list says again what is on offer
          ChannelInfo info = onOffer(c.settings.output());
          if (info != null && !info.name().equals(c.outputName)) {
            c.outputName = info.name(); // a renamed output: stored, so a restart shows the new name
            save(c, ctx);
          }
        }
        status();
      }
      case CameraMsg.Report() -> {
        lastMinute = thisMinute;
        thisMinute = new Minute();
        status();
      }
      case CameraMsg.Document(DocumentResult r) -> document(r, ctx);
      case CameraMsg.Get g when seesSimulation(g.request()) -> respond(g.request(), 200, list());
      case CameraMsg.Create m when seesSimulation(m.request()) -> create(m.request(), ctx);
      case CameraMsg.Change m when seesSimulation(m.request()) -> change(m.request(), ctx);
      case CameraMsg.Remove m when seesSimulation(m.request()) -> remove(m.request(), ctx);
      case CameraMsg.Start m when seesSimulation(m.request()) -> start(m.request(), ctx);
      case CameraMsg.Stop m when seesSimulation(m.request()) -> stop(m.request());
      default -> {
        // an endpoint's request from a user who may not see the Simulation workspace: answered in seesSimulation
      }
    }
  }

  // ---------------------------------------------------------------- storage

  private void document(DocumentResult result, WorkerContext<CameraMsg> ctx) {
    switch (result) {
      case DocumentResult.Found(String key, JsonObject value) when reading.remove(key) -> {
        if (key.equals(INDEX)) {
          readIndex(value, ctx);
        } else {
          readCamera(value);
        }
        loadedIfRead();
      }
      case DocumentResult.Missing(String key) when reading.remove(key) -> {
        if (!key.equals(INDEX)) {
          context.log().warn("camera document {} is missing; its camera is dropped", key);
        }
        loadedIfRead();
      }
      case DocumentResult.Written w when writeProblem != null -> {
        writeProblem = null;
        status();
      }
      case DocumentResult.Failed(String key, String reason) -> {
        if (reading.remove(key)) {
          readProblem = "cameras could not be read: " + reason;
        } else {
          writeProblem = "cameras could not be saved: " + reason;
        }
        context.log().warn("document {}: {}", key, reason);
        loadedIfRead();
        status();
      }
      default -> {
        // a write's answer, or an answer to a read no longer waited for
      }
    }
  }

  private void readIndex(JsonObject index, WorkerContext<CameraMsg> ctx) {
    if (!(index.get("ids") instanceof JsonArray ids)) {
      return;
    }
    for (JsonValue v : ids.values()) {
      UUID id = v instanceof JsonString s ? CameraSettings.uuid(s.value()) : null;
      if (id != null) {
        reading.add(key(id));
        context.documents().get(key(id), ctx.self(), CameraMsg.Document::new);
      }
    }
  }

  /** A stored camera: back stopped, with its settings (brief function 1, criterion 5). */
  private void readCamera(JsonObject doc) {
    UUID id = doc.get("id") instanceof JsonString s ? CameraSettings.uuid(s.value()) : null;
    UUID platform = doc.get("platform") instanceof JsonString s ? CameraSettings.uuid(s.value()) : null;
    if (id == null || platform == null || !(doc.get("settings") instanceof JsonObject stored)) {
      context.log().warn("a camera document cannot be read; it is dropped");
      return;
    }
    try {
      String name = doc.get("platformName") instanceof JsonString s ? s.value() : null;
      Camera c = new Camera(id, platform, name, CameraSettings.parse(stored, CameraSettings.DEFAULTS));
      c.outputName = c.settings.output() != null && doc.get("outputName") instanceof JsonString s ? s.value() : null;
      cameras.put(id, c);
    } catch (CameraSettings.Invalid e) {
      context.log().warn("camera {}: stored {} is not valid ({}); it is dropped", id, e.field, e.getMessage());
    }
  }

  private void loadedIfRead() {
    if (!loaded && reading.isEmpty()) {
      loaded = true;
      platformsChecked(); // the snapshot may have come first
      status();
    }
  }

  private void save(Camera camera, WorkerContext<CameraMsg> ctx) {
    context.documents().put(key(camera.id), camera.document(), ctx.self(), CameraMsg.Document::new);
  }

  private void saveIndex(WorkerContext<CameraMsg> ctx) {
    var ids = new ArrayList<JsonValue>();
    cameras.keySet().forEach(id -> ids.add(JsonString.of(id.toString())));
    context.documents().put(INDEX, JsonObject.builder().put("ids", new JsonArray(ids)).build(), ctx.self(), CameraMsg.Document::new);
  }

  // ---------------------------------------------------------------- the platforms and the frames

  /** A running camera whose platform is gone stops by itself (brief function 8). */
  private void platformsChecked() {
    if (!copy.loaded()) {
      return;
    }
    boolean changed = false;
    for (Camera c : cameras.values()) {
      Platform p = copy.platform(c.platform);
      boolean gone = p == null;
      if (p != null && p.name() != null) {
        c.platformName = p.name();
      }
      if (gone && c.running()) {
        halt(c);
        changed = true;
      }
      changed |= gone != c.platformGone;
      c.platformGone = gone;
    }
    if (changed) {
      status();
    }
  }

  private void tick(UUID id) {
    Camera c = cameras.get(id);
    if (c == null || !c.running()) {
      return; // a tick that was on its way when the camera stopped
    }
    Platform platform = copy.platform(c.platform);
    Pose.Setup setup = c.settings.setup();
    if (platform == null || setup == null) {
      halt(c);
      c.platformGone = platform == null;
      status();
      return;
    }
    Instant now = clock.instant();
    Fix target = null;
    if (c.settings.mode() == CameraSettings.Mode.TRACK_OBJECT && c.settings.target() != null) {
      Platform t = copy.platform(c.settings.target());
      target = t == null ? null : t.fix();
    }
    Duration sinceStart = Duration.between(c.startedAt, now);
    Pose.Computed computed = Pose.at(c.id.toString(), setup, platform, target, now, sinceStart, c.last);
    c.last = computed.pose().aim();
    Pose pose = c.sway == null ? computed.pose() : computed.pose().swayed(c.sway.at(sinceStart.toNanos() / 1e9));
    JsonObject payload = PoseJson.of(pose, c.settings.overlay()); // CR-0055: a change reaches the next pose
    c.pose = payload;
    c.poseClassification = pose.label().classification();
    if (computed.targetGone() != c.targetGone) {
      c.targetGone = computed.targetGone();
      status();
    }
    c.poses++;
    thisMinute.poses++;
    if (computed.held()) {
      thisMinute.held++;
    }
    send(c, pose, payload);
  }

  /**
   * Sends one pose to the camera's output (brief section 4, function 9): nothing without an output
   * (C3) or while it is missing (C4); nothing, counted and shown, for a height outside the kind's
   * bounds (C5). A send ECore refuses is a bug here: counted, logged once per start, never retried (C6).
   */
  private void send(Camera c, Pose pose, JsonObject payload) {
    ChannelId output = c.settings.output();
    if (output == null || missing(c)) {
      c.notSent = null; // the state says why: no output, or Output missing
      return;
    }
    double height = Objects.requireNonNull(pose.position().altitude());
    if (height < MIN_SEND_HEIGHT || height > MAX_SEND_HEIGHT) {
      thisMinute.notSent++;
      c.notSent = "the platform's height, " + Math.round(height) + " m, is outside −1 000 to 20 000 m";
      return;
    }
    c.notSent = null; // a refusal below sets it again
    SendResult result;
    try {
      result = context.channels().send(output, new DeclaredItem(KIND, c.id, pose.label(), payload));
    } catch (IllegalArgumentException e) {
      thisMinute.refused++;
      c.notSent = "refused by ECore: " + e.getMessage();
      if (!c.refusalLogged) {
        c.refusalLogged = true;
        context.log().warn("camera {}: ECore refused its pose for {}: {}", c.id, output, e.getMessage());
      }
      if (!c.refused) {
        c.refused = true;
        status();
      }
      return;
    }
    switch (result) {
      case ACCEPTED -> {
        thisMinute.sent++;
        c.sent++;
        c.notSent = null;
        if (c.refused) {
          c.refused = false;
          status();
        }
      }
      case DROPPED -> thisMinute.dropped++;
      case CLOSED -> {
        thisMinute.closed++;
        c.closed = true;
        status();
      }
    }
  }

  /** The output on offer by this id that takes the pose kind, or {@code null}. */
  private @Nullable ChannelInfo onOffer(@Nullable ChannelId id) {
    if (id == null) {
      return null;
    }
    ChannelInfo info = outputs.find(id).orElse(null);
    return info != null && info.takesDeclared(KIND) ? info : null;
  }

  /** C4: the camera has an output, and it is not on offer or answered {@code CLOSED}. */
  private boolean missing(Camera c) {
    return c.settings.output() != null && (c.closed || onOffer(c.settings.output()) == null);
  }

  private void run(Camera c, WorkerContext<CameraMsg> ctx) {
    halt(c);
    c.startedAt = clock.instant();
    c.last = null;
    c.targetGone = false;
    c.refused = false;
    c.refusalLogged = false;
    c.notSent = null;
    c.sway = sway(c);
    c.timer = context.timers().every(c.settings.frame().period(), ctx.self(), new CameraMsg.Tick(c.id));
  }

  private static void halt(Camera c) {
    if (c.timer != null) {
      c.timer.cancel();
      c.timer = null;
    }
    c.sway = null;
  }

  /** The camera's micro sway from its settings, or {@code null} when it is off. */
  private static @Nullable Sway sway(Camera c) {
    return c.settings.sway() ? new Sway(c.settings.swaySettings()) : null;
  }

  // ---------------------------------------------------------------- the endpoints

  /**
   * The cameras show and name Simulation's objects, so every endpoint also needs the workspace's view
   * permission (brief section 6; ADR-0039). ECore checks the plugin's own permission; this one is
   * checked here, and refused with 403 like ECore's.
   */
  private static boolean seesSimulation(EndpointRequest request) {
    if (request.user().has(WORKSPACE_VIEW)) {
      return true;
    }
    respond(request, 403, error("you may not see the Simulation workspace", null));
    return false;
  }

  private boolean ready(EndpointRequest request) {
    if (!loaded || !copy.loaded()) {
      respond(request, 503, error("the cameras are loading; try again", null));
      return false;
    }
    return true;
  }

  /** {@code POST /cameras}: {@code {platform, …settings}} (brief functions 2 and 13). */
  private void create(EndpointRequest request, WorkerContext<CameraMsg> ctx) {
    if (!ready(request)) {
      return;
    }
    if (!(request.body() instanceof JsonObject body)) {
      respond(request, 400, error("the body must be {\"platform\": \"<track id>\", …settings}", null));
      return;
    }
    UUID platform = body.get("platform") instanceof JsonString s ? CameraSettings.uuid(s.value()) : null;
    if (platform == null || copy.platform(platform) == null) {
      respond(request, 404, error("not a symbol in the Simulation workspace", "platform"));
      return;
    }
    Camera onIt = onPlatform(platform, null);
    if (onIt != null) {
      // U2: a track carries one camera; the panel opens that one.
      respond(request, 409, error("the track already has a camera", "platform").with("camera", JsonString.of(onIt.id.toString())));
      return;
    }
    if (cameras.size() >= MAX_CAMERAS) {
      respond(request, 409, error("at most " + MAX_CAMERAS + " cameras", null));
      return;
    }
    CameraSettings settings;
    try {
      settings = CameraSettings.parse(body.without("platform"), CameraSettings.DEFAULTS)
          .withDefaultPoint(copy.platform(platform).fix().position());
      checkTarget(settings, platform);
    } catch (CameraSettings.Invalid e) {
      respond(request, 400, error(e.getMessage(), e.field));
      return;
    }
    if (outputRefused(request, settings, null)) {
      return;
    }
    UUID id = UUID.randomUUID();
    if (!body.has("swaySeed")) {
      // brief section 5: a new camera's sway gets a seed of its own, here from its random id
      settings = settings.withSeed(Math.floorMod(id.getLeastSignificantBits(), CameraSettings.MAX_SEED + 1));
    }
    Camera c = new Camera(id, platform, copy.platform(platform).name(), settings);
    c.outputName = outputNameOf(settings.output());
    cameras.put(c.id, c);
    save(c, ctx);
    saveIndex(ctx);
    status();
    respond(request, 200, camera(c));
  }

  /** {@code POST /cameras/{id}}: any settings, and {@code platform} (B7). */
  private void change(EndpointRequest request, WorkerContext<CameraMsg> ctx) {
    Camera c = found(request);
    if (c == null) {
      return;
    }
    if (!(request.body() instanceof JsonObject body)) {
      respond(request, 400, error("the body must be an object of settings", null));
      return;
    }
    UUID platform = c.platform;
    if (body.get("platform") != null) {
      platform = body.get("platform") instanceof JsonString s ? CameraSettings.uuid(s.value()) : null;
      if (platform == null || copy.platform(platform) == null) {
        respond(request, 404, error("not a symbol in the Simulation workspace", "platform"));
        return;
      }
      Camera onIt = onPlatform(platform, c);
      if (onIt != null) {
        respond(request, 409, error("the track already has a camera", "platform").with("camera", JsonString.of(onIt.id.toString())));
        return;
      }
    }
    Platform at = copy.platform(platform);
    CameraSettings settings;
    try {
      settings = CameraSettings.parse(body.without("platform"), c.settings);
      if (at != null) {
        settings = settings.withDefaultPoint(at.fix().position());
      }
      checkTarget(settings, platform);
      CameraSettings.Invalid missing = settings.missing();
      if (c.running() && missing != null) {
        throw missing;
      }
    } catch (CameraSettings.Invalid e) {
      respond(request, 400, error(e.getMessage(), e.field));
      return;
    }
    if (outputRefused(request, settings, c)) {
      return;
    }
    boolean newRate = settings.frame().rate() != c.settings.frame().rate();
    boolean newSway = settings.sway() != c.settings.sway() || !settings.swaySettings().equals(c.settings.swaySettings());
    if (!Objects.equals(settings.output(), c.settings.output())) {
      c.closed = false;
      c.notSent = null;
      c.outputName = outputNameOf(settings.output());
    }
    c.platform = platform;
    c.platformGone = at == null;
    if (at != null) {
      c.platformName = at.name();
    }
    c.settings = settings;
    if (c.running() && newRate) {
      // Function 8: a new frame rate restarts the timer; the sweep's phase still counts from the start (B2).
      Instant started = c.startedAt;
      Aim last = c.last;
      run(c, ctx);
      c.startedAt = started;
      c.last = last;
    } else if (c.running() && newSway) {
      c.sway = sway(c); // from the next pose (M10 plan point 8); its time still counts from the start
    }
    save(c, ctx);
    status();
    respond(request, 200, camera(c));
  }

  private void remove(EndpointRequest request, WorkerContext<CameraMsg> ctx) {
    Camera c = found(request);
    if (c == null) {
      return;
    }
    halt(c);
    cameras.remove(c.id);
    saveIndex(ctx);
    context.documents().delete(key(c.id), ctx.self(), CameraMsg.Document::new);
    status();
    respond(request, 200, list());
  }

  /** {@code POST /cameras/{id}/start} (brief function 8; B4). */
  private void start(EndpointRequest request, WorkerContext<CameraMsg> ctx) {
    Camera c = found(request);
    if (c == null) {
      return;
    }
    if (copy.platform(c.platform) == null) {
      c.platformGone = true;
      respond(request, 409, error("the platform is gone; pick another", "platform"));
      return;
    }
    CameraSettings.Invalid missing = c.settings.missing();
    if (missing != null) {
      respond(request, 400, error(missing.getMessage(), missing.field));
      return;
    }
    if (c.settings.mode() == CameraSettings.Mode.TRACK_OBJECT && copy.platform(c.settings.target()) == null) {
      respond(request, 409, error("the target is not in the Simulation workspace", "target"));
      return;
    }
    if (!c.running()) {
      run(c, ctx);
    }
    status();
    respond(request, 200, camera(c));
  }

  private void stop(EndpointRequest request) {
    Camera c = found(request);
    if (c == null) {
      return;
    }
    halt(c);
    status();
    respond(request, 200, camera(c));
  }

  private @Nullable Camera found(EndpointRequest request) {
    if (!ready(request)) {
      return null;
    }
    UUID id = CameraSettings.uuid(request.pathParameter("id"));
    Camera c = id == null ? null : cameras.get(id);
    if (c == null) {
      respond(request, 404, error("no such camera", null));
    }
    return c;
  }

  private @Nullable Camera onPlatform(UUID platform, @Nullable Camera except) {
    for (Camera c : cameras.values()) {
      if (c != except && c.platform.equals(platform)) {
        return c;
      }
    }
    return null;
  }

  /**
   * The output must be on offer and take the pose kind (function 9; C1), unless it is the camera's own
   * missing one, kept; and no other camera may have chosen it (U10; C2). Answers the refusal.
   */
  private boolean outputRefused(EndpointRequest request, CameraSettings settings, @Nullable Camera self) {
    ChannelId output = settings.output();
    if (output == null || self != null && output.equals(self.settings.output())) {
      return false;
    }
    if (onOffer(output) == null) {
      respond(request, 404, error("not an output on offer that takes camera poses", "output"));
      return true;
    }
    for (Camera other : cameras.values()) {
      if (other != self && output.equals(other.settings.output())) {
        respond(request, 409, error("the output is used by another camera", "output").with("camera", JsonString.of(other.id.toString())));
        return true;
      }
    }
    return false;
  }

  /** The target must be a symbol in Simulation, and not the platform (brief section 5). */
  private void checkTarget(CameraSettings settings, UUID platform) throws CameraSettings.Invalid {
    UUID target = settings.target();
    if (target == null) {
      return;
    }
    if (target.equals(platform)) {
      throw new CameraSettings.Invalid("target", "the target cannot be the platform");
    }
    if (copy.platform(target) == null) {
      throw new CameraSettings.Invalid("target", "not a symbol in the Simulation workspace");
    }
  }

  // ---------------------------------------------------------------- answers and status

  /** A camera's state, as the panel and the status show it (brief function 10). */
  private String state(Camera c) {
    if (c.running()) {
      if (missing(c)) {
        return "outputMissing";
      }
      return c.targetGone ? "targetGone" : "running";
    }
    return c.platformGone ? "platformGone" : "stopped";
  }

  private JsonObject camera(Camera c) {
    Platform p = copy.platform(c.platform);
    String name = p != null ? p.name() : c.platformName;
    return JsonObject.builder()
        .put("id", JsonString.of(c.id.toString()))
        .put("platform", JsonString.of(c.platform.toString()))
        .put("platformName", name == null ? JsonNull.INSTANCE : JsonString.of(name))
        .put("platformPosition", platformPosition(p))
        .put("targetName", targetName(c))
        .put("state", JsonString.of(state(c)))
        .put("running", JsonBoolean.of(c.running()))
        .put("settings", c.settings.json())
        .put("poses", JsonNumber.of(c.poses))
        .put("targetGone", JsonBoolean.of(c.running() && c.targetGone))
        .put("output", c.settings.output() == null ? JsonNull.INSTANCE : JsonString.of(c.settings.output().toString()))
        .put("outputName", outputName(c))
        .put("outputMissing", JsonBoolean.of(missing(c)))
        .put("outputState", outputState(c))
        .put("outputDetail", outputDetail(c))
        .put("sent", JsonNumber.of(c.sent))
        .put("notSent", c.notSent == null || !c.running() ? JsonNull.INSTANCE : JsonString.of(c.notSent))
        .put("pose", c.pose == null || !c.running() ? JsonNull.INSTANCE : c.pose)
        .put("poseClassification", c.poseClassification == null || !c.running() ? JsonNull.INSTANCE : JsonString.of(c.poseClassification))
        .build();
  }

  /**
   * The platform's last reported position, {@code [longitude, latitude]}, or null while it is gone: the
   * form's default point when Track a point is chosen (brief section 5), as {@code withDefaultPoint} is the server's.
   */
  private static JsonValue platformPosition(@Nullable Platform p) {
    if (p == null) {
      return JsonNull.INSTANCE;
    }
    Position at = p.fix().position();
    return JsonArray.of(JsonNumber.of(at.longitude()), JsonNumber.of(at.latitude()));
  }

  /** Track an object's target's name for the panel; null without a target, a name or the target itself. */
  private JsonValue targetName(Camera c) {
    UUID target = c.settings.target();
    Platform t = target == null ? null : copy.platform(target);
    return t == null || t.name() == null ? JsonNull.INSTANCE : JsonString.of(t.name());
  }

  /** The output's name: as offered now, else the last known (a missing output's), else none. */
  private JsonValue outputName(Camera c) {
    if (c.settings.output() == null) {
      return JsonNull.INSTANCE;
    }
    ChannelInfo info = onOffer(c.settings.output());
    String name = info != null ? info.name() : c.outputName;
    return name == null ? JsonNull.INSTANCE : JsonString.of(name);
  }

  /**
   * What the output link says back (function 9, part U): its state as its plugin set it, "ready",
   * "degraded" or "notSending"; null without an output or while it is missing (C4). The camera sends
   * in every state: the link takes items in each, and {@code fmv} needs poses to try again.
   */
  private JsonValue outputState(Camera c) {
    ChannelInfo info = missing(c) ? null : onOffer(c.settings.output());
    return info == null ? JsonNull.INSTANCE : JsonString.of(stateName(info.state()));
  }

  /** The link's plain-text detail for its state, e.g. "No destination"; null as {@link #outputState}. */
  private JsonValue outputDetail(Camera c) {
    ChannelInfo info = missing(c) ? null : onOffer(c.settings.output());
    return info == null ? JsonNull.INSTANCE : JsonString.of(info.stateDetail());
  }

  private static String stateName(ChannelState state) {
    return switch (state) {
      case READY -> "ready";
      case DEGRADED -> "degraded";
      case NOT_SENDING -> "notSending";
    };
  }

  private @Nullable String outputNameOf(@Nullable ChannelId id) {
    ChannelInfo info = onOffer(id);
    return info == null ? null : info.name();
  }

  private JsonObject list() {
    var list = new ArrayList<JsonValue>();
    cameras.values().forEach(c -> list.add(camera(c)));
    // Function 13: the outputs on offer, each with the camera that has chosen it (U10).
    var offered = new ArrayList<JsonValue>();
    for (ChannelInfo info : outputs.channels()) {
      if (info.takesDeclared(KIND)) {
        Camera by = null;
        for (Camera c : cameras.values()) {
          if (info.id().equals(c.settings.output())) {
            by = c;
          }
        }
        offered.add(JsonObject.builder().put("id", JsonString.of(info.id().toString())).put("name", JsonString.of(info.name()))
            .put("camera", by == null ? JsonNull.INSTANCE : JsonString.of(by.id.toString()))
            .put("state", JsonString.of(stateName(info.state()))).put("detail", JsonString.of(info.stateDetail())).build());
      }
    }
    return JsonObject.builder().put("cameras", new JsonArray(list)).put("outputs", new JsonArray(offered)).put("max", JsonNumber.of(MAX_CAMERAS)).build();
  }

  private void status() {
    if (!loaded) {
      context.status().set(PluginState.OK, "loading the cameras");
      return;
    }
    long running = cameras.values().stream().filter(Camera::running).count();
    var states = new LinkedHashMap<String, Integer>();
    cameras.values().forEach(c -> states.merge(state(c), 1, Integer::sum));
    var text = new StringBuilder();
    text.append(cameras.size()).append(cameras.size() == 1 ? " camera" : " cameras").append(", ").append(running).append(" running");
    states.forEach((s, n) -> {
      if (!s.equals("running") && !s.equals("stopped")) {
        text.append(", ").append(n).append(' ').append(switch (s) {
          case "platformGone" -> "platform gone";
          case "outputMissing" -> "output missing";
          default -> "target gone";
        });
      }
    });
    // Part U: running cameras whose link says it is not sending or degraded; text only, the status stays OK (owner, 2026-11-17).
    var linkStates = new LinkedHashMap<ChannelState, Integer>();
    cameras.values().stream().filter(c -> c.running() && !missing(c)).map(c -> onOffer(c.settings.output())).filter(Objects::nonNull)
        .map(ChannelInfo::state).filter(s -> s != ChannelState.READY).sorted().forEach(s -> linkStates.merge(s, 1, Integer::sum));
    linkStates.forEach((s, n) -> text.append(", ").append(n).append(n == 1 ? " output " : " outputs ")
        .append(s == ChannelState.NOT_SENDING ? "not sending" : "degraded"));
    Minute m = lastMinute;
    text.append("; last minute: ").append(m.poses).append(" poses, ").append(m.sent).append(" sent");
    if (m.dropped + m.closed + m.notSent + m.refused > 0) {
      text.append(" (").append(m.dropped).append(" dropped, ").append(m.closed).append(" closed, ").append(m.notSent).append(" not sent, ")
          .append(m.refused).append(" refused)");
    }
    text.append(", ").append(m.held).append(" held");
    text.append("; new snapshots ").append(copy.newSnapshots());
    var problems = new ArrayList<String>();
    if (readProblem != null) {
      problems.add(readProblem);
    }
    if (writeProblem != null) {
      problems.add(writeProblem);
    }
    long missing = cameras.values().stream().filter(c -> c.running() && missing(c)).count();
    if (missing > 0) {
      problems.add(missing + (missing == 1 ? " running camera's output is missing" : " running cameras' outputs are missing"));
    }
    long refused = cameras.values().stream().filter(c -> c.running() && c.refused).count();
    if (refused > 0) {
      problems.add(refused + (refused == 1 ? " camera's poses are refused by ECore" : " cameras' poses are refused by ECore"));
    }
    if (!problems.isEmpty()) {
      context.status().set(PluginState.DEGRADED, String.join("; ", problems) + "; " + text);
    } else {
      context.status().set(PluginState.OK, text.toString());
    }
  }

  private static JsonObject error(String message, @Nullable String field) {
    var b = JsonObject.builder().put("error", JsonString.of(message));
    if (field != null) {
      b.put("field", JsonString.of(field));
    }
    return b.build();
  }

  private static void respond(EndpointRequest request, int status, JsonObject body) {
    HttpReply reply = HttpReply.json(status, body);
    request.response().respond(new HttpReply(reply.status(), reply.headers().with("Cache-Control", "no-store"), reply.body()));
  }
}
