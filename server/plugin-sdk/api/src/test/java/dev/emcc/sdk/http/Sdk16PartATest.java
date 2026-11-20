package dev.emcc.sdk.http;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.User;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.worker.HandleId;
import java.net.URI;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** SDK 1.6.0 part A (CR-0041; ADR-0055 point 5): outbound POST, credentials, raw bodies, service endpoints. */
class Sdk16PartATest {

  private static final URI URL = URI.create("https://nvg.example.org/cxf/nvg/20");
  private static final Bytes ENVELOPE = Bytes.utf8("<soap:Envelope/>");

  private static final ResponseHandle HANDLE = new ResponseHandle() {
    @Override
    public HandleId id() {
      return new HandleId("response-1");
    }

    @Override
    public void respond(HttpReply reply) {}
  };

  @Test
  void aPostCarriesItsMediaTypeBodyHeadersAndCredential() {
    HttpCall call = HttpCall.post(URL, "text/xml; charset=utf-8", ENVELOPE).header("SOAPAction", "\"GetNvg\"").credential("anet")
        .maxResponseBytes(HttpCall.MAX_RESPONSE_BYTES);
    assertThat(call.method()).isEqualTo("POST");
    assertThat(call.mediaType()).isEqualTo("text/xml; charset=utf-8");
    assertThat(call.body()).isEqualTo(ENVELOPE);
    assertThat(call.headers().first("SOAPAction")).isEqualTo("\"GetNvg\"");
    assertThat(call.credential()).isEqualTo("anet");
    assertThat(call.maxResponseBytes()).isEqualTo(16 * 1024 * 1024);
  }

  @Test
  void aGetKeepsItsSdkV1FormAndDefaults() {
    HttpCall call = HttpCall.get(URL);
    assertThat(call).isEqualTo(new HttpCall("GET", URL, Headers.empty()));
    assertThat(call.body().size()).isZero();
    assertThat(call.mediaType()).isNull();
    assertThat(call.credential()).isNull();
    assertThat(call.maxResponseBytes()).isEqualTo(OutboundHttp.MAX_BODY_BYTES);
  }

  @Test
  void callsOutsideTheLimitsAreRefused() {
    assertThatThrownBy(() -> new HttpCall("PUT", URL, Headers.empty())).hasMessageContaining("GET and POST");
    assertThatThrownBy(() -> HttpCall.post(URL, "not a type", ENVELOPE)).hasMessageContaining("media type");
    assertThatThrownBy(() -> HttpCall.post(URL, "text/xml", Bytes.of(new byte[HttpCall.MAX_REQUEST_BODY_BYTES + 1]))).hasMessageContaining("at most");
    assertThatThrownBy(() -> new HttpCall("GET", URL, Headers.empty(), ENVELOPE, null, null, 1)).hasMessageContaining("no body");
    assertThatThrownBy(() -> HttpCall.get(URL).maxResponseBytes(HttpCall.MAX_RESPONSE_BYTES + 1)).hasMessageContaining("maxResponseBytes");
    assertThatThrownBy(() -> HttpCall.get(URL).maxResponseBytes(0)).hasMessageContaining("maxResponseBytes");
    assertThatThrownBy(() -> HttpCall.get(URL).credential("../token")).hasMessageContaining("credential");
    assertThatThrownBy(() -> HttpCall.post(URI.create("ftp://x/"), "text/xml", ENVELOPE)).hasMessageContaining("http or https");
  }

  @Test
  void ecoreSetsTheAuthorizationAndBodyHeadersItself() {
    for (String name : List.of("Authorization", "authorization", "Content-Type", "Content-Length", "Host", "Transfer-Encoding")) {
      assertThatThrownBy(() -> HttpCall.get(URL).header(name, "x")).hasMessageContaining("ECore sets");
    }
    assertThatThrownBy(() -> HttpCall.get(URL).header("Authorization", "Bearer x")).hasMessageContaining("credential(name)");
  }

  @Test
  void aRawBodyEndpointTakesItsMediaTypesUpToSixteenMebibytes() {
    Endpoint e = Endpoint.post("/import").accepts("Application/XML", "text/xml").maxBody(Endpoint.MAX_RAW_BODY).checksUserItself();
    assertThat(e.accepts()).containsExactly("application/xml", "text/xml");
    assertThat(e.takesRawBody()).isTrue();
    assertThat(e.maxBody()).isEqualTo(16 * 1024 * 1024);
    assertThat(e.userCheckedByHandler()).isTrue();
    assertThat(e.permission()).isNull();
    assertThat(Endpoint.post("/start").takesRawBody()).isFalse();
  }

  @Test
  void rawBodyRulesAreChecked() {
    assertThatThrownBy(() -> Endpoint.post("/a").maxBody(Endpoint.MAX_RAW_BODY)).hasMessageContaining("maxBody");
    assertThatThrownBy(() -> Endpoint.get("/a").accepts("text/xml")).hasMessageContaining("only a POST");
    assertThatThrownBy(() -> Endpoint.post("/a").accepts("application/json")).hasMessageContaining("not application/json");
    assertThatThrownBy(() -> Endpoint.post("/a").accepts("text/xml; charset=utf-8")).hasMessageContaining("without parameters");
    assertThatThrownBy(() -> Endpoint.post("/a").accepts("text/xml", "text/xml")).hasMessageContaining("different");
  }

  @Test
  void aServiceEndpointHasNoPermissionAndNoUserCheck() {
    Endpoint e = Endpoint.service("POST", "/nvg/{link}").accepts("text/xml", "application/soap+xml");
    assertThat(e.service()).isTrue();
    assertThat(e.permission()).isNull();
    assertThat(e.path().match("/nvg/north")).containsEntry("link", "north");
    assertThatThrownBy(() -> e.requires("plugin.nvg.serve")).hasMessageContaining("no permission");
    assertThatThrownBy(() -> e.checksUserItself()).hasMessageContaining("checksUserItself");
    assertThatThrownBy(() -> Endpoint.get("/a").checksUserItself()).hasMessageContaining("checksUserItself");
    assertThatThrownBy(() -> Endpoint.post("/a").requires("settings.admin").checksUserItself()).hasMessageContaining("checksUserItself");
  }

  @Test
  void theOlderEndpointConstructorsKeepTheirMeaning() {
    var path = PathTemplate.parse("/streams");
    var old = new Endpoint("POST", path, Endpoint.DEFAULT_TIMEOUT, "settings.admin", 4096);
    assertThat(old.accepts()).isEmpty();
    assertThat(old.service()).isFalse();
    assertThat(old.userCheckedByHandler()).isFalse();
    assertThat(new Endpoint("GET", path, Endpoint.DEFAULT_TIMEOUT, null).maxBody()).isEqualTo(Endpoint.DEFAULT_MAX_BODY);
  }

  @Test
  void aRequestHasEitherAJsonOrARawBodyAndACaller() {
    var raw = new EndpointRequest("/import", Map.of(), Map.of(), Headers.empty(), User.noLoginUser(), HANDLE, "POST", null,
        dev.emcc.sdk.UserTime.now(), ENVELOPE, Caller.user("127.0.0.1"));
    assertThat(raw.rawBody()).isEqualTo(ENVELOPE);
    assertThat(raw.body()).isNull();
    assertThat(raw.caller().kind()).isEqualTo(Caller.Kind.USER);
    var json = new EndpointRequest("/start", Map.of(), Map.of(), Headers.empty(), User.noLoginUser(), HANDLE, "POST", JsonObject.empty());
    assertThat(json.rawBody()).isNull();
    assertThat(json.caller().kind()).isEqualTo(Caller.Kind.USER);
    assertThatThrownBy(() -> new EndpointRequest("/a", Map.of(), Map.of(), Headers.empty(), User.noLoginUser(), HANDLE, "POST", JsonObject.empty(),
        dev.emcc.sdk.UserTime.now(), ENVELOPE, Caller.user("x"))).hasMessageContaining("either");
    assertThatThrownBy(() -> new EndpointRequest("/a", Map.of(), Map.of(), Headers.empty(), User.noLoginUser(), HANDLE, "GET", null,
        dev.emcc.sdk.UserTime.now(), ENVELOPE, Caller.user("x"))).hasMessageContaining("no body");
  }

  @Test
  void aServiceCallsUserHasNoPermissions() {
    var call = new EndpointRequest("/nvg/north", Map.of("link", "north"), Map.of(), Headers.empty(), Caller.SERVICE_USER, HANDLE, "POST", null,
        dev.emcc.sdk.UserTime.now(), ENVELOPE, Caller.service("10.0.0.7"));
    assertThat(call.caller()).isEqualTo(new Caller(Caller.Kind.SERVICE, "10.0.0.7"));
    assertThat(call.user().has("objects.edit")).isFalse();
    assertThat(call.user().noLogin()).isFalse();
    assertThatThrownBy(() -> new EndpointRequest("/nvg/north", Map.of(), Map.of(), Headers.empty(), User.noLoginUser(), HANDLE, "POST", null,
        dev.emcc.sdk.UserTime.now(), ENVELOPE, Caller.service("10.0.0.7"))).hasMessageContaining("SERVICE_USER");
  }
}
