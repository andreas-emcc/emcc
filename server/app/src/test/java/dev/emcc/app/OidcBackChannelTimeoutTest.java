package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * A hung IAM does not hold the back-channel logout for ever (security review R1): Spring Security
 * reads the IAM's keys for logout tokens with a client of its own, which gets the JDK's default
 * timeouts that {@link Emc2Application#defaultTimeouts()} sets (2 s in the tests, from the POM). A
 * class of its own, so that its server has not read the keys yet.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext // closes this class's server before its temporary folder is deleted
class OidcBackChannelTimeoutTest {

  @TempDir static Path folder;

  private static final FakeIam IAM = new FakeIam();

  @Autowired private Environment environment;

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

  @Test
  void aLogoutWhileTheIamsKeysDoNotComeEndsWithinTheTimeoutAndTheSessionStays() throws Exception {
    HttpClient browser = HttpClient.newBuilder().cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL))
        .followRedirects(HttpClient.Redirect.NEVER).build();
    String base = "http://127.0.0.1:" + environment.getRequiredProperty("local.server.port");
    String start = browser.send(HttpRequest.newBuilder(URI.create(base + "/")).header("Accept", "text/html").build(),
        HttpResponse.BodyHandlers.ofString()).headers().firstValue("Location").orElseThrow();
    String toIam = browser.send(HttpRequest.newBuilder(URI.create(start.startsWith("http") ? start : base + start)).build(),
        HttpResponse.BodyHandlers.ofString()).headers().firstValue("Location").orElseThrow();
    Map<String, String> authorization = FakeIam.form(URI.create(toIam).getRawQuery());
    String code = IAM.logIn(authorization, new FakeIam.Person("u-carol", "carol", List.of()));
    browser.send(HttpRequest.newBuilder(URI.create(authorization.get("redirect_uri") + "?code=" + code + "&state="
        + java.net.URLEncoder.encode(authorization.get("state"), StandardCharsets.UTF_8))).build(), HttpResponse.BodyHandlers.ofString());
    assertThat(browser.send(HttpRequest.newBuilder(URI.create(base + "/api/config")).build(), HttpResponse.BodyHandlers.ofString())
        .statusCode()).isEqualTo(200);

    IAM.keysDelayMillis = 5_000;
    long t0 = System.nanoTime();
    HttpResponse<String> answer = HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(base + "/logout/connect/back-channel/emc2"))
        .header("Content-Type", "application/x-www-form-urlencoded").timeout(Duration.ofSeconds(15))
        .POST(HttpRequest.BodyPublishers.ofString("logout_token=" + IAM.logoutToken("u-carol"))).build(), HttpResponse.BodyHandlers.ofString());
    Duration took = Duration.ofNanos(System.nanoTime() - t0);
    IAM.keysDelayMillis = 0;

    assertThat(took).as("ended by the 2 s read timeout, not by the IAM's 5 s").isLessThan(Duration.ofSeconds(5));
    assertThat(answer.statusCode()).isNotEqualTo(200);
    assertThat(browser.send(HttpRequest.newBuilder(URI.create(base + "/api/config")).build(), HttpResponse.BodyHandlers.ofString())
        .statusCode()).as("the session stays: the token could not be checked").isEqualTo(200);
  }
}
