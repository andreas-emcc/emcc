package dev.emcc.ecore.persistence;

import dev.emcc.ecore.json.InvalidDocumentException;
import dev.emcc.ecore.json.ModelJson;
import dev.emcc.sdk.json.JsonObject;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;

/**
 * Plugins' own small JSON documents (SDK v1 {@code Documents}; CR-0010 point 11; ADR-0024): per
 * plugin, a key maps to a JSON object. The limits are the SDK's: keys of lowercase letters, digits,
 * {@code -} and {@code .}, starting with a letter or digit, at most {@value #MAX_KEY} characters; at
 * most {@value #MAX_BYTES} bytes per document as UTF-8 JSON; at most {@value #MAX_DOCUMENTS}
 * documents per plugin.
 *
 * <p>With a data directory, each document is a file {@code documents/p-<plugin-id>/d-<key>.json},
 * replaced atomically. The prefixes keep names such as {@code con} or {@code nul}, which Windows
 * reserves, away from the file system. Without one (tests, the memory store), documents live in
 * memory only.
 *
 * <p>Not thread-safe: owned by one worker (rule C2), which answers the plugins' calls.
 */
public final class PluginDocumentStore {

  public static final int MAX_KEY = 128;
  public static final int MAX_BYTES = 1024 * 1024;
  public static final int MAX_DOCUMENTS = 1_000;
  public static final String FOLDER = "documents";

  private static final Pattern KEY = Pattern.compile("[a-z0-9][a-z0-9.-]*");
  private static final Logger LOG = LoggerFactory.getLogger(PluginDocumentStore.class);

  /** The answer to one call. */
  public sealed interface Result {
    record Found(JsonObject value) implements Result {}

    record Missing() implements Result {}

    record Written() implements Result {}

    record Failed(String reason) implements Result {}
  }

  private final @Nullable Path directory;
  private final ModelJson json;
  /** Each plugin's keys, read from its folder the first time the plugin calls. */
  private final Map<String, Set<String>> keys = new HashMap<>();
  /** Without a data directory: the documents themselves, as JSON text. */
  private final Map<String, Map<String, String>> memory = new HashMap<>();

  /** @param dataDirectory the data directory, or null to keep documents in memory only */
  public PluginDocumentStore(@Nullable Path dataDirectory, ModelJson json) {
    this.directory = dataDirectory == null ? null : dataDirectory.toAbsolutePath().normalize().resolve(FOLDER);
    this.json = json;
  }

  public Result get(String pluginId, String key) {
    String problem = checkKey(key);
    if (problem != null) {
      return new Result.Failed(problem);
    }
    if (!keys(pluginId).contains(key)) {
      return new Result.Missing();
    }
    try {
      String text = directory == null ? memory.get(pluginId).get(key) : Files.readString(file(pluginId, key), StandardCharsets.UTF_8);
      return new Result.Found((JsonObject) ModelJson.toJsonValue(json.parse(text)));
    } catch (IOException | InvalidDocumentException | ClassCastException e) {
      LOG.error("Cannot read document {} of plugin {}", key, pluginId, e);
      return new Result.Failed("the document cannot be read: " + e.getMessage());
    }
  }

  public Result put(String pluginId, String key, JsonObject value) {
    String problem = checkKey(key);
    if (problem != null) {
      return new Result.Failed(problem);
    }
    Set<String> existing = keys(pluginId);
    if (!existing.contains(key) && existing.size() >= MAX_DOCUMENTS) {
      return new Result.Failed("the plugin has " + MAX_DOCUMENTS + " documents, the most it may have");
    }
    JsonNode tree = json.toNode(value);
    String text = tree.toString();
    int bytes = text.getBytes(StandardCharsets.UTF_8).length;
    if (bytes > MAX_BYTES) {
      return new Result.Failed("the document has " + bytes + " bytes as JSON, more than " + MAX_BYTES);
    }
    try {
      if (directory == null) {
        memory.computeIfAbsent(pluginId, id -> new HashMap<>()).put(key, text);
      } else {
        write(file(pluginId, key), text);
      }
    } catch (IOException | UncheckedIOException e) {
      LOG.error("Cannot write document {} of plugin {}", key, pluginId, e);
      return new Result.Failed("the document cannot be stored: " + e.getMessage());
    }
    existing.add(key);
    return new Result.Written();
  }

  public Result delete(String pluginId, String key) {
    String problem = checkKey(key);
    if (problem != null) {
      return new Result.Failed(problem);
    }
    Set<String> existing = keys(pluginId);
    if (!existing.contains(key)) {
      return new Result.Written(); // nothing to remove
    }
    try {
      if (directory == null) {
        memory.get(pluginId).remove(key);
      } else {
        Files.deleteIfExists(file(pluginId, key));
      }
    } catch (IOException e) {
      LOG.error("Cannot delete document {} of plugin {}", key, pluginId, e);
      return new Result.Failed("the document cannot be removed: " + e.getMessage());
    }
    existing.remove(key);
    return new Result.Written();
  }

  /** The reason {@code key} is not a valid document key, or null. */
  static @Nullable String checkKey(String key) {
    Objects.requireNonNull(key, "key");
    return KEY.matcher(key).matches() && key.length() <= MAX_KEY
        ? null
        : "not a document key (lowercase letters, digits, - and ., starting with a letter or digit, at most " + MAX_KEY + "): " + key;
  }

  private Set<String> keys(String pluginId) {
    return keys.computeIfAbsent(pluginId, this::readKeys);
  }

  private Set<String> readKeys(String pluginId) {
    Set<String> found = new LinkedHashSet<>();
    if (directory == null) {
      return found;
    }
    Path folder = folder(pluginId);
    if (!Files.isDirectory(folder)) {
      return found;
    }
    try (Stream<Path> files = Files.list(folder)) {
      for (Path f : files.toList()) {
        String name = f.getFileName().toString();
        if (name.startsWith("d-") && name.endsWith(".json") && checkKey(name.substring(2, name.length() - 5)) == null) {
          found.add(name.substring(2, name.length() - 5));
        }
      }
    } catch (IOException e) {
      throw new UncheckedIOException("cannot list the documents of plugin " + pluginId + " in " + folder, e);
    }
    return found;
  }

  private Path folder(String pluginId) {
    return Objects.requireNonNull(directory).resolve("p-" + pluginId);
  }

  private Path file(String pluginId, String key) {
    return folder(pluginId).resolve("d-" + key + ".json");
  }

  /** Writes {@code text} to a temporary file, makes it durable, then renames it over {@code target}. */
  static void write(Path target, String text) throws IOException {
    Files.createDirectories(target.getParent());
    Path temporary = target.resolveSibling(target.getFileName() + ".tmp");
    try (FileOutputStream out = new FileOutputStream(temporary.toFile())) {
      out.write(text.getBytes(StandardCharsets.UTF_8));
      out.getChannel().force(true);
    }
    try {
      Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    } catch (AtomicMoveNotSupportedException e) {
      Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
    }
  }

  /** For the log and tests: the keys of a plugin's documents. */
  public List<String> keysOf(String pluginId) {
    return List.copyOf(keys(pluginId));
  }
}
