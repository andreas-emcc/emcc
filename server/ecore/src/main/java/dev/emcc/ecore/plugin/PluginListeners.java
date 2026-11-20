package dev.emcc.ecore.plugin;

import dev.emcc.ecore.runtime.Cancellable;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginLog;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.listener.Backoff;
import dev.emcc.sdk.listener.Listener;
import dev.emcc.sdk.listener.ListenerConnection;
import dev.emcc.sdk.listener.ListenerContext;
import dev.emcc.sdk.listener.ListenerEvent;
import dev.emcc.sdk.listener.ListenerRef;
import dev.emcc.sdk.listener.ListenerSpec;
import dev.emcc.sdk.listener.Listeners;
import dev.emcc.sdk.listener.Transport;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;
import java.util.function.Supplier;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * One plugin's listeners (SDK v1, "Listeners"; rule C6; CR-0010 point 8).
 *
 * <ul>
 *   <li><b>ECore opens the connection,</b> TCP or TLS (credentials by name from local server
 *       configuration, {@link TlsCredentials}; the host name is verified), with the spec's connect
 *       timeout, and only to an endpoint the plugin's <i>current</i> settings name at its manifest's
 *       {@code network.endpoints}: checked at {@code start} and before every reconnect.
 *   <li><b>The loop</b> runs on a dedicated virtual thread per connection ({@link
 *       WorkerRuntime#startLoop}); the factory is called there, before the loop, and a factory that
 *       throws counts as a loop that threw. Reads fail after the idle timeout; a write of at most
 *       64 KiB fails when it does not complete within it (ECore closes the connection).
 *   <li><b>When the loop ends</b>, ECore closes the connection, reports {@code Disconnected}, and
 *       after the back-off (at least 100 ms) connects again with a fresh listener. The back-off
 *       grows with each connection that failed or ended within the back-off's longest delay, and
 *       starts over after one that lasted longer. Without {@code reconnect} the listener ends.
 *   <li><b>Stopping</b> closes the connection (a blocked read or write ends) and fences the loop's
 *       context: what it sends afterwards is dropped.
 *   <li><b>Events</b> are always delivered, in order; when more than {@link
 *       Listeners#MAX_PENDING_EVENTS} wait, only the latest is kept.
 *   <li>At most {@link ListenerConfig#maxPerPlugin()} listeners per plugin; ECore counts bytes read
 *       and written and reconnects per listener ({@link #stats()}, for the monitor view).
 * </ul>
 */
final class PluginListeners implements Listeners {

  /** One listener as the monitor view shows it. */
  record Stats(String plugin, String name, String host, int port, boolean connected, long bytesRead, long bytesWritten,
      long reconnects) {}

  private static final Logger LOG = LoggerFactory.getLogger(PluginListeners.class);

  private final String pluginId;
  private final @Nullable ClassLoader loader;
  private final WorkerRuntime runtime;
  private final ListenerConfig config;
  private final Supplier<JsonObject> settings;
  private final List<String> endpointPointers;
  private final Clock clock;
  private final Map<String, Run> runs = new ConcurrentHashMap<>();
  /** Not {@code this}: plugins hold this object as their {@code Listeners} (ADR-0021). */
  private final Object lock = new Object();
  private final AtomicLong ids = new AtomicLong();
  private volatile boolean closed;

  /**
   * @param settings the plugin's current settings
   * @param endpointPointers the manifest's {@code network.endpoints}; empty if it has none
   */
  PluginListeners(String pluginId, @Nullable ClassLoader loader, WorkerRuntime runtime, ListenerConfig config,
      Supplier<JsonObject> settings, List<String> endpointPointers, Clock clock) {
    this.pluginId = pluginId;
    this.loader = loader;
    this.runtime = runtime;
    this.config = config;
    this.settings = settings;
    this.endpointPointers = List.copyOf(endpointPointers);
    this.clock = clock;
  }

  @Override
  public ListenerRef start(ListenerSpec spec, Supplier<? extends Listener> factory) {
    return begin(spec, factory, null);
  }

  @Override
  public <M extends Message> ListenerRef start(
      ListenerSpec spec, Supplier<? extends Listener> factory, WorkerRef<M> events, Function<ListenerEvent, ? extends M> toMessage) {
    Objects.requireNonNull(toMessage, "toMessage");
    return begin(spec, factory, new EventQueue<ListenerEvent, M>(
        runtime, PluginWorkers.handleOf(Objects.requireNonNull(events, "events")), toMessage, MAX_PENDING_EVENTS));
  }

  private ListenerRef begin(ListenerSpec spec, Supplier<? extends Listener> factory, @Nullable EventQueue<ListenerEvent, ?> events) {
    Objects.requireNonNull(spec, "spec");
    Objects.requireNonNull(factory, "factory");
    if (closed) {
      throw new IllegalStateException("plugin " + pluginId + " is stopping");
    }
    if (!allowed(spec)) {
      throw new IllegalArgumentException(spec.host() + ":" + spec.port()
          + " is not an endpoint the plugin's settings name at its manifest's network.endpoints");
    }
    if (spec.transport() instanceof Transport.Tls t && !config.credentials().containsKey(t.credentials())) {
      throw new IllegalArgumentException("no TLS credentials named " + t.credentials() + " in the server's configuration (emc2.listeners.credentials."
          + t.credentials() + ".trust-store)");
    }
    Run run;
    synchronized (lock) { // a leaf lock (rule C4): the cap and the name, nothing else
      if (runs.size() >= config.maxPerPlugin()) {
        throw new IllegalStateException("plugin " + pluginId + " has " + config.maxPerPlugin() + " listeners, the most it may have");
      }
      if (runs.containsKey(spec.name())) {
        throw new IllegalArgumentException("a listener named " + spec.name() + " is running already");
      }
      run = new Run(spec, factory, events, new HandleId(pluginId + "/listener/" + spec.name() + "#" + ids.incrementAndGet()));
      runs.put(spec.name(), run);
    }
    run.connect();
    return run.ref;
  }

  /** When the plugin stops: every listener stops, and no new one starts. */
  void stopAll() {
    closed = true;
    runs.values().forEach(Run::stop);
  }

  List<Stats> stats() {
    List<Stats> all = new ArrayList<>();
    runs.values().forEach(r -> all.add(new Stats(pluginId, r.spec.name(), r.spec.host(), r.spec.port(), r.connected,
        r.bytesRead.get(), r.bytesWritten.get(), r.reconnects.get())));
    return all;
  }

  private boolean allowed(ListenerSpec spec) {
    return NetworkEndpoints.allows(settings.get(), endpointPointers, spec.host(), spec.port());
  }

  /** The credential reads its files once; its certificate's expiry is checked at each connection (ADR-0062 point 4). */
  private SSLContext tls(String name) throws Exception {
    TlsCredentials credentials = config.credentials().get(name);
    if (credentials == null) {
      throw new IOException("no TLS credentials named " + name);
    }
    return credentials.context(java.time.Instant.now());
  }

  /** One listener: its connections, one after the other, each on a loop thread of its own. */
  private final class Run {
    final ListenerSpec spec;
    final Supplier<? extends Listener> factory;
    final @Nullable EventQueue<ListenerEvent, ?> events;
    final Ref ref;
    final AtomicLong bytesRead = new AtomicLong();
    final AtomicLong bytesWritten = new AtomicLong();
    final AtomicLong reconnects = new AtomicLong();
    /** Made at the first reconnect; used by one loop thread at a time, each started after the last ended. */
    @Nullable RetryDelay retryDelay;
    volatile boolean stopped;
    volatile boolean connected;
    volatile @Nullable Socket socket;
    volatile @Nullable Cancellable retry;

    Run(ListenerSpec spec, Supplier<? extends Listener> factory, @Nullable EventQueue<ListenerEvent, ?> events, HandleId id) {
      this.spec = spec;
      this.factory = factory;
      this.events = events;
      this.ref = new Ref(id, spec.name(), this);
    }

    void connect() {
      if (!stopped) {
        runtime.startLoop("ecore-listener-" + pluginId + "/" + spec.name(), loader, this::attempt);
      }
    }

    /** On the loop thread: one connection, from the endpoint check to the end of the loop. */
    private void attempt() {
      if (!allowed(spec)) {
        end("the endpoint " + spec.host() + ":" + spec.port() + " is no longer in the plugin's settings");
        return;
      }
      Context context = null;
      Connection connection = null;
      long since = runtime.nanoTime();
      String reason;
      try {
        Socket s = open();
        socket = s;
        if (stopped) {
          throw new IOException("stopped");
        }
        connected = true;
        since = runtime.nanoTime();
        report(new ListenerEvent.Connected(spec.name(), clock.instant()));
        connection = new Connection(s);
        context = new Context();
        Listener listener = factory.get(); // plugin code, on the loop's thread
        listener.run(connection, context);
        reason = connection.idle ? idle() : "the loop returned";
      } catch (Throwable e) { // plugin code (factory, loop) and the connection: every end is reported
        reason = stopped ? "stopped"
            : connection != null && connection.idle ? idle()
            : connection != null && connection.writeTimedOut ? "a write did not complete within " + spec.idleTimeout().toMillis() + " ms"
            : connection == null ? "could not connect: " + e
            : String.valueOf(e);
        if (connection != null && !stopped && !(e instanceof IOException)) {
          LOG.warn("Plugin {}: listener {} threw", pluginId, spec.name(), e);
        }
      } finally {
        if (context != null) {
          context.fenced = true;
        }
        closeQuietly(socket);
        socket = null;
        connected = false;
      }
      if (stopped) {
        report(new ListenerEvent.Disconnected(spec.name(), clock.instant(), reason, null));
        return;
      }
      Backoff backoff = spec.reconnect();
      if (backoff == null) {
        end(reason);
        return;
      }
      // The first reconnect waits `initial` (Backoff.delay(0)), then doubling; a connection that
      // lasted at least `max` starts again from `initial` (RetryDelay).
      if (retryDelay == null) {
        retryDelay = new RetryDelay(backoff.max(), backoff::delay);
      }
      Duration delay = retryDelay.after(Duration.ofNanos(runtime.nanoTime() - since));
      // The event first, so that the next connection's Connected can never come before it.
      report(new ListenerEvent.Disconnected(spec.name(), clock.instant(), reason, clock.instant().plus(delay)));
      retry = runtime.schedule(delay, this::connect);
      if (stopped) {
        Cancellable r = retry;
        if (r != null) {
          r.cancel();
        }
        return;
      }
      reconnects.incrementAndGet(); // counted once it is scheduled: whoever reads it knows the reconnect is on its way
    }

    /** The listener ends without a retry: its name is free again. */
    private void end(String reason) {
      stopped = true;
      runs.remove(spec.name(), this);
      report(new ListenerEvent.Disconnected(spec.name(), clock.instant(), reason, null));
    }

    private String idle() {
      return "no data for " + spec.idleTimeout().toMillis() + " ms";
    }

    private Socket open() throws Exception {
      Socket raw = new Socket();
      try {
        raw.connect(new InetSocketAddress(spec.host(), spec.port()), (int) spec.connectTimeout().toMillis());
        raw.setSoTimeout((int) spec.idleTimeout().toMillis());
        if (!(spec.transport() instanceof Transport.Tls t)) {
          return raw;
        }
        SSLSocket ssl = (SSLSocket) tls(t.credentials()).getSocketFactory().createSocket(raw, spec.host(), spec.port(), true);
        SSLParameters parameters = ssl.getSSLParameters();
        parameters.setEndpointIdentificationAlgorithm("HTTPS"); // the peer's certificate must name the host
        ssl.setSSLParameters(parameters);
        ssl.setSoTimeout((int) spec.idleTimeout().toMillis());
        ssl.startHandshake();
        return ssl;
      } catch (Exception e) {
        closeQuietly(raw);
        throw e;
      }
    }

    void stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      runs.remove(spec.name(), this);
      Cancellable r = retry;
      if (r != null) {
        r.cancel();
      }
      closeQuietly(socket); // ends a blocked read or write
    }

    private void report(ListenerEvent event) {
      if (events != null) {
        events.add(event);
      }
    }

    /** The connection the loop reads from: counted, with the idle timeout and the write limit. */
    private final class Connection implements ListenerConnection {
      private final Socket socket;
      private final InputStream input;
      private final OutputStream output;
      volatile boolean idle;
      volatile boolean writeTimedOut;

      Connection(Socket socket) throws IOException {
        this.socket = socket;
        this.output = socket.getOutputStream();
        InputStream raw = socket.getInputStream();
        this.input = new FilterInputStream(raw) {
          @Override
          public int read() throws IOException {
            int b = guarded(() -> in.read());
            if (b >= 0) {
              bytesRead.incrementAndGet();
            }
            return b;
          }

          @Override
          public int read(byte[] buffer, int offset, int length) throws IOException {
            int n = guarded(() -> in.read(buffer, offset, length));
            if (n > 0) {
              bytesRead.addAndGet(n);
            }
            return n;
          }
        };
      }

      /** A read that times out ends the connection: the loop cannot just read on. */
      private int guarded(IoCall read) throws IOException {
        try {
          return read.call();
        } catch (SocketTimeoutException e) {
          idle = true;
          closeQuietly(socket);
          throw new IOException("no data for " + spec.idleTimeout().toMillis() + " ms", e);
        }
      }

      @Override
      public InputStream input() {
        return input;
      }

      @Override
      public void write(Bytes data) throws IOException {
        Objects.requireNonNull(data, "data");
        if (data.size() > MAX_WRITE_BYTES) {
          throw new IllegalArgumentException("a write is at most " + MAX_WRITE_BYTES + " bytes, not " + data.size());
        }
        Cancellable guard = runtime.schedule(spec.idleTimeout(), () -> {
          writeTimedOut = true;
          closeQuietly(socket); // ends the blocked write
        });
        try {
          output.write(data.toArray());
          output.flush();
          bytesWritten.addAndGet(data.size());
        } catch (IOException e) {
          if (writeTimedOut) {
            throw new IOException("the write did not complete within " + spec.idleTimeout().toMillis() + " ms", e);
          }
          throw e;
        } finally {
          guard.cancel();
        }
      }

      @Override
      public String host() {
        return spec.host();
      }

      @Override
      public int port() {
        return spec.port();
      }
    }

    /** What the loop may do besides reading: send to workers, log, see that it should stop. */
    private final class Context implements ListenerContext {
      volatile boolean fenced;
      private final PluginLog log = new PluginLogger(pluginId, "listener-" + spec.name());

      @Override
      public <M extends Message> SendResult send(WorkerRef<M> target, M message) {
        Objects.requireNonNull(target, "target");
        Objects.requireNonNull(message, "message");
        if (fenced || stopped) {
          return SendResult.CLOSED; // dropped: the loop's connection is over
        }
        return target.send(message); // plugins' workers never block a sender
      }

      @Override
      public PluginLog log() {
        return log;
      }

      @Override
      public boolean stopping() {
        return fenced || stopped;
      }

      @Override
      public ListenerRef self() {
        return ref;
      }
    }
  }

  @FunctionalInterface
  private interface IoCall {
    int call() throws IOException;
  }

  /** A {@link ListenerRef}: an immutable value, equal by id. */
  private static final class Ref implements ListenerRef {
    private final HandleId id;
    private final String name;
    private final Run run;

    Ref(HandleId id, String name, Run run) {
      this.id = id;
      this.name = name;
      this.run = run;
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
    public void stop() {
      run.stop();
    }

    @Override
    public boolean equals(@Nullable Object other) {
      return other instanceof Ref r && id.equals(r.id);
    }

    @Override
    public int hashCode() {
      return id.hashCode();
    }

    @Override
    public String toString() {
      return "ListenerRef[" + id.value() + "]";
    }
  }

  private static void closeQuietly(@Nullable Socket socket) {
    if (socket != null) {
      try {
        socket.close();
      } catch (IOException e) {
        // closing anyway
      }
    }
  }
}
