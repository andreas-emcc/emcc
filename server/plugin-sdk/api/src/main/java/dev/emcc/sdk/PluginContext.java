package dev.emcc.sdk;

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
import dev.emcc.sdk.timer.Timers;
import dev.emcc.sdk.topic.Topics;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.stream.Conversions;
import dev.emcc.sdk.stream.Streams;
import dev.emcc.sdk.worker.Workers;
import java.util.List;
import java.util.function.Function;

/**
 * Everything ECore offers a plugin. Given to {@link Plugin#init}; the plugin may keep it.
 *
 * <pre>{@code
 * String upstream = context.settings().getString("upstreamUrl");
 * WorkerRef<TileMsg> tiles = context.workers().spawn(WorkerSpec.of("tiles", TileMsg.class, TileWorker::new));
 * }</pre>
 */
public interface PluginContext {

  /** The plugin's id from its manifest. Also its extension namespace. */
  String pluginId();

  /** The plugin's logger. ECore tags every entry with the plugin id. */
  PluginLog log();

  /** Sets the plugin's own status. See {@link Status}. */
  Status status();

  /**
   * The plugin's <b>current</b> settings: the configured values, validated by ECore against the
   * manifest's {@code settings} schema (with its defaults for what is not configured). An
   * immutable snapshot; call it again for the values valid now. Users with {@code settings.admin}
   * change them at runtime (SDK v1).
   */
  JsonObject settings();

  /**
   * Delivers the complete new settings to {@code target} after each accepted change, converted by
   * {@code toMessage} (plugin code: pure, non-blocking, run in that worker). Always delivered,
   * whatever the overflow policy. Each message carries the complete settings, so when several are
   * undelivered only the <b>latest</b> is kept: the worker always ends with the current values.
   * The plugin is not restarted; it applies the change itself, e.g. by stopping and starting
   * listeners.
   *
   * <pre>{@code
   * context.subscribeSettings(streams, StreamMsg.SettingsChanged::new);
   * }</pre>
   */
  <M extends Message> Cancellable subscribeSettings(WorkerRef<M> target, Function<JsonObject, ? extends M> toMessage);

  /** Creates workers and compute workers (overview 4.2). */
  Workers workers();

  /**
   * Starts listeners for blocking network I/O.
   *
   * @deprecated from SDK 1.2.0: use {@link #connections()}, in which the plugin opens its own
   *     sockets of any kind (ADR-0036). Kept in SDK 1.x for existing code, removed in the next major
   *     version.
   */
  @Deprecated(since = "1.2.0")
  Listeners listeners();

  /**
   * SDK 1.2.0: starts connection tasks, plugin code on a thread of its own (a platform thread,
   * CR-0027) in which the plugin opens its own sockets of any kind (ADR-0036; rule C6).
   */
  Connections connections();

  /**
   * SDK 1.2.0: output channels: offer one per output link, find the offered ones, and send to
   * them without a layer (ADR-0037).
   */
  Channels channels();

  /**
   * SDK 1.2.0: the configured order of classifications per policy (ADR-0031 point 3), for an
   * output link's highest classification (ADR-0037 point 8). Fixed while the server runs.
   */
  Classifications classifications();

  /** Typed publish and subscribe. */
  Topics topics();

  /** Messages sent once or periodically. */
  Timers timers();

  /** Outbound HTTP, performed by ECore outside the worker (non-blocking). */
  OutboundHttp http();

  /** Plugin-scoped inbound HTTP endpoints under {@code /api/plugins/{pluginId}/}. */
  Endpoints endpoints();

  /** The object store: changes, queries and subscriptions (ADR-0005). */
  Store store();

  /** The plugin's own documents in the persistence manager (ADR-0024). */
  Documents documents();

  /**
   * The available data types (ADR-0023): {@code core.general} first, then those the loaded
   * plugins declare. Fixed while the server runs.
   */
  List<DataType> dataTypes();

  /**
   * SDK 1.2.0: the fields every loaded plugin declares in its manifest (ADR-0038), in the order of
   * the plugins and their declarations. Fixed while the server runs. A server part that sets
   * another plugin's fields (e.g. the simulator's events) finds them here.
   */
  List<DeclaredField> declaredFields();

  /**
   * SDK 1.2.0: every workspace (ADR-0039): View first, then those the loaded plugins declare, by
   * their {@code order}. Fixed while the server runs.
   */
  List<Workspace> workspaces();

  /** The configured default security label, for everything the plugin creates. */
  SecurityLabel defaultLabel();

  /**
   * SDK 1.4.0: the field sets every loaded plugin declares in its manifest (ADR-0050), in the order
   * of the plugins and their declarations. Fixed while the server runs. The object store accepts a
   * set an object adds only from this list (model rule 18).
   *
   * <p>Abstract since the 1.4.0 freeze (a default method that threw until ECore provided it).
   */
  List<FieldSet> fieldSets();

  /**
   * SDK 1.4.0: the relation kinds every loaded plugin declares in its manifest (ADR-0051 point 2),
   * in the order of the plugins and their declarations. Fixed while the server runs. ECore declares
   * none of its own; the object store accepts a new relation only of these kinds (model rule 17).
   *
   * <p>Abstract since the 1.4.0 freeze (a default method that threw until ECore provided it).
   */
  List<RelationKind> relationKinds();

  /**
   * SDK 1.4.0 (CR-0030 part 6, ADR-0049 point 4): the local folders the manifest declares in
   * {@code folders}, read by ECore for the plugin, read only and confined to each folder. Plugins
   * never do their own file I/O (model rule 19; {@code PluginRules}).
   *
   * <p>Abstract since the 1.4.0 freeze (a default method that threw until ECore provided it).
   */
  LocalFolders folders();

  /**
   * SDK 1.8.0 (CR-0044 E1; ADR-0057 point 5): the plugin's streams to its web part, served by ECore
   * under {@code /api/plugins/{pluginId}/stream/}.
   *
   * <p>Abstract since ECore gives it (T-208, 2026-11-15; a default method that threw until then, as
   * 1.2.0's were, W1). The test kit's {@code FakePluginContext} gives it.
   */
  Streams streams();

  /**
   * SDK 1.8.0 (CR-0044 E2; ADR-0057 point 8): ECore's conversion service, e.g. MPEG-2 to H.264
   * into a stream. Plugins never start a program.
   *
   * <p>Abstract since the 1.8.0 freeze (a default method that threw until ECore gave it, T-211). The
   * test kit's {@code FakePluginContext} gives it.
   */
  Conversions conversions();

  /**
   * SDK 1.9.0 (CR-0048 point 5; ADR-0064): the plugin's compute tasks, on compute threads its
   * manifest declares ({@code compute}) and ECore owns, caps and shows in the Monitor.
   *
   * <p>Abstract since the 1.9.0 freeze (a default method that threw until ECore gave it, C7). The
   * test kit's {@code FakePluginContext} gives it.
   */
  dev.emcc.sdk.compute.Computes compute();
}
