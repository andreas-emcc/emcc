package dev.emcc.app;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * A small OpenID Connect provider for the edge's login tests, in place of Keycloak (T-045): the
 * discovery document, signed ID tokens (RS256), the token endpoint with PKCE and client secret
 * checks, refresh, user info, and back-channel logout tokens. Anything a real IAM would refuse,
 * it refuses with {@code 400}, so a test passes only if the server speaks the protocol right.
 */
final class FakeIam implements AutoCloseable {

  static final String CLIENT_ID = "emc2-test";
  static final String CLIENT_SECRET = "test-secret-made-in-the-test";

  /** One user who logs in. */
  record Person(String sub, String name, List<String> groups) {}

  private record Grant(Person person, String challenge, String redirectUri, String nonce, String sid) {}

  private final HttpServer server;
  private final RSAKey key;
  /** Another key with the same id: what an attacker without the IAM's key signs with. */
  private final RSAKey otherKey;
  private final Map<String, Grant> codes = new ConcurrentHashMap<>();
  private final Map<String, Grant> refreshTokens = new ConcurrentHashMap<>();
  /** Every login's grant, in order: the latest of a person is their current IAM session. */
  private final List<Grant> grants = new CopyOnWriteArrayList<>();
  /** The token endpoint's requests, for assertions: grant type and parameters (also those it failed). */
  final List<Map<String, String>> tokenRequests = new CopyOnWriteArrayList<>();
  /** Lifetime of new access tokens. */
  volatile long accessTokenSeconds = 300;
  /** When set, a refresh is refused with {@code invalid_grant} (the IAM's session has ended). */
  volatile boolean refuseRefresh;
  /** When set, the token endpoint fails with 500, as an IAM that is restarting. */
  volatile boolean failing;
  /** How long the key endpoint stalls before it answers: a hung IAM. */
  volatile long keysDelayMillis;

  FakeIam() {
    try {
      key = new RSAKeyGenerator(2048).keyID("test-key").generate();
      otherKey = new RSAKeyGenerator(2048).keyID("test-key").generate();
      server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
    server.createContext("/realms/test", this::handle);
    server.start();
  }

  String issuer() {
    return "http://127.0.0.1:" + server.getAddress().getPort() + "/realms/test";
  }

  @Override
  public void close() {
    server.stop(0);
  }

  /** What the IAM's login page does: the user logs in; returns the code for the redirect. */
  String logIn(Map<String, String> authorizationRequest, Person person) {
    require(authorizationRequest, "response_type", "code");
    require(authorizationRequest, "client_id", CLIENT_ID);
    require(authorizationRequest, "code_challenge_method", "S256");
    String code = UUID.randomUUID().toString();
    codes.put(code, new Grant(person, authorizationRequest.get("code_challenge"), authorizationRequest.get("redirect_uri"),
        authorizationRequest.get("nonce"), UUID.randomUUID().toString()));
    return code;
  }

  /** A signed back-channel logout token for the user's IAM session (OpenID Connect Back-Channel Logout 1.0). */
  String logoutToken(String sub) {
    return logoutToken(sub, claims -> {}, false);
  }

  /** A logout token as {@link #logoutToken(String)}, changed by {@code change}, signed with another key if asked. */
  String logoutToken(String sub, java.util.function.Consumer<JWTClaimsSet.Builder> change, boolean withOtherKey) {
    Grant grant = grants.reversed().stream().filter(g -> g.person().sub().equals(sub)).findFirst().orElseThrow();
    JWTClaimsSet.Builder claims = new JWTClaimsSet.Builder().issuer(issuer()).audience(CLIENT_ID).issueTime(new Date())
        .jwtID(UUID.randomUUID().toString()).subject(sub).claim("sid", grant.sid())
        .claim("events", Map.of("http://schemas.openid.net/event/backchannel-logout", Map.of()));
    change.accept(claims);
    return sign(claims.build(), new JOSEObjectType("logout+jwt"), withOtherKey ? otherKey : key);
  }

  private void handle(HttpExchange exchange) throws IOException {
    String path = exchange.getRequestURI().getPath().substring("/realms/test".length());
    try {
      switch (path) {
        case "/.well-known/openid-configuration" -> json(exchange, 200, discovery());
        case "/jwks" -> {
          if (keysDelayMillis > 0) {
            try {
              Thread.sleep(keysDelayMillis);
            } catch (InterruptedException e) {
              Thread.currentThread().interrupt();
            }
          }
          json(exchange, 200, new JWKSet(key.toPublicJWK()).toString());
        }
        case "/token" -> token(exchange);
        case "/userinfo" -> userInfo(exchange);
        default -> json(exchange, 404, "{\"error\":\"not_found\"}");
      }
    } catch (Refused e) {
      json(exchange, 400, "{\"error\":\"" + e.getMessage() + "\"}");
    }
  }

  private String discovery() {
    String i = issuer();
    return "{\"issuer\":\"" + i + "\",\"authorization_endpoint\":\"" + i + "/auth\",\"token_endpoint\":\"" + i + "/token\","
        + "\"jwks_uri\":\"" + i + "/jwks\",\"userinfo_endpoint\":\"" + i + "/userinfo\",\"end_session_endpoint\":\"" + i
        + "/logout\",\"response_types_supported\":[\"code\"],\"subject_types_supported\":[\"public\"],"
        + "\"id_token_signing_alg_values_supported\":[\"RS256\"],\"code_challenge_methods_supported\":[\"S256\"],"
        + "\"grant_types_supported\":[\"authorization_code\",\"refresh_token\"],"
        + "\"token_endpoint_auth_methods_supported\":[\"client_secret_basic\"],\"backchannel_logout_supported\":true,"
        + "\"backchannel_logout_session_supported\":true,\"scopes_supported\":[\"openid\",\"profile\"]}";
  }

  private void token(HttpExchange exchange) throws IOException {
    Map<String, String> form = form(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
    tokenRequests.add(form);
    if (failing) {
      json(exchange, 500, "<html>Internal Server Error</html>");
      return;
    }
    String basic = "Basic " + Base64.getEncoder().encodeToString((CLIENT_ID + ":" + CLIENT_SECRET).getBytes(StandardCharsets.UTF_8));
    if (!basic.equals(exchange.getRequestHeaders().getFirst("Authorization"))) {
      throw new Refused("invalid_client");
    }
    Grant grant;
    switch (form.getOrDefault("grant_type", "")) {
      case "authorization_code" -> {
        grant = codes.remove(form.get("code"));
        if (grant == null) throw new Refused("invalid_grant");
        if (!grant.redirectUri().equals(form.get("redirect_uri"))) throw new Refused("invalid_grant");
        String verifier = form.get("code_verifier");
        if (verifier == null || !s256(verifier).equals(grant.challenge())) throw new Refused("invalid_grant");
        grants.add(grant);
      }
      case "refresh_token" -> {
        grant = refreshTokens.get(form.get("refresh_token"));
        if (grant == null || refuseRefresh) throw new Refused("invalid_grant");
      }
      default -> throw new Refused("unsupported_grant_type");
    }
    String refresh = UUID.randomUUID().toString();
    refreshTokens.values().removeIf(g -> g == grant);
    refreshTokens.put(refresh, grant);
    Instant now = Instant.now();
    JWTClaimsSet.Builder id = new JWTClaimsSet.Builder().issuer(issuer()).audience(CLIENT_ID).subject(grant.person().sub())
        .issueTime(Date.from(now)).expirationTime(Date.from(now.plusSeconds(300))).claim("sid", grant.sid())
        .claim("preferred_username", grant.person().name()).claim("groups", grant.person().groups());
    if (form.get("grant_type").equals("authorization_code")) {
      id.claim("nonce", grant.nonce());
    }
    json(exchange, 200, "{\"access_token\":\"" + UUID.randomUUID() + "\",\"token_type\":\"Bearer\",\"expires_in\":"
        + accessTokenSeconds + ",\"refresh_token\":\"" + refresh + "\",\"scope\":\"openid profile\",\"id_token\":\""
        + sign(id.build(), JOSEObjectType.JWT) + "\"}");
  }

  private void userInfo(HttpExchange exchange) throws IOException {
    // Any Bearer token from this IAM; the last logged-in person (the tests log in one at a time).
    if (grants.isEmpty()) throw new Refused("invalid_token");
    Grant grant = grants.getLast();
    json(exchange, 200, "{\"sub\":\"" + grant.person().sub() + "\",\"preferred_username\":\"" + grant.person().name()
        + "\",\"groups\":[" + String.join(",", grant.person().groups().stream().map(g -> "\"" + g + "\"").toList()) + "]}");
  }

  private String sign(JWTClaimsSet claims, JOSEObjectType type) {
    return sign(claims, type, key);
  }

  private String sign(JWTClaimsSet claims, JOSEObjectType type, RSAKey with) {
    try {
      SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(with.getKeyID()).type(type).build(), claims);
      jwt.sign(new RSASSASigner(with));
      return jwt.serialize();
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  static String s256(String verifier) {
    try {
      byte[] hash = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
      return Base64.getUrlEncoder().withoutPadding().encodeToString(hash);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  static Map<String, String> form(String text) {
    Map<String, String> values = new LinkedHashMap<>();
    for (String pair : text.split("&")) {
      if (pair.isEmpty()) continue;
      int eq = pair.indexOf('=');
      values.put(URLDecoder.decode(eq < 0 ? pair : pair.substring(0, eq), StandardCharsets.UTF_8),
          eq < 0 ? "" : URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8));
    }
    return values;
  }

  private static void require(Map<String, String> values, String name, String expected) {
    if (!expected.equals(values.get(name))) {
      throw new IllegalArgumentException(name + " must be " + expected + ", was " + values.get(name));
    }
  }

  private static void json(HttpExchange exchange, int status, String body) {
    try {
      byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
      exchange.getResponseHeaders().set("Content-Type", "application/json");
      exchange.sendResponseHeaders(status, bytes.length);
      exchange.getResponseBody().write(bytes);
      exchange.close();
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static final class Refused extends RuntimeException {
    Refused(String error) {
      super(error);
    }
  }
}
