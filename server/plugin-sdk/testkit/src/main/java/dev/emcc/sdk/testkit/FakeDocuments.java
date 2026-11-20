package dev.emcc.sdk.testkit;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.document.DocumentResult;
import dev.emcc.sdk.document.Documents;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.worker.WorkerRef;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;

/**
 * The plugin documents of {@link FakePluginContext} ({@code ctx.documents()}), in memory, with
 * ECore's limits ({@link Documents#MAX_DOCUMENT_BYTES}, {@link Documents#MAX_DOCUMENTS}). Answers
 * arrive at the next {@code runUntilIdle()} and count as outstanding asks.
 *
 * <pre>{@code
 * ctx.documents().seed("layers", JsonObject.of(Map.of("tak-north", JsonString.of(layerId.toString()))));
 * plugin.start();
 * ctx.runUntilIdle();
 * assertThat(ctx.documents().stored()).containsKey("layers");
 * }</pre>
 */
public final class FakeDocuments implements Documents {

  private final FakePluginContext ctx;
  private final Map<String, JsonObject> documents = new LinkedHashMap<>();
  private final Deque<String> failures = new ArrayDeque<>();

  FakeDocuments(FakePluginContext ctx) {
    this.ctx = ctx;
  }

  @Override
  public <M extends Message> void get(String key, WorkerRef<M> target, Function<DocumentResult, ? extends M> toMessage) {
    Documents.checkKey(key);
    answer(key, target, toMessage, () -> {
      JsonObject value = documents.get(key);
      return value == null ? new DocumentResult.Missing(key) : new DocumentResult.Found(key, value);
    });
  }

  @Override
  public <M extends Message> void put(String key, JsonObject value, WorkerRef<M> target, Function<DocumentResult, ? extends M> toMessage) {
    Documents.checkKey(key);
    Objects.requireNonNull(value, "value");
    answer(key, target, toMessage, () -> {
      int bytes = TestJson.write(value).getBytes(StandardCharsets.UTF_8).length;
      if (bytes > MAX_DOCUMENT_BYTES) {
        return new DocumentResult.Failed(key, "document larger than " + MAX_DOCUMENT_BYTES + " bytes: " + bytes);
      }
      if (!documents.containsKey(key) && documents.size() >= MAX_DOCUMENTS) {
        return new DocumentResult.Failed(key, "the plugin already has " + MAX_DOCUMENTS + " documents");
      }
      documents.put(key, value);
      return new DocumentResult.Written(key);
    });
  }

  @Override
  public <M extends Message> void delete(String key, WorkerRef<M> target, Function<DocumentResult, ? extends M> toMessage) {
    Documents.checkKey(key);
    answer(key, target, toMessage, () -> {
      documents.remove(key);
      return new DocumentResult.Written(key);
    });
  }

  private <M extends Message> void answer(
      String key, WorkerRef<M> target, Function<DocumentResult, ? extends M> toMessage, java.util.function.Supplier<DocumentResult> operation) {
    DocumentResult result;
    if (!ctx.takeAsk()) {
      result = new DocumentResult.Failed(key, FakePluginContext.TOO_MANY_ASKS);
    } else {
      String failure = failures.poll();
      result = failure != null ? new DocumentResult.Failed(key, failure) : operation.get();
      ctx.returnAsk();
    }
    ctx.deliverAlways(target, () -> toMessage.apply(result));
  }

  // ---------------------------------------------------------------- test controls

  /** Stores a document as it is, e.g. one a previous run of the plugin wrote (test setup). */
  public void seed(String key, JsonObject value) {
    documents.put(Documents.checkKey(key), Objects.requireNonNull(value, "value"));
  }

  /** The next call fails with {@code reason}, e.g. a full disk. */
  public void failNext(String reason) {
    failures.add(Objects.requireNonNull(reason, "reason"));
  }

  /** The documents as they are now. */
  public Map<String, JsonObject> stored() {
    return Collections.unmodifiableMap(documents);
  }
}
