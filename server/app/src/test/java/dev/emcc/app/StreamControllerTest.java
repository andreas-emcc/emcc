package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The stream channel over HTTP (SDK 1.8.0, CR-0044 E1; T-208), with the echo test plugin's stream
 * {@code feed}: {@code 200} at once from the last start point, then live; the limits; {@code 404}
 * and {@code 405}; the monitor's counters. The no-login mode's user has every permission, so {@code
 * 403} is ECore's ({@code StreamHubTest}); {@code 401} is checked on the controller alone.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles(LoginConfiguration.DEV_PROFILE)
@DirtiesContext // closes this class's server before its temporary folder is deleted
class StreamControllerTest {

  @TempDir static Path folder;

  private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

  @Autowired private Environment environment;
  @Autowired private ECoreLifecycle ecore;
  @Autowired private LoginSessions loginSessions;

  @DynamicPropertySource
  static void folders(DynamicPropertyRegistry registry) {
    registry.add("emc2.plugins.directory", () -> folder.resolve("plugins").toString());
    registry.add("emc2.data.directory", () -> folder.resolve("data").toString());
    registry.add("emc2.streams.viewers-per-stream", () -> "2");
  }

  @BeforeAll
  static void installPlugins() {
    try {
      PluginControllerTest.installEcho(Files.createDirectories(folder.resolve("plugins")));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  @Test
  void aViewerGetsTheStreamAtOnceFromItsLastStartPointThenTheLiveChunks() throws Exception {
    assertThat(feed("x", false)).isEqualTo(204);
    assertThat(feed("A", true)).isEqualTo(204);
    assertThat(feed("a", false)).isEqualTo(204);

    HttpResponse<InputStream> viewer = open("/api/plugins/echo/stream/feed");
    try (InputStream body = viewer.body()) {
      assertThat(viewer.statusCode()).isEqualTo(200);
      assertThat(viewer.headers().firstValue("Content-Type")).hasValue("video/mp2t");
      assertThat(viewer.headers().firstValue("Cache-Control")).hasValue("no-store");
      assertThat(viewer.headers().firstValue("X-Content-Type-Options")).hasValue("nosniff");
      assertThat(viewer.headers().firstValue("Content-Length")).as("endless, chunked").isEmpty();
      assertThat(read(body, 3)).as("the header, then the chunks since the last start point").isEqualTo("HAa");
      assertThat(feed("B", true)).isEqualTo(204);
      assertThat(feed("b", false)).isEqualTo(204);
      assertThat(read(body, 2)).as("then the live chunks").isEqualTo("Bb");

      JsonNode stream = monitorStream();
      assertThat(stream.get("name").asString()).isEqualTo("feed");
      assertThat(stream.get("mediaType").asString()).isEqualTo("video/mp2t");
      assertThat(stream.get("viewers").asInt()).isEqualTo(1);
      assertThat(stream.get("bytesIn").asLong()).isGreaterThanOrEqualTo(5);
      assertThat(stream.get("bytesOut").asLong()).isGreaterThanOrEqualTo(5);
      assertThat(stream.get("startBufferBytes").asLong()).isEqualTo(2);
    }
    awaitViewers(0); // the browser went away: its next write fails and it leaves
  }

  @Test
  void pastTheViewersOfAStreamOneMoreGets503WithRetryAfter() throws Exception {
    List<HttpResponse<InputStream>> viewers = new ArrayList<>();
    try {
      for (int i = 0; i < 2; i++) {
        viewers.add(open("/api/plugins/echo/stream/feed"));
        assertThat(viewers.getLast().statusCode()).isEqualTo(200);
      }
      awaitViewers(2);
      HttpResponse<String> busy = HTTP.send(request("/api/plugins/echo/stream/feed").GET().build(), HttpResponse.BodyHandlers.ofString());
      assertThat(busy.statusCode()).isEqualTo(503);
      assertThat(busy.headers().firstValue("Retry-After")).hasValue("5");
    } finally {
      for (HttpResponse<InputStream> v : viewers) {
        v.body().close();
      }
    }
    awaitViewers(0);
    HttpResponse<InputStream> again = open("/api/plugins/echo/stream/feed");
    try (InputStream body = again.body()) {
      assertThat(again.statusCode()).as("a freed place is taken again").isEqualTo(200);
    }
    awaitViewers(0);
  }

  @Test
  void anUnknownStreamIs404AndOnlyGetIsServed() throws Exception {
    for (String path : List.of("/api/plugins/echo/stream/nope", "/api/plugins/nobody/stream/feed", "/api/plugins/echo/stream",
        "/api/plugins/echo/stream/", "/api/plugins/echo/stream/feed/more")) {
      assertThat(HTTP.send(request(path).GET().build(), HttpResponse.BodyHandlers.ofString()).statusCode()).as(path).isEqualTo(404);
    }
    HttpResponse<String> post = HTTP.send(request("/api/plugins/echo/stream/feed").header("Origin", self()).header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString("\"x\"")).build(), HttpResponse.BodyHandlers.ofString());
    assertThat(post.statusCode()).isEqualTo(405);
    assertThat(post.headers().firstValue("Allow")).hasValue("GET");
    HttpResponse<String> head = HTTP.send(request("/api/plugins/echo/stream/feed").method("HEAD", HttpRequest.BodyPublishers.noBody()).build(),
        HttpResponse.BodyHandlers.ofString());
    assertThat(head.statusCode()).isEqualTo(405);
  }

  @Test
  void withoutALoginAStreamIs401() throws Exception {
    CurrentUser oidc = new CurrentUser(LoginMode.OIDC, new org.springframework.beans.factory.support.StaticListableBeanFactory()
        .getBeanProvider(OidcProperties.class));
    StreamController controller = new StreamController(ecore, oidc, loginSessions);
    MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/plugins/echo/stream/feed");
    MockHttpServletResponse response = new MockHttpServletResponse();
    controller.stream("echo", "feed", request, response);
    assertThat(response.getStatus()).isEqualTo(401);
    assertThat(ecore.core().plugins().streams().viewers()).isZero();
  }

  @Test
  void aLoggedInUserWithoutTheStreamsPermissionGets403() throws Exception {
    java.util.Map<String, Object> claims = java.util.Map.of("sub", "u-7", "groups", java.util.List.of("watchers"));
    org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser login = new org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser(
        java.util.List.of(), new org.springframework.security.oauth2.core.oidc.OidcIdToken("t", java.time.Instant.now(),
            java.time.Instant.now().plusSeconds(60), claims));
    org.springframework.beans.factory.support.StaticListableBeanFactory beans = new org.springframework.beans.factory.support.StaticListableBeanFactory();
    beans.addBean("oidc", new OidcProperties("http://iam", "c", "s", List.of("openid"), "groups",
        java.util.Map.of("plugin.echo.run", List.of("watchers")), "{baseUrl}/logout")); // run, but not view
    StreamController controller = new StreamController(ecore, new CurrentUser(LoginMode.OIDC, beans.getBeanProvider(OidcProperties.class)),
        loginSessions);
    MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/plugins/echo/stream/feed");
    request.setUserPrincipal(new org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken(
        login, java.util.List.of(), "emc2"));
    MockHttpServletResponse response = new MockHttpServletResponse();
    controller.stream("echo", "feed", request, response);
    assertThat(response.getStatus()).isEqualTo(403);
    assertThat(ecore.core().plugins().streams().viewers()).isZero();
  }

  private int feed(String text, boolean start) throws Exception {
    return HTTP.send(request("/api/plugins/echo/feed?start=" + start).header("Origin", self()).header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString("\"" + text + "\"")).build(), HttpResponse.BodyHandlers.discarding()).statusCode();
  }

  private HttpResponse<InputStream> open(String path) throws Exception {
    return HTTP.send(request(path).GET().build(), HttpResponse.BodyHandlers.ofInputStream());
  }

  /** Reads {@code n} bytes within 10 s. */
  private static String read(InputStream body, int n) throws Exception {
    return CompletableFuture.supplyAsync(() -> {
      try {
        return new String(body.readNBytes(n), StandardCharsets.UTF_8);
      } catch (IOException e) {
        throw new UncheckedIOException(e);
      }
    }).get(10, TimeUnit.SECONDS);
  }

  /** Waits until the stream has {@code n} viewers, feeding it so that a gone browser's write fails. */
  private void awaitViewers(int n) throws Exception {
    long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (ecore.core().plugins().streams().viewers() != n) {
      assertThat(System.nanoTime()).as("viewers: " + n).isLessThan(until);
      feed("z", false);
      Thread.sleep(20);
    }
  }

  private JsonNode monitorStream() throws Exception {
    JsonNode monitor = JsonMapper.builder().build().readTree(
        HTTP.send(request("/api/monitor").GET().build(), HttpResponse.BodyHandlers.ofString()).body());
    for (JsonNode p : monitor.get("plugins")) {
      if (p.get("id").asString().equals("echo")) {
        assertThat(p.get("streams").size()).isEqualTo(1);
        return p.get("streams").get(0);
      }
    }
    throw new AssertionError("no plugin echo");
  }

  private String self() {
    return "http://127.0.0.1:" + environment.getRequiredProperty("local.server.port");
  }

  private HttpRequest.Builder request(String path) {
    return HttpRequest.newBuilder(URI.create(self() + path)).timeout(Duration.ofSeconds(10));
  }
}
