package dev.emcc.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * ADR-0063's check (M9 C4): a service stop runs the same orderly shutdown as Ctrl+C. The built server jar runs in a JVM
 * of its own through {@link Service#start}, as procrun's jvm mode starts it; {@link Service#stop} then ends it: the web
 * server's graceful shutdown, ECore's stop (persistence written) and exit code 0.
 */
class ServiceStopTest {

  static final Path APP = Path.of("../app/target/emc2-app.jar");

  @TempDir
  Path emcc;

  @Test
  void aServiceStopIsTheOrderlyShutdownWithExitCodeZero() throws Exception {
    assertThat(APP).as("the server's jar: build with 'verify' or 'package', which builds the app first").isRegularFile();
    Files.createDirectories(emcc.resolve("plugins"));
    String javaBin = Path.of(System.getProperty("java.home"), "bin", "java").toString();
    String classpath = String.join(java.io.File.pathSeparator, APP.toAbsolutePath().toString(),
        Path.of("target/classes").toAbsolutePath().toString(), Path.of("target/test-classes").toAbsolutePath().toString());
    Process server = new ProcessBuilder(javaBin, "-cp", classpath, ProcrunHarness.class.getName(),
        "--spring.profiles.active=dev", "--server.port=0", "--emc2.data.directory=" + emcc.resolve("data"),
        "--emc2.plugins.directory=" + emcc.resolve("plugins"), "--emc2.web.root=" + emcc.resolve("web"))
        .directory(emcc.toFile()).redirectErrorStream(true).start();
    List<String> lines = new CopyOnWriteArrayList<>();
    Thread.ofPlatform().daemon().start(() -> {
      try (BufferedReader r = new BufferedReader(new InputStreamReader(server.getInputStream(), StandardCharsets.UTF_8))) {
        for (String line; (line = r.readLine()) != null; ) {
          lines.add(line);
        }
      } catch (IOException e) {
        // the process ended
      }
    });
    try {
      waitFor(() -> lines.stream().anyMatch(l -> l.contains("Started Emc2Application")) || !server.isAlive(), lines, 90);
      assertThat(server.isAlive()).as("started: %s", lines).isTrue();
      try (OutputStream in = server.getOutputStream()) {
        in.write("stop\n".getBytes(StandardCharsets.UTF_8)); // procrun's stop
      }
      assertThat(server.waitFor(60, TimeUnit.SECONDS)).as("ended within procrun's 60 s stop timeout: %s", lines).isTrue();
      assertThat(server.exitValue()).as("exit code: %s", lines).isZero();
      waitFor(() -> lines.stream().anyMatch(l -> l.contains("ECore stopped")), lines, 5);
      assertThat(String.join("\n", lines)).contains("Commencing graceful shutdown").contains("ECore stopped");
      assertThat(lines.stream().filter(l -> l.contains("Commencing graceful shutdown")).findFirst().map(lines::indexOf).orElseThrow())
          .as("the web server first, then ECore").isLessThan(lines.indexOf(lines.stream().filter(l -> l.contains("ECore stopped"))
              .findFirst().orElseThrow()));
      assertThat(emcc.resolve("data")).as("the persistence manager wrote its files").isNotEmptyDirectory();
    } finally {
      server.destroyForcibly();
    }
  }

  static void waitFor(java.util.function.BooleanSupplier condition, List<String> lines, int seconds) throws InterruptedException {
    long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds);
    while (!condition.getAsBoolean()) {
      assertThat(System.nanoTime()).as("within %d s: %s", seconds, lines).isLessThan(until);
      Thread.sleep(50);
    }
  }
}
