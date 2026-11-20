package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import org.jspecify.annotations.Nullable;
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
 * Who may open the live picture's WebSocket (T-013 review F5) and call the API: the {@code Host}
 * header must name this server (against DNS rebinding), and a browser's {@code Origin} must be the
 * server itself.
 * The handshakes are written by hand, because HTTP clients do not let a test set {@code Host}.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles(LoginConfiguration.DEV_PROFILE)
@DirtiesContext // closes this class's server before its temporary folder is deleted
class LiveHandshakeTest {

  /** Deleted by JUnit after the class, once {@code @DirtiesContext} has closed the server that uses it. */
  @TempDir static Path folder;

  @Autowired private Environment environment;

  @DynamicPropertySource
  static void settings(DynamicPropertyRegistry registry) {
    registry.add("emc2.allowed-hosts", () -> "emc2.example, Other.Example");
    registry.add("emc2.data.directory", () -> folder.toString());
  }

  private int port() {
    return Integer.parseInt(environment.getRequiredProperty("local.server.port"));
  }

  /** The status code of a WebSocket handshake with these headers. */
  private int handshake(String host, @Nullable String origin) throws IOException {
    try (Socket socket = new Socket("127.0.0.1", port())) {
      socket.setSoTimeout(10_000);
      String request = "GET " + LiveWebSocketHandler.PATH + " HTTP/1.1\r\n"
          + "Host: " + host + "\r\n"
          + "Upgrade: websocket\r\n"
          + "Connection: Upgrade\r\n"
          + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
          + "Sec-WebSocket-Version: 13\r\n"
          + (origin == null ? "" : "Origin: " + origin + "\r\n")
          + "\r\n";
      socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
      String status = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII)).readLine();
      return Integer.parseInt(status.split(" ")[1]);
    }
  }

  @Test
  void theServersOwnNamesOnItsPortAreAllowed() throws IOException {
    assertThat(handshake("127.0.0.1:" + port(), null)).isEqualTo(101);
    assertThat(handshake("localhost:" + port(), null)).isEqualTo(101);
    assertThat(handshake("LOCALHOST:" + port(), null)).isEqualTo(101);
    assertThat(handshake("[::1]:" + port(), null)).isEqualTo(101);
    assertThat(handshake("emc2.example:" + port(), null)).as("configured").isEqualTo(101);
    assertThat(handshake("other.example:" + port(), null)).as("configured, any case").isEqualTo(101);
  }

  @Test
  void aForeignHostIsRefused() throws IOException {
    assertThat(handshake("evil.example:" + port(), null)).as("DNS rebinding").isEqualTo(403);
    assertThat(handshake("evil.example:" + port(), "http://evil.example:" + port())).isEqualTo(403);
    assertThat(handshake("127.0.0.1.evil.example:" + port(), null)).isEqualTo(403);
    assertThat(handshake("127.0.0.1:" + (port() + 1), null)).as("wrong port").isEqualTo(403);
    assertThat(handshake("127.0.0.1", null)).as("no port means 80").isEqualTo(403);
    assertThat(handshake("127.0.0.1:x", null)).as("malformed: Tomcat refuses it itself").isEqualTo(400);
  }

  @Test
  void aBrowserMustComeFromTheServerItself() throws IOException {
    String self = "127.0.0.1:" + port();
    assertThat(handshake(self, "http://" + self)).isEqualTo(101);
    assertThat(handshake(self, "null")).as("Origin: null (sandboxed or file pages)").isEqualTo(403);
    assertThat(handshake(self, "https://" + self)).as("wrong scheme").isEqualTo(403);
    assertThat(handshake(self, "http://127.0.0.1:" + (port() + 1))).as("wrong port").isEqualTo(403);
    assertThat(handshake(self, "http://evil.example")).isEqualTo(403);
  }

  /** The status code of a plain GET with this Host header. */
  private int get(String path, String host) throws IOException {
    try (Socket socket = new Socket("127.0.0.1", port())) {
      socket.setSoTimeout(10_000);
      String request = "GET " + path + " HTTP/1.1\r\nHost: " + host + "\r\nConnection: close\r\n\r\n";
      socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
      String status = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII)).readLine();
      return Integer.parseInt(status.split(" ")[1]);
    }
  }

  @Test
  void theApiChecksTheHostToo() throws IOException {
    assertThat(get("/api/health", "127.0.0.1:" + port())).isEqualTo(200);
    assertThat(get("/api/health", "emc2.example:" + port())).isEqualTo(200);
    assertThat(get("/api/health", "evil.example:" + port())).as("DNS rebinding").isEqualTo(403);
    assertThat(get("/api/plugins", "evil.example:" + port())).isEqualTo(403);
    assertThat(get("/api/health", "127.0.0.1:" + (port() + 1))).as("wrong port").isEqualTo(403);
  }

  @Test
  void aClientWithoutOriginIsNoBrowserAndMayConnect() throws IOException {
    assertThat(handshake("127.0.0.1:" + port(), null)).isEqualTo(101);
  }
}
