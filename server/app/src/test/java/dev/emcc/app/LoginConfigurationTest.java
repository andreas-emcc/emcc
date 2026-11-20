package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.InetAddress;
import java.nio.file.Path;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.tomcat.TomcatWebServer;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;

/** The login mode's start rules (ADR-0022): login by default, no silent fallback, no-login on loopback only. */
@ExtendWith(OutputCaptureExtension.class)
class LoginConfigurationTest {

  /** Deleted by JUnit after each test; every test closes the application it starts. */
  @TempDir Path dataDirectory;

  /**
   * Starts the application with these arguments. Command-line arguments override
   * SPRING_PROFILES_ACTIVE, so a profile set in the environment cannot change a test.
   */
  private ConfigurableApplicationContext run(String... args) {
    String[] all = Stream.concat(Stream.of("--spring.profiles.active=test", "--server.port=0",
        "--emc2.data.directory=" + dataDirectory), Stream.of(args)).toArray(String[]::new);
    return new SpringApplicationBuilder(Emc2Application.class).run(all);
  }

  private static InetAddress boundAddress(ConfigurableApplicationContext context) {
    TomcatWebServer server = (TomcatWebServer) ((WebServerApplicationContext) context).getWebServer();
    return (InetAddress) server.getTomcat().getConnector().getProperty("address");
  }

  @Test
  void withoutASettingTheServerWantsLoginAndDoesNotFallBackToNoLogin() {
    assertThatThrownBy(this::run)
        .hasStackTraceContaining("emc2.login.mode=oidc, the default")
        .hasStackTraceContaining("--emc2.login.mode=none");
  }

  @Test
  void loginWithAnIamThatCannotBeReachedDoesNotStart() {
    assertThatThrownBy(() -> run("--emc2.login.mode=oidc", "--emc2.login.oidc.issuer-uri=http://127.0.0.1:9/realms/none",
        "--emc2.login.oidc.client-id=c", "--emc2.login.oidc.client-secret=made-up-for-the-test"))
        .hasStackTraceContaining("cannot read the IAM's configuration from http://127.0.0.1:9/realms/none")
        .hasStackTraceContaining("--emc2.login.mode=none");
  }

  @Test
  void forwardedHeadersWithoutNamedTrustedProxiesAreRefused() {
    assertThatThrownBy(() -> run("--spring.profiles.active=" + LoginConfiguration.DEV_PROFILE, "--server.forward-headers-strategy=native"))
        .hasStackTraceContaining("server.tomcat.remoteip.internal-proxies, which is not set");
  }

  @Test
  void listenerCredentialsAreBoundByNameAndIncompleteOnesStopTheStart() throws Exception {
    Path trust = java.nio.file.Files.writeString(dataDirectory.resolve("trust.p12"), "not read at start");
    try (ConfigurableApplicationContext context = run("--spring.profiles.active=" + LoginConfiguration.DEV_PROFILE,
        "--emc2.listeners.credentials.tak-north.trust-store=" + trust, "--emc2.listeners.credentials.tak-north.trust-store-password=x")) {
      dev.emcc.ecore.plugin.ListenerConfig listeners = context.getBean(ECoreLifecycle.class).core().config().listeners();
      assertThat(listeners.credentials()).containsOnlyKeys("tak-north");
      assertThat(listeners.maxPerPlugin()).isEqualTo(100);
      assertThat(listeners.maxTasksPerPlugin()).as("connection tasks").isEqualTo(100);
    }
    try (ConfigurableApplicationContext context = run("--spring.profiles.active=" + LoginConfiguration.DEV_PROFILE,
        "--emc2.connections.max-per-plugin=7")) {
      assertThat(context.getBean(ECoreLifecycle.class).core().config().listeners().maxTasksPerPlugin()).isEqualTo(7);
    }
    assertThatThrownBy(() -> run("--spring.profiles.active=" + LoginConfiguration.DEV_PROFILE, "--emc2.connections.max-per-plugin=0"))
        .hasStackTraceContaining("emc2.connections.max-per-plugin must be at least 1: 0");
    // SDK 1.2.0: output channels and the plugins' classifications() (ADR-0037).
    try (ConfigurableApplicationContext context = run("--spring.profiles.active=" + LoginConfiguration.DEV_PROFILE,
        "--emc2.channels.max-per-plugin=5", "--emc2.classifications.order.SWE=OKLASSIFICERAD,BEGRÄNSAT HEMLIG")) {
      dev.emcc.ecore.ECoreConfig config = context.getBean(ECoreLifecycle.class).core().config();
      assertThat(config.maxChannelsPerPlugin()).isEqualTo(5);
      assertThat(config.classificationOrders()).containsOnlyKeys("NATO", "SWE");
      assertThat(config.classificationOrders().get("SWE")).containsExactly("OKLASSIFICERAD", "BEGRÄNSAT HEMLIG");
    }
    try (ConfigurableApplicationContext context = run("--spring.profiles.active=" + LoginConfiguration.DEV_PROFILE)) {
      assertThat(context.getBean(ECoreLifecycle.class).core().config().maxChannelsPerPlugin()).as("the default").isEqualTo(100);
    }
    assertThatThrownBy(() -> run("--spring.profiles.active=" + LoginConfiguration.DEV_PROFILE, "--emc2.channels.max-per-plugin=0"))
        .hasStackTraceContaining("emc2.channels.max-per-plugin must be at least 1: 0");
    assertThatThrownBy(() -> run("--spring.profiles.active=" + LoginConfiguration.DEV_PROFILE,
        "--emc2.listeners.credentials.tak-north.trust-store=" + trust))
        .hasStackTraceContaining("emc2.listeners.credentials.tak-north.trust-store-password is missing");
    assertThatThrownBy(() -> run("--spring.profiles.active=" + LoginConfiguration.DEV_PROFILE,
        "--emc2.listeners.credentials.tak-north.trust-store=" + dataDirectory.resolve("nothing.p12"),
        "--emc2.listeners.credentials.tak-north.trust-store-password=x"))
        .hasStackTraceContaining("emc2.listeners.credentials.tak-north.trust-store is not a file");
  }

  @Test
  void httpsSettingsThatCannotWorkStopTheStart() { // ADR-0061, M9 C2
    assertThatThrownBy(() -> run("--spring.profiles.active=" + LoginConfiguration.DEV_PROFILE, "--emc2.https.redirect-port=8481"))
        .hasStackTraceContaining("emc2.https.redirect-port is set, but HTTPS is off");
    assertThatThrownBy(() -> run("--spring.profiles.active=" + LoginConfiguration.DEV_PROFILE, "--emc2.https.hsts-max-age=-1"))
        .hasStackTraceContaining("emc2.https.hsts-max-age must be 0 or more seconds: -1");
    assertThatThrownBy(() -> run("--spring.profiles.active=" + LoginConfiguration.DEV_PROFILE,
        "--spring.ssl.bundle.jks.emcc.keystore.location=file:" + dataDirectory.resolve("none.p12"),
        "--spring.ssl.bundle.jks.emcc.keystore.password=x"))
        .as("a certificate that cannot be read stops the start: no fallback to HTTP; in the server's words (MCA, release check)")
        .hasStackTraceContaining("HTTPS cannot start: spring.ssl.bundle.jks.emcc.keystore.location (in the command line)")
        .hasStackTraceContaining("none.p12, which is not a file");
  }

  @Test
  void forwardedHeadersFromEveryClientAreRefused() {
    assertThatThrownBy(() -> run("--spring.profiles.active=" + LoginConfiguration.DEV_PROFILE, "--server.forward-headers-strategy=framework"))
        .hasStackTraceContaining("server.forward-headers-strategy must be none or native");
  }

  @Test
  void theDefaultTimeoutsForHttpClientsAreSetUnlessTheOperatorSetThem() {
    String connect = System.getProperty(Emc2Application.CONNECT_TIMEOUT);
    String read = System.getProperty(Emc2Application.READ_TIMEOUT);
    try {
      System.clearProperty(Emc2Application.CONNECT_TIMEOUT);
      System.setProperty(Emc2Application.READ_TIMEOUT, "1234");
      Emc2Application.defaultTimeouts();
      assertThat(System.getProperty(Emc2Application.CONNECT_TIMEOUT)).isEqualTo("5000");
      assertThat(System.getProperty(Emc2Application.READ_TIMEOUT)).as("the operator's").isEqualTo("1234");
    } finally {
      restore(Emc2Application.CONNECT_TIMEOUT, connect);
      restore(Emc2Application.READ_TIMEOUT, read);
    }
  }

  private static void restore(String property, @org.jspecify.annotations.Nullable String value) {
    if (value == null) {
      System.clearProperty(property);
    } else {
      System.setProperty(property, value);
    }
  }

  @Test
  void anUnknownModeIsRefused() {
    assertThatThrownBy(() -> run("--emc2.login.mode=off"))
        .hasStackTraceContaining("emc2.login.mode must be 'oidc' (login) or 'none' (no login), not 'off'");
  }

  @Test
  void theNoLoginModeWarnsAndListensOnLoopbackOnly(CapturedOutput output) {
    try (ConfigurableApplicationContext context = run("--emc2.login.mode=none")) {
      assertThat(boundAddress(context).isLoopbackAddress()).as(boundAddress(context).toString()).isTrue();
      assertThat(context.getBean(LoginMode.class)).isEqualTo(LoginMode.NONE);
    }
    assertThat(output.getOut()).contains("*** NO LOGIN ***").doesNotContain("OPEN TO THE NETWORK");
  }

  @Test
  void theDevelopmentProfileChoosesTheNoLoginMode() {
    try (ConfigurableApplicationContext context = run("--spring.profiles.active=" + LoginConfiguration.DEV_PROFILE)) {
      assertThat(context.getBean(LoginMode.class)).isEqualTo(LoginMode.NONE);
      assertThat(boundAddress(context).isLoopbackAddress()).isTrue();
    }
  }

  @Test
  void theDevelopmentProfileCannotBeCombinedWithLogin() {
    assertThatThrownBy(() -> run("--spring.profiles.active=" + LoginConfiguration.DEV_PROFILE, "--emc2.login.mode=oidc"))
        .hasStackTraceContaining("The development profile 'dev' is the no-login mode")
        .hasStackTraceContaining("cannot be combined with emc2.login.mode=oidc");
  }

  @Test
  void aLoopbackAddressIsAccepted() {
    try (ConfigurableApplicationContext context = run("--emc2.login.mode=none", "--server.address=localhost")) {
      assertThat(boundAddress(context).isLoopbackAddress()).isTrue();
    }
  }

  @Test
  void anotherAddressWithoutTheSecondSettingIsRefused() {
    assertThatThrownBy(() -> run("--emc2.login.mode=none", "--server.address=0.0.0.0"))
        .hasStackTraceContaining("listens on this computer only, but server.address is 0.0.0.0")
        .hasStackTraceContaining("--emc2.login.no-login.allow-network=true");
  }

  @Test
  void anotherAddressWithTheSecondSettingStartsWithASecondWarning(CapturedOutput output) {
    try (ConfigurableApplicationContext context = run("--emc2.login.mode=none", "--server.address=0.0.0.0",
        "--emc2.login.no-login.allow-network=true")) {
      assertThat(boundAddress(context).isAnyLocalAddress()).isTrue();
    }
    assertThat(output.getOut()).contains("*** NO LOGIN ***").contains("*** NO LOGIN, OPEN TO THE NETWORK *** listening on 0.0.0.0");
  }

  @Test
  void loopbackIsTheLoopbackAddressesAndNamesForThem() {
    assertThat(LoginConfiguration.isLoopback("127.0.0.1")).isTrue();
    assertThat(LoginConfiguration.isLoopback("::1")).isTrue();
    assertThat(LoginConfiguration.isLoopback("localhost")).isTrue();
    assertThat(LoginConfiguration.isLoopback("0.0.0.0")).isFalse();
    assertThat(LoginConfiguration.isLoopback("::")).isFalse();
    assertThat(LoginConfiguration.isLoopback("192.0.2.1")).isFalse();
    assertThat(LoginConfiguration.isLoopback("")).isFalse();
  }
}
