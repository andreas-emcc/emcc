package dev.emcc.service;

import java.lang.reflect.InvocationTargetException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.IntConsumer;

/**
 * emcc as a Windows service (ADR-0063 point 4, M9 C4): procrun's start and stop methods in its {@code jvm} mode.
 *
 * <p>procrun loads this class from its class path ({@code emc2-app.jar;emcc-service.jar}) and calls, in its own JVM:
 * <ul>
 *   <li>{@link #start(String[])}: runs the server through Spring Boot's launcher, with the same arguments as {@code
 *       start.bat}, and then waits: procrun ends the service when its start method returns. A start that fails ends the
 *       JVM with 1, so procrun's restart policy applies;
 *   <li>{@link #stop(String[])}: ends the JVM with 0 on a thread of its own and returns at once. The JVM's shutdown hook
 *       then runs the server's orderly shutdown, exactly as Ctrl+C in {@code start.bat}'s window does: the web server
 *       finishes its requests, ECore stops its plugins and the persistence manager writes everything. procrun kills the
 *       process only after its stop timeout.
 * </ul>
 *
 * <p>Reachable only in the server's own process: no port, no endpoint. The stop thread is the edge's deliberate exception
 * to "threads only in the worker runtime", as {@code ServerStopper}'s: it ends the whole JVM, the runtime included.
 */
public final class Service {

  /** Spring Boot's launcher of an executable jar (Spring Boot 4). */
  static final String LAUNCHER = "org.springframework.boot.loader.launch.JarLauncher";

  static volatile String launcher = LAUNCHER;
  /** Ends the JVM; tests replace it. */
  static volatile IntConsumer exit = System::exit;

  private static final AtomicBoolean STOPPING = new AtomicBoolean();
  private static final CountDownLatch NEVER = new CountDownLatch(1);

  private Service() {}

  /** procrun's start method: runs the server, then waits until the JVM ends. */
  public static void start(String[] args) {
    try {
      Class.forName(launcher).getMethod("main", String[].class).invoke(null, (Object) args);
    } catch (InvocationTargetException e) {
      failed(e.getCause() == null ? e : e.getCause());
      return;
    } catch (ReflectiveOperationException | RuntimeException | LinkageError e) {
      failed(e);
      return;
    }
    while (true) { // the server runs on its own threads; this one holds procrun's start until the JVM ends
      try {
        NEVER.await();
      } catch (InterruptedException e) {
        // procrun does not interrupt it; keep waiting
      }
    }
  }

  /** procrun's stop method: the orderly shutdown, as Ctrl+C; later calls do nothing. */
  public static void stop(String[] args) {
    if (!STOPPING.compareAndSet(false, true)) {
      return;
    }
    IntConsumer end = exit;
    Thread.ofPlatform().name("emcc-service-stop").start(() -> end.accept(0));
  }

  private static void failed(Throwable why) {
    System.err.println("emcc did not start: " + why);
    exit.accept(1);
  }

  /** For tests: a stop may come again. */
  static void reset() {
    STOPPING.set(false);
  }
}
