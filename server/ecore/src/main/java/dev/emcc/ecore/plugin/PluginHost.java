package dev.emcc.ecore.plugin;

import dev.emcc.ecore.json.InvalidDocumentException;
import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.json.Problem;
import dev.emcc.ecore.persistence.ConfigStore;
import dev.emcc.ecore.persistence.Configuration;
import dev.emcc.ecore.persistence.PluginDocumentStore;
import dev.emcc.ecore.runtime.HandlerContext;
import dev.emcc.ecore.runtime.MessageHandler;
import dev.emcc.ecore.runtime.Overflow;
import dev.emcc.ecore.runtime.OwnerLimits;
import dev.emcc.ecore.runtime.ReplyHandle;
import dev.emcc.ecore.runtime.SendOutcome;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.ecore.store.DataTypes;
import dev.emcc.ecore.store.DeclaredFields;
import dev.emcc.ecore.store.StoreMsg;
import dev.emcc.ecore.store.Workspaces;
import dev.emcc.sdk.Classifications;
import dev.emcc.sdk.DataType;
import dev.emcc.sdk.DeclaredField;
import dev.emcc.sdk.FieldSet;
import dev.emcc.sdk.Permissions;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.PluginStatus;
import dev.emcc.sdk.RelationKind;
import dev.emcc.sdk.User;
import dev.emcc.sdk.Workspace;
import dev.emcc.sdk.capability.Capability;
import dev.emcc.sdk.capability.Temporal;
import dev.emcc.sdk.channel.Channels;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.SecurityLabel;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.lang.reflect.InvocationTargetException;
import java.net.http.HttpClient;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Predicate;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

/**
 * The plugin host (overview 4.1). At start it reads every {@code plugins/<id>/plugin.json}, skips
 * folders whose names start with {@code _} (the plugin template) or {@code .}, validates the
 * manifests (schema, folder name equals id, SDK version, dependencies, no cycles), orders them, and
 * starts each plugin with a server part: its own class loader, the entry class, {@code init} and
 * {@code start}. Web-only plugins need nothing on the server; they are listed for the shell.
 *
 * <p>SDK v1 checks, before any plugin runs: each declared data type's id starts with the plugin's
 * id and a dot, once per manifest (so no id comes from two plugins); the settings schema compiles without referring outside itself, and the defaults match
 * it; each {@code network} pointer leads to host-and-port settings. Then the available data types
 * are fixed ({@link DataTypes}) and the plugins' current settings registered ({@link
 * PluginSettings}).
 *
 * <p>A plugin that fails to start, and every plugin that depends on it, is disabled and reported
 * (status {@code FAILED} with the reason); the others continue. If a required plugin fails, {@link
 * #start()} throws and the application does not start. Plugins are never loaded or unloaded while
 * ECore runs.
 *
 * <p>{@code init}, {@code start} and {@code stop} run in a lifecycle worker per plugin, under a
 * budget of {@value #BUDGET_SECONDS} s each, with the plugin's class loader as the context class
 * loader. A call over the budget counts as a failure; the stuck call is reported by the watchdog.
 */
public final class PluginHost {

  static final int BUDGET_SECONDS = 5;
  /** The budget of {@code init}, {@code start} and {@code stop} (SDK v0 design, "Life cycle"). */
  public static final Duration BUDGET = Duration.ofSeconds(BUDGET_SECONDS);

  /** The default caps of a plugin (CR-0005): 10 000 outstanding asks, 1 000 active timers. */
  public static final OwnerLimits DEFAULT_LIMITS = new OwnerLimits(10_000, 1_000);

  private static final Logger LOG = LoggerFactory.getLogger(PluginHost.class);

  /**
   * One plugin folder, as {@link #plugins()} reports it.
   *
   * @param id the plugin id (the folder name if the manifest could not be read)
   * @param manifest the manifest, or {@code null} if it is missing or invalid
   * @param active whether the plugin runs (for a web-only plugin: whether the shell may load it)
   * @param status the effective status; {@code FAILED} with the reason for a disabled plugin
   */
  public record PluginInfo(String id, Path directory, @Nullable PluginManifest manifest, boolean active, PluginStatus status) {}

  /**
   * What ECore offers plugins beyond the runtime (SDK v1).
   *
   * @param objectStore the object store's worker, for {@code store()}; null where there is none (tests)
   * @param documents the plugins' documents
   * @param dataTypes fixed by {@link #start()} with the data types the plugins declare
   * @param configuration where the plugins' configured settings are kept
   * @param listeners the cap on listeners and the TLS credentials
   * @param classificationOrders each policy's classifications, lowest first, for {@code classifications()} (SDK 1.2.0)
   * @param maxChannelsPerPlugin the most output channels one plugin offers (SDK 1.2.0, {@code emc2.channels.max-per-plugin})
   * @param declaredFields fixed by {@link #start()} with the fields the plugins declare (SDK 1.2.0), for the object store
   * @param workspaces fixed by {@link #start()} with the workspaces the plugins declare (SDK 1.2.0, ADR-0039), for the
   *     object store and the live picture
   * @param streams the stream channel's limits (SDK 1.8.0, CR-0044 E1; {@code emc2.streams.*})
   * @param conversions the conversion service's settings (SDK 1.8.0, CR-0044 E2, T-211; {@code emc2.conversions.*})
   * @param computeCap the most compute tasks of all plugins together (SDK 1.9.0, ADR-0064; {@code emc2.compute.max-threads})
   */
  public record Services(@Nullable WorkerHandle<StoreMsg> objectStore, PluginDocumentStore documents, DataTypes dataTypes,
      Configuration configuration, ListenerConfig listeners, Map<String, List<String>> classificationOrders, int maxChannelsPerPlugin,
      DeclaredFields declaredFields, Workspaces workspaces, StreamLimits streams, ConversionLimits conversions, int computeCap) {

    public Services {
      if (computeCap < 1) {
        throw new IllegalArgumentException("computeCap must be at least 1: " + computeCap);
      }
      Objects.requireNonNull(streams, "streams");
      Objects.requireNonNull(conversions, "conversions");
      Objects.requireNonNull(classificationOrders, "classificationOrders");
      Objects.requireNonNull(declaredFields, "declaredFields");
      Objects.requireNonNull(workspaces, "workspaces");
      if (maxChannelsPerPlugin < 1) {
        throw new IllegalArgumentException("maxChannelsPerPlugin must be at least 1: " + maxChannelsPerPlugin);
      }
    }

    /** With the default compute cap: the cores minus one. */
    public Services(@Nullable WorkerHandle<StoreMsg> objectStore, PluginDocumentStore documents, DataTypes dataTypes,
        Configuration configuration, ListenerConfig listeners, Map<String, List<String>> classificationOrders, int maxChannelsPerPlugin,
        DeclaredFields declaredFields, Workspaces workspaces, StreamLimits streams, ConversionLimits conversions) {
      this(objectStore, documents, dataTypes, configuration, listeners, classificationOrders, maxChannelsPerPlugin, declaredFields,
          workspaces, streams, conversions, ComputeHub.defaultCap());
    }

    /** With the default conversion settings. */
    public Services(@Nullable WorkerHandle<StoreMsg> objectStore, PluginDocumentStore documents, DataTypes dataTypes,
        Configuration configuration, ListenerConfig listeners, Map<String, List<String>> classificationOrders, int maxChannelsPerPlugin,
        DeclaredFields declaredFields, Workspaces workspaces, StreamLimits streams) {
      this(objectStore, documents, dataTypes, configuration, listeners, classificationOrders, maxChannelsPerPlugin, declaredFields,
          workspaces, streams, ConversionLimits.DEFAULT);
    }

    /** With the default stream limits. */
    public Services(@Nullable WorkerHandle<StoreMsg> objectStore, PluginDocumentStore documents, DataTypes dataTypes,
        Configuration configuration, ListenerConfig listeners, Map<String, List<String>> classificationOrders, int maxChannelsPerPlugin,
        DeclaredFields declaredFields, Workspaces workspaces) {
      this(objectStore, documents, dataTypes, configuration, listeners, classificationOrders, maxChannelsPerPlugin, declaredFields,
          workspaces, StreamLimits.DEFAULT);
    }

    /** With workspaces of their own, which no object store reads. */
    public Services(@Nullable WorkerHandle<StoreMsg> objectStore, PluginDocumentStore documents, DataTypes dataTypes,
        Configuration configuration, ListenerConfig listeners, Map<String, List<String>> classificationOrders, int maxChannelsPerPlugin,
        DeclaredFields declaredFields) {
      this(objectStore, documents, dataTypes, configuration, listeners, classificationOrders, maxChannelsPerPlugin, declaredFields,
          new Workspaces());
    }

    /** With declared fields of their own, which no object store reads. */
    public Services(@Nullable WorkerHandle<StoreMsg> objectStore, PluginDocumentStore documents, DataTypes dataTypes,
        Configuration configuration, ListenerConfig listeners, Map<String, List<String>> classificationOrders, int maxChannelsPerPlugin) {
      this(objectStore, documents, dataTypes, configuration, listeners, classificationOrders, maxChannelsPerPlugin, new DeclaredFields());
    }

    /** With NATO's order of classifications and the default cap on channels. */
    public Services(@Nullable WorkerHandle<StoreMsg> objectStore, PluginDocumentStore documents, DataTypes dataTypes,
        Configuration configuration, ListenerConfig listeners) {
      this(objectStore, documents, dataTypes, configuration, listeners, DEFAULT_CLASSIFICATION_ORDERS, DEFAULT_MAX_CHANNELS);
    }

    /** No object store; documents, data types and settings in memory; default listener settings. */
    public static Services inMemory(ModelJson json) {
      return new Services(null, new PluginDocumentStore(null, json), new DataTypes(), new Configuration(new ConfigStore(null, json)),
          ListenerConfig.DEFAULT);
    }
  }

  /** NATO's order of classifications, the default (SDK 1.2.0 {@code classifications()}). */
  public static final Map<String, List<String>> DEFAULT_CLASSIFICATION_ORDERS = Map.of("NATO", Classifications.NATO);

  /** The most output channels one plugin offers by default (SDK 1.2.0). */
  public static final int DEFAULT_MAX_CHANNELS = Channels.MAX_OFFERED;

  private final Path directory;
  private final WorkerRuntime runtime;
  private final PluginStatuses statuses;
  private final UserTimes userTimes;
  private final SecurityLabel defaultLabel;
  private final ModelJson json;
  private final PluginEndpoints endpoints;
  private final Duration budget;
  private final OwnerLimits limits;
  private final List<Entry> entries = new CopyOnWriteArrayList<>();
  private final List<Entry> running = new ArrayList<>(); // start order; touched by start() and stop() only
  private final DataTypes dataTypeIds;
  private final PluginSettings settings;
  private final @Nullable WorkerHandle<StoreMsg> objectStore;
  private final @Nullable StoreFeed feed;
  private final WorkerHandle<PluginDocuments.Call> documents;
  private final ListenerConfig listenerConfig;
  private final Classifications classifications;
  private final int maxChannelsPerPlugin;
  /** Every plugin's output channels (SDK 1.2.0): one registry, shared by the plugins. */
  private final ChannelRegistry channels;
  /** Every plugin's streams to its web part (SDK 1.8.0, CR-0044 E1): one hub, shared by the plugins, served by the edge. */
  private final StreamHub streams;
  /** ECore's conversion service (SDK 1.8.0, CR-0044 E2, T-211): one for all plugins; it feeds their streams. */
  private final ConversionHub conversions;
  /** SDK 1.9.0 (ADR-0064 point 4): the cap on all plugins' compute tasks. */
  private final ComputeHub computeHub;
  private final Configuration configuration;
  private final List<Runnable> behaviourListeners = new CopyOnWriteArrayList<>();
  private final Map<String, SettingsSchema> schemas = new HashMap<>(); // touched by start() only
  private volatile List<DataType> dataTypes = List.of(DataType.general());
  /** SDK 1.7.0 (CR-0042): each data type's {@code fadeSetting} as declared; the SDK's {@code DataType} has none. */
  private volatile Map<String, String> fadeSettings = Map.of();
  private final DeclaredFields declaredFieldChecks;
  private volatile List<DeclaredField> declaredFields = List.of();
  private final Workspaces workspaceRules;
  private volatile List<Workspace> workspaces = List.of(Workspace.view());
  private volatile List<FieldSet> fieldSets = List.of();
  private volatile List<RelationKind> relationKinds = List.of();
  private @Nullable HttpClient client;

  /** One plugin folder and, while it runs, what belongs to it. */
  private static final class Entry {
    final String id;
    final Path directory;
    final @Nullable PluginManifest manifest;
    volatile boolean active;
    @Nullable PluginClassLoader loader;
    @Nullable PluginContextImpl context;
    @Nullable WorkerHandle<Call> lifecycle;
    volatile @Nullable PluginListeners listeners; // read by the monitor's thread
    /** Its connection tasks (ADR-0036); the SDK's {@code Connections} goes over it with SDK 1.2.0 part 2. */
    volatile @Nullable TaskEngine tasks; // read by the monitor's thread
    /** C7 gap 6: the last start's tasks that have not ended, by name, until the next start takes them over (not the engines). */
    @Nullable Map<String, TaskEngine.Task> lastTasks;
    @Nullable Map<String, TaskEngine.Task> lastComputes;
    /** Its output channels and watches (SDK 1.2.0); released when it stops. */
    @Nullable PluginChannels channels;
    /** SDK 1.8.0: its streams (CR-0044 E1); released when it stops. */
    @Nullable PluginStreams streams;
    /** SDK 1.8.0: its conversions (CR-0044 E2, T-211); stopped when it stops. */
    ConversionHub.@Nullable Member conversions;
    /** SDK 1.9.0: its compute tasks (ADR-0064); stopped when it stops. */
    volatile @Nullable PluginComputes computes; // read by the monitor's thread
    /** SDK 1.4.0: its local folders (ADR-0049 point 4), while it runs. */
    volatile @Nullable PluginLocalFolders folders; // read by the monitor's thread
    final AtomicReference<@Nullable Plugin> plugin = new AtomicReference<>();
    /** SDK 1.4.0: the capabilities its server part's class implements, found at load (ADR-0044). */
    volatile Set<Capability> serverCapabilities = Set.of();
    /** SDK 1.4.0: the fault of its declaration as a browser last judged it with the web part, or null (owner, 2026-11-06). */
    volatile @Nullable CapabilityFault capabilityFault;

    Entry(String id, Path directory, @Nullable PluginManifest manifest) {
      this.id = id;
      this.directory = directory;
      this.manifest = manifest;
    }
  }

  /** A step of a plugin's life cycle, run in its lifecycle worker. */
  @FunctionalInterface
  private interface Step {
    void run() throws Exception;
  }

  private record Call(Step step, ClassLoader loader, ReplyHandle<Done> replyTo) {}

  /** The outcome of a step: {@code error} is null on success. */
  private record Done(@Nullable Throwable error) {}

  /**
   * @param directory the installed plugins ({@code plugins/<id>/...}); may be missing (no plugins)
   * @param statuses the status board, also the runtime's listener for plugin workers
   * @param limits every plugin's caps on outstanding asks and active timers (CR-0005)
   */
  public PluginHost(Path directory, WorkerRuntime runtime, PluginStatuses statuses, SecurityLabel defaultLabel,
      ModelJson json, OwnerLimits limits) {
    this(directory, runtime, statuses, defaultLabel, json, limits, Services.inMemory(json));
  }

  /** With ECore's services for plugins (SDK v1). */
  public PluginHost(Path directory, WorkerRuntime runtime, PluginStatuses statuses, SecurityLabel defaultLabel,
      ModelJson json, OwnerLimits limits, Services services) {
    this(directory, runtime, statuses, defaultLabel, json, limits, BUDGET, services);
  }

  /** With another budget for the life cycle steps (tests). */
  PluginHost(Path directory, WorkerRuntime runtime, PluginStatuses statuses, SecurityLabel defaultLabel, ModelJson json,
      OwnerLimits limits, Duration budget) {
    this(directory, runtime, statuses, defaultLabel, json, limits, budget, Services.inMemory(json));
  }

  /** With another budget and the services to use (tests). */
  PluginHost(Path directory, WorkerRuntime runtime, PluginStatuses statuses, SecurityLabel defaultLabel, ModelJson json,
      OwnerLimits limits, Duration budget, Services services) {
    this.dataTypeIds = services.dataTypes();
    this.declaredFieldChecks = services.declaredFields();
    this.workspaceRules = services.workspaces();
    this.settings = new PluginSettings(runtime, services.configuration(), json);
    this.objectStore = services.objectStore();
    this.feed = objectStore == null ? null : new StoreFeed(runtime, objectStore);
    this.documents = PluginDocuments.startWorker(runtime, services.documents());
    this.listenerConfig = services.listeners();
    this.classifications = new Classifications(services.classificationOrders()); // throws if an order is not one
    this.maxChannelsPerPlugin = services.maxChannelsPerPlugin();
    this.channels = new ChannelRegistry(runtime);
    this.streams = new StreamHub(runtime, services.streams());
    this.conversions = new ConversionHub(runtime, services.conversions());
    this.computeHub = new ComputeHub(services.computeCap());
    this.configuration = services.configuration();
    this.budget = budget;
    this.limits = Objects.requireNonNull(limits, "limits");
    this.directory = directory.toAbsolutePath().normalize();
    this.runtime = runtime;
    this.statuses = statuses;
    this.defaultLabel = defaultLabel;
    this.json = json;
    this.endpoints = new PluginEndpoints(runtime, json);
    this.userTimes = new UserTimes(statuses);
    this.endpoints.userTimes(userTimes);
  }

  /**
   * The browser sessions' times and the temporal plugins that get them (SDK 1.4.0, ADR-0045): the
   * live picture tells it each session's start, change and end.
   */
  public UserTimes userTimes() {
    return userTimes;
  }

  /** The plugins' HTTP endpoints, for the edge. */
  public PluginEndpoints endpoints() {
    return endpoints;
  }

  /** The plugins' current settings, and changing them (the edge's settings endpoint). */
  public PluginSettings settings() {
    return settings;
  }

  /**
   * Each available data type's effective behaviour (ADR-0023 point 7): the configured one, else the
   * declaring manifest's defaults.
   */
  public Map<String, ConfigStore.Behaviour> behaviours() {
    Map<String, ConfigStore.Behaviour> configured = configuration.current().dataTypes();
    Map<String, ConfigStore.Behaviour> all = new LinkedHashMap<>();
    for (DataType t : dataTypes) {
      ConfigStore.Behaviour b = configured.get(t.id());
      all.put(t.id(), b != null ? b : new ConfigStore.Behaviour(
          t.defaults().expiresAfterSeconds(), t.defaults().fadeWhenExpired(), t.defaults().removeAfterExpirySeconds()));
    }
    return all;
  }

  /** The result of {@link #changeBehaviour}. */
  public sealed interface BehaviourChange {
    /** Stored, and told to every browser ({@code data-types}). */
    record Applied(ConfigStore.Behaviour behaviour) implements BehaviourChange {}

    /** Not a valid behaviour: each problem with its JSON pointer. */
    record Refused(List<Problem> problems) implements BehaviourChange {}

    record Forbidden(String reason) implements BehaviourChange {}

    record NotFound(String dataType) implements BehaviourChange {}
  }

  /**
   * Changes a data type's behaviour for {@code user} (the settings view per data type; ADR-0023
   * point 7, data model rule 15): needs {@code settings.admin}, and an object with {@code
   * fadeWhenExpired} (true or false) and optionally {@code expiresAfterSeconds} (at least 1) and
   * {@code removeAfterExpirySeconds} (at least 0), nothing else. The complete behaviour replaces the
   * configured one; the expiry worker and every browser follow it.
   */
  public BehaviourChange changeBehaviour(String dataType, JsonObject values, User user) {
    Objects.requireNonNull(values, "values");
    if (dataTypes.stream().noneMatch(t -> t.id().equals(dataType))) {
      return new BehaviourChange.NotFound(dataType);
    }
    if (!user.has(Permissions.SETTINGS_ADMIN)) {
      return new BehaviourChange.Forbidden("changing a data type's behaviour needs " + Permissions.SETTINGS_ADMIN);
    }
    List<Problem> problems = new ArrayList<>();
    for (String name : values.names()) {
      if (!Set.of("expiresAfterSeconds", "fadeWhenExpired", "removeAfterExpirySeconds").contains(name)) {
        problems.add(new Problem("/" + name, "not a field of a data type's behaviour"));
      }
    }
    Long expires = seconds(values, "expiresAfterSeconds", 1, problems);
    Long remove = seconds(values, "removeAfterExpirySeconds", 0, problems);
    if (!(values.get("fadeWhenExpired") instanceof JsonBoolean fade)) {
      problems.add(new Problem("/fadeWhenExpired", "true or false is required"));
      return new BehaviourChange.Refused(problems);
    }
    if (!problems.isEmpty()) {
      return new BehaviourChange.Refused(problems);
    }
    ConfigStore.Behaviour behaviour = new ConfigStore.Behaviour(expires, fade.value(), remove);
    configuration.change(c -> c.withBehaviour(dataType, behaviour), stored -> {});
    LOG.info("User {} changed the behaviour of data type {}: {}", user.id(), dataType, behaviour);
    behaviourListeners.forEach(Runnable::run);
    return new BehaviourChange.Applied(behaviour);
  }

  /**
   * Removes the configured behaviour of {@code dataType} for {@code user}, so that the declaring
   * manifest's defaults apply again (the settings view's "Use defaults"): needs {@code
   * settings.admin}. The expiry worker and every browser follow it, as after a change.
   */
  public BehaviourChange resetBehaviour(String dataType, User user) {
    DataType type = dataTypes.stream().filter(t -> t.id().equals(dataType)).findFirst().orElse(null);
    if (type == null) {
      return new BehaviourChange.NotFound(dataType);
    }
    if (!user.has(Permissions.SETTINGS_ADMIN)) {
      return new BehaviourChange.Forbidden("changing a data type's behaviour needs " + Permissions.SETTINGS_ADMIN);
    }
    configuration.change(c -> c.withoutBehaviour(dataType), stored -> {});
    LOG.info("User {} set the behaviour of data type {} back to its defaults", user.id(), dataType);
    behaviourListeners.forEach(Runnable::run);
    DataType.Defaults d = type.defaults();
    return new BehaviourChange.Applied(new ConfigStore.Behaviour(d.expiresAfterSeconds(), d.fadeWhenExpired(), d.removeAfterExpirySeconds()));
  }

  private static @Nullable Long seconds(JsonObject values, String name, long least, List<Problem> problems) {
    JsonValue value = values.get(name);
    if (value == null) {
      return null;
    }
    try {
      if (value instanceof JsonNumber number && number.longValueExact() >= least) {
        return number.longValueExact();
      }
    } catch (ArithmeticException e) {
      // not a whole number
    }
    problems.add(new Problem("/" + name, "a whole number of seconds, at least " + least));
    return null;
  }

  /** ECore's own parts that follow every change of a data type's behaviour (e.g. to tell browsers); called on the changer's thread. */
  public void onBehaviourChange(Runnable listener) {
    behaviourListeners.add(Objects.requireNonNull(listener, "listener"));
  }

  /**
   * The data types as browsers get them (web SDK {@code DataType}): {@code id}, {@code name},
   * {@code description}, {@code declaredBy} (null for {@code core.general}), from SDK 1.5.0 {@code
   * fieldSets} (full ids, {@code []} for none) and {@code manual}, from SDK 1.7.0 {@code fadeSetting}
   * where declared, the manifest's {@code defaults} and the effective {@code behaviour}; {@code
   * core.general} first.
   */
  public ArrayNode dataTypesJson() {
    Map<String, ConfigStore.Behaviour> effective = behaviours();
    ArrayNode all = JsonNodeFactory.instance.arrayNode();
    for (DataType t : dataTypes) {
      ObjectNode n = all.addObject();
      n.put("id", t.id());
      n.put("name", t.name());
      if (t.description() != null) {
        n.put("description", t.description());
      }
      n.put("declaredBy", t.declaredBy());
      ArrayNode sets = n.putArray("fieldSets"); // SDK 1.5.0 (CR-0038): full ids, [] for none
      t.fieldSets().forEach(sets::add);
      n.put("manual", t.manual());
      n.put("sensorReport", t.sensorReport()); // SDK 1.5.0 part 3 (CR-0039 point 6)
      String fade = fadeSettings.get(t.id());
      if (fade != null) {
        n.put("fadeSetting", fade); // SDK 1.7.0 (CR-0042): the shell resolves it
      }
      n.set("defaults", behaviourJson(t.defaults().expiresAfterSeconds(), t.defaults().fadeWhenExpired(),
          t.defaults().removeAfterExpirySeconds()));
      ConfigStore.Behaviour b = effective.get(t.id());
      n.set("behaviour", b == null ? n.get("defaults") : behaviourJson(b.expiresAfterSeconds(), b.fadeWhenExpired(), b.removeAfterExpirySeconds()));
    }
    return all;
  }

  private static ObjectNode behaviourJson(@Nullable Long expiresAfterSeconds, boolean fadeWhenExpired, @Nullable Long removeAfterExpirySeconds) {
    ObjectNode n = JsonNodeFactory.instance.objectNode();
    if (expiresAfterSeconds != null) {
      n.put("expiresAfterSeconds", expiresAfterSeconds);
    }
    n.put("fadeWhenExpired", fadeWhenExpired);
    if (removeAfterExpirySeconds != null) {
      n.put("removeAfterExpirySeconds", removeAfterExpirySeconds);
    }
    return n;
  }

  /** The live picture message with every data type (server/live-picture-protocol.md, {@code data-types}). */
  public String dataTypesMessage() {
    ObjectNode m = JsonNodeFactory.instance.objectNode();
    m.put("type", "data-types");
    m.set("dataTypes", dataTypesJson());
    return m.toString();
  }

  /** The live picture message with a plugin's complete settings ({@code settings}). */
  public String settingsMessage(String pluginId, JsonObject values) {
    ObjectNode m = JsonNodeFactory.instance.objectNode();
    m.put("type", "settings");
    m.put("plugin", pluginId);
    m.set("values", json.toNode(values));
    return m.toString();
  }

  /** What every browser gets after {@code welcome}: the data types, then each plugin's settings. */
  public List<String> liveNotices() {
    List<String> notices = new ArrayList<>();
    notices.add(dataTypesMessage());
    settings.all().forEach((id, values) -> notices.add(settingsMessage(id, values)));
    return notices;
  }

  /** Every running plugin's listeners, for the monitor view. */
  public List<ListenerStatus> listeners() {
    List<ListenerStatus> all = new ArrayList<>();
    for (Entry e : entries) {
      PluginListeners l = e.listeners;
      if (l != null) {
        l.stats().forEach(s -> all.add(new ListenerStatus(s.plugin(), s.name(), s.host(), s.port(), s.connected(), s.bytesRead(),
            s.bytesWritten(), s.reconnects())));
      }
    }
    return all;
  }

  /**
   * Every running plugin's local folders (SDK 1.4.0, ADR-0049 point 4), by plugin, then in its
   * manifest's order: whether its path is set and is a readable directory, as last checked (never waiting).
   */
  public List<FolderStatus> localFolders() {
    List<FolderStatus> all = new ArrayList<>();
    for (Entry e : entries) {
      PluginLocalFolders f = e.folders;
      if (f != null) {
        f.statuses().forEach(s -> all.add(new FolderStatus(e.id, s.id(), s.reason(), s.setting(), s.path(), s.resolved(), s.state())));
      }
    }
    return all;
  }

  /**
   * A local folder as the monitor view shows it (ADR-0049 point 4).
   *
   * @param setting the JSON Pointer into the plugin's settings that holds its path
   * @param path the path its setting holds, as typed, or {@code null} while it is empty
   * @param resolved SDK 1.6.0 (CR-0041 part H): for a setting relative to emcc, the folder it resolves to; else {@code null}
   * @param state {@code READABLE}, {@code NOT_SET}, {@code MISSING}, or {@code CHECKING} until the first check
   */
  public record FolderStatus(String plugin, String id, String reason, String setting, @Nullable String path, @Nullable String resolved,
      String state) {}

  /** The conversion service (SDK 1.8.0, CR-0044 E2, T-211), for the monitor. */
  public ConversionHub conversions() {
    return conversions;
  }

  /**
   * ADR-0062 (M9 C3): the TLS credentials by name, sorted, as local configuration gives them; what a settings field of
   * kind {@code tls-credential} offers, and what the Monitor lists.
   */
  public java.util.SortedMap<String, TlsCredentials> tlsCredentials() {
    return java.util.Collections.unmodifiableSortedMap(new java.util.TreeMap<>(listenerConfig.credentials()));
  }

  /** SDK 1.9.0 (ADR-0064 point 4): the server's cap on compute tasks. */
  public ComputeHub computeHub() {
    return computeHub;
  }

  /** SDK 1.9.0 (ADR-0064 point 5): a running plugin's compute threads, or null when it is not running. */
  public PluginComputes.@Nullable Status computeStatus(String pluginId) {
    for (Entry e : entries) {
      PluginComputes c = e.computes;
      if (e.id.equals(pluginId) && c != null) {
        return c.status();
      }
    }
    return null;
  }

  /**
   * SDK 1.9.0 (ADR-0064 point 4, PQ1 A): the compute threads an admin allows a plugin: stored, then
   * applied at once to it if it runs (lowering stops its newest tasks first).
   *
   * @return the number stored, 0 to its declaration
   * @throws IllegalArgumentException for a plugin that is not here or declares no compute threads, or a number outside 0 to its declaration
   */
  public int computeThreads(String pluginId, int threads) {
    Entry entry = entries.stream().filter(e -> e.id.equals(pluginId)).findFirst()
        .orElseThrow(() -> new IllegalArgumentException("no plugin " + pluginId));
    int declared = entry.manifest == null ? 0 : entry.manifest.computeThreads();
    if (declared == 0) {
      throw new IllegalArgumentException("plugin " + pluginId + " declares no compute threads");
    }
    if (threads < 0 || threads > declared) {
      throw new IllegalArgumentException("compute threads are 0 to " + declared + ", the plugin's declaration: " + threads);
    }
    configuration.change(c -> c.withComputeThreads(pluginId, threads), stored -> {});
    PluginComputes running = entry.computes;
    if (running != null) {
      running.allowed(threads);
    }
    return threads;
  }

  /** SDK 1.9.0: the compute threads an admin allows {@code manifest}'s plugin now: stored, else its declaration. */
  public int computeThreads(PluginManifest manifest) {
    int declared = manifest.computeThreads();
    Integer stored = configuration.current().computeThreads().get(manifest.id());
    return stored == null ? declared : Math.max(0, Math.min(stored, declared));
  }

  /** The stream channel (SDK 1.8.0, CR-0044 E1), for the edge that serves its viewers. */
  public StreamHub streams() {
    return streams;
  }

  /** Every running plugin's output channels (SDK 1.2.0, ADR-0037), by plugin, then by link. */
  public List<ChannelStatus> channels() {
    List<ChannelStatus> all = new ArrayList<>();
    for (Entry e : entries) {
      channels.stats(e.id).forEach(s -> all.add(new ChannelStatus(e.id, s.info().id().link(), s.info().name(), s.info().outputType(),
          s.info().state().name(), s.info().stateDetail(),
          s.info().canDelete(), s.info().declaredKinds().stream().sorted().toList(), s.sent(), s.replaced(), s.delivered(), s.dropped(),
          s.pending(), s.inFlight())));
    }
    return all;
  }

  /**
   * An output channel as the monitor view shows it (ADR-0037 point 6).
   *
   * @param link the offering plugin's link, the channel's id with {@code plugin}
   * @param sent items accepted for it
   * @param replaced items that replaced a pending item of the same object (coalesced)
   * @param delivered items the offering worker has handled
   * @param dropped items that went because its inbox was full, or whose worker stopped before handling them
   * @param pending objects waiting in its inbox
   * @param inFlight items handed to the offering worker and not handled yet
   * @param declaredKinds SDK 1.9.0 (CR-0048 point 4): the ids of the declared kinds it takes, sorted
   */
  public record ChannelStatus(String plugin, String link, String name, String outputType, String state, String stateDetail, boolean canDelete, List<String> declaredKinds,
      long sent, long replaced, long delivered, long dropped, int pending, int inFlight) {
    public ChannelStatus {
      declaredKinds = List.copyOf(declaredKinds);
    }
  }

  /** A listener as the monitor view shows it. */
  public record ListenerStatus(String plugin, String name, String host, int port, boolean connected, long bytesRead,
      long bytesWritten, long reconnects) {}

  /** Every running plugin's connection tasks (SDK 1.2.0, ADR-0036 point 6), by plugin, then by name. */
  public List<TaskStatus> connectionTasks() {
    List<TaskStatus> all = new ArrayList<>();
    for (Entry e : entries) {
      TaskEngine t = e.tasks;
      if (t != null) {
        t.stats().forEach(s -> all.add(new TaskStatus(e.id, s.id(), s.name(), s.state().name(), s.since().toEpochMilli(), s.restarts(),
            s.next() == null ? null : s.next().toEpochMilli(), s.reason(), s.listening(), s.peer(), s.counters(), s.details(),
            s.lastActivity() == null ? null : s.lastActivity().toEpochMilli(), s.notEnding(), s.inbox().queued(),
            s.inbox().dropped() + s.inbox().evicted(), s.inbox().coalesced())));
      }
    }
    return all;
  }

  /**
   * A connection task as the monitor view shows it: ECore's own view of it (its state, since when,
   * its restarts, the next try and the last reason, whether it has not ended after its stop) and the
   * plugin's (its counters, details, addresses and last activity), with its inbox.
   *
   * @param id unique among the server's tasks: a new task of the same name has another
   * @param state {@code STARTING}, {@code RUNNING}, {@code RESTARTING}, {@code STOPPING}, {@code STOPPED} (only while it
   *     waits behind a stuck run of its name) or {@code FAILED} (a task the plugin started itself, not a child: its last
   *     failure, kept until a new task of the name starts or the plugin stops; at most 20 per plugin)
   * @param lost inbox items dropped or evicted when it was full
   */
  public record TaskStatus(String plugin, long id, String name, String state, long sinceMillis, long restarts, @Nullable Long nextMillis,
      @Nullable String reason, @Nullable String listening, @Nullable String peer, Map<String, Long> counters,
      Map<String, String> details, @Nullable Long lastActivityMillis, boolean notEnding, int queued, long lost, long coalesced) {
    public TaskStatus {
      counters = Map.copyOf(counters);
      details = Map.copyOf(details);
    }
  }

  /**
   * A plugin as the monitor view shows it, without SDK types: its name, its effective status and its
   * declared internet use ({@code null} for none, or without a readable manifest).
   */
  public record Health(String id, String name, boolean active, String state, String detail,
      PluginManifest.@Nullable Internet internet, List<PluginManifest.Connection> connections, List<String> capabilities,
      @Nullable CapabilityFault capabilityFault) {
    public Health {
      connections = List.copyOf(connections);
      capabilities = List.copyOf(capabilities);
    }
  }

  /**
   * SDK 1.4.0: a fault of a plugin's capabilities that a browser found with its web part (ADR-0044
   * point 4; owner, 2026-11-06: shown in the Monitor, the plugin keeps running).
   *
   * @param problem what is wrong, naming the capability
   * @param atMillis when the report came
   */
  public record CapabilityFault(String problem, long atMillis) {}

  /** Every plugin's health, in the order of {@link #plugins()}. */
  public List<Health> health() {
    return plugins().stream().map(p -> new Health(p.id(), p.manifest() == null ? p.id() : p.manifest().name(), p.active(),
        p.status().state().name(), p.status().detail(), p.manifest() == null ? null : p.manifest().internet(),
        p.manifest() == null ? List.of() : p.manifest().connections(), p.manifest() == null ? List.of() : p.manifest().capabilityIds(),
        faultOf(p.id()))).toList();
  }

  private @Nullable CapabilityFault faultOf(String pluginId) {
    for (Entry e : entries) {
      if (e.id.equals(pluginId)) {
        return e.capabilityFault;
      }
    }
    return null;
  }

  /** The most characters of a browser's reported problem that are kept. */
  static final int MAX_REPORTED_PROBLEM = 512;

  /**
   * What a browser found with a plugin's web part (SDK 1.4.0, ADR-0044 point 4; owner, Q11 and
   * 2026-11-06): the capabilities the module implements and the shell's own problem with it, or
   * null. The whole is judged with the server part's class: the shell's problem, else a declared
   * capability neither part implements, is the plugin's fault until a later report says otherwise.
   * Shown in the Monitor; the plugin keeps running. Ids this SDK does not know count as not
   * implemented.
   *
   * @return false for a plugin that is not running, whose report is ignored
   */
  public boolean webCapabilities(String pluginId, List<String> implemented, @Nullable String problem) {
    Entry entry = null;
    for (Entry e : entries) {
      if (e.id.equals(pluginId) && e.active && e.manifest != null) {
        entry = e;
      }
    }
    if (entry == null || entry.manifest == null) {
      return false;
    }
    String fault = problem == null || problem.isBlank() ? null : shortened(problem.strip());
    if (fault == null) {
      List<String> neither = new ArrayList<>();
      for (Capability c : entry.manifest.capabilities()) {
        if (!entry.serverCapabilities.contains(c) && !implemented.contains(c.id())) {
          neither.add(c.id());
        }
      }
      fault = neither.isEmpty() ? null
          : "capability " + String.join(", ", neither) + " declared but implemented by neither part (ADR-0044 point 4)";
    }
    CapabilityFault before = entry.capabilityFault;
    entry.capabilityFault = fault == null ? null : new CapabilityFault(fault, System.currentTimeMillis());
    if (fault != null && (before == null || !before.problem().equals(fault))) {
      LOG.warn("Plugin {}: a browser reports its web part's capabilities: {}", pluginId, fault);
    }
    return true;
  }

  private static String shortened(String text) {
    return text.length() > MAX_REPORTED_PROBLEM ? text.substring(0, MAX_REPORTED_PROBLEM - 1) + "…" : text;
  }

  /**
   * What is wrong with the capabilities of a plugin's server part (SDK 1.4.0, ADR-0044 point 4;
   * owner, Q11), or null: its class implements only declared ones, and for a plugin without a web
   * part every declared one. With a web part, a declared one the class lacks may be the web part's;
   * the shell's report judges the whole ({@link #webCapabilities}). The reason names the capability,
   * as the test kit's {@code CapabilityCheck} does.
   */
  static @Nullable String capabilityProblem(PluginManifest m, Class<?> pluginClass) {
    Set<Capability> implemented = Capability.implementedBy(pluginClass);
    List<String> notImplemented = m.capabilities().stream().filter(c -> !implemented.contains(c)).map(Capability::id).toList();
    List<String> notDeclared = implemented.stream().filter(c -> !m.capabilities().contains(c)).map(Capability::id).sorted().toList();
    if (!notImplemented.isEmpty() && m.web() == null) {
      return "capability " + String.join(", ", notImplemented) + " declared but not implemented by " + pluginClass.getName()
          + " (ADR-0044 point 4)";
    }
    if (!notDeclared.isEmpty()) {
      return "capability " + String.join(", ", notDeclared) + " implemented by " + pluginClass.getName() + " but not declared (ADR-0044 point 4)";
    }
    return null;
  }

  /** The available data types, {@code core.general} first; fixed by {@link #start()}. */
  public List<DataType> dataTypes() {
    return dataTypes;
  }

  /**
   * Every workspace (SDK 1.2.0, ADR-0039): View first, then those the plugins that may start
   * declare, by their {@code order}, in start order where it is the same; fixed by {@link #start()}.
   */
  public List<Workspace> workspaces() {
    return workspaces;
  }

  /**
   * The workspaces a user may see, as browsers get them (web SDK {@code WorkspaceInfo}, {@code
   * ctx.workspaces}): View first, then each declared one whose view permission {@code has} holds,
   * with {@code id}, {@code name}, {@code order}, and for a declared one its {@code viewPermission}
   * and {@code editPermission}.
   */
  public ArrayNode workspacesJson(Predicate<String> has) {
    ArrayNode all = JsonNodeFactory.instance.arrayNode();
    for (Workspace w : workspaces) {
      if (w.viewPermission() != null && !has.test(w.viewPermission())) {
        continue;
      }
      ObjectNode n = all.addObject();
      n.put("id", w.id());
      n.put("name", w.name());
      if (w.viewPermission() != null) {
        n.put("viewPermission", w.viewPermission());
      }
      if (w.editPermission() != null) {
        n.put("editPermission", w.editPermission());
      }
      n.put("order", w.order());
    }
    return all;
  }

  /** The fields the plugins that may start declare, in their start order (SDK 1.2.0); fixed by {@link #start()}. */
  public List<DeclaredField> declaredFields() {
    return declaredFields;
  }

  /**
   * The declared fields as browsers get them (web SDK {@code DeclaredField}): {@code plugin},
   * {@code name}, {@code type}, {@code label}, and the optional members only when they say
   * something ({@code required}, {@code editableByOthers} only when true; {@code choices}, {@code
   * dataTypes} only when not empty).
   */
  public ArrayNode declaredFieldsJson() {
    ArrayNode all = JsonNodeFactory.instance.arrayNode();
    for (DeclaredField f : declaredFields) {
      ObjectNode n = all.addObject();
      n.put("plugin", f.plugin());
      n.put("name", f.name());
      n.put("type", f.type().json());
      n.put("label", f.label());
      if (f.description() != null) {
        n.put("description", f.description());
      }
      if (f.unit() != null) {
        n.put("unit", f.unit());
      }
      if (f.minimum() != null) {
        n.put("minimum", f.minimum());
      }
      if (f.maximum() != null) {
        n.put("maximum", f.maximum());
      }
      if (f.maxLength() != null) {
        n.put("maxLength", f.maxLength());
      }
      if (f.required()) {
        n.put("required", true);
      }
      if (!f.choices().isEmpty()) {
        ArrayNode choices = n.putArray("choices");
        f.choices().forEach(c -> choices.addObject().put("value", c.value()).put("label", c.label()));
      }
      if (f.editableByOthers()) {
        n.put("editableByOthers", true);
      }
      if (!f.dataTypes().isEmpty()) {
        ArrayNode types = n.putArray("dataTypes");
        f.dataTypes().forEach(types::add);
      }
    }
    return all;
  }

  /** The field sets the plugins that may start declare, in their start order (SDK 1.4.0, ADR-0050); fixed by {@link #start()}. */
  public List<FieldSet> fieldSets() {
    return fieldSets;
  }

  /**
   * The relation kinds the plugins that may start declare, in their start order (SDK 1.4.0, ADR-0051
   * point 2); fixed by {@link #start()}.
   */
  public List<RelationKind> relationKinds() {
    return relationKinds;
  }

  /**
   * The field sets as browsers get them (web SDK {@code FieldSet}, {@code ctx.fieldSets}): {@code
   * id} (the full id), {@code plugin}, {@code name}, {@code label} and {@code fields}.
   */
  public ArrayNode fieldSetsJson() {
    ArrayNode all = JsonNodeFactory.instance.arrayNode();
    for (FieldSet s : fieldSets) {
      ObjectNode n = all.addObject();
      n.put("id", s.id());
      n.put("plugin", s.plugin());
      n.put("name", s.name());
      n.put("label", s.label());
      s.fields().forEach(n.putArray("fields")::add);
    }
    return all;
  }

  /**
   * The relation kinds as browsers get them (web SDK {@code RelationKind}, {@code ctx.relationKinds}):
   * {@code id}, {@code label}, {@code line} with every member, the defaults filled in, and {@code
   * defaultOn}.
   */
  public ArrayNode relationKindsJson() {
    ArrayNode all = JsonNodeFactory.instance.arrayNode();
    for (RelationKind k : relationKinds) {
      ObjectNode n = all.addObject();
      n.put("id", k.id());
      n.put("label", k.label());
      ObjectNode line = n.putObject("line")
          .put("strokeColor", k.line().strokeColor())
          .put("strokeWidth", k.line().strokeWidth())
          .put("strokeDash", k.line().strokeDash().json())
          .put("arrowhead", k.line().arrowhead().json());
      if (k.line().strokeColorSetting() != null) { // SDK 1.6.0 (CR-0041 part C): the shell resolves it
        line.put("strokeColorSetting", k.line().strokeColorSetting());
      }
      n.put("defaultOn", k.defaultOn());
    }
    return all;
  }

  /** Every plugin folder found at start, in start order of the active ones, then the disabled ones. */
  public List<PluginInfo> plugins() {
    List<PluginInfo> infos = new ArrayList<>();
    for (Entry e : entries) {
      infos.add(new PluginInfo(e.id, e.directory, e.manifest, e.active, statuses.of(e.id)));
    }
    infos.sort((a, b) -> Boolean.compare(b.active(), a.active())); // stable: keeps the start order
    return List.copyOf(infos);
  }

  /**
   * Finds, validates, orders and starts the plugins.
   *
   * @throws IllegalStateException if a required plugin cannot be started; plugins started until
   *     then keep running, and the caller stops them with {@link #stop()}
   */
  public void start() {
    if (!Files.isDirectory(directory)) {
      LOG.info("No plugin directory {}; running without plugins", directory);
      return;
    }
    List<PluginManifest> candidates = new ArrayList<>();
    for (Path folder : folders()) {
      PluginManifest manifest = readManifest(folder);
      if (manifest != null) {
        candidates.add(manifest);
      }
    }
    StartOrder order = StartOrder.of(candidates);
    for (PluginManifest m : candidates) {
      String reason = order.rejected().get(m.id());
      if (reason != null) {
        disable(add(m.id(), m), reason);
      }
    }
    fixDeclarations(order.order(), order.rejected().keySet());
    Set<String> failed = new HashSet<>(order.rejected().keySet());
    for (PluginManifest m : order.order()) {
      Entry entry = add(m.id(), m);
      String missing = m.dependsOn().stream().filter(failed::contains).findFirst().orElse(null);
      String reason = missing != null ? "depends on " + missing + ", which did not start" : start(entry, m);
      if (reason != null) {
        failed.add(m.id());
        disable(entry, reason);
      }
    }
    LOG.info("Plugins: {} running ({}), {} disabled", running.size(),
        running.stream().map(e -> e.id).collect(Collectors.joining(", ")), entries.size() - running.size());
    for (Entry e : entries) {
      if (!e.active && e.manifest != null && e.manifest.required()) {
        throw new IllegalStateException("the required plugin " + e.id + " did not start: " + statuses.of(e.id).detail());
      }
    }
  }

  /**
   * Fixes the available data types, the declared fields (SDK 1.2.0, ADR-0038), the workspaces
   * (ADR-0039), and the field sets and relation kinds (SDK 1.4.0, ADR-0050, ADR-0051): {@code core.general} and View, then those of the plugins that may start, in start
   * order (not those of rejected plugins, nor of plugins that depend on one). No data type id comes
   * twice: each starts with its plugin's id and a dot ({@link #checkV1}), and plugin ids have no
   * dot. No field comes twice: each is in its plugin's namespace, each name once ({@link #checkV1}).
   * No workspace comes twice: each starts with its plugin's id and a dot ({@link #workspaceProblem}).
   * Nor a field set or relation kind, for the same reason ({@link #setsAndKindsProblem}).
   */
  private void fixDeclarations(List<PluginManifest> inOrder, Set<String> rejected) {
    Set<String> excluded = new HashSet<>(rejected);
    List<DataType> available = new ArrayList<>(List.of(DataType.general()));
    Map<String, String> fades = new HashMap<>();
    List<DeclaredField> fields = new ArrayList<>();
    List<Workspace> declared = new ArrayList<>();
    List<FieldSet> sets = new ArrayList<>();
    List<RelationKind> kinds = new ArrayList<>();
    for (PluginManifest m : inOrder) {
      if (m.dependsOn().stream().anyMatch(excluded::contains)) {
        excluded.add(m.id());
      } else {
        m.dataTypes().forEach(t -> available.add(t.toDataType(m.id())));
        m.dataTypes().stream().filter(t -> t.fadeSetting() != null).forEach(t -> fades.put(t.id(), t.fadeSetting()));
        fields.addAll(m.fields());
        declared.addAll(m.workspaces());
        sets.addAll(m.fieldSets());
        kinds.addAll(m.relationKinds());
      }
    }
    declared.sort(Comparator.comparingInt(Workspace::order)); // stable: start order within an order
    workspaceRules.fix(declared.stream().map(w -> new Workspaces.Declared(w.id(), w.viewPermission(), w.editPermission())).toList());
    List<Workspace> all = new ArrayList<>(List.of(Workspace.view()));
    all.addAll(declared);
    workspaces = List.copyOf(all);
    if (!declared.isEmpty()) {
      LOG.info("Workspaces: {}", all.stream().map(Workspace::id).collect(Collectors.joining(", ")));
    }
    Map<String, List<String>> declaredTypes = new LinkedHashMap<>();
    available.stream().skip(1).forEach(t -> declaredTypes.put(t.id(), t.fieldSets()));
    dataTypeIds.fix(declaredTypes);
    fadeSettings = Map.copyOf(fades);
    dataTypes = List.copyOf(available);
    LOG.info("Data types: {}", available.stream().map(DataType::id).collect(Collectors.joining(", ")));
    declaredFieldChecks.fix(fields.stream().map(f -> new DeclaredFields.Field(f.ref(), f.editableByOthers(), f::problem)).toList(),
        sets.stream().map(FieldSet::id).collect(Collectors.toSet()), kinds.stream().map(RelationKind::id).collect(Collectors.toSet()));
    declaredFields = List.copyOf(fields);
    fieldSets = List.copyOf(sets);
    relationKinds = List.copyOf(kinds);
    if (!sets.isEmpty()) {
      LOG.info("Field sets: {}", sets.stream().map(FieldSet::id).collect(Collectors.joining(", ")));
    }
    if (!kinds.isEmpty()) {
      LOG.info("Relation kinds: {}", kinds.stream().map(RelationKind::id).collect(Collectors.joining(", ")));
    }
    if (!fields.isEmpty()) {
      LOG.info("Declared fields: {}", fields.stream().map(f -> f.plugin() + "." + f.name()).collect(Collectors.joining(", ")));
    }
  }

  /**
   * What is wrong with a manifest's {@code workspaces} (ADR-0039; data model 1.2.0), or null: each
   * id starts with the plugin's id and a dot, comes once, and both permissions are among the
   * plugin's own {@code permissions}.
   */
  static @Nullable String workspaceProblem(PluginManifest m) {
    Set<String> ids = new HashSet<>();
    for (Workspace w : m.workspaces()) {
      if (!w.id().startsWith(m.id() + ".")) {
        return "the workspace " + w.id() + " must start with the plugin's id: " + m.id() + ".";
      }
      if (!ids.add(w.id())) {
        return "the workspace " + w.id() + " is declared twice";
      }
      for (String p : List.of(Objects.requireNonNull(w.viewPermission()), Objects.requireNonNull(w.editPermission()))) {
        if (!m.permissions().contains(p)) {
          return "the workspace " + w.id() + "'s permission " + p + " is not among the plugin's permissions";
        }
      }
    }
    return null;
  }

  /**
   * What is wrong with a manifest's {@code fieldSets} and {@code relationKinds} (SDK 1.4.0; data
   * model rules 17 and 18), or null: each set's id once, and each of its fields one the plugin
   * declares; each kind's id starts with the plugin's id and a dot, and comes once.
   */
  static @Nullable String setsAndKindsProblem(PluginManifest m) {
    Set<String> fieldNames = m.fields().stream().map(DeclaredField::name).collect(Collectors.toSet());
    Set<String> setIds = new HashSet<>();
    for (FieldSet s : m.fieldSets()) {
      if (!setIds.add(s.id())) {
        return "the field set " + s.id() + " is declared twice";
      }
      for (String f : s.fields()) {
        if (!fieldNames.contains(f)) {
          return "the field set " + s.id() + " names " + f + ", which is not among the plugin's fields";
        }
      }
    }
    Set<String> kindIds = new HashSet<>();
    for (RelationKind k : m.relationKinds()) {
      if (!k.id().startsWith(m.id() + ".")) {
        return "the relation kind " + k.id() + " must start with the plugin's id: " + m.id() + ".";
      }
      if (!kindIds.add(k.id())) {
        return "the relation kind " + k.id() + " is declared twice";
      }
    }
    return null;
  }

  /**
   * What is wrong with a manifest's {@code symbolPalettes} (SDK 1.6.0, CR-0041 part G), or null: each
   * palette's id once, which the schema cannot check.
   */
  static @Nullable String palettesProblem(PluginManifest m) {
    JsonNode palettes = m.symbolPalettes();
    if (palettes == null) {
      return null;
    }
    Set<String> ids = new HashSet<>();
    for (JsonNode p : palettes) {
      String id = p.get("id").asString();
      if (!ids.add(id)) {
        return "the symbol palette " + id + " is declared twice";
      }
    }
    return null;
  }

  /**
   * What is wrong with a manifest's data types' {@code fieldSets} (SDK 1.5.0, CR-0038; data model
   * rule 20), or null: each names a set the same manifest declares. The schema has checked that each
   * comes once and that there are at most 8.
   */
  static @Nullable String dataTypeSetsProblem(PluginManifest m) {
    Set<String> declared = m.fieldSets().stream().map(FieldSet::name).collect(Collectors.toSet());
    for (PluginManifest.DeclaredDataType t : m.dataTypes()) {
      for (String set : t.fieldSets()) {
        if (!declared.contains(set)) {
          return "the data type " + t.id() + " names the field set " + set + ", which is not among the plugin's field sets";
        }
      }
    }
    return null;
  }

  /**
   * What is wrong with a manifest's {@code folders} (SDK 1.4.0; data model rule 19), or null: each id
   * once, and each folder's {@code setting} a property of type {@code string} of its settings schema.
   */
  static @Nullable String folderProblem(PluginManifest m, @Nullable SettingsSchema schema) {
    Set<String> ids = new HashSet<>();
    for (PluginManifest.Folder f : m.folders()) {
      if (!ids.add(f.id())) {
        return "the folder " + f.id() + " is declared twice";
      }
      if (schema == null) {
        return "the folder " + f.id() + "'s path is taken from the settings, but the plugin has no settings";
      }
      String problem = schema.checkFolderSetting(f.id(), f.setting());
      if (problem != null) {
        return problem;
      }
    }
    return null;
  }

  /** The SDK v1 checks of one manifest; returns the reason it is refused, or null. */
  private @Nullable String checkV1(PluginManifest m) {
    String workspaceProblem = workspaceProblem(m);
    if (workspaceProblem != null) {
      return workspaceProblem;
    }
    Set<String> ids = new HashSet<>();
    for (PluginManifest.DeclaredDataType t : m.dataTypes()) {
      if (!t.id().startsWith(m.id() + ".")) {
        return "the data type " + t.id() + " must start with the plugin's id: " + m.id() + ".";
      }
      if (!ids.add(t.id())) {
        return "the data type " + t.id() + " is declared twice";
      }
    }
    Set<String> fieldNames = new HashSet<>();
    for (DeclaredField f : m.fields()) {
      if (!fieldNames.add(f.name())) {
        return "the field " + f.name() + " is declared twice";
      }
    }
    String setsAndKinds = setsAndKindsProblem(m);
    if (setsAndKinds != null) {
      return setsAndKinds;
    }
    String dataTypeSets = dataTypeSetsProblem(m);
    if (dataTypeSets != null) {
      return dataTypeSets;
    }
    String palettes = palettesProblem(m);
    if (palettes != null) {
      return palettes;
    }
    SettingsSchema schema = null;
    JsonNode tree = m.settingsSchema();
    if (tree != null) {
      try {
        schema = SettingsSchema.compile(m.id(), tree);
      } catch (IllegalArgumentException e) {
        return e.getMessage();
      }
      // CR-0047 F2: ECore fills in the items' ids before it validates, for the defaults as for any settings
      List<Problem> problems = schema.validate(SettingsItemIds.fill(tree, m.settings(), true).values(), json);
      if (!problems.isEmpty()) {
        return "the settings defaults do not match the settings schema: " + problems.stream().limit(3)
            .map(p -> (p.path().isEmpty() ? "" : p.path() + ": ") + p.problem()).collect(Collectors.joining("; "));
      }
      schemas.put(m.id(), schema);
    }
    String folders = folderProblem(m, schema);
    if (folders != null) {
      return folders;
    }
    PluginManifest.Network network = m.network();
    if (network != null) {
      if (schema == null) {
        return "network endpoints are taken from the settings, but the plugin has no settings";
      }
      return schema.checkEndpoints(network.endpoints());
    }
    return null;
  }

  private List<Path> folders() {
    try (Stream<Path> list = Files.list(directory)) {
      return list.filter(Files::isDirectory)
          .filter(f -> {
            String name = f.getFileName().toString();
            return !name.startsWith("_") && !name.startsWith(".");
          })
          .sorted()
          .toList();
    } catch (IOException e) {
      throw new UncheckedIOException("cannot list the plugin directory " + directory, e);
    }
  }

  /** The folder's valid manifest, or null after disabling the folder with the reason. */
  private @Nullable PluginManifest readManifest(Path folder) {
    String name = folder.getFileName().toString();
    Path file = folder.resolve(PluginManifest.FILE);
    if (!Files.isRegularFile(file)) {
      disable(add(name, null), "no " + PluginManifest.FILE);
      return null;
    }
    PluginManifest manifest;
    try {
      manifest = PluginManifest.read(file, json);
    } catch (InvalidDocumentException e) {
      disable(add(name, null), "invalid " + PluginManifest.FILE + ": " + e.problems().stream()
          .limit(5).map(p -> (p.path().isEmpty() ? "" : p.path() + ": ") + p.problem()).collect(Collectors.joining("; ")));
      return null;
    } catch (UncheckedIOException e) {
      disable(add(name, null), "cannot read " + PluginManifest.FILE + ": " + e.getCause().getMessage());
      return null;
    }
    String reason = null;
    if (!manifest.id().equals(name)) {
      reason = "the folder name differs from the plugin id " + manifest.id();
    } else if (manifest.id().equals("core") || manifest.id().startsWith("core-")) {
      reason = "the ids core and core-… are reserved for ECore";
    } else if (!SdkVersions.compatible(manifest.sdkVersion(), SdkVersions.SDK_VERSION)) {
      reason = "needs SDK " + manifest.sdkVersion() + ", but ECore implements " + SdkVersions.SDK_VERSION;
    } else {
      reason = checkV1(manifest);
    }
    if (reason != null) {
      disable(add(name, manifest), reason);
      return null;
    }
    return manifest;
  }

  private Entry add(String id, @Nullable PluginManifest manifest) {
    Entry entry = new Entry(id, directory.resolve(id), manifest);
    statuses.register(id);
    entries.add(entry);
    return entry;
  }

  private void disable(Entry entry, String reason) {
    entry.active = false;
    statuses.setByEcore(entry.id, PluginState.FAILED, reason);
    LOG.error("Plugin {} is disabled: {}", entry.id, reason);
  }

  /** Starts one plugin; returns null on success, otherwise the reason (everything is cleaned up). */
  private @Nullable String start(Entry entry, PluginManifest m) {
    settings.register(m, schemas.get(m.id()));
    String entryClass = m.entryClass();
    if (entryClass == null) {
      entry.active = true;
      running.add(entry);
      LOG.info("Plugin {} {} has no server part (web only)", m.id(), m.version());
      return null;
    }
    List<Path> jars = PluginClassLoader.jarsIn(entry.directory.resolve("server"));
    if (jars.isEmpty()) {
      return "no jar in " + entry.directory.resolve("server");
    }
    PluginClassLoader loader = new PluginClassLoader(m.id(), jars, PluginHost.class.getClassLoader());
    entry.loader = loader;
    PluginManifest.Network network = m.network();
    PluginListeners listeners = new PluginListeners(m.id(), loader, runtime, listenerConfig, () -> settings.current(m.id()),
        network == null ? List.of() : network.endpoints(), java.time.Clock.systemUTC());
    entry.listeners = listeners;
    entry.tasks = new TaskEngine(
        m.id(), loader, runtime, listenerConfig.maxTasksPerPlugin(), java.time.Clock.systemUTC(), taskWatch(m.id()));
    entry.tasks.inheritFrom(entry.lastTasks); // C7 gap 6: a task of a name waits for the last start's hung one
    entry.lastTasks = null;
    Map<String, PayloadSchema> declaredKinds = new HashMap<>();
    m.channelKinds().forEach(k -> declaredKinds.put(k.id(), k.schema()));
    entry.channels = new PluginChannels(m.id(), channels, maxChannelsPerPlugin, declaredKinds);
    entry.streams = new PluginStreams(m.id(), streams);
    entry.conversions = conversions.member(m.id());
    PluginLocalFolders folders = new PluginLocalFolders(m.id(), m.folders(), () -> settings.current(m.id()), runtime, runtime.ioExecutor());
    entry.folders = folders;
    PluginComputes computes = new PluginComputes(m.id(), m.computeThreads(), m.compute() == null ? "" : m.compute().reason(),
        computeThreads(m), computeHub, runtime, loader, java.time.Clock.systemUTC(), folders, computeWatch(m.id()));
    computes.inheritFrom(entry.lastComputes);
    entry.lastComputes = null;
    entry.computes = computes;
    PluginContextImpl context = new PluginContextImpl(
        m, runtime, loader, statuses, endpoints, new PluginHttp(m.id(), client(), runtime, listenerConfig.httpTokens()), defaultLabel,
        limits, settings, dataTypes, store(m.id()), new PluginDocuments(m.id(), runtime.owner(m.id()), runtime, documents), listeners,
        new PluginConnections(m.id(), runtime, entry.tasks, listenerConfig), entry.channels, classifications, declaredFields,
        workspaces, fieldSets, relationKinds, folders, entry.streams, entry.conversions, computes);
    entry.context = context;
    entry.lifecycle = runtime.owner(lifecycleOwner(m.id())).spawn(
        WorkerOptions.<Call>of("lifecycle", LifecycleHandler::new).mailbox(4, Overflow.DROP_NEWEST).budget(budget)
            .contextClassLoader(loader));

    AtomicReference<@Nullable String> refused = new AtomicReference<>();
    String failure = run(entry, "init", () -> {
      Class<?> type = Class.forName(entryClass, true, loader);
      if (!Plugin.class.isAssignableFrom(type)) {
        throw new IllegalStateException(entryClass + " does not implement " + Plugin.class.getName());
      }
      String capabilities = capabilityProblem(m, type); // SDK 1.4.0, before any of its code runs (ADR-0044 point 4)
      if (capabilities != null) {
        refused.set(capabilities);
        return;
      }
      entry.serverCapabilities = Set.copyOf(Capability.implementedBy(type));
      Plugin plugin = (Plugin) type.getConstructor().newInstance();
      entry.plugin.set(plugin);
      plugin.init(context);
    });
    if (failure == null && refused.get() != null) {
      release(entry);
      return refused.get();
    }
    AtomicReference<Temporal.@Nullable Delivery<?>> delivery = new AtomicReference<>();
    if (failure == null && entry.serverCapabilities.contains(Capability.TEMPORAL)) {
      // ADR-0045: asked once, after init and before start.
      failure = run(entry, "timeDelivery", () -> delivery.set(Objects.requireNonNull(
          ((Temporal) requirePlugin(entry)).timeDelivery(), "timeDelivery() returned null")));
    }
    if (failure == null) {
      failure = run(entry, "start", () -> requirePlugin(entry).start());
      if (failure != null) {
        String stopFailure = run(entry, "stop", () -> requirePlugin(entry).stop());
        if (stopFailure != null) {
          LOG.warn("Plugin {}: {} after the failed start", m.id(), stopFailure);
        }
      }
    }
    if (failure != null) {
      release(entry);
      return failure;
    }
    entry.active = true;
    running.add(entry);
    Temporal.Delivery<?> times = delivery.get();
    if (times != null) {
      userTimes.add(m.id(), times);
    }
    LOG.info("Plugin {} {} started", m.id(), m.version());
    return null;
  }

  private @Nullable PluginStore store(String pluginId) {
    WorkerHandle<StoreMsg> store = objectStore;
    StoreFeed f = feed;
    return store == null || f == null ? null : new PluginStore(pluginId, runtime.owner(pluginId), runtime, store, f);
  }

  /**
   * A started plugin's connection tasks (ADR-0036): for the SDK's {@code Connections} (SDK 1.2.0
   * part 2) and the monitor; {@code null} for an unknown plugin, or one that is not running.
   */
  @Nullable TaskEngine tasks(String pluginId) {
    for (Entry e : entries) {
      if (e.id.equals(pluginId)) {
        return e.tasks;
      }
    }
    return null;
  }

  /** SDK 1.9.0 (ADR-0064 point 4): a compute task that will not stop makes its plugin DEGRADED, as a connection task does. */
  private TaskEngine.Watch computeWatch(String pluginId) {
    return new TaskEngine.Watch() {
      @Override
      public void notEnding(String name) {
        statuses.setByEcore(pluginId, PluginState.DEGRADED, "compute task " + name + " did not end within "
            + dev.emcc.sdk.compute.Computes.STOP_GRACE.toSeconds() + " s after its stop");
      }

      @Override
      public void ended(String name) {
        LOG.info("Plugin {}: compute task {} has ended after all", pluginId, name);
      }
    };
  }

  /**
   * What ECore does about a plugin's connection task that has not ended after its stop: the plugin
   * becomes DEGRADED, as for a hung worker that is not restarted (owner, 2026-10-24). Like that,
   * it stays so when the task ends after all.
   */
  private TaskEngine.Watch taskWatch(String pluginId) {
    return new TaskEngine.Watch() {
      @Override
      public void notEnding(String name) {
        statuses.setByEcore(pluginId, PluginState.DEGRADED, "connection task " + name + " did not end within "
            + TaskEngine.NOT_ENDING_AFTER.toSeconds() + " s after its stop");
      }

      @Override
      public void ended(String name) {
        LOG.info("Plugin {}: connection task {} has ended after all", pluginId, name);
      }
    };
  }

  private static Plugin requirePlugin(Entry entry) {
    Plugin plugin = entry.plugin.get();
    if (plugin == null) {
      throw new IllegalStateException("no plugin instance");
    }
    return plugin;
  }

  private static String lifecycleOwner(String pluginId) {
    return "core-lifecycle-" + pluginId;
  }

  /** Runs a step in the plugin's lifecycle worker; returns null on success, else what went wrong. */
  private @Nullable String run(Entry entry, String name, Step step) {
    WorkerHandle<Call> lifecycle = entry.lifecycle;
    PluginClassLoader loader = entry.loader;
    if (lifecycle == null || loader == null) {
      return name + " was not run";
    }
    Waiter waiter = new Waiter();
    if (lifecycle.send(new Call(step, loader, waiter)) != SendOutcome.ACCEPTED) {
      return name + " could not be run";
    }
    Done done = waiter.await(budget.plusSeconds(1));
    if (done == null) {
      return name + " did not return within " + budget.toMillis() + " ms";
    }
    Throwable error = done.error();
    if (error == null) {
      return null;
    }
    LOG.error("Plugin {}: {} failed", entry.id, name, error);
    return name + " failed: " + error;
  }

  /** Stops what belongs to a plugin: endpoints, workers, timers, subscriptions, class loader. */
  private void release(Entry entry) {
    userTimes.remove(entry.id); // first: no more times to its workers
    PluginListeners listeners = entry.listeners;
    entry.listeners = null;
    if (listeners != null) {
      listeners.stopAll(); // first: their loops send to the plugin's workers
    }
    TaskEngine tasks = entry.tasks;
    entry.tasks = null;
    if (tasks != null) {
      tasks.stopAll(); // first too, for the same reason
      entry.lastTasks = tasks.unended(); // C7 gap 6
    }
    PluginComputes computes = entry.computes;
    entry.computes = null;
    if (computes != null) {
      computes.stopAll(); // as the connection tasks: they send to the plugin's workers
      entry.lastComputes = computes.unended();
    }
    entry.folders = null; // gone from the Monitor; a call in progress still answers its worker, or nobody
    PluginChannels pluginChannels = entry.channels;
    entry.channels = null;
    if (pluginChannels != null) {
      pluginChannels.release(); // its channels withdrawn (senders get CLOSED), its watches cancelled, no new ones
    }
    ConversionHub.Member pluginConversions = entry.conversions;
    entry.conversions = null;
    if (pluginConversions != null) {
      conversions.release(pluginConversions); // before its streams close: "plugin stopped", not "stream closed"
    }
    PluginStreams pluginStreams = entry.streams;
    entry.streams = null;
    if (pluginStreams != null) {
      pluginStreams.release(); // its streams closed (writes get CLOSED), its viewers' responses end
    }
    endpoints.remove(entry.id);
    settings.unsubscribeAll(entry.id);
    if (feed != null) {
      feed.closeAll(entry.id);
    }
    runtime.owner(entry.id).stop();
    runtime.owner(lifecycleOwner(entry.id)).stop();
    entry.lifecycle = null;
    entry.context = null;
    entry.plugin.set(null);
    PluginClassLoader loader = entry.loader;
    entry.loader = null;
    if (loader != null) {
      try {
        loader.close();
      } catch (IOException e) {
        LOG.warn("Plugin {}: could not close its class loader", entry.id, e);
      }
    }
  }

  /** Stops the running plugins in reverse start order: {@code stop()}, then their workers. */
  public void stop() {
    for (int i = running.size() - 1; i >= 0; i--) {
      Entry entry = running.get(i);
      if (entry.lifecycle != null) {
        String failure = run(entry, "stop", () -> requirePlugin(entry).stop());
        if (failure != null) {
          LOG.warn("Plugin {}: {}", entry.id, failure);
        }
      }
      entry.active = false;
      release(entry);
      LOG.info("Plugin {} stopped", entry.id);
    }
    running.clear();
    conversions.close();
    streams.close();
    HttpClient c = client;
    client = null;
    if (c != null) {
      c.shutdownNow();
    }
  }

  private HttpClient client() {
    HttpClient c = client;
    if (c == null) {
      c = PluginHttp.newClient(runtime);
      client = c;
    }
    return c;
  }

  /** Runs a plugin's life cycle steps with its class loader as the context class loader. */
  private static final class LifecycleHandler implements MessageHandler<Call> {
    @Override
    public void handle(Call call, HandlerContext<Call> context) {
      Thread thread = Thread.currentThread();
      ClassLoader previous = thread.getContextClassLoader();
      thread.setContextClassLoader(call.loader());
      try {
        call.step().run();
        call.replyTo().reply(new Done(null));
      } catch (InvocationTargetException e) {
        call.replyTo().reply(new Done(e.getCause() != null ? e.getCause() : e));
      } catch (Throwable e) { // plugin code: anything it throws is a failed step
        call.replyTo().reply(new Done(e));
      } finally {
        thread.setContextClassLoader(previous);
      }
    }
  }

  /** A reply handle the start-up thread waits on, with a timeout (rule C5). */
  private static final class Waiter implements ReplyHandle<Done> {
    private final String id = "plugin-host-" + UUID.randomUUID();
    private final CompletableFuture<Done> done = new CompletableFuture<>();

    @Override
    public String id() {
      return id;
    }

    @Override
    public void reply(Done value) {
      done.complete(value);
    }

    @Override
    public void fail(String reason) {
      done.complete(new Done(new IllegalStateException(reason)));
    }

    @Nullable Done await(Duration timeout) {
      try {
        return done.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return null;
      } catch (ExecutionException | TimeoutException e) {
        return null;
      }
    }
  }

  /** For tests: the statuses of all plugins by id. */
  Map<String, PluginStatus> statusById() {
    Map<String, PluginStatus> result = new ConcurrentHashMap<>();
    entries.forEach(e -> result.put(e.id, statuses.of(e.id)));
    return result;
  }
}
