package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.nio.file.Path;
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

/** A connection from which nothing arrives is closed after emc2.live.idle-timeout (F6), here 1 s. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles(LoginConfiguration.DEV_PROFILE)
@DirtiesContext // closes this class's server before its temporary folder is deleted
class LiveIdleTimeoutTest {

  /** Deleted by JUnit after the class, once {@code @DirtiesContext} has closed the server that uses it. */
  @TempDir static Path folder;

  @Autowired private Environment environment;

  /** How often Tomcat checks WebSocket sessions for the idle timeout (its default process period). */
  private static final int IDLE_CHECK_PERIOD_SECONDS = 10;

  @DynamicPropertySource
  static void settings(DynamicPropertyRegistry registry) {
    registry.add("emc2.live.idle-timeout", () -> "1s");
    registry.add("emc2.data.directory", () -> folder.toString());
  }

  @Test
  void anIdleConnectionIsClosed() throws Exception {
    URI uri = URI.create("ws://127.0.0.1:" + environment.getRequiredProperty("local.server.port") + LiveWebSocketHandler.PATH);
    LiveSessionLimitTest.Closing listener = new LiveSessionLimitTest.Closing();
    HttpClient.newHttpClient().newWebSocketBuilder().buildAsync(uri, listener).get(10, TimeUnit.SECONDS);
    assertThat(listener.firstText.get(10, TimeUnit.SECONDS)).contains("welcome");

    // The client sends nothing; the server's next ping is 30 s away. Tomcat checks idle sessions only
    // every 10 s (its DEFAULT_PROCESS_PERIOD of 10 background ticks of 1 s), so the close comes 1 to
    // about 11 s after the last read. The wait ends with the close; the deadline only bounds a failure.
    assertThat(listener.closed.get(IDLE_CHECK_PERIOD_SECONDS + 1 + 20, TimeUnit.SECONDS)).isNotEmpty();
  }
}
