package dev.emcc.app;

import java.net.InetAddress;
import java.net.UnknownHostException;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.web.server.ConfigurableWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/**
 * The login mode and its start rules (ADR-0022), in place of M0's "only with the {@code dev}
 * profile" (ADR-0012).
 *
 * <ul>
 *   <li>{@value LoginMode#SETTING} is {@code oidc} by default: the no-login mode must be chosen.
 *       The profile {@value #DEV_PROFILE} chooses it, as before, for development and tests, and
 *       cannot be combined with login: its stop endpoint has no login of its own.
 *   <li>Login with OpenID Connect ({@link OidcConfiguration}) needs its settings and its IAM: without
 *       them the server does not start, and says how to choose the no-login mode instead. Never a
 *       silent fallback.
 *   <li>The no-login mode logs a warning at every start and listens on loopback only: without
 *       {@code server.address} it binds to the loopback address; another address needs {@value
 *       #ALLOW_NETWORK}{@code =true}, and then logs a second warning. Otherwise it does not start.
 * </ul>
 *
 * <p>The checks run when the web server is created, before it listens.
 */
@Configuration
class LoginConfiguration {

  /** The development profile: chooses the no-login mode and adds the development stop endpoint. */
  static final String DEV_PROFILE = "dev";
  /** In the no-login mode: also listen on addresses other than loopback. */
  static final String ALLOW_NETWORK = "emc2.login.no-login.allow-network";

  private static final Logger LOG = LoggerFactory.getLogger(LoginConfiguration.class);

  @Bean
  LoginMode loginMode(Environment environment) {
    LoginMode mode = LoginMode.parse(environment.getProperty(LoginMode.SETTING, LoginMode.OIDC.value()));
    if (mode != LoginMode.NONE && environment.matchesProfiles(DEV_PROFILE)) {
      throw new IllegalStateException("The development profile '" + DEV_PROFILE + "' is the no-login mode (its stop "
          + "endpoint has no login of its own); it cannot be combined with " + LoginMode.SETTING + "=" + mode.value() + ".");
    }
    if (mode == LoginMode.OIDC) {
      return mode;
    }
    LOG.warn("*** NO LOGIN *** {}=none: everyone who can reach this server works as the local user, with all "
        + "permissions. Not a protected system.", LoginMode.SETTING);
    return mode;
  }

  @Bean
  WebServerFactoryCustomizer<ConfigurableWebServerFactory> noLoginNetwork(LoginMode mode, Environment environment) {
    return factory -> {
      if (mode != LoginMode.NONE) {
        return;
      }
      String address = environment.getProperty("server.address", "").trim();
      boolean allowNetwork = environment.getProperty(ALLOW_NETWORK, Boolean.class, false);
      if (address.isEmpty()) {
        factory.setAddress(InetAddress.getLoopbackAddress());
        return;
      }
      if (isLoopback(address)) {
        return;
      }
      if (!allowNetwork) {
        throw new IllegalStateException("Without login (" + LoginMode.SETTING + "=none) the server listens on this "
            + "computer only, but server.address is " + address + ". To allow other computers anyway, also set --"
            + ALLOW_NETWORK + "=true.");
      }
      LOG.warn("*** NO LOGIN, OPEN TO THE NETWORK *** listening on {} ({}=true): every computer that reaches it works "
          + "as the local user, with all permissions.", address, ALLOW_NETWORK);
    };
  }

  /** True for a loopback address or a name that resolves to one; false for wildcards and the rest. */
  static boolean isLoopback(@Nullable String address) {
    if (address == null || address.isBlank()) {
      return false;
    }
    try {
      for (InetAddress a : InetAddress.getAllByName(address.trim())) {
        if (!a.isLoopbackAddress()) {
          return false;
        }
      }
      return true;
    } catch (UnknownHostException e) {
      return false;
    }
  }
}
