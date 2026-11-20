package dev.emcc.ecore.persistence;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.sdk.json.JsonObject;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

/**
 * ECore's own configuration, changed while the server runs by users with {@code settings.admin}:
 * the plugins' settings (SDK v1, "Settings at runtime"), each data type's behaviour (ADR-0023
 * point 7), the installation's default look (ADR-0034; absent until an admin sets one) and the users'
 * display defaults (ADR-0046 point 3; absent until an admin sets them) and the premade security
 * labels of Settings › Labeling (T-170; absent until an admin saves them). With a
 * data directory it is the file {@value #FILE}, replaced atomically on every change; without one it
 * lives in memory only.
 *
 * <pre>{@code
 * {"format": "emc2-config/1",
 *  "pluginSettings": {"<plugin-id>": {...}},
 *  "dataTypes": {"<data-type-id>": {"expiresAfterSeconds": 300, "fadeWhenExpired": true, "removeAfterExpirySeconds": 3600}},
 *  "defaultLook": "chart-room",
 *  "displayDefaults": {"symbolSize": 40, "labels": ["name"]},
 *  "labeling": {"policies": {"NATO": {"releasableTo": ["SWE"], "labels": [...]}}}}
 * }</pre>
 *
 * <p>What is stored are the values users set. A plugin without stored settings gets its manifest's
 * defaults, a data type without a stored behaviour its manifest's defaults (the caller merges).
 * Not thread-safe: used by one thread at a time.
 */
public final class ConfigStore {

  public static final String FILE = "ecore-config.json";
  static final String FORMAT = "emc2-config/1";

  /** A data type's configured behaviour (data model rule 15). */
  public record Behaviour(@Nullable Long expiresAfterSeconds, boolean fadeWhenExpired, @Nullable Long removeAfterExpirySeconds) {
    public Behaviour {
      if (expiresAfterSeconds != null && expiresAfterSeconds < 1) {
        throw new IllegalArgumentException("expiresAfterSeconds must be >= 1: " + expiresAfterSeconds);
      }
      if (removeAfterExpirySeconds != null && removeAfterExpirySeconds < 0) {
        throw new IllegalArgumentException("removeAfterExpirySeconds must be >= 0: " + removeAfterExpirySeconds);
      }
    }
  }

  /**
   * The stored configuration: immutable.
   *
   * @param defaultLook the installation's default look as an admin set it, or null for the built-in one
   * @param displayDefaults the users' display defaults as an admin set them (SDK 1.4.0 {@code
   *     DisplayChoices}, checked before), or null for the SDK's
   * @param labeling the premade labels as an admin saved them ({@code Labeling}, checked before), or null for none
   * @param computeThreads SDK 1.9.0 (ADR-0064 point 4, PQ1 A): the compute threads an admin allows a plugin, by
   *     plugin id; a plugin missing here gets its declaration
   */
  public record Config(Map<String, JsonObject> pluginSettings, Map<String, Behaviour> dataTypes, @Nullable String defaultLook,
      @Nullable JsonObject displayDefaults, @Nullable JsonObject labeling, Map<String, Integer> computeThreads) {
    public static final Config EMPTY = new Config(Map.of(), Map.of(), null, null, null, Map.of());

    public Config {
      pluginSettings = Map.copyOf(pluginSettings);
      dataTypes = Map.copyOf(dataTypes);
      computeThreads = Map.copyOf(computeThreads);
    }

    /** SDK 1.9.0: the admin's compute threads for {@code pluginId}. */
    public Config withComputeThreads(String pluginId, int threads) {
      Map<String, Integer> changed = new LinkedHashMap<>(computeThreads);
      changed.put(Objects.requireNonNull(pluginId, "pluginId"), threads);
      return new Config(pluginSettings, dataTypes, defaultLook, displayDefaults, labeling, changed);
    }

    public Config withPluginSettings(String pluginId, JsonObject settings) {
      Map<String, JsonObject> changed = new LinkedHashMap<>(pluginSettings);
      changed.put(Objects.requireNonNull(pluginId, "pluginId"), Objects.requireNonNull(settings, "settings"));
      return new Config(changed, dataTypes, defaultLook, displayDefaults, labeling, computeThreads);
    }

    public Config withBehaviour(String dataType, Behaviour behaviour) {
      Map<String, Behaviour> changed = new LinkedHashMap<>(dataTypes);
      changed.put(Objects.requireNonNull(dataType, "dataType"), Objects.requireNonNull(behaviour, "behaviour"));
      return new Config(pluginSettings, changed, defaultLook, displayDefaults, labeling, computeThreads);
    }

    /** Without a configured behaviour for {@code dataType}: the manifest's defaults apply again. */
    public Config withoutBehaviour(String dataType) {
      Map<String, Behaviour> changed = new LinkedHashMap<>(dataTypes);
      changed.remove(Objects.requireNonNull(dataType, "dataType"));
      return new Config(pluginSettings, changed, defaultLook, displayDefaults, labeling, computeThreads);
    }

    public Config withDefaultLook(String look) {
      return new Config(pluginSettings, dataTypes, Objects.requireNonNull(look, "look"), displayDefaults, labeling, computeThreads);
    }

    public Config withDisplayDefaults(JsonObject defaults) {
      return new Config(pluginSettings, dataTypes, defaultLook, Objects.requireNonNull(defaults, "defaults"), labeling, computeThreads);
    }

    public Config withLabeling(JsonObject premade) {
      return new Config(pluginSettings, dataTypes, defaultLook, displayDefaults, Objects.requireNonNull(premade, "premade"), computeThreads);
    }
  }

  private final @Nullable Path file;
  private final ModelJson json;
  private Config memory = Config.EMPTY;

  /** @param dataDirectory the data directory, or null to keep the configuration in memory only */
  public ConfigStore(@Nullable Path dataDirectory, ModelJson json) {
    this.file = dataDirectory == null ? null : dataDirectory.toAbsolutePath().normalize().resolve(FILE);
    this.json = json;
  }

  /**
   * Reads the stored configuration; empty if there is none.
   *
   * @throws IllegalStateException if the file is damaged: the start stops, nothing is lost silently
   */
  public Config load() {
    if (file == null || !Files.exists(file)) {
      return memory;
    }
    try {
      JsonNode root = json.parse(Files.readString(file, StandardCharsets.UTF_8));
      JsonNode format = root.get("format");
      if (format == null || !format.isString() || !FORMAT.equals(format.stringValue())) {
        throw new IllegalStateException(file + " is not an emc2 configuration (format " + FORMAT + ")");
      }
      Map<String, JsonObject> settings = new LinkedHashMap<>();
      for (Map.Entry<String, JsonNode> e : root.path("pluginSettings").properties()) {
        settings.put(e.getKey(), (JsonObject) ModelJson.toJsonValue(e.getValue()));
      }
      Map<String, Behaviour> dataTypes = new LinkedHashMap<>();
      for (Map.Entry<String, JsonNode> e : root.path("dataTypes").properties()) {
        JsonNode b = e.getValue();
        dataTypes.put(e.getKey(), new Behaviour(optionalLong(b, "expiresAfterSeconds"), b.path("fadeWhenExpired").isBoolean() && b.path("fadeWhenExpired").booleanValue(),
            optionalLong(b, "removeAfterExpirySeconds")));
      }
      JsonNode look = root.get("defaultLook");
      JsonNode display = root.get("displayDefaults");
      JsonNode labeling = root.get("labeling");
      Map<String, Integer> compute = new LinkedHashMap<>();
      for (Map.Entry<String, JsonNode> e : root.path("computeThreads").properties()) { // SDK 1.9.0; absent before
        if (!e.getValue().isIntegralNumber() || !e.getValue().canConvertToInt()) { // ECore reads whole numbers as big integers
          throw new IllegalStateException("computeThreads." + e.getKey() + " is not a whole number");
        }
        compute.put(e.getKey(), e.getValue().intValue());
      }
      return new Config(settings, dataTypes, look != null && look.isString() ? look.stringValue() : null,
          display != null && display.isObject() ? (JsonObject) ModelJson.toJsonValue(display) : null,
          labeling != null && labeling.isObject() ? (JsonObject) ModelJson.toJsonValue(labeling) : null, compute);
    } catch (IOException e) {
      throw new UncheckedIOException("cannot read " + file, e);
    } catch (RuntimeException e) {
      throw new IllegalStateException(file + " is damaged: " + e.getMessage(), e);
    }
  }

  /** Stores {@code config}, replacing what was stored. */
  public void save(Config config) {
    Objects.requireNonNull(config, "config");
    if (file == null) {
      memory = config;
      return;
    }
    JsonNodeFactory nodes = JsonNodeFactory.instance;
    ObjectNode root = nodes.objectNode();
    root.put("format", FORMAT);
    ObjectNode settings = root.putObject("pluginSettings");
    config.pluginSettings().forEach((id, values) -> settings.set(id, json.toNode(values)));
    ObjectNode dataTypes = root.putObject("dataTypes");
    config.dataTypes().forEach((id, b) -> {
      ObjectNode n = dataTypes.putObject(id);
      if (b.expiresAfterSeconds() != null) {
        n.put("expiresAfterSeconds", b.expiresAfterSeconds());
      }
      n.put("fadeWhenExpired", b.fadeWhenExpired());
      if (b.removeAfterExpirySeconds() != null) {
        n.put("removeAfterExpirySeconds", b.removeAfterExpirySeconds());
      }
    });
    if (config.defaultLook() != null) {
      root.put("defaultLook", config.defaultLook());
    }
    if (config.displayDefaults() != null) {
      root.set("displayDefaults", json.toNode(config.displayDefaults()));
    }
    if (config.labeling() != null) {
      root.set("labeling", json.toNode(config.labeling()));
    }
    if (!config.computeThreads().isEmpty()) {
      ObjectNode compute = root.putObject("computeThreads");
      config.computeThreads().forEach(compute::put);
    }
    try {
      PluginDocumentStore.write(file, root.toString());
    } catch (IOException e) {
      throw new UncheckedIOException("cannot write " + file, e);
    }
  }

  private static @Nullable Long optionalLong(JsonNode n, String name) {
    JsonNode v = n.get(name);
    return v == null || v.isNull() ? null : v.longValue();
  }
}
