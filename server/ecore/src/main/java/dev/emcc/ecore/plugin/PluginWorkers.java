package dev.emcc.ecore.plugin;

import dev.emcc.ecore.runtime.Answer;
import dev.emcc.ecore.runtime.HandlerContext;
import dev.emcc.ecore.runtime.MessageHandler;
import dev.emcc.ecore.runtime.Owner;
import dev.emcc.ecore.runtime.ReplyHandle;
import dev.emcc.ecore.runtime.SendOutcome;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginLog;
import dev.emcc.sdk.worker.Coalescing;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.Reply;
import dev.emcc.sdk.worker.ReplyTo;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerContext;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import dev.emcc.sdk.worker.Workers;
import java.time.Duration;
import java.util.Objects;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * The SDK's workers on ECore's runtime, one to one (SDK v0 design, "Messages and workers"):
 * {@code WorkerSpec} becomes {@code WorkerOptions}, {@code WorkerRef} wraps a {@code WorkerHandle},
 * {@code ask} and {@code Reply} map onto the runtime's {@code ask} and {@code Answer}.
 *
 * <p>A plugin worker's thread has the plugin's class loader as its context class loader from its
 * start (overview 4.2), so that threads started by a plugin or its libraries can be attributed.
 * Each handler call sets it again in case plugin code changed it; the first handler factory, which
 * runs on the spawning thread, gets it for the duration of the call.
 */
final class PluginWorkers implements Workers {

  private final String pluginId;
  private final Owner owner;
  private final ClassLoader loader;

  PluginWorkers(String pluginId, Owner owner, ClassLoader loader) {
    this.pluginId = pluginId;
    this.owner = owner;
    this.loader = loader;
  }

  @Override
  public <M extends Message> WorkerRef<M> spawn(WorkerSpec<M> spec) {
    Objects.requireNonNull(spec, "spec");
    WorkerOptions<M> options = WorkerOptions.<M>of(spec.name(), () -> newHandler(spec))
        .mailbox(spec.mailboxCapacity(), overflow(spec.overflow()))
        .budget(spec.budget())
        .restartable(spec.restartable())
        .coalesceKey(PluginWorkers::coalesceKey)
        .contextClassLoader(loader)
        .compute(spec.compute()); // rule C7: the SDK has set its 30 s budget already
    return new Ref<>(owner.spawn(options), spec.messageType());
  }

  /** Runs the plugin's factory with its class loader; on a restart this is the worker's own thread. */
  private <M extends Message> MessageHandler<M> newHandler(WorkerSpec<M> spec) {
    Thread thread = Thread.currentThread();
    ClassLoader previous = thread.getContextClassLoader();
    thread.setContextClassLoader(loader);
    try {
      Handler<M> handler = Objects.requireNonNull(spec.handlerFactory().get(), "the handler factory returned null");
      return new Adapter<>(handler, spec.messageType());
    } finally {
      thread.setContextClassLoader(previous);
    }
  }

  static dev.emcc.ecore.runtime.Overflow overflow(Overflow<?> overflow) {
    return switch (overflow) {
      case Overflow.DropOldest<?> d -> dev.emcc.ecore.runtime.Overflow.DROP_OLDEST;
      case Overflow.DropNewest<?> d -> dev.emcc.ecore.runtime.Overflow.DROP_NEWEST;
      case Overflow.CoalesceByKey<?> c -> dev.emcc.ecore.runtime.Overflow.COALESCE_BY_KEY;
    };
  }

  /** The key is data of the message, or of a topic payload (SDK: {@link Coalescing}). */
  static @Nullable Object coalesceKey(Object messageOrPayload) {
    return messageOrPayload instanceof Coalescing c ? c.coalesceKey() : null;
  }

  static SendResult result(SendOutcome outcome) {
    return switch (outcome) {
      case ACCEPTED -> SendResult.ACCEPTED;
      case DROPPED -> SendResult.DROPPED;
      case CLOSED -> SendResult.CLOSED;
    };
  }

  /** The runtime handle behind a reference, which ECore made (plugins cannot make their own). */
  static <M extends Message> WorkerHandle<M> handleOf(WorkerRef<M> ref) {
    Objects.requireNonNull(ref, "worker");
    if (!(ref instanceof Ref<M> r)) {
      throw new IllegalArgumentException("not a worker reference made by ECore: " + ref);
    }
    return r.handle;
  }

  // ---- Handles ----------------------------------------------------------------------------------

  /** A {@link WorkerRef}: an immutable value, equal by id. */
  static final class Ref<M extends Message> implements WorkerRef<M> {
    private final WorkerHandle<M> handle;
    private final Class<M> type;
    private final HandleId id;

    Ref(WorkerHandle<M> handle, Class<M> type) {
      this.handle = handle;
      this.type = type;
      this.id = new HandleId(handle.id());
    }

    @Override
    public HandleId id() {
      return id;
    }

    @Override
    public String name() {
      return handle.name();
    }

    @Override
    public SendResult send(M message) {
      Objects.requireNonNull(message, "message");
      if (!type.isInstance(message)) {
        throw new IllegalArgumentException(
            "worker " + handle.id() + " accepts " + type.getName() + ", not " + message.getClass().getName());
      }
      return result(handle.send(message));
    }

    @Override
    public boolean equals(@Nullable Object other) {
      return other instanceof Ref<?> r && id.equals(r.id);
    }

    @Override
    public int hashCode() {
      return id.hashCode();
    }

    @Override
    public String toString() {
      return "WorkerRef[" + id.value() + "]";
    }
  }

  /** A {@link ReplyTo} over the runtime's one-shot reply handle: equal by id. */
  record ReplyToHandle<R extends Message>(HandleId id, ReplyHandle<R> handle) implements ReplyTo<R> {

    ReplyToHandle(ReplyHandle<R> handle) {
      this(new HandleId(handle.id()), handle);
    }

    @Override
    public void reply(R value) {
      handle.reply(Objects.requireNonNull(value, "value"));
    }

    @Override
    public void fail(String reason) {
      handle.fail(Objects.requireNonNull(reason, "reason"));
    }

    @Override
    public boolean equals(@Nullable Object other) {
      return other instanceof ReplyToHandle<?> r && id.equals(r.id);
    }

    @Override
    public int hashCode() {
      return id.hashCode();
    }
  }

  // ---- Handler and context ----------------------------------------------------------------------

  /** Runs the plugin's handler with the plugin's class loader and an SDK context. */
  private final class Adapter<M extends Message> implements MessageHandler<M> {
    private final Handler<M> handler;
    private final Class<M> type;
    private @Nullable HandlerContext<M> runtimeContext;
    private @Nullable Context<M> context;

    Adapter(Handler<M> handler, Class<M> type) {
      this.handler = handler;
      this.type = type;
    }

    @Override
    public void handle(M message, HandlerContext<M> ctx) {
      Thread thread = Thread.currentThread();
      if (thread.getContextClassLoader() != loader) {
        thread.setContextClassLoader(loader);
      }
      Context<M> c = context;
      if (c == null || runtimeContext != ctx) {
        c = new Context<>(ctx, new Ref<>(ctx.self(), type), new PluginLogger(pluginId, ctx.self().name()));
        context = c;
        runtimeContext = ctx;
      }
      handler.handle(message, c);
    }
  }

  /** A {@link WorkerContext} over the runtime's handler context (fenced with it after a restart). */
  private record Context<M extends Message>(HandlerContext<M> runtime, Ref<M> self, PluginLog log)
      implements WorkerContext<M> {

    @Override
    public <Q extends Message, R extends Message> void ask(
        WorkerRef<Q> target, Function<ReplyTo<R>, ? extends Q> request, Duration timeout,
        Function<Reply<R>, ? extends M> toMessage) {
      Objects.requireNonNull(request, "request");
      Objects.requireNonNull(toMessage, "toMessage");
      runtime.<Q, R>ask(handleOf(target), handle -> request.apply(new ReplyToHandle<>(handle)), timeout,
          answer -> toMessage.apply(reply(answer)));
    }

    private static <R extends Message> Reply<R> reply(Answer<R> answer) {
      return switch (answer) {
        case Answer.Ok<R> ok -> new Reply.Ok<>(ok.value());
        case Answer.Failed<R> failed -> new Reply.Failed<>(failed.reason());
        case Answer.TimedOut<R> timedOut -> new Reply.TimedOut<>();
      };
    }
  }
}
