package dev.emcc.app;

import dev.emcc.sdk.Permissions;
import jakarta.servlet.http.HttpServletRequest;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;

/**
 * The check every settings and monitor call makes first (overview 4.11: the server checks {@code
 * settings.admin} for every read and write of settings and for monitor data; hiding the tabs is not
 * the protection). One place, so that the settings and the monitor endpoints cannot drift apart.
 */
@Component
class AdminAccess {

  private final CurrentUser currentUser;

  AdminAccess(CurrentUser currentUser) {
    this.currentUser = currentUser;
  }

  /** {@code 401} without login, {@code 403} without {@code settings.admin}, else null: go ahead. */
  @Nullable ResponseEntity<?> denied(HttpServletRequest request) {
    User user = currentUser.of(request);
    if (user == null) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
    }
    if (!PluginController.sdkUser(user, currentUser.mode()).has(Permissions.SETTINGS_ADMIN)) {
      return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
    }
    return null;
  }
}
