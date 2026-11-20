package dev.emcc.ecore.plugin;

import dev.emcc.ecore.persistence.PluginDocumentStore;
import dev.emcc.ecore.runtime.Answer;
import dev.emcc.ecore.runtime.MessageHandler;
import dev.emcc.ecore.runtime.Overflow;
import dev.emcc.ecore.runtime.Owner;
import dev.emcc.ecore.runtime.ReplyHandle;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.document.DocumentResult;
import dev.emcc.sdk.document.Documents;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.worker.WorkerRef;
import java.util.Objects;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * One plugin's documents (SDK v1 {@code Documents}; CR-0010 point 11). Every call is an ask on the
 * plugin's behalf to ECore's documents worker, which owns the {@link PluginDocumentStore}: it counts
 * under the plugin's cap of outstanding asks (CR-0005), and its one answer arrives within {@link
 * Documents#ANSWER_WITHIN}, always delivered.
 */
final class PluginDocuments implements Documents {

  /** The owner of the documents worker. */
  static final String OWNER = "core-documents";

  /** A call to the documents worker; {@code value} only for a put. */
  record Call(Kind kind, String pluginId, String key, @Nullable JsonObject value, ReplyHandle<PluginDocumentStore.Result> replyTo) {}

  enum Kind { GET, PUT, DELETE }

  private final String pluginId;
  private final Owner owner;
  private final WorkerRuntime runtime;
  private final WorkerHandle<Call> worker;

  PluginDocuments(String pluginId, Owner owner, WorkerRuntime runtime, WorkerHandle<Call> worker) {
    this.pluginId = pluginId;
    this.owner = owner;
    this.runtime = runtime;
    this.worker = worker;
  }

  /** Starts ECore's documents worker, the single user of {@code store} (rule C2). */
  static WorkerHandle<Call> startWorker(WorkerRuntime runtime, PluginDocumentStore store) {
    MessageHandler<Call> handler = (call, ctx) -> call.replyTo().reply(switch (call.kind()) {
      case GET -> store.get(call.pluginId(), call.key());
      case PUT -> store.put(call.pluginId(), call.key(), Objects.requireNonNull(call.value()));
      case DELETE -> store.delete(call.pluginId(), call.key());
    });
    return runtime.owner(OWNER).spawn(WorkerOptions.<Call>of("documents", () -> handler).mailbox(10_000, Overflow.DROP_NEWEST));
  }

  @Override
  public <M extends Message> void get(String key, WorkerRef<M> target, Function<DocumentResult, ? extends M> toMessage) {
    call(Kind.GET, key, null, target, toMessage);
  }

  @Override
  public <M extends Message> void put(String key, JsonObject value, WorkerRef<M> target, Function<DocumentResult, ? extends M> toMessage) {
    call(Kind.PUT, key, Objects.requireNonNull(value, "value"), target, toMessage);
  }

  @Override
  public <M extends Message> void delete(String key, WorkerRef<M> target, Function<DocumentResult, ? extends M> toMessage) {
    call(Kind.DELETE, key, null, target, toMessage);
  }

  private <M extends Message> void call(
      Kind kind, String key, @Nullable JsonObject value, WorkerRef<M> target, Function<DocumentResult, ? extends M> toMessage) {
    Objects.requireNonNull(key, "key");
    Objects.requireNonNull(toMessage, "toMessage");
    runtime.<Call, PluginDocumentStore.Result, M>askFor(owner, worker, replyTo -> new Call(kind, pluginId, key, value, replyTo),
        Documents.ANSWER_WITHIN, PluginWorkers.handleOf(target), answer -> toMessage.apply(result(key, answer)));
  }

  private static DocumentResult result(String key, Answer<PluginDocumentStore.Result> answer) {
    return switch (answer) {
      case Answer.Ok<PluginDocumentStore.Result> ok -> switch (ok.value()) {
        case PluginDocumentStore.Result.Found found -> new DocumentResult.Found(key, found.value());
        case PluginDocumentStore.Result.Missing missing -> new DocumentResult.Missing(key);
        case PluginDocumentStore.Result.Written written -> new DocumentResult.Written(key);
        case PluginDocumentStore.Result.Failed failed -> new DocumentResult.Failed(key, failed.reason());
      };
      case Answer.Failed<PluginDocumentStore.Result> failed -> new DocumentResult.Failed(key, failed.reason());
      case Answer.TimedOut<PluginDocumentStore.Result> timedOut ->
          new DocumentResult.Failed(key, "no answer within " + Documents.ANSWER_WITHIN.toSeconds() + " s");
    };
  }
}
