package dev.emcc.app;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.annotation.web.configurers.HeadersConfigurer;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.client.endpoint.OAuth2AccessTokenResponseClient;
import org.springframework.security.oauth2.client.endpoint.OAuth2AuthorizationCodeGrantRequest;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserService;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestCustomizers;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestRedirectFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.web.util.HtmlUtils;

/**
 * Who may use the server (ADR-0022), with Spring Security in the edge only (ADR-0002).
 *
 * <ul>
 *   <li><b>No login</b> ({@code none}): every request is let through; {@link CurrentUser} makes it
 *       the local user. No login, no logout, no session needed.
 *   <li><b>Login</b> ({@code oidc}): a page that is not logged in goes to the IAM's login page (a
 *       top-level navigation, so the CSP stays {@code 'self'}) and comes back through {@code
 *       /login/oauth2/code/emc2}; the API answers {@code 401} instead, and so does the live
 *       picture's handshake. {@code /api/health} stays open, and so does the user manual, {@code /manual/} (GET). Logout is {@code POST /logout} and
 *       ends the IAM's session too ({@link LogoutAnswer}); the IAM's back-channel logout ends the
 *       session here. A login that fails gets a page, not another round to the IAM.
 *       SDK 1.6.0: the plugins' service endpoints, {@code /api/services/**}, stay open too
 *       ({@link ServiceController}; no authentication in 1.6.0, ADR-0055 point 5.3).
 * </ul>
 *
 * <p>Cross-site requests are refused by {@link OriginCheckFilter} with the {@code SameSite=Lax}
 * session cookie (ADR-0022), not by CSRF tokens: the edge's own filters run before this chain.
 * The security headers are the edge's own ({@link SecurityHeadersFilter}); Spring Security adds
 * only HSTS over HTTPS: for {@value HttpsConfiguration#HSTS_MAX_AGE} seconds (a year), this host only (M9 C2).
 */
@Configuration
@EnableWebSecurity
class SecurityConfiguration {

  private static final Logger LOG = LoggerFactory.getLogger(SecurityConfiguration.class);

  @Bean
  SecurityFilterChain emc2Security(HttpSecurity http, LoginMode mode, ObjectProvider<ClientRegistrationRepository> registrations,
      LoginSessions loginSessions, ObjectProvider<OidcProperties> oidcProperties,
      ObjectProvider<OAuth2AccessTokenResponseClient<OAuth2AuthorizationCodeGrantRequest>> codeExchange,
      ObjectProvider<OidcUserService> userInfo, LoginRenewal renewal, org.springframework.core.env.Environment environment)
      throws Exception {
    // ADR-0061 point 5 (M9 C2; owner: one year, this host only): HSTS over HTTPS only, its lifetime a setting, 0 none
    long hstsMaxAge = environment.getProperty(HttpsConfiguration.HSTS_MAX_AGE, Long.class, HttpsConfiguration.DEFAULT_HSTS_MAX_AGE);
    if (hstsMaxAge < 0) {
      throw new IllegalStateException(HttpsConfiguration.HSTS_MAX_AGE + " must be 0 or more seconds: " + hstsMaxAge);
    }
    http.csrf(AbstractHttpConfigurer::disable)
        .headers(h -> {
          h.cacheControl(HeadersConfigurer.CacheControlConfig::disable)
              .contentTypeOptions(HeadersConfigurer.ContentTypeOptionsConfig::disable)
              .frameOptions(HeadersConfigurer.FrameOptionsConfig::disable);
          if (hstsMaxAge == 0) {
            h.httpStrictTransportSecurity(HeadersConfigurer.HstsConfig::disable);
          } else {
            h.httpStrictTransportSecurity(hsts -> hsts.maxAgeInSeconds(hstsMaxAge).includeSubDomains(false));
          }
        });
    if (mode == LoginMode.NONE) {
      return http.authorizeHttpRequests(a -> a.anyRequest().permitAll())
          .logout(AbstractHttpConfigurer::disable)
          .requestCache(AbstractHttpConfigurer::disable)
          .build();
    }
    ClientRegistrationRepository repository = registrations.getObject();
    DefaultOAuth2AuthorizationRequestResolver authorizationRequests = new DefaultOAuth2AuthorizationRequestResolver(
        repository, OAuth2AuthorizationRequestRedirectFilter.DEFAULT_AUTHORIZATION_REQUEST_BASE_URI);
    authorizationRequests.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());
    OidcProperties oidc = oidcProperties.getObject();
    PathPatternRequestMatcher.Builder paths = PathPatternRequestMatcher.withDefaults();
    return http
        .authorizeHttpRequests(a -> a.requestMatchers(paths.matcher(HealthController.PATH), paths.matcher("/error"),
                paths.matcher(ServiceController.PREFIX + "/**")).permitAll()
            // M9 RC2: the user manual, open as the login page is; GET and HEAD only, so a user without a login can read it
            .requestMatchers(paths.matcher(HttpMethod.GET, "/manual"), paths.matcher(HttpMethod.GET, ManualConfiguration.PATH + "**"),
                paths.matcher(HttpMethod.HEAD, ManualConfiguration.PATH + "**")).permitAll()
            .anyRequest().authenticated())
        .exceptionHandling(e -> e.defaultAuthenticationEntryPointFor(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED),
            paths.matcher("/api/**")))
        // No request on an access token that has expired and cannot be renewed (security review R2).
        .addFilterBefore(new AccessTokenFilter(renewal), AuthorizationFilter.class)
        // A new session id at login, so an id planted before the login is worthless (fixation).
        .sessionManagement(s -> s.sessionFixation(f -> f.changeSessionId()))
        .oauth2Login(o -> o.authorizationEndpoint(a -> a.authorizationRequestResolver(authorizationRequests))
            .tokenEndpoint(t -> t.accessTokenResponseClient(codeExchange.getObject()))
            .userInfoEndpoint(u -> u.oidcUserService(userInfo.getObject()))
            .failureHandler(SecurityConfiguration::loginFailed))
        .logout(l -> l.logoutRequestMatcher(paths.matcher(HttpMethod.POST, "/logout"))
            // Runs before the session is invalidated: the live picture ends with 4401, not Tomcat's 1008.
            .addLogoutHandler((request, response, authentication) -> {
              if (request.getSession(false) instanceof jakarta.servlet.http.HttpSession session) {
                loginSessions.end(session.getId());
              }
            })
            .logoutSuccessHandler(new LogoutAnswer(repository)))
        .oidcLogout(o -> o.backChannel(b -> b.logoutUri(oidc.backChannelLogoutUri())))
        .build();
  }

  /**
   * A login that did not succeed (the user cancelled at the IAM, a wrong client secret, an expired
   * login page): a page that says so, not a redirect, which would send the browser straight back to
   * the IAM and could loop.
   */
  static void loginFailed(HttpServletRequest request, HttpServletResponse response, AuthenticationException e) throws IOException {
    String why = e instanceof OAuth2AuthenticationException oauth ? oauth.getError().getErrorCode() : "login failed";
    LOG.info("A login did not succeed: {}", e.getMessage());
    response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
    response.setContentType("text/html;charset=UTF-8");
    response.getWriter().write("<!doctype html><title>emcc: login failed</title><p>The login did not succeed ("
        + HtmlUtils.htmlEscape(why) + ").</p><p><a href=\"/\">Try again</a></p>");
  }
}
