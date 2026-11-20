package dev.emcc.ecore.plugin;

import java.util.Map;
import dev.emcc.sdk.Bytes;
import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import dev.emcc.ecore.runtime.ManualTime;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.RuntimeListener;
import dev.emcc.ecore.runtime.Scheduler;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.http.HttpCall;
import dev.emcc.sdk.http.HttpResult;
import dev.emcc.sdk.http.OutboundHttp;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.net.Authenticator;
import java.net.CookieHandler;
import java.net.ProxySelector;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Outbound HTTP for plugins, against a local server. */
class PluginHttpTest {

  record Fetched(String what, HttpResult result) implements Message {}

  private static final String ID = "fetcher";

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final Probe<Fetched> results = new Probe<>();
  private final CountDownLatch release = new CountDownLatch(1);
  private final ExecutorService serverThreads = Executors.newCachedThreadPool();
  private HttpServer server;
  private OutboundHttp http;
  private WorkerRef<Fetched> worker;

  @BeforeEach
  void start() throws IOException {
    server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    server.setExecutor(serverThreads);
    server.createContext("/ok", ex -> answer(ex, 200, "hello"));
    server.createContext("/not-modified", ex -> answer(ex, 304, null));
    server.createContext("/echo", ex -> { // SDK 1.6.0: what the call sent
      String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
      answer(ex, 200, ex.getRequestMethod() + "|" + ex.getRequestHeaders().getFirst("Content-Type") + "|"
          + ex.getRequestHeaders().getFirst("Authorization") + "|" + ex.getRequestHeaders().getFirst("SOAPAction") + "|" + body);
    });
    server.createContext("/redirect", ex -> {
      ex.getResponseHeaders().add("Location", "/ok");
      answer(ex, 302, null);
    });
    server.createContext("/big", ex -> {
      ex.sendResponseHeaders(200, 0); // chunked, so only the body subscriber can stop it
      try (OutputStream out = ex.getResponseBody()) {
        byte[] chunk = new byte[64 * 1024];
        for (int sent = 0; sent <= OutboundHttp.MAX_BODY_BYTES; sent += chunk.length) {
          out.write(chunk);
        }
      } catch (IOException e) {
        // the client gave up, as it should
      }
    });
    server.createContext("/slow", ex -> {
      try {
        release.await(Probe.HOLD.toMillis(), TimeUnit.MILLISECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
      answer(ex, 200, "late");
    });
    server.start();
    http = new PluginHttp(ID, PluginHttp.newClient(runtime), runtime);
    worker = new PluginWorkers(ID, runtime.owner(ID), new URLClassLoader(new java.net.URL[0], getClass().getClassLoader()))
        .spawn(WorkerSpec.of("fetch", Fetched.class, () -> (message, ctx) -> results.add(message)).mailbox(1, dev.emcc.sdk.worker.Overflow.dropNewest()));
  }

  @AfterEach
  void stop() {
    release.countDown();
    server.stop(0);
    serverThreads.shutdownNow();
    runtime.close();
  }

  private static void answer(HttpExchange exchange, int status, String body) throws IOException {
    exchange.getResponseHeaders().add("X-Test", "yes");
    if (body == null) {
      exchange.sendResponseHeaders(status, -1);
    } else {
      byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(status, bytes.length);
      try (OutputStream out = exchange.getResponseBody()) {
        out.write(bytes);
      }
    }
    exchange.close();
  }

  private void fetch(String path, Duration timeout) {
    fetch("http://127.0.0.1:" + server.getAddress().getPort() + path, path, timeout);
  }

  private void fetch(String uri, String what, Duration timeout) {
    http.send(HttpCall.get(URI.create(uri)).header("User-Agent", "emc2-test"), timeout, worker, r -> new Fetched(what, r));
  }

  @Test
  void aResponseArrivesAsAMessageWithStatusHeadersAndBody() {
    fetch("/ok", Duration.ofSeconds(5));

    HttpResult result = results.next().result();
    assertThat(result).isInstanceOfSatisfying(HttpResult.Response.class, r -> {
      assertThat(r.status()).isEqualTo(200);
      assertThat(r.headers().first("x-test")).isEqualTo("yes");
      assertThat(r.body().toUtf8()).isEqualTo("hello");
    });
  }

  @Test
  void resultsAreDeliveredEvenIntoAFullMailbox() {
    // The worker's mailbox holds one message and drops the newest; results are exempt.
    fetch("/ok", Duration.ofSeconds(5));
    fetch("/ok", Duration.ofSeconds(5));
    fetch("/ok", Duration.ofSeconds(5));

    assertThat(results.next(3)).allSatisfy(f -> assertThat(f.result()).isInstanceOf(HttpResult.Response.class));
  }

  @Test
  void anyHostIsCalledTheManifestOnlyDeclaresThem() {
    // ADR-0030, CR-0013 (owner, 2026-10-18): a plugin may call any host; its manifest only declares that it does.
    int port = server.getAddress().getPort();
    for (String host : List.of("localhost", "LocalHost", "127.0.0.1", "someone@127.0.0.1")) {
      assertThat(fetchWith(http, "http://" + host + ":" + port + "/ok")).as(host).isInstanceOf(HttpResult.Response.class);
    }
  }

  @Test
  void redirectsAreNotFollowedButOther3xxAnswersArrive() {
    fetch("/redirect", Duration.ofSeconds(5));
    assertThat(results.next().result()).isInstanceOfSatisfying(HttpResult.Failed.class,
        f -> assertThat(f.reason()).contains("redirect (HTTP 302)"));

    fetch("/not-modified", Duration.ofSeconds(5));
    assertThat(results.next().result()).isInstanceOfSatisfying(HttpResult.Response.class,
        r -> assertThat(r.status()).isEqualTo(304));
  }

  @Test
  void aBodyOverTheLimitFails() {
    fetch("/big", Duration.ofSeconds(30));

    assertThat(results.next().result()).isInstanceOfSatisfying(HttpResult.Failed.class,
        f -> assertThat(f.reason()).contains("larger than " + OutboundHttp.MAX_BODY_BYTES));
  }

  @Test
  void aSlowAnswerTimesOut() {
    fetch("/slow", Duration.ofMillis(200));

    assertThat(results.next().result()).isInstanceOf(HttpResult.TimedOut.class);
  }

  @Test
  void callsBeyondTheConcurrencyLimitFailAtOnce() {
    for (int i = 0; i < OutboundHttp.MAX_CONCURRENT_CALLS; i++) {
      fetch("/slow", Duration.ofSeconds(30));
    }
    fetch("/ok", Duration.ofSeconds(5));

    Fetched first = results.next();
    assertThat(first.what()).isEqualTo("/ok");
    assertThat(first.result()).isEqualTo(new HttpResult.Failed("more than 16 calls at a time"));

    release.countDown();
    List<HttpResult> slow = new ArrayList<>();
    results.next(OutboundHttp.MAX_CONCURRENT_CALLS).forEach(f -> slow.add(f.result()));
    assertThat(slow).allSatisfy(r -> assertThat(r).isInstanceOf(HttpResult.Response.class));
    fetch("/ok", Duration.ofSeconds(5)); // the slots are free again
    assertThat(results.next().result()).isInstanceOf(HttpResult.Response.class);
  }

  private HttpResult fetchWith(OutboundHttp client, String uri) {
    client.send(HttpCall.get(URI.create(uri)), Duration.ofSeconds(5), worker, r -> new Fetched(uri, r));
    return results.next().result();
  }

  @Test
  void theHostIsNotLookedUpOnTheCallersThread() {
    RecordingResolverProvider.THREADS.clear();
    HttpResult result = fetchWith(http, "http://" + RecordingResolverProvider.HOST + ":" + server.getAddress().getPort() + "/ok");

    assertThat(result).isInstanceOf(HttpResult.Response.class);
    assertThat(RecordingResolverProvider.THREADS).isNotEmpty().doesNotContain(Thread.currentThread().getName());
  }

  @Test
  void aCallThatCannotBeStartedFailsAndGivesItsSlotBack() {
    PluginHttp broken = new PluginHttp(ID, new ThrowingClient(), runtime);

    for (int i = 0; i <= OutboundHttp.MAX_CONCURRENT_CALLS; i++) {
      assertThat(fetchWith(broken, "http://127.0.0.1:1/ok")).asString().contains("could not start the call");
    }
    assertThat(broken.inFlight()).isZero();
    assertThat(results.drain()).as("exactly one result per call").isEmpty();
  }

  @Test
  void aCallWhoseTimeoutTheSchedulerRefusesFailsAndGivesItsSlotBack() {
    ManualTime clock = new ManualTime();
    Duration refused = Duration.ofSeconds(7); // no other task of the runtime has this delay
    Scheduler refusing = (delay, task) -> {
      if (delay.equals(refused)) {
        throw new IllegalStateException("the scheduler refused it");
      }
      return clock.schedule(delay, task);
    };
    try (WorkerRuntime other = WorkerRuntime.start(
        new RuntimeConfig(clock, refusing, Duration.ofMillis(100), 3, Duration.ofMinutes(10), RuntimeListener.NONE, 2))) {
      Probe<Fetched> got = new Probe<>();
      WorkerRef<Fetched> receiver = new PluginWorkers(ID, other.owner(ID), getClass().getClassLoader())
          .spawn(WorkerSpec.of("fetch", Fetched.class, () -> (message, ctx) -> got.add(message)));
      PluginHttp refusingHttp = new PluginHttp(ID, PluginHttp.newClient(other), other);

      refusingHttp.send(HttpCall.get(URI.create("http://127.0.0.1:1/ok")), refused, receiver, r -> new Fetched("refused", r));

      assertThat(got.next().result()).isInstanceOfSatisfying(HttpResult.Failed.class,
          f -> assertThat(f.reason()).contains("could not start the call").contains("the scheduler refused it"));
      assertThat(refusingHttp.inFlight()).isZero();
      assertThat(got.drain()).as("exactly one result").isEmpty();
    }
  }

  @Test
  void theManifestsDeclaredHostsAreKeptInLowerCaseAsHostNamesCompare() {
    assertThat(new PluginManifest.Internet(List.of("Tile.OpenStreetMap.ORG"), "Demos only.").hosts())
        .containsExactly("tile.openstreetmap.org");
  }

  @Test
  void aHeaderTheClientSetsItselfFailsTheCall() {
    // From SDK 1.6.0 HttpCall itself refuses Host; Connection is one more the JDK's client sets itself.
    http.send(HttpCall.get(URI.create("http://127.0.0.1:1/ok")).header("Connection", "close"), Duration.ofSeconds(5),
        worker, r -> new Fetched("connection header", r));

    assertThat(results.next().result()).isInstanceOfSatisfying(HttpResult.Failed.class,
        f -> assertThat(f.reason()).startsWith("bad request"));
  }

  private URI echo() {
    return URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/echo");
  }

  private String echoed() {
    HttpResult result = results.next().result();
    assertThat(result).isInstanceOf(HttpResult.Response.class);
    return ((HttpResult.Response) result).body().toUtf8();
  }

  @Test
  void aPostSendsItsBodyAsItsMediaTypeWithItsHeaders() { // SDK 1.6.0, CR-0041 part A
    http.send(HttpCall.post(echo(), "text/xml; charset=utf-8", Bytes.utf8("<Envelope/>")).header("SOAPAction", "\"GetNvg\""),
        Duration.ofSeconds(5), worker, r -> new Fetched("post", r));

    assertThat(echoed()).isEqualTo("POST|text/xml; charset=utf-8|null|\"GetNvg\"|<Envelope/>");
  }

  @Test
  void aNamedCredentialSendsItsBearerTokenWhichThePluginNeverSees() {
    http = new PluginHttp(ID, PluginHttp.newClient(runtime), runtime, Map.of("anet", "s3cret-token"));
    http.send(HttpCall.get(echo()).credential("anet"), Duration.ofSeconds(5), worker, r -> new Fetched("token", r));
    assertThat(echoed()).isEqualTo("GET|null|Bearer s3cret-token|null|");

    http.send(HttpCall.get(echo()), Duration.ofSeconds(5), worker, r -> new Fetched("no token", r));
    assertThat(echoed()).isEqualTo("GET|null|null|null|"); // only a call that names it
  }

  @Test
  void aCredentialThatIsNotConfiguredFailsAtOnceWithoutTakingASlot() {
    PluginHttp withTokens = new PluginHttp(ID, PluginHttp.newClient(runtime), runtime, Map.of("anet", "s3cret-token"));
    withTokens.send(HttpCall.get(echo()).credential("other"), Duration.ofSeconds(5), worker, r -> new Fetched("unknown", r));

    assertThat(results.next().result()).isEqualTo(new HttpResult.Failed("no credential other"));
    assertThat(withTokens.inFlight()).isZero();
  }

  @Test
  void aCallsOwnResponseLimitCountsAndTheFailureNamesIt() {
    http.send(HttpCall.get(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/ok")).maxResponseBytes(3),
        Duration.ofSeconds(5), worker, r -> new Fetched("small", r));
    assertThat(results.next().result()).isEqualTo(new HttpResult.Failed("response body larger than 3 bytes"));

    http.send(HttpCall.get(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/big")).maxResponseBytes(HttpCall.MAX_RESPONSE_BYTES),
        Duration.ofSeconds(30), worker, r -> new Fetched("big", r));
    assertThat(results.next().result()).isInstanceOfSatisfying(HttpResult.Response.class, // more than the default 10 MiB, under 16
        r -> assertThat(r.body().size()).isGreaterThan(OutboundHttp.MAX_BODY_BYTES));
  }

  @Test
  void theConfigurationNeverShowsATokenOnlyItsName() {
    ListenerConfig config = ListenerConfig.DEFAULT.withHttpTokens(Map.of("anet", "s3cret-token"));
    assertThat(config.toString()).contains("anet").doesNotContain("s3cret");
    assertThat(config.httpTokens()).containsEntry("anet", "s3cret-token");
  }

  /** A client whose calls cannot even be started. */
  private static final class ThrowingClient extends HttpClient {
    @Override
    public Optional<CookieHandler> cookieHandler() {
      return Optional.empty();
    }

    @Override
    public Optional<Duration> connectTimeout() {
      return Optional.empty();
    }

    @Override
    public Redirect followRedirects() {
      return Redirect.NEVER;
    }

    @Override
    public Optional<ProxySelector> proxy() {
      return Optional.empty();
    }

    @Override
    public SSLContext sslContext() {
      throw new UnsupportedOperationException();
    }

    @Override
    public SSLParameters sslParameters() {
      throw new UnsupportedOperationException();
    }

    @Override
    public Optional<Authenticator> authenticator() {
      return Optional.empty();
    }

    @Override
    public Version version() {
      return Version.HTTP_1_1;
    }

    @Override
    public Optional<Executor> executor() {
      return Optional.empty();
    }

    @Override
    public <T> HttpResponse<T> send(HttpRequest request, HttpResponse.BodyHandler<T> handler) {
      throw new IllegalStateException("closed");
    }

    @Override
    public <T> CompletableFuture<HttpResponse<T>> sendAsync(HttpRequest request, HttpResponse.BodyHandler<T> handler) {
      throw new IllegalStateException("closed");
    }

    @Override
    public <T> CompletableFuture<HttpResponse<T>> sendAsync(
        HttpRequest request, HttpResponse.BodyHandler<T> handler, HttpResponse.PushPromiseHandler<T> push) {
      throw new IllegalStateException("closed");
    }
  }
}
