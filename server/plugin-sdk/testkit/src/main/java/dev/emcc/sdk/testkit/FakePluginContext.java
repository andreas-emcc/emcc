package dev.emcc.sdk.testkit;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.DataType;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginLog;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.PluginStatus;
import dev.emcc.sdk.Status;
import dev.emcc.sdk.User;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.Caller;
import dev.emcc.sdk.http.Endpoints;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpCall;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.http.HttpResult;
import dev.emcc.sdk.http.OutboundHttp;
import dev.emcc.sdk.http.ResponseHandle;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.timer.Timers;
import dev.emcc.sdk.topic.Topic;
import dev.emcc.sdk.topic.Topics;
import dev.emcc.sdk.worker.Coalescing;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.Reply;
import dev.emcc.sdk.worker.ReplyTo;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerContext;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import dev.emcc.sdk.worker.Workers;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.PriorityQueue;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * A deterministic, single-threaded {@link PluginContext} for plugin tests. Nothing runs by itself:
 * messages are delivered when the test calls {@link #runUntilIdle()}, and virtual time moves only
 * with {@link #advance(Duration)}. It follows ECore's rules (docs/plugins/sdk-v0.md and sdk-v1.md):
 *
 * <ul>
 *   <li>mailboxes with capacity and overflow policy; replies, ask timeouts and HTTP results are
 *       exempt and always delivered; every drop is counted;
 *   <li>mappers run when the delivery is handled, inside the target worker;
 *   <li>{@code ask} answers exactly once: {@code Ok}, {@code Failed} (also when the target refuses
 *       or evicts the request, or is stopped) or {@code TimedOut};
 *   <li>timers with a fixed delay, never more than one undelivered tick per periodic timer;
 *   <li>ECore's caps per plugin (CR-0005): an ask above {@link #DEFAULT_MAX_ASKS} outstanding asks
 *       is answered at once with {@code Failed("too many outstanding asks")}; a timer above {@link
 *       #DEFAULT_MAX_TIMERS} active timers throws {@code IllegalStateException} (lower them with
 *       {@link Builder#caps(int, int)});
 *   <li>outbound HTTP to any host, as ECore from M2 (the manifest's {@code internet} field only
 *       declares; CR-0013), no redirects, a concurrency limit;
 *   <li>endpoints: {@code 503} when the mailbox refuses or evicts the request, {@code 504} after
 *       the endpoint's timeout, {@code 404} for unknown paths; later answers are ignored and logged;
 *   <li>{@link #restart(WorkerRef)} gives the worker a fresh handler and fences the old context;
 *   <li>SDK v1: an in-memory object store ({@link FakeStore}), plugin documents ({@link
 *       FakeDocuments}), listeners on scripted connections ({@link FakeListeners}, {@link
 *       FakeConnection}), settings that change ({@link #changeSettings(JsonObject)}), the available
 *       data types, and endpoint calls by a user ({@link #call(String, User)}; an endpoint that
 *       {@code requires} a permission the user lacks answers {@code 403}).
 *   <li>SDK 1.8.0 (CR-0044): streams to the web part ({@link FakeStreams}, {@link #stream(String)})
 *       and ECore's conversions into them ({@link FakeConversions}).
 *   <li>SDK 1.9.0 (CR-0048 point 5): compute tasks on real platform threads, as in ECore, with
 *       the manifest's declaration, the admin's allowed and the total cap ({@link FakeComputes},
 *       {@link #computeTask(String)}; {@link Builder#compute(int)}); declared channel kinds ({@link
 *       FakeChannels#declare}).
 *   <li>SDK 1.2.0: connection tasks on real platform threads, as in ECore (CR-0027; {@link
 *       FakeConnections}), output channels with their coalescing inboxes and scripted channels of
 *       other plugins ({@link FakeChannels}), the order of classifications ({@link Builder#classifications}), declared
 *       fields ({@link Builder#declaredFields}) and updates that are not saved ({@link
 *       FakeStore#restart()}).
 *   <li>SDK 1.2.0 (CR-0026): {@code POST} endpoints ({@link #post(String, JsonValue)}, and any method
 *       with a raw body through {@link #request}), with ECore's answers in ECore's order: {@code
 *       404}, {@code 405} with {@code Allow}, {@code 403}, then {@code 415}, {@code 413} and {@code
 *       400} for the body (see {@link Endpoints}); {@code register} refuses a {@code POST} endpoint
 *       without a permission.
 * </ul>
 *
 * <p>Unlike ECore, a handler that throws fails the test by default (see
 * {@link Builder#rethrowHandlerErrors(boolean)}); ECore logs the error, drops the message and lets
 * the worker continue.
 *
 * <pre>{@code
 * var ctx = FakePluginContext.builder("basemap-osm").build();
 * plugin.init(ctx);
 * plugin.start();
 * ctx.upstream().never("https://tile.openstreetmap.org/5/17/9.png");
 * FakeHttpExchange call = ctx.call("/tiles/5/17/9.png");
 * ctx.advance(Duration.ofSeconds(11));
 * assertThat(call.reply().status()).isEqualTo(504);
 * }</pre>
 */
public final class FakePluginContext implements PluginContext {

  /** {@link #runUntilIdle()} gives up after this many deliveries, which usually means a message loop. */
  public static final int MAX_DELIVERIES_PER_RUN = 100_000;

  /** ECore's default cap on a plugin's outstanding asks (CR-0005). */
  public static final int DEFAULT_MAX_ASKS = 10_000;

  /** ECore's default cap on a plugin's active timers (CR-0005). */
  public static final int DEFAULT_MAX_TIMERS = 1_000;

  /** ECore's default cap on a plugin's listeners. */
  @SuppressWarnings("deprecation")
  public static final int DEFAULT_MAX_LISTENERS = dev.emcc.sdk.listener.Listeners.MAX_LISTENERS;

  /** SDK 1.2.0: ECore's default cap on a plugin's connection tasks, children included. */
  public static final int DEFAULT_MAX_CONNECTION_TASKS = dev.emcc.sdk.connection.Connections.MAX_TASKS;

  /** SDK 1.8.0: ECore's cap on a plugin's open streams ({@link dev.emcc.sdk.stream.Streams#MAX_OPEN}). */
  public static final int DEFAULT_MAX_STREAMS = dev.emcc.sdk.stream.Streams.MAX_OPEN;

  /** SDK 1.2.0: ECore's default cap on the channels one plugin offers ({@link dev.emcc.sdk.channel.Channels#MAX_OFFERED}). */
  public static final int DEFAULT_MAX_CHANNELS = dev.emcc.sdk.channel.Channels.MAX_OFFERED;

  static final String TOO_MANY_ASKS = "too many outstanding asks";

  /** The fake's clock starts here; {@link #clock()} is this plus {@link #now()}. */
  public static final Instant CLOCK_START = Instant.parse("2026-01-01T00:00:00Z");

  private static final Runnable NOTHING = () -> {};

  private final String pluginId;
  private JsonObject settings;
  private final List<DataType> dataTypes;
  private final List<String> networkEndpoints;
  private final FakeStore store;
  private final FakeDocuments documents;
  private final FakeListeners listeners;
  private final FakeConnections connections;
  private final FakeStreams streams;
  private final FakeConversions conversions;
  private final FakeComputes computes;
  private final FakeChannels channels;
  private final dev.emcc.sdk.Classifications classifications;
  private final List<dev.emcc.sdk.DeclaredField> declaredFields;
  private final List<dev.emcc.sdk.Workspace> workspaces;
  private final List<dev.emcc.sdk.FieldSet> fieldSets;
  private final Map<String, dev.emcc.sdk.UserTime> userTimes = new java.util.HashMap<>();
  private final List<dev.emcc.sdk.RelationKind> relationKinds;
  private final FakeFolders folders;
  private final List<Consumer<JsonObject>> settingsSubscribers = new ArrayList<>();
  private final SecurityLabel defaultLabel;
  private final boolean rethrowHandlerErrors;
  private final int maxAsks;
  private final int maxTimers;

  private final FakeUpstream upstream = new FakeUpstream();
  // Connection tasks log from their own threads (SDK 1.2.0), so the log is safe to append to and read at once.
  private final List<LogEntry> logEntries = new java.util.concurrent.CopyOnWriteArrayList<>();
  private final List<HttpCall> httpCalls = new ArrayList<>();
  private final Set<String> httpCredentials;
  private final List<RuntimeException> handlerErrors = new ArrayList<>();
  private final Map<String, FakeWorker<?>> workers = new LinkedHashMap<>();
  private final List<Registration<?>> endpointRegistrations = new ArrayList<>();
  private final List<Subscription> subscriptions = new ArrayList<>();
  private final PriorityQueue<Scheduled> schedule =
      new PriorityQueue<>(Comparator.comparing(Scheduled::at).thenComparingLong(Scheduled::seq));

  // Read by connection tasks from their own threads (their events and lastActivity).
  private volatile Duration now = Duration.ZERO;
  private long sequence;
  private final java.util.concurrent.atomic.AtomicLong ids = new java.util.concurrent.atomic.AtomicLong();
  private int httpInFlight;
  private int outstandingAsks;
  private int activeTimers;
  private PluginStatus pluginStatus = new PluginStatus(PluginState.OK, "");
  private PluginStatus ecoreStatus = new PluginStatus(PluginState.OK, "");

  private final PluginLog log = new FakeLog(null);

  private FakePluginContext(Builder b) {
    this.pluginId = b.pluginId;
    this.settings = b.settings;
    this.defaultLabel = b.defaultLabel;
    this.rethrowHandlerErrors = b.rethrowHandlerErrors;
    this.maxAsks = b.maxAsks;
    this.maxTimers = b.maxTimers;
    var types = new ArrayList<DataType>();
    types.add(DataType.general());
    b.dataTypes.stream().filter(t -> !t.id().equals(DataType.GENERAL)).forEach(types::add);
    this.dataTypes = List.copyOf(types);
    this.networkEndpoints = List.copyOf(b.networkEndpoints);
    this.httpCredentials = Set.copyOf(b.httpCredentials);
    this.store = new FakeStore(this, dataTypes);
    this.documents = new FakeDocuments(this);
    this.listeners = new FakeListeners(this, b.maxListeners);
    this.connections = new FakeConnections(this, b.maxConnectionTasks, b.tlsCredentials, b.refusedTlsCredentials);
    this.streams = new FakeStreams(this, b.maxStreams);
    this.conversions = new FakeConversions(this);
    this.computes = new FakeComputes(this, b.computeThreads, b.computeAllowed < 0 ? b.computeThreads : b.computeAllowed, b.computeTotalCap);
    this.channels = new FakeChannels(this, b.maxChannels);
    this.classifications = b.classifications;
    this.declaredFields = List.copyOf(b.declaredFields);
    var all = new ArrayList<dev.emcc.sdk.Workspace>();
    all.add(dev.emcc.sdk.Workspace.view());
    b.workspaces.stream().filter(w -> !w.isView()).sorted(java.util.Comparator.comparingInt(dev.emcc.sdk.Workspace::order)).forEach(all::add);
    this.workspaces = List.copyOf(all);
    this.fieldSets = List.copyOf(b.fieldSets);
    this.relationKinds = List.copyOf(b.relationKinds);
    this.folders = new FakeFolders(this, b.folders);
  }

  public static Builder builder(String pluginId) {
    return new Builder(pluginId);
  }

  // ---------------------------------------------------------------- PluginContext

  @Override
  public String pluginId() {
    return pluginId;
  }

  @Override
  public PluginLog log() {
    return log;
  }

  @Override
  public Status status() {
    return (state, detail) -> pluginStatus = new PluginStatus(state, detail);
  }

  @Override
  public JsonObject settings() {
    return settings;
  }

  @Override
  public <M extends Message> Cancellable subscribeSettings(WorkerRef<M> target, Function<JsonObject, ? extends M> toMessage) {
    FakeWorker<M> w = workerOf(target);
    var c = new FakeCancellable();
    // Like ECore: each message carries the complete settings, so only the latest undelivered one is kept.
    JsonObject[] latest = new JsonObject[1];
    settingsSubscribers.add(values -> {
      if (c.cancelled) {
        return;
      }
      boolean queued = latest[0] != null;
      latest[0] = values;
      if (!queued) {
        w.enqueue(exempt(() -> {
          JsonObject current = Objects.requireNonNull(latest[0]);
          latest[0] = null;
          return toMessage.apply(current);
        }));
      }
    });
    return c;
  }

  /** The deprecated listeners (SDK v1); new code uses {@link #connections()}. */
  @Override
  @Deprecated(since = "1.2.0")
  public FakeListeners listeners() {
    return listeners;
  }

  /** SDK 1.2.0: connection tasks (ADR-0036; {@link FakeConnections}). */
  @Override
  public FakeConnections connections() {
    return connections;
  }

  /** SDK 1.8.0: streams to the web part (CR-0044 E1; {@link FakeStreams}). */
  @Override
  public FakeStreams streams() {
    return streams;
  }

  /** SDK 1.8.0: ECore's conversions (CR-0044 E2; {@link FakeConversions}). */
  @Override
  public FakeConversions conversions() {
    return conversions;
  }

  /** SDK 1.9.0: compute tasks (CR-0048 point 5; {@link FakeComputes}). */
  @Override
  public FakeComputes compute() {
    return computes;
  }

  /** SDK 1.2.0: output channels (ADR-0037; {@link FakeChannels}). */
  @Override
  public FakeChannels channels() {
    return channels;
  }

  /** SDK 1.2.0: the order of classifications, the NATO order unless the builder set another ({@link Builder#classifications}). */
  @Override
  public dev.emcc.sdk.Classifications classifications() {
    return classifications;
  }

  /** SDK 1.2.0: the declared fields of the loaded plugins ({@link Builder#declaredFields}); the store checks change requests against them. */
  @Override
  public List<dev.emcc.sdk.DeclaredField> declaredFields() {
    return declaredFields;
  }

  /** SDK 1.2.0: View, then the workspaces of {@link Builder#workspaces}, by their order. */
  @Override
  public List<dev.emcc.sdk.Workspace> workspaces() {
    return workspaces;
  }

  /**
   * SDK 1.4.0 (ADR-0045): as ECore, delivers {@code session}'s time to a temporal plugin through its
   * {@link dev.emcc.sdk.capability.Temporal#timeDelivery()}, at the next {@code runUntilIdle()}. The
   * fake treats each user as one session for endpoint calls: from now on {@code user}'s requests
   * carry {@code time} as {@code EndpointRequest.userTime()}. To end a session, deliver {@code
   * UserTime.now()}, both parts at their defaults (owner, Q10; CR-0032).
   *
   * <pre>{@code
   * ctx.setSessionTime(plugin, "s1", alice, UserTime.at(Instant.parse("2026-11-06T08:00:00Z")));
   * ctx.runUntilIdle();
   * }</pre>
   */
  public void setSessionTime(dev.emcc.sdk.capability.Temporal plugin, String session, User user, dev.emcc.sdk.UserTime time) {
    var change = new dev.emcc.sdk.capability.SessionTimeChange(session, user, time);
    if (time.isNow()) {
      userTimes.remove(user.id());
    } else {
      userTimes.put(user.id(), time);
    }
    plugin.timeDelivery().deliver(change);
  }

  /** SDK 1.4.0: the field sets of the loaded plugins ({@link Builder#fieldSets}); the store checks the sets a change adds against them (model rule 18). */
  @Override
  public List<dev.emcc.sdk.FieldSet> fieldSets() {
    return fieldSets;
  }

  /** SDK 1.4.0: the relation kinds of the loaded plugins ({@link Builder#relationKinds}); the store checks new relations against them (model rule 17). */
  @Override
  public List<dev.emcc.sdk.RelationKind> relationKinds() {
    return relationKinds;
  }

  /** SDK 1.4.0 (CR-0030 part 6): the folders of {@link Builder#folder}, over real test directories ({@link FakeFolders}). */
  @Override
  public FakeFolders folders() {
    return folders;
  }

  @Override
  public FakeStore store() {
    return store;
  }

  @Override
  public FakeDocuments documents() {
    return documents;
  }

  @Override
  public List<DataType> dataTypes() {
    return dataTypes;
  }

  @Override
  public Workers workers() {
    return this::spawn;
  }

  @Override
  public Topics topics() {
    return new FakeTopics();
  }

  @Override
  public Timers timers() {
    return new FakeTimers();
  }

  @Override
  public OutboundHttp http() {
    return this::sendHttp;
  }

  @Override
  public Endpoints endpoints() {
    return new FakeEndpoints();
  }

  @Override
  public SecurityLabel defaultLabel() {
    return defaultLabel;
  }

  // ---------------------------------------------------------------- test controls

  /** Delivers queued messages, worker by worker in spawn order, until every mailbox is empty. */
  public void runUntilIdle() {
    int delivered = 0;
    boolean progress = true;
    while (progress) {
      progress = false;
      for (FakeWorker<?> w : List.copyOf(workers.values())) {
        if (deliverOne(w)) {
          progress = true;
          if (++delivered > MAX_DELIVERIES_PER_RUN) {
            throw new IllegalStateException("more than " + MAX_DELIVERIES_PER_RUN + " deliveries: a message loop?");
          }
        }
      }
      if (listeners.step()) {
        progress = true; // a listener loop read something, or its connection ended
      }
      if (connections.step()) {
        progress = true; // a connection task sent something, or a run ended
      }
      if (computes.step()) {
        progress = true; // a compute task sent something, or a run ended
      }
      if (conversions.step()) {
        progress = true; // a conversion's event is delivered
      }
    }
  }

  /** Moves virtual time forward, firing timers, timeouts and delayed answers in order, running until idle after each. */
  public void advance(Duration duration) {
    if (duration.isNegative()) {
      throw new IllegalArgumentException("time only moves forward");
    }
    Duration target = now.plus(duration);
    runUntilIdle();
    while (!schedule.isEmpty() && schedule.peek().at().compareTo(target) <= 0) {
      Scheduled next = schedule.poll();
      now = next.at();
      next.action().run();
      runUntilIdle();
    }
    now = target;
  }

  /** Virtual time since the context was created. */
  public Duration now() {
    return now;
  }

  /** The fake's wall clock: {@link #CLOCK_START} plus {@link #now()}. Used for audit times, change events and listener events. */
  public Instant clock() {
    return CLOCK_START.plus(now);
  }

  /** Sends a {@code GET} to the plugin's endpoints, like a browser would, as the no-login user (all permissions). {@code target} may carry a query. */
  public FakeHttpExchange call(String target) {
    return call(target, Headers.empty(), User.noLoginUser());
  }

  /** As {@link #call(String)}, by {@code user}: an endpoint that requires a permission the user lacks answers {@code 403}. */
  public FakeHttpExchange call(String target, User user) {
    return call(target, Headers.empty(), user);
  }

  public FakeHttpExchange call(String target, Headers headers) {
    return call(target, headers, User.noLoginUser());
  }

  public FakeHttpExchange call(String target, Headers headers, User user) {
    return request("GET", target, headers, Bytes.empty(), user);
  }

  /**
   * SDK 1.2.0: sends a {@code POST} with {@code body} as JSON ({@code Content-Type:
   * application/json}), as the no-login user. ECore's checks apply: the body must fit the
   * endpoint's {@code maxBody}.
   */
  public FakeHttpExchange post(String target, JsonValue body) {
    return post(target, Headers.empty(), body, User.noLoginUser());
  }

  /** As {@link #post(String, JsonValue)}, by {@code user}: without the endpoint's permission it answers {@code 403}. */
  public FakeHttpExchange post(String target, JsonValue body, User user) {
    return post(target, Headers.empty(), body, user);
  }

  public FakeHttpExchange post(String target, Headers headers, JsonValue body) {
    return post(target, headers, body, User.noLoginUser());
  }

  /** As {@link #post(String, JsonValue)}, with {@code headers}; a {@code Content-Type} is added unless they name one. */
  public FakeHttpExchange post(String target, Headers headers, JsonValue body, User user) {
    Headers h = headers.first("Content-Type") == null ? headers.with("Content-Type", "application/json") : headers;
    return request("POST", target, h, Bytes.utf8(TestJson.write(body)), user);
  }

  /**
   * SDK 1.2.0: sends any method with a raw body, as a browser or another client could, and
   * answers as ECore does ({@link Endpoints}): for testing a body ECore refuses ({@code 415},
   * {@code 413}, {@code 400}) or a method a path lacks ({@code 405}). A {@code HEAD} is delivered
   * as a {@code GET}; the fake keeps the answer's body, which ECore drops. A {@code GET}'s body is
   * ignored. {@code target} may carry a query.
   */
  public FakeHttpExchange request(String method, String target, Headers headers, Bytes body, User user) {
    return route(false, method, target, headers, body, user, Caller.user("127.0.0.1"));
  }

  /**
   * SDK 1.6.0: sends a request to the plugin's <b>service</b> endpoints ({@code Endpoint.service}),
   * as another system would, without a browser session, from {@code address}. {@code target} is
   * relative to {@code /api/services/{pluginId}} and may carry a query. ECore's checks apply as for
   * {@link #request}; the request's user is {@link Caller#SERVICE_USER} and its caller {@code
   * SERVICE}. A browser {@link #request} never reaches a service endpoint, nor this one an
   * ordinary endpoint.
   */
  public FakeHttpExchange serviceRequest(String method, String target, Headers headers, Bytes body, String address) {
    return route(true, method, target, headers, body, Caller.SERVICE_USER, Caller.service(address));
  }

  private FakeHttpExchange route(boolean service, String method, String target, Headers headers, Bytes body, User user, Caller caller) {
    Objects.requireNonNull(method, "method");
    Objects.requireNonNull(body, "body");
    String endpointMethod = method.equals("HEAD") ? "GET" : method;
    int q = target.indexOf('?');
    String rawPath = q < 0 ? target : target.substring(0, q);
    String path = URI.create("http://fake" + rawPath).getPath();
    Map<String, List<String>> query = parseQuery(q < 0 ? "" : target.substring(q + 1));
    var exchange = new FakeHttpExchange(path);
    var allowed = new TreeSet<String>();
    for (Registration<?> reg : endpointRegistrations) {
      if (reg.endpoint().service() != service) {
        continue;
      }
      Map<String, String> params = reg.endpoint().path().match(path);
      if (params == null) {
        continue;
      }
      if (!reg.endpoint().method().equals(endpointMethod)) {
        allowed.add(reg.endpoint().method());
        continue;
      }
      if (reg.endpoint().permission() != null && !user.has(reg.endpoint().permission())) {
        exchange.answer(HttpReply.status(403));
        return exchange;
      }
      JsonValue parsed = null;
      Bytes raw = null;
      if (endpointMethod.equals("POST")) {
        int refused = checkBody(reg.endpoint(), headers, body);
        if (refused != 0) {
          exchange.answer(HttpReply.status(refused));
          return exchange;
        }
        if (reg.endpoint().takesRawBody()) {
          raw = body;
        } else {
          parsed = parseBody(body);
          if (parsed == null) {
            exchange.answer(HttpReply.status(400));
            return exchange;
          }
        }
      }
      dispatch(reg, exchange, path, params, query, headers, user, endpointMethod, parsed, raw, caller);
      return exchange;
    }
    if (!allowed.isEmpty()) {
      exchange.answer(new HttpReply(405, Headers.of("Allow", String.join(", ", allowed)), Bytes.empty()));
      return exchange;
    }
    exchange.answer(HttpReply.status(404));
    return exchange;
  }

  /**
   * ECore's checks of a {@code POST} body before parsing it: {@code 415}, {@code 413}, or {@code 0}.
   * SDK 1.6.0: an endpoint that {@code accepts} raw bodies takes those media types, with at most a
   * {@code charset} parameter, and no JSON.
   */
  private static int checkBody(Endpoint endpoint, Headers headers, Bytes body) {
    String type = headers.first("Content-Type");
    boolean ok = type != null && (endpoint.takesRawBody() ? isRawType(type, endpoint.accepts()) : isJsonType(type));
    if (!ok) {
      return 415;
    }
    return body.size() > endpoint.maxBody() ? 413 : 0;
  }

  /** One of {@code accepted}, ignoring case, optionally with one {@code charset} parameter. */
  private static boolean isRawType(String value, List<String> accepted) {
    String[] parts = value.split(";", -1);
    if (!accepted.contains(parts[0].trim().toLowerCase(java.util.Locale.ROOT)) || parts.length > 2) {
      return false;
    }
    if (parts.length == 2) {
      String param = parts[1].trim();
      int eq = param.indexOf('=');
      return eq > 0 && param.substring(0, eq).trim().equalsIgnoreCase("charset") && eq < param.length() - 1;
    }
    return true;
  }

  /** {@code application/json}, optionally with one {@code charset=utf-8} parameter and nothing else (a repeated one gets 415). */
  private static boolean isJsonType(String value) {
    String[] parts = value.split(";", -1);
    if (!parts[0].trim().equalsIgnoreCase("application/json") || parts.length > 2) {
      return false;
    }
    if (parts.length == 2) {
      String param = parts[1].trim();
      int eq = param.indexOf('=');
      if (eq < 0 || !param.substring(0, eq).trim().equalsIgnoreCase("charset")) {
        return false;
      }
      String charset = param.substring(eq + 1).trim();
      if (charset.length() >= 2 && charset.startsWith("\"") && charset.endsWith("\"")) {
        charset = charset.substring(1, charset.length() - 1);
      }
      if (!charset.equalsIgnoreCase("utf-8")) {
        return false;
      }
    }
    return true;
  }

  /**
   * The body as ECore parses it: strict UTF-8 with no byte order mark, one RFC 8259 value, no
   * duplicate names, at most {@link Endpoint#MAX_BODY_DEPTH} deep; {@code null} when it is not.
   */
  private static @Nullable JsonValue parseBody(Bytes body) {
    String text;
    try {
      text = StandardCharsets.UTF_8.newDecoder()
          .onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT)
          .decode(ByteBuffer.wrap(body.toArray()))
          .toString();
    } catch (CharacterCodingException e) {
      return null;
    }
    try {
      return TestJson.parse(text, Endpoint.MAX_BODY_DEPTH);
    } catch (IllegalArgumentException e) {
      return null;
    }
  }

  /**
   * Changes the plugin's settings, as a user with {@code settings.admin} would in the settings
   * view: {@link #settings()} returns the new values, and every {@code subscribeSettings} target
   * gets them at the next {@code runUntilIdle()}. The fake does not validate them against the
   * manifest's schema; ECore does.
   */
  public void changeSettings(JsonObject values) {
    settings = Objects.requireNonNull(values, "values");
    List.copyOf(settingsSubscribers).forEach(s -> s.accept(values));
  }

  /** SDK 1.8.0: the latest stream opened with {@code name} (see {@link FakeStreams}). */
  public FakeStreams.FakeStream stream(String name) {
    return streams.stream(name);
  }

  /** SDK 1.9.0: the latest compute task named {@code name} (see {@link FakeComputes}). */
  public FakeComputes.FakeCompute<?> computeTask(String name) {
    return computes.task(name);
  }

  /** SDK 1.9.0: as {@link #computeTask(String)}, typed by the task's inbox type. */
  public <I extends Message> FakeComputes.FakeCompute<I> computeTask(String name, Class<I> inboxType) {
    return computes.task(name, inboxType);
  }

  /** SDK 1.2.0: the latest connection task named {@code name} (see {@link FakeConnections}). */
  public FakeConnections.FakeTask<?> connectionTask(String name) {
    return connections.task(name);
  }

  /** SDK 1.2.0: as {@link #connectionTask(String)}, typed by the task's inbox type. */
  public <I extends Message> FakeConnections.FakeTask<I> connectionTask(String name, Class<I> inboxType) {
    return connections.task(name, inboxType);
  }

  /**
   * The latest connection of the listener named {@code name} (see {@link FakeListeners}).
   *
   * @deprecated with the listener, from SDK 1.2.0; a connection task's view is {@link #connectionTask(String)}
   */
  @Deprecated(since = "1.2.0")
  public FakeConnection connection(String name) {
    return listeners.connection(name);
  }

  /** Publishes on any topic, e.g. a core topic, as ECore would. */
  public <T extends Message> void publishAsCore(Topic<T> topic, T message) {
    deliverToSubscribers(topic, message);
  }

  /** Simulates a watchdog restart: a fresh handler from the spec's factory; the old context is fenced. */
  public void restart(WorkerRef<?> ref) {
    FakeWorker<?> w = workerOf(ref);
    w.restart();
  }

  /** Stops a worker: later sends return {@code CLOSED}; queued deliveries are dropped (endpoint requests get 503, asks fail). */
  public void stop(WorkerRef<?> ref) {
    workerOf(ref).close();
  }

  /** Sets ECore's part of the plugin status, e.g. to simulate a hung worker. */
  public void setEcoreStatus(PluginState state, String detail) {
    ecoreStatus = new PluginStatus(state, detail);
  }

  /** The status the plugin set itself. */
  public PluginStatus pluginStatus() {
    return pluginStatus;
  }

  /** The worse of the plugin's and ECore's status, as the monitor view shows it. */
  public PluginStatus effectiveStatus() {
    return pluginStatus.worse(ecoreStatus);
  }

  public FakeUpstream upstream() {
    return upstream;
  }

  /** Every outbound call the plugin made, in order, including refused ones. */
  public List<HttpCall> httpCalls() {
    return Collections.unmodifiableList(httpCalls);
  }

  public List<LogEntry> logEntries() {
    return Collections.unmodifiableList(logEntries);
  }

  /** Exceptions thrown by handlers (when not rethrown). */
  public List<RuntimeException> handlerErrors() {
    return Collections.unmodifiableList(handlerErrors);
  }

  /** Messages waiting in a worker's mailbox. */
  public int queued(WorkerRef<?> ref) {
    return workerOf(ref).mailbox.size();
  }

  /** Messages a worker's mailbox dropped (refused, evicted or replaced) so far. */
  public long dropped(WorkerRef<?> ref) {
    return workerOf(ref).dropped;
  }

  /** Asks of the plugin that have no answer yet (counted against the cap). */
  public int outstandingAsks() {
    return outstandingAsks;
  }

  /** The plugin's active timers: one-off timers not yet fired or cancelled, periodic ones not cancelled. */
  public int activeTimers() {
    return activeTimers;
  }

  /** The reference of a worker by name. */
  public WorkerRef<?> worker(String name) {
    FakeWorker<?> w = workers.get(name);
    if (w == null) {
      throw new IllegalArgumentException("no worker named " + name);
    }
    return w.ref;
  }

  // ---------------------------------------------------------------- workers and mailboxes

  private <M extends Message> WorkerRef<M> spawn(WorkerSpec<M> spec) {
    if (workers.containsKey(spec.name())) {
      throw new IllegalArgumentException("the plugin already has a worker named " + spec.name());
    }
    var w = new FakeWorker<>(spec, new HandleId(newId("worker-" + spec.name())));
    workers.put(spec.name(), w);
    return w.ref;
  }

  private <M extends Message> boolean deliverOne(FakeWorker<M> w) {
    if (w.closed || w.mailbox.isEmpty()) {
      return false;
    }
    Delivery<M> d = w.mailbox.removeFirst();
    d.onDequeued().run();
    int generation = w.generation;
    M message;
    try {
      message = d.produce().get(); // a mapper: plugin code, run in this worker
    } catch (RuntimeException e) {
      pluginCodeFailed(w, "mapper", e);
      return true;
    }
    if (message == null) {
      return true; // nothing left to hand over (a withdrawn channel's item, deliverUnlessGone)
    }
    // Always fails the test: a mutable message is a bug, not a runtime condition.
    MessageCheck.requireImmutable(message);
    try {
      w.handler.handle(message, new FakeWorkerContext<>(w, generation));
    } catch (RuntimeException e) {
      pluginCodeFailed(w, "handler", e);
    }
    return true;
  }

  private void pluginCodeFailed(FakeWorker<?> w, String what, RuntimeException e) {
    logEntries.add(new LogEntry(LogEntry.Level.ERROR, w.spec.name(), what + " threw " + e, e));
    if (rethrowHandlerErrors) {
      throw new AssertionError("the " + what + " of worker '" + w.spec.name() + "' threw", e);
    }
    handlerErrors.add(e);
  }

  private <M extends Message> FakeWorker<M> workerOf(WorkerRef<M> ref) {
    if (ref instanceof FakeWorkerRef<M> f && f.owner() == this) {
      return f.worker;
    }
    throw new IllegalArgumentException("not a worker of this context: " + ref);
  }

  private static @Nullable Object keyOf(Object payload) {
    return payload instanceof Coalescing c ? c.coalesceKey() : null;
  }

  private static <M extends Message> Delivery<M> plain(M message) {
    return new Delivery<>(() -> message, keyOf(message), false, NOTHING, NOTHING);
  }

  private static <M extends Message> Delivery<M> exempt(Supplier<? extends M> produce) {
    return new Delivery<>(produce, null, true, NOTHING, NOTHING);
  }

  /** One queued delivery. {@code produce} runs when it is handled (mappers run inside the worker). */
  private record Delivery<M extends Message>(
      Supplier<? extends M> produce, @Nullable Object key, boolean exempt, Runnable onDequeued, Runnable onDropped) {}

  private final class FakeWorker<M extends Message> {
    final WorkerSpec<M> spec;
    final FakeWorkerRef<M> ref;
    final List<Delivery<M>> mailbox = new ArrayList<>();
    Handler<M> handler;
    int generation;
    boolean closed;
    long dropped;

    FakeWorker(WorkerSpec<M> spec, HandleId id) {
      this.spec = spec;
      this.ref = new FakeWorkerRef<>(id, spec.name(), this);
      this.handler = spec.handlerFactory().get();
    }

    FakePluginContext outer() {
      return FakePluginContext.this;
    }

    void restart() {
      handler = spec.handlerFactory().get();
      generation++;
    }

    void close() {
      closed = true;
      var pending = List.copyOf(mailbox);
      mailbox.clear();
      pending.forEach(d -> d.onDropped().run());
    }

    SendResult enqueue(Delivery<M> d) {
      if (closed) {
        d.onDropped().run();
        return SendResult.CLOSED;
      }
      if (d.exempt()) {
        mailbox.add(d);
        return SendResult.ACCEPTED;
      }
      Overflow<M> policy = spec.overflow();
      if (policy instanceof Overflow.CoalesceByKey<M> && d.key() != null) {
        for (int i = 0; i < mailbox.size(); i++) {
          Delivery<M> queued = mailbox.get(i);
          if (!queued.exempt() && d.key().equals(queued.key())) {
            mailbox.set(i, d);
            dropped++;
            queued.onDropped().run();
            return SendResult.ACCEPTED;
          }
        }
      }
      if (regularCount() < spec.mailboxCapacity()) {
        mailbox.add(d);
        return SendResult.ACCEPTED;
      }
      if (policy instanceof Overflow.DropNewest<M>) {
        dropped++;
        d.onDropped().run();
        return SendResult.DROPPED;
      }
      for (int i = 0; i < mailbox.size(); i++) {
        if (!mailbox.get(i).exempt()) {
          Delivery<M> evicted = mailbox.remove(i);
          dropped++;
          evicted.onDropped().run();
          break;
        }
      }
      mailbox.add(d);
      return SendResult.ACCEPTED;
    }

    private int regularCount() {
      int n = 0;
      for (Delivery<M> d : mailbox) {
        if (!d.exempt()) {
          n++;
        }
      }
      return n;
    }
  }

  /** A worker reference; equal by id. */
  private static final class FakeWorkerRef<M extends Message> implements WorkerRef<M> {
    private final HandleId id;
    private final String name;
    private final FakeWorker<M> worker;

    FakeWorkerRef(HandleId id, String name, FakeWorker<M> worker) {
      this.id = id;
      this.name = name;
      this.worker = worker;
    }

    FakePluginContext owner() {
      return worker.outer();
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
    public SendResult send(M message) {
      Objects.requireNonNull(message, "message");
      return worker.enqueue(plain(message));
    }

    @Override
    public boolean equals(@Nullable Object other) {
      return other instanceof FakeWorkerRef<?> r && id.equals(r.id);
    }

    @Override
    public int hashCode() {
      return id.hashCode();
    }

    @Override
    public String toString() {
      return "WorkerRef[" + name + "]";
    }
  }

  private final class FakeWorkerContext<M extends Message> implements WorkerContext<M> {
    private final FakeWorker<M> worker;
    private final int generation;
    private final PluginLog workerLog;

    FakeWorkerContext(FakeWorker<M> worker, int generation) {
      this.worker = worker;
      this.generation = generation;
      this.workerLog = new FakeLog(worker.spec.name());
    }

    private boolean fenced() {
      return generation != worker.generation;
    }

    @Override
    public WorkerRef<M> self() {
      return worker.ref;
    }

    @Override
    public PluginLog log() {
      return workerLog;
    }

    @Override
    public <Q extends Message, R extends Message> void ask(
        WorkerRef<Q> target, Function<ReplyTo<R>, ? extends Q> request, Duration timeout, Function<Reply<R>, ? extends M> toMessage) {
      if (timeout.compareTo(Duration.ofMillis(1)) < 0 || timeout.compareTo(Duration.ofMinutes(10)) > 0) {
        throw new IllegalArgumentException("ask timeout must be 1 ms..10 min: " + timeout);
      }
      if (fenced()) {
        logEntries.add(new LogEntry(LogEntry.Level.DEBUG, worker.spec.name(), "ask from a fenced context dropped", null));
        return;
      }
      if (outstandingAsks >= maxAsks) {
        logEntries.add(new LogEntry(LogEntry.Level.WARN, worker.spec.name(), "ask refused: " + TOO_MANY_ASKS + " (" + maxAsks + ")", null));
        Reply<R> refused = new Reply.Failed<>(TOO_MANY_ASKS);
        worker.enqueue(exempt(() -> toMessage.apply(refused)));
        return;
      }
      outstandingAsks++;
      var replyTo = new FakeReplyTo<R>(new HandleId(newId("reply")), reply -> {
        outstandingAsks--; // answer() delivers once, so this runs once per ask
        worker.enqueue(exempt(() -> toMessage.apply(reply)));
      });
      Q q = request.apply(replyTo);
      FakeWorker<Q> t = workerOf(target);
      SendResult result = t.enqueue(new Delivery<>(() -> q, keyOf(q), false, NOTHING, () -> replyTo.answer(new Reply.Failed<>("request dropped by " + t.spec.name()))));
      if (result != SendResult.ACCEPTED) {
        replyTo.answer(new Reply.Failed<>("target " + t.spec.name() + " refused the request: " + result));
      }
      at(now.plus(timeout), () -> replyTo.answer(new Reply.TimedOut<>()));
    }
  }

  /** A reply handle: answers once. Equal by id. */
  private final class FakeReplyTo<R extends Message> implements ReplyTo<R> {
    private final HandleId id;
    private final Consumer<Reply<R>> deliver;
    private boolean answered;

    FakeReplyTo(HandleId id, Consumer<Reply<R>> deliver) {
      this.id = id;
      this.deliver = deliver;
    }

    void answer(Reply<R> reply) {
      if (answered) {
        return;
      }
      answered = true;
      deliver.accept(reply);
    }

    @Override
    public HandleId id() {
      return id;
    }

    @Override
    public void reply(R value) {
      answer(new Reply.Ok<>(value));
    }

    @Override
    public void fail(String reason) {
      answer(new Reply.Failed<>(reason));
    }

    @Override
    public boolean equals(@Nullable Object other) {
      return other instanceof FakePluginContext.FakeReplyTo<?> r && id.equals(r.id);
    }

    @Override
    public int hashCode() {
      return id.hashCode();
    }
  }

  // ---------------------------------------------------------------- topics and timers

  private record Subscription(String topic, Consumer<Message> deliver, FakeCancellable cancellable) {}

  private <T extends Message> void deliverToSubscribers(Topic<T> topic, T message) {
    for (Subscription s : List.copyOf(subscriptions)) {
      if (s.topic().equals(topic.name()) && !s.cancellable().cancelled) {
        s.deliver().accept(message);
      }
    }
  }

  private final class FakeTopics implements Topics {
    @Override
    public <T extends Message> void publish(Topic<T> topic, T message) {
      if (!topic.name().startsWith(pluginId + ".")) {
        throw new IllegalArgumentException("a plugin may publish only to its own topics (" + pluginId + ".*): " + topic.name());
      }
      deliverToSubscribers(topic, topic.payloadType().cast(message));
    }

    @Override
    public <T extends Message, M extends Message> Cancellable subscribe(Topic<T> topic, WorkerRef<M> target, Function<? super T, ? extends M> mapper) {
      FakeWorker<M> w = workerOf(target);
      var c = new FakeCancellable();
      subscriptions.add(new Subscription(topic.name(), payload -> {
        T t = topic.payloadType().cast(payload);
        w.enqueue(new Delivery<>(() -> mapper.apply(t), keyOf(t), false, NOTHING, NOTHING));
      }, c));
      return c;
    }
  }

  private final class FakeTimers implements Timers {
    @Override
    public <M extends Message> Cancellable once(Duration delay, WorkerRef<M> target, M message) {
      checkPeriod(delay);
      FakeWorker<M> w = workerOf(target);
      var c = newTimer();
      at(now.plus(delay), () -> {
        if (!c.cancelled) {
          c.end(); // fired: no longer active
          w.enqueue(plain(message));
        }
      });
      return c;
    }

    @Override
    public <M extends Message> Cancellable every(Duration period, WorkerRef<M> target, M message) {
      checkPeriod(period);
      var periodic = new Periodic<>(workerOf(target), period, message, newTimer());
      periodic.scheduleNext();
      return periodic.cancellable;
    }

    /** A timer's handle, counted as active until it ends; refused above the cap. */
    private FakeCancellable newTimer() {
      if (activeTimers >= maxTimers) {
        logEntries.add(new LogEntry(LogEntry.Level.WARN, null, "timer refused: too many active timers (" + maxTimers + ")", null));
        throw new IllegalStateException("too many active timers (" + maxTimers + ")");
      }
      activeTimers++;
      return new FakeCancellable(() -> activeTimers--);
    }

    private void checkPeriod(Duration d) {
      if (d.compareTo(Timers.MIN_PERIOD) < 0) {
        throw new IllegalArgumentException("timer delays and periods are at least " + Timers.MIN_PERIOD + ": " + d);
      }
    }
  }

  /** A periodic timer with a fixed delay: the next tick is scheduled when the previous one is delivered or dropped. */
  private final class Periodic<M extends Message> {
    final FakeWorker<M> worker;
    final Duration period;
    final M message;
    final FakeCancellable cancellable;
    boolean scheduled;

    Periodic(FakeWorker<M> worker, Duration period, M message, FakeCancellable cancellable) {
      this.worker = worker;
      this.period = period;
      this.message = message;
      this.cancellable = cancellable;
    }

    void scheduleNext() {
      if (!scheduled && !cancellable.cancelled && !worker.closed) {
        scheduled = true;
        at(now.plus(period), this::fire);
      }
    }

    void fire() {
      scheduled = false;
      if (cancellable.cancelled) {
        return;
      }
      worker.enqueue(new Delivery<>(() -> message, keyOf(message), false, this::scheduleNext, this::scheduleNext));
    }
  }

  /** Idempotent; {@code onEnd} runs once, when the handle is cancelled or (for a one-off timer) has fired. */
  private static final class FakeCancellable implements Cancellable {
    private final Runnable onEnd;
    boolean cancelled;
    private boolean ended;

    FakeCancellable() {
      this(NOTHING);
    }

    FakeCancellable(Runnable onEnd) {
      this.onEnd = onEnd;
    }

    void end() {
      if (!ended) {
        ended = true;
        onEnd.run();
      }
    }

    @Override
    public void cancel() {
      cancelled = true;
      end();
    }
  }

  private record Scheduled(Duration at, long seq, Runnable action) {}

  private void at(Duration time, Runnable action) {
    schedule.add(new Scheduled(time, sequence++, action));
  }

  // ---------------------------------------------------------------- outbound HTTP

  private <M extends Message> void sendHttp(HttpCall call, Duration timeout, WorkerRef<M> target, Function<HttpResult, ? extends M> toMessage) {
    if (timeout.compareTo(Duration.ofMillis(1)) < 0 || timeout.compareTo(Duration.ofMinutes(10)) > 0) {
      throw new IllegalArgumentException("HTTP timeout must be 1 ms..10 min: " + timeout);
    }
    FakeWorker<M> w = workerOf(target);
    httpCalls.add(call);
    var done = new boolean[1];
    Consumer<HttpResult> finish = result -> {
      if (!done[0]) {
        done[0] = true;
        httpInFlight--;
        w.enqueue(exempt(() -> toMessage.apply(result)));
      }
    };
    if (httpInFlight >= OutboundHttp.MAX_CONCURRENT_CALLS) {
      w.enqueue(exempt(() -> toMessage.apply(new HttpResult.Failed("too many concurrent calls (" + OutboundHttp.MAX_CONCURRENT_CALLS + ")"))));
      return;
    }
    if (call.credential() != null && !httpCredentials.contains(call.credential())) {
      w.enqueue(exempt(() -> toMessage.apply(new HttpResult.Failed("no credential " + call.credential()))));
      return;
    }
    httpInFlight++;
    at(now.plus(timeout), () -> finish.accept(new HttpResult.TimedOut()));
    FakeUpstream.Script script = upstream.scriptFor(call.uri().toString());
    switch (script) {
      case null -> finish.accept(new HttpResult.Failed("no fake response scripted for " + call.uri()));
      case FakeUpstream.Fail f -> finish.accept(new HttpResult.Failed(f.reason()));
      case FakeUpstream.Never n -> {}
      case FakeUpstream.Respond r -> {
        HttpResult result = responseOf(r, call.maxResponseBytes());
        if (r.delay().isZero()) {
          finish.accept(result);
        } else {
          at(now.plus(r.delay()), () -> finish.accept(result));
        }
      }
    }
  }

  private static HttpResult responseOf(FakeUpstream.Respond r, int maxBytes) {
    if (r.status() >= 300 && r.status() < 400) {
      return new HttpResult.Failed("redirect not followed (SDK v1): " + r.status());
    }
    if (r.body().size() > maxBytes) {
      return new HttpResult.Failed("response body larger than " + maxBytes + " bytes");
    }
    return new HttpResult.Response(r.status(), r.headers(), r.body());
  }

  // ---------------------------------------------------------------- endpoints

  private record Registration<M extends Message>(Endpoint endpoint, FakeWorker<M> worker, Function<EndpointRequest, ? extends M> toMessage) {}

  private final class FakeEndpoints implements Endpoints {
    @Override
    public <M extends Message> void register(Endpoint endpoint, WorkerRef<M> worker, Function<EndpointRequest, ? extends M> toMessage) {
      for (Registration<?> r : endpointRegistrations) {
        if (r.endpoint().method().equals(endpoint.method()) && r.endpoint().path().equals(endpoint.path())) {
          throw new IllegalArgumentException("endpoint already registered: " + endpoint.method() + " " + endpoint.path());
        }
      }
      if (endpoint.method().equals("POST") && endpoint.permission() == null && !endpoint.service() && !endpoint.userCheckedByHandler()) {
        throw new IllegalArgumentException("a POST endpoint needs a permission (requires), or checksUserItself(): " + endpoint.path());
      }
      endpointRegistrations.add(new Registration<>(endpoint, workerOf(worker), toMessage));
    }
  }

  private <M extends Message> void dispatch(
      Registration<M> reg,
      FakeHttpExchange exchange,
      String path,
      Map<String, String> params,
      Map<String, List<String>> query,
      Headers headers,
      User user,
      String method,
      @Nullable JsonValue body,
      @Nullable Bytes rawBody,
      Caller caller) {
    ResponseHandle handle = new FakeResponseHandle(new HandleId(newId("response")), exchange);
    var userTime = caller.kind() == Caller.Kind.SERVICE ? dev.emcc.sdk.UserTime.now() : userTimes.getOrDefault(user.id(), dev.emcc.sdk.UserTime.now());
    var request = new EndpointRequest(path, params, query, headers, user, handle, method, body, userTime, rawBody, caller);
    reg.worker().enqueue(new Delivery<>(() -> reg.toMessage().apply(request), null, false, NOTHING, () -> exchange.answer(HttpReply.status(503))));
    at(now.plus(reg.endpoint().timeout()), () -> exchange.answer(HttpReply.status(504)));
  }

  /** A response handle: the first answer wins, later ones are logged and ignored. Equal by id. */
  private final class FakeResponseHandle implements ResponseHandle {
    private final HandleId id;
    private final FakeHttpExchange exchange;

    FakeResponseHandle(HandleId id, FakeHttpExchange exchange) {
      this.id = id;
      this.exchange = exchange;
    }

    @Override
    public HandleId id() {
      return id;
    }

    @Override
    public void respond(HttpReply reply) {
      if (!exchange.answer(reply)) {
        logEntries.add(new LogEntry(LogEntry.Level.WARN, null, "answer to " + exchange.path() + " ignored: already answered with " + exchange.reply().status(), null));
      }
    }

    @Override
    public boolean equals(@Nullable Object other) {
      return other instanceof FakePluginContext.FakeResponseHandle h && id.equals(h.id);
    }

    @Override
    public int hashCode() {
      return id.hashCode();
    }
  }

  private static Map<String, List<String>> parseQuery(String raw) {
    var query = new LinkedHashMap<String, List<String>>();
    if (raw.isEmpty()) {
      return query;
    }
    for (String pair : raw.split("&")) {
      int eq = pair.indexOf('=');
      String name = URLDecoder.decode(eq < 0 ? pair : pair.substring(0, eq), StandardCharsets.UTF_8);
      String value = eq < 0 ? "" : URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8);
      query.computeIfAbsent(name, k -> new ArrayList<>()).add(value);
    }
    return query;
  }

  // ---------------------------------------------------------------- for FakeStore, FakeDocuments and FakeListeners

  /** Delivers what {@code produce} makes to {@code target}, always (like a reply), at the next run. */
  <M extends Message> void deliverAlways(WorkerRef<M> target, Supplier<? extends M> produce) {
    workerOf(target).enqueue(exempt(produce));
  }

  /** As {@link #deliverAlways}, but nothing is delivered when {@code produce} gives {@code null} at the delivery. */
  @SuppressWarnings("unchecked")
  <M extends Message> void deliverUnlessGone(WorkerRef<M> target, Supplier<? extends @Nullable M> produce) {
    workerOf(target).enqueue(exempt((Supplier<? extends M>) produce));
  }

  /** Sends {@code message} to {@code target} through its mailbox policy, as {@link WorkerRef#send} does. */
  <M extends Message> SendResult deliver(WorkerRef<M> target, M message) {
    return workerOf(target).enqueue(plain(message));
  }

  /** Runs {@code action} in virtual time, after {@code delay}. */
  void after(Duration delay, Runnable action) {
    at(now.plus(delay), action);
  }

  /** Counts an outstanding ask; false (and logged) at the cap (CR-0005). */
  boolean takeAsk() {
    if (outstandingAsks >= maxAsks) {
      logEntries.add(new LogEntry(LogEntry.Level.WARN, null, "ask refused: " + TOO_MANY_ASKS + " (" + maxAsks + ")", null));
      return false;
    }
    outstandingAsks++;
    return true;
  }

  void returnAsk() {
    outstandingAsks--;
  }

  String nextId(String kind) {
    return newId(kind);
  }

  PluginLog logNamed(String name) {
    return new FakeLog(name);
  }

  List<String> networkEndpoints() {
    return networkEndpoints;
  }

  void listenerLoopFailed(String listener, Throwable error) {
    logEntries.add(new LogEntry(LogEntry.Level.ERROR, "listener " + listener, "the listener loop threw " + error, error));
    if (rethrowHandlerErrors) {
      throw new AssertionError("the loop of listener '" + listener + "' threw", error);
    }
    if (error instanceof RuntimeException e) {
      handlerErrors.add(e);
    }
  }

  static void checkTimeout(String what, Duration timeout) {
    if (timeout.compareTo(Duration.ofMillis(1)) < 0 || timeout.compareTo(Duration.ofMinutes(10)) > 0) {
      throw new IllegalArgumentException(what + " timeout must be 1 ms..10 min: " + timeout);
    }
  }

  // ---------------------------------------------------------------- logging and ids

  private String newId(String kind) {
    return "fake-" + kind + "-" + ids.incrementAndGet();
  }

  private final class FakeLog implements PluginLog {
    private final @Nullable String worker;

    FakeLog(@Nullable String worker) {
      this.worker = worker;
    }

    private void add(LogEntry.Level level, String message, @Nullable Object[] args) {
      logEntries.add(new LogEntry(level, worker, LogEntry.format(message, args), null));
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
      logEntries.add(new LogEntry(LogEntry.Level.ERROR, worker, message, error));
    }
  }

  /** Builds a {@link FakePluginContext}. */
  public static final class Builder {
    private final String pluginId;
    private JsonObject settings = JsonObject.empty();
    private SecurityLabel defaultLabel = SecurityLabel.of("NATO", "UNCLASSIFIED");
    // Written by internetHosts(...) and read by nothing: since M2 the declaration does not limit calls (CR-0013).
    private Set<String> internetHosts = Set.of();
    private boolean rethrowHandlerErrors = true;
    private int maxAsks = DEFAULT_MAX_ASKS;
    private int maxTimers = DEFAULT_MAX_TIMERS;
    private int maxListeners = DEFAULT_MAX_LISTENERS;
    private int maxConnectionTasks = DEFAULT_MAX_CONNECTION_TASKS;
    private int computeThreads;
    private int computeAllowed = -1;
    private int computeTotalCap = Integer.MAX_VALUE;
    private int maxStreams = DEFAULT_MAX_STREAMS;
    private int maxChannels = DEFAULT_MAX_CHANNELS;
    private dev.emcc.sdk.Classifications classifications = dev.emcc.sdk.Classifications.nato();
    private List<dev.emcc.sdk.DeclaredField> declaredFields = List.of();
    private List<dev.emcc.sdk.Workspace> workspaces = List.of();
    private List<dev.emcc.sdk.FieldSet> fieldSets = List.of();
    private List<dev.emcc.sdk.RelationKind> relationKinds = List.of();
    private final java.util.Map<String, javax.net.ssl.SSLContext> tlsCredentials = new java.util.LinkedHashMap<>();
    private final java.util.Map<String, String> refusedTlsCredentials = new java.util.LinkedHashMap<>();
    private final Set<String> httpCredentials = new java.util.LinkedHashSet<>();
    private List<DataType> dataTypes = List.of();
    private List<String> networkEndpoints = List.of();
    private final java.util.Map<String, java.nio.file.@Nullable Path> folders = new java.util.LinkedHashMap<>();

    private Builder(String pluginId) {
      this.pluginId = Objects.requireNonNull(pluginId, "pluginId");
    }

    /** The settings the plugin starts with (ECore: the configured values, with the manifest's defaults). Change them later with {@link FakePluginContext#changeSettings}. */
    public Builder settings(JsonObject value) {
      this.settings = value;
      return this;
    }

    public Builder defaultLabel(SecurityLabel value) {
      this.defaultLabel = value;
      return this;
    }

    /**
     * The manifest's {@code internet.hosts}. Since M2 a declaration only: calls go to every host, as
     * in ECore (CR-0013). Kept so that tests written for SDK 1.0.0 still build.
     */
    public Builder internetHosts(String... hosts) {
      this.internetHosts = Set.of(hosts);
      return this;
    }

    /** Whether a throwing handler fails the test (default true). If false, errors are collected in {@link #handlerErrors()}, as ECore would log them. */
    public Builder rethrowHandlerErrors(boolean value) {
      this.rethrowHandlerErrors = value;
      return this;
    }

    /** ECore's caps on outstanding asks and active timers (CR-0005); lower them to test the refusals. Each at least 1. */
    public Builder caps(int asks, int timers) {
      if (asks < 1 || timers < 1) {
        throw new IllegalArgumentException("caps are at least 1: " + asks + ", " + timers);
      }
      this.maxAsks = asks;
      this.maxTimers = timers;
      return this;
    }

    /** Data types the loaded plugins declare, besides {@code core.general}, which is always first (ADR-0023). */
    public Builder dataTypes(DataType... types) {
      this.dataTypes = List.of(types);
      return this;
    }

    /** The manifest's {@code network.endpoints}: JSON Pointers into the settings to the endpoints listeners may connect to. Default: none. */
    public Builder networkEndpoints(String... pointers) {
      this.networkEndpoints = List.of(pointers);
      return this;
    }

    /** ECore's cap on listeners per plugin; lower it to test the refusal. At least 1. */
    public Builder maxListeners(int value) {
      if (value < 1) {
        throw new IllegalArgumentException("the cap is at least 1: " + value);
      }
      this.maxListeners = value;
      return this;
    }

    /** SDK 1.2.0: ECore's cap on connection tasks per plugin, children included; lower it to test the refusal. At least 1. */
    public Builder maxConnectionTasks(int value) {
      if (value < 1) {
        throw new IllegalArgumentException("the cap is at least 1: " + value);
      }
      this.maxConnectionTasks = value;
      return this;
    }

    /**
     * SDK 1.9.0 (CR-0048 point 5): the manifest's {@code compute.threads}, 1 to {@link
     * dev.emcc.sdk.compute.Computes#MAX_DECLARED}; without it the plugin declares none and every
     * start is refused ({@code NOT_DECLARED}). The admin allows all of them unless {@link
     * #computeAllowed(int)} says otherwise.
     */
    public Builder compute(int threads) {
      if (threads < 1 || threads > dev.emcc.sdk.compute.Computes.MAX_DECLARED) {
        throw new IllegalArgumentException("a manifest declares 1 to " + dev.emcc.sdk.compute.Computes.MAX_DECLARED + " compute threads: " + threads);
      }
      this.computeThreads = threads;
      return this;
    }

    /** SDK 1.9.0: the admin's allowed compute threads for the plugin at the start, 0 to the declaration (later {@code compute().allow}). */
    public Builder computeAllowed(int threads) {
      if (threads < 0) {
        throw new IllegalArgumentException("allowed is 0 or more: " + threads);
      }
      this.computeAllowed = threads;
      return this;
    }

    /** SDK 1.9.0: ECore's total cap of running compute tasks (by default no limit in the fake). At least 1. */
    public Builder computeTotalCap(int tasks) {
      if (tasks < 1) {
        throw new IllegalArgumentException("the total cap is at least 1: " + tasks);
      }
      this.computeTotalCap = tasks;
      return this;
    }

    /** SDK 1.8.0: ECore's cap on open streams; lower it to test the refusal. 1 to {@link #DEFAULT_MAX_STREAMS}. */
    public Builder maxStreams(int value) {
      if (value < 1 || value > DEFAULT_MAX_STREAMS) {
        throw new IllegalArgumentException("the cap is 1.." + DEFAULT_MAX_STREAMS + ": " + value);
      }
      this.maxStreams = value;
      return this;
    }

    /** SDK 1.2.0: TLS credentials a connection task gets by name ({@code task.tls(name)}), as local server configuration would give them. */
    public Builder tlsCredentials(String name, javax.net.ssl.SSLContext context) {
      this.tlsCredentials.put(Objects.requireNonNull(name, "name"), Objects.requireNonNull(context, "context"));
      this.refusedTlsCredentials.remove(name);
      return this;
    }

    /**
     * SDK 1.9.0 (ADR-0062 point 4): TLS credentials whose own certificate expired on {@code expiredOn}.
     * {@code task.tls(name)} and {@code sslContext(name)} throw {@link IllegalStateException} with
     * ECore's message, which names the credential and the date, e.g. {@code the TLS credential
     * tak-north: its certificate expired on 2026-01-31} (ECore's also names the certificate's
     * subject), so a test can check how the task fails its start and what its status shows.
     */
    public Builder expiredTlsCredentials(String name, java.time.LocalDate expiredOn) {
      this.refusedTlsCredentials.put(Objects.requireNonNull(name, "name"), FakeTls.expired(name, expiredOn));
      this.tlsCredentials.remove(name);
      return this;
    }

    /**
     * SDK 1.9.0 (ADR-0062 point 4): TLS credentials ECore cannot read, for {@code reason} (e.g. a
     * wrong password or a missing file). {@code task.tls(name)} and {@code sslContext(name)} throw
     * {@link IllegalStateException} with ECore's message: {@code the TLS credential <name> cannot be
     * read: <reason>}.
     */
    public Builder unreadableTlsCredentials(String name, String reason) {
      this.refusedTlsCredentials.put(Objects.requireNonNull(name, "name"), FakeTls.unreadable(name, reason));
      this.tlsCredentials.remove(name);
      return this;
    }

    /**
     * SDK 1.6.0: bearer tokens configured in local server configuration under these names, for
     * {@code HttpCall.credential(name)}. The fake never holds the tokens: a call naming one of these
     * is sent (see {@link FakePluginContext#httpCalls()}), and one naming another fails at once with
     * {@code "no credential <name>"}, as ECore does.
     */
    public Builder httpCredentials(String... names) {
      for (String name : names) {
        this.httpCredentials.add(Objects.requireNonNull(name, "name"));
      }
      return this;
    }

    /** SDK 1.2.0: ECore's cap on the channels the plugin offers; lower it to test the refusal. At least 1. */
    public Builder maxChannels(int value) {
      if (value < 1) {
        throw new IllegalArgumentException("the cap is at least 1: " + value);
      }
      this.maxChannels = value;
      return this;
    }

    /** SDK 1.2.0: the configured order of classifications per policy (default: {@link dev.emcc.sdk.Classifications#nato()}). */
    public Builder classifications(dev.emcc.sdk.Classifications value) {
      this.classifications = Objects.requireNonNull(value, "classifications");
      return this;
    }

    /** SDK 1.2.0: the fields the loaded plugins declare (ADR-0038), the plugin's own included. Default: none. */
    public Builder declaredFields(dev.emcc.sdk.DeclaredField... fields) {
      this.declaredFields = List.of(fields);
      return this;
    }

    /**
     * SDK 1.4.0: the field sets the loaded plugins declare (ADR-0050), the plugin's own included.
     * Default: none. As ECore, each set's fields must be among {@link #declaredFields} of its plugin,
     * and each id once.
     */
    public Builder fieldSets(dev.emcc.sdk.FieldSet... value) {
      var ids = new java.util.HashSet<String>();
      for (dev.emcc.sdk.FieldSet s : value) {
        if (!ids.add(s.id())) {
          throw new IllegalArgumentException("a field set is declared twice: " + s.id());
        }
        for (String name : s.fields()) {
          boolean declared = declaredFields.stream().anyMatch(d -> d.plugin().equals(s.plugin()) && d.name().equals(name));
          if (!declared) {
            throw new IllegalArgumentException("the field set " + s.id() + " names a field its plugin does not declare: " + name + " (call declaredFields first)");
          }
        }
      }
      this.fieldSets = List.of(value);
      return this;
    }

    /**
     * SDK 1.4.0 (CR-0030 part 6): a folder the plugin's manifest declares, as {@code folders[].id},
     * with the path its setting holds; {@code null} for an empty setting. At most 8, each id once.
     */
    public Builder folder(String id, java.nio.file.@Nullable Path path) {
      if (!id.matches("^[a-z][a-z0-9-]*$") || id.length() > 64) {
        throw new IllegalArgumentException("not a folder id: " + id);
      }
      if (folders.containsKey(id)) {
        throw new IllegalArgumentException("the folder \"" + id + "\" is declared twice");
      }
      if (folders.size() == 8) {
        throw new IllegalArgumentException("at most 8 folders");
      }
      folders.put(id, path);
      return this;
    }

    /** SDK 1.4.0: the relation kinds the loaded plugins declare (ADR-0051 point 2). Default: none. Each id once. */
    public Builder relationKinds(dev.emcc.sdk.RelationKind... value) {
      if (java.util.Arrays.stream(value).map(dev.emcc.sdk.RelationKind::id).distinct().count() != value.length) {
        throw new IllegalArgumentException("a relation kind is declared twice");
      }
      this.relationKinds = List.of(value);
      return this;
    }

    /** SDK 1.2.0: the workspaces the loaded plugins declare (ADR-0039); View always comes first. Default: View only. */
    public Builder workspaces(dev.emcc.sdk.Workspace... value) {
      if (java.util.Arrays.stream(value).map(dev.emcc.sdk.Workspace::id).distinct().count() != value.length) {
        throw new IllegalArgumentException("a workspace id is listed twice");
      }
      this.workspaces = List.of(value);
      return this;
    }

    public FakePluginContext build() {
      return new FakePluginContext(this);
    }
  }
}
