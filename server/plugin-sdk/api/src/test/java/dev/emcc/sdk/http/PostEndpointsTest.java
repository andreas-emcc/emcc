package dev.emcc.sdk.http;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.User;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.worker.HandleId;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** SDK 1.2.0 (CR-0026): POST endpoints, with the 1.1.0 constructors kept (as N5 for CR-0025). */
class PostEndpointsTest {

  private static final ResponseHandle HANDLE = new ResponseHandle() {
    @Override
    public HandleId id() {
      return new HandleId("response-1");
    }

    @Override
    public void respond(HttpReply reply) {}
  };

  @Test
  void aPostEndpointHasTheDefaultsOfAGetAndABodyLimit() {
    Endpoint post = Endpoint.post("/routes/{id}/start").requires("plugin.simulator.run");
    assertThat(post.method()).isEqualTo("POST");
    assertThat(post.timeout()).isEqualTo(Endpoint.DEFAULT_TIMEOUT);
    assertThat(post.maxBody()).isEqualTo(64 * 1024);
    assertThat(post.permission()).isEqualTo("plugin.simulator.run");
    assertThat(post.path().match("/routes/r1/start")).containsEntry("id", "r1");
    assertThat(post.maxBody(4_096).timeout(Duration.ofSeconds(2)).requires("plugin.simulator.edit"))
        .satisfies(e -> {
          assertThat(e.maxBody()).as("kept by timeout and requires").isEqualTo(4_096);
          assertThat(e.timeout()).isEqualTo(Duration.ofSeconds(2));
          assertThat(e.permission()).isEqualTo("plugin.simulator.edit");
        });
    assertThat(Endpoint.post("/x").maxBody(Endpoint.MAX_BODY).maxBody()).isEqualTo(1024 * 1024);
    assertThat(Endpoint.post("/x").maxBody(1).maxBody()).isEqualTo(1);
    assertThatThrownBy(() -> Endpoint.post("/x").maxBody(0)).hasMessageContaining("maxBody");
    assertThatThrownBy(() -> Endpoint.post("/x").maxBody(Endpoint.MAX_BODY + 1)).hasMessageContaining("maxBody");
    assertThat(Endpoint.MAX_BODY_DEPTH).isEqualTo(1000);
  }

  @Test
  void onlyGetAndPostAreEndpointMethods() {
    PathTemplate path = PathTemplate.parse("/x");
    assertThatThrownBy(() -> new Endpoint("PUT", path, Endpoint.DEFAULT_TIMEOUT, null)).hasMessageContaining("GET and POST");
    assertThatThrownBy(() -> new Endpoint("HEAD", path, Endpoint.DEFAULT_TIMEOUT, null)).hasMessageContaining("GET and POST");
    assertThat(new Endpoint("POST", path, Endpoint.DEFAULT_TIMEOUT, "settings.admin").method()).isEqualTo("POST");
  }

  @Test
  void theOneOneZeroEndpointConstructorGivesTheDefaultBodyLimit() {
    var old = new Endpoint("GET", PathTemplate.parse("/streams"), Duration.ofSeconds(5), "settings.admin");
    assertThat(old.maxBody()).isEqualTo(Endpoint.DEFAULT_MAX_BODY);
    assertThat(old).isEqualTo(new Endpoint("GET", PathTemplate.parse("/streams"), Duration.ofSeconds(5), "settings.admin", Endpoint.DEFAULT_MAX_BODY));
    assertThat(Endpoint.get("/streams").maxBody()).isEqualTo(Endpoint.DEFAULT_MAX_BODY);
  }

  @Test
  void theOneOneZeroRequestConstructorGivesAGetWithoutABody() {
    var old = new EndpointRequest("/streams", Map.of(), Map.of(), Headers.empty(), User.noLoginUser(), HANDLE);
    assertThat(old.method()).isEqualTo("GET");
    assertThat(old.body()).isNull();
  }

  @Test
  void aPostRequestHasABodyAndAGetRequestHasNone() {
    var body = JsonObject.of(Map.of("speed", JsonNumber.of("12.50")));
    var post = new EndpointRequest("/routes/r1/start", Map.of("id", "r1"), Map.of(), Headers.empty(), User.noLoginUser(), HANDLE, "POST", body);
    assertThat(post.body()).isEqualTo(body);
    assertThat(((JsonObject) post.body()).getNumber("speed").text()).as("exactly as written").isEqualTo("12.50");
    assertThatThrownBy(() -> new EndpointRequest("/x", Map.of(), Map.of(), Headers.empty(), User.noLoginUser(), HANDLE, "POST", null))
        .isInstanceOf(NullPointerException.class);
    assertThatThrownBy(() -> new EndpointRequest("/x", Map.of(), Map.of(), Headers.empty(), User.noLoginUser(), HANDLE, "GET", body))
        .hasMessageContaining("no body");
    assertThatThrownBy(() -> new EndpointRequest("/x", Map.of(), Map.of(), Headers.empty(), User.noLoginUser(), HANDLE, "PUT", body))
        .hasMessageContaining("GET and POST");
  }

  @Test
  void aJsonReplyIsCompactUtf8WithTheJsonContentType() {
    var body = JsonObject.builder()
        .put("state", JsonString.of("running"))
        .put("lon", JsonNumber.of("18.0700000000000000001"))
        .put("lat", JsonNumber.of(59.33))
        .put("tracks", JsonArray.of(JsonBoolean.TRUE, JsonNull.INSTANCE))
        .build();
    HttpReply reply = HttpReply.json(202, body);
    assertThat(reply.status()).isEqualTo(202);
    assertThat(reply.headers().first("content-type")).isEqualTo("application/json; charset=utf-8");
    assertThat(reply.body().toUtf8()).isEqualTo("{\"state\":\"running\",\"lon\":18.0700000000000000001,\"lat\":59.33,\"tracks\":[true,null]}");
  }

  @Test
  void aJsonReplyEscapesWhatJsonMustAndKeepsEveryCharacter() {
    String text = "q\"b\\n\nt\tc\u0001 åäö 😀 lone \uD800 end";
    HttpReply reply = HttpReply.json(200, JsonArray.of(JsonString.of(text)));
    String json = new String(reply.body().toArray(), StandardCharsets.UTF_8);
    assertThat(json).isEqualTo("[\"q\\\"b\\\\n\\nt\\tc\\u0001 åäö 😀 lone \\ud800 end\"]");
    assertThat(json).as("nothing replaced in the UTF-8 encoding").doesNotContain("?");
  }
}
