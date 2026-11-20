package dev.emcc.app;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.http.converter.FormHttpMessageConverter;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientProviderBuilder;
import org.springframework.security.oauth2.client.endpoint.OAuth2AccessTokenResponseClient;
import org.springframework.security.oauth2.client.endpoint.OAuth2AuthorizationCodeGrantRequest;
import org.springframework.security.oauth2.client.endpoint.OAuth2RefreshTokenGrantRequest;
import org.springframework.security.oauth2.client.endpoint.RestClientAuthorizationCodeTokenResponseClient;
import org.springframework.security.oauth2.client.endpoint.RestClientRefreshTokenTokenResponseClient;
import org.springframework.security.oauth2.client.http.OAuth2ErrorResponseErrorHandler;
import org.springframework.security.oauth2.client.oidc.authentication.OidcIdTokenDecoderFactory;
import org.springframework.security.oauth2.client.oidc.authentication.OidcIdTokenValidator;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserService;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.ClientRegistrations;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.client.userinfo.DefaultOAuth2UserService;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.web.HttpSessionOAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.http.converter.OAuth2AccessTokenResponseHttpMessageConverter;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtDecoderFactory;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestTemplate;

/**
 * The OpenID Connect client (ADR-0022), only in the login mode {@code oidc}: emc2 is a
 * confidential client that runs the Authorization Code flow with PKCE itself. The tokens are kept in
 * the HTTP session, so they go when it goes, and never reach the browser.
 *
 * <p>Every call to the IAM has a connect timeout of {@value #CONNECT_SECONDS} s and a read timeout
 * of {@value #READ_SECONDS} s: the discovery document at start, the token endpoint (login and every
 * renewal), user info and the keys that sign ID tokens. A hung IAM never holds a server thread
 * longer, and never hangs the start. The keys for the IAM's back-channel logout tokens are read by
 * Spring Security's own client, with the JDK's default timeouts ({@link Emc2Application#defaultTimeouts()}).
 */
@Configuration
@ConditionalOnProperty(name = LoginMode.SETTING, havingValue = "oidc", matchIfMissing = true)
@EnableConfigurationProperties(OidcProperties.class)
class OidcConfiguration {

  /** The one registration's id: the callback is {@code /login/oauth2/code/emc2}. */
  static final String REGISTRATION = "emc2";
  static final int CONNECT_SECONDS = 5;
  static final int READ_SECONDS = 10;

  private static final Logger LOG = LoggerFactory.getLogger(OidcConfiguration.class);

  /** The HTTP client for every call to the IAM, with timeouts. */
  static ClientHttpRequestFactory iamRequests() {
    JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(
        HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(CONNECT_SECONDS)).build());
    factory.setReadTimeout(Duration.ofSeconds(READ_SECONDS));
    return factory;
  }

  /**
   * Reads the IAM's discovery document at start, and checks that it names the configured issuer:
   * an IAM that cannot be reached, or another issuer, stops the start.
   */
  @Bean
  ClientRegistrationRepository clientRegistrations(OidcProperties oidc) {
    oidc.check();
    String issuer = oidc.issuerUri().endsWith("/") ? oidc.issuerUri().substring(0, oidc.issuerUri().length() - 1) : oidc.issuerUri();
    ClientRegistration registration;
    try {
      Map<String, Object> discovery = RestClient.builder().requestFactory(iamRequests()).build().get()
          .uri(issuer + "/.well-known/openid-configuration").retrieve().body(new ParameterizedTypeReference<>() {});
      if (discovery == null || !issuer.equals(String.valueOf(discovery.get("issuer")).replaceAll("/$", ""))) {
        throw new IllegalStateException("the discovery document names issuer " + (discovery == null ? null : discovery.get("issuer")));
      }
      registration = ClientRegistrations.fromOidcConfiguration(discovery)
          .registrationId(REGISTRATION)
          .clientId(oidc.clientId())
          .clientSecret(oidc.clientSecret())
          .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
          .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
          .redirectUri("{baseUrl}/login/oauth2/code/{registrationId}")
          .scope(oidc.scopes())
          .clientSettings(ClientRegistration.ClientSettings.builder().requireProofKey(true).build())
          .build();
    } catch (RuntimeException e) {
      throw new IllegalStateException("Login with OpenID Connect: cannot read the IAM's configuration from "
          + oidc.issuerUri() + " (" + e.getMessage() + "). The server does not start without its IAM; to run without "
          + "login on this computer only, start with --" + LoginMode.SETTING + "=none.", e);
    }
    LOG.info("Login with OpenID Connect at {} as client {}", oidc.issuerUri(), oidc.clientId());
    return new InMemoryClientRegistrationRepository(registration);
  }

  /** The tokens live in the HTTP session: ending the session ends them. */
  @Bean
  OAuth2AuthorizedClientRepository authorizedClients() {
    return new HttpSessionOAuth2AuthorizedClientRepository();
  }

  /** A token endpoint client as Spring Security's own, with the timeouts. */
  private static RestClient tokenRestClient() {
    return RestClient.builder().requestFactory(iamRequests())
        .messageConverters(c -> {
          c.clear();
          c.add(new FormHttpMessageConverter());
          c.add(new OAuth2AccessTokenResponseHttpMessageConverter());
        })
        .defaultStatusHandler(new OAuth2ErrorResponseErrorHandler())
        .build();
  }

  /** The login's code exchange. */
  @Bean
  OAuth2AccessTokenResponseClient<OAuth2AuthorizationCodeGrantRequest> codeExchange() {
    RestClientAuthorizationCodeTokenResponseClient client = new RestClientAuthorizationCodeTokenResponseClient();
    client.setRestClient(tokenRestClient());
    return client;
  }

  /** User info at login. */
  @Bean
  OidcUserService oidcUserService() {
    RestTemplate rest = new RestTemplate(iamRequests());
    rest.setErrorHandler(new OAuth2ErrorResponseErrorHandler());
    DefaultOAuth2UserService userInfo = new DefaultOAuth2UserService();
    userInfo.setRestOperations(rest);
    OidcUserService service = new OidcUserService();
    service.setOauth2UserService(userInfo);
    return service;
  }

  /**
   * ID tokens checked as Spring Security's {@link OidcIdTokenDecoderFactory} checks them (RS256, the
   * timestamps, the OIDC rules for issuer, audience and nonce, its claim types), with the keys read
   * with the timeouts. Spring Security's login picks this bean up.
   */
  @Bean
  JwtDecoderFactory<ClientRegistration> idTokenDecoders() {
    Map<String, JwtDecoder> decoders = new ConcurrentHashMap<>();
    RestTemplate rest = new RestTemplate(iamRequests());
    return registration -> decoders.computeIfAbsent(registration.getRegistrationId(), id -> {
      NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(registration.getProviderDetails().getJwkSetUri())
          .jwsAlgorithm(SignatureAlgorithm.RS256).restOperations(rest).build();
      decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(new JwtTimestampValidator(), new OidcIdTokenValidator(registration)));
      decoder.setClaimSetConverter(OidcIdTokenDecoderFactory.createDefaultClaimTypeConverter());
      return decoder;
    });
  }

  /** Renews an expiring access token with the refresh token ({@link LoginRenewal}). */
  @Bean
  OAuth2AuthorizedClientManager authorizedClientManager(ClientRegistrationRepository registrations,
      OAuth2AuthorizedClientRepository authorizedClients) {
    RestClientRefreshTokenTokenResponseClient refresh = new RestClientRefreshTokenTokenResponseClient();
    refresh.setRestClient(tokenRestClient());
    DefaultOAuth2AuthorizedClientManager manager = new DefaultOAuth2AuthorizedClientManager(registrations, authorizedClients);
    manager.setAuthorizedClientProvider(OAuth2AuthorizedClientProviderBuilder.builder().authorizationCode()
        .refreshToken(r -> r.accessTokenResponseClient(refresh)).build());
    return manager;
  }
}
