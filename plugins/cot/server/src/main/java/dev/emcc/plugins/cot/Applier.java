package dev.emcc.plugins.cot;

import dev.emcc.plugins.cot.Config.Globals;
import dev.emcc.plugins.cot.Config.LinkConfig;
import dev.emcc.plugins.cot.codec.CotEvent;
import dev.emcc.plugins.cot.codec.CotMapper;
import dev.emcc.plugins.cot.codec.Placement;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginLog;
import dev.emcc.sdk.PluginStatus;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.LayerChoice;
import dev.emcc.sdk.connection.Backoff;
import dev.emcc.sdk.connection.ConnectionEvent;
import dev.emcc.sdk.connection.ConnectionSpec;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.Restart;
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
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.ObjectQuery;
import dev.emcc.sdk.store.QueryResult;
import dev.emcc.sdk.store.StoreUpdate;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.WorkerContext;
import dev.emcc.sdk.worker.WorkerRef;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * The one worker that owns all the plugin's state: the links and their connection tasks, the
 * layers, and the objects it has made. It applies each CoT event to the object store as a change
 * request (brief function 5), and nothing else touches objects.
 *
 * <p>Per uid at most one change is in flight; a newer event waits and replaces older waiting
 * events, so a burst costs one change request, and each change is based on the state the store
 * last reported. Objects are found again after a restart through the store subscription (by
 * external identity), the layers the plugin made through a plugin document. The plugin never
 * deletes objects: ECore removes expired ones.
 */
final class Applier implements Handler<ApplierMsg> {

  static final String LAYERS_KEY = "layers";

  private static final Duration SUBMIT_TIMEOUT = Duration.ofSeconds(10);
  /** Changes in flight at once: far below ECore's cap of outstanding asks (CR-0005), and a bound on the work one message triggers. */
  private static final int MAX_IN_FLIGHT = 1_000;
  /** Events kept waiting (one per uid) before new ones are dropped. */
  private static final int MAX_WAITING = 100_000;
  private static final int MAX_ATTEMPTS = 3;
  private static final long WARN_EVERY_TICKS = 60;
  private static final long LAYER_RETRY_TICKS = 5;
  /** What an output link may have waiting: one event per object, the latest. */
  private static final int INBOX = 20_000;
  private static final Backoff RESTART = Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60));

  private enum Phase { CREATING, UPDATING, LOOKING_UP, PARKED }

  /** An event on its way to the store. */
  private record Work(String link, CotEvent event, int attempts) {}

  /** What is going on for one uid: not kept for uids at rest. */
  private static final class UidState {
    Phase phase;
    long ticket;
    Work active;
    @Nullable Work queued;

    UidState(Phase phase, long ticket, Work active) {
      this.phase = phase;
      this.ticket = ticket;
      this.active = active;
    }
  }

  private final PluginContext context;
  private final Clock clock;
  private final SecureRandom random = new SecureRandom();
  private final OutputEngine output;

  private @Nullable WorkerRef<ApplierMsg> self;
  private @Nullable PluginLog log;

  private Config config = Config.EMPTY;
  private final Map<String, LinkRuntime> links = new LinkedHashMap<>();
  /** The new layers this plugin made, by the name the links that share them give (the plugin document). */
  private final Map<String, UUID> madeLayers = new LinkedHashMap<>();
  /** The layers being made now, by name, with the ticket of the request. */
  private final Map<String, Long> layersInMaking = new HashMap<>();

  private final Map<String, MapObject> objectsByUid = new HashMap<>();
  private final Map<UUID, String> uidsById = new HashMap<>();
  private final Map<UUID, Layer> layers = new HashMap<>();
  /** The sequence number of the newest change the subscription has delivered, and of the creation of each layer this plugin made. */
  private long seenSequence;
  private final Map<UUID, Long> layerMadeAt = new HashMap<>();
  private boolean snapshotLoaded;
  private boolean documentLoaded;
  private boolean ready;

  private final Map<String, UidState> uids = new HashMap<>();
  private final LinkedHashMap<String, Work> waiting = new LinkedHashMap<>();
  private int inFlight;
  private long tickets;
  private long tick;
  private long lastGlobalWarnTick = Long.MIN_VALUE / 2;
  private boolean dirty;
  private final TcpLinkTask.@Nullable Opener opener;

  Applier(PluginContext context, Clock clock, LinkOutput.Caps caps) {
    this(context, clock, caps, null);
  }

  /** As above, and {@code opener} opens the sockets of the TCP links in place of the task's own code: a test's way to a socket that blocks. */
  Applier(PluginContext context, Clock clock, LinkOutput.Caps caps, TcpLinkTask.@Nullable Opener opener) {
    this.opener = opener;
    this.context = context;
    this.clock = clock;
    this.output = new OutputEngine(context, clock, caps, new OutputEngine.Host() {
      @Override
      public WorkerRef<ApplierMsg> self() {
        return Objects.requireNonNull(Applier.this.self);
      }

      @Override
      public long tick() {
        return tick;
      }

      @Override
      public boolean warn(LinkRuntime link, String message, Object... args) {
        return Applier.this.warn(link, message, args);
      }

      @Override
      public Iterable<LinkRuntime> links() {
        return links.values();
      }

      @Override
      public void changed() {
        dirty = true;
      }
    });
  }

  @Override
  public void handle(ApplierMsg message, WorkerContext<ApplierMsg> ctx) {
    self = ctx.self();
    log = ctx.log();
    switch (message) {
      case ApplierMsg.SettingsChanged m -> applySettings(m.settings());
      case ApplierMsg.LinkEvent m -> onLinkEvent(m.event());
      case ApplierMsg.Connected m -> onConnected(m);
      case ApplierMsg.Received m -> onReceived(m);
      case ApplierMsg.Counted m -> {
        LinkRuntime link = links.get(m.link());
        if (link != null) {
          link.observe(m.loop(), m.counters());
          noteDrops(link, m.lastDrop());
          dirty = true;
        }
      }
      case ApplierMsg.Written m -> {
        LinkRuntime link = links.get(m.link());
        if (link != null) {
          link.writes.observe(m.loop(), m.count(), m.writing(), tick);
          if (link.output != null) {
            link.output.observeWritten(m.loop(), m.count(), m.expired());
            dirty = !m.writing() || dirty;
          }
        }
      }
      case ApplierMsg.SourceUpdate m -> output.onSourceUpdate(m);
      case ApplierMsg.FromChannel m -> output.onChannelItem(m);
      case ApplierMsg.Stop m -> output.stop();
      case ApplierMsg.Tick m -> onTick();
      case ApplierMsg.ObjectAnswer m -> onObjectAnswer(m);
      case ApplierMsg.LayerAnswer m -> onLayerAnswer(m);
      case ApplierMsg.Stored m -> onStored(m.update());
      case ApplierMsg.Looked m -> onLooked(m);
      case ApplierMsg.LayersLoaded m -> onLayersLoaded(m.result());
      case ApplierMsg.LayersSaved m -> {
        if (m.result() instanceof DocumentResult.Failed f) {
          warn(null, "the layers could not be saved: {}", Text.clean(f.reason()));
        }
      }
    }
  }

  // ---------------------------------------------------------------- settings and links

  private void applySettings(JsonObject settings) {
    Config next = Config.parse(settings);
    Globals before = config.globals();
    config = next;
    boolean globalsChanged = !before.equals(next.globals());

    Set<String> wanted = new HashSet<>();
    next.links().forEach(l -> wanted.add(l.name()));
    for (Iterator<Map.Entry<String, LinkRuntime>> it = links.entrySet().iterator(); it.hasNext(); ) {
      LinkRuntime gone = it.next().getValue();
      if (!wanted.contains(gone.config.name())) {
        output.forget(gone);
        stopTask(gone);
        it.remove();
      }
    }
    for (LinkConfig c : next.links()) {
      LinkRuntime link = links.get(c.name());
      if (link == null) {
        link = new LinkRuntime(c);
        links.put(c.name(), link);
        if (runnable(c)) {
          startTask(link);
        }
        continue;
      }
      boolean reconnect = globalsChanged || !link.config.sameConnection(c) || c.enabled() != link.config.enabled();
      if (!Objects.equals(link.config.target(), c.target())) {
        link.layerId = null; // another target: the layer is looked for again
      }
      link.config = c;
      if (reconnect) {
        stopTask(link);
      }
      if (runnable(c) && link.task == null) {
        startTask(link);
      }
    }
    output.sync();
    for (String problem : next.problems()) {
      warn(null, "settings: {}", problem);
    }
    if (!next.storedStreams().isEmpty()) {
      warn(null, "settings: {} stored streams are no longer read; enter them as links", next.storedStreams().size());
    }
    refreshStatus();
  }

  private static boolean runnable(LinkConfig c) {
    return c.enabled() && c.problem() == null;
  }

  private void startTask(LinkRuntime link) {
    LinkConfig c = link.config;
    Globals g = config.globals();
    WorkerRef<ApplierMsg> worker = Objects.requireNonNull(self);
    ConnectionSpec<LinkInbox> spec = ConnectionSpec.of(c.name(), LinkInbox.class).inbox(INBOX, Overflow.coalesceByKey()).restart(Restart.always(RESTART));
    UUID generation = UUID.randomUUID();
    Supplier<ConnectionTask<LinkInbox>> factory = c.transport().isTcp()
        ? () -> new TcpLinkTask(c, g, worker, clock, opener, generation)
        : () -> new DatagramLinkTask(c, g, worker, clock, generation);
    try {
      link.task = context.connections().start(spec, factory, worker, ApplierMsg.LinkEvent::new);
      link.generation = generation;
      link.lastError = null;
    } catch (IllegalArgumentException | IllegalStateException e) {
      link.task = null;
      link.lastError = "cannot start: " + e.getMessage();
      warn(link, "link {} cannot start: {}", c.name(), e.getMessage());
    }
    link.running = false;
    link.connected = false;
    link.since = null;
    link.retryAt = null;
    link.writes.clear();
  }

  private void stopTask(LinkRuntime link) {
    link.output = null;
    if (link.task != null) {
      link.task.stop();
      link.task = null;
    }
    link.running = false;
    link.connected = false;
    link.since = null;
    link.retryAt = null;
    dropParked(link);
  }

  /**
   * The peer of an {@code out} or {@code both} TCP link has not finished one write (one event, or the presence event) in the stall limit (it stays connected but does
   * not read): the task is stopped, which makes ECore close its socket and so ends the blocked write, and the link is started again.
   * The new connection sends every object of the source layers again; what waited in the old task's inbox (channel items) is lost.
   * Another stall takes the limit again, so this cannot loop faster than that.
   */
  private void restartStalled(LinkRuntime link) {
    link.stalls++;
    warn(link, "link {}: the peer has taken nothing of a write for {} seconds; closing the connection and connecting again",
        link.config.name(), config.writeStall().toSeconds());
    output.disconnected(link);
    if (link.task != null) {
      link.task.stop();
      link.task = null;
    }
    startTask(link);
    if (link.task != null) {
      link.lastError = "write stalled, reconnecting";
    }
    dirty = true;
  }

  private void onLinkEvent(ConnectionEvent event) {
    LinkRuntime link = links.get(event.task());
    if (link == null || link.task == null) {
      return; // a link that was removed or switched off: the end of its task is our own doing
    }
    switch (event) {
      case ConnectionEvent.Running r -> {
        link.running = true;
        link.lastError = null;
        link.retryAt = null;
      }
      case ConnectionEvent.Restarting r -> {
        output.disconnected(link);
        link.writes.clear();
        link.running = false;
        link.connected = false;
        link.lastError = Text.clean(r.reason());
        link.retryAt = r.retryAt();
      }
      case ConnectionEvent.Failed f -> {
        output.disconnected(link);
        link.writes.clear();
        link.running = false;
        link.connected = false;
        link.lastError = Text.clean(f.reason());
        link.retryAt = null;
        link.task = null; // ECore will not try again; a change of the settings starts it
      }
      case ConnectionEvent.Stopped s -> {
        // Only our own stop ends a task for good (it always restarts), and that case returned above.
      }
    }
    refreshStatus();
  }

  private void onConnected(ApplierMsg.Connected m) {
    LinkRuntime link = links.get(m.link());
    if (link == null || link.task == null) {
      return;
    }
    if (!m.generation().equals(link.generation)) {
      return; // the connection of a task stopped meanwhile (the settings changed): not the new task's, whose own message follows
    }
    link.running = true;
    link.connected = true;
    link.since = m.at();
    link.lastError = null;
    link.retryAt = null;
    output.connected(link);
    refreshStatus();
  }

  // ---------------------------------------------------------------- events

  private void onReceived(ApplierMsg.Received m) {
    LinkRuntime link = links.get(m.link());
    if (link == null) {
      return; // the link was removed from the settings
    }
    link.observe(m.loop(), m.counters());
    noteDrops(link, m.lastDrop());
    dirty = true;
    accept(new Work(m.link(), m.event(), 0));
  }

  /** Takes an event in: starts it, or keeps it waiting (replacing an older waiting event for the same uid). */
  private void accept(Work work) {
    String uid = work.event().uid();
    UidState state = uids.get(uid);
    if (state != null) {
      Work reference = state.queued != null ? state.queued : state.active;
      if (isOlder(work, reference)) {
        countOlder(work);
      } else {
        state.queued = work;
      }
      return;
    }
    // A uid is in at most one of `uids` and `waiting`: an event that waits is replaced by a newer one, never overtaken by it.
    Work held = waiting.get(uid);
    if (held != null && isOlder(work, held)) {
      countOlder(work);
      return;
    }
    if (!ready || inFlight >= MAX_IN_FLIGHT) {
      if (held != null || waiting.size() < MAX_WAITING) {
        waiting.put(uid, work);
      } else {
        countRejected(work);
        warn(links.get(work.link()), "link {}: too many events waiting; dropped one", work.link());
      }
      return;
    }
    if (held != null) {
      waiting.remove(uid);
    }
    start(work);
  }

  /** Starts as many waiting events as the limit allows. */
  private void pump() {
    if (!ready) {
      return;
    }
    while (inFlight < MAX_IN_FLIGHT && !waiting.isEmpty()) {
      Iterator<Work> it = waiting.values().iterator();
      Work work = it.next();
      it.remove();
      start(work);
    }
  }

  /** Starts the change for an event whose uid has nothing in progress. */
  private void start(Work work) {
    String uid = work.event().uid();
    MapObject known = objectsByUid.get(uid);
    if (known != null) {
      Instant seen = observed(known);
      Instant at = work.event().time();
      if (seen != null && at != null && at.isBefore(seen)) {
        countOlder(work);
        return; // an older event never moves an object back
      }
      update(work, known);
      return;
    }
    LinkRuntime link = links.get(work.link());
    if (link == null) {
      return;
    }
    UUID target = targetLayerOf(link);
    if (target != null && output.wasSentFrom(uid, target)) {
      countEcho(work);
      return; // the uid emc2 made up for an object it sent from this layer, back into the same layer: not a second object (criterion 16)
    }
    UUID layerId = ensureLayer(link);
    if (layerId == null) {
      if (parkedCount() >= MAX_WAITING) {
        countRejected(work); // a layer that cannot be made must not let the events pile up without limit
        warn(link, "link {}: too many events wait for the layer; dropped one", work.link());
        return;
      }
      uids.put(uid, new UidState(Phase.PARKED, 0, work));
      link.parked.add(uid);
      return;
    }
    create(work, link, layerId);
  }

  /** The layer the link's objects go into, as far as it is known before its first object: the one an admin picked, else the one in use. */
  private static @Nullable UUID targetLayerOf(LinkRuntime link) {
    LayerChoice target = link.config.target();
    return target != null && target.id() != null ? target.id() : link.layerId;
  }

  private void create(Work work, LinkRuntime link, UUID layerId) {
    CotEvent event = work.event();
    SecurityLabel label = labelOf(link);
    MapObjectContent content = CotMapper.toContent(event, new Placement(link.config.name(), layerId, label, null));
    UUID id = UuidV7.next(clock.millis(), random);
    Change change = Change.createObject(id, content).withExternalRef(new ExternalRef(CotMapper.NAMESPACE, event.uid())).bySystem(work.link());
    submit(event.uid(), new UidState(Phase.CREATING, ++tickets, work), change);
  }

  private void update(Work work, MapObject known) {
    MapObjectContent stored = known.content();
    // The object keeps its link, layer, label and style: an event never moves it or changes them. So a track a user moved into another
    // layer stays there (brief function 31, ADR-0053 point 8); a copy has no external identity, so it is never found here.
    MapObjectContent content = CotMapper.updating(CotMapper.toContent(work.event(), new Placement(stored.dataSource(), stored.layerId(), stored.label(), stored.style()),
        stored.extensions().get(CotMapper.NAMESPACE)), stored);
    submit(work.event().uid(), new UidState(Phase.UPDATING, ++tickets, work), Change.updateObject(known, content).bySystem(work.link()));
  }

  private void submit(String uid, UidState state, Change change) {
    uids.put(uid, state);
    inFlight++;
    long ticket = state.ticket;
    context.store().submit(change, SUBMIT_TIMEOUT, Objects.requireNonNull(self), outcome -> new ApplierMsg.ObjectAnswer(uid, ticket, outcome));
  }

  private void onObjectAnswer(ApplierMsg.ObjectAnswer m) {
    UidState state = uids.get(m.uid());
    if (state == null || state.ticket != m.ticket() || (state.phase != Phase.CREATING && state.phase != Phase.UPDATING)) {
      return; // an answer to an earlier try
    }
    Work work = state.active;
    LinkRuntime link = links.get(work.link());
    switch (m.outcome()) {
      case ChangeOutcome.Applied applied -> {
        if (applied.event().state() instanceof MapObject object) {
          remember(object);
        }
        if (link != null) {
          if (state.phase == Phase.CREATING) {
            link.created++;
          } else {
            link.updated++;
          }
        }
        dirty = true;
        finish(m.uid(), state);
      }
      case ChangeOutcome.Rejected rejected -> onRejected(m.uid(), state, link, rejected.rejection());
      case ChangeOutcome.Unknown unknown -> {
        // The change may or may not have been applied: look the object up, then decide again.
        warn(link, "link {}: no answer from the object store ({})", work.link(), Text.clean(unknown.reason()));
        lookUp(m.uid(), state);
      }
    }
  }

  private void onRejected(String uid, UidState state, @Nullable LinkRuntime link, ChangeRejection rejection) {
    switch (rejection.code()) {
      case ENTITY_EXISTS, EXTERNAL_REF_EXISTS -> lookUp(uid, state); // it is there after all (a resent create, or another writer)
      case ENTITY_NOT_FOUND -> {
        forget(uid); // deleted meanwhile: the event creates it again
        retry(uid, state, link);
      }
      case LAYER_NOT_FOUND -> {
        if (link != null) {
          link.layerId = null;
        }
        retry(uid, state, link);
      }
      default -> {
        if (link != null) {
          link.rejected++;
        }
        dirty = true;
        warn(link, "link {}: the object store rejected an event ({}: {})", state.active.link(), rejection.code(), Text.clean(rejection.message()));
        finish(uid, state);
      }
    }
  }

  private void lookUp(String uid, UidState state) {
    state.phase = Phase.LOOKING_UP;
    state.ticket = ++tickets;
    long ticket = state.ticket;
    context.store().query(ObjectQuery.byExternalRef(new ExternalRef(CotMapper.NAMESPACE, uid)), SUBMIT_TIMEOUT, Objects.requireNonNull(self),
        result -> new ApplierMsg.Looked(uid, ticket, result));
  }

  private void onLooked(ApplierMsg.Looked m) {
    UidState state = uids.get(m.uid());
    if (state == null || state.ticket != m.ticket() || state.phase != Phase.LOOKING_UP) {
      return;
    }
    if (m.result() instanceof QueryResult.Found found) {
      if (found.objects().isEmpty()) {
        forget(m.uid());
      } else {
        remember(found.objects().getFirst());
      }
    }
    retry(m.uid(), state, links.get(state.active.link()));
  }

  /** Ends the work on a uid and starts the event that waited for it. */
  private void finish(String uid, UidState state) {
    uids.remove(uid);
    inFlight--;
    Work next = state.queued;
    if (next != null) {
      accept(next);
    }
    pump();
  }

  /** Tries the event again from the current state of the index (at most {@code MAX_ATTEMPTS} times). */
  private void retry(String uid, UidState state, @Nullable LinkRuntime link) {
    uids.remove(uid);
    inFlight--;
    Work work = state.active;
    if (work.attempts() + 1 >= MAX_ATTEMPTS) {
      if (link != null) {
        link.rejected++;
      }
      dirty = true;
      warn(link, "link {}: gave up applying an event after {} tries", work.link(), MAX_ATTEMPTS);
      Work next = state.queued;
      if (next != null) {
        accept(next);
      }
      pump();
      return;
    }
    Work again = new Work(work.link(), work.event(), work.attempts() + 1);
    Work next = state.queued;
    accept(next != null && !isOlder(next, again) ? next : again);
    pump();
  }

  // ---------------------------------------------------------------- layers

  /**
   * The link's layer if it exists; otherwise starts making it and returns {@code null}.
   *
   * <p>A link's target is a layer an admin picked, with its id: from the list or made at once by
   * the form's "+" button (SDK 1.4.0, T-133); absent: a new layer named like the link, made at the
   * first event. A picked layer that is gone, or deleted later, is made again at the next event
   * under the name the form saved, and found by that name, so that two links that name the same
   * gone layer share the new one (ACA note N1). A value without an id (saved before 1.4.0) is a
   * layer by that name.
   */
  private @Nullable UUID ensureLayer(LinkRuntime link) {
    LayerChoice target = link.config.target();
    if (target != null && target.id() != null && layerExists(target.id())) {
      return setLayer(link, target.id());
    }
    String name = link.config.newLayerName();
    UUID made = madeLayers.get(name);
    if (made != null) {
      if (layerExists(made)) {
        return setLayer(link, made);
      }
      madeLayers.remove(name); // deleted (only an empty layer can be)
      saveLayers();
    }
    if (layersInMaking.containsKey(name)) {
      return null; // this link's, or another link's that names the same layer
    }
    if (target == null) {
      UUID adopted = adoptLayer(link.config.name());
      if (adopted != null) {
        madeLayers.put(name, adopted);
        saveLayers();
        return setLayer(link, adopted);
      }
    }
    double top = layers.values().stream().mapToDouble(l -> l.content().drawOrder()).max().orElse(0) + 1;
    var content = new LayerContent(name, top, true, labelOf(link), Extensions.empty());
    UUID id = UuidV7.next(clock.millis(), random);
    long ticket = ++tickets;
    layersInMaking.put(name, ticket);
    context.store().submit(Change.createLayer(id, content).bySystem(link.config.name()), SUBMIT_TIMEOUT, Objects.requireNonNull(self),
        outcome -> new ApplierMsg.LayerAnswer(name, ticket, outcome));
    return null;
  }

  /** In the store, or made by this plugin after the newest change the subscription has shown (a late snapshot does not show it yet). */
  private boolean layerExists(UUID id) {
    return layers.containsKey(id) || layerMadeAt.getOrDefault(id, -1L) > seenSequence;
  }

  /** After a lost plugin document: the layer an object of this link is already in, if it still exists. */
  private @Nullable UUID adoptLayer(String linkName) {
    for (MapObject object : objectsByUid.values()) {
      if (object.content().dataSource().equals(linkName) && layerExists(object.content().layerId())) {
        return object.content().layerId();
      }
    }
    return null;
  }

  private void onLayerAnswer(ApplierMsg.LayerAnswer m) {
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
          for (LinkRuntime link : links.values()) {
            if (link.config.newLayerName().equals(m.name()) && !isPicked(link)) {
              setLayer(link, layer.id());
              unpark(link);
            }
          }
        }
      }
      case ChangeOutcome.Rejected rejected -> {
        retryLayerLater(m.name());
        warn(null, "the layer '{}' could not be made ({}: {})", m.name(), rejected.rejection().code(), Text.clean(rejected.rejection().message()));
      }
      case ChangeOutcome.Unknown unknown -> {
        retryLayerLater(m.name());
        warn(null, "no answer to the creation of the layer '{}' ({})", Text.clean(m.name()), Text.clean(unknown.reason()));
      }
    }
  }

  /** Whether the link's target is an existing layer that was picked, which is there (so no new layer is needed). */
  private boolean isPicked(LinkRuntime link) {
    LayerChoice target = link.config.target();
    return target != null && target.id() != null && layerExists(target.id());
  }

  private void retryLayerLater(String name) {
    for (LinkRuntime link : links.values()) {
      if (link.config.newLayerName().equals(name)) {
        link.layerRetryTick = tick + LAYER_RETRY_TICKS;
      }
    }
  }

  /** The events that wait for a layer, all links together. */
  private int parkedCount() {
    int total = 0;
    for (LinkRuntime link : links.values()) {
      total += link.parked.size();
    }
    return total;
  }

  /** The link stops or goes: the events that waited for its layer are dropped, so that nothing waits for ever. */
  private void dropParked(LinkRuntime link) {
    for (String uid : link.parked) {
      UidState state = uids.get(uid);
      if (state != null && state.phase == Phase.PARKED) {
        uids.remove(uid);
      }
    }
    link.parked.clear();
  }

  /** The layer exists: the events that waited for it go on. */
  private void unpark(LinkRuntime link) {
    for (String uid : new ArrayList<>(link.parked)) {
      UidState state = uids.get(uid);
      if (state != null && state.phase == Phase.PARKED) {
        uids.remove(uid);
        Work work = state.active;
        Work queued = state.queued;
        Work latest = queued != null && !isOlder(queued, work) ? queued : work;
        Work held = waiting.get(uid);
        waiting.put(uid, held != null && isOlder(latest, held) ? held : latest);
      }
    }
    link.parked.clear();
    pump();
  }

  private UUID setLayer(LinkRuntime link, UUID id) {
    link.layerId = id;
    return id;
  }

  private void saveLayers() {
    var byName = JsonObject.builder();
    madeLayers.forEach((name, id) -> byName.put(name, JsonString.of(id.toString())));
    JsonObject document = JsonObject.builder().put("named", byName.build()).build();
    context.documents().put(LAYERS_KEY, document, Objects.requireNonNull(self), ApplierMsg.LayersSaved::new);
  }

  private void onLayersLoaded(DocumentResult result) {
    switch (result) {
      case DocumentResult.Found found -> {
        // M1 and M2 kept the layer of each stream by the stream's name: a link of that name finds it again.
        if (found.value().get("streams") instanceof JsonObject byStream) {
          byStream.members().forEach((name, value) -> {
            UUID id = uuid(value);
            if (id != null) {
              madeLayers.putIfAbsent(name, id);
            }
          });
        }
        if (found.value().get("named") instanceof JsonObject byName) {
          byName.members().forEach((name, value) -> {
            UUID id = uuid(value);
            if (id != null) {
              madeLayers.putIfAbsent(name, id);
            }
          });
        }
      }
      case DocumentResult.Failed failed -> warn(null, "the layers could not be read: {}", Text.clean(failed.reason()));
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
        objectsByUid.clear();
        uidsById.clear();
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
      String uid = uidsById.remove(event.entityId());
      if (uid != null) {
        objectsByUid.remove(uid);
      }
    } else if (event.state() instanceof MapObject object) {
      remember(object);
    }
  }

  private void checkReady() {
    if (!ready && snapshotLoaded && documentLoaded) {
      ready = true;
      pump();
      refreshStatus();
    }
  }

  /** Keeps the newest state of one of the plugin's objects. */
  private void remember(MapObject object) {
    ExternalRef ref = object.meta().externalRef();
    if (ref == null || !ref.system().equals(CotMapper.NAMESPACE)) {
      return;
    }
    MapObject current = objectsByUid.get(ref.id());
    if (current != null) {
      if (current.id().equals(object.id()) && current.version() > object.version()) {
        return;
      }
      uidsById.remove(current.id());
    }
    objectsByUid.put(ref.id(), object);
    uidsById.put(object.id(), ref.id());
  }

  private void forget(String uid) {
    MapObject gone = objectsByUid.remove(uid);
    if (gone != null) {
      uidsById.remove(gone.id());
    }
  }

  private static @Nullable Instant observed(MapObject object) {
    return object.content().time() == null ? null : object.content().time().observed();
  }

  // ---------------------------------------------------------------- ordering of events

  /** Whether {@code work} is older, by the event's time, than {@code than}. Events without a time are never older. */
  private static boolean isOlder(Work work, Work than) {
    Instant a = work.event().time();
    Instant b = than.event().time();
    return a != null && b != null && a.isBefore(b);
  }

  private void countOlder(Work work) {
    LinkRuntime link = links.get(work.link());
    if (link != null) {
      link.older++;
      dirty = true;
    }
  }

  private void countEcho(Work work) {
    LinkRuntime link = links.get(work.link());
    if (link != null) {
      link.echoes++;
      dirty = true;
    }
  }

  private void countRejected(Work work) {
    LinkRuntime link = links.get(work.link());
    if (link != null) {
      link.rejected++;
      dirty = true;
    }
  }

  private SecurityLabel labelOf(LinkRuntime link) {
    SecurityLabel label = link.config.label();
    return label != null ? label : context.defaultLabel();
  }

  // ---------------------------------------------------------------- time, status, logging

  private void onTick() {
    tick++;
    for (LinkRuntime link : links.values()) {
      link.tick(tick);
      output.tick(link);
      // Only a link that sends is watched (owner, 2026-10-28, AF1 and AG1): an in link's reader keeps receiving, and a restart would
      // interrupt a working input. Its presence write is not watched.
      if (link.task != null && link.config.direction().sends() && link.writes.stalled(tick, config.writeStall().toSeconds())) {
        restartStalled(link);
      }
      if (!link.parked.isEmpty() && link.layerId == null && runnable(link.config) && tick >= link.layerRetryTick) {
        UUID layerId = ensureLayer(link);
        if (layerId != null) {
          unpark(link);
        }
      }
    }
    pump();
    if (dirty || tick % 5 == 0) {
      refreshStatus();
    }
  }

  private void refreshStatus() {
    dirty = false;
    Config c = config;
    boolean noLink = links.isEmpty();
    if (noLink && c.problems().isEmpty() && c.storedStreams().isEmpty()) {
      context.status().set(PluginState.OK, "no link configured");
      return;
    }
    // What an admin must act on comes first: the status is cut at 512 characters, and a link's part is 150 or more.
    var parts = new ArrayList<String>();
    boolean degraded = !c.problems().isEmpty() || !c.storedStreams().isEmpty();
    if (!c.storedStreams().isEmpty()) {
      parts.add(c.storedStreams().size() + " stored streams (" + Text.clean(String.join(", ", c.storedStreams())) + ") are no longer read: enter them as links");
    }
    for (int i = 0; i < Math.min(2, c.problems().size()); i++) {
      String problem = c.problems().get(i);
      parts.add("settings: " + (problem.length() > 120 ? problem.substring(0, 117) + "..." : problem));
    }
    if (c.problems().size() > 2) {
      parts.add((c.problems().size() - 2) + " more problems in the settings (see the log)");
    }
    if (noLink) {
      parts.add("no link configured");
    }
    for (LinkRuntime link : links.values()) {
      parts.add(link.summary(layerName(link)));
      LinkConfig lc = link.config;
      if (lc.enabled() && (lc.problem() != null || !link.connected)) {
        degraded = true;
      }
    }
    String detail = String.join("; ", parts);
    if (detail.length() > PluginStatus.MAX_DETAIL) {
      detail = detail.substring(0, PluginStatus.MAX_DETAIL - 3) + "...";
    }
    context.status().set(degraded ? PluginState.DEGRADED : PluginState.OK, detail);
  }

  /** The name of the layer the link's objects go into, once it is known to exist. */
  private @Nullable String layerName(LinkRuntime link) {
    UUID id = link.layerId;
    if (id == null) { // not yet made use of: the layer the next event would go into, if it exists
      LayerChoice target = link.config.target();
      id = target != null && target.id() != null && layers.containsKey(target.id()) ? target.id() : madeLayers.get(link.config.newLayerName());
    }
    Layer layer = id == null ? null : layers.get(id);
    return layer == null ? null : layer.content().name();
  }

  /** Logs a warning at most once a minute per link (and once a minute for the plugin as a whole). */
  private boolean warn(@Nullable LinkRuntime link, String message, Object... args) {
    PluginLog out = log;
    if (out == null) {
      return false;
    }
    if (link != null) {
      if (tick - link.lastWarnTick < WARN_EVERY_TICKS) {
        return false;
      }
      link.lastWarnTick = tick;
    } else {
      if (tick - lastGlobalWarnTick < WARN_EVERY_TICKS) {
        return false;
      }
      lastGlobalWarnTick = tick;
    }
    out.warn(message, args);
    return true;
  }

  /**
   * Logs why a task dropped an event (malformed or too large), at most once a minute per link, with
   * how many were dropped since the last warning. The text came from the peer: it is cleaned first.
   */
  private void noteDrops(LinkRuntime link, @Nullable String reason) {
    Counters c = link.reader();
    long drops = c.malformed() + c.tooLarge();
    if (reason == null || drops <= link.warnedDrops) {
      return;
    }
    long more = drops - link.warnedDrops - 1;
    if (warn(link, "link {}: dropped an event that {}{}", link.config.name(), Text.clean(reason),
        more > 0 ? " (" + more + " more dropped since the last warning)" : "")) {
      link.warnedDrops = drops;
    }
  }
}
