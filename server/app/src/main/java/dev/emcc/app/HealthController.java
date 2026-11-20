package dev.emcc.app;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Minimal health check, used by the start script and the integration tests; M9 RC2 (owner ACQ): with the release's
 * version and whether its manual is there, for the shell's help menu ({@link ReleaseInfo}).
 */
@RestController
class HealthController {

  /** Open without login (ADR-0022): it tells whether the server runs, and which release it is. */
  static final String PATH = "/api/health";

  /**
   * Response of {@code GET /api/health}: {@code version} is {@code name}, {@code date}, {@code commit}, {@code dirty} and
   * {@code sdk} of {@code version.properties}, or {@code {"name": "dev", "sdk": ...}} without it.
   */
  record Health(String status, String ecore, Map<String, Object> version, boolean manual) {}

  private final ECoreLifecycle ecore;
  private final ReleaseInfo release;

  HealthController(ECoreLifecycle ecore, ReleaseInfo release) {
    this.ecore = ecore;
    this.release = release;
  }

  @GetMapping(PATH)
  Health health() {
    return new Health(ecore.isRunning() ? "UP" : "DOWN", ecore.core().state().name(), release.version(), release.hasManual());
  }
}
