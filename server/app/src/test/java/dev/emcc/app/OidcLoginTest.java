package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import java.io.IOException;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.net.http.WebSocketHandshakeException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;

/**
 * Login with OpenID Connect end to end (ADR-0022), against {@link FakeIam} in place of Keycloak:
 * the Authorization Code flow with PKCE as a confidential client, the session cookie, the live
 * picture's user, and the three ways a login session ends (logout, the IAM's back-channel logout,
 * a refused renewal), each of which closes the user's live picture with {@code 4401}.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext // closes this class's server before its temporary folder is deleted
class OidcLoginTest {

  @TempDir static Path folder;

  private static final FakeIam IAM = new FakeIam();
  private static final ModelJson JSON = new ModelJson();
  private static final FakeIam.Person ALICE = new FakeIam.Person("u-alice-7f3c", "alice", List.of("editors"));
  private static final FakeIam.Person LENA = new FakeIam.Person("u-lena-2b81", "lena", List.of("lab"));
  private static final FakeIam.Person ROB = new FakeIam.Person("u-rob-51d0", "rob", List.of("runners"));

  @Autowired private Environment environment;
  @Autowired private LoginRenewal renewal;
  /** One browser: its own cookies, no automatic redirects. */
  private HttpClient browser;
  private CookieManager cookies;
  private WebSocket socket;

  @DynamicPropertySource
  static void login(DynamicPropertyRegistry registry) {
    registry.add("emc2.login.mode", () -> "oidc");
    registry.add("emc2.login.oidc.issuer-uri", IAM::issuer);
    registry.add("emc2.login.oidc.client-id", () -> FakeIam.CLIENT_ID);
    registry.add("emc2.login.oidc.client-secret", () -> FakeIam.CLIENT_SECRET);
    registry.add("emc2.login.oidc.permissions[objects.edit]", () -> "editors");
    registry.add("emc2.login.oidc.permissions[settings.admin]", () -> "admins");
    registry.add("emc2.login.oidc.permissions[plugin.echo.view]", () -> "lab");
    registry.add("emc2.login.oidc.permissions[plugin.echo.run]", () -> "runners");
    registry.add("emc2.data.directory", () -> folder.toString());
    registry.add("emc2.plugins.directory", () -> folder.resolve("plugins").toString());
    registry.add("emc2.release.directory", () -> folder.resolve("release").toString());
  }

  /** The echo plugin, whose POST endpoint needs plugin.echo.run (CR-0026). */
  @BeforeAll
  static void installPlugins() throws IOException {
    PluginControllerTest.installEcho(Files.createDirectories(folder.resolve("plugins")));
    Files.writeString(Files.createDirectories(folder.resolve("release").resolve("manual")).resolve("index.html"),
        "<!doctype html><title>emcc user manual</title>");
    Files.writeString(folder.resolve("release").resolve("version.properties"), "emcc.version=M9-test\n");
  }

  @AfterAll
  static void stopIam() {
    IAM.close();
  }

  @BeforeEach
  void newBrowser() {
    IAM.accessTokenSeconds = 300;
    IAM.refuseRefresh = false;
    IAM.failing = false;
    renewal.outagePause = Duration.ZERO;
    cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
    browser = HttpClient.newBuilder().cookieHandler(cookies).followRedirects(HttpClient.Redirect.NEVER)
        .connectTimeout(Duration.ofSeconds(5)).build();
  }

  @AfterEach
  void closeSocket() {
    if (socket != null) {
      socket.abort();
    }
  }

  // ---- Not logged in ----------------------------------------------------------------------------

  @Test
  void withoutLoginAPageGoesToTheIamTheApiAnswers401AndHealthStaysOpen() throws Exception {
    HttpResponse<String> page = page("/");
    assertThat(page.statusCode()).isEqualTo(302);
    assertThat(page.headers().firstValue("Location")).hasValueSatisfying(l -> assertThat(l).endsWith("/oauth2/authorization/emc2"));

    assertThat(get("/api/config").statusCode()).isEqualTo(401);
    assertThat(get("/api/plugins").statusCode()).isEqualTo(401);
    assertThat(send(HttpRequest.newBuilder(uri("/api/config")).header("Accept", "text/html").GET()).statusCode())
        .as("the API never redirects, even when asked for HTML").isEqualTo(401);
    assertThat(get("/api/health").statusCode()).isEqualTo(200);
    assertThat(get("/api/health").body()).contains("\"manual\":true");
    HttpResponse<String> manual = page("/manual/");
    assertThat(manual.statusCode()).as("M9 RC2: the manual is open without login").isEqualTo(200);
    assertThat(manual.body()).contains("emcc user manual");
    assertThat(manual.headers().firstValue("Content-Security-Policy")).as("under the shell's CSP").isPresent();
    assertThat(page("/manual").statusCode()).as("to /manual/").isIn(301, 302);
    assertThat(send(HttpRequest.newBuilder(uri("/manual/index.html")).method("HEAD", HttpRequest.BodyPublishers.noBody())).statusCode())
        .isEqualTo(200);
    assertThat(send(HttpRequest.newBuilder(uri("/manual/index.html")).header("Origin", base()).POST(HttpRequest.BodyPublishers.noBody()))
        .statusCode()).as("GET and HEAD only").isNotEqualTo(200);
    for (String outside : List.of("/manual/../version.properties", "/manual/..%2Fversion.properties", "/manual/%2e%2e/version.properties")) {
      HttpResponse<String> escape = page(outside);
      assertThat(escape.body()).as("nothing outside manual/: " + outside).doesNotContain("emcc.version");
      assertThat(escape.statusCode()).as(outside).isNotEqualTo(200);
    }
    assertThatThrownBy(() -> openLivePicture(true)).satisfies(e -> assertThat(handshakeStatus(e)).isEqualTo(401));
  }

  @Test
  void theServiceEndpointsStayOpenWithoutALoginAndStartNoSession() throws Exception { // SDK 1.6.0, ADR-0055 point 5.3
    HttpResponse<String> service = get("/api/services/nvg/nvg/north");

    assertThat(service.statusCode()).as("ECore's answer, not the login's 401: no such plugin here").isEqualTo(404);
    assertThat(service.body()).isEqualTo("no plugin nvg");
    assertThat(service.headers().allValues("Set-Cookie")).isEmpty();
    assertThat(cookies.getCookieStore().getCookies()).isEmpty();
  }

  // ---- Logging in -------------------------------------------------------------------------------

  @Test
  void aLoginRunsTheCodeFlowWithPkceAndLeavesOnlyAnHttpOnlyLaxSessionCookie() throws Exception {
    Map<String, String> authorization = logIn(ALICE);

    assertThat(authorization).containsKeys("state", "nonce", "redirect_uri").containsEntry("code_challenge_method", "S256");
    assertThat(authorization.get("code_challenge")).isNotBlank();
    assertThat(authorization.get("scope")).contains("openid");
    Map<String, String> tokenRequest = IAM.tokenRequests.getLast();
    assertThat(tokenRequest).containsEntry("grant_type", "authorization_code").containsKey("code_verifier");
    assertThat(FakeIam.s256(tokenRequest.get("code_verifier"))).isEqualTo(authorization.get("code_challenge"));

    assertThat(cookies.getCookieStore().getCookies()).singleElement()
        .satisfies(c -> assertThat(c.getName()).isEqualTo("JSESSIONID"))
        .satisfies(c -> assertThat(c.isHttpOnly()).isTrue())
        .satisfies(c -> assertThat(c.getSecure()).as("plain HTTP here; Tomcat adds Secure over HTTPS").isFalse());
    HttpResponse<String> config = get("/api/config");
    assertThat(config.statusCode()).isEqualTo(200);
    JsonNode body = JSON.parse(config.body());
    assertThat(body.get("loginMode").asString()).isEqualTo("oidc");
    assertThat(body.get("user").get("id").asString()).isEqualTo(ALICE.sub());
    assertThat(body.get("user").get("name").asString()).isEqualTo("alice");
    assertThat(config.body()).as("no token reaches the browser").doesNotContain("token").doesNotContain("eyJ");
  }

  @Test
  void theSessionCookieIsSameSiteLax() throws Exception {
    List<String> setCookies = logInRaw(ALICE);
    assertThat(setCookies).anySatisfy(c -> assertThat(c).startsWith("JSESSIONID=").contains("HttpOnly").contains("SameSite=Lax"));
  }

  // ---- The live picture -------------------------------------------------------------------------

  @Test
  void theLivePictureBelongsToTheLoggedInUserAndNeedsAnOrigin() throws Exception {
    logIn(ALICE);
    assertThatThrownBy(() -> openLivePicture(false)).satisfies(e -> assertThat(handshakeStatus(e)).as("the cookie alone does not open it").isEqualTo(403));

    LiveWebSocketTest.Received received = openLivePicture(true);
    assertThat(received.next("welcome").get("protocol").asInt()).isEqualTo(2);
    socket.sendText("{\"type\":\"subscribe\",\"subscription\":\"all\"}", true).get(10, TimeUnit.SECONDS);
    JsonNode layer = received.next("snapshot-begin").get("layers").get(0);
    received.next("snapshot-end");
    MapObjectContent symbol = new MapObjectContent(MapObjectContent.SYMBOL, MapObjectContent.GENERAL, MapObjectContent.MANUAL, null,
        UUID.fromString(layer.get("id").asString()),
        new Geometry.Point(Position.of(15.6, 60.1)), new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null), null,
        null, SecurityLabel.of("NATO", "UNCLASSIFIED"), Extensions.empty());
    ChangeRequest request = ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), symbol, new Actor("draw-symbols", "mallory", null));
    socket.sendText("{\"type\":\"change-request\",\"request\":" + JSON.write(request) + "}", true).get(10, TimeUnit.SECONDS);

    JsonNode outcome = received.next("change-outcome");
    assertThat(outcome.get("outcome").asString()).as(outcome.toString()).isEqualTo("applied");
    assertThat(outcome.get("event").get("by").get("user").asString()).as("the login's sub, not what the browser sent")
        .isEqualTo(ALICE.sub());
  }

  @Test
  void aChangeRequestNeedsTheLoginsPermissionWhateverTheBrowserSays() throws Exception {
    logIn(new FakeIam.Person("u-carol", "carol", List.of("admins"))); // settings.admin only
    LiveWebSocketTest.Received received = openLivePicture(true);
    received.next("welcome");
    socket.sendText("{\"type\":\"subscribe\",\"subscription\":\"all\"}", true).get(10, TimeUnit.SECONDS);
    UUID layerId = UUID.fromString(received.next("snapshot-begin").get("layers").get(0).get("id").asString());
    received.next("snapshot-end");

    ChangeRequest symbol = ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(), symbolIn(layerId), new Actor("draw-symbols", "alice", null));
    JsonNode outcome = changeRequest(symbol, received);
    assertThat(outcome.get("rejection").get("code").asString()).as(outcome.toString()).isEqualTo("PERMISSION_DENIED");
    assertThat(outcome.get("rejection").get("message").asString()).isEqualTo("changing an object needs the permission objects.edit");
    socket.abort();

    cookies.getCookieStore().removeAll();
    logIn(ALICE); // objects.edit, not layers.edit
    received = openLivePicture(true);
    received.next("welcome");
    assertThat(changeRequest(symbol, received).get("outcome").asString()).as("the same request").isEqualTo("applied");
    ChangeRequest layer = ChangeRequest.create(UUID.randomUUID(), UUID.randomUUID(),
        new LayerContent("Alice's", 1, true, SecurityLabel.of("NATO", "UNCLASSIFIED"), Extensions.empty()), Actor.plugin("layer-panel"));
    outcome = changeRequest(layer, received);
    assertThat(outcome.get("rejection").get("code").asString()).as(outcome.toString()).isEqualTo("PERMISSION_DENIED");
    assertThat(outcome.get("rejection").get("message").asString()).isEqualTo("changing a layer needs the permission layers.edit");

    // The picture as the other tests expect it: without the symbol.
    ChangeRequest delete = ChangeRequest.delete(UUID.randomUUID(), symbol.entityType(), symbol.entityId(), null, Actor.plugin("draw-symbols"));
    assertThat(changeRequest(delete, received).get("outcome").asString()).isEqualTo("applied");
  }

  private JsonNode changeRequest(ChangeRequest request, LiveWebSocketTest.Received received) throws Exception {
    socket.sendText("{\"type\":\"change-request\",\"request\":" + JSON.write(request) + "}", true).get(10, TimeUnit.SECONDS);
    JsonNode outcome = received.next("change-outcome");
    assertThat(outcome.get("requestId").asString()).isEqualTo(request.requestId().toString());
    return outcome;
  }

  private static MapObjectContent symbolIn(UUID layerId) {
    return new MapObjectContent(MapObjectContent.SYMBOL, MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, layerId,
        new Geometry.Point(Position.of(15.6, 60.1)), new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null), null,
        null, SecurityLabel.of("NATO", "UNCLASSIFIED"), Extensions.empty());
  }

  @Test
  void aPageOfAnotherSiteCannotOpenTheLivePictureWithTheUsersCookie() throws Exception {
    logIn(ALICE);
    assertThatThrownBy(() -> openLivePicture("http://evil.example"))
        .satisfies(e -> assertThat(handshakeStatus(e)).isEqualTo(403));
  }

  @Test
  void aLoginThatFailsAtTheIamShowsAPageInsteadOfGoingBackToTheIam() throws Exception {
    String start = page("/").headers().firstValue("Location").orElseThrow();
    String toIam = send(HttpRequest.newBuilder(URI.create(start).isAbsolute() ? URI.create(start) : uri(start)).GET())
        .headers().firstValue("Location").orElseThrow();
    Map<String, String> authorization = FakeIam.form(URI.create(toIam).getRawQuery());

    // The user cancels at the IAM.
    HttpResponse<String> back = send(HttpRequest.newBuilder(URI.create(authorization.get("redirect_uri") + "?error=access_denied&state="
        + java.net.URLEncoder.encode(authorization.get("state"), java.nio.charset.StandardCharsets.UTF_8))).GET());

    assertThat(back.statusCode()).isEqualTo(401);
    assertThat(back.headers().firstValue("Location")).isEmpty();
    assertThat(back.body()).contains("<title>emcc: login failed</title>").contains("The login did not succeed (access_denied)")
        .contains("<a href=\"/\">Try again</a>");
  }

  // ---- The end of a login session ---------------------------------------------------------------

  @Test
  void theShellsLogoutGetsTheIamsLogoutAddressToNavigateTo() throws Exception {
    // A form post answered with a redirect to the IAM would be blocked by form-action 'self' (B1).
    logIn(ALICE);
    LiveWebSocketTest.Received received = openLivePicture(true);
    received.next("welcome");

    HttpResponse<String> logout = send(HttpRequest.newBuilder(uri("/logout")).header("Origin", base())
        .header("Accept", "application/json").POST(HttpRequest.BodyPublishers.noBody()));

    assertThat(logout.statusCode()).isEqualTo(200);
    assertThat(logout.headers().firstValue("Location")).isEmpty();
    assertThat(JSON.parse(logout.body()).get("redirect").asString()).startsWith(IAM.issuer() + "/logout?")
        .contains("id_token_hint=").contains("post_logout_redirect_uri=");
    assertThat(received.closed.get(10, TimeUnit.SECONDS)).isEqualTo("4401 login session ended");
    assertThat(get("/api/config").statusCode()).isEqualTo(401);
  }

  @Test
  void logoutEndsTheSessionHereAndAtTheIamAndClosesTheLivePicture() throws Exception {
    logIn(ALICE);
    LiveWebSocketTest.Received received = openLivePicture(true);
    received.next("welcome");

    HttpResponse<String> crossSite = send(HttpRequest.newBuilder(uri("/logout")).header("Origin", "http://evil.example")
        .POST(HttpRequest.BodyPublishers.noBody()));
    assertThat(crossSite.statusCode()).as("logout from another site's page").isEqualTo(403);
    assertThat(get("/api/config").statusCode()).as("still logged in").isEqualTo(200);

    HttpResponse<String> logout = send(HttpRequest.newBuilder(uri("/logout")).header("Origin", base())
        .POST(HttpRequest.BodyPublishers.noBody()));

    assertThat(logout.statusCode()).isEqualTo(302);
    assertThat(logout.headers().firstValue("Location")).hasValueSatisfying(l -> assertThat(l)
        .startsWith(IAM.issuer() + "/logout?").contains("id_token_hint=").contains("post_logout_redirect_uri="));
    assertThat(received.closed.get(10, TimeUnit.SECONDS)).isEqualTo("4401 login session ended");
    assertThat(get("/api/config").statusCode()).isEqualTo(401);
  }

  @Test
  void theIamsBackChannelLogoutEndsTheSessionAndClosesTheLivePicture() throws Exception {
    logIn(ALICE);
    LiveWebSocketTest.Received received = openLivePicture(true);
    received.next("welcome");

    // The IAM calls the server directly: no browser, no cookie, no Origin.
    HttpResponse<String> backChannel = HttpClient.newHttpClient().send(HttpRequest.newBuilder(uri("/logout/connect/back-channel/emc2"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .POST(HttpRequest.BodyPublishers.ofString("logout_token=" + IAM.logoutToken(ALICE.sub()))).build(),
        HttpResponse.BodyHandlers.ofString());

    assertThat(backChannel.statusCode()).as(backChannel.body()).isEqualTo(200);
    assertThat(received.closed.get(10, TimeUnit.SECONDS)).isEqualTo("4401 login session ended");
    assertThat(get("/api/config").statusCode()).isEqualTo(401);
  }

  @Test
  void aLogoutTokenThatIsNotTheIamsGenuineOneForThisSessionIsRefusedAndTheSessionStays() throws Exception {
    logIn(ALICE);
    LiveWebSocketTest.Received received = openLivePicture(true);
    received.next("welcome");
    Map<String, String> forged = new java.util.LinkedHashMap<>();
    forged.put("signed with another key", IAM.logoutToken(ALICE.sub(), c -> {}, true));
    forged.put("another issuer", IAM.logoutToken(ALICE.sub(), c -> c.issuer("http://evil.example/realms/test"), false));
    forged.put("another audience", IAM.logoutToken(ALICE.sub(), c -> c.audience("someone-else"), false));
    forged.put("no events claim", IAM.logoutToken(ALICE.sub(), c -> c.claim("events", null), false));
    forged.put("a nonce (an ID token, not a logout token)", IAM.logoutToken(ALICE.sub(), c -> c.claim("nonce", "n"), false));
    forged.put("an unknown session", IAM.logoutToken(ALICE.sub(), c -> c.claim("sid", "not-a-session").subject("u-nobody"), false));

    for (Map.Entry<String, String> token : forged.entrySet()) {
      HttpResponse<String> answer = backChannel(token.getValue());
      switch (token.getKey()) {
        // Spring Security 7.1.1 answers 500 (its validator does not expect the claim to be missing): refused all the same.
        case "no events claim" -> assertThat(answer.statusCode()).as(token.getKey()).isNotEqualTo(200);
        // A genuine token for a session this server does not have: nothing to end.
        case "an unknown session" -> assertThat(answer.statusCode()).as(token.getKey()).isEqualTo(200);
        default -> assertThat(answer.statusCode()).as(token.getKey()).isEqualTo(400);
      }
      assertThat(get("/api/config").statusCode()).as("still logged in after " + token.getKey()).isEqualTo(200);
      assertThat(received.closed).as(token.getKey()).isNotDone();
    }
    assertThat(backChannel(IAM.logoutToken(ALICE.sub())).statusCode()).as("the genuine one").isEqualTo(200);
    assertThat(received.closed.get(10, TimeUnit.SECONDS)).isEqualTo("4401 login session ended");
  }

  @Test
  void theConfigGivesEachUserTheWorkspacesItMaySee() throws Exception {
    logIn(ALICE);
    JsonNode alice = JSON.parse(get("/api/config").body());
    newBrowser();
    logIn(LENA);
    JsonNode lena = JSON.parse(get("/api/config").body());

    assertThat(alice.get("workspaces").toString()).as("without plugin.echo.view")
        .isEqualTo("[{\"id\":\"core.view\",\"name\":\"View\",\"order\":-2147483648}]");
    assertThat(lena.get("workspaces").findValuesAsString("id")).containsExactly("core.view", "echo.lab");
  }

  @Test
  void aPluginPostNeedsALoginAndTheEndpointsPermission() throws Exception {
    assertThat(postCommand().statusCode()).as("not logged in").isEqualTo(401);

    logIn(ALICE);
    HttpResponse<String> refused = postCommand();
    assertThat(refused.statusCode()).as("alice may only edit objects").isEqualTo(403);
    assertThat(refused.body()).isEqualTo("this needs the permission plugin.echo.run");
    assertThat(get("/api/plugins/echo/posted").body()).as("never delivered").isEqualTo("0");

    newBrowser();
    logIn(ROB);
    assertThat(postCommand().statusCode()).as("rob may run").isEqualTo(202);
    assertThat(get("/api/plugins/echo/posted").body()).isEqualTo("1");
  }

  private HttpResponse<String> postCommand() throws Exception {
    return send(HttpRequest.newBuilder(uri("/api/plugins/echo/commands/start")).header("Content-Type", "application/json")
        .header("Origin", base()).POST(HttpRequest.BodyPublishers.ofString("{}")));
  }

  @Test
  void theSettingsAndMonitorEndpointsNeedSettingsAdmin() throws Exception {
    assertThat(get("/api/settings/plugins/coordinates").statusCode()).as("not logged in").isEqualTo(401);
    assertThat(resetGeneral().statusCode()).as("not logged in").isEqualTo(401);
    assertThat(putLook().statusCode()).as("not logged in").isEqualTo(401);
    assertThat(get("/api/monitor").statusCode()).as("not logged in").isEqualTo(401);
    logIn(ALICE);
    assertThat(get("/api/settings/plugins/coordinates").statusCode()).as("alice may only edit objects").isEqualTo(403);
    assertThat(resetGeneral().statusCode()).as("alice may only edit objects").isEqualTo(403);
    assertThat(putLook().statusCode()).as("alice may only edit objects").isEqualTo(403);
    assertThat(get("/api/config").body()).as("but she reads the default look").contains("\"defaultLook\":\"night-watch\"");
    assertThat(get("/api/monitor").statusCode()).as("alice may only edit objects").isEqualTo(403);

    cookies.getCookieStore().removeAll();
    logIn(new FakeIam.Person("u-carol", "carol", List.of("admins")));
    assertThat(get("/api/settings/plugins/coordinates").statusCode()).as("allowed; no such plugin here").isEqualTo(404);
    assertThat(resetGeneral().statusCode()).as("allowed").isEqualTo(200);
    assertThat(putLook().statusCode()).as("allowed").isEqualTo(200);
    HttpResponse<String> monitor = get("/api/monitor");
    assertThat(monitor.statusCode()).as("allowed").isEqualTo(200);
    assertThat(monitor.body()).contains("\"coreWorkers\"");
  }

  @Test
  void eachUserReadsAndWritesOnlyTheirOwnDocuments() throws Exception {
    assertThat(get("/api/user-documents/core/clock").statusCode()).as("not logged in").isEqualTo(401);
    logIn(ALICE);
    HttpResponse<String> written = send(HttpRequest.newBuilder(uri("/api/user-documents/core/clock"))
        .header("Origin", base()).PUT(HttpRequest.BodyPublishers.ofString("\"local\"")));
    assertThat(written.statusCode()).as(written.body()).isEqualTo(204);
    assertThat(get("/api/user-documents/core/clock").body()).isEqualTo("\"local\"");

    cookies.getCookieStore().removeAll();
    logIn(new FakeIam.Person("u-carol", "carol", List.of("admins")));
    assertThat(get("/api/user-documents/core/clock").statusCode()).as("alice's, not carol's").isEqualTo(404);
    assertThat(get("/api/user-documents/core").body()).isEqualTo("{\"names\":[]}");
  }

  @Test
  void eachUserHasTheirOwnDisplaySettingsAndOnlyAnAdminSetsTheDefaults() throws Exception {
    // SDK 1.4.0 part 5 (ADR-0046 points 2 to 4, ADR-0052 point 5).
    assertThat(get("/api/display").statusCode()).as("not logged in").isEqualTo(401);
    logIn(ALICE);
    assertThat(get("/api/display").body()).isEqualTo("{\"choices\":{},\"defaults\":{}}");
    assertThat(putDisplay("/api/display", "{\"symbolSize\":40,\"labels\":[\"name\"]}").statusCode()).as("no permission needed").isEqualTo(204);
    HttpResponse<String> bad = putDisplay("/api/display", "{\"symbolSize\":12}");
    assertThat(bad.statusCode()).isEqualTo(400);
    assertThat(bad.body()).isEqualTo("{\"problem\":\"symbolSize is a whole number from 16 to 96\"}");
    assertThat(putDisplay("/api/display", "{\"symbolSize\":").statusCode()).as("not JSON").isEqualTo(400);
    assertThat(send(HttpRequest.newBuilder(uri("/api/user-documents/core/display")).header("Origin", base())
        .PUT(HttpRequest.BodyPublishers.ofString("{}"))).statusCode()).as("only through /api/display").isEqualTo(400);
    assertThat(putDisplay("/api/settings/display", "{\"symbolSize\":20}").statusCode()).as("alice may only edit objects").isEqualTo(403);
    assertThat(get("/api/settings/labeling").statusCode()).as("the premade labels: settings.admin only (T-170)").isEqualTo(403);
    assertThat(putDisplay("/api/settings/labeling", "{\"policies\":{}}").statusCode()).isEqualTo(403);
    assertThat(get("/api/settings/plugins/echo/compute").statusCode()).as("compute threads: settings.admin only (SDK 1.9.0)").isEqualTo(403);
    assertThat(putDisplay("/api/settings/plugins/echo/compute", "{\"allowed\":0}").statusCode()).isEqualTo(403);
    assertThat(get("/api/settings/tls-credentials").statusCode()).as("the TLS credentials' names: settings.admin only (ADR-0062)")
        .isEqualTo(403);
    assertThat(get("/api/display").body()).isEqualTo("{\"choices\":{\"symbolSize\":40,\"labels\":[\"name\"]},\"defaults\":{}}");

    cookies.getCookieStore().removeAll();
    logIn(new FakeIam.Person("u-carol", "carol", List.of("admins")));
    HttpResponse<String> defaults = putDisplay("/api/settings/display", "{\"speedVectorMinutes\":10}");
    assertThat(defaults.statusCode()).isEqualTo(200);
    assertThat(defaults.body()).isEqualTo("{\"defaults\":{\"speedVectorMinutes\":10}}");
    assertThat(putDisplay("/api/settings/display", "{\"labels\":[\"name\",\"name\"]}").body())
        .isEqualTo("{\"problems\":[{\"path\":\"\",\"problem\":\"label listed twice: name\"}]}");
    assertThat(get("/api/display").body()).as("alice's choices are not carol's").isEqualTo("{\"choices\":{},\"defaults\":{\"speedVectorMinutes\":10}}");
  }

  private HttpResponse<String> putDisplay(String path, String body) throws Exception {
    return send(HttpRequest.newBuilder(uri(path)).header("Origin", base()).header("Content-Type", "application/json")
        .PUT(HttpRequest.BodyPublishers.ofString(body)));
  }

  private HttpResponse<String> putLook() throws Exception {
    return send(HttpRequest.newBuilder(uri("/api/settings/general")).header("Origin", base()).header("Content-Type", "application/json")
        .PUT(HttpRequest.BodyPublishers.ofString("{\"defaultLook\": \"night-watch\"}")));
  }

  private HttpResponse<String> resetGeneral() throws Exception {
    return send(HttpRequest.newBuilder(uri("/api/settings/data-types/core.general")).DELETE());
  }

  @Test
  void theSessionIdChangesAtLogin() throws Exception {
    Map<String, String> authorization = toIam();
    String before = sessionId();
    assertThat(before).as("the session that holds the login's state").isNotNull();

    backFromIam(ALICE, authorization);

    assertThat(sessionId()).isNotNull().isNotEqualTo(before);
    HttpResponse<String> planted = HttpClient.newHttpClient().send(HttpRequest.newBuilder(uri("/api/config"))
        .header("Cookie", "JSESSIONID=" + before).build(), HttpResponse.BodyHandlers.ofString());
    assertThat(planted.statusCode()).as("the id from before the login (one an attacker could have planted) has no login")
        .isEqualTo(401);
  }

  @Test
  void noRequestIsServedOnAnExpiredTokenThatTheIamWillNotRenew() throws Exception {
    IAM.accessTokenSeconds = 1;
    logIn(ALICE);
    LiveWebSocketTest.Received received = openLivePicture(true);
    received.next("welcome");
    Thread.sleep(1_500); // the access token has expired

    int refreshes = (int) IAM.tokenRequests.stream().filter(r -> "refresh_token".equals(r.get("grant_type"))).count();
    assertThat(get("/api/config").statusCode()).as("expired, renewed on the way").isEqualTo(200);
    assertThat(IAM.tokenRequests.stream().filter(r -> "refresh_token".equals(r.get("grant_type"))).count()).isEqualTo(refreshes + 1);
    Thread.sleep(1_500);

    renewal.outagePause = Duration.ofSeconds(2);
    IAM.failing = true; // the IAM cannot answer: not served, but not logged out either
    int asked = IAM.tokenRequests.size();
    assertThat(get("/api/config").statusCode()).isEqualTo(503);
    assertThat(get("/api/plugins").statusCode()).as("right after the outage").isEqualTo(503);
    assertThat(IAM.tokenRequests).as("the IAM is not asked again at once").hasSize(asked + 1);
    assertThat(received.closed).isNotDone();
    IAM.failing = false;
    Thread.sleep(2_000); // the pause after the outage
    assertThat(get("/api/config").statusCode()).isEqualTo(200);
    Thread.sleep(1_500);

    IAM.refuseRefresh = true; // e.g. the user was disabled at the IAM
    assertThat(get("/api/plugins").statusCode()).as("any request, not only the keep-alive").isEqualTo(401);
    assertThat(received.closed.get(10, TimeUnit.SECONDS)).isEqualTo("4401 login session ended");
    assertThat(page("/").statusCode()).as("a page goes to the login again").isEqualTo(302);
  }

  @Test
  void theKeepAliveRenewsTheLoginAndEndsItWhenTheIamRefuses() throws Exception {
    IAM.accessTokenSeconds = 30; // within Spring's minute of clock skew: renewed at every keep-alive
    logIn(ALICE);
    LiveWebSocketTest.Received received = openLivePicture(true);
    received.next("welcome");

    HttpResponse<String> renewed = get(SessionController.PATH);
    assertThat(renewed.statusCode()).isEqualTo(200);
    assertThat(IAM.tokenRequests.getLast()).containsEntry("grant_type", "refresh_token");
    assertThat(JSON.parse(renewed.body()).get("loginMode").asString()).isEqualTo("oidc");

    IAM.failing = true; // e.g. the IAM restarts: nobody is logged out
    assertThat(get(SessionController.PATH).statusCode()).isEqualTo(503);
    assertThat(get("/api/config").statusCode()).isEqualTo(200);
    assertThat(received.closed).isNotDone();
    IAM.failing = false;
    assertThat(get(SessionController.PATH).statusCode()).isEqualTo(200);

    IAM.refuseRefresh = true; // e.g. the IAM's session has ended
    assertThat(get(SessionController.PATH).statusCode()).isEqualTo(401);
    assertThat(received.closed.get(10, TimeUnit.SECONDS)).isEqualTo("4401 login session ended");
    assertThat(get("/api/config").statusCode()).isEqualTo(401);
  }

  @Test
  void renewalsFromTwoTabsAtOnceTakeTurnsSoARotatedRefreshTokenIsNeverUsedTwice() throws Exception {
    IAM.accessTokenSeconds = 30; // every keep-alive renews; the fake IAM rotates refresh tokens
    logIn(ALICE);
    LiveWebSocketTest.Received received = openLivePicture(true);
    received.next("welcome");

    List<java.util.concurrent.CompletableFuture<HttpResponse<String>>> tabs = new java.util.ArrayList<>();
    for (int i = 0; i < 6; i++) {
      tabs.add(browser.sendAsync(HttpRequest.newBuilder(uri(SessionController.PATH)).timeout(Duration.ofSeconds(10)).GET().build(),
          HttpResponse.BodyHandlers.ofString()));
    }
    for (var tab : tabs) {
      assertThat(tab.get(20, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
    }
    assertThat(received.closed).isNotDone();
    assertThat(get("/api/config").statusCode()).isEqualTo(200);
  }

  // ---- Helpers ----------------------------------------------------------------------------------

  /** The browser follows the login: page, login start, the IAM (the user logs in), the callback. */
  private Map<String, String> logIn(FakeIam.Person person) throws Exception {
    Map<String, String> authorization = new java.util.HashMap<>();
    logIn(person, authorization);
    return authorization;
  }

  /** The Set-Cookie headers of the login callback. */
  private List<String> logInRaw(FakeIam.Person person) throws Exception {
    return logIn(person, new java.util.HashMap<>()).headers().allValues("Set-Cookie");
  }

  private HttpResponse<String> logIn(FakeIam.Person person, Map<String, String> authorizationOut) throws Exception {
    Map<String, String> authorization = toIam();
    authorizationOut.putAll(authorization);
    return backFromIam(person, authorization);
  }

  /** The browser opens a page and is sent to the IAM's login; returns the authorization request. */
  private Map<String, String> toIam() throws Exception {
    String start = page("/").headers().firstValue("Location").orElseThrow();
    String toIam = send(HttpRequest.newBuilder(URI.create(start).isAbsolute() ? URI.create(start) : uri(start)).GET())
        .headers().firstValue("Location").orElseThrow();
    assertThat(toIam).startsWith(IAM.issuer() + "/auth?");
    return FakeIam.form(URI.create(toIam).getRawQuery());
  }

  /** The user logs in at the IAM, and the browser comes back with the code. */
  private HttpResponse<String> backFromIam(FakeIam.Person person, Map<String, String> authorization) throws Exception {
    String code = IAM.logIn(authorization, person);
    String callback = authorization.get("redirect_uri") + "?code=" + code + "&state="
        + java.net.URLEncoder.encode(authorization.get("state"), java.nio.charset.StandardCharsets.UTF_8);
    HttpResponse<String> back = send(HttpRequest.newBuilder(URI.create(callback)).GET());
    assertThat(back.statusCode()).as("the callback: " + back.body()).isEqualTo(302);
    return back;
  }

  private LiveWebSocketTest.Received openLivePicture(boolean withOrigin) throws Exception {
    return openLivePicture(withOrigin ? base() : null);
  }

  private LiveWebSocketTest.Received openLivePicture(@org.jspecify.annotations.Nullable String origin) throws Exception {
    LiveWebSocketTest.Received received = new LiveWebSocketTest.Received();
    WebSocket.Builder builder = HttpClient.newHttpClient().newWebSocketBuilder();
    String cookie = cookies.getCookieStore().getCookies().stream().map(c -> c.getName() + "=" + c.getValue())
        .reduce((a, b) -> a + "; " + b).orElse("");
    if (!cookie.isEmpty()) {
      builder.header("Cookie", cookie);
    }
    if (origin != null) {
      builder.header("Origin", origin);
    }
    try {
      socket = builder.buildAsync(URI.create("ws://127.0.0.1:" + port() + LiveWebSocketHandler.PATH), received).get(10, TimeUnit.SECONDS);
    } catch (ExecutionException e) {
      throw new CompletionException(e.getCause());
    }
    return received;
  }

  private static int handshakeStatus(Throwable e) {
    Throwable t = e;
    while (!(t instanceof WebSocketHandshakeException) && t.getCause() != null) {
      t = t.getCause();
    }
    return ((WebSocketHandshakeException) t).getResponse().statusCode();
  }

  private HttpResponse<String> backChannel(String logoutToken) throws Exception {
    return HttpClient.newHttpClient().send(HttpRequest.newBuilder(uri("/logout/connect/back-channel/emc2"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .POST(HttpRequest.BodyPublishers.ofString("logout_token=" + logoutToken)).build(), HttpResponse.BodyHandlers.ofString());
  }

  private @org.jspecify.annotations.Nullable String sessionId() {
    return cookies.getCookieStore().getCookies().stream().filter(c -> c.getName().equals("JSESSIONID"))
        .map(java.net.HttpCookie::getValue).findFirst().orElse(null);
  }

  /** A page load: browsers ask for HTML, and only then are sent to the login. */
  private HttpResponse<String> page(String path) throws Exception {
    return send(HttpRequest.newBuilder(uri(path)).header("Accept", "text/html,application/xhtml+xml").GET());
  }

  private HttpResponse<String> get(String path) throws Exception {
    return send(HttpRequest.newBuilder(uri(path)).GET());
  }

  private HttpResponse<String> send(HttpRequest.Builder request) throws Exception {
    return browser.send(request.timeout(Duration.ofSeconds(10)).build(), HttpResponse.BodyHandlers.ofString());
  }

  private String port() {
    return environment.getRequiredProperty("local.server.port");
  }

  private String base() {
    return "http://127.0.0.1:" + port();
  }

  private URI uri(String path) {
    return URI.create(base() + path);
  }
}
