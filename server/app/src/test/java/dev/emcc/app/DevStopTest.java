package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.ECore;
import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.persistence.FileStore;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

/** The development stop endpoint over real HTTP (owner decision 2026-10-07). */
class DevStopTest {

  private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

  /** Deleted by JUnit after each test; every test ends the application it starts. */
  @TempDir Path dataDirectory;

  /** Records the exit instead of ending the test JVM. */
  private final CompletableFuture<Integer> exitStatus = new CompletableFuture<>();

  private ConfigurableApplicationContext run(Class<?> application, String profile, String... more) {
    return new SpringApplicationBuilder(application)
        .initializers(context -> context.getBeanFactory().registerSingleton("jvmExit", (JvmExit) exitStatus::complete))
        .run(java.util.stream.Stream.concat(java.util.stream.Stream.of("--spring.profiles.active=" + profile, "--server.port=0",
            "--emc2.data.directory=" + dataDirectory), java.util.stream.Stream.of(more)).toArray(String[]::new));
  }

  @Test
  void stopsCleanlyLikeCtrlCAndExitsWithZero() throws Exception {
    ConfigurableApplicationContext context = run(Emc2Application.class, LoginConfiguration.DEV_PROFILE);
    ECore core = context.getBean(ECoreLifecycle.class).core();

    HttpResponse<String> response = post(context, DevStopController.PATH);

    assertThat(response.statusCode()).isEqualTo(202);
    assertThat(response.body()).isEqualTo("{\"status\":\"STOPPING\"}");
    assertThat(exitStatus.get(30, TimeUnit.SECONDS)).isZero();
    assertThat(context.isActive()).isFalse();
    assertThat(core.state()).isEqualTo(ECore.State.STOPPED);
    try (FileStore files = new FileStore(dataDirectory, new ModelJson())) {
      assertThat(files.load().journal()).as("the Drawing layer, written by the persistence manager").hasSize(1);
    }
  }

  @Test
  void doesNotExistWithoutTheDevProfile() throws Exception {
    try (ConfigurableApplicationContext context = run(Emc2Application.class, "test", "--" + LoginMode.SETTING + "=none")) {
      assertThat(get(context, "/api/health").statusCode()).as("the server answers").isEqualTo(200);

      assertThat(post(context, DevStopController.PATH).statusCode()).isEqualTo(404);
      assertThat(context.getBeanNamesForType(DevStopController.class)).isEmpty();
      assertThat(exitStatus).isNotDone();
    }
  }

  private static HttpResponse<String> post(ConfigurableApplicationContext context, String path)
      throws IOException, InterruptedException {
    return HTTP.send(request(context, path).POST(HttpRequest.BodyPublishers.noBody()).build(),
        HttpResponse.BodyHandlers.ofString());
  }

  private static HttpResponse<String> get(ConfigurableApplicationContext context, String path)
      throws IOException, InterruptedException {
    return HTTP.send(request(context, path).GET().build(), HttpResponse.BodyHandlers.ofString());
  }

  private static HttpRequest.Builder request(ConfigurableApplicationContext context, String path) {
    String port = context.getEnvironment().getRequiredProperty("local.server.port");
    return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(10));
  }
}
