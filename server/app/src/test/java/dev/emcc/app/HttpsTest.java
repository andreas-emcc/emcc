package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.TrustManagerFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.core.env.Environment;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * HTTPS on the edge (ADR-0061, M9 C2): the SSL bundle {@code emcc} from the settings, TLS 1.3 and 1.2, HSTS for a
 * year on this host only, the redirect port's {@code 307}, and the certificate in the Monitor. The certificate is made
 * here with {@code keytool}; no file of the ESA's.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = { // seen at start, as a settings file's are
    "spring.ssl.bundle.jks.emcc.keystore.location=file:target/https-test/server.p12",
    "spring.ssl.bundle.jks.emcc.keystore.password=test-only-https",
    "spring.ssl.bundle.jks.emcc.keystore.type=PKCS12"})
@ActiveProfiles(LoginConfiguration.DEV_PROFILE)
@DirtiesContext
@ExtendWith(OutputCaptureExtension.class)
class HttpsTest {

  @TempDir static Path folder;
  /** The certificate, made afresh for each run where the inline properties name it. */
  private static final Path KEYS = Path.of("target", "https-test");
  private static int redirectPort;

  @Autowired private Environment environment;

  static { // before the context: HttpsSettings checks at start that the named key store exists
    try {
      Files.createDirectories(KEYS);
      Files.deleteIfExists(KEYS.resolve("server.p12"));
      keytool("-genkeypair", "-alias", "emcc", "-keyalg", "RSA", "-keysize", "2048", "-dname", "CN=localhost, O=emcc-test",
          "-ext", "SAN=dns:localhost,ip:127.0.0.1", "-validity", "20", "-storetype", "PKCS12", "-keystore", "server.p12",
          "-storepass", "test-only-https");
    } catch (Exception e) {
      throw new ExceptionInInitializerError(e);
    }
  }

  @DynamicPropertySource
  static void https(DynamicPropertyRegistry registry) throws Exception {
    try (ServerSocket free = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
      redirectPort = free.getLocalPort();
    }
    registry.add("emc2.plugins.directory", () -> folder.resolve("plugins").toString());
    registry.add("emc2.data.directory", () -> folder.resolve("data").toString());
    registry.add(HttpsConfiguration.REDIRECT_PORT, () -> String.valueOf(redirectPort));
  }

  @Test
  void servesHttpsWithTheBundleTls13And12AndHstsForThisHostOnly() throws Exception {
    assertThat(environment.getProperty("server.ssl.bundle")).isEqualTo("emcc");
    assertThat(environment.getProperty("spring.ssl.bundle.jks.emcc.options.enabled-protocols")).isEqualTo("TLSv1.3,TLSv1.2");
    assertThat(environment.getProperty("spring.ssl.bundle.jks.emcc.reload-on-update")).isEqualTo("true");

    for (String protocol : List.of("TLSv1.3", "TLSv1.2")) {
      HttpResponse<String> health = client(protocol).send(HttpRequest.newBuilder(uri("/api/health")).build(), HttpResponse.BodyHandlers.ofString());
      assertThat(health.statusCode()).as(protocol).isEqualTo(200);
      assertThat(health.headers().firstValue("Strict-Transport-Security")).as(protocol).hasValue("max-age=31536000");
    }
    assertThatThrownBy(() -> client("TLSv1.1").send(HttpRequest.newBuilder(uri("/api/health")).build(), HttpResponse.BodyHandlers.ofString()))
        .as("TLS 1.1 is refused; the JDK's client refuses it too, so the server's own list above is the real check")
        .isInstanceOf(IOException.class);
  }

  @Test
  void theRedirectPortSends307ToTheSameHostOverHttpsAndOnlyForAllowedHosts() throws Exception {
    String answer = plain("GET /api/health?x=1 HTTP/1.1\r\nHost: 127.0.0.1:" + redirectPort + "\r\nConnection: close\r\n\r\n");
    assertThat(answer).startsWith("HTTP/1.1 307 ")
        .contains("Location: https://127.0.0.1:" + environment.getProperty("local.server.port") + "/api/health?x=1");

    String post = plain("POST /api/settings/general HTTP/1.1\r\nHost: localhost:" + redirectPort + "\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
    assertThat(post).startsWith("HTTP/1.1 307 ").contains("Location: https://localhost:" + environment.getProperty("local.server.port")
        + "/api/settings/general");

    String evil = plain("GET / HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n");
    assertThat(evil).as("the Host check first: never a redirect to a host of the request's choosing")
        .doesNotStartWith("HTTP/1.1 307 ").doesNotContain("evil.example");
  }

  @Test
  void saysTheReadyLineWithHttpsAndTheRedirectPort(CapturedOutput output) { // M9 B3
    assertThat(output.getAll()).contains("emcc ready at https://localhost:" + environment.getProperty("local.server.port")
        + "/ (http://localhost:" + redirectPort + "/ redirects to it)");
  }

  @Test
  void theRedirectsLogNamesHttpsPortOrThatItIsPickedAtStart() {
    // ITA T1: with server.port=0 the log said "HTTPS on port 0"
    assertThat(HttpsConfiguration.httpsPortText(new MockEnvironment().withProperty("server.port", "0"))).isEqualTo("the port picked at start");
    assertThat(HttpsConfiguration.httpsPortText(new MockEnvironment().withProperty("server.port", "8443"))).isEqualTo("port 8443");
    assertThat(HttpsConfiguration.httpsPortText(new MockEnvironment())).isEqualTo("port 8080");
  }

  @Test
  void theMonitorShowsTheServersCertificate() throws Exception {
    HttpResponse<String> monitor = client("TLSv1.3").send(HttpRequest.newBuilder(uri("/api/monitor")).build(), HttpResponse.BodyHandlers.ofString());
    assertThat(monitor.statusCode()).isEqualTo(200);
    assertThat(monitor.body()).as("20 days left: within 30")
        .contains("\"https\":{\"subject\":\"CN=localhost,O=emcc-test\",\"issuer\":\"CN=localhost,O=emcc-test\",")
        .contains("\"state\":\"soon\"}");
  }

  private URI uri(String path) {
    return URI.create("https://127.0.0.1:" + environment.getRequiredProperty("local.server.port") + path);
  }

  private static HttpClient client(String protocol) throws Exception {
    KeyStore trust = KeyStore.getInstance("PKCS12");
    try (InputStream in = Files.newInputStream(KEYS.resolve("server.p12"))) {
      trust.load(in, "test-only-https".toCharArray());
    }
    TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
    tmf.init(trust);
    SSLContext context = SSLContext.getInstance("TLS");
    context.init(null, tmf.getTrustManagers(), null);
    SSLParameters parameters = new SSLParameters();
    parameters.setProtocols(new String[] {protocol});
    return HttpClient.newBuilder().sslContext(context).sslParameters(parameters).connectTimeout(Duration.ofSeconds(5)).build();
  }

  /** A raw HTTP/1.1 exchange on the redirect port: the client may set the Host it likes. */
  private static String plain(String request) throws IOException {
    try (Socket socket = new Socket(InetAddress.getLoopbackAddress(), redirectPort)) {
      socket.setSoTimeout(10_000);
      OutputStream out = socket.getOutputStream();
      out.write(request.getBytes(StandardCharsets.US_ASCII));
      out.flush();
      return new String(socket.getInputStream().readAllBytes(), StandardCharsets.ISO_8859_1);
    }
  }

  private static void keytool(String... args) throws IOException, InterruptedException {
    List<String> command = new ArrayList<>(List.of(Path.of(System.getProperty("java.home"), "bin", "keytool").toString()));
    command.addAll(List.of(args));
    Process p = new ProcessBuilder(command).directory(KEYS.toFile()).redirectErrorStream(true).start();
    String output = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    assertThat(p.waitFor()).as(output).isZero();
  }
}
