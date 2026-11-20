package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.runtime.ManualTime;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.User;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLClassLoader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * SDK 1.2.0's {@code POST} endpoints (CR-0026, with the ACA's R2 to R4): ECore's answers in the
 * SDK's order, the body it checks and parses before delivery, and its log lines.
 */
class PluginPostEndpointsTest {

  sealed interface Msg extends Message {
    record Call(EndpointRequest request) implements Msg {}

    enum Block implements Msg { BLOCK }
  }

  private static final String ID = "simulator";
  private static final String RUN = "plugin.simulator.run";
  private static final int MAX_BODY = 64;
  private static final User RUNNER = User.of("u-1", "Runner", Set.of(RUN));
  private static final User VIEWER = User.of("u-2", "Viewer", Set.of("objects.edit"));

  private final ManualTime time = new ManualTime();
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time));
  private final List<String> log = new CopyOnWriteArrayList<>();
  private final PluginEndpoints endpoints = new PluginEndpoints(runtime, new ModelJson(), log::add);
  private final PluginWorkers workers =
      new PluginWorkers(ID, runtime.owner(ID), new URLClassLoader(new java.net.URL[0], getClass().getClassLoader()));
  private final Probe<String> seen = new Probe<>();
  private final Probe<HttpReply> answers = new Probe<>();
  private final CountDownLatch release = new CountDownLatch(1);

  @AfterEach
  void close() {
    release.countDown();
    runtime.close();
  }

  /** Answers 202 with what it got: the method, the body as JSON, the path parameter; "silent" never answers. */
  private WorkerRef<Msg> engine() {
    return workers.spawn(WorkerSpec.of("engine", Msg.class, () -> (message, ctx) -> {
      if (!(message instanceof Msg.Call call)) {
        return;
      }
      EndpointRequest r = call.request();
      seen.add(r.method() + " " + r.path() + (r.user().noLogin() ? "" : " for " + r.user().id()));
      if (r.path().endsWith("/silent")) {
        return;
      }
      r.response().respond(HttpReply.json(202, r.body() == null ? JsonString.of("no body") : r.body()));
    }).mailbox(10, Overflow.dropNewest()));
  }

  /** {@code POST /routes/{id}/start} (needs RUN, at most 64 bytes) and {@code GET /routes/{id}/start}; {@code GET /status}. */
  private void registered() {
    WorkerRef<Msg> engine = engine();
    endpoints.of(ID).register(Endpoint.post("/routes/{id}/start").requires(RUN).maxBody(MAX_BODY), engine, Msg.Call::new);
    endpoints.of(ID).register(Endpoint.get("/routes/{id}/start"), engine, Msg.Call::new);
    endpoints.of(ID).register(Endpoint.get("/status"), engine, Msg.Call::new);
    endpoints.of(ID).register(Endpoint.post("/reset").requires(RUN).timeout(Duration.ofSeconds(1)), engine, Msg.Call::new);
    endpoints.of(ID).register(Endpoint.post("/reset/silent").requires(RUN).timeout(Duration.ofSeconds(1)), engine, Msg.Call::new);
  }

  private void send(String method, String path, User user, Headers headers, InputStream body) {
    endpoints.dispatch(new PluginEndpoints.Request(ID, method, path, Map.of(), headers, user), body, answers::add);
  }

  private static Headers json() {
    return Headers.of("Content-Type", "application/json");
  }

  private static InputStream bytes(byte[] body) {
    return new ByteArrayInputStream(body);
  }

  private static InputStream text(String body) {
    return bytes(body.getBytes(StandardCharsets.UTF_8));
  }

  /** A body that fails the test if anything reads it. */
  private static InputStream unread() {
    return new InputStream() {
      @Override
      public int read() {
        throw new AssertionError("the body was read");
      }

      @Override
      public int read(byte[] b, int off, int len) {
        throw new AssertionError("the body was read");
      }
    };
  }

  /** A POST of {@code body} as JSON by the runner to {@code /routes/r1/start}; returns ECore's or the plugin's answer. */
  private HttpReply post(String body) {
    send("POST", "/routes/r1/start", RUNNER, json(), text(body));
    return answers.next();
  }

  private HttpReply post(Headers headers, byte[] body) {
    send("POST", "/routes/r1/start", RUNNER, headers, bytes(body));
    return answers.next();
  }

  @Test
  void aPostArrivesWithItsMethodAndItsParsedBodyWithNumbersExactlyAsWritten() {
    registered();

    HttpReply reply = post("{\"v\": 1.50, \"n\": 12345678901234567890, \"s\": \"R\\u00e5\"}");

    assertThat(seen.next()).isEqualTo("POST /routes/r1/start for u-1");
    assertThat(reply.status()).isEqualTo(202);
    assertThat(reply.body().toUtf8()).isEqualTo("{\"v\":1.50,\"n\":12345678901234567890,\"s\":\"Rå\"}");
  }

  @Test
  void aGetStillArrivesWithoutABodyAndAHeadAsAGet() {
    registered();

    send("GET", "/routes/r1/start", VIEWER, Headers.empty(), text("{\"ignored\": true}"));
    send("HEAD", "/status", VIEWER, Headers.empty(), InputStream.nullInputStream());

    assertThat(seen.next(2)).containsExactly("GET /routes/r1/start for u-2", "GET /status for u-2");
    assertThat(answers.next(2)).extracting(r -> r.body().toUtf8()).containsOnly("\"no body\"");
  }

  @Test
  void aPathWithoutAnEndpointForTheMethodGets405WithTheMethodsItHasInAllow() {
    registered();

    send("POST", "/status", RUNNER, json(), text("{}"));
    send("GET", "/reset", RUNNER, Headers.empty(), InputStream.nullInputStream());
    send("HEAD", "/reset", RUNNER, Headers.empty(), InputStream.nullInputStream()); // R4
    send("PUT", "/routes/r1/start", RUNNER, json(), text("{}"));
    send("POST", "/nothing", RUNNER, json(), text("{}"));

    List<HttpReply> replies = answers.next(5);
    assertThat(replies).extracting(HttpReply::status).containsExactly(405, 405, 405, 405, 404);
    assertThat(replies.subList(0, 4)).extracting(r -> r.headers().first("Allow")).containsExactly("GET", "POST", "POST", "GET, POST");
    assertThat(seen.drain()).as("none delivered").isEmpty();
  }

  @Test
  void eCoreAnswersInTheSdksOrder403Then415Then413Then400() {
    registered();
    byte[] tooLongAndInvalid = "x".repeat(MAX_BODY + 1).getBytes(StandardCharsets.UTF_8);

    send("POST", "/routes/r1/start", VIEWER, Headers.of("Content-Type", "text/plain"), bytes(tooLongAndInvalid));
    send("POST", "/routes/r1/start", RUNNER, Headers.of("Content-Type", "text/plain"), bytes(tooLongAndInvalid));
    send("POST", "/routes/r1/start", RUNNER, json(), bytes(tooLongAndInvalid));
    send("POST", "/routes/r1/start", RUNNER, json(), text("x"));

    assertThat(answers.next(4)).extracting(HttpReply::status).containsExactly(403, 415, 413, 400);
    assertThat(seen.drain()).as("none delivered").isEmpty();
  }

  @Test
  void theBodyIsNotReadBeforeTheChecksBeforeItHavePassed() {
    registered();

    endpoints.dispatch(new PluginEndpoints.Request("nobody", "POST", "/reset", Map.of(), json(), RUNNER), unread(), answers::add);
    send("POST", "/nothing", RUNNER, json(), unread());
    send("POST", "/status", RUNNER, json(), unread());
    send("POST", "/reset", VIEWER, json(), unread());
    send("POST", "/reset", RUNNER, Headers.of("Content-Type", "text/plain"), unread());

    assertThat(answers.next(5)).extracting(HttpReply::status).containsExactly(404, 404, 405, 403, 415);
  }

  @Test
  void aLiteralNullIsABodyTooDeliveredAsJsonNull() {
    registered();

    HttpReply reply = post("null");

    assertThat(seen.next()).isEqualTo("POST /routes/r1/start for u-1");
    assertThat(reply.body().toUtf8()).as("the plugin got JsonNull, not a missing body").isEqualTo("null");
  }

  @Test
  void onlyApplicationJsonWithAtMostTheCharsetUtf8IsAccepted() {
    registered();

    for (String type : List.of("application/json", "Application/JSON", "application/json; charset=utf-8",
        "application/json;CHARSET=\"UTF-8\"", " application/json ; charset = utf-8 ")) {
      assertThat(post(Headers.of("Content-Type", type), "{}".getBytes(StandardCharsets.UTF_8)).status()).as(type).isEqualTo(202);
    }
    for (String type : List.of("text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x",
        "application/json; charset=utf-16", "application/json;", "application/json; foo=bar",
        "application/json; charset=utf-8; foo=bar", "application/json; charset=utf-8; charset=utf-8", "application/jsonx", "application/json-patch+json")) {
      assertThat(post(Headers.of("Content-Type", type), "{}".getBytes(StandardCharsets.UTF_8)).status()).as(type).isEqualTo(415);
    }
    assertThat(post(Headers.empty(), "{}".getBytes(StandardCharsets.UTF_8)).status()).as("no Content-Type").isEqualTo(415);
  }

  @Test
  void aBodyOfMaxBodyBytesIsAcceptedOneMoreGets413EvenWithoutContentLength() {
    registered();
    String fits = "\"" + "x".repeat(MAX_BODY - 2) + "\"";

    assertThat(post(fits).status()).isEqualTo(202);
    assertThat(post(fits + " ").status()).as("one byte more, chunked: no Content-Length").isEqualTo(413);
  }

  @Test
  void aDeclaredLengthAboveMaxBodyGets413WithoutReadingTheBody() {
    registered();
    InputStream unreadable = new InputStream() {
      @Override
      public int read() throws IOException {
        throw new IOException("the body must not be read");
      }
    };

    send("POST", "/routes/r1/start", RUNNER, json().with("Content-Length", String.valueOf(MAX_BODY + 1)), unreadable);

    HttpReply reply = answers.next();
    assertThat(reply.status()).isEqualTo(413);
    assertThat(reply.body().toUtf8()).isEqualTo("the body has more than 64 bytes");
  }

  @Test
  void aBodyThatCannotBeReadGets400() {
    registered();
    InputStream broken = new InputStream() {
      @Override
      public int read() throws IOException {
        throw new IOException("connection reset");
      }
    };

    send("POST", "/routes/r1/start", RUNNER, json(), broken);

    assertThat(answers.next().status()).isEqualTo(400);
  }

  @Test
  void bodiesThatAreNotOneStrictJsonValueGet400NeverAServerError() {
    registered();
    Map<String, byte[]> refused = new java.util.LinkedHashMap<>();
    refused.put("a duplicate key (R2)", utf8("{\"a\": 1, \"a\": 2}"));
    refused.put("two values", utf8("{} {}"));
    refused.put("trailing text", utf8("{} x"));
    refused.put("empty", new byte[0]);
    refused.put("only white space", utf8("  "));
    refused.put("not JSON", utf8("start"));
    refused.put("a comment", utf8("{} // run"));
    refused.put("a single-quoted string", utf8("'run'"));
    refused.put("NaN", utf8("NaN"));
    refused.put("not UTF-8", new byte[] {'"', (byte) 0xC3, (byte) 0x28, '"'});
    refused.put("a UTF-8 byte order mark (R2)", concat(new byte[] {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF}, utf8("{}")));
    refused.put("UTF-16LE with its byte order mark (R2)", concat(new byte[] {(byte) 0xFF, (byte) 0xFE}, encoded("{}", StandardCharsets.UTF_16LE)));
    refused.put("UTF-16LE without one (R2)", encoded("{}", StandardCharsets.UTF_16LE));
    refused.put("UTF-16BE (R2)", encoded("[1]", StandardCharsets.UTF_16BE));
    refused.put("UTF-32 (R2)", encoded("{}", Charset.forName("UTF-32")));

    for (Map.Entry<String, byte[]> body : refused.entrySet()) {
      HttpReply reply = post(json(), body.getValue());
      assertThat(reply.status()).as(body.getKey()).isEqualTo(400);
    }
    assertThat(seen.drain()).as("none delivered").isEmpty();
    assertThat(post(json(), refused.get("a UTF-8 byte order mark (R2)")).body().toUtf8())
        .as("Jackson would refuse it too, with a less helpful reason").isEqualTo("the body starts with a byte order mark");
  }

  @Test
  void aBodyNestedAsDeepAsTheSdkAllowsIsDeliveredOneLevelMoreGets400() {
    WorkerRef<Msg> engine = engine();
    endpoints.of(ID).register(Endpoint.post("/deep").requires(RUN).maxBody(Endpoint.MAX_BODY), engine, Msg.Call::new);
    int max = Endpoint.MAX_BODY_DEPTH;

    send("POST", "/deep", RUNNER, json(), text("[".repeat(max) + "]".repeat(max)));
    assertThat(answers.next().status()).as("Jackson's own default is 500; the SDK allows " + max).isEqualTo(202);
    send("POST", "/deep", RUNNER, json(), text("[".repeat(max + 1) + "]".repeat(max + 1)));
    HttpReply deeper = answers.next();
    assertThat(deeper.status()).isEqualTo(400);
    send("POST", "/deep", RUNNER, json(), text("{\"n\": " + "1".repeat(1001) + "}"));
    assertThat(answers.next().status()).as("a number past the parser's 1000 digits").isEqualTo(400);
  }

  @Test
  void aPostEndpointMustNameAPermission() {
    WorkerRef<Msg> engine = engine();

    assertThatThrownBy(() -> endpoints.of(ID).register(Endpoint.post("/start"), engine, Msg.Call::new))
        .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("POST endpoint /start names no permission");
  }

  @Test
  void theLocalUserOfTheNoLoginModeMayPostAndTheTimeoutAndBusyAnswersStillApply() {
    registered();

    send("POST", "/reset", User.noLoginUser(), json(), text("{}"));
    assertThat(seen.next()).isEqualTo("POST /reset");
    assertThat(answers.next().status()).isEqualTo(202);

    send("POST", "/reset/silent", RUNNER, json(), text("{}"));
    assertThat(seen.next()).isEqualTo("POST /reset/silent for u-1");
    time.advanceSettled(Duration.ofSeconds(1), runtime);
    assertThat(answers.next().status()).isEqualTo(504);
  }

  @Test
  void everyDeliveredPostIsLoggedWhenAnsweredWithPluginPathUserAndStatusButNotItsBody() {
    registered();

    post("{\"secret\": \"do-not-log\"}");
    send("POST", "/reset/silent", RUNNER, json(), text("{}"));
    assertThat(seen.next(2)).hasSize(2);
    time.advanceSettled(Duration.ofSeconds(1), runtime);
    answers.next();
    send("POST", "/reset", User.noLoginUser(), json(), text("{}"));
    answers.next();

    assertThat(log).containsExactly(
        "Plugin simulator: POST /routes/r1/start by user u-1 answered 202",
        "Plugin simulator: POST /reset/silent by user u-1 answered 504",
        "Plugin simulator: POST /reset by the local user (no login) answered 202");
    assertThat(String.join("\n", log)).doesNotContain("do-not-log");
  }

  @Test
  void aPostThatECoreAnswers503Or500AfterTheChecksIsLoggedToo() {
    WorkerRef<Msg> busy = workers.spawn(WorkerSpec.of("busy", Msg.class, () -> (message, ctx) -> {
      seen.add("blocks");
      try {
        release.await(Probe.HOLD.toMillis(), TimeUnit.MILLISECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    }).mailbox(1, Overflow.dropNewest()));
    endpoints.of(ID).register(Endpoint.post("/busy").requires(RUN), busy, Msg.Call::new);
    endpoints.of(ID).register(Endpoint.post("/broken").requires(RUN), busy, request -> {
      throw new IllegalStateException("mapper failed on purpose");
    });
    busy.send(Msg.Block.BLOCK);
    assertThat(seen.next()).isEqualTo("blocks");
    send("POST", "/busy", RUNNER, json(), text("{}")); // queued

    send("POST", "/busy", RUNNER, json(), text("{}")); // refused: the mailbox is full
    assertThat(answers.next().status()).isEqualTo(503);
    release.countDown();
    assertThat(seen.next()).isEqualTo("blocks"); // the queued one, never answered
    send("POST", "/broken", RUNNER, json(), text("{}"));
    assertThat(answers.next().status()).isEqualTo(500);

    assertThat(log).containsExactly(
        "Plugin simulator: POST /busy by user u-1 answered 503",
        "Plugin simulator: POST /broken by user u-1 answered 500");
  }

  @Test
  void aUserIdInALogLineCannotStartALineOfItsOwn() {
    registered();

    send("POST", "/reset", User.of("u-3\nPlugin x: forged", "Forger", Set.of(RUN)), json(), text("{}"));
    answers.next();

    assertThat(log).containsExactly("Plugin simulator: POST /reset by user u-3\\u000aPlugin x: forged answered 202");
  }

  @Test
  void refusedPostsAreLoggedAtMostOnceAMinutePerPluginWithTheNumberLeftOut() {
    registered();

    send("POST", "/routes/r1/start", VIEWER, json(), text("{}"));
    answers.next();
    post(Headers.of("Content-Type", "text/plain"), utf8("{}"));
    post("{\"a\": \"do-not-log\", \"a\": 2}");
    time.advanceSettled(PluginEndpoints.REFUSALS_LOGGED_EVERY.minusMillis(1), runtime);
    post("x");
    time.advanceSettled(Duration.ofMillis(1), runtime);
    post("{\"a\": \"do-not-log\", \"a\": 2}");
    send("GET", "/routes/r1/start", VIEWER, Headers.empty(), InputStream.nullInputStream()); // a GET is not logged

    assertThat(log).containsExactly(
        "Plugin simulator: refused POST /routes/r1/start by user u-2 with 403: this needs the permission plugin.simulator.run",
        "Plugin simulator: refused POST /routes/r1/start by user u-1 with 400: the body is not valid JSON"
            + " (3 more refused since the last such line)");
  }

  @Test
  void aLoggedPathHasItsControlCharactersEscapedAndIsCut() {
    assertThat(PluginEndpoints.logged("/routes/a\nPlugin x: forged")).isEqualTo("/routes/a\\u000aPlugin x: forged");
    assertThat(PluginEndpoints.logged("/a\u2028b\u2029c")).as("the line and paragraph separators")
        .isEqualTo("/a\\u2028b\\u2029c");
    assertThat(PluginEndpoints.logged("/" + "x".repeat(300))).hasSize(201).endsWith("x…");
    assertThat(PluginEndpoints.logged("/" + "x".repeat(199))).isEqualTo("/" + "x".repeat(199));
  }

  private static byte[] utf8(String text) {
    return text.getBytes(StandardCharsets.UTF_8);
  }

  private static byte[] encoded(String text, Charset charset) {
    return text.getBytes(charset);
  }

  private static byte[] concat(byte[] a, byte[] b) {
    byte[] out = java.util.Arrays.copyOf(a, a.length + b.length);
    System.arraycopy(b, 0, out, a.length, b.length);
    return out;
  }
}
