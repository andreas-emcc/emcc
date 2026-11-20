package dev.emcc.ecore.plugin;

import dev.emcc.ecore.plugin.TaskEngine.Change;
import dev.emcc.ecore.plugin.TaskEngine.RestartRule;
import dev.emcc.ecore.runtime.Inbox;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginLog;
import dev.emcc.sdk.connection.ConnectionEvent;
import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.connection.ConnectionSpec;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.Connections;
import dev.emcc.sdk.connection.Restart;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.net.SocketAddress;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import org.jspecify.annotations.Nullable;

/**
 * One plugin's {@link Connections} (SDK 1.2.0, ADR-0036): the SDK's view of its {@link TaskEngine}.
 * {@link TaskContext} goes over one run ({@link TaskEngine.Attempt}), {@link ConnectionRef} over the
 * task. The inbox is ECore's {@link Inbox}, with the spec's capacity and overflow; a coalescing key
 * is the item's own ({@code Coalescing}), read before the inbox's lock. TLS comes by name from the
 * local configuration that listeners use too (owner, 2026-10-24); {@code tls(name)}'s sockets check
 * the peer's host name, as listeners do (owner, 2026-10-26).
 */
final class PluginConnections implements Connections {

  /** The shortest and longest wait of {@link TaskContext#poll}. */
  private static final Duration MIN_POLL = Duration.ofMillis(1);
  private static final Duration MAX_POLL = Duration.ofHours(1);

  private final String pluginId;
  private final WorkerRuntime runtime;
  private final TaskEngine engine;
  private final ListenerConfig config;
  private final AtomicLong ids = new AtomicLong();

  PluginConnections(String pluginId, WorkerRuntime runtime, TaskEngine engine, ListenerConfig config) {
    this.pluginId = pluginId;
    this.runtime = runtime;
    this.engine = engine;
    this.config = config;
  }

  @Override
  public <I extends Message> ConnectionRef<I> start(ConnectionSpec<I> spec, Supplier<? extends ConnectionTask<I>> factory) {
    return begin(Objects.requireNonNull(spec, "spec").name(), null, spec, factory, change -> {});
  }

  @Override
  public <I extends Message, M extends Message> ConnectionRef<I> start(ConnectionSpec<I> spec,
      Supplier<? extends ConnectionTask<I>> factory, WorkerRef<M> events, Function<ConnectionEvent, ? extends M> toMessage) {
    Objects.requireNonNull(toMessage, "toMessage");
    EventQueue<ConnectionEvent, M> queue = new EventQueue<>(
        runtime, PluginWorkers.handleOf(Objects.requireNonNull(events, "events")), toMessage, MAX_PENDING_EVENTS);
    return begin(Objects.requireNonNull(spec, "spec").name(), null, spec, factory, change -> queue.add(event(change)));
  }

  private <I extends Message> Ref<I> begin(String name, TaskEngine.@Nullable Attempt parent, ConnectionSpec<I> spec,
      Supplier<? extends ConnectionTask<I>> factory, Consumer<Change> changes) {
    Objects.requireNonNull(factory, "factory");
    Inbox<I> inbox = new Inbox<>(spec.inboxCapacity(), PluginWorkers.overflow(spec.overflow()));
    Ref<I> ref = new Ref<>(new HandleId(pluginId + "/task/" + name + "#" + ids.incrementAndGet()), name, inbox);
    // The factory is plugin code too: it runs on the task's thread, and a throw counts as a run that threw.
    TaskEngine.Task task = engine.create(name, parent, inbox, rule(spec.restart()),
        () -> attempt -> factory.get().run(new Context<>(attempt, ref)), changes);
    ref.task = task; // before any plugin code can use the handle
    task.launch();
    return ref;
  }

  /** The engine's restart rule for the SDK's (also a compute task's, ADR-0064 point 2). */
  static RestartRule rule(Restart restart) {
    return switch (restart) {
      case Restart.Never n -> RestartRule.never();
      case Restart.OnFailure f -> new RestartRule(TaskEngine.Restart.ON_FAILURE, f.backoff().max(), f.backoff()::delay);
      case Restart.Always a -> new RestartRule(TaskEngine.Restart.ALWAYS, a.backoff().max(), a.backoff()::delay);
    };
  }

  private static ConnectionEvent event(Change change) {
    return switch (change) {
      case Change.Running r -> new ConnectionEvent.Running(r.name(), r.at());
      case Change.Restarting r -> new ConnectionEvent.Restarting(r.name(), r.at(), r.reason(), r.next());
      case Change.Stopped s -> new ConnectionEvent.Stopped(s.name(), s.at());
      case Change.Failed f -> new ConnectionEvent.Failed(f.name(), f.at(), f.reason());
    };
  }

  private SSLContext sslContext(String name) {
    Objects.requireNonNull(name, "credentials");
    TlsCredentials credentials = config.credentials().get(name);
    if (credentials == null) {
      throw new IllegalArgumentException("no TLS credential named " + name + " in the server's configuration (emc2.tls."
          + name + ".trust-store)");
    }
    try { // read once by the credential itself; its certificate's expiry checked each time (ADR-0062 point 4)
      return credentials.context(Instant.now());
    } catch (java.security.cert.CertificateExpiredException e) {
      throw new IllegalStateException("the TLS credential " + name + ": " + e.getMessage(), e);
    } catch (java.security.GeneralSecurityException e) {
      throw new IllegalStateException("the TLS credential " + name + " cannot be read: " + e.getMessage(), e);
    }
  }

  /** A task as the plugin holds it: an immutable handle with an opaque id; may travel in messages. */
  private static final class Ref<I extends Message> implements ConnectionRef<I> {
    private final HandleId id;
    private final String name;
    private final Inbox<I> inbox;
    /** Set once, by {@link #begin}, before the task's first run and before the handle leaves ECore. */
    private volatile TaskEngine.@Nullable Task task;

    Ref(HandleId id, String name, Inbox<I> inbox) {
      this.id = id;
      this.name = name;
      this.inbox = inbox;
    }

    private TaskEngine.Task task() {
      return Objects.requireNonNull(task, "the task is starting");
    }

    @Override
    public HandleId id() {
      return id;
    }

    @Override
    public String name() {
      return name;
    }

    @Override
    public SendResult post(I item) {
      Objects.requireNonNull(item, "item");
      if (PluginComputes.onFencedComputeThread()) {
        return SendResult.CLOSED; // SDK 1.9.0: a stopped compute task's post is dropped (ADR-0064 point 2)
      }
      return PluginWorkers.result(inbox.offer(item, PluginWorkers.coalesceKey(item))); // the key before the lock (rule C4)
    }

    @Override
    public void count(String counter, long delta) {
      task().count(Objects.requireNonNull(counter, "name"), delta);
    }

    @Override
    public void detail(String key, String value) {
      task().detail(Objects.requireNonNull(key, "key"), Objects.requireNonNull(value, "value"));
    }

    @Override
    public void stop() {
      TaskEngine.Task t = task;
      if (t != null) {
        t.stop();
      }
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
      return "ConnectionRef[" + id.value() + "]";
    }
  }

  /** What one run of a task may do (SDK {@link TaskContext}); fenced when the run ends. */
  private final class Context<I extends Message> implements TaskContext<I> {
    private final TaskEngine.Attempt attempt;
    private final Ref<I> self;
    private final PluginLog log;

    Context(TaskEngine.Attempt attempt, Ref<I> self) {
      this.attempt = attempt;
      this.self = self;
      this.log = new PluginLogger(pluginId, "task-" + self.name());
    }

    @Override
    @SuppressWarnings("unchecked") // the inbox holds only I: ConnectionRef<I>.post is its only writer
    public @Nullable I take() {
      try {
        return (I) attempt.take();
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return null;
      }
    }

    @Override
    @SuppressWarnings("unchecked")
    public @Nullable I poll(Duration timeout) {
      Objects.requireNonNull(timeout, "timeout");
      if (timeout.compareTo(MIN_POLL) < 0 || timeout.compareTo(MAX_POLL) > 0) {
        throw new IllegalArgumentException("poll timeout must be 1 ms..1 h: " + timeout);
      }
      try {
        return (I) attempt.poll(timeout);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return null;
      }
    }

    @Override
    public <C extends AutoCloseable> C closeOnStop(C resource) {
      return attempt.closeOnStop(Objects.requireNonNull(resource, "resource"));
    }

    @Override
    public <M extends Message> SendResult send(WorkerRef<M> target, M message) {
      Objects.requireNonNull(target, "target");
      Objects.requireNonNull(message, "message");
      if (attempt.stopping()) {
        return SendResult.CLOSED; // fenced: the run is over
      }
      return target.send(message); // plugins' workers never block a sender
    }

    @Override
    public <J extends Message> ConnectionRef<J> startChild(ConnectionSpec<J> spec, Supplier<? extends ConnectionTask<J>> factory) {
      Objects.requireNonNull(spec, "spec");
      if (attempt.stopping()) {
        throw new IllegalStateException("the task " + self.name() + " is stopping");
      }
      return begin(self.name() + "/" + spec.name(), attempt, spec, factory, change -> {});
    }

    @Override
    public void count(String name, long delta) {
      attempt.task.count(Objects.requireNonNull(name, "name"), delta);
    }

    @Override
    public void detail(String key, String value) {
      attempt.task.detail(Objects.requireNonNull(key, "key"), Objects.requireNonNull(value, "value"));
    }

    @Override
    public void listening(SocketAddress address) {
      attempt.task.listening(SocketAddressText.of(Objects.requireNonNull(address, "address")));
    }

    @Override
    public void peer(SocketAddress address) {
      attempt.task.peer(SocketAddressText.of(Objects.requireNonNull(address, "address")));
    }

    @Override
    public @Nullable Instant lastActivity() {
      return attempt.task.lastActivity();
    }

    @Override
    public SSLSocketFactory tls(String credentials) {
      return new HostCheckingSocketFactory(sslContext(credentials).getSocketFactory()); // the peer must be the host (owner, 2026-10-26)
    }

    @Override
    public SSLContext sslContext(String credentials) {
      return PluginConnections.this.sslContext(credentials);
    }

    @Override
    public boolean stopping() {
      return attempt.stopping();
    }

    @Override
    public PluginLog log() {
      return log;
    }

    @Override
    public ConnectionRef<I> self() {
      return self;
    }
  }
}
