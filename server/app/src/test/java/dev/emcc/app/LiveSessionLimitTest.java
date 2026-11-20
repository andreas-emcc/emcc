package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.file.Path;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** The limit of live sessions (emc2.live.max-sessions), here 1. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles(LoginConfiguration.DEV_PROFILE)
@DirtiesContext // closes this class's server before its temporary folder is deleted
class LiveSessionLimitTest {

  /** Deleted by JUnit after the class, once {@code @DirtiesContext} has closed the server that uses it. */
  @TempDir static Path folder;

  private static final HttpClient HTTP = HttpClient.newHttpClient();

  @Autowired private Environment environment;

  @DynamicPropertySource
  static void settings(DynamicPropertyRegistry registry) {
    registry.add("emc2.live.max-sessions", () -> "1");
    registry.add("emc2.data.directory", () -> folder.toString());
  }

  /** Records how the server closed the connection. */
  static final class Closing implements WebSocket.Listener {
    final CompletableFuture<String> closed = new CompletableFuture<>();
    final CompletableFuture<String> firstText = new CompletableFuture<>();

    @Override
    public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
      firstText.complete(data.toString());
      webSocket.request(1);
      return null;
    }

    @Override
    public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
      closed.complete(statusCode + " " + reason);
      return null;
    }
  }

  @Test
  void aConnectionAboveTheLimitIsClosedWithTryAgainLater() throws Exception {
    URI uri = URI.create("ws://127.0.0.1:" + environment.getRequiredProperty("local.server.port") + LiveWebSocketHandler.PATH);
    Closing first = new Closing();
    WebSocket open = HTTP.newWebSocketBuilder().buildAsync(uri, first).get(10, TimeUnit.SECONDS);
    assertThat(first.firstText.get(10, TimeUnit.SECONDS)).contains("welcome");

    Closing second = new Closing();
    HTTP.newWebSocketBuilder().buildAsync(uri, second).get(10, TimeUnit.SECONDS);

    assertThat(second.closed.get(10, TimeUnit.SECONDS)).isEqualTo("1013 too many sessions");
    assertThat(first.closed).isNotDone();
    open.abort();
  }
}
