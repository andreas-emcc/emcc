package dev.emcc.sdk.document;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Duration;
import java.util.Objects;
import java.util.function.Function;
import java.util.regex.Pattern;

/**
 * The plugin's own documents in the persistence manager: a key maps to a {@link JsonObject}, in
 * the plugin's namespace (no plugin sees another's). Every call returns at once; exactly one
 * {@link DocumentResult} arrives later in {@code target}'s mailbox, converted by {@code toMessage}
 * (plugin code: pure, non-blocking, run in that worker). Answers are always delivered and count as
 * outstanding asks (CR-0005). ECore answers within {@link #ANSWER_WITHIN}, at the latest with
 * {@link DocumentResult.Failed}.
 *
 * <p><b>Write-behind</b> (ADR-0024): {@link DocumentResult.Written} means applied in memory; it
 * is stored shortly after, and a crash can lose the last moments.
 *
 * <pre>{@code
 * documents.put("layers", JsonObject.of(Map.of("tak-north", JsonString.of(layerId.toString()))), self, Saved::new);
 * }</pre>
 */
public interface Documents {

  /** The largest document, as UTF-8 JSON. */
  int MAX_DOCUMENT_BYTES = 1024 * 1024;

  /** The most documents per plugin. */
  int MAX_DOCUMENTS = 1_000;

  /** The pattern of a key: see {@link #checkKey}. */
  Pattern KEY_PATTERN = Pattern.compile("[a-z0-9][a-z0-9.-]*");

  /** ECore answers every call within this time. */
  Duration ANSWER_WITHIN = Duration.ofSeconds(10);

  /** Answers {@link DocumentResult.Found} or {@link DocumentResult.Missing}. */
  <M extends Message> void get(String key, WorkerRef<M> target, Function<DocumentResult, ? extends M> toMessage);

  /** Creates or replaces the document. Answers {@link DocumentResult.Written}, or {@link DocumentResult.Failed} (e.g. too large, too many). */
  <M extends Message> void put(String key, JsonObject value, WorkerRef<M> target, Function<DocumentResult, ? extends M> toMessage);

  /** Removes the document, if there is one. Answers {@link DocumentResult.Written}. */
  <M extends Message> void delete(String key, WorkerRef<M> target, Function<DocumentResult, ? extends M> toMessage);

  /**
   * Returns {@code key} if it is a valid document key: lowercase letters, digits, {@code -} and
   * {@code .}, starting with a letter or digit, at most 128 characters.
   *
   * @throws IllegalArgumentException otherwise
   */
  static String checkKey(String key) {
    Objects.requireNonNull(key, "key");
    if (!KEY_PATTERN.matcher(key).matches() || key.length() > 128) {
      throw new IllegalArgumentException("not a document key: " + key);
    }
    return key;
  }
}
