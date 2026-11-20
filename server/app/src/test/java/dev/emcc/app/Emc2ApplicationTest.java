package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.tomcat.TomcatWebServer;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles(LoginConfiguration.DEV_PROFILE)
@DirtiesContext // closes this class's server before its temporary folder is deleted
class Emc2ApplicationTest {

  /** Deleted by JUnit after the class, once {@code @DirtiesContext} has closed the server that uses it. */
  @TempDir static Path folder;

  private static final String INDEX_MARKER = "<title>emc2 test page</title>";

  /** The hash of the test page's import map (computed independently, see InlineScriptHashesTest). */
  private static final String IMPORT_MAP_HASH = "'sha256-2P5Kx3Ug543S84JLZBb4pEh2uDAvlcfgYRIm+cuFLSk='";

  private static final HttpClient HTTP =
      HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

  @Autowired private Environment environment;
  @Autowired private ApplicationContext context;

  @DynamicPropertySource
  static void webRoot(DynamicPropertyRegistry registry) {
    registry.add("emc2.web.root", () -> folder.resolve("web").toString());
    registry.add("emc2.data.directory", () -> folder.resolve("data").toString());
  }

  @Test
  void healthReportsThatECoreIsRunning() throws Exception {
    HttpResponse<String> response = get("/api/health");

    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(response.body()).contains("\"status\":\"UP\"").contains("\"ecore\":\"RUNNING\"")
        .as("M9 RC2: a developer run has no version.properties and no manual")
        .contains("\"version\":{\"name\":\"dev\",\"sdk\":\"" + dev.emcc.sdk.Sdk.VERSION + "\"}").contains("\"manual\":false");
    assertThat(get("/manual/").statusCode()).as("no manual folder: 404").isEqualTo(404);
    assertThat(get("/manual/index.html").statusCode()).isEqualTo(404);
  }

  @Test
  void servesTheWebClientAtTheRoot() throws Exception {
    HttpResponse<String> response = get("/");

    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(response.body()).contains(INDEX_MARKER);
  }

  @Test
  void servesOtherWebClientFiles() throws Exception {
    HttpResponse<String> response = get("/assets/app.js");

    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(response.body()).contains("console.log");
  }

  @Test
  void devProfileListensOnlyOnThisMachine() {
    TomcatWebServer server = (TomcatWebServer) ((WebServerApplicationContext) context).getWebServer();
    assertThat(server.getTomcat().getConnector().getProperty("address"))
        .isInstanceOfSatisfying(java.net.InetAddress.class, a -> assertThat(a.isLoopbackAddress()).isTrue());
  }

  @Test
  void stateChangingApiRequestsFromAnotherSitesPageAreRefused() throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder post = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/config"))
        .timeout(Duration.ofSeconds(10)).POST(HttpRequest.BodyPublishers.noBody());

    HttpResponse<String> refused = HTTP.send(post.copy().header("Origin", "http://evil.example").build(), HttpResponse.BodyHandlers.ofString());
    assertThat(refused.statusCode()).isEqualTo(403);
    assertThat(refused.headers().firstValue("Content-Security-Policy")).as("the security headers come first, refusals carry them")
        .hasValueSatisfying(csp -> assertThat(csp).startsWith("default-src 'self'"));
    assertThat(HTTP.send(post.copy().header("Origin", "http://127.0.0.1:" + port).build(), HttpResponse.BodyHandlers.ofString())
        .statusCode()).as("own origin: reaches the application, which has no POST here").isEqualTo(405);
  }

  @Test
  void unknownPathsGive404() throws Exception {
    assertThat(get("/does-not-exist.js").statusCode()).isEqualTo(404);
  }

  @Test
  void everyAnswerCarriesAContentSecurityPolicyThatAllowsOnlyThisServer() throws Exception {
    for (String path : List.of("/", "/assets/app.js", "/api/health", "/does-not-exist.js")) {
      HttpResponse<String> response = get(path);
      assertThat(response.headers().firstValue("Content-Security-Policy")).as(path)
          .hasValueSatisfying(csp -> assertThat(csp).startsWith("default-src 'self'").contains("script-src 'self'")
              .contains("connect-src 'self'").contains("object-src 'none'").contains("frame-ancestors 'none'")
              .contains("worker-src 'self' blob:; media-src 'self' blob:;") // CR-0046: live video's MediaSource
              .doesNotContain("http").doesNotContain("*"));
      assertThat(response.headers().firstValue("Content-Security-Policy")).as(path)
          .hasValueSatisfying(csp -> assertThat(csp).contains("script-src 'self' " + IMPORT_MAP_HASH + ";"));
      assertThat(response.headers().firstValue("X-Content-Type-Options")).as(path).hasValue("nosniff");
      assertThat(response.headers().firstValue("Referrer-Policy")).as(path).hasValue("no-referrer");
    }
  }

  @Test
  void theConfigNamesTheDefaultLabelTheLoginModeAndTheUser() throws Exception {
    HttpResponse<String> response = get("/api/config");

    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(response.body())
        .isEqualTo("{\"defaultLabel\":{\"policyIdentifier\":{\"name\":\"NATO\"},\"classification\":\"UNCLASSIFIED\"},"
            + "\"loginMode\":\"none\",\"user\":{\"id\":\"local\",\"name\":\"Local user\",\"permissions\":[],\"noLogin\":true},"
            + "\"dataTypes\":[{\"id\":\"core.general\",\"name\":\"General\","
            + "\"description\":\"The built-in data type, for everything without a more specific one.\",\"declaredBy\":null,\"fieldSets\":[],\"manual\":true,\"sensorReport\":false,"
            + "\"defaults\":{\"fadeWhenExpired\":false},\"behaviour\":{\"fadeWhenExpired\":false}}],"
            + "\"classificationOrders\":{\"NATO\":[\"UNCLASSIFIED\",\"RESTRICTED\",\"CONFIDENTIAL\",\"SECRET\",\"COSMIC TOP SECRET\"]},"
            + "\"defaultLook\":\"night-watch\",\"declaredFields\":[],"
            + "\"workspaces\":[{\"id\":\"core.view\",\"name\":\"View\",\"order\":-2147483648}],\"fieldSets\":[],\"relationKinds\":[],"
            + "\"labelFormat\":{\"fieldSeparator\":\" · \",\"releasableToSeparator\":\", \",\"releasableToPrefix\":\"REL TO\"},"
            + "\"labelDefinitions\":" + new LabelingDefinitions("").json() + "}");
  }

  @Test
  void hashedAssetsAreCachedForAYearEverythingElseIsRevalidated() throws Exception {
    assertThat(get("/assets/app.js").headers().firstValue("Cache-Control")).hasValue("max-age=31536000, public, immutable");
    assertThat(get("/").headers().firstValue("Cache-Control")).hasValue("no-cache");
    assertThat(get("/index.html").headers().firstValue("Cache-Control")).hasValue("no-cache");
    assertThat(get("/api/health").headers().firstValue("Cache-Control")).hasValue("no-store");
  }

  @Test
  void textAnswersAreCompressedForClientsThatAcceptIt() throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/assets/big.js"))
        .header("Accept-Encoding", "gzip").timeout(Duration.ofSeconds(10)).build();

    HttpResponse<byte[]> response = HTTP.send(request, HttpResponse.BodyHandlers.ofByteArray());

    assertThat(response.headers().firstValue("Content-Encoding")).hasValue("gzip");
    try (var in = new java.util.zip.GZIPInputStream(new java.io.ByteArrayInputStream(response.body()))) {
      assertThat(new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)).startsWith("console.log('emc2');");
    }
  }

  private HttpResponse<String> get(String path) throws IOException, InterruptedException {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest request =
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
            .timeout(Duration.ofSeconds(10))
            .build();
    return HTTP.send(request, HttpResponse.BodyHandlers.ofString());
  }

  /** The web client's files, written before the server starts. */
  @BeforeAll
  static void createWebRoot() throws IOException {
    Path root = Files.createDirectories(folder.resolve("web"));
    Files.writeString(root.resolve("index.html"), "<!doctype html>" + INDEX_MARKER
        + "<script type=\"importmap\">{\"imports\":{\"a\":\"/assets/app.js\"}}</script>");
    Files.createDirectories(root.resolve("assets"));
    Files.writeString(root.resolve("assets/app.js"), "console.log('emc2');");
    Files.writeString(root.resolve("assets/big.js"), "console.log('emc2');\n".repeat(1_000));
  }
}
