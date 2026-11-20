package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Behind a reverse proxy on 443 (T-036): Tomcat takes the browser's scheme, host and port from the
 * forwarded headers of a trusted proxy, and the Host and Origin checks use them. Here the test is
 * the proxy, on 127.0.0.1, and the public name is emc2.example.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "server.forward-headers-strategy=native",
    "server.tomcat.remoteip.internal-proxies=127\\.0\\.0\\.1",
    "emc2.allowed-hosts=emc2.example"})
@ActiveProfiles(LoginConfiguration.DEV_PROFILE)
@DirtiesContext // closes this class's server before its temporary folder is deleted
class ReverseProxyTest {

  @TempDir static Path folder;

  @Autowired private Environment environment;

  @DynamicPropertySource
  static void dataDirectory(DynamicPropertyRegistry registry) {
    registry.add("emc2.data.directory", () -> folder.toString());
  }

  @Test
  void aRequestForwardedForAnAllowedNameIsServed() throws IOException {
    assertThat(status("GET", "/api/health", "emc2.example", null)).contains(" 200 ");
  }

  @Test
  void aForwardedNameThatIsNotAllowedIsRefused() throws IOException {
    assertThat(status("GET", "/api/health", "evil.example", null)).contains(" 403 ");
  }

  @Test
  void theOriginIsComparedWithTheSchemeAndHostTheBrowserUsed() throws IOException {
    assertThat(status("POST", "/api/config", "emc2.example", "https://emc2.example"))
        .as("the browser's own origin: reaches the application, which has no POST there").contains(" 405 ");
    assertThat(status("POST", "/api/config", "emc2.example", "http://emc2.example")).as("another scheme").contains(" 403 ");
    assertThat(status("POST", "/api/config", "emc2.example", "https://evil.example")).contains(" 403 ");
  }

  /** A request as the proxy sends it: TLS ended there, the browser's name and scheme forwarded. */
  private String status(String method, String path, String forwardedHost, String origin) throws IOException {
    int port = Integer.parseInt(environment.getRequiredProperty("local.server.port"));
    try (Socket socket = new Socket("127.0.0.1", port)) {
      socket.setSoTimeout(10_000);
      String request = method + " " + path + " HTTP/1.1\r\nHost: 127.0.0.1:" + port + "\r\n"
          + "X-Forwarded-For: 192.0.2.10\r\nX-Forwarded-Proto: https\r\nX-Forwarded-Host: " + forwardedHost + "\r\n"
          + "X-Forwarded-Port: 443\r\n" + (origin == null ? "" : "Origin: " + origin + "\r\n")
          + "Content-Length: 0\r\nConnection: close\r\n\r\n";
      socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
      return new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII)).readLine();
    }
  }
}
