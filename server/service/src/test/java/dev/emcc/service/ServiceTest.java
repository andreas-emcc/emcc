package dev.emcc.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** ADR-0063 point 4: procrun's entry, without a server. */
class ServiceTest {

  final List<String> exits = new CopyOnWriteArrayList<>();

  /** A launcher whose start fails, as Spring Boot's main does when the server cannot start. */
  public static final class FailingLauncher {
    public static void main(String[] args) {
      throw new IllegalStateException("port taken");
    }
  }

  @AfterEach
  void restore() {
    Service.launcher = Service.LAUNCHER;
    Service.exit = System::exit;
    Service.reset();
  }

  @Test
  void aStartThatFailsEndsTheJvmWithOne() {
    Service.exit = code -> exits.add(Thread.currentThread().getName() + " " + code);
    Service.launcher = FailingLauncher.class.getName();
    Service.start(new String[0]);
    Service.launcher = "no.such.Launcher";
    Service.start(new String[0]);

    assertThat(exits).hasSize(2).allSatisfy(e -> assertThat(e).endsWith(" 1"));
  }

  @Test
  void theStopEndsTheJvmWithZeroOnceOnItsOwnThreadAndReturnsAtOnce() throws InterruptedException {
    Service.exit = code -> exits.add(Thread.currentThread().getName() + " " + code);

    Service.stop(new String[0]);
    Service.stop(new String[0]);

    long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (exits.isEmpty() && System.nanoTime() < until) {
      Thread.sleep(5);
    }
    Thread.sleep(50);
    assertThat(exits).containsExactly("emcc-service-stop 0");
  }
}
