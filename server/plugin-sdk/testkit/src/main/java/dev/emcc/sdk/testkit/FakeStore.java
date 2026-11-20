package dev.emcc.sdk.testkit;

import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.DataType;
import dev.emcc.sdk.DeclaredField;
import dev.emcc.sdk.User;
import dev.emcc.sdk.Workspace;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.Entity;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.FieldRef;
import dev.emcc.sdk.model.FieldValue;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.Meta;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.TimeAttributes;
import dev.emcc.sdk.store.Area;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.ObjectQuery;
import dev.emcc.sdk.store.QueryResult;
import dev.emcc.sdk.store.Store;
import dev.emcc.sdk.store.StoreUpdate;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.BiPredicate;
import java.util.function.Consumer;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * The in-memory object store of {@link FakePluginContext} ({@code ctx.store()}). It applies the
 * model rules a plugin can run into: 3 (references, {@code ENTITY_EXISTS}), 5 (core fields
 * replaced, extensions merged per namespace), 11 (only empty layers are deleted), 14 (available
 * data types, fixed data source), 15 ({@code validFrom} not after {@code expires}) and 16 (unique
 * external identity), in the order of the rules: a create whose id and external identity both
 * exist gets {@code ENTITY_EXISTS}. Answers arrive at the next {@code runUntilIdle()}; subscribers
 * get a snapshot, then one batch per applied change. The fake does not drop updates of a slow
 * subscriber (ECore sends a new snapshot instead); {@code limit} does not apply to subscriptions.
 *
 * <p><b>SDK 1.2.0:</b> declared fields (ADR-0038) are checked against {@code ctx.declaredFields()}
 * and applied after the content, as ECore does: a field that is not declared, not editable by
 * others for another plugin, listed twice, or whose value breaks its declaration rejects the
 * request with {@code VALIDATION_FAILED} at {@code /fields/<i>}. An update that is not saved
 * ({@code Change.notSaved()}, ADR-0041) may change only a move, as in ECore; the fake records it
 * ({@link #unsaved()}), and {@link #restart()} gives back each object as last saved, or as the last
 * {@link #snapshotNow()} left it.
 *
 * <p><b>Workspaces</b> (SDK 1.2.0, ADR-0039): a layer's {@code workspace} must be View or one in
 * {@code ctx.workspaces()}; the store keeps {@code core.view} as absent; on update an absent
 * {@code workspace} keeps the stored one and an explicit one must equal it; an object never moves to
 * a layer of another workspace; queries and subscriptions filter by {@code ObjectQuery.workspaces}.
 * {@link #applyAs(Actor, User, Change)} checks the user's edit permission per workspace, as the
 * server does for a browser's change.
 *
 * <p><b>The layer lock</b> (SDK 1.3.0, ADR-0042): the store keeps a layer's {@code locked} {@code
 * false} as absent, and on update an absent {@code locked} keeps the stored value. Only {@link
 * #applyAs(Actor, User, Change)}, a user's change, is refused with {@code LAYER_LOCKED}, after the
 * permission, {@code ENTITY_NOT_FOUND} and {@code LAYER_NOT_FOUND} and before the other rules, as
 * ECore does (model/README.md, "Changes in 1.3.0"). A plugin's own submissions, and {@link
 * #applyAs(Actor, Change)}, are a server part's changes and pass.
 *
 * <p><b>Field sets and relations</b> (SDK 1.4.0, ADR-0050, ADR-0051): on update an empty {@code
 * fieldSets} keeps the stored sets and each listed one is added (rule 5's third exception);
 * {@code relations} are replaced as a whole. A set that a change adds must be in {@code
 * ctx.fieldSets()} (rule 18, {@code /data/fieldSets/<i>}); a relation must be of a kind in {@code
 * ctx.relationKinds()}, except on update an entry the stored object carries (rule 17, {@code
 * /data/relations/<i>/kind}). The other object of a relation is never checked. The checks run, as
 * in ECore, after rule 16 and before the declared fields.
 *
 * <p><b>A data type's sets</b> (SDK 1.5.0, CR-0038 point 3, model rule 21): on a create of a {@code
 * core.symbol} object, and on an update of one that changes the data type, the fake adds the sets of the data type (as given to {@code
 * FakePluginContext.Builder.dataTypes}) that the object does not carry yet, after rule 18's check.
 * Shapes and tactical graphics get none (owner, NO A).
 *
 * <pre>{@code
 * Layer layer = ctx.store().seedLayer("TAK north");
 * plugin.start();
 * ctx.connection("tak-north").feed(cotEvent);
 * ctx.runUntilIdle();
 * assertThat(ctx.store().objects()).singleElement().extracting(o -> o.content().dataSource()).isEqualTo("tak-north");
 * ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.deleteObject(ctx.store().objects().getFirst()));   // someone else deletes it
 * }</pre>
 */
public final class FakeStore implements Store {

  private enum Script { LOSE_ANSWER, DROP_REQUEST, REJECT }

  private int queryTimeouts;

  private record Scripted(Script script, ChangeRejection.@Nullable Code code, String message) {}

  private record Subscriber(ObjectQuery query, Consumer<StoreUpdate> deliver, boolean[] cancelled) {}

  private final FakePluginContext ctx;
  private final Map<String, DataType> dataTypes = new LinkedHashMap<>();
  private final Map<UUID, MapObject> objects = new LinkedHashMap<>();
  /** Each object as its last saved change, or the last snapshot, left it (ADR-0041). */
  private final Map<UUID, MapObject> saved = new LinkedHashMap<>();
  private final List<ChangeRequest> unsaved = new ArrayList<>();
  private final Map<UUID, Layer> layers = new LinkedHashMap<>();
  private final List<ChangeRequest> requests = new ArrayList<>();
  private final List<Subscriber> subscribers = new ArrayList<>();
  private final Deque<Scripted> scripts = new ArrayDeque<>();
  private @Nullable BiPredicate<MapObject, Area> areaMatcher;
  private long sequenceNo;

  FakeStore(FakePluginContext ctx, List<DataType> dataTypes) {
    this.ctx = ctx;
    dataTypes.forEach(t -> this.dataTypes.put(t.id(), t));
  }

  // ---------------------------------------------------------------- Store

  @Override
  public <M extends Message> void submit(Change change, Duration timeout, WorkerRef<M> target, Function<ChangeOutcome, ? extends M> toMessage) {
    FakePluginContext.checkTimeout("submit", timeout);
    if (!ctx.takeAsk()) {
      ctx.deliverAlways(target, () -> toMessage.apply(new ChangeOutcome.Unknown(FakePluginContext.TOO_MANY_ASKS)));
      return;
    }
    ChangeRequest request = change.toRequest(UUID.randomUUID(), ctx.pluginId());
    requests.add(request);
    Scripted script = scripts.poll();
    if (script == null) {
      ChangeOutcome outcome = apply(request, change.saved(), false);
      ctx.returnAsk();
      ctx.deliverAlways(target, () -> toMessage.apply(outcome));
      return;
    }
    switch (script.script()) {
      case REJECT -> {
        ChangeOutcome outcome = new ChangeOutcome.Rejected(rejection(request, Objects.requireNonNull(script.code()), script.message(), List.of()));
        ctx.returnAsk();
        ctx.deliverAlways(target, () -> toMessage.apply(outcome));
      }
      case LOSE_ANSWER, DROP_REQUEST -> {
        if (script.script() == Script.LOSE_ANSWER) {
          apply(request, change.saved(), false);
        }
        ctx.after(timeout, () -> {
          ctx.returnAsk();
          ctx.deliverAlways(target, () -> toMessage.apply(new ChangeOutcome.Unknown("no answer within " + timeout)));
        });
      }
    }
  }

  @Override
  public <M extends Message> void query(ObjectQuery query, Duration timeout, WorkerRef<M> target, Function<QueryResult, ? extends M> toMessage) {
    FakePluginContext.checkTimeout("query", timeout);
    requireAreaMatcher(query);
    if (!ctx.takeAsk()) {
      ctx.deliverAlways(target, () -> toMessage.apply(new QueryResult.Failed(FakePluginContext.TOO_MANY_ASKS)));
      return;
    }
    if (queryTimeouts > 0) {
      queryTimeouts--;
      ctx.after(timeout, () -> {
        ctx.returnAsk();
        ctx.deliverAlways(target, () -> toMessage.apply(new QueryResult.TimedOut()));
      });
      return;
    }
    List<MapObject> found = matching(query);
    QueryResult result = found.size() > query.limit()
        ? new QueryResult.Failed("more than " + query.limit() + " objects match")
        : new QueryResult.Found(found, List.copyOf(layers.values()), sequenceNo);
    ctx.returnAsk();
    ctx.deliverAlways(target, () -> toMessage.apply(result));
  }

  @Override
  public <M extends Message> Cancellable subscribe(ObjectQuery query, WorkerRef<M> target, Function<StoreUpdate, ? extends M> toMessage) {
    requireAreaMatcher(query);
    boolean[] cancelled = new boolean[1];
    var subscriber = new Subscriber(query, update -> {
      if (!cancelled[0]) {
        ctx.deliverAlways(target, () -> toMessage.apply(update));
      }
    }, cancelled);
    subscribers.add(subscriber);
    subscriber.deliver().accept(snapshot(query));
    return () -> cancelled[0] = true;
  }

  // ---------------------------------------------------------------- test controls

  /** Puts a layer into the store as it is, without a change event (test setup). */
  public void seed(Layer layer) {
    layers.put(layer.id(), layer);
  }

  /** Puts an object into the store as it is, without a change event (test setup). Its layer must be seeded first. */
  public void seed(MapObject object) {
    if (!layers.containsKey(object.content().layerId())) {
      throw new IllegalArgumentException("seed the object's layer first: " + object.content().layerId());
    }
    objects.put(object.id(), object);
    saved.put(object.id(), object);
  }

  /** Seeds a visible layer with the default label on top of the others, and returns it. */
  public Layer seedLayer(String name) {
    double top = layers.values().stream().mapToDouble(l -> l.content().drawOrder()).max().orElse(0) + 1;
    var audit = new Meta.Audit(ctx.clock(), Actor.plugin("layer-panel"));
    var layer = new Layer(UUID.randomUUID(), 1, new LayerContent(name, top, true, ctx.defaultLabel(), Extensions.empty()), new Meta(audit, audit, null));
    seed(layer);
    return layer;
  }

  /**
   * Applies a change as someone else (another plugin or a user) would, with the same rules, and
   * tells the subscribers. Returns the outcome at once. A server part's change: it passes the layer
   * lock (SDK 1.3.0).
   */
  public ChangeOutcome applyAs(Actor by, Change change) {
    ChangeRequest r = change.toRequest(UUID.randomUUID(), by.plugin());
    return apply(new ChangeRequest(r.requestId(), r.entityType(), r.operation(), r.entityId(), r.baseVersion(), r.data(), r.externalRef(), by, r.fields()), change.saved(), false);
  }

  /**
   * SDK 1.2.0: applies a change as a user's browser would send it through plugin {@code by}, and
   * checks the permission first, as the server does (overview 4.4): {@code objects.edit} or {@code
   * layers.edit} in View, the workspace's {@code editPermission} in another (ADR-0039). Without it,
   * {@code PERMISSION_DENIED}. SDK 1.3.0: a change to a locked layer's content is then refused with
   * {@code LAYER_LOCKED} (ADR-0042).
   */
  public ChangeOutcome applyAs(Actor by, User user, Change change) {
    ChangeRequest r = change.toRequest(UUID.randomUUID(), by.plugin());
    var request = new ChangeRequest(r.requestId(), r.entityType(), r.operation(), r.entityId(), r.baseVersion(), r.data(), r.externalRef(),
        new Actor(by.plugin(), user.id(), by.system()), r.fields());
    // The permission comes first (overview 4.4); a layer the store does not know is checked as View's.
    Workspace found = workspaceOfChange(request);
    Workspace ws = found != null ? found : Workspace.view();
    String needed = ws.editPermissionFor(request.entityType() == EntityType.LAYER);
    if (!user.has(needed)) {
      return new ChangeOutcome.Rejected(rejection(request, ChangeRejection.Code.PERMISSION_DENIED, "needs the permission " + needed, List.of()));
    }
    return apply(request, change.saved(), true);
  }

  /** The workspace whose edit permission a change needs, or null when its layer is unknown (the rules then reject it). */
  private @Nullable Workspace workspaceOfChange(ChangeRequest r) {
    String id;
    if (r.entityType() == EntityType.LAYER) {
      Layer stored = layers.get(r.entityId());
      id = stored != null ? stored.content().workspaceOrView() : r.data() instanceof LayerContent c ? c.workspaceOrView() : null;
    } else {
      MapObject stored = objects.get(r.entityId());
      UUID layerId = r.data() instanceof MapObjectContent c ? c.layerId() : stored != null ? stored.content().layerId() : null;
      Layer layer = layerId == null ? null : layers.get(layerId);
      id = layer == null ? null : layer.content().workspaceOrView();
    }
    return id == null ? null : workspace(id);
  }

  private @Nullable Workspace workspace(String id) {
    return ctx.workspaces().stream().filter(w -> w.id().equals(id)).findFirst().orElse(null);
  }

  /** A layer's workspace as the store keeps it: null for View (R2). */
  private static @Nullable String stored(@Nullable String workspace) {
    return workspace == null || workspace.equals(Workspace.VIEW) ? null : workspace;
  }

  /**
   * SDK 1.2.0: the store restarts (ADR-0041): each object comes back as its last saved change, or
   * the last {@link #snapshotNow()}, left it, and every subscriber gets a new snapshot. Layers are
   * always saved. Sequence numbers go on.
   */
  public void restart() {
    objects.clear();
    objects.putAll(saved);
    gap();
  }

  /** SDK 1.2.0: the store snapshots its picture, as a compaction does, moved positions included: a later {@link #restart()} gives this state back. */
  public void snapshotNow() {
    saved.clear();
    saved.putAll(objects);
  }

  /** SDK 1.2.0: the updates applied without being saved ({@code Change.notSaved()}), in order. */
  public List<ChangeRequest> unsaved() {
    return Collections.unmodifiableList(unsaved);
  }

  /** The next submission is applied, but its answer is lost: {@link ChangeOutcome.Unknown} after the timeout. */
  public void loseNextAnswer() {
    scripts.add(new Scripted(Script.LOSE_ANSWER, null, ""));
  }

  /** The next submission never reaches the store: not applied, {@link ChangeOutcome.Unknown} after the timeout. */
  public void dropNextRequest() {
    scripts.add(new Scripted(Script.DROP_REQUEST, null, ""));
  }

  /** The next submission is rejected with {@code code}, whatever it is. */
  public void rejectNext(ChangeRejection.Code code, String message) {
    scripts.add(new Scripted(Script.REJECT, Objects.requireNonNull(code, "code"), message));
  }

  /** The next query gets no answer: {@link QueryResult.TimedOut} after its timeout. */
  public void timeOutNextQuery() {
    queryTimeouts++;
  }

  /** Sends every subscriber a new snapshot, as ECore does after a gap. */
  public void gap() {
    for (Subscriber s : List.copyOf(subscribers)) {
      s.deliver().accept(snapshot(s.query()));
    }
  }

  /** How {@link ObjectQuery#within} is decided; without it, a query with an area fails the test (area queries are ECore's geodesic work). */
  public void areaMatcher(BiPredicate<MapObject, Area> value) {
    this.areaMatcher = value;
  }

  public List<MapObject> objects() {
    return List.copyOf(objects.values());
  }

  public @Nullable MapObject object(UUID id) {
    return objects.get(id);
  }

  public List<Layer> layers() {
    return List.copyOf(layers.values());
  }

  /** Every change request the plugin submitted, in order, including rejected, lost and dropped ones. */
  public List<ChangeRequest> requests() {
    return Collections.unmodifiableList(requests);
  }

  /** The sequence number of the last applied change. */
  public long sequenceNo() {
    return sequenceNo;
  }

  // ---------------------------------------------------------------- the rules

  private ChangeOutcome apply(ChangeRequest r, boolean save, boolean byUser) {
    @Nullable ChangeRejection rejected = r.entityType() == EntityType.OBJECT ? checkObject(r, byUser) : checkLayer(r, byUser);
    if (rejected != null) {
      return new ChangeOutcome.Rejected(rejected);
    }
    Instant at = ctx.clock();
    Actor by = r.source();
    Entity before = r.entityType() == EntityType.OBJECT ? objects.get(r.entityId()) : layers.get(r.entityId());
    long version = before == null ? 1 : before.version() + 1;
    @Nullable Entity after = switch (r.operation()) {
      case DELETE -> null;
      case CREATE, UPDATE -> stateAfter(r, before, version, at, by);
    };
    if (!save && !onlyMoved((MapObject) Objects.requireNonNull(before), (MapObject) Objects.requireNonNull(after))) {
      return new ChangeOutcome.Rejected(validation(r, "/data", NOT_ONLY_MOVED));
    }
    SecurityLabel label = after != null ? labelOf(after) : labelOf(Objects.requireNonNull(before));
    if (r.entityType() == EntityType.OBJECT) {
      if (after == null) {
        objects.remove(r.entityId());
        saved.remove(r.entityId());
      } else {
        objects.put(r.entityId(), (MapObject) after);
        if (save) {
          saved.put(r.entityId(), (MapObject) after);
        } else {
          unsaved.add(r);
        }
      }
    } else if (after == null) {
      layers.remove(r.entityId());
    } else {
      layers.put(r.entityId(), (Layer) after);
    }
    var event = new ChangeEvent(++sequenceNo, r.requestId(), r.entityType(), r.operation(), r.entityId(), version,
        before == null ? null : before.version(), r.baseVersion(), after, label, at, by);
    for (Subscriber s : List.copyOf(subscribers)) {
      if (r.entityType() == EntityType.LAYER ? s.query().matchesWorkspace(((Layer) (after != null ? after : Objects.requireNonNull(before))).content().workspace())
          : matches(s.query(), before) || matches(s.query(), after)) {
        s.deliver().accept(new StoreUpdate.Changes(List.of(event)));
      }
    }
    return new ChangeOutcome.Applied(event);
  }

  private @Nullable ChangeRejection checkObject(ChangeRequest r, boolean byUser) {
    MapObject stored = objects.get(r.entityId());
    if (r.operation() == Operation.CREATE && (stored != null || layers.containsKey(r.entityId()))) {
      return rejection(r, ChangeRejection.Code.ENTITY_EXISTS, "an entity with this id exists", List.of());
    }
    if (r.operation() != Operation.CREATE && stored == null) {
      return rejection(r, ChangeRejection.Code.ENTITY_NOT_FOUND, "no object with this id", List.of());
    }
    if (r.operation() == Operation.DELETE) {
      return byUser ? objectLock(r, stored) : null;
    }
    var data = (MapObjectContent) Objects.requireNonNull(r.data());
    if (!layers.containsKey(data.layerId())) {
      return rejection(r, ChangeRejection.Code.LAYER_NOT_FOUND, "no layer " + data.layerId(), List.of());
    }
    ChangeRejection lock = byUser ? objectLock(r, stored) : null;
    if (lock != null) {
      return lock;
    }
    if (stored != null && !stored.content().layerId().equals(data.layerId())) {
      Layer from = layers.get(stored.content().layerId());
      String fromWs = from == null ? Workspace.VIEW : from.content().workspaceOrView();
      String toWs = layers.get(data.layerId()).content().workspaceOrView();
      if (!fromWs.equals(toWs)) {
        return validation(r, "/data/layerId", "an object stays in its workspace: " + fromWs + ", not " + toWs + " (ADR-0039, R1)");
      }
    }
    boolean dataTypeChanges = stored == null || !stored.content().dataType().equals(data.dataType());
    if (dataTypeChanges && !dataTypes.containsKey(data.dataType())) {
      return validation(r, "/data/dataType", "not an available data type: " + data.dataType() + " (model rule 14)");
    }
    if (stored != null && !stored.content().dataSource().equals(data.dataSource())) {
      return validation(r, "/data/dataSource", "the data source is fixed at creation: " + stored.content().dataSource() + " (model rule 14)");
    }
    TimeAttributes time = data.time();
    if (time != null && time.validFrom() != null && time.expires() != null && time.validFrom().isAfter(time.expires())) {
      return validation(r, "/data/time/validFrom", "validFrom is after expires (model rule 15)");
    }
    ExternalRef ref = r.externalRef();
    if (ref != null && objects.values().stream().anyMatch(o -> ref.equals(o.meta().externalRef()))) {
      return rejection(r, ChangeRejection.Code.EXTERNAL_REF_EXISTS, "another object has the external identity " + ref.system() + " " + ref.id(), List.of());
    }
    ChangeRejection badRelation = checkRelations(r, data, stored);
    if (badRelation != null) {
      return badRelation;
    }
    ChangeRejection badSet = checkFieldSets(r, data, stored);
    if (badSet != null) {
      return badSet;
    }
    return checkFields(r);
  }

  /** Model rule 17: each relation's kind declared, except on update an entry the stored object carries. */
  private @Nullable ChangeRejection checkRelations(ChangeRequest r, MapObjectContent data, @Nullable MapObject stored) {
    var kinds = new HashSet<String>();
    ctx.relationKinds().forEach(k -> kinds.add(k.id()));
    var kept = stored == null ? java.util.Set.<dev.emcc.sdk.model.Relation>of() : new HashSet<>(stored.content().relations());
    for (int i = 0; i < data.relations().size(); i++) {
      var relation = data.relations().get(i);
      if (!kept.contains(relation) && !kinds.contains(relation.kind())) {
        return validation(r, "/data/relations/" + i + "/kind", "no loaded plugin declares the relation kind " + relation.kind() + " (model rule 17)");
      }
    }
    return null;
  }

  /** Model rule 18: each set the change adds declared; the stored ones are not checked. */
  private @Nullable ChangeRejection checkFieldSets(ChangeRequest r, MapObjectContent data, @Nullable MapObject stored) {
    var ids = new HashSet<String>();
    ctx.fieldSets().forEach(s -> ids.add(s.id()));
    var kept = stored == null ? java.util.List.<String>of() : stored.content().fieldSets();
    for (int i = 0; i < data.fieldSets().size(); i++) {
      String set = data.fieldSets().get(i);
      if (!kept.contains(set) && !ids.contains(set)) {
        return validation(r, "/data/fieldSets/" + i, "no loaded plugin declares the field set " + set + " (model rule 18)");
      }
    }
    return null;
  }

  /** ADR-0038 point 2: each field declared, editable by the requester, once, and valid for its declaration. */
  private @Nullable ChangeRejection checkFields(ChangeRequest r) {
    var seen = new HashSet<FieldRef>();
    for (int i = 0; i < r.fields().size(); i++) {
      FieldValue f = r.fields().get(i);
      String path = "/fields/" + i;
      if (!seen.add(f.field())) {
        return validation(r, path, "the field " + f.plugin() + "." + f.name() + " is listed twice");
      }
      DeclaredField declared = ctx.declaredFields().stream().filter(d -> d.ref().equals(f.field())).findFirst().orElse(null);
      if (declared == null) {
        return validation(r, path, "no plugin declares the field " + f.plugin() + "." + f.name());
      }
      if (!declared.editableByOthers() && !declared.plugin().equals(r.source().plugin())) {
        return validation(r, path, "the field " + f.plugin() + "." + f.name() + " is not editable by others");
      }
      String problem = declared.problem(f.value());
      if (problem != null) {
        return validation(r, path, problem);
      }
    }
    return null;
  }

  /** ECore's message for an unsaved update that changes more than a move. */
  static final String NOT_ONLY_MOVED = "an update that is not saved may change only the geometry, the time, and the symbol's direction and speed (ADR-0041)";

  /**
   * As ECore: whether {@code after} differs from {@code before} only in its geometry, its time and
   * the symbol's direction and speed. Core fields are compared whole, and so is every extension
   * namespace.
   */
  private static boolean onlyMoved(MapObject before, MapObject after) {
    MapObjectContent old = before.content();
    MapObjectContent now = after.content();
    if ((old.symbol() == null) != (now.symbol() == null)) {
      return false;
    }
    Symbol symbol = now.symbol();
    Symbol oldSymbol = old.symbol();
    if (symbol != null && oldSymbol != null) {
      Modifiers modifiers = symbol.modifiers();
      Modifiers oldModifiers = oldSymbol.modifiers();
      // A move may change direction and speed only; SDK 1.4.0's distances and azimuths are the new
      // content's, so a change of them is no move.
      Modifiers kept = new Modifiers(modifiers == null ? Map.of() : modifiers.texts(),
          oldModifiers == null ? null : oldModifiers.direction(), oldModifiers == null ? null : oldModifiers.speed(),
          modifiers == null ? java.util.List.of() : modifiers.distances(), modifiers == null ? java.util.List.of() : modifiers.azimuths());
      symbol = new Symbol(symbol.standard(), symbol.sidc(), kept);
    }
    MapObjectContent unmoved = new MapObjectContent(now.type(), now.dataType(), now.dataSource(), old.time(), now.layerId(),
        old.geometry(), symbol, now.style(), now.properties(), now.label(), now.extensions(), now.fieldSets(), now.relations(), now.text(), now.displayClass());
    return unmoved.equals(old);
  }

  private @Nullable ChangeRejection checkLayer(ChangeRequest r, boolean byUser) {
    Layer stored = layers.get(r.entityId());
    if (r.operation() == Operation.CREATE && (stored != null || objects.containsKey(r.entityId()))) {
      return rejection(r, ChangeRejection.Code.ENTITY_EXISTS, "an entity with this id exists", List.of());
    }
    if (r.operation() != Operation.CREATE && stored == null) {
      return rejection(r, ChangeRejection.Code.ENTITY_NOT_FOUND, "no layer with this id", List.of());
    }
    // ADR-0042: a create is never refused for the lock (N3); nothing is stored yet.
    if (byUser && stored != null && stored.content().isLocked() && !onlyLockOrOrder(r, stored)) {
      return locked(r, "", stored);
    }
    if (r.operation() == Operation.DELETE && objects.values().stream().anyMatch(o -> o.content().layerId().equals(r.entityId()))) {
      return rejection(r, ChangeRejection.Code.LAYER_NOT_EMPTY, "the layer still has objects (model rule 11)", List.of());
    }
    if (r.data() instanceof LayerContent c && c.workspace() != null) {
      if (workspace(c.workspace()) == null) {
        return validation(r, "/data/workspace", "no workspace " + c.workspace());
      }
      if (stored != null && !java.util.Objects.equals(stored(c.workspace()), stored.content().workspace())) {
        return validation(r, "/data/workspace", "a layer stays in its workspace: " + stored.content().workspaceOrView() + " (ADR-0039, R2)");
      }
    }
    return null;
  }

  /**
   * ADR-0042 point 3, for an object: the layer it goes to, then the layer it leaves. The detail's path
   * is {@code /data/layerId} when the request carries the locked layer's id there (N2).
   */
  private @Nullable ChangeRejection objectLock(ChangeRequest r, @Nullable MapObject stored) {
    Layer to = r.data() instanceof MapObjectContent c ? layers.get(c.layerId()) : null;
    if (to != null && to.content().isLocked()) {
      return locked(r, "/data/layerId", to);
    }
    Layer from = stored == null ? null : layers.get(stored.content().layerId());
    return from != null && from.content().isLocked() ? locked(r, "", from) : null;
  }

  /** ADR-0042 point 3: an update whose result differs from the stored layer only in {@code locked} and {@code drawOrder}. */
  private static boolean onlyLockOrOrder(ChangeRequest r, Layer stored) {
    if (r.operation() != Operation.UPDATE) {
      return false;
    }
    LayerContent after = layerAfter((LayerContent) Objects.requireNonNull(r.data()), stored, r.source().plugin());
    LayerContent s = stored.content();
    return new LayerContent(after.name(), s.drawOrder(), after.visible(), after.label(), after.extensions(), after.workspace(), s.locked()).equals(s);
  }

  private ChangeRejection locked(ChangeRequest r, String path, Layer layer) {
    String problem = "layer " + layer.id() + " is locked";
    return rejection(r, ChangeRejection.Code.LAYER_LOCKED, "the layer " + layer.content().name() + " is locked (ADR-0042)", List.of(new ChangeRejection.Detail(path, problem)));
  }

  private Entity stateAfter(ChangeRequest r, @Nullable Entity before, long version, Instant at, Actor by) {
    Meta meta = before == null
        ? new Meta(new Meta.Audit(at, by), new Meta.Audit(at, by), r.externalRef())
        : new Meta(before.meta().created(), new Meta.Audit(at, by), before.meta().externalRef());
    if (r.data() instanceof MapObjectContent c) {
      Extensions ext = withFields(before == null ? c.extensions() : merged(((MapObject) before).content().extensions(), c.extensions(), by.plugin()), r.fields());
      // ADR-0050 point 3: on update the stored sets stay and the listed ones are added (rule 5's third exception).
      var sets = new java.util.ArrayList<String>(before == null ? List.of() : ((MapObject) before).content().fieldSets());
      c.fieldSets().stream().filter(s -> !sets.contains(s)).forEach(sets::add);
      // SDK 1.5.0, model rule 21: a symbol's create, or its change of data type, adds the data type's sets (owner, NO A).
      DataType type = dataTypes.get(c.dataType());
      if (type != null && c.type().equals(MapObjectContent.SYMBOL) && (before == null || !((MapObject) before).content().dataType().equals(c.dataType()))) {
        type.fieldSets().stream().filter(s -> !sets.contains(s)).forEach(sets::add);
      }
      var content = new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(), c.geometry(), c.symbol(), c.style(), c.properties(), c.label(), ext,
          sets, c.relations(), c.text(), c.displayClass());
      return new MapObject(r.entityId(), version, content, meta);
    }
    return new Layer(r.entityId(), version, layerAfter((LayerContent) Objects.requireNonNull(r.data()), (Layer) before, by.plugin()), meta);
  }

  /** A layer's content as the store keeps it after a create ({@code before} null) or an update by {@code requester}. */
  private static LayerContent layerAfter(LayerContent c, @Nullable Layer before, String requester) {
    Extensions ext = before == null ? c.extensions() : merged(before.content().extensions(), c.extensions(), requester);
    // R2: core.view is kept as absent; on update an absent workspace keeps the stored one.
    String ws = before == null || c.workspace() != null ? stored(c.workspace()) : before.content().workspace();
    // ADR-0042: false is kept as absent; on update an absent locked keeps the stored value.
    Boolean locked = before == null || c.locked() != null ? (c.isLocked() ? Boolean.TRUE : null) : before.content().locked();
    return new LayerContent(c.name(), c.drawOrder(), c.visible(), c.label(), ext, ws, locked);
  }

  /** ADR-0038 point 2: the declared fields, after the content: a value sets the key, null removes it; an emptied namespace goes (model rule 13). */
  private static Extensions withFields(Extensions ext, List<FieldValue> fields) {
    var result = new LinkedHashMap<>(ext.namespaces());
    for (FieldValue f : fields) {
      JsonObject ns = result.getOrDefault(f.plugin(), JsonObject.empty());
      JsonObject changed = f.value() == null ? ns.without(f.name()) : ns.with(f.name(), f.value());
      if (changed.isEmpty()) {
        result.remove(f.plugin());
      } else {
        result.put(f.plugin(), changed);
      }
    }
    return new Extensions(result);
  }

  /** Model rule 5: on update only the requester's own namespace changes; {@code {}} removes it, absence keeps it. */
  private static Extensions merged(Extensions stored, Extensions requested, String requester) {
    var result = new LinkedHashMap<>(stored.namespaces());
    JsonObject own = requested.get(requester);
    if (own != null) {
      if (own.isEmpty()) {
        result.remove(requester);
      } else {
        result.put(requester, own);
      }
    }
    return new Extensions(result);
  }

  private List<MapObject> matching(ObjectQuery query) {
    return objects.values().stream().filter(o -> matches(query, o)).toList();
  }

  private boolean matches(ObjectQuery query, @Nullable Entity entity) {
    if (!(entity instanceof MapObject o) || !query.matchesAttributes(o)) {
      return false;
    }
    Layer layer = layers.get(o.content().layerId());
    if (!query.matchesWorkspace(layer == null ? null : layer.content().workspace())) {
      return false;
    }
    Area area = query.within();
    if (area == null) {
      return true;
    }
    return Objects.requireNonNull(areaMatcher).test(o, area);
  }

  private void requireAreaMatcher(ObjectQuery query) {
    if (query.within() != null && areaMatcher == null) {
      throw new AssertionError("the fake store cannot decide ObjectQuery.within (geodesic area queries are ECore's); set ctx.store().areaMatcher(...)");
    }
  }

  private StoreUpdate.Snapshot snapshot(ObjectQuery query) {
    return new StoreUpdate.Snapshot(matching(query), layers.values().stream().filter(l -> query.matchesWorkspace(l.content().workspace())).toList(), sequenceNo);
  }

  private ChangeRejection validation(ChangeRequest r, String path, String problem) {
    return rejection(r, ChangeRejection.Code.VALIDATION_FAILED, problem, List.of(new ChangeRejection.Detail(path, problem)));
  }

  private ChangeRejection rejection(ChangeRequest r, ChangeRejection.Code code, String message, List<ChangeRejection.Detail> details) {
    return new ChangeRejection(r.requestId(), r.entityType(), r.operation(), r.entityId(), code, message, details, ctx.clock());
  }

  private static SecurityLabel labelOf(Entity e) {
    return e instanceof MapObject o ? o.content().label() : ((Layer) e).content().label();
  }
}
