package dev.emcc.app;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.security.KeyStore;
import java.security.KeyStoreException;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import org.apache.catalina.connector.Connector;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ssl.NoSuchSslBundleException;
import org.springframework.boot.ssl.SslBundle;
import org.springframework.boot.ssl.SslBundles;
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * HTTPS on the edge (ADR-0061, M9 C2), besides {@link HttpsSettings}: the optional port that only redirects to HTTPS
 * ({@value #REDIRECT_PORT}, off by default; ADR-0061 point 4, owner Q3 A), and the server's certificate for the
 * Monitor (point 6).
 *
 * <p>The redirect port answers every request with {@code 307} (owner, C2: browsers do not keep it, so a later change
 * of setup works at once) to {@code https://<the same host>:<server.port><path>?<query>}. It is checked by the Host
 * check first, like every request, so it never sends a browser to a host of the request's choosing. It listens where
 * the server does ({@code server.address}, or this computer only without login). Set without HTTPS, it stops the
 * start.
 */
@Configuration
class HttpsConfiguration {

  private static final Logger LOG = LoggerFactory.getLogger(HttpsConfiguration.class);

  static final String REDIRECT_PORT = "emc2.https.redirect-port";
  /** HSTS's lifetime in seconds over HTTPS (ADR-0061 point 5; owner C2: one year, this host only); 0 sends none. */
  static final String HSTS_MAX_AGE = "emc2.https.hsts-max-age";
  static final long DEFAULT_HSTS_MAX_AGE = 31_536_000L;
  /** ADR-0061 point 6: the Monitor warns this many days before the certificate ends. */
  static final int EXPIRY_WARNING_DAYS = 30;

  /** Whether the server serves HTTPS: a bundle is set, {@link HttpsSettings}'s or one the admin named. */
  static boolean httpsOn(Environment environment) {
    return !environment.getProperty("server.ssl.bundle", "").isBlank();
  }

  /** The redirect port, or null when it is off. */
  static @Nullable Integer redirectPort(Environment environment) {
    String value = environment.getProperty(REDIRECT_PORT, "").strip();
    if (value.isEmpty()) {
      return null;
    }
    int port;
    try {
      port = Integer.parseInt(value);
    } catch (NumberFormatException e) {
      throw new IllegalStateException(REDIRECT_PORT + " is not a port number: " + value, e);
    }
    if (port < 1 || port > 65535) {
      throw new IllegalStateException(REDIRECT_PORT + " must be 1 to 65535: " + port);
    }
    if (!httpsOn(environment)) {
      throw new IllegalStateException(REDIRECT_PORT + " is set, but HTTPS is off: it redirects to HTTPS only. Name the "
          + "certificate (spring.ssl.bundle.jks.emcc.* or spring.ssl.bundle.pem.emcc.*, settings/credentials/https.properties) "
          + "or leave " + REDIRECT_PORT + " empty.");
    }
    if (port == environment.getProperty("server.port", Integer.class, 8080)) {
      throw new IllegalStateException(REDIRECT_PORT + " must differ from server.port: " + port);
    }
    return port;
  }

  @Bean
  WebServerFactoryCustomizer<TomcatServletWebServerFactory> httpsRedirectConnector(Environment environment, LoginMode mode) {
    return factory -> {
      Integer port = redirectPort(environment);
      if (port == null) {
        return;
      }
      Connector connector = new Connector(TomcatServletWebServerFactory.DEFAULT_PROTOCOL);
      connector.setPort(port);
      connector.setScheme("http");
      connector.setSecure(false);
      InetAddress address = listenAddress(environment, mode);
      if (address != null) {
        connector.setProperty("address", address.getHostAddress());
      }
      factory.addAdditionalConnectors(connector);
      LOG.info("HTTP on port {} only redirects to HTTPS on {} ({})", port, httpsPortText(environment), REDIRECT_PORT);
    };
  }

  /** HTTPS's port for the log: {@code server.port}, or that it is picked at start for 0 (the ready line names it then). */
  static String httpsPortText(Environment environment) {
    int port = environment.getProperty("server.port", Integer.class, 8080);
    return port == 0 ? "the port picked at start" : "port " + port;
  }

  /** Where the server listens: {@code server.address}, or this computer only without login (as {@code LoginConfiguration}). */
  private static @Nullable InetAddress listenAddress(Environment environment, LoginMode mode) {
    String address = environment.getProperty("server.address", "").strip();
    if (!address.isEmpty()) {
      try {
        return InetAddress.getByName(address);
      } catch (UnknownHostException e) {
        throw new IllegalStateException("server.address cannot be resolved: " + address, e);
      }
    }
    return mode == LoginMode.NONE ? InetAddress.getLoopbackAddress() : null;
  }

  @Bean
  FilterRegistrationBean<RedirectFilter> httpsRedirectFilter(Environment environment) {
    Integer port = redirectPort(environment);
    FilterRegistrationBean<RedirectFilter> registration = new FilterRegistrationBean<>(
        new RedirectFilter(port == null ? -1 : port, environment.getProperty("server.port", Integer.class, 8080)));
    // the port HTTPS really has once the server runs (server.port=0 picks one)
    registration.setOrder(SecurityHeadersFilter.ORDER + 2); // right after the Host check, before the Origin check
    registration.setEnabled(port != null);
    return registration;
  }

  @Bean
  org.springframework.context.ApplicationListener<org.springframework.boot.web.server.context.WebServerInitializedEvent> httpsPortOfRedirect(
      FilterRegistrationBean<RedirectFilter> redirect) {
    return event -> { // the application's own server only, not a management port's
      String namespace = event.getApplicationContext().getServerNamespace();
      if (namespace == null || namespace.isEmpty()) {
        redirect.getFilter().httpsPort = event.getWebServer().getPort();
      }
    };
  }

  /** On the redirect port only: {@code 307} to the same host over HTTPS. */
  static final class RedirectFilter extends OncePerRequestFilter {
    private final int redirectPort;
    /** {@code server.port}, then the port the running server has. */
    volatile int httpsPort;

    RedirectFilter(int redirectPort, int httpsPort) {
      this.redirectPort = redirectPort;
      this.httpsPort = httpsPort;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
        throws ServletException, IOException {
      if (request.isSecure() || request.getLocalPort() != redirectPort) {
        chain.doFilter(request, response);
        return;
      }
      String host = request.getServerName();
      if (host.contains(":") && !host.startsWith("[")) {
        host = "[" + host + "]";
      }
      String query = request.getQueryString();
      String target = "https://" + host + (httpsPort == 443 ? "" : ":" + httpsPort) + request.getRequestURI()
          + (query == null ? "" : "?" + query);
      response.setStatus(HttpServletResponse.SC_TEMPORARY_REDIRECT);
      response.setHeader("Location", target);
      response.setContentLength(0);
    }
  }

  /**
   * The server's certificate as the Monitor shows it, read from the bundle at each answer, so a reloaded one shows at
   * once; null without HTTPS.
   *
   * @param state {@code valid}, {@code soon} (within {@value #EXPIRY_WARNING_DAYS} days of its end) or {@code expired}
   */
  record Https(String subject, String issuer, long notAfterMillis, String state) {}

  @Bean
  ServerCertificate serverCertificate(SslBundles bundles, Environment environment) {
    return new ServerCertificate(bundles, environment.getProperty("server.ssl.bundle", "").strip());
  }

  /** Reads the bundle's certificate; its alias where set, else the first key entry. */
  static final class ServerCertificate {
    private final SslBundles bundles;
    /** The server's bundle; empty over plain HTTP. */
    private final String name;

    ServerCertificate(SslBundles bundles, String name) {
      this.bundles = bundles;
      this.name = name;
    }

    @Nullable Https now(Instant now) {
      if (name.isEmpty()) {
        return null;
      }
      try {
        SslBundle bundle = bundles.getBundle(name);
        KeyStore store = bundle.getStores().getKeyStore();
        if (store == null) {
          return null;
        }
        String alias = bundle.getKey().getAlias();
        X509Certificate certificate = certificate(store, alias);
        if (certificate == null) {
          return null;
        }
        Instant notAfter = certificate.getNotAfter().toInstant();
        String state = notAfter.isBefore(now) ? "expired"
            : notAfter.isBefore(now.plus(Duration.ofDays(EXPIRY_WARNING_DAYS))) ? "soon" : "valid";
        return new Https(certificate.getSubjectX500Principal().getName(), certificate.getIssuerX500Principal().getName(),
            notAfter.toEpochMilli(), state);
      } catch (NoSuchSslBundleException | KeyStoreException e) {
        LOG.warn("The server's certificate cannot be read for the Monitor: {}", e.getMessage());
        return null;
      }
    }

    private static @Nullable X509Certificate certificate(KeyStore store, @Nullable String alias) throws KeyStoreException {
      if (alias != null && store.getCertificate(alias) instanceof X509Certificate c) {
        return c;
      }
      for (String a : Collections.list(store.aliases())) {
        if (store.isKeyEntry(a)) {
          Certificate c = store.getCertificate(a);
          if (c instanceof X509Certificate x) {
            return x;
          }
        }
      }
      return null;
    }
  }
}
