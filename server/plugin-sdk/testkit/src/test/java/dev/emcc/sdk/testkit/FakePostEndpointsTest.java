package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.User;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** SDK 1.2.0 (CR-0026): the fake answers POST endpoints as ECore does, in ECore's order. */
class FakePostEndpointsTest {

  record Command(EndpointRequest request) implements Message {}

  private static final String RUN = "plugin.simulator.run";
  private static final Headers JSON = Headers.of("Content-Type", "application/json");

  private final List<Command> handled = new ArrayList<>();

  private FakePluginContext context(Endpoint... endpoints) {
    var ctx = FakePluginContext.builder("simulator").build();
    WorkerRef<Command> engine = ctx.workers().spawn(WorkerSpec.of("engine", Command.class, () -> (m, c) -> handled.add(m)));
    for (Endpoint e : endpoints) {
      ctx.endpoints().register(e, engine, Command::new);
    }
    return ctx;
  }

  private static Bytes utf8(String text) {
    return Bytes.utf8(text);
  }

  private int status(FakePluginContext ctx, String method, String target, Headers headers, Bytes body) {
    FakeHttpExchange exchange = ctx.request(method, target, headers, body, User.noLoginUser());
    ctx.runUntilIdle();
    return exchange.isAnswered() ? exchange.reply().status() : 0;
  }

  @Test
  void aPostReachesTheWorkerWithItsParsedBodyAndIsAnsweredAsJson() {
    var ctx = context(Endpoint.post("/routes/{id}/start").requires(RUN));
    var body = JsonObject.of(Map.of("at", JsonNumber.of("1.50")));
    FakeHttpExchange exchange = ctx.post("/routes/r1/start", body);
    ctx.runUntilIdle();
    assertThat(handled).singleElement().satisfies(c -> {
      assertThat(c.request().method()).isEqualTo("POST");
      assertThat(c.request().pathParameter("id")).isEqualTo("r1");
      assertThat(((JsonObject) c.request().body()).getNumber("at").text()).as("exactly as written").isEqualTo("1.50");
    });
    handled.getFirst().request().response().respond(HttpReply.json(202, JsonObject.of(Map.of("state", JsonString.of("running")))));
    assertThat(exchange.reply().status()).isEqualTo(202);
    assertThat(exchange.reply().body().toUtf8()).isEqualTo("{\"state\":\"running\"}");
  }

  @Test
  void aPostEndpointWithoutAPermissionIsRefusedAtRegister() {
    var ctx = FakePluginContext.builder("simulator").build();
    WorkerRef<Command> engine = ctx.workers().spawn(WorkerSpec.of("engine", Command.class, () -> (m, c) -> handled.add(m)));
    assertThatThrownBy(() -> ctx.endpoints().register(Endpoint.post("/start"), engine, Command::new)).hasMessageContaining("needs a permission");
    ctx.endpoints().register(Endpoint.get("/state"), engine, Command::new);   // a GET still may be open to every user
  }

  @Test
  void aGetAndAPostMayShareAPathAndEachReachesTheWorkerWithItsMethod() {
    var ctx = context(Endpoint.get("/outputs"), Endpoint.post("/outputs").requires(RUN));
    ctx.call("/outputs");
    ctx.post("/outputs", JsonObject.empty());
    ctx.runUntilIdle();
    assertThat(handled).extracting(c -> c.request().method()).containsExactly("GET", "POST");
    assertThat(handled.getFirst().request().body()).isNull();
  }

  @Test
  void aMethodThePathLacksGets405WithTheMethodsItHas() {
    var ctx = context(Endpoint.get("/state"), Endpoint.post("/start").requires(RUN), Endpoint.get("/both"), Endpoint.post("/both").requires(RUN));
    FakeHttpExchange post = ctx.request("POST", "/state", JSON, utf8("{}"), User.noLoginUser());
    assertThat(post.reply().status()).isEqualTo(405);
    assertThat(post.reply().headers().first("Allow")).isEqualTo("GET");
    FakeHttpExchange get = ctx.call("/start");
    assertThat(get.reply().status()).isEqualTo(405);
    assertThat(get.reply().headers().first("Allow")).isEqualTo("POST");
    FakeHttpExchange head = ctx.request("HEAD", "/start", Headers.empty(), Bytes.empty(), User.noLoginUser());
    assertThat(head.reply().status()).as("R4: HEAD is a GET without a body").isEqualTo(405);
    assertThat(head.reply().headers().first("Allow")).isEqualTo("POST");
    FakeHttpExchange put = ctx.request("PUT", "/both", JSON, utf8("{}"), User.noLoginUser());
    assertThat(put.reply().headers().first("Allow")).isEqualTo("GET, POST");
    assertThat(ctx.call("/nowhere").reply().status()).isEqualTo(404);
    ctx.runUntilIdle();
    assertThat(handled).isEmpty();
  }

  @Test
  void aHeadIsDeliveredAsAGet() {
    var ctx = context(Endpoint.get("/state"));
    ctx.request("HEAD", "/state", Headers.empty(), Bytes.empty(), User.noLoginUser());
    ctx.runUntilIdle();
    assertThat(handled).singleElement().satisfies(c -> assertThat(c.request().method()).isEqualTo("GET"));
  }

  @Test
  void aUserWithoutThePermissionGets403BeforeTheBodyIsLookedAt() {
    var ctx = context(Endpoint.post("/start").requires(RUN));
    var viewer = User.of("viewer", "Viewer", Set.of("plugin.simulator.view"));
    assertThat(ctx.request("POST", "/start", Headers.empty(), utf8("not json"), viewer).reply().status()).isEqualTo(403);
    assertThat(ctx.post("/start", JsonObject.empty(), viewer).reply().status()).isEqualTo(403);
    FakeHttpExchange runner = ctx.post("/start", JsonObject.empty(), User.of("runner", "Runner", Set.of(RUN)));
    ctx.runUntilIdle();
    assertThat(runner.isAnswered()).isFalse();
    assertThat(handled).singleElement().satisfies(c -> assertThat(c.request().user().id()).isEqualTo("runner"));
  }

  @Test
  void onlyTheJsonContentTypeIsAccepted() {
    var ctx = context(Endpoint.post("/start").requires(RUN));
    assertThat(status(ctx, "POST", "/start", Headers.empty(), utf8("{}"))).isEqualTo(415);
    assertThat(status(ctx, "POST", "/start", Headers.of("Content-Type", "text/plain"), utf8("{}"))).isEqualTo(415);
    assertThat(status(ctx, "POST", "/start", Headers.of("Content-Type", "application/x-www-form-urlencoded"), utf8("a=1"))).isEqualTo(415);
    assertThat(status(ctx, "POST", "/start", Headers.of("Content-Type", "application/json; charset=utf-16"), utf8("{}"))).isEqualTo(415);
    assertThat(status(ctx, "POST", "/start", Headers.of("Content-Type", "application/json; boundary=x"), utf8("{}"))).isEqualTo(415);
    assertThat(status(ctx, "POST", "/start", Headers.of("Content-Type", "application/json;"), utf8("{}"))).as("an empty parameter").isEqualTo(415);
    assertThat(status(ctx, "POST", "/start", Headers.of("Content-Type", "application/json; charset=utf-8; charset=utf-8"), utf8("{}"))).as("a repeated charset").isEqualTo(415);
    assertThat(handled).isEmpty();
    assertThat(status(ctx, "POST", "/start", JSON, utf8("{}"))).as("not answered yet: delivered").isZero();
    assertThat(status(ctx, "POST", "/start", Headers.of("content-type", "Application/JSON; Charset=\"UTF-8\""), utf8("{}"))).isZero();
    assertThat(handled).hasSize(2);
  }

  @Test
  void aBodyLargerThanTheLimitGets413() {
    var ctx = context(Endpoint.post("/start").requires(RUN).maxBody(10));
    assertThat(status(ctx, "POST", "/start", JSON, utf8("{\"a\":\"12\"}"))).as("10 bytes").isZero();
    assertThat(status(ctx, "POST", "/start", JSON, utf8("{\"a\":\"123\"}"))).as("11 bytes").isEqualTo(413);
    assertThat(ctx.post("/start", JsonObject.of(Map.of("a", JsonString.of("123")))).reply().status()).isEqualTo(413);
    assertThat(status(ctx, "POST", "/start", JSON, utf8("{\"a\":12345,]"))).as("decided by length, before parsing").isEqualTo(413);
    assertThat(handled).hasSize(1);
  }

  @Test
  void aBodyThatIsNotStrictJsonGets400NeverAnError() {
    var ctx = context(Endpoint.post("/start").requires(RUN));
    for (String bad : List.of(
        "", " ", "not json", "{\"a\":1,\"a\":2}", "{} {}", "{\"a\":1,}", "[1]x", "{'a':1}", "{\"a\":NaN}",
        // escapes cut short or not hex (no sign, no non-ASCII digits), as Jackson refuses them
        "\"\\", "\"\\u12", "\"\\u+123\"", "\"\\uZZZZ\"", "\"\\u00\"}", "\"\\u\uFF11234\"")) {
      assertThat(status(ctx, "POST", "/start", JSON, utf8(bad))).as("body <%s>", bad).isEqualTo(400);
    }
    assertThat(handled).isEmpty();
  }

  @Test
  void aBodyNestedPastTheLimitGets400() {
    var ctx = context(Endpoint.post("/start").requires(RUN).maxBody(Endpoint.MAX_BODY));
    int max = Endpoint.MAX_BODY_DEPTH;
    assertThat(status(ctx, "POST", "/start", JSON, utf8("[".repeat(max) + "]".repeat(max)))).as("at the limit").isZero();
    assertThat(status(ctx, "POST", "/start", JSON, utf8("[".repeat(max + 1) + "]".repeat(max + 1)))).isEqualTo(400);
    assertThat(status(ctx, "POST", "/start", JSON, utf8("{\"a\":".repeat(max + 1) + "1" + "}".repeat(max + 1)))).isEqualTo(400);
    assertThat(handled).hasSize(1);
  }

  @Test
  void aBodyInAnotherEncodingOrWithAByteOrderMarkGets400() {
    var ctx = context(Endpoint.post("/start").requires(RUN));
    String json = "{\"name\":\"Route 1\"}";
    byte[] bom = {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};
    byte[] utf8 = json.getBytes(StandardCharsets.UTF_8);
    byte[] withBom = new byte[bom.length + utf8.length];
    System.arraycopy(bom, 0, withBom, 0, bom.length);
    System.arraycopy(utf8, 0, withBom, bom.length, utf8.length);
    assertThat(status(ctx, "POST", "/start", JSON, Bytes.of(withBom))).as("UTF-8 with a byte order mark").isEqualTo(400);
    assertThat(status(ctx, "POST", "/start", JSON, Bytes.of(json.getBytes(StandardCharsets.UTF_16LE)))).as("UTF-16LE").isEqualTo(400);
    assertThat(status(ctx, "POST", "/start", JSON, Bytes.of(json.getBytes(StandardCharsets.UTF_16)))).as("UTF-16 with a BOM").isEqualTo(400);
    assertThat(status(ctx, "POST", "/start", JSON, Bytes.of(json.getBytes(Charset.forName("UTF-32BE"))))).as("UTF-32BE").isEqualTo(400);
    assertThat(status(ctx, "POST", "/start", JSON, Bytes.of(new byte[] {'"', (byte) 0xC3, '"'}))).as("malformed UTF-8").isEqualTo(400);
    assertThat(status(ctx, "POST", "/start", JSON, Bytes.of(new byte[] {'"', (byte) 0xED, (byte) 0xA0, (byte) 0x80, '"'}))).as("an encoded surrogate").isEqualTo(400);
    assertThat(handled).isEmpty();
    assertThat(status(ctx, "POST", "/start", JSON, Bytes.of("{\"name\":\"Rutt å\"}".getBytes(StandardCharsets.UTF_8)))).isZero();
    assertThat(handled).singleElement().satisfies(c -> assertThat(((JsonObject) c.request().body()).getString("name")).isEqualTo("Rutt å"));
  }

  @Test
  void aPostedStringKeepsEveryCharacterAsABrowserWouldSendIt() {
    var ctx = context(Endpoint.post("/start").requires(RUN));
    String text = "lone \uD800, pair 😀, \"q\" \\ å";
    ctx.post("/start", JsonObject.of(Map.of("name", JsonString.of(text))));
    ctx.runUntilIdle();
    assertThat(handled).singleElement().satisfies(c -> assertThat(((JsonObject) c.request().body()).getString("name")).isEqualTo(text));
  }

  @Test
  void aCommandUnansweredInTimeGets504AsForAGet() {
    var ctx = context(Endpoint.post("/start").requires(RUN));
    FakeHttpExchange exchange = ctx.post("/start", JsonObject.empty());
    ctx.runUntilIdle();
    ctx.advance(Endpoint.DEFAULT_TIMEOUT.plusSeconds(1));
    assertThat(exchange.reply().status()).isEqualTo(504);
  }
}
