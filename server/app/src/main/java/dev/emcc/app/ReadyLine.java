package dev.emcc.app;

import java.net.InetAddress;
import java.net.UnknownHostException;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ApplicationListener;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * The ready line (M9 B3; owner ABB B): one fixed INFO line once ECore and the edge are ready, which the release's start
 * scripts print as the address to open. <b>Its text is a contract</b> (server/README.md, "The ready line"); keep it
 * stable:
 *
 * <pre>
 * emcc ready at http://localhost:8080/
 * emcc ready at https://localhost:8443/
 * emcc ready at https://localhost:8443/ (http://localhost:8081/ redirects to it)
 * </pre>
 *
 * <p>The scheme is {@code https} when the server serves HTTPS (ADR-0061), the port the one the server listens on, the
 * host {@code server.address}, or {@code localhost} when that is empty or every address ({@code 0.0.0.0}, {@code ::});
 * an IPv6 address in brackets. The part in parentheses only with {@value HttpsConfiguration#REDIRECT_PORT}.
 */
@Component
class ReadyLine implements ApplicationListener<ApplicationReadyEvent> {

  private static final Logger LOG = LoggerFactory.getLogger(ReadyLine.class);
  static final String PREFIX = "emcc ready at ";

  private final Environment environment;

  ReadyLine(Environment environment) {
    this.environment = environment;
  }

  @Override
  public void onApplicationEvent(ApplicationReadyEvent event) {
    if (!(event.getApplicationContext() instanceof WebServerApplicationContext web) || web.getWebServer() == null) {
      return;
    }
    LOG.info(line(HttpsConfiguration.httpsOn(environment), host(environment.getProperty("server.address", "")),
        web.getWebServer().getPort(), HttpsConfiguration.redirectPort(environment)));
  }

  /** The line's text. */
  static String line(boolean https, String host, int port, @Nullable Integer redirectPort) {
    String address = (https ? "https://" : "http://") + host + ":" + port + "/";
    return PREFIX + address + (redirectPort == null ? "" : " (http://" + host + ":" + redirectPort + "/ redirects to it)");
  }

  /** {@code server.address} as a browser writes it; {@code localhost} for none or every address. */
  static String host(String address) {
    String a = address.strip();
    if (a.isEmpty()) {
      return "localhost";
    }
    try {
      InetAddress resolved = InetAddress.getByName(a);
      if (resolved.isAnyLocalAddress()) {
        return "localhost";
      }
    } catch (UnknownHostException e) {
      return a; // a name: as given
    }
    return a.contains(":") && !a.startsWith("[") ? "[" + a + "]" : a;
  }
}
