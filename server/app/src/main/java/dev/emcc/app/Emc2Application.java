package dev.emcc.app;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/** Launcher of the emc2 server. */
@SpringBootApplication
public class Emc2Application {

  /** The JDK's default timeouts for HTTP clients that set none, milliseconds: 5 s to connect, 10 s to read. */
  static final String CONNECT_TIMEOUT = "sun.net.client.defaultConnectTimeout";
  static final String READ_TIMEOUT = "sun.net.client.defaultReadTimeout";

  public static void main(String[] args) {
    defaultTimeouts();
    SpringApplication.run(Emc2Application.class, args);
  }

  /**
   * Timeouts for HTTP clients that set none, unless the operator set them (security review R1).
   * Spring Security checks the IAM's back-channel logout tokens with a client of its own that offers
   * no public setting, so a hung IAM could otherwise hold the request for ever; the edge's own calls
   * to the IAM set their timeouts themselves ({@link OidcConfiguration}). The JDK reads these at its
   * first such connection, so they are set before the application starts.
   */
  static void defaultTimeouts() {
    if (System.getProperty(CONNECT_TIMEOUT) == null) {
      System.setProperty(CONNECT_TIMEOUT, String.valueOf(OidcConfiguration.CONNECT_SECONDS * 1000));
    }
    if (System.getProperty(READ_TIMEOUT) == null) {
      System.setProperty(READ_TIMEOUT, String.valueOf(OidcConfiguration.READ_SECONDS * 1000));
    }
  }
}
