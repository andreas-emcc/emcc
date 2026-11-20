package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.runtime.ManualTime;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.User;
import dev.emcc.sdk.http.Caller;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * SDK 1.6.0 part A (CR-0041; ADR-0055 point 5): raw bodies, service endpoints and their callers,
 * {@code checksUserItself}, and the service calls' log lines.
 */
class PluginServiceEndpointsTest {

  record Call(EndpointRequest request) implements Message {}

  private static final String ID = "nvg";
  private static final User EDITOR = User.of("u-1", "Editor", Set.of("objects.edit"));

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(new ManualTime()));
  private final List<String> log = new CopyOnWriteArrayList<>();
  private final PluginEndpoints endpoints = new PluginEndpoints(runtime, new ModelJson(), log::add);
  private final PluginWorkers workers =
      new PluginWorkers(ID, runtime.owner(ID), new URLClassLoader(new java.net.URL[0], getClass().getClassLoader()));
  private final Probe<String> seen = new Probe<>();
  private final Probe<HttpReply> answers = new Probe<>();

  @AfterEach
  void close() {
    runtime.close();
  }

  /** Notes who called and what came; answers 202 with the raw body as it came, or "json". */
  private WorkerRef<Call> worker() {
    return workers.spawn(WorkerSpec.of("nvg", Call.class, () -> (message, ctx) -> {
      EndpointRequest r = message.request();
      seen.add(r.method() + " " + r.path() + " " + r.caller().kind() + " at " + r.caller().address() + " as " + r.user().id()
          + (r.pathParameters().isEmpty() ? "" : " " + r.pathParameters()));
      Bytes raw = r.rawBody();
      r.response().respond(HttpReply.of(202, Headers.empty(), raw == null ? Bytes.utf8(r.body() == null ? "none" : "json") : raw));
    }).mailbox(10, Overflow.dropNewest()));
  }

  /** An import that checks the user itself, a SOAP service per link, a service GET and a browser GET. */
  private void registered() {
    WorkerRef<Call> nvg = worker();
    endpoints.of(ID).register(Endpoint.post("/import").accepts("application/xml", "text/xml").maxBody(Endpoint.MAX_RAW_BODY)
        .checksUserItself(), nvg, Call::new);
    endpoints.of(ID).register(Endpoint.service("POST", "/nvg/{link}").accepts("text/xml", "application/soap+xml").maxBody(64),
        nvg, Call::new);
    endpoints.of(ID).register(Endpoint.service("GET", "/nvg/{link}"), nvg, Call::new);
    endpoints.of(ID).register(Endpoint.get("/status"), nvg, Call::new);
  }

  private HttpReply browser(String method, String path, Headers headers, byte[] body) {
    endpoints.dispatch(new PluginEndpoints.Request(ID, method, path, Map.of(), headers, EDITOR, Caller.user("10.0.0.9")),
        new ByteArrayInputStream(body), answers::add);
    return answers.next();
  }

  private HttpReply service(String method, String path, Headers headers, byte[] body) {
    endpoints.dispatch(PluginEndpoints.Request.service(ID, method, path, Map.of(), headers, "10.1.2.3"), new ByteArrayInputStream(body),
        answers::add);
    return answers.next();
  }

  private static byte[] utf8(String text) {
    return text.getBytes(StandardCharsets.UTF_8);
  }

  @Test
  void aRawBodyReachesTheWorkerAsItsBytesUnchangedWithTheBrowsersCaller() {
    registered();
    byte[] latin1 = "<nvg>Malmö</nvg>".getBytes(StandardCharsets.ISO_8859_1); // not UTF-8: not decoded, so not refused

    HttpReply reply = browser("POST", "/import", Headers.of("Content-Type", "Text/XML; charset=ISO-8859-1"), latin1);

    assertThat(reply.status()).isEqualTo(202);
    assertThat(reply.body().toArray()).isEqualTo(latin1);
    assertThat(seen.next()).isEqualTo("POST /import USER at 10.0.0.9 as u-1");
    assertThat(log).containsExactly("Plugin nvg: POST /import by user u-1 answered 202");
  }

  @Test
  void anotherMediaTypeOrAParameterOtherThanCharsetIs415AndATooLongBody413BeforeTheWorker() {
    registered();

    assertThat(browser("POST", "/import", Headers.of("Content-Type", "application/json"), utf8("{}")).status()).isEqualTo(415);
    assertThat(browser("POST", "/import", Headers.of("Content-Type", "text/xml; boundary=x"), utf8("<a/>")).status()).isEqualTo(415);
    assertThat(browser("POST", "/import", Headers.empty(), utf8("<a/>")).body().toUtf8())
        .isEqualTo("the body must be application/xml or text/xml");
    assertThat(service("POST", "/nvg/a", Headers.of("Content-Type", "text/xml").with("Content-Length", "65"), new byte[65]).status())
        .isEqualTo(413); // by the declared length
    assertThat(service("POST", "/nvg/a", Headers.of("Content-Type", "text/xml"), new byte[65]).status()).isEqualTo(413); // once read
    assertThat(service("POST", "/nvg/a", Headers.of("Content-Type", "text/xml"), new byte[64]).status()).isEqualTo(202);
    assertThat(seen.next()).startsWith("POST /nvg/a SERVICE");
  }

  @Test
  void aServiceCallReachesOnlyServiceEndpointsAsTheServiceUserAndABrowserOnlyTheOthers() {
    registered();

    HttpReply soap = service("POST", "/nvg/north", Headers.of("Content-Type", "application/soap+xml; charset=utf-8"), utf8("<Envelope/>"));
    assertThat(soap.status()).isEqualTo(202);
    assertThat(seen.next()).isEqualTo("POST /nvg/north SERVICE at 10.1.2.3 as service {link=north}");
    assertThat(service("GET", "/nvg/north", Headers.empty(), new byte[0]).status()).isEqualTo(202);
    assertThat(seen.next()).isEqualTo("GET /nvg/north SERVICE at 10.1.2.3 as service {link=north}");

    assertThat(service("GET", "/status", Headers.empty(), new byte[0]).status()).isEqualTo(404); // a browser endpoint
    assertThat(browser("GET", "/nvg/north", Headers.empty(), new byte[0]).status()).isEqualTo(404); // a service endpoint
    assertThat(browser("GET", "/status", Headers.empty(), new byte[0]).status()).isEqualTo(202);
    assertThat(seen.next()).isEqualTo("GET /status USER at 10.0.0.9 as u-1");
    assertThat(service("DELETE", "/nvg/north", Headers.empty(), new byte[0]).headers().first("Allow")).isEqualTo("GET, POST");
  }

  @Test
  void everyServiceCallIsLoggedOnceAnsweredWithTheCallersAddressAndItsRefusalsAtMostOnceAMinute() {
    registered();

    service("POST", "/nvg/north", Headers.of("Content-Type", "text/xml"), utf8("<do-not-log/>"));
    service("GET", "/nvg/north", Headers.empty(), new byte[0]);
    browser("GET", "/status", Headers.empty(), new byte[0]); // a browser's GET is not logged
    service("POST", "/nvg/north", Headers.of("Content-Type", "text/plain"), utf8("x"));
    service("GET", "/nothing", Headers.empty(), new byte[0]); // refused within the minute: counted, not logged

    assertThat(log).containsExactly(
        "Plugin nvg: service POST /nvg/north by a service caller at 10.1.2.3 answered 202",
        "Plugin nvg: service GET /nvg/north by a service caller at 10.1.2.3 answered 202",
        "Plugin nvg: refused service POST /nvg/north by a service caller at 10.1.2.3 with 415: the body must be text/xml or application/soap+xml");
    assertThat(String.join("\n", log)).doesNotContain("do-not-log");
  }

  @Test
  void aPostNamesAPermissionUnlessItIsAServiceEndpointOrItsHandlerChecksTheUserItself() {
    WorkerRef<Call> nvg = worker();
    assertThatThrownBy(() -> endpoints.of(ID).register(Endpoint.post("/import"), nvg, Call::new))
        .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("names no permission");

    endpoints.of(ID).register(Endpoint.post("/import").checksUserItself(), nvg, Call::new);
    endpoints.of(ID).register(Endpoint.service("POST", "/import"), nvg, Call::new); // the same path, the other kind
    assertThat(browser("POST", "/import", Headers.of("Content-Type", "application/json"), utf8("{}")).body().toUtf8()).isEqualTo("json");
    assertThat(seen.next()).isEqualTo("POST /import USER at 10.0.0.9 as u-1");
    assertThat(service("POST", "/import", Headers.of("Content-Type", "application/json"), utf8("{}")).status()).isEqualTo(202);
    assertThat(seen.next()).isEqualTo("POST /import SERVICE at 10.1.2.3 as service");
  }

  @Test
  void aServiceCallToAnUnknownPluginIsLoggedUnderOneKeyForAllUnknownIdsWithTheIdEscaped() {
    endpoints.dispatch(PluginEndpoints.Request.service("no\nbody", "GET", "/x", Map.of(), Headers.empty(), "10.1.2.3"),
        InputStream.nullInputStream(), answers::add);
    endpoints.dispatch(PluginEndpoints.Request.service("other", "GET", "/x", Map.of(), Headers.empty(), "10.1.2.3"),
        InputStream.nullInputStream(), answers::add);

    assertThat(answers.next(2)).extracting(HttpReply::status).containsExactly(404, 404);
    assertThat(log).containsExactly( // the second within the minute: counted under the same key, not logged
        "Plugin no\\u000abody: refused service GET /x by a service caller at 10.1.2.3 with 404: no such plugin");
  }

  @Test
  void aServiceRequestCarriesTheServiceUserOnly() {
    assertThatThrownBy(() -> new PluginEndpoints.Request(ID, "GET", "/x", Map.of(), Headers.empty(), EDITOR, Caller.service("10.1.2.3")))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
