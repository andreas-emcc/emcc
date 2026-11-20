package dev.emcc.ecore.store;

import dev.emcc.ecore.geo.Cap;
import dev.emcc.ecore.geo.GeoArea;
import dev.emcc.ecore.json.Problem;
import dev.emcc.ecore.runtime.HandlerContext;
import dev.emcc.ecore.runtime.MessageHandler;
import dev.emcc.ecore.runtime.Topic;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.Entity;
import dev.emcc.sdk.model.EntityContent;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.FieldRef;
import dev.emcc.sdk.model.FieldValue;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Meta;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.Relation;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.TimeAttributes;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Predicate;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The object store worker, the single writer of objects and layers (overview 4.4, ADR-0005,
 * ADR-0018). For each change request it checks the model rules the schema cannot express (rules
 * 1-8 and 10-18 in {@code model/README.md}), applies extension ownership, assigns the version and
 * the gapless sequence number, and answers exactly once: the change event (published on {@link
 * #CHANGES}) or a change rejection. Last write wins; {@code baseVersion} is recorded only.
 *
 * <p>Workspaces (ADR-0039, data model 1.2.0): a user's change needs the edit permission of the
 * workspace it is in ({@link Workspaces#editPermission}); a layer stays in its workspace and an
 * object in its layer's (R1, R2); a layer's workspace must be View or a declared one. For a user,
 * what is in a workspace it may not see does not exist (owner, 2026-10-27: hidden is not found).
 * Each change is published with its workspace, and the reads return only the workspaces they name.
 *
 * <p>Not restartable: a hung store is reported and its owner marked degraded, because a fresh
 * handler could not trust a state the stuck call may still be changing.
 */
public final class ObjectStore implements MessageHandler<StoreMsg> {

  /**
   * Where every applied change is published (overview 4.4), with the object before it and the
   * bounds before and after ({@link StoreChange}). ECore's own topic: plugins see changes through
   * {@code Store.subscribe}.
   */
  public static final Topic<StoreChange> CHANGES = Topic.of("objects.changed", StoreChange.class);

  private static final Logger LOG = LoggerFactory.getLogger(ObjectStore.class);
  private static final int MAX_MESSAGE = 1024;
  /** A rejection detail's longest path and problem ({@code change-rejection.schema.json}). */
  static final int MAX_DETAIL = 512;
  static final String NOT_ONLY_MOVED = "an update that is not saved may change only the geometry, the time, and the "
      + "symbol's direction and speed (ADR-0041)";
  static final String NOT_SAVED_FIELDS = "an update that is not saved carries no declared fields (ADR-0041: moves only)";
  /** Who removes expired objects: ECore itself. */
  private static final Actor EXPIRY = Actor.plugin("core");

  private final PictureState state;
  private final WorkerRuntime runtime;
  private final Clock clock;
  private final DataTypes dataTypes;
  private final DeclaredFields declaredFields;
  private final Workspaces workspaces;
  private final StoreCounts counts;

  public ObjectStore(PictureState state, WorkerRuntime runtime, Clock clock, DataTypes dataTypes) {
    this(state, runtime, clock, dataTypes, new StoreCounts());
  }

  /** With {@code counts} kept current after every applied change (for the monitor view); no declared fields. */
  public ObjectStore(PictureState state, WorkerRuntime runtime, Clock clock, DataTypes dataTypes, StoreCounts counts) {
    this(state, runtime, clock, dataTypes, new DeclaredFields(), counts);
  }

  /**
   * With {@code declaredFields}, against which a request's {@code fields} are checked (ADR-0038),
   * and {@code counts} kept current after every applied change (for the monitor view).
   */
  public ObjectStore(PictureState state, WorkerRuntime runtime, Clock clock, DataTypes dataTypes, DeclaredFields declaredFields,
      StoreCounts counts) {
    this(state, runtime, clock, dataTypes, declaredFields, new Workspaces(), counts);
  }

  /**
   * With {@code declaredFields}, against which a request's {@code fields} are checked (ADR-0038),
   * {@code workspaces}, which say who may change what (ADR-0039), and {@code counts} kept current
   * after every applied change (for the monitor view).
   */
  public ObjectStore(PictureState state, WorkerRuntime runtime, Clock clock, DataTypes dataTypes, DeclaredFields declaredFields,
      Workspaces workspaces, StoreCounts counts) {
    this.state = state;
    this.runtime = runtime;
    this.clock = clock;
    this.dataTypes = dataTypes;
    this.declaredFields = declaredFields;
    this.workspaces = workspaces;
    this.counts = counts;
    counts.update(state);
  }

  @Override
  public void handle(StoreMsg message, HandlerContext<StoreMsg> context) {
    switch (message) {
      case StoreMsg.Apply apply -> apply.replyTo().reply(apply(apply.request(), apply.requester(), apply.notSaved()));
      case StoreMsg.GetSnapshot get -> get.replyTo().reply(state.snapshot());
      case StoreMsg.GetArea get -> get.replyTo().reply(area(get.area(), get.objects(), get.workspaces()));
      case StoreMsg.GetObjects get -> get.replyTo().reply(objects(get.ids(), get.workspaces()));
      case StoreMsg.GetLayerPage get -> get.replyTo().reply(layerPage(get.layerId(), get.page(), get.pageSize(), get.workspaces()));
      case StoreMsg.RemoveExpired remove -> remove.replyTo().reply(removeExpired(remove.byDataType(), remove.max()));
      case StoreMsg.Find find -> {
        GeoArea area = find.area();
        Set<UUID> layers = layersIn(find.workspaces());
        Predicate<MapObject> filter =
            layers == null ? find.filter() : o -> layers.contains(o.content().layerId()) && find.filter().test(o);
        List<MapObject> found = area == null
            ? state.find(filter, find.limit() + 1)
            : state.find(area, filter, find.limit() + 1);
        if (found.size() > find.limit()) {
          find.replyTo().fail("more than " + find.limit() + " objects match");
        } else {
          find.replyTo().reply(new PictureSnapshot(state.sequenceNo(), layers(layers), found));
        }
      }
    }
  }

  /** {@link StoreMsg.GetObjects} in every workspace. */
  FoundObjects objects(List<UUID> ids) {
    return objects(ids, null);
  }

  /** {@link StoreMsg.GetObjects}: an object outside {@code workspaces} is missing, as one that does not exist. */
  FoundObjects objects(List<UUID> ids, @Nullable Set<String> workspaces) {
    List<MapObject> found = new ArrayList<>();
    List<UUID> missing = new ArrayList<>();
    for (UUID id : new LinkedHashSet<>(ids)) {
      MapObject object = state.object(id);
      if (object == null || !inWorkspaces(object.content().layerId(), workspaces)) {
        missing.add(id);
      } else {
        found.add(object);
      }
    }
    return new FoundObjects(state.sequenceNo(), found, missing);
  }

  /** {@link StoreMsg.GetLayerPage} in every workspace. */
  LayerPage layerPage(UUID layerId, int page, int pageSize) {
    return layerPage(layerId, page, pageSize, null);
  }

  /** {@link StoreMsg.GetLayerPage}: a layer outside {@code workspaces} is no layer, as one that does not exist. */
  LayerPage layerPage(UUID layerId, int page, int pageSize, @Nullable Set<String> workspaces) {
    if (state.layer(layerId) == null || !inWorkspaces(layerId, workspaces)) {
      return new LayerPage.NoLayer(layerId);
    }
    return new LayerPage.Page(state.sequenceNo(), layerId, page, pageSize, state.objectCount(layerId),
        state.layerPage(layerId, page, pageSize));
  }

  /** {@link StoreMsg.GetArea} in every workspace. */
  AreaSnapshot area(@Nullable GeoArea area, boolean objects) {
    return area(area, objects, null);
  }

  /** {@link StoreMsg.GetArea}: the layers of {@code workspaces}, their counts, and the objects in them. */
  AreaSnapshot area(@Nullable GeoArea area, boolean objects, @Nullable Set<String> workspaces) {
    Set<UUID> layers = layersIn(workspaces);
    List<MapObject> found = new ArrayList<>();
    List<Cap> bounds = new ArrayList<>();
    if (objects) {
      state.forEach(area, (o, bound) -> {
        if (layers == null || layers.contains(o.content().layerId())) {
          found.add(o);
          bounds.add(bound);
        }
      });
    }
    Map<UUID, Integer> counts = state.objectCounts();
    if (layers != null) {
      counts = new LinkedHashMap<>(counts);
      counts.keySet().retainAll(layers);
    }
    return new AreaSnapshot(state.sequenceNo(), layers(layers), found, bounds, counts);
  }

  /** The ids of the layers in {@code workspaces}; {@code null} for every workspace. */
  private @Nullable Set<UUID> layersIn(@Nullable Set<String> workspaces) {
    if (workspaces == null) {
      return null;
    }
    Set<UUID> ids = new HashSet<>();
    for (Layer l : state.layers()) {
      if (workspaces.contains(Workspaces.ofLayer(l.content().workspace()))) {
        ids.add(l.id());
      }
    }
    return ids;
  }

  /** The layers among {@code ids}, in the picture's order; every layer for {@code null}. */
  private List<Layer> layers(@Nullable Set<UUID> ids) {
    return ids == null ? state.layers() : state.layers().stream().filter(l -> ids.contains(l.id())).toList();
  }

  /** Whether the layer {@code layerId} is in {@code workspaces} ({@code null}: every one). */
  private boolean inWorkspaces(UUID layerId, @Nullable Set<String> workspaces) {
    return workspaces == null || workspaces.contains(workspaceOfLayer(layerId));
  }

  /** The workspace of a stored layer; View for one the store does not hold. */
  private String workspaceOfLayer(UUID layerId) {
    Layer layer = state.layer(layerId);
    return Workspaces.ofLayer(layer == null ? null : layer.content().workspace());
  }

  /**
   * The workspace a change is in, as its permission and its published change need it: a stored
   * layer's own, or the one a new layer names; a stored object's layer's, or the layer a new object
   * names. View when the store does not hold the layer (the rules then reject the change).
   */
  private String workspaceOf(ChangeRequest request) {
    if (request.entityType() == EntityType.LAYER) {
      Layer stored = state.layer(request.entityId());
      if (stored != null) {
        return Workspaces.ofLayer(stored.content().workspace());
      }
      return request.data() instanceof LayerContent c ? Workspaces.ofLayer(c.workspace()) : Workspaces.VIEW;
    }
    MapObject stored = state.object(request.entityId());
    if (stored != null) {
      return workspaceOfLayer(stored.content().layerId());
    }
    return request.data() instanceof MapObjectContent c ? workspaceOfLayer(c.layerId()) : Workspaces.VIEW;
  }

  /**
   * Why a user may not make {@code request} (overview 4.4, ADR-0039 point 7), or {@code null}:
   * {@code objects.edit} or {@code layers.edit} in View, the workspace's edit permission in a
   * declared one. A new layer in a workspace the user may not see is checked as View's, as one no
   * plugin declares is ({@link #checkWorkspace} then refuses it).
   */
  private @Nullable String refusal(ChangeRequest request, Requester requester, String workspace) {
    if (!(requester instanceof Requester.User user)) {
      return null;
    }
    return workspaces.refusal(user, request.entityType(), workspaces.maySee(user, workspace) ? workspace : Workspaces.VIEW);
  }

  /**
   * For a user, what is in a workspace it may not see does not exist (owner, 2026-10-27; ADR-0039
   * point 7, as the reads): a change to such an entity is {@code ENTITY_NOT_FOUND}, one naming such
   * a layer {@code LAYER_NOT_FOUND}, with the texts of a missing one and before the permission, so
   * the answer tells nothing of it. Editing there needs the view permission too. Returns the
   * rejection, or null.
   */
  private @Nullable ChangeOutcome hidden(ChangeRequest request, Requester.User user, Instant now) {
    Entity stored = existing(request);
    if (stored != null && request.operation() != Operation.CREATE && !workspaces.maySee(user, workspaceOf(stored))) {
      return reject(request, ChangeRejection.Code.ENTITY_NOT_FOUND,
          "no " + request.entityType().json() + " with id " + request.entityId(), List.of(), now);
    }
    if (request.data() instanceof MapObjectContent c && state.layer(c.layerId()) != null
        && !workspaces.maySee(user, workspaceOfLayer(c.layerId()))) {
      return reject(request, ChangeRejection.Code.LAYER_NOT_FOUND, "no layer with id " + c.layerId(),
          List.of(new Problem("/data/layerId", "the layer does not exist (model rule 3)")), now);
    }
    return null;
  }

  /** The workspace a stored entity is in. */
  private String workspaceOf(Entity entity) {
    return entity instanceof Layer l ? Workspaces.ofLayer(l.content().workspace())
        : workspaceOfLayer(((MapObject) entity).content().layerId());
  }

  /**
   * Applies one request and returns its one answer. Never throws. A user's request without the
   * permission is refused before anything else (overview 4.4).
   */
  ChangeOutcome apply(ChangeRequest request, Requester requester) {
    return apply(request, requester, false);
  }

  /**
   * Applies one request and returns its one answer. Never throws. A user's request without the
   * permission is refused before anything else (overview 4.4). With {@code notSaved} (ADR-0041),
   * only an object update that changes nothing but a move is accepted ({@link #onlyMoved}), and
   * without declared fields; it is applied and published like any change, marked so that
   * persistence does not write it.
   */
  ChangeOutcome apply(ChangeRequest request, Requester requester, boolean notSaved) {
    Instant now = clock.instant().truncatedTo(ChronoUnit.MILLIS);
    ChangeOutcome outcome;
    try {
      String workspace = workspaceOf(request);
      ChangeOutcome hidden = requester instanceof Requester.User user ? hidden(request, user, now) : null;
      String refusal = hidden != null ? null : refusal(request, requester, workspace);
      outcome = hidden != null ? hidden
          : refusal == null ? decide(request, requester, now)
          : reject(request, ChangeRejection.Code.PERMISSION_DENIED, refusal, List.of(), now);
      if (notSaved && outcome instanceof ChangeOutcome.Applied && !request.fields().isEmpty()) {
        outcome = invalid(request, "/fields", NOT_SAVED_FIELDS, now);
      } else if (notSaved && outcome instanceof ChangeOutcome.Applied applied && !onlyMoved(applied.event())) {
        outcome = invalid(request, "/data", NOT_ONLY_MOVED, now);
      }
      if (outcome instanceof ChangeOutcome.Applied applied) {
        ChangeEvent event = applied.event();
        MapObject before = state.object(event.entityId());
        Cap beforeBound = state.bound(event.entityId());
        state.apply(event);
        counts.update(state);
        if (notSaved) {
          counts.countNotSaved(request.source().plugin());
        }
        runtime.publish(CHANGES, new StoreChange(event, before, beforeBound, state.bound(event.entityId()), notSaved, workspace));
      }
    } catch (RuntimeException e) {
      LOG.error("The object store failed on request {}", request.requestId(), e);
      outcome = reject(request, ChangeRejection.Code.INTERNAL_ERROR, "the object store failed: " + e, List.of(), now);
    }
    if (outcome instanceof ChangeOutcome.Rejected rejected) {
      LOG.debug("Rejected {} {} {}: {}", request.operation().json(), request.entityType().json(), request.entityId(),
          rejected.rejection().message());
    }
    return outcome;
  }

  /**
   * Whether {@code event}, not yet applied, is an object update that changes nothing but the
   * object's {@code geometry}, its {@code time} and the symbol's {@code direction} and {@code speed}
   * (ADR-0041 point 1). Every other field must equal the stored object; core fields are compared
   * whole, as model rule 5 replaces them, and so is every extension namespace.
   */
  boolean onlyMoved(ChangeEvent event) {
    if (event.operation() != Operation.UPDATE || !(event.state() instanceof MapObject after)) {
      return false;
    }
    MapObject stored = state.object(event.entityId());
    if (stored == null) {
      return false;
    }
    MapObjectContent old = stored.content();
    MapObjectContent now = after.content();
    if ((old.symbol() == null) != (now.symbol() == null)) {
      return false;
    }
    Symbol symbol = now.symbol();
    if (symbol != null && old.symbol() != null) {
      Modifiers modifiers = symbol.modifiers();
      Modifiers oldModifiers = old.symbol().modifiers();
      // A move may change direction and speed only; SDK 1.4.0's distances and azimuths are the new
      // content's, so a change of them is no move (as the test kit's FakeStore).
      Modifiers kept = new Modifiers(modifiers == null ? Map.of() : modifiers.texts(),
          oldModifiers == null ? null : oldModifiers.direction(), oldModifiers == null ? null : oldModifiers.speed(),
          modifiers == null ? List.of() : modifiers.distances(), modifiers == null ? List.of() : modifiers.azimuths());
      symbol = new Symbol(symbol.standard(), symbol.sidc(), kept);
    }
    MapObjectContent unmoved = new MapObjectContent(now.type(), now.dataType(), now.dataSource(), old.time(), now.layerId(),
        old.geometry(), symbol, now.style(), now.properties(), now.label(), now.extensions(), now.fieldSets(), now.relations(), now.text(),
        now.displayClass());
    return unmoved.equals(old);
  }

  /** Deletes up to {@code max} objects due for removal; returns how many were deleted. */
  int removeExpired(Map<String, Removal> byDataType, int max) {
    if (byDataType.isEmpty()) {
      return 0;
    }
    Instant now = clock.instant();
    List<MapObject> due = state.find(o -> {
      Removal removal = byDataType.get(o.content().dataType());
      return removal != null && removal.due(o, now);
    }, max);
    int removed = 0;
    for (MapObject o : due) {
      ChangeRequest delete = ChangeRequest.delete(UUID.randomUUID(), EntityType.OBJECT, o.id(), o.version(), EXPIRY);
      if (apply(delete, Requester.NO_USER) instanceof ChangeOutcome.Applied) { // ECore's own: not checked
        removed++;
      }
    }
    if (removed > 0) {
      LOG.info("Removed {} expired objects", removed);
    }
    return removed;
  }

  private ChangeOutcome decide(ChangeRequest request, Requester requester, Instant now) {
    return switch (request.operation()) {
      case CREATE -> create(request, requester, now);
      case UPDATE -> update(request, requester, now);
      case DELETE -> delete(request, requester, now);
    };
  }

  private ChangeOutcome create(ChangeRequest request, Requester requester, Instant now) {
    if (state.contains(request.entityId())) {
      return reject(request, ChangeRejection.Code.ENTITY_EXISTS,
          "an entity with id " + request.entityId() + " already exists", List.of(), now);
    }
    EntityContent requested = content(request);
    ChangeOutcome problem = checkContent(request, requested, null, requester, now);
    if (problem != null) {
      return problem;
    }
    ExternalRef ref = request.externalRef();
    UUID holder = ref == null ? null : state.objectWith(ref);
    if (ref != null && holder != null) {
      return reject(request, ChangeRejection.Code.EXTERNAL_REF_EXISTS,
          "object " + holder + " already has the external identity " + ref.system() + " " + ref.id(),
          List.of(new Problem("/externalRef", "another object has it (model rule 16)")), now);
    }
    ChangeOutcome badField = checkRelationsAndSets(request, requested, null, now);
    if (badField == null) {
      badField = checkFields(request, now);
    }
    if (badField != null) {
      return badField;
    }
    // Extensions on create: all namespaces are accepted (ADR-0018), so imported objects keep them.
    EntityContent content = withFields(withDataTypeSets(normalized(requested), null), request.fields());
    Meta.Audit audit = new Meta.Audit(now, request.source());
    Entity entity = entity(request.entityType(), request.entityId(), 1, content, new Meta(audit, audit, ref));
    return applied(request, Operation.CREATE, 1, null, entity, content, now);
  }

  private ChangeOutcome update(ChangeRequest request, Requester requester, Instant now) {
    Entity existing = existing(request);
    if (existing == null) {
      return reject(request, ChangeRejection.Code.ENTITY_NOT_FOUND,
          "no " + request.entityType().json() + " with id " + request.entityId(), List.of(), now);
    }
    EntityContent requested = content(request);
    EntityContent after = after(request, requested, existing.content());
    ChangeOutcome problem = existing instanceof Layer layer ? layerLock(request, layer, (LayerContent) after, requester, now) : null;
    if (problem == null) {
      problem = checkContent(request, requested, existing.content(), requester, now);
    }
    if (problem == null) {
      problem = checkRelationsAndSets(request, requested, existing.content(), now);
    }
    if (problem == null) {
      problem = checkFields(request, now);
    }
    if (problem != null) {
      return problem;
    }
    // Then the data type's sets (rule 21), then the declared fields the request names (ADR-0038).
    EntityContent content = withFields(withDataTypeSets(after, existing.content()), request.fields());
    long version = existing.version() + 1;
    Meta meta = new Meta(existing.meta().created(), new Meta.Audit(now, request.source()), existing.meta().externalRef());
    Entity entity = entity(request.entityType(), request.entityId(), version, content, meta);
    return applied(request, Operation.UPDATE, version, existing.version(), entity, content, now);
  }

  private ChangeOutcome delete(ChangeRequest request, Requester requester, Instant now) {
    Entity existing = existing(request);
    if (existing == null) {
      return reject(request, ChangeRejection.Code.ENTITY_NOT_FOUND,
          "no " + request.entityType().json() + " with id " + request.entityId(), List.of(), now);
    }
    ChangeOutcome lock = switch (existing) {
      case Layer layer -> layerLock(request, layer, null, requester, now);
      case MapObject object -> objectLock(request, null, object.content(), requester, now);
    };
    if (lock != null) {
      return lock;
    }
    if (request.entityType() == EntityType.LAYER) {
      int objects = state.objectCount(request.entityId());
      if (objects > 0) {
        return reject(request, ChangeRejection.Code.LAYER_NOT_EMPTY,
            "the layer still has " + objects + " objects; only empty layers can be deleted (model rule 11)", List.of(), now);
      }
    }
    long version = existing.version() + 1;
    // A delete carries the label the entity had, so receivers can filter without the state (rule 6).
    return applied(request, Operation.DELETE, version, existing.version(), null, existing.content(), now);
  }

  /**
   * The content checks, in the order of model rule 16: the layer (rule 3) and its workspace (R1),
   * the geometry (rules 1 and 2), the data type and data source (rule 14), the time attributes
   * (rule 15). A layer's: its workspace (R2). The caller checks the id before, and the external
   * identity after. Returns a rejection, or null if fine.
   *
   * @param stored the stored content on an update, null on a create
   */
  private @Nullable ChangeOutcome checkContent(
      ChangeRequest request, EntityContent content, @Nullable EntityContent stored, Requester requester, Instant now) {
    if (content instanceof LayerContent layer) {
      return checkWorkspace(request, layer, stored instanceof LayerContent l ? l : null, requester, now);
    }
    if (!(content instanceof MapObjectContent object)) {
      return null;
    }
    if (state.layer(object.layerId()) == null) {
      return reject(request, ChangeRejection.Code.LAYER_NOT_FOUND, "no layer with id " + object.layerId(),
          List.of(new Problem("/data/layerId", "the layer does not exist (model rule 3)")), now);
    }
    ChangeOutcome lock = objectLock(request, object, stored instanceof MapObjectContent o ? o : null, requester, now);
    if (lock != null) {
      return lock;
    }
    if (stored instanceof MapObjectContent before && !before.layerId().equals(object.layerId())) {
      String from = workspaceOfLayer(before.layerId());
      String to = workspaceOfLayer(object.layerId());
      if (!from.equals(to)) {
        return invalid(request, "/data/layerId", "an object stays in its workspace: " + from + ", not " + to
            + " (ADR-0039, data model R1)", now);
      }
    }
    List<Problem> problems = GeometryRules.check(object.geometry());
    if (!problems.isEmpty()) {
      return reject(request, ChangeRejection.Code.VALIDATION_FAILED, problems.getFirst().problem(), problems, now);
    }
    MapObjectContent before = stored instanceof MapObjectContent o ? o : null;
    // Rule 14: checked on a create and on an update that changes it; never for stored data.
    if ((before == null || !before.dataType().equals(object.dataType())) && !dataTypes.isAvailable(object.dataType())) {
      return invalid(request, "/data/dataType",
          "no loaded plugin declares the data type " + object.dataType() + " (model rule 14)", now);
    }
    if (before != null && !before.dataSource().equals(object.dataSource())) {
      return invalid(request, "/data/dataSource", "the data source is fixed at creation: "
          + before.dataSource() + ", not " + object.dataSource() + " (model rule 14)", now);
    }
    TimeAttributes time = object.time();
    Instant validFrom = time == null ? null : time.validFrom();
    Instant expires = time == null ? null : time.expires();
    if (validFrom != null && expires != null && validFrom.isAfter(expires)) {
      return invalid(request, "/data/time/validFrom", "validFrom is after expires (model rule 15)", now);
    }
    return null;
  }

  /**
   * The layer lock for an object (ADR-0042 point 3; CR-0028 part 2 with R1): a user may not create,
   * update or delete an object in a locked layer, nor move one into or out of it. The layer it goes
   * to first, with the path {@code /data/layerId} (the request names it there, N2), then the layer
   * it leaves. Changes without a user pass (point 5). Returns the rejection, or null.
   *
   * @param requested the request's content; null for a delete
   * @param stored the stored content; null for a create
   */
  private @Nullable ChangeOutcome objectLock(ChangeRequest request, @Nullable MapObjectContent requested,
      @Nullable MapObjectContent stored, Requester requester, Instant now) {
    if (!(requester instanceof Requester.User)) {
      return null;
    }
    Layer to = requested == null ? null : state.layer(requested.layerId());
    if (to != null && to.content().isLocked()) {
      return locked(request, "/data/layerId", to, now);
    }
    Layer from = stored == null ? null : state.layer(stored.layerId());
    return from != null && from.content().isLocked() ? locked(request, "", from, now) : null;
  }

  /**
   * The layer lock for the layer itself (ADR-0042 point 3): a user may not update or delete a locked
   * layer, except with an update whose result differs from the stored layer only in {@code locked}
   * and {@code drawOrder}. A create is never refused for it (N3). Returns the rejection, or null.
   *
   * @param after the layer as the update would leave it; null for a delete
   */
  private @Nullable ChangeOutcome layerLock(ChangeRequest request, Layer stored, @Nullable LayerContent after,
      Requester requester, Instant now) {
    LayerContent s = stored.content();
    if (!(requester instanceof Requester.User) || !s.isLocked()) {
      return null;
    }
    boolean onlyLockOrOrder = after != null && after.withLocked(s.locked()).equals(
        new LayerContent(s.name(), after.drawOrder(), s.visible(), s.label(), s.extensions(), s.workspace(), s.locked()));
    return onlyLockOrOrder ? null : locked(request, "", stored, now);
  }

  private static ChangeOutcome locked(ChangeRequest request, String path, Layer layer, Instant now) {
    return reject(request, ChangeRejection.Code.LAYER_LOCKED, "the layer " + layer.content().name() + " is locked (ADR-0042)",
        List.of(new Problem(path, "layer " + layer.id() + " is locked")), now);
  }

  /**
   * A layer's {@code workspace} (ADR-0039, data model R2): View or one a loaded plugin declares,
   * for a user one it may see (one it may not is as one nobody declares); on an update, when named,
   * the stored one ({@code core.view} equals an absent one).
   */
  private @Nullable ChangeOutcome checkWorkspace(ChangeRequest request, LayerContent layer, @Nullable LayerContent stored,
      Requester requester, Instant now) {
    if (layer.workspace() == null) {
      return null;
    }
    String named = Workspaces.ofLayer(layer.workspace());
    boolean known = requester instanceof Requester.User user ? workspaces.maySee(user, named) : workspaces.isKnown(named);
    if (!known) {
      return invalid(request, "/data/workspace", "no loaded plugin declares the workspace " + named + " (ADR-0039)", now);
    }
    if (stored != null && !named.equals(Workspaces.ofLayer(stored.workspace()))) {
      return invalid(request, "/data/workspace", "a layer stays in its workspace: " + Workspaces.ofLayer(stored.workspace())
          + ", not " + named + " (ADR-0039, data model R2)", now);
    }
    return null;
  }

  /**
   * Data model 1.4.0: rule 17, then rule 18, after rule 16 and before the declared fields. Each
   * relation's kind must be declared, except on update an entry (kind and id) the stored object
   * carries; the other object is never checked. Each field set the request adds (on update one the
   * stored object lacks) must be declared; the stored sets are not checked. Paths are the request's:
   * {@code /data/relations/<i>/kind} and {@code /data/fieldSets/<i>}. Returns the rejection, or null.
   *
   * @param stored the stored content on an update, null on a create
   */
  private @Nullable ChangeOutcome checkRelationsAndSets(ChangeRequest request, EntityContent requested,
      @Nullable EntityContent stored, Instant now) {
    if (!(requested instanceof MapObjectContent object)) {
      return null;
    }
    MapObjectContent before = stored instanceof MapObjectContent o ? o : null;
    Set<Relation> kept = before == null ? Set.of() : new HashSet<>(before.relations());
    for (int i = 0; i < object.relations().size(); i++) {
      Relation relation = object.relations().get(i);
      if (!kept.contains(relation) && !declaredFields.isRelationKind(relation.kind())) {
        return invalid(request, "/data/relations/" + i + "/kind",
            "no loaded plugin declares the relation kind " + relation.kind() + " (model rule 17)", now);
      }
    }
    List<String> keptSets = before == null ? List.of() : before.fieldSets();
    for (int i = 0; i < object.fieldSets().size(); i++) {
      String set = object.fieldSets().get(i);
      if (!keptSets.contains(set) && !declaredFields.isFieldSet(set)) {
        return invalid(request, "/data/fieldSets/" + i, "no loaded plugin declares the field set " + set + " (model rule 18)", now);
      }
    }
    return null;
  }

  private ChangeOutcome invalid(ChangeRequest request, String path, String problem, Instant now) {
    return reject(request, ChangeRejection.Code.VALIDATION_FAILED, problem, List.of(new Problem(path, problem)), now);
  }

  /**
   * The checks of the request's declared {@code fields} (ADR-0038 point 2; CR-0025 part 4), each
   * at {@code /fields/<i>}: each field once, declared by a loaded plugin, editable by others or the
   * requester's own ({@code source.plugin}, as for its namespace), and a value of the declared type
   * and limits. Not checked: the object's data type, as the SDK's editor offers every editable
   * field. Returns a rejection naming every problem, or null if fine.
   */
  private @Nullable ChangeOutcome checkFields(ChangeRequest request, Instant now) {
    List<FieldValue> fields = request.fields();
    if (fields.isEmpty()) {
      return null;
    }
    List<Problem> problems = new ArrayList<>();
    Set<FieldRef> seen = new HashSet<>();
    for (int i = 0; i < fields.size(); i++) {
      FieldRef ref = fields.get(i).field();
      String name = ref.plugin() + "." + ref.name();
      DeclaredFields.Field declared = declaredFields.get(ref);
      String problem;
      if (!seen.add(ref)) {
        problem = name + " is set twice in one request";
      } else if (declared == null) {
        problem = "no loaded plugin declares the field " + name + " (ADR-0038)";
      } else if (!declared.editableByOthers() && !ref.plugin().equals(request.source().plugin())) {
        problem = name + " is not editable by others: only the plugin " + ref.plugin() + " sets it (ADR-0038)";
      } else {
        problem = declared.problem().apply(fields.get(i).value());
      }
      if (problem != null) {
        problems.add(new Problem("/fields/" + i, problem));
      }
    }
    return problems.isEmpty() ? null : reject(request, ChangeRejection.Code.VALIDATION_FAILED, problems.getFirst().problem(), problems, now);
  }

  /**
   * {@code content} with the checked {@code fields} applied after it: a value sets {@code
   * extensions.<plugin>.<name>}, {@code null} removes it, and a namespace left empty goes.
   */
  private static EntityContent withFields(EntityContent content, List<FieldValue> fields) {
    if (fields.isEmpty()) {
      return content;
    }
    Map<String, JsonObject> namespaces = new LinkedHashMap<>(content.extensions().namespaces());
    for (FieldValue f : fields) {
      JsonObject namespace = namespaces.getOrDefault(f.plugin(), JsonObject.empty());
      JsonValue value = f.value();
      namespace = value == null ? namespace.without(f.name()) : namespace.with(f.name(), value);
      if (namespace.isEmpty()) {
        namespaces.remove(f.plugin());
      } else {
        namespaces.put(f.plugin(), namespace);
      }
    }
    return withExtensions(content, new Extensions(namespaces));
  }

  /**
   * Extension ownership on update: only the requester's own namespace comes from the request
   * (present replaces, {@code {}} removes, absent keeps); every other namespace is taken from the
   * stored entity. Foreign namespaces in the request are ignored, never a reason to reject.
   */
  static Extensions mergeExtensions(Extensions stored, Extensions requested, String requester, UUID requestId) {
    Map<String, JsonObject> result = new LinkedHashMap<>(stored.namespaces());
    JsonObject own = requested.get(requester);
    if (own != null) {
      if (own.isEmpty()) {
        result.remove(requester);
      } else {
        result.put(requester, own);
      }
    }
    if (LOG.isDebugEnabled()) {
      requested.namespaces().keySet().stream()
          .filter(ns -> !ns.equals(requester))
          .filter(ns -> !requested.namespaces().get(ns).equals(stored.namespaces().get(ns)))
          .forEach(ns -> LOG.debug("Request {} by {}: foreign extension namespace {} ignored", requestId, requester, ns));
    }
    return new Extensions(result);
  }

  /**
   * The content an update leaves, before its declared fields: core fields replaced as a whole,
   * extensions by ownership (model rule 5, ADR-0018). A layer's absent workspace keeps the stored
   * one (rule 5's exception, R2; the ACA's C1: an explicit one must equal it, checkContent makes
   * sure), and so does an absent {@code locked} (CR-0028 part 2, the owner's CR); {@code false} is
   * kept as absent (ADR-0042). An object's field sets are the stored ones, then those the request
   * adds (rule 5's third exception, ADR-0050 point 3): nothing removes one.
   */
  private static EntityContent after(ChangeRequest request, EntityContent requested, EntityContent stored) {
    Extensions extensions = mergeExtensions(stored.extensions(), requested.extensions(), request.source().plugin(), request.requestId());
    EntityContent normal = withExtensions(normalized(requested), extensions);
    if (normal instanceof LayerContent l && requested instanceof LayerContent r && stored instanceof LayerContent s) {
      return l.inWorkspace(r.workspace() == null ? s.workspace() : l.workspace()).withLocked(r.locked() == null ? s.locked() : l.locked());
    }
    if (normal instanceof MapObjectContent o && stored instanceof MapObjectContent s) {
      List<String> sets = new ArrayList<>(s.fieldSets());
      o.fieldSets().stream().filter(set -> !sets.contains(set)).forEach(sets::add);
      return o.withFieldSets(sets);
    }
    return normal;
  }

  /**
   * Data model rule 21 (SDK 1.5.0, CR-0038 point 3): a {@code core.symbol} object's create, or its
   * update that changes the data type, adds each set the (new) data type names and the object does
   * not carry yet, after its own, in the data type's order. After rule 18's check, so these sets are
   * not checked again (rule 20 made them declared); nothing removes a set. Symbols only in 1.5.0
   * (owner, NO A): shapes and tactical graphics get none.
   *
   * @param stored the stored content on an update, null on a create
   */
  private EntityContent withDataTypeSets(EntityContent content, @Nullable EntityContent stored) {
    if (!(content instanceof MapObjectContent o) || !o.type().equals(MapObjectContent.SYMBOL)
        || stored instanceof MapObjectContent s && s.dataType().equals(o.dataType())) {
      return content;
    }
    List<String> added = dataTypes.fieldSets(o.dataType()).stream().filter(set -> !o.fieldSets().contains(set)).toList();
    if (added.isEmpty()) {
      return content;
    }
    List<String> sets = new ArrayList<>(o.fieldSets());
    sets.addAll(added);
    return o.withFieldSets(sets);
  }

  private @Nullable Entity existing(ChangeRequest request) {
    return request.entityType() == EntityType.LAYER ? state.layer(request.entityId()) : state.object(request.entityId());
  }

  private static EntityContent content(ChangeRequest request) {
    EntityContent data = request.data();
    if (data == null) {
      throw new IllegalStateException("a " + request.operation().json() + " without data"); // the record forbids it
    }
    return data;
  }

  private static EntityContent normalized(EntityContent content) {
    if (content instanceof LayerContent l) {
      // R2: View's layers carry no workspace, an explicit core.view is the same; ADR-0042: false is kept as absent.
      return l.inWorkspace(Workspaces.VIEW.equals(l.workspace()) ? null : l.workspace()).withLocked(l.isLocked() ? Boolean.TRUE : null);
    }
    if (content instanceof MapObjectContent o) {
      var geometry = GeometryRules.normalize(o.geometry());
      if (geometry != o.geometry()) {
        return new MapObjectContent(o.type(), o.dataType(), o.dataSource(), o.time(), o.layerId(), geometry, o.symbol(), o.style(),
            o.properties(), o.label(), o.extensions(), o.fieldSets(), o.relations(), o.text(), o.displayClass());
      }
    }
    return content;
  }

  private static EntityContent withExtensions(EntityContent content, Extensions extensions) {
    return switch (content) {
      case MapObjectContent o -> new MapObjectContent(
          o.type(), o.dataType(), o.dataSource(), o.time(), o.layerId(), o.geometry(), o.symbol(), o.style(), o.properties(),
          o.label(), extensions, o.fieldSets(), o.relations(), o.text(), o.displayClass());
      case LayerContent l -> new LayerContent(l.name(), l.drawOrder(), l.visible(), l.label(), extensions, l.workspace(), l.locked());
    };
  }

  private static Entity entity(EntityType type, UUID id, long version, EntityContent content, Meta meta) {
    return type == EntityType.LAYER
        ? new Layer(id, version, (LayerContent) content, meta)
        : new MapObject(id, version, (MapObjectContent) content, meta);
  }

  private ChangeOutcome applied(
      ChangeRequest request, Operation operation, long version, @Nullable Long previousVersion, @Nullable Entity state,
      EntityContent labelSource, Instant now) {
    return new ChangeOutcome.Applied(new ChangeEvent(
        this.state.sequenceNo() + 1, request.requestId(), request.entityType(), operation, request.entityId(), version,
        previousVersion, request.baseVersion(), state, labelSource.label(), now, request.source()));
  }

  /** A detail's path or problem as the rejection schema allows it: at most {@value #MAX_DETAIL} characters. */
  private static String shortened(String text) {
    return text.length() > MAX_DETAIL ? text.substring(0, MAX_DETAIL - 1) + "…" : text;
  }

  private static ChangeOutcome reject(
      ChangeRequest request, ChangeRejection.Code code, String message, List<Problem> problems, Instant now) {
    String text = message.length() > MAX_MESSAGE ? message.substring(0, MAX_MESSAGE - 1) + "…" : message;
    List<ChangeRejection.Detail> details = problems.stream()
        .limit(50)
        .map(p -> new ChangeRejection.Detail(shortened(p.path()), shortened(p.problem())))
        .toList();
    return new ChangeOutcome.Rejected(new ChangeRejection(
        request.requestId(), request.entityType(), request.operation(), request.entityId(), code, text, details, now));
  }
}
