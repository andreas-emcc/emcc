package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.User;
import dev.emcc.sdk.http.Caller;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpCall;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.http.HttpResult;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** SDK 1.6.0 part A (CR-0041): the fake's raw bodies, service endpoints, credentials and response limit. */
class FakeSdk16PartATest {

  record Request(EndpointRequest request) implements Message {}

  record Answer(HttpResult result) implements Message {}

  private static final Headers XML = Headers.of("Content-Type", "application/xml; charset=utf-8");
  private static final Bytes DOC = Bytes.utf8("<nvg version=\"2.0.2\"/>");

  private final List<Request> handled = new ArrayList<>();
  private final List<Answer> answers = new ArrayList<>();

  private FakePluginContext context(FakePluginContext.Builder builder, Endpoint... endpoints) {
    var ctx = builder.build();
    WorkerRef<Request> worker = ctx.workers().spawn(WorkerSpec.of("nvg", Request.class, () -> (m, c) -> {
      handled.add(m);
      m.request().response().respond(HttpReply.status(204));
    }));
    for (Endpoint e : endpoints) {
      ctx.endpoints().register(e, worker, Request::new);
    }
    return ctx;
  }

  private static int status(FakePluginContext ctx, FakeHttpExchange exchange) {
    ctx.runUntilIdle();
    return exchange.isAnswered() ? exchange.reply().status() : 0;
  }

  @Test
  void aRawBodyReachesTheWorkerAsBytes() {
    var ctx = context(FakePluginContext.builder("nvg"), Endpoint.post("/import").accepts("application/xml", "text/xml")
        .maxBody(Endpoint.MAX_RAW_BODY).checksUserItself());
    var user = User.of("u1", "Ann", Set.of());
    assertThat(status(ctx, ctx.request("POST", "/import?layer=L1", XML, DOC, user))).isEqualTo(204);
    EndpointRequest r = handled.getFirst().request();
    assertThat(r.rawBody()).isEqualTo(DOC);
    assertThat(r.body()).isNull();
    assertThat(r.user()).isEqualTo(user);
    assertThat(r.caller().kind()).isEqualTo(Caller.Kind.USER);
    assertThat(r.queryParameter("layer")).isEqualTo("L1");
  }

  @Test
  void aRawBodyOfAnotherTypeOrTooLargeIsRefusedBeforeTheWorker() {
    var ctx = context(FakePluginContext.builder("nvg"), Endpoint.post("/import").accepts("application/xml").maxBody(16).checksUserItself());
    var json = Headers.of("Content-Type", "application/json");
    assertThat(status(ctx, ctx.request("POST", "/import", json, Bytes.utf8("{}"), User.noLoginUser()))).isEqualTo(415);
    assertThat(status(ctx, ctx.request("POST", "/import", Headers.of("Content-Type", "application/xml; q=1"), DOC, User.noLoginUser()))).isEqualTo(415);
    assertThat(status(ctx, ctx.request("POST", "/import", Headers.empty(), DOC, User.noLoginUser()))).isEqualTo(415);
    assertThat(status(ctx, ctx.request("POST", "/import", XML, DOC, User.noLoginUser()))).isEqualTo(413);
    assertThat(handled).isEmpty();
  }

  @Test
  void aJsonEndpointStillRefusesXml() {
    var ctx = context(FakePluginContext.builder("nvg"), Endpoint.post("/start").requires("settings.admin"));
    assertThat(status(ctx, ctx.request("POST", "/start", XML, DOC, User.noLoginUser()))).isEqualTo(415);
  }

  @Test
  void aPostWithoutPermissionNeedsChecksUserItselfOrIsAServiceEndpoint() {
    var ctx = FakePluginContext.builder("nvg").build();
    WorkerRef<Request> worker = ctx.workers().spawn(WorkerSpec.of("nvg", Request.class, () -> (m, c) -> {}));
    assertThatThrownBy(() -> ctx.endpoints().register(Endpoint.post("/import").accepts("application/xml"), worker, Request::new))
        .hasMessageContaining("checksUserItself");
    ctx.endpoints().register(Endpoint.service("POST", "/nvg/{link}").accepts("text/xml"), worker, Request::new);
  }

  @Test
  void aServiceEndpointIsReachedOnlyAsAServiceWithNoPermissions() {
    var ctx = context(FakePluginContext.builder("nvg"), Endpoint.service("POST", "/nvg/{link}").accepts("text/xml", "application/soap+xml"));
    var soap = Headers.of("Content-Type", "text/xml; charset=utf-8");
    assertThat(status(ctx, ctx.request("POST", "/nvg/north", soap, DOC, User.noLoginUser()))).isEqualTo(404);
    assertThat(status(ctx, ctx.serviceRequest("POST", "/nvg/north", soap, DOC, "10.0.0.7"))).isEqualTo(204);
    EndpointRequest r = handled.getFirst().request();
    assertThat(r.caller()).isEqualTo(Caller.service("10.0.0.7"));
    assertThat(r.user()).isEqualTo(Caller.SERVICE_USER);
    assertThat(r.user().has("objects.edit")).isFalse();
    assertThat(r.pathParameter("link")).isEqualTo("north");
    assertThat(r.rawBody()).isEqualTo(DOC);
  }

  @Test
  void anOrdinaryEndpointIsNotAServiceEndpoint() {
    var ctx = context(FakePluginContext.builder("nvg"), Endpoint.get("/export"));
    assertThat(status(ctx, ctx.serviceRequest("GET", "/export", Headers.empty(), Bytes.empty(), "10.0.0.7"))).isEqualTo(404);
    assertThat(status(ctx, ctx.call("/export"))).isEqualTo(204);
  }

  private void send(FakePluginContext ctx, HttpCall call) {
    WorkerRef<Answer> w = ctx.workers().spawn(WorkerSpec.of("poll-" + answers.size() + "-" + ctx.httpCalls().size(), Answer.class, () -> (m, c) -> answers.add(m)));
    ctx.http().send(call, Duration.ofSeconds(30), w, Answer::new);
    ctx.runUntilIdle();
  }

  @Test
  void aPostIsSentWithItsBodyAndAConfiguredCredential() {
    var ctx = FakePluginContext.builder("nvg").httpCredentials("anet").build();
    URI url = URI.create("http://localhost:8380/cxf/nvg/20");
    ctx.upstream().respond(url.toString(), 200, Headers.of("Content-Type", "text/xml"), DOC);
    HttpCall call = HttpCall.post(url, "text/xml; charset=utf-8", Bytes.utf8("<GetNvg/>")).header("SOAPAction", "\"GetNvg\"").credential("anet");
    send(ctx, call);
    assertThat(answers.getFirst().result()).isEqualTo(new HttpResult.Response(200, Headers.of("Content-Type", "text/xml"), DOC));
    assertThat(ctx.httpCalls()).containsExactly(call);
  }

  @Test
  void anUnconfiguredCredentialFailsAtOnce() {
    var ctx = FakePluginContext.builder("nvg").build();
    URI url = URI.create("http://localhost:8380/cxf/nvg/20");
    ctx.upstream().respond(url.toString(), 200, Headers.empty(), DOC);
    send(ctx, HttpCall.post(url, "text/xml", DOC).credential("anet"));
    assertThat(answers.getFirst().result()).isEqualTo(new HttpResult.Failed("no credential anet"));
  }

  @Test
  void theResponseLimitIsTheCallsOwn() {
    var ctx = FakePluginContext.builder("nvg").build();
    URI url = URI.create("https://nvg.example.org/big");
    ctx.upstream().respond(url.toString(), 200, Headers.empty(), Bytes.of(new byte[11 * 1024 * 1024]));
    send(ctx, HttpCall.get(url));
    assertThat(answers.getFirst().result()).isInstanceOf(HttpResult.Failed.class);
    send(ctx, HttpCall.get(url).maxResponseBytes(HttpCall.MAX_RESPONSE_BYTES));
    assertThat(answers.get(1).result()).isInstanceOf(HttpResult.Response.class);
    send(ctx, HttpCall.get(url).maxResponseBytes(1024));
    assertThat(answers.get(2).result()).isEqualTo(new HttpResult.Failed("response body larger than 1024 bytes"));
  }

  @Test
  void jsonPostsStillWorkAsBefore() {
    var ctx = context(FakePluginContext.builder("simulator"), Endpoint.post("/start").requires("settings.admin"));
    assertThat(status(ctx, ctx.post("/start", JsonObject.empty()))).isEqualTo(204);
    assertThat(handled.getFirst().request().body()).isEqualTo(JsonObject.empty());
    assertThat(handled.getFirst().request().rawBody()).isNull();
  }
}
