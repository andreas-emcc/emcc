package dev.emcc.ecore.plugin;

import dev.emcc.ecore.runtime.Cancellable;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpCall;
import dev.emcc.sdk.http.HttpResult;
import dev.emcc.sdk.http.OutboundHttp;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.ByteArrayOutputStream;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * A plugin's outbound HTTP (SDK v0 design, "Outbound HTTP"): ECore makes the call with the JDK's
 * HTTP client, outside the worker, and delivers exactly one {@link HttpResult} to the target worker,
 * always (whatever its overflow policy). The mapper runs inside the target worker.
 *
 * <p>Any host (ADR-0030, CR-0013; owner, 2026-10-18): ECore does not check the host, and the manifest's
 * {@code internet} is a declaration, shown in the monitor view, not an allow-list. A plugin never
 * takes a host from a browser request, a message or an object's data (CLAUDE.md section 4; the
 * reviews check it). Limits: {@code GET}, and from SDK 1.6.0 {@code POST} (CR-0041 part A), no
 * redirects, a response body limit (the call's own, up to {@link HttpCall#MAX_RESPONSE_BYTES}), and
 * a limit on concurrent calls per plugin. A call beyond a limit fails at once. A call from a fenced
 * thread is dropped.
 *
 * <p>SDK 1.6.0: a call naming a {@link HttpCall#credential} gets {@code Authorization: Bearer
 * <token>}, the token from the server's local configuration under that name ({@code
 * emc2.http.credentials.<name>.token}; shared by name, owner 2026-11-12), also over plain {@code
 * http}. The plugin never sees the token and no log line shows it. A name that is not configured
 * fails at once, before the call takes a slot.
 */
final class PluginHttp implements OutboundHttp {

  /** The longest allowed timeout of one call. */
  static final Duration MAX_TIMEOUT = Duration.ofMinutes(10);

  private static final Logger LOG = LoggerFactory.getLogger(PluginHttp.class);
  private static final Set<Integer> REDIRECTS = Set.of(301, 302, 303, 307, 308);

  private final String pluginId;
  private final HttpClient client;
  private final WorkerRuntime runtime;
  private final AtomicInteger inFlight = new AtomicInteger();
  /** SDK 1.6.0: the bearer tokens by name; never logged. */
  private final Map<String, String> tokens;

  PluginHttp(String pluginId, HttpClient client, WorkerRuntime runtime) {
    this(pluginId, client, runtime, Map.of());
  }

  PluginHttp(String pluginId, HttpClient client, WorkerRuntime runtime, Map<String, String> tokens) {
    this.pluginId = pluginId;
    this.client = client;
    this.runtime = runtime;
    this.tokens = Map.copyOf(tokens);
  }

  /** The client all plugins share: no redirects, its completions on the runtime's I/O threads. */
  static HttpClient newClient(WorkerRuntime runtime) {
    return HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.NEVER)
        .connectTimeout(Duration.ofSeconds(10))
        .executor(runtime.ioExecutor())
        .build();
  }

  @Override
  public <M extends Message> void send(
      HttpCall call, Duration timeout, WorkerRef<M> target, Function<HttpResult, ? extends M> toMessage) {
    Objects.requireNonNull(call, "call");
    Objects.requireNonNull(timeout, "timeout");
    Objects.requireNonNull(toMessage, "toMessage");
    WorkerHandle<M> handle = PluginWorkers.handleOf(target);
    if (timeout.isNegative() || timeout.isZero() || timeout.compareTo(MAX_TIMEOUT) > 0) {
      throw new IllegalArgumentException("timeout must be more than 0 and at most " + MAX_TIMEOUT + ": " + timeout);
    }
    if (WorkerRuntime.onFencedThread()) {
      LOG.warn("Plugin {}: dropped an outbound call to {} made from a fenced thread", pluginId, call.uri().getHost());
      return;
    }
    Result<M> result = new Result<>(handle, toMessage);
    String credential = call.credential();
    String token = credential == null ? null : tokens.get(credential);
    if (credential != null && token == null) {
      result.complete(new HttpResult.Failed("no credential " + credential));
      return;
    }
    if (inFlight.incrementAndGet() > MAX_CONCURRENT_CALLS) {
      inFlight.decrementAndGet();
      result.complete(new HttpResult.Failed("more than " + MAX_CONCURRENT_CALLS + " calls at a time"));
      return;
    }
    HttpRequest request;
    try {
      HttpRequest.Builder builder = HttpRequest.newBuilder(call.uri()).timeout(timeout);
      String mediaType = call.mediaType();
      if (call.method().equals("POST") && mediaType != null) {
        builder.POST(HttpRequest.BodyPublishers.ofByteArray(call.body().toArray())).header("Content-Type", mediaType);
      } else {
        builder.GET();
      }
      call.headers().entries().forEach(h -> builder.header(h.name(), h.value()));
      if (token != null) {
        builder.header("Authorization", "Bearer " + token);
      }
      request = builder.build();
    } catch (IllegalArgumentException e) { // e.g. a header the client sets itself (Host, Connection)
      inFlight.decrementAndGet();
      result.complete(new HttpResult.Failed("bad request: " + e.getMessage()));
      return;
    }
    // Whatever happens from here on, the slot is given back once and exactly one result arrives.
    AtomicReference<@Nullable CompletableFuture<?>> started = new AtomicReference<>();
    Cancellable timer;
    try {
      timer = runtime.schedule(timeout, () -> {
        if (result.complete(new HttpResult.TimedOut())) {
          CompletableFuture<?> f = started.get();
          if (f != null) {
            f.cancel(true);
          }
        }
      });
    } catch (RuntimeException e) {
      inFlight.decrementAndGet();
      result.complete(new HttpResult.Failed("could not start the call: " + e));
      return;
    }
    CompletableFuture<HttpResponse<byte[]>> response;
    try {
      int limit = call.maxResponseBytes();
      response = client.sendAsync(request, info -> new LimitedBody(limit));
    } catch (RuntimeException e) {
      timer.cancel();
      inFlight.decrementAndGet();
      result.complete(new HttpResult.Failed("could not start the call: " + e));
      return;
    }
    started.set(response);
    if (result.isDone()) {
      response.cancel(true); // timed out before the call was even started
    }
    response.whenComplete((r, error) -> {
      inFlight.decrementAndGet();
      timer.cancel();
      result.complete(error == null ? toResult(r) : toResult(error, call.maxResponseBytes()));
    });
  }

  /** How many calls of this plugin are in progress (tests). */
  int inFlight() {
    return inFlight.get();
  }

  private static HttpResult toResult(HttpResponse<byte[]> response) {
    int status = response.statusCode();
    if (REDIRECTS.contains(status)) {
      return new HttpResult.Failed("redirect (HTTP " + status + ") not followed in SDK v0");
    }
    List<Headers.Header> headers = new ArrayList<>();
    response.headers().map().forEach((name, values) -> {
      for (String value : values) {
        try {
          headers.add(new Headers.Header(name, value));
        } catch (IllegalArgumentException e) {
          // not a valid header for the SDK (e.g. an HTTP/2 pseudo-header): left out
        }
      }
    });
    return new HttpResult.Response(status, new Headers(headers), Bytes.of(response.body()));
  }

  private static HttpResult toResult(Throwable error, int limit) {
    Throwable cause = error instanceof CompletionException && error.getCause() != null ? error.getCause() : error;
    return switch (cause) {
      case HttpTimeoutException t -> new HttpResult.TimedOut();
      case CancellationException c -> new HttpResult.TimedOut(); // cancelled by our own timer
      case BodyTooLarge b -> new HttpResult.Failed("response body larger than " + limit + " bytes");
      default -> new HttpResult.Failed(String.valueOf(cause));
    };
  }

  /** Delivers the one result of a call, mapped inside the target worker. */
  private final class Result<M extends Message> {
    private final WorkerHandle<M> target;
    private final Function<HttpResult, ? extends M> toMessage;
    private final AtomicBoolean done = new AtomicBoolean();

    Result(WorkerHandle<M> target, Function<HttpResult, ? extends M> toMessage) {
      this.target = target;
      this.toMessage = toMessage;
    }

    boolean isDone() {
      return done.get();
    }

    /** Returns false if a result was already delivered. */
    boolean complete(HttpResult result) {
      if (!done.compareAndSet(false, true)) {
        return false;
      }
      runtime.deliverAlways(target, () -> toMessage.apply(result));
      return true;
    }
  }

  private static final class BodyTooLarge extends RuntimeException {
    BodyTooLarge() {
      super(null, null, false, false);
    }
  }

  /** Collects the body, but gives up above {@code limit} bytes. */
  private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
    private final int limit;
    private final ByteArrayOutputStream out = new ByteArrayOutputStream();
    private final CompletableFuture<byte[]> body = new CompletableFuture<>();
    private Flow.@Nullable Subscription subscription;

    LimitedBody(int limit) {
      this.limit = limit;
    }

    @Override
    public CompletionStage<byte[]> getBody() {
      return body;
    }

    @Override
    public void onSubscribe(Flow.Subscription s) {
      subscription = s;
      s.request(Long.MAX_VALUE);
    }

    @Override
    public void onNext(List<ByteBuffer> buffers) {
      if (body.isDone()) {
        return;
      }
      for (ByteBuffer buffer : buffers) {
        if (out.size() + buffer.remaining() > limit) {
          Flow.Subscription s = subscription;
          if (s != null) {
            s.cancel();
          }
          body.completeExceptionally(new BodyTooLarge());
          return;
        }
        byte[] chunk = new byte[buffer.remaining()];
        buffer.get(chunk);
        out.writeBytes(chunk);
      }
    }

    @Override
    public void onError(Throwable error) {
      body.completeExceptionally(error);
    }

    @Override
    public void onComplete() {
      body.complete(out.toByteArray());
    }
  }
}
