package dev.emcc.app;

import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * Stops the server the same way as Ctrl+C: the application context closes (the web server first,
 * then ECore, whose persistence manager writes everything), then the JVM exits with the context's
 * exit code, 0 on a clean stop.
 *
 * <p>The stop runs on its own platform thread. That is a deliberate exception to "threads only in
 * the worker runtime" (rule C1, which binds ECore and the plugins): the edge closes the whole
 * application, the runtime included, so the stop cannot run on one of its workers, and it must not
 * run on the request thread, which answers first.
 */
@Component
@Profile(LoginConfiguration.DEV_PROFILE)
class ServerStopper {

  private static final Logger LOG = LoggerFactory.getLogger(ServerStopper.class);

  private final ConfigurableApplicationContext context;
  private final JvmExit exit;
  private final AtomicBoolean stopping = new AtomicBoolean();

  ServerStopper(ConfigurableApplicationContext context, ObjectProvider<JvmExit> exit) {
    this.context = context;
    this.exit = exit.getIfAvailable(() -> System::exit);
  }

  /**
   * Starts the stop on its own thread and returns at once. Later calls have no further effect.
   *
   * @return whether this call started the stop
   */
  boolean stopLater(String reason) {
    if (!stopping.compareAndSet(false, true)) {
      return false;
    }
    LOG.info("Stopping the server: {}", reason);
    Thread.ofPlatform().name("emc2-stop").start(() -> exit.exit(SpringApplication.exit(context)));
    return true;
  }
}
