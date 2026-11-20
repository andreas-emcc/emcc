package dev.emcc.ecore.plugin;

import dev.emcc.ecore.runtime.Owner;
import dev.emcc.ecore.runtime.OwnerLimits;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Classifications;
import dev.emcc.sdk.DataType;
import dev.emcc.sdk.DeclaredField;
import dev.emcc.sdk.FieldSet;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginLog;
import dev.emcc.sdk.RelationKind;
import dev.emcc.sdk.Status;
import dev.emcc.sdk.Workspace;
import dev.emcc.sdk.channel.Channels;
import dev.emcc.sdk.connection.Connections;
import dev.emcc.sdk.document.Documents;
import dev.emcc.sdk.folder.LocalFolders;
import dev.emcc.sdk.http.Endpoints;
import dev.emcc.sdk.http.OutboundHttp;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.listener.Listeners;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.store.Store;
import dev.emcc.sdk.stream.Conversions;
import dev.emcc.sdk.stream.Streams;
import dev.emcc.sdk.timer.Timers;
import dev.emcc.sdk.topic.Topic;
import dev.emcc.sdk.topic.Topics;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.Workers;
import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * What ECore offers one plugin (SDK v1 design, "Plugin context"). The plugin's workers, timers and
 * subscriptions belong to the runtime owner named by the plugin id, so ECore stops them all when
 * the plugin stops.
 */
final class PluginContextImpl implements PluginContext {

  private final PluginManifest manifest;
  private final WorkerRuntime runtime;
  private final Owner owner;
  private final PluginLog log;
  private final Status status;
  private final Workers workers;
  private final Topics topics;
  private final Timers timers;
  private final OutboundHttp http;
  private final Endpoints endpoints;
  private final SecurityLabel defaultLabel;
  private final PluginSettings settings;
  private final List<DataType> dataTypes;
  private final @Nullable Store store;
  private final Documents documents;
  private final Listeners listeners;
  private final Connections connections;
  private final Channels channels;
  private final Classifications classifications;
  private final List<DeclaredField> declaredFields;
  private final List<Workspace> workspaces;
  private final List<FieldSet> fieldSets;
  private final List<RelationKind> relationKinds;
  private final LocalFolders folders;
  private final Streams streams;
  private final Conversions conversions;
  /** SDK 1.9.0 (ADR-0064): its compute tasks. */
  private final dev.emcc.sdk.compute.Computes computes;

  /**
   * Every member of the SDK's context, SDK 1.2.0's five included, so that none falls back to the
   * SDK's default that throws (W1: the PDA may then make them abstract).
   *
   * @param connections the plugin's connection tasks (SDK 1.2.0)
   * @param channels the plugin's output channels (SDK 1.2.0)
   * @param classifications the configured orders of classifications (SDK 1.2.0)
   * @param declaredFields every loaded plugin's declared fields (SDK 1.2.0, ADR-0038)
   * @param workspaces every workspace, View first (SDK 1.2.0, ADR-0039)
   * @param fieldSets every loaded plugin's field sets (SDK 1.4.0, ADR-0050)
   * @param relationKinds every loaded plugin's relation kinds (SDK 1.4.0, ADR-0051)
   * @param folders the plugin's local folders (SDK 1.4.0, ADR-0049 point 4)
   * @param streams the plugin's streams to its web part (SDK 1.8.0, CR-0044 E1)
   * @param conversions the plugin's part of ECore's conversion service (SDK 1.8.0, CR-0044 E2, T-211)
   */
  PluginContextImpl(
      PluginManifest manifest, WorkerRuntime runtime, ClassLoader loader, PluginStatuses statuses,
      PluginEndpoints endpoints, OutboundHttp http, SecurityLabel defaultLabel, OwnerLimits limits,
      PluginSettings settings, List<DataType> dataTypes, @Nullable Store store, Documents documents, Listeners listeners,
      Connections connections, Channels channels, Classifications classifications, List<DeclaredField> declaredFields,
      List<Workspace> workspaces, List<FieldSet> fieldSets, List<RelationKind> relationKinds, LocalFolders folders, Streams streams, Conversions conversions) {
    this(manifest, runtime, loader, statuses, endpoints, http, defaultLabel, limits, settings, dataTypes, store, documents, listeners,
        connections, channels, classifications, declaredFields, workspaces, fieldSets, relationKinds, folders, streams, conversions,
        new PluginComputes(manifest.id(), 0, "", 0, new ComputeHub(1), runtime, loader, java.time.Clock.systemUTC(), folders,
            TaskEngine.Watch.NONE)); // a plugin without compute threads (tests)
  }

  /** With its compute tasks (SDK 1.9.0, ADR-0064). */
  PluginContextImpl(
      PluginManifest manifest, WorkerRuntime runtime, ClassLoader loader, PluginStatuses statuses,
      PluginEndpoints endpoints, OutboundHttp http, SecurityLabel defaultLabel, OwnerLimits limits,
      PluginSettings settings, List<DataType> dataTypes, @Nullable Store store, Documents documents, Listeners listeners,
      Connections connections, Channels channels, Classifications classifications, List<DeclaredField> declaredFields,
      List<Workspace> workspaces, List<FieldSet> fieldSets, List<RelationKind> relationKinds, LocalFolders folders, Streams streams, Conversions conversions,
      dev.emcc.sdk.compute.Computes computes) {
    this.computes = Objects.requireNonNull(computes, "computes");
    this.manifest = manifest;
    this.runtime = runtime;
    this.owner = runtime.owner(manifest.id());
    this.owner.limits(limits); // the plugin's caps (CR-0005), on its runtime owner
    this.log = new PluginLogger(manifest.id());
    this.status = (state, detail) ->
        statuses.setOwn(manifest.id(), Objects.requireNonNull(state, "state"), Objects.requireNonNull(detail, "detail"));
    this.workers = new PluginWorkers(manifest.id(), owner, loader);
    this.topics = new PluginTopics();
    this.timers = new PluginTimers();
    this.http = http;
    this.endpoints = endpoints.of(manifest.id());
    this.defaultLabel = defaultLabel;
    this.settings = settings;
    this.dataTypes = List.copyOf(dataTypes);
    this.store = store;
    this.documents = documents;
    this.listeners = listeners;
    this.connections = Objects.requireNonNull(connections, "connections");
    this.channels = Objects.requireNonNull(channels, "channels");
    this.classifications = Objects.requireNonNull(classifications, "classifications");
    this.declaredFields = List.copyOf(declaredFields);
    this.workspaces = List.copyOf(workspaces);
    this.fieldSets = List.copyOf(fieldSets);
    this.relationKinds = List.copyOf(relationKinds);
    this.folders = Objects.requireNonNull(folders, "folders");
    this.streams = Objects.requireNonNull(streams, "streams");
    this.conversions = Objects.requireNonNull(conversions, "conversions");
  }

  Owner owner() {
    return owner;
  }

  @Override
  public String pluginId() {
    return manifest.id();
  }

  @Override
  public PluginLog log() {
    return log;
  }

  @Override
  public Status status() {
    return status;
  }

  @Override
  public JsonObject settings() {
    return settings.current(manifest.id());
  }

  @Override
  public <M extends Message> Cancellable subscribeSettings(WorkerRef<M> target, Function<JsonObject, ? extends M> toMessage) {
    Objects.requireNonNull(toMessage, "toMessage");
    return settings.subscribe(manifest.id(), PluginWorkers.handleOf(Objects.requireNonNull(target, "target")), toMessage);
  }

  @Override
  @SuppressWarnings("deprecation") // SDK 1.2.0: kept in 1.x for existing code (ADR-0036 point 8)
  public Listeners listeners() {
    return listeners;
  }

  @Override
  public Connections connections() {
    return connections;
  }

  @Override
  public Channels channels() {
    return channels;
  }

  @Override
  public Classifications classifications() {
    return classifications;
  }

  @Override
  public List<DeclaredField> declaredFields() {
    return declaredFields;
  }

  @Override
  public List<Workspace> workspaces() {
    return workspaces;
  }

  @Override
  public List<FieldSet> fieldSets() {
    return fieldSets;
  }

  @Override
  public List<RelationKind> relationKinds() {
    return relationKinds;
  }

  @Override
  public LocalFolders folders() {
    return folders;
  }

  @Override
  public Streams streams() {
    return streams;
  }

  @Override
  public Conversions conversions() {
    return conversions;
  }

  @Override
  public dev.emcc.sdk.compute.Computes compute() {
    return computes;
  }

  @Override
  public Store store() {
    if (store == null) {
      throw new IllegalStateException("this ECore runs without an object store");
    }
    return store;
  }

  @Override
  public Documents documents() {
    return documents;
  }

  @Override
  public List<DataType> dataTypes() {
    return dataTypes;
  }

  @Override
  public Workers workers() {
    return workers;
  }

  @Override
  public Topics topics() {
    return topics;
  }

  @Override
  public Timers timers() {
    return timers;
  }

  @Override
  public OutboundHttp http() {
    return http;
  }

  @Override
  public Endpoints endpoints() {
    return endpoints;
  }

  @Override
  public SecurityLabel defaultLabel() {
    return defaultLabel;
  }

  private static <T extends Message> dev.emcc.ecore.runtime.Topic<T> runtimeTopic(Topic<T> topic) {
    Objects.requireNonNull(topic, "topic");
    return dev.emcc.ecore.runtime.Topic.of(topic.name(), topic.payloadType());
  }

  /** Topics on the runtime's bus. A plugin publishes only to topics named after itself. */
  private final class PluginTopics implements Topics {
    @Override
    public <T extends Message> void publish(Topic<T> topic, T message) {
      Objects.requireNonNull(message, "message");
      if (!runtimeTopic(topic).name().startsWith(manifest.id() + ".")) {
        throw new IllegalArgumentException(
            "plugin " + manifest.id() + " may publish only to its own topics (" + manifest.id() + ".…): " + topic.name());
      }
      runtime.publish(runtimeTopic(topic), message);
    }

    @Override
    public <T extends Message, M extends Message> Cancellable subscribe(
        Topic<T> topic, WorkerRef<M> target, Function<? super T, ? extends M> mapper) {
      Objects.requireNonNull(mapper, "mapper");
      dev.emcc.ecore.runtime.Cancellable c = owner.subscribe(runtimeTopic(topic), PluginWorkers.handleOf(target), mapper);
      return c::cancel;
    }
  }

  /** Timers of the plugin's runtime owner. */
  private final class PluginTimers implements Timers {
    @Override
    public <M extends Message> Cancellable once(Duration delay, WorkerRef<M> target, M message) {
      dev.emcc.ecore.runtime.Cancellable c = owner.once(delay, PluginWorkers.handleOf(target), message);
      return c::cancel;
    }

    @Override
    public <M extends Message> Cancellable every(Duration period, WorkerRef<M> target, M message) {
      dev.emcc.ecore.runtime.Cancellable c = owner.every(period, PluginWorkers.handleOf(target), message);
      return c::cancel;
    }
  }
}
