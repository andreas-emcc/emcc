package dev.emcc.ecore.persistence;

import dev.emcc.ecore.json.InvalidDocumentException;
import dev.emcc.ecore.json.ModelJson;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;

/**
 * Each user's own JSON documents (ADR-0027): per user and namespace (a plugin id, or {@code core}
 * for the shell), a name maps to any JSON value. Limits (ADR-0027 point 4, owner 2026-10-15): at
 * most {@value #MAX_BYTES} bytes per document as compact UTF-8 JSON, {@value #MAX_PER_NAMESPACE}
 * documents per namespace and user, and {@value #MAX_PER_USER} bytes per user in all. Names are
 * lowercase letters, digits, {@code -} and {@code .}, starting with a letter or digit, at most
 * {@value #MAX_NAME} characters (as the plugins' document keys).
 *
 * <p>With a data directory, a user's documents are under {@code user-documents/u-<sha-256 of the
 * user id>/}: {@code user.json} names the user, and each document is a file {@code
 * n-<namespace>/d-<name>.json}, replaced atomically. The hash keeps any user id (an IAM's {@code
 * sub}) out of file names. Without one (tests, the memory store), documents live in memory only.
 *
 * <p>Not thread-safe: owned by one worker (rule C2).
 */
public final class UserDocumentStore {

  public static final int MAX_NAME = 128;
  public static final int MAX_BYTES = 256 * 1024;
  public static final int MAX_PER_NAMESPACE = 200;
  public static final long MAX_PER_USER = 4L * 1024 * 1024;
  public static final String FOLDER = "user-documents";
  /** The shell's namespace (ADR-0027 point 1): ECore's own id, which no plugin may use. */
  public static final String CORE = "core";

  private static final Pattern NAME = Pattern.compile("[a-z0-9][a-z0-9.-]*");
  /** {@code core}, or a plugin id. */
  private static final Pattern NAMESPACE = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");
  private static final int MAX_NAMESPACE = 64;
  private static final Logger LOG = LoggerFactory.getLogger(UserDocumentStore.class);

  /** The answer to one call. */
  public sealed interface Result {
    /** The document, as compact JSON text. */
    record Found(String json) implements Result {}

    /** The names of a namespace's documents, sorted. */
    record Names(List<String> names) implements Result {
      public Names {
        names = List.copyOf(names);
      }
    }

    record Missing() implements Result {}

    record Written() implements Result {}

    /** The call breaks a rule or a limit; nothing changed. */
    record Refused(Reason reason, String message) implements Result {}

    /** The store could not do it (e.g. the disk); nothing changed, or the old document stays. */
    record Failed(String reason) implements Result {}

    /** For callers: the call was not done, the store's worker had no room for it; try again. */
    record Busy() implements Result {}
  }

  /** Why a call was refused. */
  public enum Reason {
    /** A name or namespace that is not one. */
    INVALID,
    /** For callers: a namespace that is neither {@code core} nor a running plugin with a web part. */
    UNKNOWN_NAMESPACE,
    /** The document would be larger than allowed. */
    TOO_LARGE,
    /** The user's documents in all would be larger than allowed. */
    USER_FULL,
    /** The namespace already has the most documents it may have. */
    TOO_MANY
  }

  /** One user's documents: per namespace, each name's size in bytes. */
  private static final class Index {
    final Map<String, Map<String, Integer>> sizes = new HashMap<>();
    long total;

    Map<String, Integer> of(String namespace) {
      return sizes.computeIfAbsent(namespace, n -> new TreeMap<>());
    }
  }

  private final @Nullable Path directory;
  private final ModelJson json;
  /** Each user's index, by the user's folder key; read from disk the first time the user calls. */
  private final Map<String, Index> indexes = new HashMap<>();
  /** Without a data directory: the documents, as JSON text, by user key, namespace and name. */
  private final Map<String, Map<String, Map<String, String>>> memory = new HashMap<>();

  /** @param dataDirectory the data directory, or null to keep documents in memory only */
  public UserDocumentStore(@Nullable Path dataDirectory, ModelJson json) {
    this.directory = dataDirectory == null ? null : dataDirectory.toAbsolutePath().normalize().resolve(FOLDER);
    this.json = Objects.requireNonNull(json, "json");
  }

  public Result get(String user, String namespace, String name) {
    Result refused = check(namespace, name);
    if (refused != null) {
      return refused;
    }
    String key = keyOf(user);
    if (!index(key).of(namespace).containsKey(name)) {
      return new Result.Missing();
    }
    try {
      String text = directory == null ? memory.get(key).get(namespace).get(name) : Files.readString(file(key, namespace, name), StandardCharsets.UTF_8);
      return new Result.Found(json.parse(text).toString()); // a damaged file is no document
    } catch (IOException | InvalidDocumentException e) {
      // The detail (it may name the server's folders) goes to the log only (review F2).
      LOG.error("Cannot read user document {}/{} of user folder {}", namespace, name, key, e);
      return new Result.Failed("the document cannot be read");
    }
  }

  public Result list(String user, String namespace) {
    Result refused = check(namespace, null);
    if (refused != null) {
      return refused;
    }
    return new Result.Names(List.copyOf(index(keyOf(user)).of(namespace).keySet()));
  }

  public Result put(String user, String namespace, String name, JsonNode value) {
    Result refused = check(namespace, name);
    if (refused != null) {
      return refused;
    }
    String text = Objects.requireNonNull(value, "value").toString();
    int bytes = text.getBytes(StandardCharsets.UTF_8).length;
    if (bytes > MAX_BYTES) {
      return new Result.Refused(Reason.TOO_LARGE, "the document has " + bytes + " bytes as JSON, more than " + MAX_BYTES);
    }
    String key = keyOf(user);
    Index index = index(key);
    Map<String, Integer> names = index.of(namespace);
    Integer before = names.get(name);
    if (before == null && names.size() >= MAX_PER_NAMESPACE) {
      return new Result.Refused(Reason.TOO_MANY, "the namespace " + namespace + " has " + MAX_PER_NAMESPACE + " documents, the most it may have");
    }
    long total = index.total - (before == null ? 0 : before) + bytes;
    if (total > MAX_PER_USER) {
      return new Result.Refused(Reason.USER_FULL, "the user's documents would have " + total + " bytes, more than " + MAX_PER_USER);
    }
    try {
      if (directory == null) {
        memory.computeIfAbsent(key, k -> new HashMap<>()).computeIfAbsent(namespace, n -> new HashMap<>()).put(name, text);
      } else {
        Path userFile = folder(key).resolve("user.json");
        if (!Files.exists(userFile)) {
          PluginDocumentStore.write(userFile, JsonNodeFactory.instance.objectNode().put("user", user).toString());
        }
        PluginDocumentStore.write(file(key, namespace, name), text);
      }
    } catch (IOException | UncheckedIOException e) {
      LOG.error("Cannot write user document {}/{} of user folder {}", namespace, name, key, e);
      return new Result.Failed("the document cannot be stored");
    }
    names.put(name, bytes);
    index.total = total;
    return new Result.Written();
  }

  /** Removes a document; one that is not there is no error. */
  public Result delete(String user, String namespace, String name) {
    Result refused = check(namespace, name);
    if (refused != null) {
      return refused;
    }
    String key = keyOf(user);
    Index index = index(key);
    Integer before = index.of(namespace).get(name);
    if (before == null) {
      return new Result.Written();
    }
    try {
      if (directory == null) {
        memory.get(key).get(namespace).remove(name);
      } else {
        Files.deleteIfExists(file(key, namespace, name));
      }
    } catch (IOException e) {
      LOG.error("Cannot delete user document {}/{} of user folder {}", namespace, name, key, e);
      return new Result.Failed("the document cannot be removed");
    }
    index.of(namespace).remove(name);
    index.total -= before;
    return new Result.Written();
  }

  /** A refusal if {@code namespace} or {@code name} (when given) is not one, else null. */
  private static Result.@Nullable Refused check(String namespace, @Nullable String name) {
    Objects.requireNonNull(namespace, "namespace");
    if (namespace.length() > MAX_NAMESPACE || !NAMESPACE.matcher(namespace).matches()) {
      return new Result.Refused(Reason.INVALID, "not a namespace (core or a plugin id): " + namespace);
    }
    if (name != null && (name.length() > MAX_NAME || !NAME.matcher(name).matches())) {
      return new Result.Refused(Reason.INVALID,
          "not a document name (lowercase letters, digits, - and ., starting with a letter or digit, at most " + MAX_NAME + "): " + name);
    }
    return null;
  }

  /** The user's folder key: the SHA-256 of the user id, in hex. */
  static String keyOf(String user) {
    Objects.requireNonNull(user, "user");
    if (user.isEmpty()) {
      throw new IllegalArgumentException("a user id is not empty");
    }
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(user.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("every Java platform has SHA-256", e);
    }
  }

  private Index index(String key) {
    return indexes.computeIfAbsent(key, this::readIndex);
  }

  private Index readIndex(String key) {
    Index index = new Index();
    if (directory == null) {
      return index;
    }
    Path folder = folder(key);
    if (!Files.isDirectory(folder)) {
      return index;
    }
    try (Stream<Path> namespaces = Files.list(folder)) {
      for (Path n : namespaces.filter(Files::isDirectory).toList()) {
        String namespace = n.getFileName().toString();
        if (!namespace.startsWith("n-") || check(namespace.substring(2), null) != null) {
          continue;
        }
        try (Stream<Path> files = Files.list(n)) {
          for (Path f : files.toList()) {
            String file = f.getFileName().toString();
            String name = file.startsWith("d-") && file.endsWith(".json") ? file.substring(2, file.length() - 5) : "";
            if (check(namespace.substring(2), name) != null) {
              continue; // not a document: a temporary file of an interrupted write, or something foreign
            }
            if (!Files.isRegularFile(f)) {
              LOG.warn("Ignoring {} in user folder {}: not a file", file, key);
            } else {
              int bytes = (int) Files.size(f);
              index.of(namespace.substring(2)).put(name, bytes);
              index.total += bytes;
            }
          }
        }
      }
    } catch (IOException e) {
      throw new UncheckedIOException("cannot list the user documents in " + folder, e);
    }
    return index;
  }

  private Path folder(String key) {
    return Objects.requireNonNull(directory).resolve("u-" + key);
  }

  private Path file(String key, String namespace, String name) {
    return folder(key).resolve("n-" + namespace).resolve("d-" + name + ".json");
  }
}
