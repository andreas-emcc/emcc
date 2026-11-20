package dev.emcc.app;

import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

/**
 * Ends every stream viewer's endless response (SDK 1.8.0, CR-0044 E1) just before the web server's
 * graceful shutdown, which waits for the requests in progress and would otherwise wait for these
 * until its timeout. The streams stay open until ECore stops, after the web server.
 */
@Component
class StreamViewersStop implements SmartLifecycle {

  private final ECoreLifecycle ecore;
  private volatile boolean running;

  StreamViewersStop(ECoreLifecycle ecore) {
    this.ecore = ecore;
  }

  @Override
  public void start() {
    running = true;
  }

  @Override
  public void stop() {
    running = false;
    try {
      ecore.core().plugins().streams().endViewers("the server is stopping");
    } catch (IllegalStateException notRunning) {
      // ECore never started, or has stopped: no viewers
    }
  }

  @Override
  public boolean isRunning() {
    return running;
  }

  @Override
  public int getPhase() {
    return WebServerApplicationContext.GRACEFUL_SHUTDOWN_PHASE + 1; // stops before it
  }
}
