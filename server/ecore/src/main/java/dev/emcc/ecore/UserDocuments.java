package dev.emcc.ecore;

import dev.emcc.ecore.persistence.UserDocumentStore;
import dev.emcc.ecore.persistence.UserDocumentStore.Result;
import dev.emcc.ecore.runtime.MessageHandler;
import dev.emcc.ecore.runtime.Overflow;
import dev.emcc.ecore.runtime.ReplyHandle;
import dev.emcc.ecore.runtime.SendOutcome;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import java.time.Duration;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.function.Predicate;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;

/**
 * Each user's own documents (ADR-0027), for the edge: every call goes to ECore's user documents
 * worker, the single user of the {@link UserDocumentStore} (rule C2), and gets one answer, also
 * when the worker refuses or drops it. The caller names the user (the login session's, never what a
 * browser sends) and the namespace: {@code core} for the shell, or the id of a running plugin with
 * a web part (CR-0015: web parts only in SDK 1.1.0).
 */
public final class UserDocuments {

  /** The owner of the user documents worker. */
  public static final String OWNER = "core-user-documents";
  /** The caller's timeout: the worker does little I/O per call. */
  public static final Duration ANSWER_WITHIN = Duration.ofSeconds(10);

  /**
   * The name of each user's display choices in {@code core} (SDK 1.4.0, ADR-0046 point 2): {@link
   * #call} reads it, but only {@link DisplaySettings} writes it, checked, and tells the user's browsers.
   */
  public static final String DISPLAY = "display";

  /** What to do. */
  public enum Kind { GET, LIST, PUT, DELETE }

  /**
   * One call. {@code name} for all but {@link Kind#LIST}; {@code value} only for a put.
   *
   * @param user the user id ({@code source.user}: the IAM's {@code sub}, {@code local} without login)
   */
  public record Call(Kind kind, String user, String namespace, @Nullable String name, @Nullable JsonNode value) {
    public Call {
      Objects.requireNonNull(kind, "kind");
      Objects.requireNonNull(user, "user");
      Objects.requireNonNull(namespace, "namespace");
      if ((kind == Kind.LIST) != (name == null) || (kind == Kind.PUT) == (value == null)) {
        throw new IllegalArgumentException("a " + kind + " call has " + (kind == Kind.LIST ? "no name" : "a name")
            + (kind == Kind.PUT ? " and a value" : " and no value"));
      }
    }
  }

  /** A call and where its one answer goes. */
  private record Message(Call call, ReplyHandle<Result> replyTo) {}

  /** Gives the caller's consumer the first answer only (a dropped message and its reply may race). */
  private static final class Once implements ReplyHandle<Result> {
    private final String id = "user-documents-" + UUID.randomUUID();
    private final Consumer<Result> answer;
    private final AtomicBoolean answered = new AtomicBoolean();

    Once(Consumer<Result> answer) {
      this.answer = answer;
    }

    @Override
    public String id() {
      return id;
    }

    @Override
    public void reply(Result value) {
      if (answered.compareAndSet(false, true)) {
        answer.accept(value);
      }
    }

    @Override
    public void fail(String reason) {
      reply(new Result.Failed(reason));
    }
  }

  private static final Logger LOG = LoggerFactory.getLogger(UserDocuments.class);

  private final WorkerRuntime runtime;
  private final WorkerHandle<Message> worker;
  private final Predicate<String> pluginWithWebPart;

  /**
   * @param pluginWithWebPart whether a namespace other than {@code core} is a running plugin with a
   *     web part
   */
  UserDocuments(WorkerRuntime runtime, UserDocumentStore store, Predicate<String> pluginWithWebPart) {
    this.runtime = runtime;
    this.pluginWithWebPart = pluginWithWebPart;
    MessageHandler<Message> handler = (message, context) -> message.replyTo().reply(apply(store, message.call()));
    this.worker = runtime.owner(OWNER).spawn(WorkerOptions.<Message>of("user-documents", () -> handler).mailbox(1_000, Overflow.DROP_NEWEST));
  }

  /**
   * Does {@code call} and gives {@code answer} its one result, in the worker or, when the call is
   * refused at once (an unknown namespace, a full mailbox), in the calling thread. Never blocks.
   */
  public void call(Call call, Consumer<Result> answer) {
    Objects.requireNonNull(call, "call");
    Objects.requireNonNull(answer, "answer");
    if (call.namespace().equals(UserDocumentStore.CORE) && DISPLAY.equals(call.name())
        && (call.kind() == Kind.PUT || call.kind() == Kind.DELETE)) {
      answer.accept(new Result.Refused(UserDocumentStore.Reason.INVALID, "the display settings are changed through /api/display"));
      return;
    }
    send(call, answer);
  }

  /** As {@link #call}, without keeping {@link #DISPLAY} from being written: for {@link DisplaySettings}. */
  void send(Call call, Consumer<Result> answer) {
    if (!call.namespace().equals(UserDocumentStore.CORE) && !pluginWithWebPart.test(call.namespace())) {
      answer.accept(new Result.Refused(UserDocumentStore.Reason.UNKNOWN_NAMESPACE,
          "no running plugin with a web part has the id " + call.namespace()));
      return;
    }
    Once once = new Once(answer);
    SendOutcome outcome = runtime.deliver(worker, () -> new Message(call, once), null, () -> once.reply(new Result.Busy()));
    if (outcome != SendOutcome.ACCEPTED) {
      once.reply(new Result.Busy());
    }
  }

  private static Result apply(UserDocumentStore store, Call call) {
    try {
      return switch (call.kind()) {
        case GET -> store.get(call.user(), call.namespace(), Objects.requireNonNull(call.name()));
        case LIST -> store.list(call.user(), call.namespace());
        case PUT -> store.put(call.user(), call.namespace(), Objects.requireNonNull(call.name()), Objects.requireNonNull(call.value()));
        case DELETE -> store.delete(call.user(), call.namespace(), Objects.requireNonNull(call.name()));
      };
    } catch (RuntimeException e) {
      LOG.error("The user documents failed on {} {}/{}", call.kind(), call.namespace(), call.name(), e);
      return new Result.Failed("the user documents failed"); // the detail may name the server's folders (review F2)
    }
  }
}
