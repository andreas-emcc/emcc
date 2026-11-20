package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Login behind a reverse proxy that ends TLS (T-036): the browser sees https://emc2.example, the
 * server is reached over plain HTTP from the proxy on 127.0.0.1. The login's callback is the public
 * address, the session cookie is Secure, and the live picture opens through the proxy.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "server.forward-headers-strategy=native",
    "server.tomcat.remoteip.internal-proxies=127\\.0\\.0\\.1",
    "emc2.allowed-hosts=emc2.example"})
@DirtiesContext // closes this class's server before its temporary folder is deleted
class OidcBehindProxyTest {

  private static final String PUBLIC = "https://emc2.example";

  @TempDir static Path folder;

  private static final FakeIam IAM = new FakeIam();

  @Autowired private Environment environment;
  private final HttpClient proxy = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();
  private String cookie = "";
  private WebSocket socket;

  @DynamicPropertySource
  static void login(DynamicPropertyRegistry registry) {
    registry.add("emc2.login.mode", () -> "oidc");
    registry.add("emc2.login.oidc.issuer-uri", IAM::issuer);
    registry.add("emc2.login.oidc.client-id", () -> FakeIam.CLIENT_ID);
    registry.add("emc2.login.oidc.client-secret", () -> FakeIam.CLIENT_SECRET);
    registry.add("emc2.data.directory", () -> folder.toString());
  }

  @AfterAll
  static void stopIam() {
    IAM.close();
  }

  @AfterEach
  void closeSocket() {
    if (socket != null) {
      socket.abort();
    }
  }

  @Test
  void theLoginUsesThePublicAddressAndTheCookieIsSecure() throws Exception {
    HttpResponse<String> page = viaProxy("/", "text/html");
    assertThat(page.headers().firstValue("Location")).hasValue(PUBLIC + "/oauth2/authorization/emc2");
    HttpResponse<String> start = viaProxy("/oauth2/authorization/emc2", "text/html");
    String toIam = start.headers().firstValue("Location").orElseThrow();
    Map<String, String> authorization = FakeIam.form(URI.create(toIam).getRawQuery());
    assertThat(authorization.get("redirect_uri")).isEqualTo(PUBLIC + "/login/oauth2/code/emc2");

    String code = IAM.logIn(authorization, new FakeIam.Person("u-bob", "bob", List.of()));
    HttpResponse<String> back = viaProxy("/login/oauth2/code/emc2?code=" + code + "&state="
        + java.net.URLEncoder.encode(authorization.get("state"), StandardCharsets.UTF_8), "text/html");

    assertThat(back.statusCode()).as(back.body()).isEqualTo(302);
    assertThat(back.headers().allValues("Set-Cookie")).anySatisfy(c -> assertThat(c).startsWith("JSESSIONID=")
        .contains("Secure").contains("HttpOnly").contains("SameSite=Lax"));
    HttpResponse<String> config = viaProxy("/api/config", "application/json");
    assertThat(config.statusCode()).isEqualTo(200);
    assertThat(config.body()).contains("\"id\":\"u-bob\"");

    LiveWebSocketTest.Received received = new LiveWebSocketTest.Received();
    socket = HttpClient.newHttpClient().newWebSocketBuilder().header("Cookie", cookie).header("Origin", PUBLIC)
        .header("X-Forwarded-For", "192.0.2.10").header("X-Forwarded-Proto", "https").header("X-Forwarded-Host", "emc2.example")
        .header("X-Forwarded-Port", "443")
        .buildAsync(URI.create("ws://127.0.0.1:" + port() + LiveWebSocketHandler.PATH), received).get(10, TimeUnit.SECONDS);
    assertThat(received.next("welcome").get("protocol").asInt()).isEqualTo(2);
  }

  /** A request as the proxy forwards it; keeps the session cookie (Secure, so sent by hand). */
  private HttpResponse<String> viaProxy(String path, String accept) throws Exception {
    HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port() + path)).timeout(Duration.ofSeconds(10))
        .header("Accept", accept).header("X-Forwarded-For", "192.0.2.10").header("X-Forwarded-Proto", "https")
        .header("X-Forwarded-Host", "emc2.example").header("X-Forwarded-Port", "443");
    if (!cookie.isEmpty()) {
      request.header("Cookie", cookie);
    }
    HttpResponse<String> response = proxy.send(request.GET().build(), HttpResponse.BodyHandlers.ofString());
    response.headers().allValues("Set-Cookie").stream().filter(c -> c.startsWith("JSESSIONID="))
        .forEach(c -> cookie = c.substring(0, c.indexOf(';')));
    return response;
  }

  private String port() {
    return environment.getRequiredProperty("local.server.port");
  }
}
