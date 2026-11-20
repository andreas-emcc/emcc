package dev.emcc.app;

import dev.emcc.ecore.monitor.MonitorSnapshot;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.List;
import org.jspecify.annotations.Nullable;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The monitor view's data (overview 4.10, T-039 part 3): {@code GET /api/monitor} answers ECore's
 * {@link dev.emcc.ecore.monitor.MonitorSnapshot} as JSON. The shell asks every 2 s while the tab is
 * open (owner, 2026-10-13: polling, no push).
 *
 * <p>Only for {@code settings.admin}, checked first ({@link AdminAccess}: {@code 401}, {@code 403}):
 * the snapshot names the hosts and ports of the plugins' listeners. It is never sent another way
 * (not in {@code /api/plugins}, {@code /api/config} or on the live picture's socket, which every
 * logged-in user gets). A GET changes nothing, so the Origin check does not apply.
 */
@RestController
class MonitorController {

  static final String PATH = "/api/monitor";

  private final ECoreLifecycle ecore;
  private final AdminAccess admin;

  private final HttpsConfiguration.ServerCertificate certificate;

  MonitorController(ECoreLifecycle ecore, AdminAccess admin, HttpsConfiguration.ServerCertificate certificate) {
    this.ecore = ecore;
    this.admin = admin;
    this.certificate = certificate;
  }

  @GetMapping(PATH)
  ResponseEntity<?> monitor(HttpServletRequest request) {
    ResponseEntity<?> denied = admin.denied(request);
    if (denied != null) {
      return denied;
    }
    MonitorSnapshot s = ecore.core().monitor().snapshot();
    return ResponseEntity.ok().cacheControl(CacheControl.noStore())
        .body(new Answer(s.atMillis(), s.core(), s.plugins(), s.coreWorkers(), certificate.now(Instant.ofEpochMilli(s.atMillis()))));
  }

  /**
   * ECore's snapshot, with the edge's HTTPS certificate beside it (ADR-0061 point 6, M9 C2): null without HTTPS. Its
   * components are the snapshot's, then {@code https}; {@code MonitorControllerTest} keeps them so.
   */
  record Answer(long atMillis, MonitorSnapshot.Core core, List<MonitorSnapshot.Plugin> plugins, List<MonitorSnapshot.Worker> coreWorkers,
      HttpsConfiguration.@Nullable Https https) {}
}
