package dev.emcc.sdk.testkit;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginLog;
import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.connection.ConnectionSpec;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.net.SocketAddress;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Supplier;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.2.0: runs one connection task alone, on the test thread, with a scripted inbox, and
 * records what it does (ADR-0036). For unit tests of a task's own logic: framing, parsing, what it
 * sends. The task's {@code take} gives the scripted items in order, then {@code null}, so a task
 * that loops on {@code take} returns.
 *
 * <pre>{@code
 * var task = FakeTaskContext.<Outgoing>of("tak-out", new Outgoing(uid, bytes));
 * task.run(new CotWriter(stream));
 * assertThat(task.counter("sent")).isEqualTo(1);
 * assertThat(task.sent()).containsExactly(new Sent(link, new LinkMsg.Written(uid)));
 * }</pre>
 *
 * <p>Its {@code self()} posts into the scripted inbox; {@code startChild} records the child without
 * running it; {@code tls} needs {@link #tlsCredentials}, and refuses {@link #expiredTlsCredentials}
 * and {@link #unreadableTlsCredentials} as ECore does.
 *
 * @param <I> the type of the task's inbox items
 */
public final class FakeTaskContext<I extends Message> implements TaskContext<I> {

  /** A message the task sent to a worker. */
  public record Sent(WorkerRef<?> target, Message message) {}

  /** A child task the task started; not run. */
  public record Child(String name, ConnectionSpec<?> spec) {}

  private final String name;
  private final ArrayDeque<I> inbox = new ArrayDeque<>();
  private final List<Sent> sent = new ArrayList<>();
  private final List<Child> children = new ArrayList<>();
  private final List<AutoCloseable> resources = new ArrayList<>();
  private final Map<String, Long> counters = new LinkedHashMap<>();
  private final Map<String, String> details = new LinkedHashMap<>();
  private final Map<String, SSLContext> credentials = new LinkedHashMap<>();
  private final Map<String, String> refusedCredentials = new LinkedHashMap<>();
  private final List<LogEntry> log = new ArrayList<>();
  private @Nullable SocketAddress listening;
  private @Nullable SocketAddress peer;
  private @Nullable Instant lastActivity;
  private boolean stopping;
  private Instant clock = FakePluginContext.CLOCK_START;

  private FakeTaskContext(String name) {
    this.name = Objects.requireNonNull(name, "name");
  }

  /** A context for the task named {@code name}, its inbox holding {@code items} in order. */
  @SafeVarargs
  public static <I extends Message> FakeTaskContext<I> of(String name, I... items) {
    var c = new FakeTaskContext<I>(name);
    c.inbox.addAll(List.of(items));
    return c;
  }

  /** Runs {@code task} on this thread until it returns or throws. */
  public void run(ConnectionTask<I> task) throws Exception {
    task.run(this);
  }

  // ---------------------------------------------------------------- test controls

  /** Adds items to the inbox, for a task run again. */
  @SafeVarargs
  public final FakeTaskContext<I> post(I... items) {
    inbox.addAll(List.of(items));
    return this;
  }

  /** From now on {@link #stopping()} is true and {@code take} gives {@code null}; the registered resources are closed. */
  public void stop() {
    stopping = true;
    for (AutoCloseable r : List.copyOf(resources)) {
      try {
        r.close();
      } catch (Exception e) {
        // best-effort, as in ECore
      }
    }
  }

  /** TLS credentials by name, as local server configuration would give them. */
  public FakeTaskContext<I> tlsCredentials(String credentialsName, SSLContext context) {
    credentials.put(Objects.requireNonNull(credentialsName), Objects.requireNonNull(context));
    refusedCredentials.remove(credentialsName);
    return this;
  }

  /**
   * SDK 1.9.0 (ADR-0062 point 4): TLS credentials whose own certificate expired on {@code expiredOn};
   * {@code tls} and {@code sslContext} throw {@link IllegalStateException} with ECore's message,
   * naming the credential and the date.
   */
  public FakeTaskContext<I> expiredTlsCredentials(String credentialsName, java.time.LocalDate expiredOn) {
    refusedCredentials.put(Objects.requireNonNull(credentialsName), FakeTls.expired(credentialsName, expiredOn));
    credentials.remove(credentialsName);
    return this;
  }

  /**
   * SDK 1.9.0 (ADR-0062 point 4): TLS credentials ECore cannot read, for {@code reason}; {@code tls}
   * and {@code sslContext} throw {@link IllegalStateException} with ECore's message.
   */
  public FakeTaskContext<I> unreadableTlsCredentials(String credentialsName, String reason) {
    refusedCredentials.put(Objects.requireNonNull(credentialsName), FakeTls.unreadable(credentialsName, reason));
    credentials.remove(credentialsName);
    return this;
  }

  /** The time {@link #lastActivity()} reports for the next {@code count}. */
  public FakeTaskContext<I> clock(Instant value) {
    this.clock = Objects.requireNonNull(value);
    return this;
  }

  public List<Sent> sent() {
    return List.copyOf(sent);
  }

  public List<Child> children() {
    return List.copyOf(children);
  }

  public List<AutoCloseable> registered() {
    return List.copyOf(resources);
  }

  public long counter(String counterName) {
    return counters.getOrDefault(counterName, 0L);
  }

  public Map<String, Long> counters() {
    return Map.copyOf(counters);
  }

  public Map<String, String> details() {
    return Map.copyOf(details);
  }

  public @Nullable SocketAddress listeningAddress() {
    return listening;
  }

  public @Nullable SocketAddress peerAddress() {
    return peer;
  }

  /** What the task logged. */
  public List<LogEntry> logEntries() {
    return List.copyOf(log);
  }

  // ---------------------------------------------------------------- TaskContext

  @Override
  public @Nullable I take() {
    return stopping ? null : inbox.poll();
  }

  @Override
  public @Nullable I poll(Duration timeout) {
    Objects.requireNonNull(timeout, "timeout");
    return take();
  }

  @Override
  public <C extends AutoCloseable> C closeOnStop(C resource) {
    resources.add(Objects.requireNonNull(resource, "resource"));
    return resource;
  }

  @Override
  public <M extends Message> SendResult send(WorkerRef<M> target, M message) {
    if (stopping) {
      return SendResult.CLOSED;
    }
    sent.add(new Sent(Objects.requireNonNull(target, "target"), Objects.requireNonNull(message, "message")));
    return SendResult.ACCEPTED;
  }

  @Override
  public <J extends Message> ConnectionRef<J> startChild(ConnectionSpec<J> spec, Supplier<? extends ConnectionTask<J>> factory) {
    Objects.requireNonNull(factory, "factory");
    String childName = name + "/" + spec.name();
    if (children.stream().anyMatch(c -> c.name().equals(childName))) {
      throw new IllegalArgumentException("a child task named " + childName + " runs");
    }
    children.add(new Child(childName, spec));
    return new ConnectionRef<>() {
      private final HandleId id = new HandleId("fake-task-" + childName);

      @Override
      public HandleId id() {
        return id;
      }

      @Override
      public String name() {
        return childName;
      }

      @Override
      public SendResult post(J item) {
        return SendResult.ACCEPTED;
      }

      @Override
      public void count(String counterName, long delta) {}

      @Override
      public void detail(String key, String value) {}

      @Override
      public void stop() {
        children.removeIf(c -> c.name().equals(childName));
      }
    };
  }

  @Override
  public void count(String counterName, long delta) {
    counters.merge(Objects.requireNonNull(counterName, "name"), delta, Long::sum);
    lastActivity = clock;
  }

  @Override
  public void detail(String key, String value) {
    details.put(Objects.requireNonNull(key, "key"), Objects.requireNonNull(value, "value"));
  }

  @Override
  public void listening(SocketAddress address) {
    listening = Objects.requireNonNull(address, "address");
  }

  @Override
  public void peer(SocketAddress address) {
    peer = Objects.requireNonNull(address, "address");
  }

  @Override
  public @Nullable Instant lastActivity() {
    return lastActivity;
  }

  @Override
  public SSLSocketFactory tls(String credentialsName) {
    return sslContext(credentialsName).getSocketFactory();
  }

  @Override
  public SSLContext sslContext(String credentialsName) {
    return FakeTls.context(credentials, refusedCredentials, credentialsName, "FakeTaskContext.tlsCredentials");
  }

  @Override
  public boolean stopping() {
    return stopping;
  }

  @Override
  public PluginLog log() {
    return new PluginLog() {
      private void add(LogEntry.Level level, String message, @Nullable Object[] args) {
        log.add(new LogEntry(level, "connection " + name, LogEntry.format(message, args), null));
      }

      @Override
      public void debug(String message, @Nullable Object... args) {
        add(LogEntry.Level.DEBUG, message, args);
      }

      @Override
      public void info(String message, @Nullable Object... args) {
        add(LogEntry.Level.INFO, message, args);
      }

      @Override
      public void warn(String message, @Nullable Object... args) {
        add(LogEntry.Level.WARN, message, args);
      }

      @Override
      public void error(String message, @Nullable Object... args) {
        add(LogEntry.Level.ERROR, message, args);
      }

      @Override
      public void error(String message, Throwable error) {
        log.add(new LogEntry(LogEntry.Level.ERROR, "connection " + name, message, error));
      }
    };
  }

  @Override
  public ConnectionRef<I> self() {
    var self = this;
    return new ConnectionRef<>() {
      private final HandleId id = new HandleId("fake-task-" + name);

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
        if (stopping) {
          return SendResult.CLOSED;
        }
        inbox.add(item);
        return SendResult.ACCEPTED;
      }

      @Override
      public void count(String counterName, long delta) {
        self.count(counterName, delta);
      }

      @Override
      public void detail(String key, String value) {
        self.detail(key, value);
      }

      @Override
      public void stop() {
        self.stop();
      }
    };
  }
}
