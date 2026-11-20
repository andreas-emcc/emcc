package dev.emcc.ecore.plugin;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.json.Problem;
import dev.emcc.ecore.persistence.Configuration;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Permissions;
import dev.emcc.sdk.User;
import dev.emcc.sdk.json.JsonObject;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BiConsumer;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;

/**
 * The plugins' current settings (SDK v1 design, "Settings at runtime"). A plugin's settings are the
 * values a user with {@code settings.admin} configured, validated against the plugin's settings
 * schema, or its manifest's defaults until then. They are replaced as a whole; a plugin is never
 * restarted for a change.
 *
 * <ul>
 *   <li>{@link #current} may be called from any thread (a plugin's {@code settings()}).
 *   <li>Subscribers ({@code subscribeSettings}) get the complete settings after each accepted
 *       change. Those messages are always delivered; when several wait undelivered, the worker gets
 *       the latest values, so it always ends with the current ones.
 *   <li>Stored values that no longer match the schema (e.g. after a plugin update) are not used:
 *       the plugin gets its defaults, and an error is logged.
 *   <li>SDK 1.8.0 (CR-0047 F2): every item of a list that declares {@code x-emc2.item.id} has an
 *       id. ECore fills in a missing one ({@link SettingsItemIds}) at load and at every change,
 *       before it validates, and stores the result; a change with two items of one id in a list is
 *       refused, and at load the second of a pair gets a new id.
 * </ul>
 */
public final class PluginSettings {

  private static final Logger LOG = LoggerFactory.getLogger(PluginSettings.class);

  /** The outcome of {@link #change}. */
  public sealed interface Change {
    /** Stored and delivered: the plugin's new settings. */
    record Applied(JsonObject values) implements Change {}

    /** The values do not match the plugin's settings schema; nothing changed. */
    record Refused(List<Problem> problems) implements Change {}

    /** The user lacks {@code settings.admin}. */
    record Forbidden(String reason) implements Change {}

    /** No loaded plugin has this id. */
    record NotFound(String pluginId) implements Change {}
  }

  /** What the settings view shows of a plugin: its schema (null if it has no settings) and values. */
  public record View(@Nullable JsonNode schema, JsonObject values) {}

  private final WorkerRuntime runtime;
  private final Configuration configuration;
  private final ModelJson json;
  private final Map<String, Registered> plugins = new ConcurrentHashMap<>();
  private final List<BiConsumer<String, JsonObject>> listeners = new CopyOnWriteArrayList<>();

  private static final class Registered {
    final @Nullable SettingsSchema schema;
    volatile JsonObject current;
    final List<Subscription<?>> subscriptions = new CopyOnWriteArrayList<>();

    Registered(@Nullable SettingsSchema schema, JsonObject current) {
      this.schema = schema;
      this.current = current;
    }
  }

  PluginSettings(WorkerRuntime runtime, Configuration configuration, ModelJson json) {
    this.runtime = runtime;
    this.configuration = configuration;
    this.json = json;
  }

  /** At start, before the plugin runs: its current settings are the stored ones if they are valid. */
  void register(PluginManifest manifest, @Nullable SettingsSchema schema) {
    String id = manifest.id();
    JsonObject stored = configuration.current().pluginSettings().get(id);
    JsonObject current = null;
    boolean store = false;
    if (stored != null) {
      SettingsItemIds.Filled filled = fillAtLoad(id, schema, stored);
      List<Problem> problems = problems(schema, filled.values());
      if (problems.isEmpty()) {
        current = filled.values();
        store = filled.changed();
      } else {
        LOG.error("The stored settings of plugin {} do not match its settings schema; it gets its defaults until they "
            + "are configured again: {}", id, problems);
      }
    }
    if (current == null) {
      SettingsItemIds.Filled filled = fillAtLoad(id, schema, manifest.settings());
      current = filled.values();
      store = stored == null && filled.changed(); // invalid stored values stay for the admin; these ids last until a restart
    }
    if (store) {
      JsonObject values = current;
      try {
        configuration.change(c -> c.withPluginSettings(id, values), next -> {});
        LOG.info("ECore gave ids to the items of plugin {}'s settings lists and stored them", id);
      } catch (RuntimeException e) { // never stops the start: the ids last until a restart, as before part F
        LOG.warn("ECore gave ids to the items of plugin {}'s settings lists but could not store them; they last until a restart",
            id, e);
      }
    }
    plugins.put(id, new Registered(schema, current));
  }

  /** CR-0047 F2 at load: missing ids filled in, repeated ones renewed (and logged). */
  private static SettingsItemIds.Filled fillAtLoad(String pluginId, @Nullable SettingsSchema schema, JsonObject values) {
    if (schema == null) {
      return new SettingsItemIds.Filled(values, List.of(), List.of());
    }
    SettingsItemIds.Filled filled = SettingsItemIds.fill(schema.tree(), values, true);
    if (!filled.duplicates().isEmpty()) {
      LOG.warn("Plugin {}'s settings had items with an id that another item of the list has; they got new ids: {}",
          pluginId, filled.duplicates());
    }
    return filled;
  }

  /** The plugin's current settings; empty for an unknown plugin. */
  public JsonObject current(String pluginId) {
    Registered r = plugins.get(pluginId);
    return r == null ? JsonObject.of(Map.of()) : r.current;
  }

  /** Every started plugin's current settings, by plugin id. */
  public Map<String, JsonObject> all() {
    Map<String, JsonObject> all = new java.util.TreeMap<>();
    plugins.forEach((id, r) -> all.put(id, r.current));
    return all;
  }

  /** The settings view of a plugin, or null for an unknown one. Needs {@code settings.admin}: the caller checks. */
  public @Nullable View view(String pluginId) {
    Registered r = plugins.get(pluginId);
    return r == null ? null : new View(r.schema == null ? null : r.schema.tree(), r.current);
  }

  /**
   * Changes a plugin's settings for {@code user}: needs {@code settings.admin}, and values that
   * match the plugin's settings schema once their missing item ids are filled in (CR-0047 F2), with
   * no repeated id in a list. They are stored, then delivered to the plugin's subscribers
   * and to ECore's own listeners.
   */
  public Change change(String pluginId, JsonObject values, User user) {
    Objects.requireNonNull(values, "values");
    Registered r = plugins.get(pluginId);
    if (r == null) {
      return new Change.NotFound(pluginId);
    }
    if (!user.has(Permissions.SETTINGS_ADMIN)) {
      return new Change.Forbidden("changing settings needs " + Permissions.SETTINGS_ADMIN);
    }
    JsonObject given = values;
    if (r.schema != null) { // CR-0047 F2: missing ids filled in before validating, repeated ones refused
      SettingsItemIds.Filled filled = SettingsItemIds.fill(r.schema.tree(), values, false);
      if (!filled.duplicates().isEmpty()) {
        return new Change.Refused(filled.duplicates().stream()
            .map(at -> new Problem(at, "another item of this list has the same id")).toList());
      }
      given = filled.values();
    }
    JsonObject accepted = given;
    List<Problem> problems = problems(r.schema, accepted);
    if (!problems.isEmpty()) {
      return new Change.Refused(problems);
    }
    configuration.change(c -> c.withPluginSettings(pluginId, accepted), stored -> r.current = accepted);
    LOG.info("User {} changed the settings of plugin {}", user.id(), pluginId);
    r.subscriptions.forEach(Subscription::changed);
    listeners.forEach(l -> l.accept(pluginId, r.current));
    return new Change.Applied(accepted);
  }

  /** {@code subscribeSettings}: {@code toMessage} is plugin code and runs in the target's worker. */
  <M> Cancellable subscribe(String pluginId, WorkerHandle<M> target, Function<JsonObject, ? extends M> toMessage) {
    Registered r = Objects.requireNonNull(plugins.get(pluginId), "unknown plugin " + pluginId);
    Subscription<M> subscription = new Subscription<>(r, target, toMessage);
    r.subscriptions.add(subscription);
    return () -> r.subscriptions.remove(subscription);
  }

  /** When the plugin stops: no more settings messages. */
  void unsubscribeAll(String pluginId) {
    Registered r = plugins.get(pluginId);
    if (r != null) {
      r.subscriptions.clear();
    }
  }

  /** ECore's own parts that follow every change (e.g. to tell browsers); called on the changer's thread. */
  public void onChange(BiConsumer<String, JsonObject> listener) {
    listeners.add(Objects.requireNonNull(listener, "listener"));
  }

  private List<Problem> problems(@Nullable SettingsSchema schema, JsonObject values) {
    if (schema == null) {
      return values.isEmpty() ? List.of() : List.of(new Problem("", "the plugin has no settings"));
    }
    return schema.validate(values, json);
  }

  /** One {@code subscribeSettings}: at most one message waits, and it carries the values current when it is handled. */
  private final class Subscription<M> {
    private final Registered registered;
    private final WorkerHandle<M> target;
    private final Function<JsonObject, ? extends M> toMessage;
    private final AtomicBoolean waiting = new AtomicBoolean();

    Subscription(Registered registered, WorkerHandle<M> target, Function<JsonObject, ? extends M> toMessage) {
      this.registered = registered;
      this.target = target;
      this.toMessage = toMessage;
    }

    void changed() {
      if (waiting.compareAndSet(false, true)) {
        boolean queued = runtime.deliverAlways(target, () -> {
          waiting.set(false); // a change from now on queues another message
          return toMessage.apply(registered.current);
        });
        if (!queued) {
          waiting.set(false); // the worker has stopped
        }
      }
    }
  }
}
