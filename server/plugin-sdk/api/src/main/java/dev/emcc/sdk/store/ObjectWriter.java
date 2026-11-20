package dev.emcc.sdk.store;

import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.LayerChoice;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginLog;
import dev.emcc.sdk.document.DocumentResult;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.worker.WorkerRef;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.4.0: writes what an in plugin receives into the object store (CR-0030 part 1b, T-147): the
 * target layer of each link, and at most one change request in flight per object. It is the
 * logic {@code cot}, {@code ais} and {@code adsb} each wrote themselves, built only on the SDK's
 * public store, document, timer and subscription API.
 *
 * <p><b>One worker owns it</b> and calls it only from its handler, so it needs no locks (rule C2).
 * It sends its own answers to that worker, wrapped by the function the plugin gives; the handler
 * passes each {@link Reply} back to {@link #handle}.
 *
 * <p><b>What it does:</b>
 * <ul>
 *   <li><b>Objects by external identity</b> (model rule 16): one store subscription by the
 *       writer's {@code system} finds the objects again after a restart, so a restart updates them
 *       instead of creating new ones.
 *   <li><b>One change request in flight per external id.</b> A newer {@link #write} replaces one
 *       that waits: the latest wins, and each is built from the state the store last reported. A
 *       busy feed so costs one change request per object at a time.
 *   <li><b>Targets:</b> each link's layer (ADR-0037 point 2). A picked layer that exists is used; a
 *       picked layer that is gone, or a target without a pick, is made by its name in View and kept
 *       in the plugin document {@link #LAYERS_KEY}, so that two links that name the same new layer
 *       share one, and a layer deleted later is made again at the next write.
 *   <li><b>A moved object stays where it is</b> (SDK 1.5.0, CR-0039 point 10, ADR-0053 point 7): an
 *       update is built with the stored object's layer, so a track a user moved into another layer
 *       is updated there; the target's layer is only where new objects appear. After a lost plugin
 *       document the writer adopts only a View layer with the target's new-layer name, never a
 *       layer just because an object of the link is in it.
 *   <li><b>Outcomes:</b> an unknown outcome or {@code ENTITY_EXISTS} looks the object up and builds
 *       again; {@code ENTITY_NOT_FOUND} creates it again; {@code LAYER_NOT_FOUND} finds the layer
 *       again. At most {@link #MAX_ATTEMPTS} tries per write; other rejections are counted.
 *   <li><b>Warnings</b> at most once a minute per target (ADR-0037 point 7), and counters for the
 *       monitor view through each target's {@link Counter}.
 * </ul>
 *
 * <p><b>Field sets</b> (SDK 1.4.0, ADR-0050 point 4): with {@link #fieldSet(String)} the writer adds
 * the plugin's set to every object it writes, so that a received object carries it from the start
 * (the store adds it once; nothing removes it).
 *
 * <p>The plugin never deletes through it: objects end by their data type's expiry.
 *
 * <pre>{@code
 * sealed interface LinkMsg extends Message {
 *   record Writer(ObjectWriter.Reply reply) implements LinkMsg {}
 *   ...
 * }
 * // in the handler, with the first message:
 * writer = ObjectWriter.create(context, ctx.self(), "ais", LinkMsg.Writer::new);
 * writer.fieldSet("ais.ship");   // SDK 1.4.0
 * writer.start();
 * // on settings:
 * writer.targets(List.of(new ObjectWriter.Target("vernon", choice, label, ref::count)));
 * // on a received position:
 * writer.write("vernon", "002190047", (stored, layerId) -> ShipMapper.content(stored, layerId, report));
 * // on LinkMsg.Writer:
 * writer.handle(m.reply());
 * }</pre>
 */
public final class ObjectWriter {

  /** The plugin document that keeps the layers the writer made, by name. */
  public static final String LAYERS_KEY = "object-writer.layers";
  /** Change requests in flight at once: far below ECore's cap of outstanding asks (CR-0005). */
  public static final int MAX_IN_FLIGHT = 1_000;
  /** Objects whose write waits; beyond it a new object's write is dropped and counted. */
  public static final int MAX_WAITING = 100_000;
  /** Tries per write, the first included. */
  public static final int MAX_ATTEMPTS = 3;

  private static final Duration TIMEOUT = Duration.ofSeconds(10);
  private static final Duration TICK = Duration.ofSeconds(1);
  private static final long WARN_EVERY_TICKS = 60;
  private static final long LAYER_RETRY_TICKS = 5;

  /** Counts for the monitor view, e.g. a connection's {@code ref::count}. */
  @FunctionalInterface
  public interface Counter {
    void count(String name, long delta);
  }

  /**
   * Builds the content to write.
   */
  @FunctionalInterface
  public interface Build {
    /**
     * The content to write, or {@code null} for nothing.
     *
     * @param stored the object as the store last reported it, or {@code null} if it does not exist
     *     yet; then the content creates it
     * @param layerId for a create, the target's layer, the content's {@code layerId}; for an update,
     *     the stored object's own layer (SDK 1.5.0: promised, ADR-0053 point 7), so that an object a
     *     user moved stays in its layer. Use it; move the object only on purpose
     */
    @Nullable MapObjectContent content(@Nullable MapObject stored, UUID layerId);
  }

  /**
   * One link's target (ADR-0037 point 2).
   *
   * @param name the link's name, also the data source the plugin gives its objects
   * @param layer the layer an admin picked, or {@code null}: a new layer named like the link
   * @param label the label of a layer the writer makes, or {@code null} for the default label
   * @param counter where its counts go, or {@code null}
   */
  public record Target(String name, @Nullable LayerChoice layer, @Nullable SecurityLabel label, @Nullable Counter counter) {
    public Target {
      Objects.requireNonNull(name, "name");
    }

    /** The name of the layer made for it: the picked layer's, else the link's. */
    public String newLayerName() {
      return layer != null ? layer.name() : name;
    }
  }

  /** What a target did so far, for the plugin's status. */
  public record Stats(long created, long updated, long rejected, @Nullable String layerName) {}

  /** The writer's own messages to its worker; the handler passes each back to {@link #handle}. */
  public sealed interface Reply extends Message {}

  private record Answer(String key, long ticket, ChangeOutcome outcome) implements Reply {}

  private record Looked(String key, long ticket, QueryResult result) implements Reply {}

  private record LayerAnswer(String name, long ticket, ChangeOutcome outcome) implements Reply {}

  private record Stored(StoreUpdate update) implements Reply {}

  private record LayersLoaded(DocumentResult result) implements Reply {}

  private record LayersSaved(DocumentResult result) implements Reply {}

  private record Tick() implements Reply {}

  private enum Phase { WRITING, LOOKING_UP }

  private record Work(String key, String target, Build build, int attempts) {
    Work again() {
      return new Work(key, target, build, attempts + 1);
    }
  }

  private static final class InFlight {
    Phase phase = Phase.WRITING;
    long ticket;
    boolean creating;
    Work active;
    @Nullable Work queued;

    InFlight(long ticket, Work active) {
      this.ticket = ticket;
      this.active = active;
    }
  }

  private static final class TargetState {
    Target target;
    @Nullable UUID layerId;
    long layerRetryTick;
    long lastWarnTick = Long.MIN_VALUE / 2;
    /** Writes waiting for this target's layer; one per key, the latest. */
    final LinkedHashMap<String, Work> parked = new LinkedHashMap<>();
    long created;
    long updated;
    long rejected;

    TargetState(Target target) {
      this.target = target;
    }

    void count(String name) {
      Counter c = target.counter();
      if (c != null) {
        c.count(name, 1);
      }
    }
  }

  private final PluginContext context;
  private final WorkerRef<?> self;
  private final String system;
  private final Function<Reply, ? extends Message> wrap;
  private final SecureRandom random = new SecureRandom();

  private final Map<String, TargetState> targets = new LinkedHashMap<>();
  private final Map<String, UUID> madeLayers = new LinkedHashMap<>();
  private final Map<String, Long> layersInMaking = new HashMap<>();
  private final Map<String, MapObject> objects = new HashMap<>();
  private final Map<UUID, String> keyById = new HashMap<>();
  /** SDK 1.4.0 part 4: the id each key's create will use, from its first write until the store reports the object. */
  private final Map<String, UUID> reserved = new HashMap<>();
  private final Map<UUID, Layer> layers = new HashMap<>();
  private final Map<UUID, Long> layerMadeAt = new HashMap<>();
  private final Map<String, InFlight> inFlight = new HashMap<>();
  private final LinkedHashMap<String, Work> waiting = new LinkedHashMap<>();

  private @Nullable String fieldSet;
  private @Nullable Cancellable subscription;
  private @Nullable Cancellable ticker;
  private long seenSequence;
  private boolean snapshotLoaded;
  private boolean documentLoaded;
  private boolean ready;
  private long tickets;
  private long tick;
  private long lastGlobalWarnTick = Long.MIN_VALUE / 2;

  private <M extends Message> ObjectWriter(PluginContext context, WorkerRef<M> self, String system, Function<Reply, ? extends M> wrap) {
    this.context = Objects.requireNonNull(context, "context");
    this.self = Objects.requireNonNull(self, "self");
    this.system = Objects.requireNonNull(system, "system");
    this.wrap = Objects.requireNonNull(wrap, "wrap");
    if (system.isEmpty() || system.length() > 256) {
      throw new IllegalArgumentException("an external system is 1..256 characters: " + system);
    }
  }

  /**
   * A writer owned by the worker {@code self}.
   *
   * @param system the external identity's namespace of its objects, e.g. {@code ais} (model rule 16)
   * @param wrap turns its replies into the worker's messages
   */
  public static <M extends Message> ObjectWriter create(PluginContext context, WorkerRef<M> self, String system, Function<Reply, ? extends M> wrap) {
    return new ObjectWriter(context, self, system, wrap);
  }

  /**
   * SDK 1.4.0: the field set (its full id, e.g. {@code ais.ship}) added to every object it
   * writes, or none for {@code null} (ADR-0050 point 4). It must be one of the plugin's own sets in
   * {@code context.fieldSets()}, else the store rejects the writes (model rule 18).
   */
  public void fieldSet(@Nullable String setId) {
    if (setId != null && !setId.startsWith(context.pluginId() + ".")) {
      throw new IllegalArgumentException("the writer adds the plugin's own field set, not " + setId);
    }
    this.fieldSet = setId;
  }

  /** Subscribes to its objects, reads its layers and starts its once-a-second timer. Writes before it wait. */
  public void start() {
    if (subscription != null) {
      return;
    }
    subscription = context.store().subscribe(ObjectQuery.byExternalSystem(system), self(), u -> wrap.apply(new Stored(u)));
    context.documents().get(LAYERS_KEY, self(), r -> wrap.apply(new LayersLoaded(r)));
    ticker = context.timers().every(TICK, self(), wrap.apply(new Tick()));
  }

  /** Ends the subscription and the timer. Answers still on their way are ignored. */
  public void stop() {
    if (subscription != null) {
      subscription.cancel();
    }
    if (ticker != null) {
      ticker.cancel();
    }
  }

  @SuppressWarnings("unchecked")
  private <M extends Message> WorkerRef<M> self() {
    return (WorkerRef<M>) self;
  }

  // ---------------------------------------------------------------- targets

  /** The targets as the settings now have them: new ones are added, changed ones follow their new layer, gone ones are forgotten with their waiting writes. */
  public void targets(List<Target> wanted) {
    Set<String> names = new HashSet<>();
    wanted.forEach(t -> names.add(t.name()));
    var dropped = new java.util.ArrayList<String>();
    for (Iterator<TargetState> it = targets.values().iterator(); it.hasNext(); ) {
      TargetState state = it.next();
      if (!names.contains(state.target.name())) {
        dropped.addAll(state.parked.keySet());
        it.remove();
      }
    }
    dropped.forEach(this::release);
    for (Target target : wanted) {
      TargetState state = targets.get(target.name());
      if (state == null) {
        targets.put(target.name(), new TargetState(target));
        continue;
      }
      if (!Objects.equals(state.target.layer(), target.layer())) {
        state.layerId = null; // another layer: looked for again
      }
      state.target = target;
    }
    unparkAll();
  }

  /** What the target did so far, and its layer's name once known. */
  public Stats stats(String target) {
    TargetState state = targets.get(target);
    if (state == null) {
      return new Stats(0, 0, 0, null);
    }
    UUID id = state.layerId;
    if (id == null) {
      LayerChoice picked = state.target.layer();
      id = picked != null && picked.id() != null && layers.containsKey(picked.id()) ? picked.id() : madeLayers.get(state.target.newLayerName());
    }
    Layer layer = id == null ? null : layers.get(id);
    return new Stats(state.created, state.updated, state.rejected, layer == null ? null : layer.content().name());
  }

  /**
   * The object the store last reported for {@code externalId}, or {@code null}, also while its
   * create waits or is in flight; {@link #objectId(String)} gives its id from the first write.
   */
  public @Nullable MapObject object(String externalId) {
    return objects.get(externalId);
  }

  /**
   * SDK 1.4.0 part 4 (CR-0030, owner IP): the id of the object written under {@code externalId}:
   * the stored object's, or, from the key's first {@link #write} until the store reports the
   * object, the id the writer will create it with, also while that create waits or is in flight.
   * So a plugin can refer to an object in the same handler call that first writes it, e.g. a
   * detection's relation to its platform. {@code null} for a key never written, or whose write was
   * dropped. Should the store hold the object under another id after all (it was there already),
   * that id is returned once the writer has found it.
   */
  public @Nullable UUID objectId(String externalId) {
    MapObject stored = objects.get(externalId);
    return stored != null ? stored.id() : reserved.get(externalId);
  }

  /** Lets go of a reservation whose key has no object and no write left. */
  private void release(String key) {
    if (!objects.containsKey(key) && !inFlight.containsKey(key) && !waiting.containsKey(key) && targets.values().stream().noneMatch(s -> s.parked.containsKey(key))) {
      reserved.remove(key);
    }
  }

  // ---------------------------------------------------------------- writes

  /**
   * Writes the object with the external id {@code externalId} through {@code target}: created in
   * the target's layer if it does not exist, else updated. {@code build} is called when the write
   * starts, with the state the store last reported, and again on a retry; it returns {@code null}
   * when there is nothing to write. A write for a target that is not (or no longer) set is dropped.
   */
  public void write(String target, String externalId, Build build) {
    Objects.requireNonNull(externalId, "externalId");
    Objects.requireNonNull(build, "build");
    if (!targets.containsKey(target)) {
      return;
    }
    if (!objects.containsKey(externalId)) {
      reserved.computeIfAbsent(externalId, k -> newId());
    }
    accept(new Work(externalId, target, build, 0));
  }

  private void accept(Work work) {
    InFlight running = inFlight.get(work.key());
    if (running != null) {
      running.queued = work; // the latest wins
      return;
    }
    removeParked(work.key());
    if (!ready || inFlight.size() >= MAX_IN_FLIGHT) {
      if (waiting.containsKey(work.key()) || waiting.size() < MAX_WAITING) {
        waiting.put(work.key(), work);
      } else {
        TargetState t = targets.get(work.target());
        if (t != null) {
          t.rejected++;
          t.count("dropped: too many waiting");
          warn(t, "target {}: too many objects wait; dropped a write", work.target());
        }
        release(work.key());
      }
      return;
    }
    waiting.remove(work.key());
    start(work);
  }

  private void pump() {
    if (!ready) {
      return;
    }
    while (inFlight.size() < MAX_IN_FLIGHT && !waiting.isEmpty()) {
      Iterator<Work> it = waiting.values().iterator();
      Work work = it.next();
      it.remove();
      start(work);
    }
  }

  private void start(Work work) {
    TargetState target = targets.get(work.target());
    if (target == null) {
      release(work.key());
      return; // its link went
    }
    MapObject stored = objects.get(work.key());
    if (stored != null) {
      MapObjectContent content = build(work, stored, stored.content().layerId());
      if (content == null || content.equals(stored.content())) {
        return; // nothing new
      }
      submit(work, false, Change.updateObject(stored, content).bySystem(work.target()));
      return;
    }
    UUID layerId = ensureLayer(target);
    if (layerId == null) {
      target.parked.put(work.key(), work);
      return;
    }
    MapObjectContent content = build(work, null, layerId);
    if (content == null) {
      release(work.key());
      return;
    }
    Change create = Change.createObject(reserved.computeIfAbsent(work.key(), k -> newId()), content).withExternalRef(new ExternalRef(system, work.key())).bySystem(work.target());
    submit(work, true, create);
  }

  private @Nullable MapObjectContent build(Work work, @Nullable MapObject stored, UUID layerId) {
    try {
      MapObjectContent content = work.build().content(stored, layerId);
      return content == null || fieldSet == null ? content : content.withFieldSet(fieldSet);
    } catch (RuntimeException e) {
      TargetState t = targets.get(work.target());
      if (t != null) {
        t.rejected++;
        t.count("dropped: not built");
      }
      warn(t, "target {}: an object could not be built ({})", work.target(), clean(String.valueOf(e.getMessage())));
      return null;
    }
  }

  private void submit(Work work, boolean creating, Change change) {
    var running = new InFlight(++tickets, work);
    running.creating = creating;
    inFlight.put(work.key(), running);
    String key = work.key();
    long ticket = running.ticket;
    context.store().submit(change, TIMEOUT, self(), outcome -> wrap.apply(new Answer(key, ticket, outcome)));
  }

  // ---------------------------------------------------------------- replies

  /** Passes one of the writer's own replies back to it. */
  public void handle(Reply reply) {
    switch (reply) {
      case Answer a -> onAnswer(a);
      case Looked l -> onLooked(l);
      case LayerAnswer l -> onLayerAnswer(l);
      case Stored s -> onStored(s.update());
      case LayersLoaded l -> onLayersLoaded(l.result());
      case LayersSaved s -> {
        if (s.result() instanceof DocumentResult.Failed f) {
          warn(null, "the layers could not be saved: {}", clean(f.reason()));
        }
      }
      case Tick t -> onTick();
    }
  }

  private void onAnswer(Answer m) {
    InFlight running = inFlight.get(m.key());
    if (running == null || running.ticket != m.ticket() || running.phase != Phase.WRITING) {
      return; // an answer to an earlier try
    }
    TargetState target = targets.get(running.active.target());
    switch (m.outcome()) {
      case ChangeOutcome.Applied applied -> {
        if (applied.event().state() instanceof MapObject object) {
          remember(object);
        }
        if (target != null) {
          if (running.creating) {
            target.created++;
            target.count("objects created");
          } else {
            target.updated++;
            target.count("objects updated");
          }
        }
        finish(m.key(), running);
      }
      case ChangeOutcome.Rejected rejected -> onRejected(m.key(), running, target, rejected.rejection());
      case ChangeOutcome.Unknown unknown -> {
        warn(target, "target {}: no answer from the object store ({})", running.active.target(), clean(unknown.reason()));
        lookUp(m.key(), running); // applied or not: look, then build again
      }
    }
  }

  private void onRejected(String key, InFlight running, @Nullable TargetState target, ChangeRejection rejection) {
    switch (rejection.code()) {
      case ENTITY_EXISTS, EXTERNAL_REF_EXISTS -> lookUp(key, running); // there after all: a resent create, or another writer
      case ENTITY_NOT_FOUND -> {
        forget(key); // deleted meanwhile, e.g. expired: the write creates it again
        retry(key, running, target);
      }
      case LAYER_NOT_FOUND -> {
        if (target != null) {
          target.layerId = null;
        }
        retry(key, running, target);
      }
      default -> {
        reject(target, rejection.code().name());
        warn(target, "target {}: the object store rejected an object ({}: {})", running.active.target(), rejection.code(), clean(rejection.message()));
        finish(key, running);
      }
    }
  }

  private void reject(@Nullable TargetState target, String why) {
    if (target != null) {
      target.rejected++;
      target.count("rejected: " + why);
    }
  }

  private void lookUp(String key, InFlight running) {
    running.phase = Phase.LOOKING_UP;
    running.ticket = ++tickets;
    long ticket = running.ticket;
    context.store().query(ObjectQuery.byExternalRef(new ExternalRef(system, key)), TIMEOUT, self(), r -> wrap.apply(new Looked(key, ticket, r)));
  }

  private void onLooked(Looked m) {
    InFlight running = inFlight.get(m.key());
    if (running == null || running.ticket != m.ticket() || running.phase != Phase.LOOKING_UP) {
      return;
    }
    if (m.result() instanceof QueryResult.Found found) {
      if (found.objects().isEmpty()) {
        forget(m.key());
      } else {
        remember(found.objects().getFirst());
      }
    }
    retry(m.key(), running, targets.get(running.active.target()));
  }

  /** Ends the write and starts the one that waited for it. */
  private void finish(String key, InFlight running) {
    inFlight.remove(key);
    if (running.queued != null) {
      accept(running.queued);
    } else {
      release(key);
    }
    pump();
  }

  /** Tries again from the current state, at most {@link #MAX_ATTEMPTS} times; a write that waited wins. */
  private void retry(String key, InFlight running, @Nullable TargetState target) {
    inFlight.remove(key);
    Work next = running.queued;
    if (next != null) {
      accept(next);
    } else if (running.active.attempts() + 1 >= MAX_ATTEMPTS) {
      reject(target, "gave up");
      warn(target, "target {}: gave up writing an object after {} tries", running.active.target(), MAX_ATTEMPTS);
      release(key);
    } else {
      accept(running.active.again());
    }
    pump();
  }

  // ---------------------------------------------------------------- layers

  /** The target's layer if it exists; otherwise starts making it and returns {@code null}. */
  private @Nullable UUID ensureLayer(TargetState target) {
    if (target.layerId != null && layerExists(target.layerId)) {
      return target.layerId;
    }
    LayerChoice picked = target.target.layer();
    if (picked != null && picked.id() != null && layerExists(picked.id())) {
      return target.layerId = picked.id();
    }
    String name = target.target.newLayerName();
    UUID made = madeLayers.get(name);
    if (made != null) {
      if (layerExists(made)) {
        return target.layerId = made;
      }
      madeLayers.remove(name); // deleted (only an empty layer can be)
      saveLayers();
    }
    if (layersInMaking.containsKey(name) || tick < target.layerRetryTick) {
      return null;
    }
    if (picked == null) {
      UUID adopted = adoptLayer(name, target.target.name());
      if (adopted != null) {
        madeLayers.put(name, adopted);
        saveLayers();
        return target.layerId = adopted;
      }
    }
    double top = layers.values().stream().mapToDouble(l -> l.content().drawOrder()).max().orElse(0) + 1;
    SecurityLabel label = target.target.label() != null ? target.target.label() : context.defaultLabel();
    var content = new LayerContent(name, top, true, label, Extensions.empty());
    long ticket = ++tickets;
    layersInMaking.put(name, ticket);
    context.store().submit(Change.createLayer(newId(), content).bySystem(target.target.name()), TIMEOUT, self(),
        o -> wrap.apply(new LayerAnswer(name, ticket, o)));
    return null;
  }

  /** In the store, or made by this writer after the newest change the subscription has shown. */
  private boolean layerExists(UUID id) {
    return layers.containsKey(id) || layerMadeAt.getOrDefault(id, -1L) > seenSequence;
  }

  /**
   * After a lost plugin document (SDK 1.5.0, CR-0039 point 10): a View layer named {@code layerName},
   * one that holds an object of this target first, else the top one of that name. Never a layer only
   * because an object of the target is in it: a user may have moved the object there (ADR-0053 point 7).
   */
  private @Nullable UUID adoptLayer(String layerName, String targetName) {
    Layer best = null;
    boolean bestHolds = false;
    for (Layer layer : layers.values()) {
      String ws = layer.content().workspace();
      if (!layer.content().name().equals(layerName) || (ws != null && !ws.equals("core.view")) || !layerExists(layer.id())) {
        continue;
      }
      boolean holds = holdsObjectOf(layer.id(), targetName);
      if (best == null || (holds && !bestHolds) || (holds == bestHolds && layer.content().drawOrder() > best.content().drawOrder())) {
        best = layer;
        bestHolds = holds;
      }
    }
    return best == null ? null : best.id();
  }

  private boolean holdsObjectOf(UUID layerId, String targetName) {
    for (MapObject object : objects.values()) {
      if (object.content().dataSource().equals(targetName) && object.content().layerId().equals(layerId)) {
        return true;
      }
    }
    return false;
  }

  private void onLayerAnswer(LayerAnswer m) {
    Long expected = layersInMaking.get(m.name());
    if (expected == null || expected != m.ticket()) {
      return;
    }
    layersInMaking.remove(m.name());
    switch (m.outcome()) {
      case ChangeOutcome.Applied applied -> {
        if (applied.event().state() instanceof Layer layer) {
          layers.put(layer.id(), layer);
          layerMadeAt.put(layer.id(), applied.event().sequenceNo());
          madeLayers.put(m.name(), layer.id());
          saveLayers();
          unparkAll();
        }
      }
      case ChangeOutcome.Rejected rejected -> {
        retryLayerLater(m.name());
        warn(null, "the layer '{}' could not be made ({}: {})", clean(m.name()), rejected.rejection().code(), clean(rejected.rejection().message()));
      }
      case ChangeOutcome.Unknown unknown -> {
        retryLayerLater(m.name());
        warn(null, "no answer to the making of the layer '{}' ({})", clean(m.name()), clean(unknown.reason()));
      }
    }
  }

  private void retryLayerLater(String name) {
    for (TargetState target : targets.values()) {
      if (target.target.newLayerName().equals(name)) {
        target.layerRetryTick = tick + LAYER_RETRY_TICKS;
      }
    }
  }

  private void removeParked(String key) {
    for (TargetState target : targets.values()) {
      target.parked.remove(key);
    }
  }

  /** Writes whose target now has a layer go on; the others keep waiting. */
  private void unparkAll() {
    if (!ready) {
      return; // the snapshot and the layers document come first
    }
    for (TargetState target : targets.values()) {
      if (target.parked.isEmpty() || ensureLayer(target) == null) {
        continue;
      }
      for (Work work : new ArrayList<>(target.parked.values())) {
        target.parked.remove(work.key());
        waiting.putIfAbsent(work.key(), work);
      }
    }
    pump();
  }

  private void saveLayers() {
    var byName = JsonObject.builder();
    madeLayers.forEach((name, id) -> byName.put(name, JsonString.of(id.toString())));
    context.documents().put(LAYERS_KEY, JsonObject.builder().put("named", byName.build()).build(), self(), r -> wrap.apply(new LayersSaved(r)));
  }

  private void onLayersLoaded(DocumentResult result) {
    switch (result) {
      case DocumentResult.Found found -> {
        if (found.value().get("named") instanceof JsonObject byName) {
          byName.members().forEach((name, value) -> {
            UUID id = uuid(value);
            if (id != null) {
              madeLayers.putIfAbsent(name, id);
            }
          });
        }
      }
      case DocumentResult.Failed failed -> warn(null, "the layers could not be read: {}", clean(failed.reason()));
      default -> {}
    }
    documentLoaded = true;
    checkReady();
  }

  private static @Nullable UUID uuid(JsonValue value) {
    if (value instanceof JsonString s) {
      try {
        return UUID.fromString(s.value());
      } catch (IllegalArgumentException e) {
        return null;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- the store

  private void onStored(StoreUpdate update) {
    switch (update) {
      case StoreUpdate.Snapshot snapshot -> {
        objects.clear();
        keyById.clear();
        layers.clear();
        snapshot.layers().forEach(l -> layers.put(l.id(), l));
        snapshot.objects().forEach(this::remember);
        seenSequence = snapshot.sequenceNo();
        snapshotLoaded = true;
        checkReady();
      }
      case StoreUpdate.Changes changes -> changes.events().forEach(this::onChange);
    }
  }

  private void onChange(ChangeEvent event) {
    seenSequence = Math.max(seenSequence, event.sequenceNo());
    if (event.entityType() == EntityType.LAYER) {
      if (event.operation() == Operation.DELETE) {
        layers.remove(event.entityId());
      } else if (event.state() instanceof Layer layer) {
        layers.put(layer.id(), layer);
      }
    } else if (event.operation() == Operation.DELETE) {
      String key = keyById.remove(event.entityId());
      if (key != null) {
        objects.remove(key);
      }
    } else if (event.state() instanceof MapObject object) {
      remember(object);
    }
  }

  private void checkReady() {
    if (!ready && snapshotLoaded && documentLoaded) {
      ready = true;
      unparkAll();
    }
  }

  private void remember(MapObject object) {
    ExternalRef ref = object.meta().externalRef();
    if (ref == null || !ref.system().equals(system)) {
      return;
    }
    MapObject current = objects.get(ref.id());
    if (current != null) {
      if (current.id().equals(object.id()) && current.version() > object.version()) {
        return; // older than what is known
      }
      keyById.remove(current.id());
    }
    objects.put(ref.id(), object);
    keyById.put(object.id(), ref.id());
    reserved.remove(ref.id());
  }

  private void forget(String key) {
    MapObject gone = objects.remove(key);
    if (gone != null) {
      keyById.remove(gone.id());
    }
  }

  // ---------------------------------------------------------------- time, ids, logging

  private void onTick() {
    tick++;
    unparkAll();
  }

  /** A UUID version 7: time-ordered, as the store's own ids are. */
  private UUID newId() {
    long millis = System.currentTimeMillis();
    long msb = (millis << 16) | 0x7000L | (random.nextInt() & 0x0FFFL);
    long lsb = (random.nextLong() & 0x3FFFFFFFFFFFFFFFL) | 0x8000000000000000L;
    return new UUID(msb, lsb);
  }

  /** At most once a minute per target, and once a minute for the writer as a whole. */
  private void warn(@Nullable TargetState target, String message, Object... args) {
    if (target != null) {
      if (tick - target.lastWarnTick < WARN_EVERY_TICKS) {
        return;
      }
      target.lastWarnTick = tick;
    } else {
      if (tick - lastGlobalWarnTick < WARN_EVERY_TICKS) {
        return;
      }
      lastGlobalWarnTick = tick;
    }
    PluginLog log = context.log();
    log.warn(message, args);
  }

  /** Text from the store, made fit for a log line: no control characters, cut short. */
  private static String clean(String text) {
    String plain = text.replaceAll("[\\p{Cntrl}\\u0085\\u2028\\u2029]", " ");
    return plain.length() <= 200 ? plain : plain.substring(0, 197) + "...";
  }
}
