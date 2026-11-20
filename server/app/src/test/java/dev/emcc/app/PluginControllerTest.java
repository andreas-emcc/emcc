package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.app.testplugin.EchoPlugin;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import java.util.stream.Stream;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.core.env.Environment;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** Plugins over HTTP: the list, the web parts' files and the plugins' endpoints, with a real plugin jar. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles(LoginConfiguration.DEV_PROFILE)
@DirtiesContext // closes this class's server before its temporary folder is deleted
@ExtendWith(OutputCaptureExtension.class)
class PluginControllerTest {

  /** Deleted by JUnit after the class, once {@code @DirtiesContext} has closed the server that uses it. */
  @TempDir static Path folder;

  private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

  @Autowired private Environment environment;
  @Autowired private org.springframework.context.ApplicationContext context;

  @DynamicPropertySource
  static void folders(DynamicPropertyRegistry registry) {
    registry.add("emc2.plugins.directory", () -> folder.resolve("plugins").toString());
    registry.add("emc2.data.directory", () -> folder.resolve("data").toString());
    // ADR-0062 (M9 C3): a credential of each kind of keys; files that cannot be read do not stop the start
    registry.add("emc2.tls.zeta.trust-store", () -> unreadable("zeta.pem"));
    registry.add("emc2.listeners.credentials.alpha.trust-store", () -> unreadable("alpha.p12"));
    registry.add("emc2.listeners.credentials.alpha.trust-store-password", () -> "not-a-secret");
  }

  private static String unreadable(String name) {
    try {
      return java.nio.file.Files.writeString(folder.resolve(name), "not a store").toString();
    } catch (java.io.IOException e) {
      throw new java.io.UncheckedIOException(e);
    }
  }

  @Test
  void theTlsCredentialsNamesAreServedSorted() throws Exception { // ADR-0062 point 3, CR-0048 point 1.3
    HttpResponse<String> names = get("/api/settings/tls-credentials");
    assertThat(names.statusCode()).isEqualTo(200);
    assertThat(names.body()).isEqualTo("{\"names\":[\"alpha\",\"zeta\"]}");
  }

  @Test
  void saysTheReadyLineOverHttp(CapturedOutput output) { // M9 B3: the start scripts print it
    assertThat(output.getAll()).contains("emcc ready at http://localhost:" + environment.getProperty("local.server.port") + "/")
        .doesNotContain("redirects to it");
  }

  @Test
  void listsThePluginsWithTheirStatus() throws Exception {
    HttpResponse<String> response = get("/api/plugins");

    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(response.body())
        .contains("{\"id\":\"echo\",\"name\":\"Echo\",\"version\":\"0.1.0\",\"kind\":\"general\",\"active\":true,"
            + "\"status\":{\"state\":\"OK\",\"detail\":\"\"},\"web\":null,\"sdkVersion\":\"^1.2.0\",\"dependsOn\":[],"
            + "\"provides\":[],\"requires\":[],\"uses\":[],\"required\":false,\"settings\":{},\"hasSettings\":false,"
            + "\"capabilities\":[],\"serverPart\":true,\"category\":null,\"symbolPalettes\":null,\"icon\":null,\"computeThreads\":0}")
        .contains("{\"id\":\"coordinates\",\"name\":\"Coordinates\",\"version\":\"0.1.0\",\"kind\":\"utility\","
            + "\"active\":true,\"status\":{\"state\":\"OK\",\"detail\":\"\"},"
            + "\"web\":{\"entry\":\"index.js\",\"css\":[\"coordinates.css\"],"
            + "\"shared\":{\"proj4\":\"2.22.0\",\"react\":\"19.3.0\"},\"url\":\"/plugins/coordinates/web/\"},"
            + "\"sdkVersion\":\"^1.0.0\",\"dependsOn\":[\"echo\"],\"provides\":[\"emc2.coordinates\"],\"requires\":[],\"uses\":[],"
            + "\"required\":true,\"settings\":{\"precision\":5},\"hasSettings\":true,\"capabilities\":[\"temporal\"],\"serverPart\":false,"
            + "\"category\":\"map-and-symbols\",\"symbolPalettes\":[{\"id\":\"grid\",\"name\":\"Grid\",\"symbols\":"
            + "[{\"standard\":\"APP-6D\",\"code\":\"10031000001211000000\"}]}],\"icon\":\"Radar\",\"computeThreads\":3}") // SDK 1.6.0, T-174 and part G; 1.9.0 compute
        .contains("{\"id\":\"broken\",\"name\":null,\"version\":null,\"kind\":null,\"active\":false,"
            + "\"status\":{\"state\":\"FAILED\",\"detail\":\"no plugin.json\"},\"web\":null,\"sdkVersion\":null,"
            + "\"dependsOn\":[],\"provides\":[],\"requires\":[],\"uses\":[],\"required\":false,\"settings\":null,\"hasSettings\":false,"
            + "\"capabilities\":[],\"serverPart\":false,\"category\":null,\"symbolPalettes\":null,\"icon\":null,\"computeThreads\":0}")
        .contains("\"id\":\"future\"").contains("\"active\":false")
        .contains("\"settings\":{\"mode\":\"x\"},\"hasSettings\":false,"); // disabled: no tab, though it has settings
  }

  @Test
  void theConfigCarriesTheDeclaredFieldsOfThePluginsThatStarted() throws Exception {
    // A web-only plugin may declare fields too (ADR-0038 point 1); future's would not count, it cannot start.
    tools.jackson.databind.JsonNode config = tools.jackson.databind.json.JsonMapper.builder().build().readTree(get("/api/config").body());

    assertThat(config.get("declaredFields").toString())
        .isEqualTo("[{\"plugin\":\"coordinates\",\"name\":\"grid\",\"type\":\"boolean\",\"label\":\"Grid\",\"editableByOthers\":true}]");
  }

  @Test
  void theConfigCarriesTheFieldSetsAndRelationKindsOfThePluginsThatStarted() throws Exception {
    tools.jackson.databind.JsonNode config = tools.jackson.databind.json.JsonMapper.builder().build().readTree(get("/api/config").body());

    assertThat(config.get("fieldSets").toString())
        .isEqualTo("[{\"id\":\"coordinates.display\",\"plugin\":\"coordinates\",\"name\":\"display\",\"label\":\"Display\",\"fields\":[\"grid\"]}]");
    assertThat(config.get("relationKinds").toString()).isEqualTo("[{\"id\":\"coordinates.near\",\"label\":\"Near\","
        + "\"line\":{\"strokeColor\":\"#336699\",\"strokeWidth\":1.0,\"strokeDash\":\"solid\",\"arrowhead\":\"end\"},\"defaultOn\":false}]");
  }

  @Test
  void aBrowsersReportOfAWebPartsCapabilitiesIsJudgedAndShownInTheMonitor() throws Exception {
    // coordinates is web only and declares temporal (SDK 1.4.0, ADR-0044 point 4; owner, 2026-11-06).
    assertThat(post("/api/web-parts/coordinates/capabilities", "{\"implemented\":[]}").statusCode()).isEqualTo(204);
    assertThat(fault("coordinates")).isEqualTo("capability temporal declared but implemented by neither part (ADR-0044 point 4)");
    assertThat(post("/api/web-parts/coordinates/capabilities", "{\"implemented\":[\"temporal\"],\"problem\":null}").statusCode())
        .isEqualTo(204);
    assertThat(fault("coordinates")).isNull();

    assertThat(post("/api/web-parts/future/capabilities", "{\"implemented\":[]}").statusCode()).as("not running").isEqualTo(404);
    assertThat(post("/api/web-parts/coordinates/capabilities", "{\"implemented\":\"temporal\"}").statusCode()).isEqualTo(400);
    assertThat(post("/api/web-parts/coordinates/capabilities", "{\"implemented\":[],\"problem\":3}").statusCode()).isEqualTo(400);
    assertThat(post("/api/web-parts/coordinates/capabilities", "not json").statusCode()).isEqualTo(400);
  }

  private HttpResponse<String> post(String path, String body) throws Exception {
    return post(path, "application/json", body, self());
  }

  private @org.jspecify.annotations.Nullable String fault(String pluginId) throws Exception {
    tools.jackson.databind.JsonNode monitor = tools.jackson.databind.json.JsonMapper.builder().build().readTree(get("/api/monitor").body());
    for (tools.jackson.databind.JsonNode p : monitor.get("plugins")) {
      if (p.get("id").asString().equals(pluginId)) {
        assertThat(p.get("capabilities").toString()).isEqualTo("[\"temporal\"]");
        tools.jackson.databind.JsonNode f = p.get("capabilityFault");
        return f == null || f.isNull() ? null : f.get("problem").asString();
      }
    }
    throw new AssertionError("no plugin " + pluginId);
  }

  @Test
  void theConfigCarriesTheWorkspacesTheUserMaySeeViewFirst() throws Exception {
    // The no-login mode's local user has every permission, so it sees echo's Lab (ADR-0039); a user
    // without plugin.echo.view would get View only (PluginHost.workspacesJson).
    tools.jackson.databind.JsonNode config = tools.jackson.databind.json.JsonMapper.builder().build().readTree(get("/api/config").body());

    assertThat(config.get("workspaces").toString()).isEqualTo("[{\"id\":\"core.view\",\"name\":\"View\",\"order\":-2147483648},"
        + "{\"id\":\"echo.lab\",\"name\":\"Lab\",\"viewPermission\":\"plugin.echo.view\",\"editPermission\":\"plugin.echo.edit\","
        + "\"order\":7}]");
  }

  @Test
  void onlyASettingsSchemaThatNamesAPropertyGivesAPluginATab() {
    tools.jackson.databind.json.JsonMapper mapper = tools.jackson.databind.json.JsonMapper.builder().build();
    assertThat(PluginController.hasSettings(null)).isFalse();
    assertThat(PluginController.hasSettings(mapper.readTree("{\"type\":\"object\"}"))).isFalse();
    assertThat(PluginController.hasSettings(mapper.readTree("{\"type\":\"object\",\"properties\":{}}"))).isFalse();
    assertThat(PluginController.hasSettings(mapper.readTree("{\"type\":\"object\",\"properties\":{\"a\":{\"type\":\"string\"}}}"))).isTrue();
  }

  @Test
  void servesTheWebPartsOfActivePlugins() throws Exception {
    HttpResponse<String> entry = get("/plugins/coordinates/web/index.js");
    assertThat(entry.statusCode()).isEqualTo(200);
    assertThat(entry.body()).isEqualTo("export default { activate() {} };");
    assertThat(entry.headers().firstValue("Content-Type")).hasValueSatisfying(t -> assertThat(t).startsWith("text/javascript"));
    assertThat(entry.headers().firstValue("Cache-Control")).hasValue("no-cache");
    assertThat(get("/plugins/coordinates/web/assets/icon.svg").statusCode()).as("subfolders").isEqualTo(200);
  }

  @Test
  void servesNothingElseFromThePluginsFolder() throws Exception {
    assertThat(get("/plugins/coordinates/plugin.json").statusCode()).as("manifest").isEqualTo(404);
    assertThat(get("/plugins/echo/server/echo.jar").statusCode()).as("server part").isEqualTo(404);
    assertThat(get("/plugins/coordinates/web/missing.js").statusCode()).isEqualTo(404);
    assertThat(get("/plugins/future/web/index.js").statusCode()).as("a disabled plugin").isEqualTo(404);
    assertThat(get("/plugins/echo/web/index.js").statusCode()).as("no web part in the manifest").isEqualTo(404);
    assertThat(get("/plugins/nobody/web/index.js").statusCode()).isEqualTo(404);
    assertThat(get("/plugins/").statusCode()).isEqualTo(404);
    assertThat(rawStatusLine("/plugins/coordinates/web/../plugin.json")).as("out of the folder").doesNotContain(" 200 ");
    assertThat(rawStatusLine("/plugins/coordinates/web/%2e%2e/plugin.json")).doesNotContain(" 200 ");
    assertThat(rawStatusLine("/plugins/coordinates/web/..%5cplugin.json")).doesNotContain(" 200 ");
  }

  @Test
  void aWebPartsFilesComeWithTheContentSecurityPolicyAndItsFolderIsNoListing() throws Exception {
    assertThat(get("/plugins/coordinates/web/index.js").headers().firstValue("Content-Security-Policy"))
        .hasValueSatisfying(csp -> assertThat(csp).contains("default-src 'self'"));
    assertThat(get("/plugins/coordinates/web/").statusCode()).as("the folder itself").isEqualTo(404);
    assertThat(get("/plugins/coordinates/web").statusCode()).isEqualTo(404);
    assertThat(get("/plugins/coordinates/web/assets/").statusCode()).as("a subfolder").isEqualTo(404);
  }

  @Test
  void noDoubleSlashAbsolutePathOrSymlinkLeavesAWebFolder() throws Exception {
    Path secret = Files.writeString(folder.resolve("secret.txt"), "not for browsers");
    String absolute = secret.toAbsolutePath().toString().replace('\\', '/');
    for (String path : List.of("/plugins/coordinates/web//plugin.json", "/plugins/coordinates/web/" + absolute,
        "/plugins/coordinates/web//" + absolute, "/plugins/coordinates/web/%2F" + absolute, "/plugins//coordinates/web/index.js/../../plugin.json")) {
      assertThat(rawStatusLine(path)).as(path).doesNotContain(" 200 ");
    }
    Path link = folder.resolve("plugins/coordinates/web/link.txt");
    try {
      Files.createSymbolicLink(link, secret);
    } catch (IOException | UnsupportedOperationException e) {
      org.junit.jupiter.api.Assumptions.abort("symbolic links cannot be made here: " + e);
    }
    try {
      assertThat(get("/plugins/coordinates/web/link.txt").statusCode()).as("a link out of the folder").isEqualTo(404);
    } finally {
      Files.delete(link);
    }
  }

  @Test
  void routesRequestsIntoThePluginsWorker() throws Exception {
    HttpRequest request = request("/api/plugins/echo/echo/hello%20world?x=1").header("X-Test", "abc").GET().build();

    HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());

    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(response.body()).isEqualTo("hello world x=1 header=abc");
    assertThat(response.headers().firstValue("X-Echo")).hasValue("yes");
  }

  @Test
  void passesAnyStatusTheWorkerAnswers() throws Exception {
    assertThat(get("/api/plugins/echo/teapot").statusCode()).isEqualTo(418);
  }

  @Test
  void unknownPluginsAndPathsGive404() throws Exception {
    assertThat(get("/api/plugins/echo/nothing/here").statusCode()).isEqualTo(404);
    assertThat(get("/api/plugins/nobody/echo/x").statusCode()).isEqualTo(404);
    assertThat(get("/api/plugins/broken/x").statusCode()).isEqualTo(404);
  }

  @Test
  void headIsAnsweredLikeGetWithoutABody() throws Exception {
    HttpResponse<String> response = HTTP.send(
        request("/api/plugins/echo/echo/hi").method("HEAD", HttpRequest.BodyPublishers.noBody()).build(),
        HttpResponse.BodyHandlers.ofString());

    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(response.headers().firstValue("X-Echo")).hasValue("yes");
    assertThat(response.body()).isEmpty();
  }

  @Test
  void aBadPercentSequenceGives400() throws Exception {
    assertThat(rawStatusLine("/api/plugins/echo/echo/%zz")).contains(" 400 ");
    assertThat(get("/api/plugins/echo/echo/%E0%A4").statusCode()).as("not UTF-8").isEqualTo(400);
  }

  /**
   * The Origin and Host checks hold for every spelling of a path that Spring routes to the same
   * place: path parameters (";x") and percent-encoded letters are no way around them (security
   * review, remark 1). Without the checks these requests reach the plugin controller.
   */
  @Test
  void noSpellingOfAnApiPathGetsAroundTheOriginAndHostChecks() throws Exception {
    String self = "127.0.0.1:" + environment.getRequiredProperty("local.server.port");
    List<String> spellings = List.of("/api/plugins/echo/echo/hi", "/api;x/plugins/echo/echo/hi", "/%61pi/plugins/echo/echo/hi",
        "/api/plugins/echo/echo/hi;x", "/api/plugins;x/echo/echo/hi", "/api/%70lugins/echo/echo/hi");
    for (String path : spellings) {
      assertThat(rawStatusLine("POST", path, self, "http://evil.example")).as("cross-origin POST " + path).contains(" 403 ");
      assertThat(rawStatusLine("GET", path, "evil.example:" + self.substring(self.indexOf(':') + 1), null))
          .as("GET under a foreign Host " + path).contains(" 403 ");
    }
    assertThat(rawStatusLine("GET", "/api;x/plugins/echo/echo/hi", self, null))
        .as("the same request with this server's Host passes the checks").doesNotContain(" 403 ");
    assertThat(rawStatusLine("GET", "/plugins/coordinates/web/index.js", "evil.example:" + self.substring(self.indexOf(':') + 1), null))
        .as("static files are checked too").contains(" 403 ");
    assertThat(rawStatusLine("POST", "/%61pi/plugins/echo/echo/hi", self, "http://" + self))
        .as("a same-origin POST reaches the application, which has no POST there").doesNotContain(" 403 ");
  }

  // ---- SDK 1.6.0: service endpoints and raw bodies (CR-0041 part A) ----------------------------

  @Test
  void aServiceEndpointIsReachedOnlyUnderApiServicesAsTheServiceCallerAndLoggedWithTheAddress(CapturedOutput output) throws Exception {
    HttpResponse<String> soap = HTTP.send(request("/api/services/echo/soap/north").header("Content-Type", "text/xml; charset=utf-8")
        .POST(HttpRequest.BodyPublishers.ofString("<Envelope/>")).build(), HttpResponse.BodyHandlers.ofString()); // no Origin: a system

    assertThat(soap.statusCode()).isEqualTo(200);
    assertThat(soap.body()).isEqualTo("north SERVICE service <Envelope/>");
    assertThat(output.getOut()).contains("Plugin echo: service POST /soap/north by a service caller at 127.0.0.1 answered 200");
    assertThat(post("/api/plugins/echo/soap/north", "text/xml", "<Envelope/>", self()).statusCode()).as("not a browser endpoint")
        .isEqualTo(404);
    assertThat(get("/api/services/echo/echo/hi").statusCode()).as("not a service endpoint").isEqualTo(404);
    assertThat(HTTP.send(request("/api/services/echo/soap/north").header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString("{}")).build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(415);
    assertThat(HTTP.send(request("/api/services/echo/soap/north").header("Content-Type", "text/xml").header("Origin", "http://evil.example")
        .POST(HttpRequest.BodyPublishers.ofString("<a/>")).build(), HttpResponse.BodyHandlers.ofString()).statusCode())
        .as("a page of another site is refused by the Origin check").isEqualTo(403);
  }

  // ---- SDK 1.2.0: POST endpoints (CR-0026) ----------------------------------------------------

  @Test
  void aPostWithAJsonBodyReachesThePluginParsedWithItsQueryAndIsLogged(CapturedOutput output) throws Exception {
    HttpResponse<String> response = post("/api/plugins/echo/commands/start?x=1", "application/json; charset=UTF-8",
        "{\"speed\": 1.50}", self());

    assertThat(response.statusCode()).isEqualTo(202);
    assertThat(response.headers().firstValue("Content-Type")).hasValueSatisfying(t -> assertThat(t).startsWith("application/json"));
    assertThat(response.body()).isEqualTo("[\"start\",\"1\",{\"speed\":1.50}]");
    assertThat(output.getOut()).contains("Plugin echo: POST /commands/start by the local user (no login) answered 202")
        .doesNotContain("\"speed\": 1.50");
  }

  @Test
  void eCoreRefusesABodyThatIsNotJsonTooLongOrInvalidBeforeThePluginSeesIt() throws Exception {
    int before = posted();
    String tooLong = "\"" + "x".repeat(EchoPlugin.MAX_BODY) + "\"";

    assertThat(post("/api/plugins/echo/commands/start", "text/plain", "{}", self()).statusCode()).isEqualTo(415);
    assertThat(post("/api/plugins/echo/commands/start", "application/x-www-form-urlencoded", "a=1", self()).statusCode())
        .isEqualTo(415);
    assertThat(post("/api/plugins/echo/commands/start", "application/json", tooLong, self()).statusCode())
        .as("by its Content-Length").isEqualTo(413);
    HttpResponse<String> chunked = HTTP.send(request("/api/plugins/echo/commands/start").header("Content-Type", "application/json")
        .header("Origin", self()).POST(HttpRequest.BodyPublishers.ofInputStream(
            () -> new ByteArrayInputStream(tooLong.getBytes(StandardCharsets.UTF_8)))).build(), HttpResponse.BodyHandlers.ofString());
    assertThat(chunked.statusCode()).as("chunked, without a Content-Length").isEqualTo(413);
    assertThat(post("/api/plugins/echo/commands/start", "application/json", "{\"a\": 1, \"a\": 2}", self()).statusCode())
        .as("a duplicate key").isEqualTo(400);
    HttpResponse<String> utf16 = HTTP.send(request("/api/plugins/echo/commands/start").header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofByteArray("{}".getBytes(StandardCharsets.UTF_16))).build(), HttpResponse.BodyHandlers.ofString());
    assertThat(utf16.statusCode()).as("UTF-16 with its byte order mark").isEqualTo(400);

    assertThat(posted()).as("none delivered").isEqualTo(before);
  }

  /**
   * Multipart and form parsing are off (CR-0026: a plugin POST reads at most its maxBody): with them
   * on, Spring would read this 1.5 MB multipart body itself and refuse it as larger than its 1 MB
   * upload limit, before ECore sees the request.
   */
  @Test
  void aLargeMultipartBodyIsNotReadBySpringButRefusedByECoreWith415() throws Exception {
    String boundary = "emc2boundary";
    String body = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"f\"; filename=\"f.bin\"\r\n\r\n"
        + "x".repeat(1_500_000) + "\r\n--" + boundary + "--\r\n";

    assertThat(post("/api/plugins/echo/commands/start", "multipart/form-data; boundary=" + boundary, body, self()).statusCode())
        .isEqualTo(415);
  }

  @Test
  void springsFormFilterIsOff() {
    assertThat(context.getBeanNamesForType(org.springframework.web.filter.FormContentFilter.class))
        .as("spring.mvc.formcontent.filter.enabled=false: no filter reads a form body before the controllers").isEmpty();
  }

  @Test
  void aPathWithoutAnEndpointForTheMethodGets405WithAllow() throws Exception {
    HttpResponse<String> postToGet = post("/api/plugins/echo/echo/hi", "application/json", "{}", self());
    HttpResponse<String> getToPost = get("/api/plugins/echo/commands/start");
    HttpResponse<String> headToPost = HTTP.send(request("/api/plugins/echo/commands/start")
        .method("HEAD", HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
    HttpResponse<String> put = put("/api/plugins/echo/commands/start", "{}", self());
    HttpResponse<String> delete = delete("/api/plugins/echo/echo/hi", self());

    assertThat(List.of(postToGet, getToPost, headToPost, put, delete)).extracting(HttpResponse::statusCode)
        .containsExactly(405, 405, 405, 405, 405);
    assertThat(List.of(postToGet, getToPost, headToPost, put, delete)).extracting(r -> r.headers().firstValue("Allow").orElse(""))
        .containsExactly("GET", "POST", "POST", "POST", "GET");
    assertThat(delete("/api/plugins/echo/nothing", self()).statusCode()).as("an unknown path").isEqualTo(404);
  }

  @Test
  void aCrossSitePostIsRefusedWith403AndNeverDelivered() throws Exception {
    int before = posted();
    String path = "/api/plugins/echo/commands/start";

    assertThat(post(path, "application/json", "{}", "http://evil.example").statusCode()).as("another Origin").isEqualTo(403);
    assertThat(post(path, "application/json", "{}", "null").statusCode()).as("Origin: null").isEqualTo(403);
    HttpResponse<String> referer = HTTP.send(request(path).header("Content-Type", "application/json")
        .header("Referer", "http://evil.example/page").POST(HttpRequest.BodyPublishers.ofString("{}")).build(),
        HttpResponse.BodyHandlers.ofString());
    assertThat(referer.statusCode()).as("another site's Referer without an Origin").isEqualTo(403);
    assertThat(post(path, "text/plain", "{}", "http://evil.example").statusCode()).as("what a cross-site form could send")
        .isEqualTo(403);

    assertThat(posted()).as("none delivered").isEqualTo(before);
    assertThat(post(path, "application/json", "{}", self()).statusCode()).as("the same request from this server's page").isEqualTo(202);
    assertThat(post(path, "application/json", "{}", null).statusCode())
        .as("neither Origin nor Referer: no browser (OriginCheckFilter's rule)").isEqualTo(202);
    assertThat(posted()).isEqualTo(before + 2);
  }

  private String self() {
    return "http://127.0.0.1:" + environment.getRequiredProperty("local.server.port");
  }

  /** How many POSTs the echo plugin's worker has been given. */
  private int posted() throws Exception {
    return Integer.parseInt(get("/api/plugins/echo/posted").body());
  }

  private HttpResponse<String> post(String path, String contentType, String body, @Nullable String origin) throws Exception {
    HttpRequest.Builder request = request(path).header("Content-Type", contentType).POST(HttpRequest.BodyPublishers.ofString(body));
    if (origin != null) {
      request.header("Origin", origin);
    }
    return HTTP.send(request.build(), HttpResponse.BodyHandlers.ofString());
  }

  /** Sends a request line the JDK's URI class would refuse, and returns the status line. */
  private String rawStatusLine(String path) throws IOException {
    return rawStatusLine("GET", path, "127.0.0.1", null);
  }

  private String rawStatusLine(String method, String path, String host, @Nullable String origin) throws IOException {
    int port = Integer.parseInt(environment.getRequiredProperty("local.server.port"));
    try (java.net.Socket socket = new java.net.Socket("127.0.0.1", port)) {
      socket.setSoTimeout(10_000);
      socket.getOutputStream().write((method + " " + path + " HTTP/1.1\r\nHost: " + host + "\r\n"
          + (origin == null ? "" : "Origin: " + origin + "\r\n") + "Content-Length: 0\r\nConnection: close\r\n\r\n")
          .getBytes(java.nio.charset.StandardCharsets.US_ASCII));
      return new java.io.BufferedReader(new java.io.InputStreamReader(socket.getInputStream(),
          java.nio.charset.StandardCharsets.US_ASCII)).readLine();
    }
  }

  @Test
  void aPluginsSettingsAreShownAndChangedThroughTheSettingsEndpoint() throws Exception {
    HttpResponse<String> view = get("/api/settings/plugins/coordinates");
    assertThat(view.statusCode()).isEqualTo(200);
    assertThat(view.body()).contains("\"schema\":{\"type\":\"object\"").contains("\"values\":{\"precision\":5}");

    assertThat(put("/api/settings/plugins/coordinates", "{\"precision\": 7}", null).body()).isEqualTo("{\"values\":{\"precision\":7}}");
    assertThat(get("/api/settings/plugins/coordinates").body()).contains("\"values\":{\"precision\":7}");

    HttpResponse<String> invalid = put("/api/settings/plugins/coordinates", "{\"precision\": \"x\"}", null);
    assertThat(invalid.statusCode()).isEqualTo(400);
    assertThat(invalid.body()).contains("\"path\":\"/precision\"");
    assertThat(put("/api/settings/plugins/coordinates", "[1]", null).statusCode()).isEqualTo(400);
    assertThat(put("/api/settings/plugins/coordinates", "{not json", null).statusCode()).isEqualTo(400);
    assertThat(put("/api/settings/plugins/nobody", "{}", null).statusCode()).isEqualTo(404);
    assertThat(get("/api/settings/plugins/nobody").statusCode()).isEqualTo(404);
    assertThat(put("/api/settings/plugins/coordinates", "{\"precision\": 9}", "http://evil.example").statusCode())
        .as("another site's page").isEqualTo(403);
    assertThat(get("/api/settings/plugins/coordinates").body()).contains("\"values\":{\"precision\":7}");
    assertThat(put("/api/settings/plugins/coordinates", "{\"precision\": 5}", null).statusCode()).as("as the other tests expect").isEqualTo(200);
  }

  @Test
  void aPluginsComputeThreadsAreShownAndSetThroughItsComputeSettings() throws Exception { // SDK 1.9.0, ADR-0064, PQ1 A
    assertThat(get("/api/settings/plugins/coordinates/compute").body()).isEqualTo("{\"declared\":3,\"reason\":\"Computes grids.\",\"allowed\":3}");

    assertThat(put("/api/settings/plugins/coordinates/compute", "{\"allowed\": 1}", null).body())
        .isEqualTo("{\"declared\":3,\"reason\":\"Computes grids.\",\"allowed\":1}");
    assertThat(get("/api/settings/plugins/coordinates/compute").body()).contains("\"allowed\":1");

    for (String wrong : List.of("{\"allowed\": 4}", "{\"allowed\": -1}", "{\"allowed\": 1.5}", "{\"allowed\": \"2\"}", "{}")) {
      HttpResponse<String> refused = put("/api/settings/plugins/coordinates/compute", wrong, null);
      assertThat(refused.statusCode()).as(wrong).isEqualTo(400);
      assertThat(refused.body()).contains("\"path\":\"/allowed\"").contains("0 to 3");
    }
    assertThat(put("/api/settings/plugins/coordinates/compute", "{not json", null).statusCode()).isEqualTo(400);
    assertThat(get("/api/settings/plugins/echo/compute").statusCode()).as("declares none").isEqualTo(404);
    assertThat(put("/api/settings/plugins/nobody/compute", "{\"allowed\": 1}", null).statusCode()).isEqualTo(404);
    assertThat(put("/api/settings/plugins/coordinates/compute", "{\"allowed\": 0}", "http://evil.example").statusCode())
        .as("another site's page").isEqualTo(403);
    assertThat(get("/api/settings/plugins/coordinates/compute").body()).as("kept").contains("\"allowed\":1");
    assertThat(put("/api/settings/plugins/coordinates/compute", "{\"allowed\": 3}", null).statusCode()).isEqualTo(200);
  }

  @Test
  void aSettingsListsItemsGetTheirIdsAndTwoOfOneIdAreRefused() throws Exception { // SDK 1.8.0, CR-0047 F2
    HttpResponse<String> filled = put("/api/settings/plugins/coordinates", "{\"precision\": 5, \"grids\": [{\"name\": \"A\"}]}", null);
    assertThat(filled.statusCode()).isEqualTo(200);
    assertThat(filled.body()).as("the answer carries the id ECore gave")
        .matches("\\{\"values\":\\{\"precision\":5,\"grids\":\\[\\{\"name\":\"A\",\"id\":\"[0-9a-f-]{36}\"}]}}");

    HttpResponse<String> twice = put("/api/settings/plugins/coordinates",
        "{\"precision\": 5, \"grids\": [{\"id\": \"g\", \"name\": \"A\"}, {\"id\": \"g\", \"name\": \"B\"}]}", null);
    assertThat(twice.statusCode()).isEqualTo(400);
    assertThat(twice.body()).contains("\"path\":\"/grids/1/id\"");
    assertThat(put("/api/settings/plugins/coordinates", "{\"precision\": 5}", null).statusCode()).as("as the other tests expect").isEqualTo(200);
  }

  @Test
  void aDataTypesBehaviourIsShownAndChangedThroughTheSettingsEndpoint() throws Exception {
    HttpResponse<String> view = get("/api/settings/data-types/core.general");
    assertThat(view.statusCode()).isEqualTo(200);
    assertThat(view.body()).contains("\"id\":\"core.general\"").contains("\"behaviour\":{\"fadeWhenExpired\":false}");

    HttpResponse<String> changed = put("/api/settings/data-types/core.general", "{\"fadeWhenExpired\": true, \"expiresAfterSeconds\": 600}", null);
    assertThat(changed.statusCode()).isEqualTo(200);
    assertThat(changed.body()).contains("\"behaviour\":{\"expiresAfterSeconds\":600,\"fadeWhenExpired\":true}");

    HttpResponse<String> invalid = put("/api/settings/data-types/core.general", "{\"fadeWhenExpired\": \"yes\"}", null);
    assertThat(invalid.statusCode()).isEqualTo(400);
    assertThat(invalid.body()).contains("\"path\":\"/fadeWhenExpired\"");
    assertThat(put("/api/settings/data-types/nothing.here", "{\"fadeWhenExpired\": true}", null).statusCode()).isEqualTo(404);
    assertThat(get("/api/settings/data-types/nothing.here").statusCode()).isEqualTo(404);
    assertThat(put("/api/settings/data-types/core.general", "{\"fadeWhenExpired\": false}", "http://evil.example").statusCode())
        .as("another site's page").isEqualTo(403);
    assertThat(put("/api/settings/data-types/core.general", "{\"fadeWhenExpired\": false}", null).statusCode())
        .as("as the other tests expect").isEqualTo(200);
  }

  @Test
  void theDefaultLookIsChangedThroughTheGeneralSettingsAndReadInTheConfig() throws Exception {
    HttpResponse<String> changed = put("/api/settings/general", "{\"defaultLook\": \"chart-room\"}", null);
    assertThat(changed.statusCode()).as(changed.body()).isEqualTo(200);
    assertThat(changed.body()).isEqualTo("{\"defaultLook\":\"chart-room\"}");
    assertThat(get("/api/config").body()).contains("\"defaultLook\":\"chart-room\"");

    HttpResponse<String> invalid = put("/api/settings/general", "{\"defaultLook\": \"pink\"}", null);
    assertThat(invalid.statusCode()).isEqualTo(400);
    assertThat(invalid.body()).contains("\"path\":\"/defaultLook\"").contains("one of night-watch, chart-room, signal");
    assertThat(put("/api/settings/general", "[]", null).statusCode()).isEqualTo(400);
    assertThat(put("/api/settings/general", "{\"defaultLook\": \"signal\"}", "http://evil.example").statusCode()).as("another site's page").isEqualTo(403);
    assertThat(put("/api/settings/general", "{\"defaultLook\": \"night-watch\"}", null).statusCode()).as("as the other tests expect").isEqualTo(200);
  }

  @Test
  void thePremadeLabelsAreReadAndReplacedWholeThroughTheLabelingSettings() throws Exception {
    assertThat(get("/api/settings/labeling").body()).isEqualTo("{\"policies\":{}}");
    String premade = "{\"policies\":{\"NATO\":{\"releasableTo\":[\"SWE\",\"NOR\"],\"labels\":[{\"policyIdentifier\":{\"name\":\"NATO\"},"
        + "\"classification\":\"SECRET\",\"categories\":[{\"tagName\":\"Releasable To\",\"type\":\"permissive\",\"values\":[\"NOR\",\"SWE\"]}]}]}}}";

    HttpResponse<String> saved = put("/api/settings/labeling", premade, null);
    assertThat(saved.statusCode()).as(saved.body()).isEqualTo(200);
    assertThat(saved.body()).isEqualTo(premade);
    assertThat(get("/api/settings/labeling").body()).isEqualTo(premade);

    HttpResponse<String> refused = put("/api/settings/labeling", "{\"policies\":{\"NATO\":{\"releasableTo\":[\"SWE\",\"SWE\"]}}}", null);
    assertThat(refused.statusCode()).isEqualTo(400);
    assertThat(refused.body()).isEqualTo("{\"problems\":[{\"path\":\"/policies/NATO/releasableTo/1\",\"problem\":\"SWE is in the list already\"}]}");
    assertThat(put("/api/settings/labeling", "{\"policies\":", null).statusCode()).as("not JSON").isEqualTo(400);
    assertThat(put("/api/settings/labeling", "{\"policies\":{}}", "http://evil.example").statusCode()).as("another site's page").isEqualTo(403);
    assertThat(get("/api/settings/labeling").body()).as("kept").isEqualTo(premade);
    assertThat(put("/api/settings/labeling", "{\"policies\":{}}", null).statusCode()).as("as the other tests expect").isEqualTo(200);
  }

  @Test
  void aDataTypesBehaviourIsSetBackToItsDefaultsThroughTheSettingsEndpoint() throws Exception {
    assertThat(put("/api/settings/data-types/core.general", "{\"fadeWhenExpired\": true, \"expiresAfterSeconds\": 60}", null).statusCode())
        .isEqualTo(200);
    assertThat(delete("/api/settings/data-types/core.general", "http://evil.example").statusCode()).as("another site's page").isEqualTo(403);
    assertThat(delete("/api/settings/data-types/nothing.here", null).statusCode()).isEqualTo(404);

    HttpResponse<String> reset = delete("/api/settings/data-types/core.general", null);

    assertThat(reset.statusCode()).isEqualTo(200);
    assertThat(reset.body()).contains("\"id\":\"core.general\"").contains("\"behaviour\":{\"fadeWhenExpired\":false}");
    assertThat(get("/api/settings/data-types/core.general").body()).contains("\"behaviour\":{\"fadeWhenExpired\":false}");
  }

  @Test
  void theMonitorShowsTheCoreThePluginsAndTheirWorkersAndIsNeverCached() throws Exception {
    HttpResponse<String> monitor = get("/api/monitor");

    assertThat(monitor.statusCode()).isEqualTo(200);
    assertThat(monitor.headers().firstValue("Cache-Control")).hasValue("no-store");
    tools.jackson.databind.JsonNode body = new tools.jackson.databind.ObjectMapper().readTree(monitor.body());
    assertThat(body.get("atMillis").asLong()).isPositive();
    assertThat(body.at("/core/state").asString()).isEqualTo("RUNNING");
    assertThat(body.at("/core/layers").asInt()).isPositive();
    assertThat(body.at("/core/jvm/heapUsed").asLong()).isPositive();
    assertThat(body.at("/core/jvm/allocation").propertyNames()).as("api.ts, T-148")
        .containsExactlyInAnyOrder("totalBytes", "sampling", "sampledBytes", "ecoreBytes");
    assertThat(body.at("/core/jvm/allocation/totalBytes").asLong()).isPositive();
    assertThat(body.at("/core/jvm/allocation/sampling").asBoolean()).as("emc2.monitor.allocation is on by default").isTrue();
    List<String> plugins = new java.util.ArrayList<>();
    body.get("plugins").forEach(p -> plugins.add(p.get("id").asString() + " " + p.get("state").asString() + " " + p.get("active").asBoolean()));
    assertThat(plugins).contains("echo OK true", "future FAILED false");
    assertThat(body.get("plugins").get(0).at("/caps/maxAsks").asInt()).isPositive();
    Map<String, tools.jackson.databind.JsonNode> byId = new java.util.HashMap<>();
    body.get("plugins").forEach(p -> byId.put(p.get("id").asString(), p));
    assertThat(byId.get("echo").at("/internet/hosts").toString()).as("declared (ADR-0030)").isEqualTo("[\"tiles.example.org\"]");
    assertThat(byId.get("echo").at("/internet/reason").asString()).isEqualTo("Fetches tiles. Demos only.");
    assertThat(byId.get("coordinates").get("internet").isNull()).as("declares none: null, not left out").isTrue();
    assertThat(byId.get("echo").get("connections").isArray()).as("declared connections (ADR-0036)").isTrue();
    assertThat(byId.get("echo").get("tasks").isArray()).as("its connection tasks").isTrue();
    assertThat(byId.get("echo").get("tasks")).isEmpty();
    List<String> core = new java.util.ArrayList<>();
    body.get("coreWorkers").forEach(w -> core.add(w.get("owner").asString() + "/" + w.get("name").asString()));
    assertThat(core).contains("core-store/object-store");
  }

  @Test
  void theMonitorDataGoesOutOnlyThroughItsOwnEndpointAndOnlyForReading() throws Exception {
    for (String path : List.of("/api/plugins", "/api/config")) {
      assertThat(get(path).body()).as(path + ", which every logged-in user gets")
          .doesNotContain("coreWorkers", "refusedAsks", "heapUsed", "maxHandlerMicros", "liveSessions");
    }
    HttpResponse<String> post = HTTP.send(request("/api/monitor").POST(HttpRequest.BodyPublishers.noBody()).build(),
        HttpResponse.BodyHandlers.ofString());
    assertThat(post.statusCode()).as("GET only").isEqualTo(405);
    assertThat(post.body()).doesNotContain("coreWorkers");
  }

  // ---- The user's own documents (ADR-0027) --------------------------------------------------------

  @Test
  void theUserKeepsDocumentsInTheShellsNamespaceAndInAWebPartsOwn() throws Exception {
    assertThat(put("/api/user-documents/core/setup.current", "{ \"clock\": \"utc\",\n \"panes\": {\"left\": 280} }", null).statusCode())
        .isEqualTo(204);
    HttpResponse<String> got = get("/api/user-documents/core/setup.current");
    assertThat(got.statusCode()).isEqualTo(200);
    assertThat(got.body()).isEqualTo("{\"clock\":\"utc\",\"panes\":{\"left\":280}}");
    assertThat(got.headers().firstValue("Content-Type")).hasValueSatisfying(t -> assertThat(t).startsWith("application/json"));
    assertThat(got.headers().firstValue("Cache-Control")).hasValue("no-store");
    assertThat(get("/api/user-documents/core").body()).as("the names, sorted (other tests add theirs)")
        .startsWith("{\"names\":[").contains("\"setup.current\"");

    assertThat(put("/api/user-documents/coordinates/format", "\"dms\"", null).statusCode()).as("a web part's namespace").isEqualTo(204);
    assertThat(get("/api/user-documents/coordinates/format").body()).isEqualTo("\"dms\"");
    assertThat(delete("/api/user-documents/coordinates/format", null).statusCode()).isEqualTo(204);
    HttpResponse<String> gone = get("/api/user-documents/coordinates/format");
    assertThat(gone.statusCode()).isEqualTo(404);
    assertThat(gone.body()).isEqualTo("{\"problem\":\"no such document\"}");

    // On disk under the local user's hashed folder, never under a name the browser gave.
    try (Stream<Path> users = Files.list(folder.resolve("data/user-documents"))) {
      Path user = users.filter(Files::isDirectory).findFirst().orElseThrow();
      assertThat(user.getFileName().toString()).matches("u-[0-9a-f]{64}");
      assertThat(user.resolve("user.json")).content().isEqualTo("{\"user\":\"local\"}");
      assertThat(user.resolve("n-core/d-setup.current.json")).exists();
    }
  }

  @Test
  void aUserDocumentNeedsAKnownNamespaceAGoodNameJsonAndRoom() throws Exception {
    for (String namespace : List.of("echo", "future", "broken", "nobody", "core-shell")) {
      HttpResponse<String> response = get("/api/user-documents/" + namespace);
      assertThat(response.statusCode()).as(namespace + ": no running plugin with a web part").isEqualTo(404);
      assertThat(response.body()).contains("no running plugin with a web part has the id " + namespace);
    }
    assertThat(put("/api/user-documents/core/Setup", "1", null).statusCode()).as("a name in capitals").isEqualTo(400);
    HttpResponse<String> notJson = put("/api/user-documents/core/x", "{not json", null);
    assertThat(notJson.statusCode()).isEqualTo(400);
    assertThat(notJson.body()).contains("the body is not JSON");
    HttpResponse<String> large = put("/api/user-documents/core/x", "\"" + "x".repeat(256 * 1024) + "\"", null);
    assertThat(large.statusCode()).isEqualTo(413);
    assertThat(large.body()).contains("more than 262144");
    assertThat(put("/api/user-documents/core/x", " ".repeat(UserDocumentsController.MAX_BODY) + "1", null).statusCode())
        .as("a body over 1 MiB, even of white space").isEqualTo(413);
    assertThat(get("/api/user-documents/core/x").statusCode()).as("nothing was written").isEqualTo(404);
  }

  @Test
  void aNamespaceHoldsAtMost200DocumentsAndABodyMustBeUtf8() throws Exception {
    // In coordinates' namespace, which the other tests leave empty; removed again at the end.
    for (int i = 0; i < 200; i++) {
      assertThat(put("/api/user-documents/coordinates/count." + i, "1", null).statusCode()).isEqualTo(204);
    }
    HttpResponse<String> full = put("/api/user-documents/coordinates/count.200", "1", null);
    assertThat(full.statusCode()).isEqualTo(409);
    assertThat(full.body()).contains("the namespace coordinates has 200 documents, the most it may have");
    for (int i = 0; i < 200; i++) {
      assertThat(delete("/api/user-documents/coordinates/count." + i, null).statusCode()).isEqualTo(204);
    }

    byte[] latin1 = {'"', (byte) 0xE5, '"'}; // "å" in ISO 8859-1: not UTF-8
    HttpResponse<String> notUtf8 = HTTP.send(request("/api/user-documents/core/x").header("Content-Type", "application/json")
        .PUT(HttpRequest.BodyPublishers.ofByteArray(latin1)).build(), HttpResponse.BodyHandlers.ofString());
    assertThat(notUtf8.statusCode()).isEqualTo(400);
    assertThat(notUtf8.body()).isEqualTo("{\"problem\":\"the body is not UTF-8\"}");
  }

  @Test
  void aUserWhoseDocumentsWouldPass4MibGets507() throws Exception {
    String full = "\"" + "x".repeat(256 * 1024 - 2) + "\""; // 256 KiB as JSON: 16 of them are the 4 MiB
    int written = 0;
    HttpResponse<String> response = null;
    for (int i = 0; i < 17; i++) {
      response = put("/api/user-documents/coordinates/full." + i, full, null);
      if (response.statusCode() != 204) {
        break;
      }
      written++;
    }
    try {
      assertThat(response).isNotNull();
      // Other tests' small documents of the same (local) user may take the room of the 16th.
      assertThat(written).as("written before the limit").isBetween(15, 16);
      assertThat(response.statusCode()).isEqualTo(507);
      assertThat(response.body()).contains("more than 4194304");
    } finally {
      for (int i = 0; i < written; i++) {
        delete("/api/user-documents/coordinates/full." + i, null);
      }
    }
  }

  @Test
  void anotherSiteCannotWriteOrRemoveTheUsersDocuments() throws Exception {
    assertThat(put("/api/user-documents/core/clock", "\"utc\"", "http://evil.example").statusCode()).isEqualTo(403);
    assertThat(put("/api/user-documents/core/clock", "\"utc\"", base()).statusCode()).as("the page itself").isEqualTo(204);
    assertThat(delete("/api/user-documents/core/clock", "http://evil.example").statusCode()).isEqualTo(403);
    assertThat(get("/api/user-documents/core/clock").body()).isEqualTo("\"utc\"");
  }

  private String base() {
    return "http://127.0.0.1:" + environment.getRequiredProperty("local.server.port");
  }

  private HttpResponse<String> delete(String path, @org.jspecify.annotations.Nullable String origin) throws Exception {
    HttpRequest.Builder request = request(path).DELETE();
    if (origin != null) {
      request.header("Origin", origin);
    }
    return HTTP.send(request.build(), HttpResponse.BodyHandlers.ofString());
  }

  private HttpResponse<String> put(String path, String json, @org.jspecify.annotations.Nullable String origin) throws Exception {
    HttpRequest.Builder request = request(path).header("Content-Type", "application/json").PUT(HttpRequest.BodyPublishers.ofString(json));
    if (origin != null) {
      request.header("Origin", origin);
    }
    return HTTP.send(request.build(), HttpResponse.BodyHandlers.ofString());
  }

  private HttpResponse<String> get(String path) throws IOException, InterruptedException {
    return HTTP.send(request(path).GET().build(), HttpResponse.BodyHandlers.ofString());
  }

  private HttpRequest.Builder request(String path) {
    String port = environment.getRequiredProperty("local.server.port");
    return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(10));
  }

  /**
   * echo (a server part in a jar), coordinates (web only, depends on echo), future (needs another SDK,
   * so disabled, with a web folder) and broken (no manifest).
   */
  @BeforeAll
  static void installPlugins() {
    try {
      Path plugins = Files.createDirectories(folder.resolve("plugins"));
      installEcho(plugins);
      Files.createDirectories(plugins.resolve("coordinates/web/assets"));
      Files.writeString(plugins.resolve("coordinates/plugin.json"), """
          {"id": "coordinates", "name": "Coordinates", "version": "0.1.0", "sdkVersion": "^1.0.0", "kind": "utility",
           "category": "map-and-symbols", "icon": "Radar", "dependsOn": ["echo"],
           "symbolPalettes": [{"id": "grid", "name": "Grid", "symbols": [{"standard": "APP-6D", "code": "10031000001211000000"}]}], "provides": ["emc2.coordinates"], "required": true,
           "web": {"entry": "index.js", "css": ["coordinates.css"], "shared": {"react": "19.3.0", "proj4": "2.22.0"}},
           "fields": [{"name": "grid", "type": "boolean", "label": "Grid", "editableByOthers": true}],
           "fieldSets": [{"id": "display", "label": "Display", "fields": ["grid"]}],
           "capabilities": ["temporal"], "compute": {"threads": 3, "reason": "Computes grids."},
           "relationKinds": [{"id": "coordinates.near", "label": "Near", "line": {"strokeColor": "#336699", "arrowhead": "end"}}],
           "settings": {"type": "object", "properties": {"precision": {"type": "integer", "default": 5},
             "grids": {"type": "array", "x-emc2": {"item": {"name": "name", "id": "id"}}, "items": {"type": "object",
               "required": ["id"], "properties": {"id": {"type": "string", "readOnly": true}, "name": {"type": "string"}}}}}}}
          """);
      Files.writeString(plugins.resolve("coordinates/web/index.js"), "export default { activate() {} };");
      Files.writeString(plugins.resolve("coordinates/web/assets/icon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
      Files.createDirectories(plugins.resolve("future/web"));
      Files.writeString(plugins.resolve("future/plugin.json"), """
          {"id": "future", "name": "Future", "version": "0.1.0", "sdkVersion": "^9.0.0", "kind": "general",
           "web": {"entry": "index.js"},
           "settings": {"type": "object", "properties": {"mode": {"type": "string", "default": "x"}}}}
          """);
      Files.writeString(plugins.resolve("future/web/index.js"), "export default {};");
      Files.createDirectories(plugins.resolve("broken"));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /** The echo plugin, with its server part in a jar, into {@code plugins} (also for {@link OidcLoginTest}). */
  static void installEcho(Path plugins) throws IOException {
    Path echo = Files.createDirectories(plugins.resolve("echo/server"));
    Files.writeString(plugins.resolve("echo/plugin.json"), """
        {"id": "echo", "name": "Echo", "version": "0.1.0", "sdkVersion": "^1.2.0", "kind": "general",
         "permissions": ["plugin.echo.run", "plugin.echo.view", "plugin.echo.edit"],
         "workspaces": [{"id": "echo.lab", "name": "Lab", "viewPermission": "plugin.echo.view", "editPermission": "plugin.echo.edit",
                         "order": 7}],
         "internet": {"hosts": ["tiles.example.org"], "reason": "Fetches tiles. Demos only."},
         "server": {"entryClass": "%s"}}
        """.formatted(EchoPlugin.class.getName()));
    writeJar(echo.resolve("echo.jar"));
  }

  /** The compiled classes of the test plugin's package, so they load in the plugin's own class loader. */
  private static void writeJar(Path jar) throws IOException {
    Path classes;
    try {
      classes = Path.of(EchoPlugin.class.getProtectionDomain().getCodeSource().getLocation().toURI());
    } catch (URISyntaxException e) {
      throw new IllegalStateException(e);
    }
    Path packageDir = classes.resolve(EchoPlugin.class.getPackageName().replace('.', '/'));
    try (JarOutputStream out = new JarOutputStream(Files.newOutputStream(jar)); Stream<Path> files = Files.walk(packageDir)) {
      for (Path file : files.filter(Files::isRegularFile).toList()) {
        out.putNextEntry(new JarEntry(classes.relativize(file).toString().replace('\\', '/')));
        Files.copy(file, out);
        out.closeEntry();
      }
    }
  }
}
