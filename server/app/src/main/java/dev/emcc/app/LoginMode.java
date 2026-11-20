package dev.emcc.app;

import java.util.Locale;

/**
 * How users log in (ADR-0022), chosen by {@value #SETTING}. There is no silent fallback from one
 * mode to the other: a server configured for login that cannot log anyone in does not start.
 */
enum LoginMode {

  /** Login with OpenID Connect on the server side. The default. */
  OIDC,
  /** No login: one local user with all permissions, on this computer only unless allowed otherwise. */
  NONE;

  static final String SETTING = "emc2.login.mode";

  /** The setting's value: {@code oidc} or {@code none}. */
  String value() {
    return name().toLowerCase(Locale.ROOT);
  }

  static LoginMode parse(String value) {
    for (LoginMode mode : values()) {
      if (mode.value().equals(value.trim().toLowerCase(Locale.ROOT))) {
        return mode;
      }
    }
    throw new IllegalStateException(SETTING + " must be 'oidc' (login) or 'none' (no login), not '" + value + "'");
  }
}
