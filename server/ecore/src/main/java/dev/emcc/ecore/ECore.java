package dev.emcc.ecore;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.live.LiveGateway;
import dev.emcc.ecore.monitor.Allocation;
import dev.emcc.ecore.monitor.Monitor;
import dev.emcc.ecore.persistence.FileStore;
import dev.emcc.ecore.persistence.MemoryStore;
import dev.emcc.ecore.persistence.PersistMsg;
import dev.emcc.ecore.persistence.PersistenceWorker;
import dev.emcc.ecore.persistence.PictureStore;
import dev.emcc.ecore.plugin.PluginHost;
import dev.emcc.ecore.plugin.PluginStatuses;
import dev.emcc.ecore.runtime.Owner;
import dev.emcc.ecore.runtime.Overflow;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.RuntimeListener;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.ecore.store.ChangeOutcome;
import dev.emcc.ecore.persistence.ConfigStore;
import dev.emcc.ecore.persistence.Configuration;
import dev.emcc.ecore.persistence.PluginDocumentStore;
import dev.emcc.ecore.persistence.UserDocumentStore;
import dev.emcc.ecore.store.DataTypes;
import dev.emcc.ecore.store.DeclaredFields;
import dev.emcc.ecore.store.ObjectStore;
import dev.emcc.ecore.store.PictureState;
import dev.emcc.ecore.store.Requester;
import dev.emcc.ecore.store.StoreCounts;
import dev.emcc.ecore.store.StoreMsg;
import dev.emcc.ecore.store.Workspaces;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.LayerContent;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Collectors;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The core runtime. It is started once and stopped once.
 *
 * <p>It runs the worker runtime and message bus, the object store (the single writer of the live
 * picture), the persistence manager, the live picture gateway and the plugin host.
 */
public final class ECore implements AutoCloseable {

  /** Life cycle state. Moves only forward: {@code NEW -> RUNNING -> STOPPED}. */
  public enum State {
    NEW,
    RUNNING,
    STOPPED
  }

  /** Who ECore's own change requests come from, e.g. the seeded "Drawing" layer. */
  public static final Actor CORE = Actor.plugin("core");

  /** The name of the layer ECore creates when View has no layers (T-025; owner, 2026-10-30, BT and BX: was "Default"). */
  public static final String SEEDED_LAYER = "Drawing";

  static final String STORE_OWNER = "core-store";
  static final String PERSISTENCE_OWNER = "core-persistence";
  static final String EXPIRY_OWNER = "core-expiry";
  private static final Duration DRAIN_TIMEOUT = Duration.ofSeconds(10);
  private static final Logger LOG = LoggerFactory.getLogger(ECore.class);

  private final ECoreConfig config;
  private final ModelJson json = new ModelJson();
  private final PluginStatuses statuses = new PluginStatuses();
  private final DataTypes dataTypes = new DataTypes();
  private final DeclaredFields declaredFields = new DeclaredFields();
  private final Workspaces workspaces = new Workspaces();
  private final AtomicReference<State> state = new AtomicReference<>(State.NEW);
  private volatile @Nullable Running running;

  /** What exists while ECore runs. */
  private record Running(
      WorkerRuntime runtime, PictureStore pictureStore, PictureState picture, WorkerHandle<StoreMsg> objectStore,
      WorkerHandle<PersistMsg> persistence, LiveGateway live, PluginHost plugins, Monitor monitor, UserDocuments userDocuments,
      InstallationLook look, DisplaySettings display, Labeling labeling) {}

  public ECore() {
    this(ECoreConfig.defaults());
  }

  public ECore(RuntimeConfig runtimeConfig) {
    this(ECoreConfig.defaults().runtime(runtimeConfig));
  }

  public ECore(ECoreConfig config) {
    this.config = Objects.requireNonNull(config, "config");
  }

  /**
   * Starts ECore: loads the live picture, starts the object store and the persistence manager,
   * creates the "Drawing" layer if View has no layers, then starts the plugins.
   *
   * @throws IllegalStateException if ECore has already been started or stopped, the stored picture
   *     cannot be loaded, or a required plugin does not start
   */
  public void start() {
    if (!state.compareAndSet(State.NEW, State.RUNNING)) {
      throw new IllegalStateException("ECore can only be started once; state is " + state.get());
    }
    WorkerRuntime runtime = WorkerRuntime.start(
        config.runtime().listener(RuntimeListener.all(List.of(config.runtime().listener(), statuses))));
    PictureStore pictureStore = null;
    try {
      pictureStore = config.dataDirectory() == null ? new MemoryStore() : new FileStore(config.dataDirectory(), json);
      PictureStore.Stored stored = pictureStore.load();
      PictureState picture = PictureState.of(stored.snapshot());
      stored.journal().forEach(picture::apply);
      Instant startedAt = config.clock().instant();
      StoreCounts storeCounts = new StoreCounts();
      Set<String> storedDataTypes = picture.snapshot().objects().stream()
          .map(o -> o.content().dataType()).collect(Collectors.toCollection(TreeSet::new));

      Owner storeOwner = runtime.owner(STORE_OWNER);
      WorkerHandle<StoreMsg> objectStore = storeOwner.spawn(
          WorkerOptions.<StoreMsg>of("object-store", () -> new ObjectStore(picture, runtime, config.clock(), dataTypes, declaredFields, workspaces,
              storeCounts))
              .mailbox(10_000, Overflow.DROP_NEWEST));

      Owner persistenceOwner = runtime.owner(PERSISTENCE_OWNER);
      PictureStore files = pictureStore;
      long sequenceNo = picture.sequenceNo();
      int journalLength = stored.journal().size();
      WorkerHandle<PersistMsg> persistence = persistenceOwner.spawn(
          WorkerOptions.<PersistMsg>of("persistence",
                  () -> new PersistenceWorker(files, objectStore, sequenceNo, journalLength, config.compactEvery()))
              .mailbox(100_000, Overflow.DROP_NEWEST)
              .budget(WorkerOptions.MAX_BUDGET));
      persistenceOwner.subscribe(ObjectStore.CHANGES, persistence, c -> new PersistMsg.Changed(c.event(), c.notSaved()));
      persistenceOwner.every(PersistenceWorker.FLUSH_INTERVAL, persistence, PersistMsg.Flush.TICK);

      LOG.info("ECore started: {} layers, {} objects, sequence {}", picture.layerCount(), picture.objectCount(), sequenceNo);
      // Owner, 2026-10-27 (E): View's layers only; other workspaces' layers do not keep View from its "Drawing".
      if (picture.layers().stream().noneMatch(l -> Workspaces.ofLayer(l.content().workspace()).equals(Workspaces.VIEW))) {
        seedViewLayer(objectStore);
      }

      LiveGateway live = new LiveGateway(
          runtime, objectStore, json, config.clock(), config.liveSessions(), config.liveMaxBudget(), workspaces);

      Path pluginsDirectory = config.pluginsDirectory();
      Configuration configuration = new Configuration(new ConfigStore(config.dataDirectory(), json));
      PluginHost plugins = new PluginHost(pluginsDirectory == null ? Path.of("") : pluginsDirectory, runtime, statuses,
          config.defaultLabel(), json, config.pluginLimits(), new PluginHost.Services(
              objectStore, new PluginDocumentStore(config.dataDirectory(), json), dataTypes, configuration, config.listeners(),
              config.classificationOrders(), config.maxChannelsPerPlugin(), declaredFields, workspaces, config.streams(), config.conversions(),
              config.computeCap()));
      Monitor monitor = new Monitor(runtime, plugins, live, storeCounts, config.clock(), startedAt, () -> state.get().name(),
          config.allocationSampling() ? Allocation.sampling() : Allocation.totalOnly());
      UserDocuments userDocuments = new UserDocuments(runtime, new UserDocumentStore(config.dataDirectory(), json), id -> plugins.plugins().stream()
          .anyMatch(p -> p.id().equals(id) && p.active() && p.manifest() != null && p.manifest().web() != null));
      running = new Running(runtime, pictureStore, picture, objectStore, persistence, live, plugins, monitor, userDocuments,
          new InstallationLook(configuration), new DisplaySettings(userDocuments, configuration, live, json),
          new Labeling(configuration, live, json));
      if (pluginsDirectory != null) {
        plugins.start();
      }
      // Browsers get the data types and every plugin's settings after welcome, and each settings change.
      live.atWelcome(plugins::liveNotices);
      live.sessionTimes(plugins.userTimes()); // SDK 1.4.0: each session's time to the temporal plugins (ADR-0045)
      // The message is made when the hub sends it, from the settings current then (not from values).
      plugins.settings().onChange((id, values) -> live.broadcast(() -> plugins.settingsMessage(id, plugins.settings().current(id))));
      plugins.onBehaviourChange(() -> live.broadcast(plugins::dataTypesMessage));
      Owner expiryOwner = runtime.owner(EXPIRY_OWNER);
      WorkerHandle<ExpiryWorker.Msg> expiry = expiryOwner.spawn(
          WorkerOptions.<ExpiryWorker.Msg>of("expiry", () -> new ExpiryWorker(objectStore, plugins::behaviours)));
      expiryOwner.every(ExpiryWorker.INTERVAL, expiry, ExpiryWorker.Tick.TICK);
      // Data model rule 14: stored objects keep a data type no plugin declares, with the default behaviour.
      storedDataTypes.stream().filter(t -> !dataTypes.isAvailable(t)).forEach(t -> LOG.warn(
          "Stored objects have the data type {}, which no loaded plugin declares; they keep it and get the default behaviour", t));
    } catch (RuntimeException | Error e) {
      Running r = running;
      if (r != null) {
        shutdown(r); // e.g. a required plugin failed: store what is there, like a clean stop
      } else {
        runtime.close();
        if (pictureStore != null) {
          pictureStore.close();
        }
      }
      state.set(State.STOPPED);
      throw e;
    }
  }

  /**
   * T-025: View without layers gets a layer named "Drawing" (owner, 2026-10-30, BT and BX; it was
   * "Default") with the configured default label; owner, 2026-10-27 (E): also when other workspaces
   * have layers. ECore never creates a layer in a declared workspace; the simulator seeds its own
   * "Simulation" in its workspace (BX).
   */
  private void seedViewLayer(WorkerHandle<StoreMsg> objectStore) {
    LayerContent content = new LayerContent(SEEDED_LAYER, 0, true, config.defaultLabel(), Extensions.empty());
    ChangeRequest request = ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), content, CORE);
    FutureReply<ChangeOutcome> reply = new FutureReply<>();
    objectStore.send(new StoreMsg.Apply(request, Requester.NO_USER, reply)); // ECore's own: not checked
    ChangeOutcome outcome = reply.await(DRAIN_TIMEOUT);
    if (outcome instanceof ChangeOutcome.Applied) {
      LOG.info("Created the layer \"{}\" (View had no layers)", SEEDED_LAYER);
    } else {
      LOG.error("Could not create the layer \"{}\": {}", SEEDED_LAYER, outcome);
    }
  }

  /**
   * Stops ECore: first the plugins (in reverse start order), then the object store (no more
   * changes), then the persistence manager writes what it has received, then everything else stops.
   * Calling it again, or before {@link #start()}, has no further effect.
   */
  public void stop() {
    if (state.getAndSet(State.STOPPED) != State.RUNNING) {
      return;
    }
    Running r = running;
    if (r != null) {
      shutdown(r);
    }
    LOG.info("ECore stopped");
  }

  /** Stops what runs: plugins, browser sessions, the object store, then persistence writes everything. */
  private void shutdown(Running r) {
    r.plugins().stop();
    r.runtime().owner(LiveGateway.OWNER).stop();
    r.runtime().owner(EXPIRY_OWNER).stop();
    r.runtime().owner(STORE_OWNER).stop();
    FutureReply<Long> drained = new FutureReply<>();
    if (r.runtime().deliverAlways(r.persistence(), () -> new PersistMsg.Drain(drained))) {
      Long last = drained.await(DRAIN_TIMEOUT);
      // The store's worker has ended (its stop joins the thread), so its state can be read here.
      long applied = r.picture().sequenceNo();
      if (last == null) {
        LOG.warn("The persistence manager did not confirm within {}; the last changes may be lost", DRAIN_TIMEOUT);
      } else if (last < applied) {
        LOG.error("Live picture accounted for only up to sequence {}, but the store applied up to {}: "
            + "change events {} to {} were not stored and are lost", last, applied, last + 1, applied);
      } else {
        // Accounted for: every saved change is written; updates marked not saved (ADR-0041) are not.
        LOG.info("Live picture accounted for up to sequence {}", last);
      }
    }
    r.runtime().close();
    r.pictureStore().close();
    r.monitor().close();
  }

  public State state() {
    return state.get();
  }

  /**
   * The worker runtime and message bus.
   *
   * @throws IllegalStateException if ECore is not running
   */
  public WorkerRuntime runtime() {
    return running().runtime();
  }

  /**
   * The object store, the single writer of the live picture. Send it {@link StoreMsg}s with an ask;
   * change events are published on {@link ObjectStore#CHANGES}.
   *
   * @throws IllegalStateException if ECore is not running
   */
  public WorkerHandle<StoreMsg> objectStore() {
    return running().objectStore();
  }

  /**
   * The live picture gateway: the edge opens a session per browser WebSocket.
   *
   * @throws IllegalStateException if ECore is not running
   */
  public LiveGateway live() {
    return running().live();
  }

  /**
   * The plugin host: the plugins found at start, their status, and their HTTP endpoints.
   *
   * @throws IllegalStateException if ECore is not running
   */
  public PluginHost plugins() {
    return running().plugins();
  }

  /**
   * The live health of the core and the plugins, for the monitor view. Its snapshots name hosts and
   * ports: the edge shows them to {@code settings.admin} only.
   *
   * @throws IllegalStateException if ECore is not running
   */
  public Monitor monitor() {
    return running().monitor();
  }

  /**
   * Each user's own documents (ADR-0027), for the edge.
   *
   * @throws IllegalStateException if ECore is not running
   */
  public UserDocuments userDocuments() {
    return running().userDocuments();
  }

  /**
   * The installation's default look (ADR-0034), for the edge.
   *
   * @throws IllegalStateException if ECore is not running
   */
  public InstallationLook look() {
    return running().look();
  }

  /**
   * Each user's display settings and the admin's defaults (SDK 1.4.0 part 5, ADR-0046), for the edge.
   *
   * @throws IllegalStateException if ECore is not running
   */
  public DisplaySettings display() {
    return running().display();
  }

  /**
   * The premade security labels of Settings › Labeling (T-170), for the edge.
   *
   * @throws IllegalStateException if ECore is not running
   */
  public Labeling labeling() {
    return running().labeling();
  }

  /** The status of every plugin, also while ECore is not running. */
  public PluginStatuses pluginStatuses() {
    return statuses;
  }

  /** The JSON codec of the model types, shared by everyone in the server. */
  public ModelJson json() {
    return json;
  }

  public ECoreConfig config() {
    return config;
  }

  private Running running() {
    Running r = running;
    if (state.get() != State.RUNNING || r == null) {
      throw new IllegalStateException("ECore is not running; state is " + state.get());
    }
    return r;
  }

  @Override
  public void close() {
    stop();
  }
}
